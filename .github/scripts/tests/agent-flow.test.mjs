// 工作流程 v1.1 階段 A 的離線測試：只用 fixtures 與假的 GitHub client，不連網、不寫 GitHub、不派測試 Issue。
// 執行：node --test .github/scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as flow from '../agent-flow.mjs';
import { backstop, collect, createGitHub, finalize, issueGuard, resumeGuard, verifyOnlyReport } from '../agent-flow-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const fixtures = JSON.parse(readFileSync(join(HERE, 'fixtures', 'scenarios.json'), 'utf8'));
const { sha: SHA, otherSha: OTHER_SHA } = fixtures.constants;
const BASE = '0'.repeat(40);

const workflowPlan = flow.planChecks(['.github/workflows/claude.yml', 'doc/agent-workflow/WORKFLOW_RULES.md'], 'workflow');
const productPlan = flow.planChecks(['src/app/app.ts'], 'product');
const pass = (/** @type {string} */ id) => [id, 'success'];
const VERIFICATIONS = {
  $workflowPass: flow.summarizeChecks({
    sha: SHA,
    plan: workflowPlan,
    outcomes: Object.fromEntries(['actionlint', 'flow-tests', 'diff-check', 'doc-refs'].map(pass)),
  }),
  $productFail: flow.summarizeChecks({
    sha: SHA,
    plan: productPlan,
    outcomes: { ...Object.fromEntries(['npm-ci', 'tsc-app', 'tsc-spec', 'ng-build', 'diff-check', 'doc-refs'].map(pass)), 'ng-test': 'failure' },
  }),
  $profileViolation: flow.summarizeChecks({
    sha: SHA,
    plan: flow.planChecks(['.github/workflows/claude.yml', 'src/app/app.ts'], 'workflow'),
    outcomes: Object.fromEntries(['npm-ci', 'tsc-app', 'tsc-spec', 'ng-build', 'ng-test', 'actionlint', 'flow-tests', 'diff-check', 'doc-refs'].map(pass)),
  }),
};

/** fixtures 的 $ 佔位符換成實際值。 @param {any} value @returns {any} */
function resolve(value) {
  if (value === '$sha') return SHA;
  if (value === '$otherSha') return OTHER_SHA;
  if (typeof value === 'string' && value in VERIFICATIONS) return VERIFICATIONS[/** @type {keyof typeof VERIFICATIONS} */ (value)];
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
  return value;
}

/** expected 中列出的欄位必須相同；未列出的欄位不比對。 @param {any} actual @param {any} expected @param {string} path */
function assertSubset(actual, expected, path = 'result') {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [key, value] of Object.entries(expected)) assertSubset(actual?.[key], value, `${path}.${key}`);
    return;
  }
  assert.deepEqual(actual, expected, path);
}

for (const scenario of fixtures.issueGuard) {
  test(`Issue 入口：${scenario.name}`, () => assertSubset(flow.evaluateIssueGuard(resolve(scenario.input)), scenario.expect));
}
for (const scenario of fixtures.verifyOnlyGuard) {
  test(`verify-only 入口：${scenario.name}`, () => assertSubset(flow.evaluateVerifyOnlyGuard(resolve(scenario.input)), scenario.expect));
}
for (const scenario of fixtures.decideFinal) {
  test(`收尾決定：${scenario.name}`, () => assertSubset(flow.decideFinal(resolve(scenario.input)), resolve(scenario.expect)));
}
for (const scenario of fixtures.classifyStop) {
  test(`停止原因：${scenario.name}`, () => assertSubset(flow.classifyStop(scenario.input), scenario.expect));
}
for (const scenario of fixtures.planChecks) {
  test(`驗證範圍：${scenario.name}`, () => assertSubset(flow.planChecks(scenario.files, scenario.declared), scenario.expect));
}

test('只有 complete 才會 human-review：所有其他狀態都不是 human-review', () => {
  for (const scenario of fixtures.decideFinal) {
    const decision = flow.decideFinal(resolve(scenario.input));
    assert.equal(decision.label === 'human-review', decision.status === 'complete', scenario.name);
  }
});

test('完成標記只採信本 Issue 的 trailer', () => {
  const message = '完成 A\n\nCheckpoint:\n- Completed: 全部\n- Remaining: 無\n\nKodeBart-Issue: 5\nKodeBart-Delivery: complete';
  assert.equal(flow.parseDelivery(message, 5).delivery, 'complete');
  assert.equal(flow.parseDelivery(message, 2).delivery, 'missing');
  assert.equal(flow.parseDelivery(message.replace('complete', 'done'), 5).delivery, 'missing');
  assert.equal(flow.parseDelivery('沒有 trailer', 5).delivery, 'missing');
  assert.match(flow.parseDelivery(message, 5).checkpoint, /Remaining: 無/);
  assert.doesNotMatch(flow.parseDelivery(message, 5).checkpoint, /KodeBart-Delivery/);
});

test('分支只接受本 Issue 的 claude/issue-<編號>-', () => {
  assert.equal(flow.expectedBranch(5, '37551950584'), 'claude/issue-5-run37551950584');
  assert.equal(flow.isIssueBranch('claude/issue-5-run1', 5), true);
  assert.equal(flow.isIssueBranch('claude/issue-50-run1', 5), false);
  assert.equal(flow.isIssueBranch('main', 5), false);
  assert.equal(flow.isIssueBranch('claude/issue-5-../main', 5), false);
  assert.deepEqual(flow.checkRunBranch({ issue: 5, runId: '9', actionBranch: '' }), { ok: true, branch: 'claude/issue-5-run9', reason: '' });
  assert.equal(flow.checkRunBranch({ issue: 5, runId: '9', actionBranch: 'claude/issue-5-20261007-0026' }).ok, false);
  assert.equal(flow.checkRunBranch({ issue: 5, runId: '9', actionBranch: 'claude/issue-4-run9' }).ok, false);
});

test('workflow-only：Angular 檢查明列 NOTRUN（workflow-only），不是 FAIL', () => {
  const product = VERIFICATIONS.$workflowPass.checks.filter((check) => check.group === 'product');
  assert.equal(product.length, 5);
  for (const check of product) {
    assert.equal(check.result, 'NOTRUN');
    assert.equal(check.required, false);
    assert.match(check.note, /workflow-only/);
  }
  assert.equal(flow.evaluateVerification(VERIFICATIONS.$workflowPass, SHA).state, 'pass');
});

test('Validation profile 只從 Issue 文字收窄，不能略過檢查', () => {
  assert.equal(flow.parseDeclaredProfile('- Execution mode: implement\n- Validation profile: workflow\n'), 'workflow');
  assert.equal(flow.parseDeclaredProfile('Validation profile: none'), '');
  const plan = flow.planChecks(['src/main.ts'], 'docs');
  assert.equal(plan.product, true);
  assert.deepEqual(plan.violations, ['src/main.ts']);
});

test('workflow_run 補收尾只在鎖還在、finalize 沒成功時介入', () => {
  const locked = { issueState: 'open', labels: ['agent-working'], otherActiveRuns: 0 };
  assert.equal(flow.evaluateBackstop({ ...locked, jobs: [{ name: 'claude', conclusion: 'skipped' }] }).code, 'not-locked');
  assert.equal(flow.evaluateBackstop({ ...locked, jobs: [{ name: 'claude', conclusion: 'success' }, { name: 'finalize', conclusion: 'success' }] }).code, 'finalized');
  assert.equal(flow.evaluateBackstop({ ...locked, labels: ['blocked'], jobs: [{ name: 'claude', conclusion: 'cancelled' }] }).code, 'no-lock');
  assert.equal(flow.evaluateBackstop({ ...locked, otherActiveRuns: 1, jobs: [{ name: 'claude', conclusion: 'cancelled' }] }).code, 'active');
  assert.equal(flow.evaluateBackstop({ ...locked, jobs: [{ name: 'claude', conclusion: 'cancelled' }, { name: 'finalize', conclusion: 'cancelled' }] }).act, true);
});

/**
 * 假的 GitHub client：記錄呼叫，不連網。heads 可用陣列模擬「每次讀取的 head 不同」。
 * @param {Record<string, any>} state
 */
function fakeGitHub(state) {
  /** @type {any[][]} */
  const calls = [];
  const issue = { state: 'open', title: '測試', body: 'Validation profile: workflow', labels: ['agent-working'], isPullRequest: false, ...state.issue };
  /** @type {Record<string, any>} */
  const gh = {
    calls,
    permission: async () => state.permission ?? 'write',
    issue: async () => issue,
    pull: async () => state.pull ?? null,
    openPullHeads: async () => state.openPullHeads ?? [],
    findOpenPull: async (/** @type {string} */ branch) => state.pulls?.[branch] ?? null,
    branchHead: async (/** @type {string} */ branch) => {
      const heads = state.heads?.[branch];
      return Array.isArray(heads) ? (heads.length > 1 ? heads.shift() : heads[0]) : heads ?? null;
    },
    compare: async () => ({ aheadBy: state.aheadBy ?? 3, mergeBase: BASE }),
    commitMessage: async (/** @type {string} */ sha) => state.messages?.[sha] ?? '',
    createPull: async (/** @type {any} */ input) => {
      calls.push(['createPull', input]);
      if (state.createPullError) throw new Error(state.createPullError);
      return { number: 42, draft: input.draft, url: 'https://example.invalid/pull/42', nodeId: 'PR_42' };
    },
    markReady: async (/** @type {string} */ id) => {
      calls.push(['markReady', id]);
      if (state.markReadyError) throw new Error(state.markReadyError);
    },
    markDraft: async (/** @type {string} */ id) => calls.push(['markDraft', id]),
    addLabels: async (/** @type {number} */ number, /** @type {string[]} */ labels) => calls.push(['addLabels', number, labels]),
    removeLabel: async (/** @type {number} */ number, /** @type {string} */ label) => calls.push(['removeLabel', number, label]),
    comment: async (/** @type {number} */ number, /** @type {string} */ body) => calls.push(['comment', number, body]),
    run: async () => state.run ?? null,
    runJobs: async () => state.jobs ?? [{ name: 'claude', conclusion: 'success' }],
    activeRuns: async () => state.activeRuns ?? [],
  };
  return gh;
}

const RESUME = 'claude/issue-5-20261007-0026';
const resumePr = { number: 42, draft: true, url: '', nodeId: 'PR42', state: 'open', merged: false,
  headRepo: 'owner/repo', baseRepo: 'owner/repo', base: 'main', branch: RESUME, sha: SHA, body: 'Refs #5\n' };
const resumeInput = { actorPermission: 'write', ref: 'refs/heads/main', defaultBranch: 'main', repo: 'owner/repo',
  issue: 5, issueState: 'open', isPullRequest: false, labels: ['blocked'], activeRuns: 0, runAttempt: 1,
  pr: resumePr, inputSha: SHA, branchSha: SHA, remaining: '只修原 Issue 的收尾與測試' };
test('續做：固定 PR/head 正確才放行，保留原分支', () => {
  assert.equal(flow.evaluateResumeGuard(resumeInput).proceed, true);
  assert.equal(flow.checkRunBranch({ issue: 5, runId: 999, resumeBranch: RESUME }).branch, RESUME);
  assert.equal(flow.checkRunBranch({ issue: 5, runId: 999, resumeBranch: 'claude/issue-4-test' }).ok, false);
  assert.equal(flow.checkRunBranch({ issue: 5, runId: 999, resumeBranch: RESUME, actionBranch: 'main' }).ok, false);
});
for (const [name, overrides] of Object.entries({
  actor: { actorPermission: 'read' }, ref: { ref: 'refs/heads/unsafe' }, closed: { issueState: 'closed' },
  approved: { labels: ['approved'] }, revision: { labels: ['revision-requested'] }, active: { activeRuns: 1 },
  lock: { labels: ['agent-working'] }, rerun: { runAttempt: 2 }, missing: { pr: null },
  merged: { pr: { ...resumePr, merged: true } }, closedPr: { pr: { ...resumePr, state: 'closed' } },
  fork: { pr: { ...resumePr, headRepo: 'outsider/repo' } }, base: { pr: { ...resumePr, base: 'release' } },
  wrongIssue: { pr: { ...resumePr, branch: 'claude/issue-4-test' } },
  link: { pr: { ...resumePr, body: 'Refs #55' } }, stalePr: { pr: { ...resumePr, sha: OTHER_SHA } },
  staleBranch: { branchSha: OTHER_SHA }, malformed: { inputSha: 'HEAD' }, empty: { remaining: ' ' },
})) test(`續做拒絕：${name}`, () => assert.equal(flow.evaluateResumeGuard({ ...resumeInput, ...overrides }).proceed, false));

const silent = { setOutput() {}, summary() {}, log() {} };
const RUN_ID = '777';
const BRANCH = flow.expectedBranch(5, RUN_ID) ?? '';
const baseEnv = { ISSUE: '5', GITHUB_RUN_ID: RUN_ID, GITHUB_REPOSITORY: 'owner/repo', DEFAULT_BRANCH: 'main' };
const completeMessage = 'Checkpoint:\n- Completed: 全部\n\nKodeBart-Issue: 5\nKodeBart-Delivery: complete';
/** @param {any} gh @param {string} name */
const callsOf = (gh, name) => gh.calls.filter((/** @type {any[]} */ call) => call[0] === name);

test('續做入口：沿用固定 PR/head、原 Issue 鎖及明示 Remaining，不建立 PR／分支', async () => {
  const gh = fakeGitHub({ issue: { labels: ['blocked', 'human-review'] }, pull: resumePr, heads: { [RESUME]: SHA } });
  const outputs = /** @type {Record<string, string>} */ ({});
  const env = { ...baseEnv, INPUT_ISSUE: '5', INPUT_PR: '42', INPUT_SHA: SHA, INPUT_REMAINING: '補收尾測試', ACTOR: 'human', GITHUB_REF: 'refs/heads/main' };
  const verdict = await resumeGuard({ env, gh: /** @type {any} */ (gh), out: { ...silent, setOutput: (name, value) => { outputs[name] = String(value); } } });
  assert.equal(verdict.proceed, true);
  assert.equal(outputs.branch, RESUME);
  assert.equal(outputs.proceed, 'true');
  assert.deepEqual(callsOf(gh, 'addLabels'), [['addLabels', 5, ['agent-working']]]);
  assert.equal(callsOf(gh, 'createPull').length, 0);
  assert.match(callsOf(gh, 'comment')[0][2], /補收尾測試/);
});

test('續做入口：過期 SHA 不修改任何標籤／留言', async () => {
  const gh = fakeGitHub({ issue: { labels: ['blocked'] }, pull: resumePr, heads: { [RESUME]: OTHER_SHA } });
  await assert.rejects(resumeGuard({ env: { ...baseEnv, INPUT_ISSUE: '5', INPUT_PR: '42', INPUT_SHA: SHA, INPUT_REMAINING: '修正', ACTOR: 'human', GITHUB_REF: 'refs/heads/main' }, gh: /** @type {any} */ (gh), out: silent }));
  assert.equal(gh.calls.length, 0);
});

test('續做 collect/finalize：不是新 run 分支，沿原 PR 驗證新 head 與收尾', async () => {
  const gh = fakeGitHub({ heads: { [RESUME]: SHA }, pulls: { [RESUME]: resumePr }, messages: { [SHA]: completeMessage } });
  const env = { ...baseEnv, RESUME_BRANCH: RESUME, ACTION_BRANCH: RESUME, CLAUDE_OUTCOME: 'success', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'success', SNAPSHOT_SHA: SHA, VERIFY_RESULTS: JSON.stringify(VERIFICATIONS.$workflowPass) };
  assert.equal((await collect({ env, gh: /** @type {any} */ (gh), out: silent })).head, SHA);
  const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.pr?.number, 42);
  assert.equal(result.decision.label, 'human-review');
  assert.equal(callsOf(gh, 'createPull').length, 0);
});

test('續做 backstop：取消且鎖還在，可信 run/PR 才沿原分支 blocked，不執行 artifact', async () => {
  const run = { event: 'workflow_dispatch', path: '.github/workflows/claude-resume.yml', repository: { full_name: 'owner/repo' } };
  const jobs = [{ name: 'guard', conclusion: 'success' }, { name: 'claude', conclusion: 'cancelled' }];
  const gh = fakeGitHub({ run, jobs, pull: resumePr, heads: { [RESUME]: SHA }, pulls: { [RESUME]: resumePr } });
  const env = { ...baseEnv, TARGET_RUN_ID: '888', TARGET_TITLE: 'claude-resume-issue-5-pr-42' };
  const result = await backstop({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.acted, true);
  assert.deepEqual(callsOf(gh, 'addLabels'), [['addLabels', 5, ['blocked']]]);
  const outsider = fakeGitHub({ run, jobs, pull: { ...resumePr, headRepo: 'fork/repo' } });
  assert.equal((await backstop({ env, gh: /** @type {any} */ (outsider), out: silent })).acted, false);
  assert.equal(outsider.calls.length, 0);
});

test('續做 workflow：固定head checkout、guard branch、explicit prompt、共用鎖與模型限制', () => {
  const yaml = readFileSync(join(ROOT, '.github/workflows/claude-resume.yml'), 'utf8');
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /group: claude-issue-\$\{\{ inputs.issue \}\}/);
  assert.match(yaml, /CLAUDE_BRANCH: \$\{\{ needs.guard.outputs.branch \}\}/);
  assert.match(yaml, /ref: \$\{\{ inputs.sha \}\}/);
  assert.match(yaml, /resume-guard/);
  assert.match(yaml, /prompt: \|/);
  assert.match(yaml, /--max-turns 80/);
  assert.match(yaml, /timeout-minutes: 60/);
  assert.match(yaml, /RESUME_BRANCH:/);
  assert.doesNotMatch(yaml, /branch_name_template:/);
});

test('驗證log：原始輸出與exit/SHA留存，artifact固定版本，只列指定驗證log', () => {
  const yaml = readFileSync(join(ROOT, '.github/workflows/agent-verify.yml'), 'utf8');
  assert.match(yaml, /code=\$\{PIPESTATUS\[0\]\}/);
  assert.match(yaml, /exit=%s/);
  assert.match(yaml, /sha=%s/);
  assert.match(yaml, /upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(yaml, /verify-product-\$\{\{ inputs.sha \}\}/);
  assert.doesNotMatch(yaml, /execution_file|EXEC_FILE|runner.temp \}\}\/\*/);
});

test('SDK success 卻超過80回合，不能視為正常完成', () => {
  assert.equal(flow.classifyStop({ stepOutcome: 'success', execPresent: true, execSubtype: 'success', execTurns: '127' }).reason, 'max_turns');
  assert.equal(flow.classifyStop({ stepOutcome: 'success', execPresent: true, execSubtype: 'success', execTurns: '80' }).reason, 'none');
});

test('finalize：完整交付＋同 SHA 全過 → 先建 draft PR，最後重讀 head 相同才標 ready 與 human-review', async () => {
  const gh = fakeGitHub({ heads: { [BRANCH]: SHA }, messages: { [SHA]: completeMessage } });
  const env = { ...baseEnv, CLAUDE_OUTCOME: 'success', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'success', SNAPSHOT_SHA: SHA, VERIFY_RESULTS: JSON.stringify(VERIFICATIONS.$workflowPass) };
  const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.decision.label, 'human-review');
  assert.equal(callsOf(gh, 'createPull').length, 1);
  assert.equal(callsOf(gh, 'createPull')[0][1].draft, true);
  assert.equal(callsOf(gh, 'markReady').length, 1);
  assert.deepEqual(callsOf(gh, 'addLabels')[0], ['addLabels', 5, ['human-review']]);
});

test('finalize：CI 之後 branch head 改變 → blocked，不標 ready', async () => {
  const gh = fakeGitHub({ heads: { [BRANCH]: [SHA, OTHER_SHA] }, messages: { [SHA]: completeMessage } });
  const env = { ...baseEnv, CLAUDE_OUTCOME: 'success', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'success', SNAPSHOT_SHA: SHA, VERIFY_RESULTS: JSON.stringify(VERIFICATIONS.$workflowPass) };
  const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.decision.status, 'stale-head');
  assert.equal(callsOf(gh, 'markReady').length, 0);
  assert.deepEqual(callsOf(gh, 'addLabels')[0], ['addLabels', 5, ['blocked']]);
});

test('finalize：已存在 PR 時沿用，不重複建立', async () => {
  const gh = fakeGitHub({ heads: { [BRANCH]: SHA }, pulls: { [BRANCH]: { number: 9, draft: true, url: '', nodeId: 'PR_9' } } });
  const env = { ...baseEnv, CLAUDE_OUTCOME: 'failure', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'error_max_turns', EXEC_TURNS: '81', SNAPSHOT_SHA: SHA };
  const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.decision.stop.reason, 'max_turns');
  assert.equal(result.pr?.number, 9);
  assert.equal(callsOf(gh, 'createPull').length, 0);
  assert.match(callsOf(gh, 'comment')[0][2], /81 turns/);
});

test('finalize：沒有提交 → blocked，不建空 PR', async () => {
  const gh = fakeGitHub({ heads: {} });
  const result = await finalize({ env: { ...baseEnv, CLAUDE_OUTCOME: 'success', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'success' }, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.decision.status, 'no-commits');
  assert.equal(callsOf(gh, 'createPull').length, 0);
  assert.deepEqual(callsOf(gh, 'addLabels')[0], ['addLabels', 5, ['blocked']]);
});

test('finalize：Action 回報其他分支 → 不回收、不建 PR', async () => {
  const gh = fakeGitHub({ heads: { [BRANCH]: SHA, 'claude/issue-4-run777': SHA } });
  const env = { ...baseEnv, ACTION_BRANCH: 'claude/issue-4-run777', CLAUDE_OUTCOME: 'success', SNAPSHOT_SHA: SHA };
  const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.decision.status, 'uncertain-branch');
  assert.equal(callsOf(gh, 'createPull').length, 0);
});

test('Issue 入口：取得執行鎖時移除 claude-ready 與上一輪的 blocked，只留 agent-working', async () => {
  const gh = fakeGitHub({ issue: { labels: ['claude-ready', 'blocked', 'bug'] } });
  const verdict = await issueGuard({ env: { ...baseEnv, ACTOR: 'human', GITHUB_RUN_ATTEMPT: '1' }, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(verdict.proceed, true);
  assert.deepEqual(callsOf(gh, 'removeLabel').map((/** @type {any[]} */ call) => call[2]).sort(), ['blocked', 'claude-ready']);
  assert.deepEqual(callsOf(gh, 'addLabels'), [['addLabels', 5, ['agent-working']]]);
  assert.equal(callsOf(gh, 'comment').length, 0);
});

test('finalize：draft PR 建立失敗仍照常收尾（blocked＋留言附註），不中斷', async () => {
  const gh = fakeGitHub({ heads: { [BRANCH]: SHA }, createPullError: 'GitHub API POST /repos/owner/repo/pulls → 403 GitHub Actions is not permitted to create or approve pull requests.' });
  const env = { ...baseEnv, CLAUDE_OUTCOME: 'failure', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'error_max_turns', EXEC_TURNS: '81', SNAPSHOT_SHA: SHA };
  const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.pr, null);
  assert.equal(result.decision.label, 'blocked');
  assert.deepEqual(callsOf(gh, 'addLabels')[0], ['addLabels', 5, ['blocked']]);
  const body = callsOf(gh, 'comment')[0][2];
  assert.match(body, /PR：沒有建立/);
  assert.match(body, /draft PR 建立失敗/);
  assert.match(body, /Allow GitHub Actions to create and approve pull requests/);
});

for (const failure of ['createPullError', 'markReadyError']) {
  test(`finalize：同 SHA 全綠但 ${failure} → blocked、釋放鎖及留言，不宣稱完成`, async () => {
    const gh = fakeGitHub({ heads: { [BRANCH]: SHA }, messages: { [SHA]: completeMessage }, [failure]: '403 forbidden' });
    const env = { ...baseEnv, CLAUDE_OUTCOME: 'success', EXEC_PRESENT: 'true', EXEC_SUBTYPE: 'success', SNAPSHOT_SHA: SHA, VERIFY_RESULTS: JSON.stringify(VERIFICATIONS.$workflowPass) };
    const result = await finalize({ env, gh: /** @type {any} */ (gh), out: silent });
    assert.equal(result.decision.status, 'pr-unavailable');
    assert.equal(result.decision.label, 'blocked');
    assert.equal(result.decision.verification.state, 'pass');
    assert.deepEqual(callsOf(gh, 'removeLabel'), [['removeLabel', 5, 'agent-working']]);
    assert.deepEqual(callsOf(gh, 'addLabels'), [['addLabels', 5, ['blocked']]]);
    assert.equal(callsOf(gh, 'comment').length, 1);
    if (result.pr) assert.equal(result.pr.draft, true);
  });
}

test('Issue 入口：revision-requested 未移除時拒絕，不清除 Human 狀態、不取得鎖', async () => {
  const gh = fakeGitHub({ issue: { labels: ['claude-ready', 'revision-requested', 'blocked'] } });
  const verdict = await issueGuard({ env: { ...baseEnv, ACTOR: 'human' }, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(verdict.code, 'revision');
  assert.equal(verdict.proceed, false);
  assert.deepEqual(callsOf(gh, 'removeLabel'), [['removeLabel', 5, 'claude-ready']]);
  assert.equal(callsOf(gh, 'addLabels').length, 0);
});

test('verify-only：draft PR 建立失敗仍留言附註，不變更標籤', async () => {
  const branch = 'claude/issue-2-20261001-0501';
  const gh = fakeGitHub({ issue: { labels: ['blocked'] }, heads: { [branch]: SHA }, messages: { [SHA]: '' }, createPullError: '403 forbidden' });
  const env = { ...baseEnv, INPUT_ISSUE: '2', INPUT_BRANCH: branch, INPUT_SHA: SHA, VERIFY_RESULTS: JSON.stringify(VERIFICATIONS.$workflowPass) };
  const result = await verifyOnlyReport({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.pr, null);
  assert.equal(result.decision.label, null);
  assert.equal(callsOf(gh, 'addLabels').length + callsOf(gh, 'removeLabel').length, 0);
  assert.match(callsOf(gh, 'comment')[0][2], /draft PR 建立失敗/);
});

test('Issue 入口：重複派發只留言，不加 agent-working', async () => {
  const gh = fakeGitHub({ issue: { labels: ['blocked'] } });
  const verdict = await issueGuard({ env: { ...baseEnv, ACTOR: 'human', GITHUB_RUN_ATTEMPT: '1' }, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(verdict.code, 'duplicate');
  assert.equal(callsOf(gh, 'addLabels').length, 0);
  assert.equal(callsOf(gh, 'comment').length, 1);
});

test('verify-only：全綠仍不變更標籤、不標 ready，舊的失敗 run 不會變成完成', async () => {
  const branch = 'claude/issue-2-20261001-0501';
  const gh = fakeGitHub({ issue: { labels: ['blocked'] }, heads: { [branch]: SHA }, messages: { [SHA]: '' } });
  const env = { ...baseEnv, INPUT_ISSUE: '2', INPUT_BRANCH: branch, INPUT_SHA: SHA, VERIFY_RESULTS: JSON.stringify(VERIFICATIONS.$workflowPass) };
  const result = await verifyOnlyReport({ env, gh: /** @type {any} */ (gh), out: silent });
  assert.equal(result.decision.status, 'verified-only');
  assert.equal(result.decision.label, null);
  assert.equal(callsOf(gh, 'addLabels').length, 0);
  assert.equal(callsOf(gh, 'removeLabel').length, 0);
  assert.equal(callsOf(gh, 'markReady').length, 0);
  assert.equal(callsOf(gh, 'createPull')[0][1].draft, true);
  assert.match(callsOf(gh, 'comment')[0][2], /不代表先前的模型 run 已完成/);
});

test('backstop：finalize 已成功 → 不介入；逾時且鎖還在 → draft PR＋blocked', async () => {
  const run = { event: 'issues', path: '.github/workflows/claude.yml', repository: { full_name: 'owner/repo' } };
  const done = fakeGitHub({ run, jobs: [{ name: 'claude', conclusion: 'success' }, { name: 'finalize', conclusion: 'success' }] });
  const env = { ...baseEnv, TARGET_RUN_ID: RUN_ID, TARGET_TITLE: 'claude-issue-5' };
  assert.equal((await backstop({ env, gh: /** @type {any} */ (done), out: silent })).acted, false);
  assert.equal(done.calls.length, 0);
  const jobs = [{ name: 'claude', conclusion: 'cancelled', started_at: '2026-10-07T00:00:00Z', completed_at: '2026-10-07T01:00:05Z' }];
  const stuck = fakeGitHub({ run, jobs, heads: { [BRANCH]: SHA }, messages: { [SHA]: completeMessage } });
  const result = /** @type {any} */ (await backstop({ env, gh: /** @type {any} */ (stuck), out: silent }));
  assert.equal(result.acted, true);
  assert.equal(result.decision?.stop.reason, 'timeout');
  assert.equal(result.decision?.label, 'blocked');
  assert.equal(callsOf(stuck, 'createPull')[0][1].draft, true);
  const foreign = fakeGitHub({ run: { ...run, repository: { full_name: 'someone/else' } }, jobs });
  assert.equal((await backstop({ env, gh: /** @type {any} */ (foreign), out: silent })).code, 'untrusted');
});

test('GitHub client 沒有推送、改寫 ref、合併、關閉 Issue 或 dispatch 的能力', () => {
  const client = createGitHub({ token: 'x', repo: 'owner/repo', fetchImpl: /** @type {any} */ (async () => ({})) });
  for (const name of Object.keys(client)) assert.doesNotMatch(name, /push|merge|ref|dispatch|close|delete|update/i, name);
});

/** 已移入 .github/workflows/ 的 workflow 檔。 @param {string} name */
const workflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

/** 每個 checkout 步驟都必須 persist-credentials: false。 @param {string} text */
function checkoutsWithoutCredentials(text) {
  return text.split(/\n\s+- name: /).filter((step) => step.includes('actions/checkout@')).every((step) => /persist-credentials: false/.test(step));
}

test('verify-only workflow：不呼叫模型、沒有 secrets、不能寫分支、不碰 human-review', () => {
  const text = workflow('agent-verify-only.yml');
  assert.doesNotMatch(text, /claude-code-action/);
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /contents: write/);
  assert.doesNotMatch(text, /git push/);
  assert.match(text, /group: claude-issue-\$\{\{ inputs\.issue \}\}/);
  assert.ok(checkoutsWithoutCredentials(text));
});

test('驗證 workflow：只讀、沒有 secrets、checkout 不保留憑證', () => {
  const text = workflow('agent-verify.yml');
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /: write/);
  assert.ok(checkoutsWithoutCredentials(text));
  for (const step of ['npm ci', 'tsc -p tsconfig.app.json --noEmit', 'tsc -p tsconfig.spec.json --noEmit', 'ng build', 'ng test --watch=false --browsers=ChromeHeadless']) {
    assert.ok(text.includes(step), step);
  }
});

test('workflow_run 收尾：不呼叫模型、沒有 secrets、不能寫分支', () => {
  const text = workflow('agent-finalizer.yml');
  assert.doesNotMatch(text, /claude-code-action/);
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /contents: write/);
  assert.ok(checkoutsWithoutCredentials(text));
});

test('claude.yml：模型、effort、80 回合、60 分鐘不變；驗證不拿 secrets；分支名稱固定', () => {
  const text = workflow('claude.yml');
  for (const fixed of ['--model claude-opus-5-5', '--effort max', '--max-turns 80', 'timeout-minutes: 60']) assert.ok(text.includes(fixed), fixed);
  assert.match(text, /branch_name_template: "\{\{prefix\}\}\{\{entityType\}\}-\{\{entityNumber\}\}-run\$\{\{ github\.run_id \}\}"/);
  assert.doesNotMatch(text, /secrets: inherit/);
  assert.equal((text.match(/secrets\./g) ?? []).length, 2);
});

test('收尾只會設定 human-review 或 blocked（verify-only 不變更），從不設定 approved', () => {
  for (const scenario of fixtures.decideFinal) {
    const { label } = flow.decideFinal(resolve(scenario.input));
    assert.ok(label === 'human-review' || label === 'blocked' || label === null, scenario.name);
  }
});
