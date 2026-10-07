// KodeBart Agent 工作流程 v1.1 階段 A 的純判定函式（不做 I/O）。
// workflow 把 GitHub 上讀到的事實交給這裡，這裡回傳執行鎖、PR、標籤與回報的決定。
// 離線測試：node --test .github/scripts/tests/*.test.mjs

export const WRITE_PERMISSIONS = Object.freeze(['admin', 'maintain', 'write']);
export const JOB_TIMEOUT_MINUTES = 60;

const ISSUE_RE = /^[1-9][0-9]{0,9}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[1-9][0-9]{0,19}$/;
const BRANCH_TAIL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** @param {unknown} value @returns {number | null} */
export function parseIssueNumber(value) {
  const text = String(value ?? '').trim().replace(/^#/, '');
  return ISSUE_RE.test(text) ? Number(text) : null;
}

/** @param {unknown} value */
export function isSha(value) {
  return typeof value === 'string' && SHA_RE.test(value);
}

/** 本輪分支名稱由 claude.yml 的 branch_name_template 固定，不從遠端搜尋。 */
export function expectedBranch(/** @type {unknown} */ issue, /** @type {unknown} */ runId) {
  const number = parseIssueNumber(issue);
  const id = String(runId ?? '');
  return number === null || !RUN_ID_RE.test(id) ? null : `claude/issue-${number}-run${id}`;
}

/** 只接受 claude/issue-<編號>-… ；預設分支、其他 Issue 的分支都不是。 */
export function isIssueBranch(/** @type {unknown} */ branch, /** @type {unknown} */ issue) {
  const number = parseIssueNumber(issue);
  if (number === null || typeof branch !== 'string') return false;
  const prefix = `claude/issue-${number}-`;
  if (!branch.startsWith(prefix)) return false;
  const tail = branch.slice(prefix.length);
  return BRANCH_TAIL_RE.test(tail) && !tail.includes('..') && !tail.endsWith('.lock') && !tail.endsWith('.');
}

/** @param {string} code @param {string} reason */
function reject(code, reason) {
  return { proceed: false, code, reason };
}

const PROCEED = Object.freeze({ proceed: true, code: 'ok', reason: '' });

/**
 * Issue 入口（claude-ready）的開跑檢查。
 * @param {{ actorPermission: string, issueState: string, labels: string[], triggerLabelPresent: boolean,
 *   openClaudePrs: number, runAttempt: number }} input
 */
export function evaluateIssueGuard(input) {
  const { actorPermission, issueState, labels, triggerLabelPresent, openClaudePrs, runAttempt } = input;
  if (!WRITE_PERMISSIONS.includes(actorPermission)) return reject('actor', '加上 claude-ready 的帳號沒有 repository write 權限。');
  if (issueState !== 'open') return reject('closed', 'Issue 已關閉。');
  if (labels.includes('approved')) return reject('approved', 'Issue 已標記 approved，不再派發。');
  if (labels.includes('agent-working')) return reject('active', '這張 Issue 已有 agent-working（執行中或鎖未釋放），不重複執行。');
  if (labels.includes('human-review')) return reject('review', '這張 Issue 已在 human-review，需由 Human 決定後再重新派發。');
  if (runAttempt !== 1) return reject('rerun', '不支援重跑同一個 run；需要重新執行時請由 Human 重新加上 claude-ready。');
  if (!triggerLabelPresent) return reject('duplicate', 'claude-ready 已不在這張 Issue 上（重複事件或已由其他 run 取用）。');
  if (openClaudePrs > 0) return reject('open-pr', '這張 Issue 已有未結束的 Claude PR，不再開新分支。');
  return PROCEED;
}

/**
 * 「只驗證」入口（workflow_dispatch）的開跑檢查。
 * @param {{ actorPermission: string, ref: string, defaultBranch: string, issue: unknown, issueState: string | null,
 *   isPullRequest: boolean, labels: string[], activeRuns: number, branch: string, inputSha: string,
 *   branchSha: string | null, aheadBy: number }} input
 */
export function evaluateVerifyOnlyGuard(input) {
  const { actorPermission, ref, defaultBranch, issue, issueState, isPullRequest, labels, activeRuns, branch, inputSha, branchSha, aheadBy } = input;
  if (!WRITE_PERMISSIONS.includes(actorPermission)) return reject('actor', '啟動者沒有 repository write 權限。');
  if (ref !== `refs/heads/${defaultBranch}`) return reject('ref', `只能從預設分支 ${defaultBranch} 的 workflow 啟動。`);
  if (parseIssueNumber(issue) === null) return reject('issue', 'Issue 編號格式不正確。');
  if (issueState === null || isPullRequest) return reject('issue', '找不到這張 Issue（或編號是 PR）。');
  if (issueState !== 'open') return reject('closed', 'Issue 已關閉。');
  if (labels.includes('approved')) return reject('approved', 'Issue 已標記 approved，不再回收或驗證。');
  if (labels.includes('agent-working')) return reject('active', 'Issue 仍有 agent-working（執行中或鎖未釋放）。');
  if (activeRuns > 0) return reject('active', '同一 Issue 仍有執行中或排隊中的 Claude／verify-only run。');
  if (!isIssueBranch(branch, issue)) return reject('branch', `branch 必須是 claude/issue-${parseIssueNumber(issue)}-…；不接受預設分支或其他 Issue 的分支。`);
  if (!isSha(inputSha)) return reject('sha', '固定 SHA 必須是 40 碼小寫十六進位。');
  if (!branchSha) return reject('branch', '遠端找不到這個 branch。');
  if (branchSha !== inputSha) return reject('stale', `SHA 已過期：branch head 目前是 ${branchSha}。`);
  if (!(aheadBy > 0)) return reject('no-commits', 'branch 相對預設分支沒有提交。');
  return PROCEED;
}

/**
 * 確認本輪分支：Action 輸出（若有）必須等於固定名稱；輸出缺失時以固定名稱為準。
 * @param {{ issue: unknown, runId: unknown, actionBranch?: string }} input
 */
export function checkRunBranch({ issue, runId, actionBranch = '' }) {
  const expected = expectedBranch(issue, runId);
  if (!expected) return { ok: false, branch: '', reason: '無法由 Issue 編號與 run id 確定本輪分支。' };
  if (actionBranch && actionBranch !== expected) {
    return { ok: false, branch: '', reason: `Action 回報的分支（${actionBranch}）不是本輪預期的 ${expected}；不回收不確定的分支。` };
  }
  return { ok: true, branch: expected, reason: '' };
}

/**
 * 模型停止原因：max_turns、timeout、environment、unknown；正常結束為 none。只依據實際證據，不推測完成程度。
 * @param {{ stepOutcome?: string, actionConclusion?: string, execPresent?: boolean, execSubtype?: string,
 *   jobConclusion?: string, jobMinutes?: number | null, timeoutMinutes?: number }} input
 */
export function classifyStop(input) {
  const { stepOutcome = '', actionConclusion = '', execPresent = false, execSubtype = '', jobConclusion = '', jobMinutes = null, timeoutMinutes = JOB_TIMEOUT_MINUTES } = input;
  if (execSubtype === 'error_max_turns') return { reason: 'max_turns', detail: '達到回合上限（error_max_turns）' };
  if (jobConclusion === 'timed_out') return { reason: 'timeout', detail: `job 逾時（${timeoutMinutes} 分鐘上限）` };
  const interrupted = stepOutcome === 'cancelled' || jobConclusion === 'cancelled' || (stepOutcome === '' && jobConclusion === 'failure');
  if (interrupted && jobMinutes !== null && jobMinutes >= timeoutMinutes - 1) {
    return { reason: 'timeout', detail: `job 執行 ${Math.floor(jobMinutes)} 分鐘後中止（${timeoutMinutes} 分鐘上限）` };
  }
  if (interrupted) return { reason: 'unknown', detail: 'run 被取消或中止，無法判定原因' };
  if (stepOutcome === 'success') return { reason: 'none', detail: '' };
  if (stepOutcome === 'failure' && !execPresent && !actionConclusion) {
    return { reason: 'environment', detail: 'Action 在模型產生輸出前失敗（認證、權限或執行環境）' };
  }
  if (stepOutcome === 'failure') return { reason: 'unknown', detail: execSubtype ? `模型結束狀態：${execSubtype}` : '模型步驟失敗，沒有可判定的輸出' };
  return { reason: 'unknown', detail: '沒有模型步驟的結果（execution output 缺失）' };
}

const TRAILER_RE = /^KodeBart-(Issue|Delivery):[ \t]*(\S+)[ \t]*$/gm;

/**
 * head commit 的完成標記。只有 trailer 的 Issue 與本 Issue 相同時才採信；其餘一律 missing。
 * @param {string} message @param {unknown} issue
 */
export function parseDelivery(message, issue) {
  const text = String(message ?? '');
  /** @type {Record<string, string>} */
  const trailers = {};
  for (const match of text.matchAll(TRAILER_RE)) trailers[match[1].toLowerCase()] = match[2];
  const trailerIssue = parseIssueNumber(trailers.issue);
  const sameIssue = trailerIssue !== null && trailerIssue === parseIssueNumber(issue);
  const declared = trailers.delivery;
  const delivery = sameIssue && (declared === 'complete' || declared === 'checkpoint') ? declared : 'missing';
  return { delivery, checkpoint: extractCheckpoint(text) };
}

/** commit 訊息中 `Checkpoint:` 以下的 Agent 自述（未經驗證，只做引用）。 @param {string} message */
export function extractCheckpoint(message) {
  const text = String(message ?? '');
  const start = text.search(/^Checkpoint:?[ \t]*$/m);
  if (start < 0) return '';
  return text.slice(start).replace(/^KodeBart-(Issue|Delivery):.*$/gm, '').trim().slice(0, 3000);
}

/** @param {string} path @returns {'workflow' | 'rules' | 'docs' | 'product'} */
export function categorizePath(path) {
  if (path.startsWith('.github/')) return 'workflow';
  if (path === 'CLAUDE.md' || path.startsWith('doc/agent-workflow/')) return 'rules';
  if (path.startsWith('doc/') || /^[^/]+\.md$/.test(path)) return 'docs';
  return 'product';
}

/** @type {Record<string, string[]>} */
const PROFILE_ALLOWS = { product: ['product'], workflow: ['workflow', 'rules'], docs: ['docs', 'rules'] };

/** Issue 宣告的 Validation profile；只能收窄允許路徑，不能略過檢查。 @param {string} body */
export function parseDeclaredProfile(body) {
  const match = String(body ?? '').match(/^[ \t>*-]*Validation profile:[ \t]*`?(product|workflow|docs)`?[ \t]*$/im);
  return match ? match[1].toLowerCase() : '';
}

/**
 * 依實際 diff 路徑決定必跑檢查，並比對宣告 profile 的允許路徑。
 * @param {string[]} files @param {string} [declaredProfile]
 */
export function planChecks(files, declaredProfile = '') {
  /** @type {Record<string, string[]>} */
  const categories = { product: [], workflow: [], rules: [], docs: [] };
  for (const file of files) categories[categorizePath(file)].push(file);
  const allowed = PROFILE_ALLOWS[declaredProfile] ?? null;
  const violations = allowed ? files.filter((file) => !allowed.includes(categorizePath(file))) : [];
  return {
    declaredProfile: allowed ? declaredProfile : '',
    product: categories.product.length > 0,
    workflow: categories.workflow.length > 0,
    files,
    categories,
    violations,
  };
}

/** @typedef {ReturnType<typeof planChecks>} CheckPlan */

export const CHECKS = Object.freeze([
  { id: 'npm-ci', group: 'product', label: 'npm ci' },
  { id: 'tsc-app', group: 'product', label: 'tsc -p tsconfig.app.json --noEmit' },
  { id: 'tsc-spec', group: 'product', label: 'tsc -p tsconfig.spec.json --noEmit' },
  { id: 'ng-build', group: 'product', label: 'ng build（production，零警告）' },
  { id: 'ng-test', group: 'product', label: 'ng test --watch=false --browsers=ChromeHeadless' },
  { id: 'actionlint', group: 'workflow', label: 'actionlint' },
  { id: 'flow-tests', group: 'workflow', label: 'node --test .github/scripts/tests' },
  { id: 'diff-check', group: 'docs', label: 'git diff --check' },
  { id: 'doc-refs', group: 'docs', label: '文件路徑引用一致性' },
]);

/** @param {{ product: boolean, workflow: boolean }} plan */
export function scopeName(plan) {
  return plan.product ? 'product' : plan.workflow ? 'workflow-only' : 'docs-only';
}

/**
 * 把各檢查步驟的 outcome（success／failure／skipped／cancelled／空）整理成綁定 SHA 的結果。
 * @param {{ sha: string, plan: CheckPlan, outcomes: Record<string, string> }} input
 */
export function summarizeChecks({ sha, plan, outcomes }) {
  const scope = scopeName(plan);
  const checks = CHECKS.map((check) => {
    const required = check.group === 'product' ? plan.product : check.group === 'workflow' ? plan.workflow : true;
    const outcome = outcomes[check.id] ?? '';
    if (!required) {
      const note = `${scope}：沒有${check.group === 'product' ? '產品' : ' workflow '}路徑變更`;
      return { ...check, required, result: 'NOTRUN', note };
    }
    if (outcome === 'success') return { ...check, required, result: 'PASS', note: '' };
    if (outcome === 'failure') return { ...check, required, result: 'FAIL', note: '' };
    return { ...check, required, result: 'NOTRUN', note: outcome === 'cancelled' ? '已取消' : '前置步驟失敗或沒有執行' };
  });
  return { sha, scope, declaredProfile: plan.declaredProfile, violations: plan.violations, checks };
}

/** @typedef {ReturnType<typeof summarizeChecks>} Verification */
/** @typedef {Verification['checks'][number]} CheckResult */

/**
 * 驗證結果只在綁定同一 SHA 時有效。
 * @param {Verification | null} verification @param {string} sha
 */
export function evaluateVerification(verification, sha) {
  /** @type {CheckResult[]} */ const pass = [];
  /** @type {CheckResult[]} */ const fail = [];
  /** @type {CheckResult[]} */ const notrun = [];
  /** @type {CheckResult[]} */ const requiredNotRun = [];
  if (!verification || !Array.isArray(verification.checks)) {
    return { state: 'pending', bound: false, pass, fail, notrun, requiredNotRun, violations: /** @type {string[]} */ ([]) };
  }
  for (const check of verification.checks) {
    if (check.result === 'PASS') pass.push(check);
    else if (check.result === 'FAIL') fail.push(check);
    else {
      notrun.push(check);
      if (check.required) requiredNotRun.push(check);
    }
  }
  const violations = Array.isArray(verification.violations) ? verification.violations : [];
  const bound = isSha(sha) && verification.sha === sha;
  let state = 'pass';
  if (!bound) state = 'unbound';
  else if (fail.length > 0 || violations.length > 0) state = 'fail';
  else if (requiredNotRun.length > 0) state = 'incomplete';
  return { state, bound, pass, fail, notrun, requiredNotRun, violations };
}

/** @type {Record<string, string>} */
export const NEXT_STEPS = {
  complete: '等待 Human Review；workflow 不會 approved、合併、關閉 Issue 或派發下一張 Issue。',
  checkpoint: 'Human 決定：審查 draft PR、用 verify-only 入口驗證固定 SHA，或另開續做 Issue（PR 續做入口 B 尚未實作）。',
  'validation-failed': '必跑檢查沒有全部通過；Human 決定修正方式，不能視為完成。',
  pending: '必跑檢查沒有完成（pending）；Human 可用 verify-only 入口對固定 SHA 重新驗證。',
  'stale-head': 'branch head 在驗證後變更，檢查結果不適用；Human 可用 verify-only 入口對新的 head 驗證。',
  'no-commits': '沒有可回收的提交；Human 排除原因後再決定是否重新派發。',
  'uncertain-branch': '無法確認本輪分支，沒有回收任何分支；Human 檢查 run 紀錄後決定。',
  'verified-only': '只驗證既有成果，不代表先前的模型 run 已完成；Human 決定審查、修正或另開 Issue。',
};

/**
 * 收尾決定。mode：issue（claude.yml）、backstop（workflow_run 補收尾）、verify-only（手動只驗證）。
 * 只有 issue 模式、完成標記、模型正常結束、同 SHA 必跑檢查全過、head 未變，才會 human-review。
 * @param {{ mode: 'issue' | 'backstop' | 'verify-only', branchOk?: boolean, branchReason?: string, hasCommits?: boolean,
 *   snapshotSha?: string, finalSha?: string | null, delivery?: string, stop?: { reason: string, detail: string },
 *   verification?: Verification | null, existingPr?: { number: number, draft: boolean } | null }} input
 */
export function decideFinal(input) {
  const {
    mode,
    branchOk = true,
    branchReason = '',
    hasCommits = false,
    snapshotSha = '',
    finalSha = '',
    delivery = 'missing',
    stop = { reason: 'unknown', detail: '' },
    verification = null,
    existingPr = null,
  } = input;
  const result = evaluateVerification(verification, snapshotSha);
  /** @param {string} status @param {string} label @param {{ reason: string, detail: string }} why @param {{ action: string, number?: number, draft: boolean, markReady: boolean }} pr */
  const make = (status, label, why, pr) => ({
    status,
    label: mode === 'verify-only' ? null : label,
    stop: why,
    pr,
    verification: result,
    next: NEXT_STEPS[status],
  });
  const noPr = { action: 'none', draft: true, markReady: false };
  const draftPr = existingPr
    ? { action: 'reuse', number: existingPr.number, draft: existingPr.draft, markReady: false }
    : { action: 'create', draft: true, markReady: false };

  if (!branchOk) return make('uncertain-branch', 'blocked', { reason: stop.reason, detail: branchReason || stop.detail }, noPr);
  if (!hasCommits) return make('no-commits', 'blocked', stop, noPr);
  if (!isSha(snapshotSha) || finalSha !== snapshotSha) {
    const why = mode === 'issue' && stop.reason === 'none' ? { reason: 'validation', detail: '驗證後 branch head 變更' } : stop;
    return make('stale-head', 'blocked', why, draftPr);
  }
  if (mode === 'verify-only') return make('verified-only', 'blocked', stop, draftPr);
  if (mode === 'backstop') return make('checkpoint', 'blocked', stop, draftPr);
  if (delivery !== 'complete' || stop.reason !== 'none') {
    const detail = delivery === 'checkpoint' ? '模型以 checkpoint 結束（自述未完成）' : '模型結束時沒有完成標記（KodeBart-Delivery: complete）';
    return make('checkpoint', 'blocked', stop.reason === 'none' ? { reason: 'unknown', detail } : stop, draftPr);
  }
  if (result.state === 'pending' || result.state === 'unbound') {
    return make('pending', 'blocked', { reason: 'validation', detail: '沒有綁定此 SHA 的必跑檢查結果' }, draftPr);
  }
  if (result.state !== 'pass') {
    const detail = result.violations.length > 0 ? '變更路徑超出 Validation profile' : result.fail.length > 0 ? '必跑檢查失敗' : '必跑檢查沒有執行';
    return make('validation-failed', 'blocked', { reason: 'validation', detail }, draftPr);
  }
  const readyPr = existingPr
    ? { action: 'reuse', number: existingPr.number, draft: existingPr.draft, markReady: existingPr.draft }
    : { action: 'create', draft: false, markReady: false };
  return make('complete', 'human-review', { reason: 'none', detail: '' }, readyPr);
}

/** @typedef {ReturnType<typeof decideFinal>} FinalDecision */

/**
 * workflow_run 補收尾只處理「取得過執行鎖、run 內 finalize 沒成功、鎖仍在、沒有其他同 Issue run」。
 * @param {{ jobs: { name: string, conclusion: string | null }[], issueState: string | null, labels: string[], otherActiveRuns: number }} input
 */
export function evaluateBackstop({ jobs, issueState, labels, otherActiveRuns }) {
  const claude = jobs.find((job) => job.name === 'claude');
  const finalize = jobs.find((job) => job.name === 'finalize');
  if (!claude || claude.conclusion === 'skipped') return { act: false, code: 'not-locked', reason: '該 run 沒有取得執行鎖。' };
  if (finalize && finalize.conclusion === 'success') return { act: false, code: 'finalized', reason: 'run 內 finalize 已完成。' };
  if (issueState !== 'open') return { act: false, code: 'closed', reason: 'Issue 已關閉或不存在。' };
  if (!labels.includes('agent-working')) return { act: false, code: 'no-lock', reason: 'Issue 已沒有 agent-working，不覆寫目前狀態。' };
  if (otherActiveRuns > 0) return { act: false, code: 'active', reason: '同一 Issue 有其他執行中的 run，不介入。' };
  return { act: true, code: 'recover', reason: 'run 內 finalize 沒有完成，由 workflow_run 補收尾。' };
}

/** @type {Record<string, string>} */
const STATUS_TEXT = {
  complete: '完整交付，必跑檢查在同一 SHA 通過',
  checkpoint: '未完成（checkpoint）',
  'validation-failed': '必跑檢查沒有全部通過',
  pending: '必跑檢查 pending／未完成',
  'stale-head': '驗證後 branch head 已變更',
  'no-commits': '沒有提交',
  'uncertain-branch': '分支不確定',
  'verified-only': '只驗證（不改變任務狀態）',
};

/** @type {Record<string, string>} */
const DELIVERY_TEXT = { complete: 'complete（Agent 自述）', checkpoint: 'checkpoint（Agent 自述未完成）', missing: '缺少' };

/** @type {Record<string, string>} */
const HEADINGS = { issue: 'Claude 執行收尾', backstop: 'Claude 執行收尾（workflow_run 補收）', 'verify-only': 'verify-only：既有成果驗證' };

/** @param {string} text */
function fence(text) {
  return ['````text', text.replace(/`{4,}/g, '```'), '````'].join('\n');
}

/** @param {CheckResult[]} checks */
function listChecks(checks) {
  return checks.length === 0 ? '無' : checks.map((check) => (check.note ? `${check.label}（${check.note}）` : check.label)).join('；');
}

/**
 * Issue 留言／PR 內文用的 checkpoint 回報。
 * @param {{ mode: string, issue: number, branch: string, sha: string, finalSha?: string | null, runUrl: string,
 *   decision: FinalDecision, delivery: string, checkpoint: string, pr: { number: number, draft: boolean } | null,
 *   execTurns?: string, notes?: string[] }} report
 */
export function renderReport(report) {
  const { mode, issue, branch, sha, finalSha, runUrl, decision, delivery, checkpoint, pr, execTurns = '', notes = [] } = report;
  const v = decision.verification;
  const lines = [`### ${HEADINGS[mode] ?? HEADINGS.issue}`, ''];
  lines.push(`- 原 Issue：#${issue}`);
  lines.push(`- Branch：${branch ? `\`${branch}\`` : '（無）'}`);
  const moved = finalSha && finalSha !== sha ? `；收尾時 head：\`${finalSha}\`` : '';
  lines.push(`- 固定 SHA：${sha ? `\`${sha}\`` : '（無）'}${moved}`);
  lines.push(`- Run：${runUrl}`);
  lines.push(`- 結果：${STATUS_TEXT[decision.status]}${decision.label ? `（標籤改為 \`${decision.label}\`）` : '（不變更流程標籤）'}`);
  const turns = /^[0-9]+$/.test(execTurns) ? `，${execTurns} turns` : '';
  lines.push(`- Stop reason：${decision.stop.reason}${decision.stop.detail ? `（${decision.stop.detail}）` : ''}${turns}`);
  lines.push(`- 完成標記：${DELIVERY_TEXT[delivery] ?? DELIVERY_TEXT.missing}`);
  lines.push(`- PR：${pr ? `#${pr.number}${pr.draft ? '（draft）' : ''}` : '沒有建立'}`);
  for (const note of notes) lines.push(`- 備註：${note}`);
  lines.push('', `#### 檢查（綁定 ${sha ? `\`${sha.slice(0, 12)}\`` : '—'}）`);
  if (v.state === 'pending') {
    lines.push('- PENDING：沒有綁定此 SHA 的檢查結果（CI 沒有完成或沒有執行）');
  } else {
    if (!v.bound) lines.push('- 注意：檢查結果不是這個 SHA 的，不採用');
    lines.push(`- PASS：${listChecks(v.pass)}`);
    lines.push(`- FAIL：${listChecks(v.fail)}`);
    lines.push(`- NOTRUN：${listChecks(v.notrun)}`);
    if (v.violations.length > 0) lines.push(`- 超出 Validation profile 的路徑：${v.violations.map((file) => `\`${file}\``).join('、')}`);
  }
  lines.push('', '#### Completed／Remaining（head commit 的 Agent 自述，未經驗證）');
  lines.push(checkpoint ? fence(checkpoint) : '- 沒有提供（head commit 沒有 Checkpoint 區塊）');
  lines.push('', '#### Next step', `- ${decision.next}`);
  return lines.join('\n');
}

/** @param {{ issue: number, branch: string, sha: string, runUrl: string }} input */
export function renderPending({ issue, branch, sha, runUrl }) {
  return [
    '### Claude 交付已回收，檢查 pending',
    '',
    `- 原 Issue：#${issue}`,
    `- Branch：\`${branch}\``,
    `- 固定 SHA：\`${sha}\``,
    `- Run：${runUrl}`,
    '- 檢查：pending。模型步驟之外的 CI 正在驗證這個 SHA；結果出來前不會進入 human-review。',
  ].join('\n');
}

/** @param {{ issue: number, branch: string, sha: string, runUrl: string, mode: string }} input */
export function renderPrBody({ issue, branch, sha, runUrl, mode }) {
  return [
    `Refs #${issue}`,
    '',
    `- Branch：\`${branch}\``,
    `- 建立時的固定 SHA：\`${sha}\``,
    `- 建立者：${mode === 'verify-only' ? 'verify-only 入口' : mode === 'backstop' ? 'workflow_run 補收尾' : 'claude.yml 收尾'}（${runUrl}）`,
    '- 完整的收尾報告（檢查結果、Stop reason、Next step）在原 Issue 留言。',
    '- 這個 PR 由 workflow 建立；核准與合併只由 Human 決定。',
  ].join('\n');
}
