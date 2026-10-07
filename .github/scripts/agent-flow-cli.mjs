// KodeBart Agent 工作流程 v1.1 階段 A 的 I/O 指令（GitHub REST／GraphQL、GITHUB_OUTPUT）。
// 判定都在 agent-flow.mjs；這裡只讀事實、套用決定。GitHub client 可注入，離線測試不會真寫 GitHub。
// 用法：node .github/scripts/agent-flow-cli.mjs <issue-guard|collect|finalize|backstop|verify-only-guard|verify-only-report|plan|docs-check|summarize>
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as flow from './agent-flow.mjs';

/** @param {string} ref */
const encodeRef = (ref) => ref.split('/').map(encodeURIComponent).join('/');

/**
 * 最小 GitHub client。刻意沒有推送、改寫 ref、合併、關閉 Issue 或 dispatch 的方法。
 * @param {{ token: string, repo: string, apiUrl?: string, graphqlUrl?: string, fetchImpl?: typeof fetch }} options
 */
export function createGitHub({ token, repo, apiUrl = 'https://api.github.com', graphqlUrl = 'https://api.github.com/graphql', fetchImpl = fetch }) {
  const owner = repo.split('/')[0];
  /** @param {string} method @param {string} path @param {unknown} [body] @param {boolean} [allow404] @returns {Promise<any>} */
  async function call(method, path, body, allow404 = false) {
    const response = await fetchImpl(path.startsWith('http') ? path : `${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'kodebart-agent-flow',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} → ${response.status} ${(await response.text()).slice(0, 300)}`);
    return response.status === 204 ? null : response.json();
  }
  /** @param {any} pr */
  const toPr = (pr) => ({ number: Number(pr.number), draft: Boolean(pr.draft), url: String(pr.html_url ?? ''), nodeId: String(pr.node_id ?? '') });
  return {
    /** @param {string} user */
    async permission(user) {
      try {
        const data = await call('GET', `/repos/${repo}/collaborators/${encodeURIComponent(user)}/permission`, undefined, true);
        return String(data?.permission ?? 'none');
      } catch {
        return 'none';
      }
    },
    /** @param {number} number */
    async issue(number) {
      const data = await call('GET', `/repos/${repo}/issues/${number}`, undefined, true);
      if (!data) return null;
      return {
        state: String(data.state),
        title: String(data.title ?? ''),
        body: String(data.body ?? ''),
        labels: (data.labels ?? []).map((/** @type {any} */ label) => String(typeof label === 'string' ? label : label.name)),
        isPullRequest: Boolean(data.pull_request),
      };
    },
    async openPullHeads() {
      const data = await call('GET', `/repos/${repo}/pulls?state=open&per_page=100`);
      return data.map((/** @type {any} */ pr) => String(pr.head?.ref ?? ''));
    },
    /** @param {string} branch */
    async findOpenPull(branch) {
      const data = await call('GET', `/repos/${repo}/pulls?state=open&per_page=10&head=${encodeURIComponent(`${owner}:${branch}`)}`);
      return data.length > 0 ? toPr(data[0]) : null;
    },
    /** @param {string} branch @returns {Promise<string | null>} */
    async branchHead(branch) {
      const data = await call('GET', `/repos/${repo}/git/ref/heads/${encodeRef(branch)}`, undefined, true);
      return data?.object?.sha ?? null;
    },
    /** @param {string} base @param {string} head */
    async compare(base, head) {
      const data = await call('GET', `/repos/${repo}/compare/${encodeRef(base)}...${encodeRef(head)}?per_page=1`);
      return { aheadBy: Number(data.ahead_by ?? 0), mergeBase: String(data.merge_base_commit?.sha ?? '') };
    },
    /** @param {string} sha */
    async commitMessage(sha) {
      const data = await call('GET', `/repos/${repo}/git/commits/${sha}`);
      return String(data?.message ?? '');
    },
    /** @param {{ head: string, base: string, title: string, body: string, draft: boolean }} input */
    async createPull(input) {
      return toPr(await call('POST', `/repos/${repo}/pulls`, input));
    },
    /** @param {string} nodeId */
    async markReady(nodeId) {
      const query = 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }';
      const data = await call('POST', graphqlUrl, { query, variables: { id: nodeId } });
      if (data?.errors) throw new Error(JSON.stringify(data.errors).slice(0, 300));
    },
    /** @param {number} number @param {string[]} labels */
    async addLabels(number, labels) {
      await call('POST', `/repos/${repo}/issues/${number}/labels`, { labels });
    },
    /** @param {number} number @param {string} label */
    async removeLabel(number, label) {
      await call('DELETE', `/repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`, undefined, true);
    },
    /** @param {number} number @param {string} body */
    async comment(number, body) {
      await call('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    },
    /** @param {string} runId */
    async run(runId) {
      return call('GET', `/repos/${repo}/actions/runs/${runId}`);
    },
    /** @param {string} runId @returns {Promise<{ name: string, conclusion: string | null, started_at?: string, completed_at?: string }[]>} */
    async runJobs(runId) {
      const data = await call('GET', `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
      return data?.jobs ?? [];
    },
    /** @returns {Promise<{ id: number, display_title: string }[]>} */
    async activeRuns() {
      const runs = [];
      for (const status of ['queued', 'in_progress', 'waiting']) {
        const data = await call('GET', `/repos/${repo}/actions/runs?status=${status}&per_page=100`);
        runs.push(...(data?.workflow_runs ?? []));
      }
      return runs;
    },
  };
}

/** @typedef {ReturnType<typeof createGitHub>} GitHub */

/** @param {NodeJS.ProcessEnv} env */
export function createOutput(env) {
  return {
    /** @param {string} name @param {unknown} value */
    setOutput(name, value) {
      const text = String(value ?? '');
      if (!env.GITHUB_OUTPUT) return;
      const delimiter = `EOF_${randomUUID()}`;
      appendFileSync(env.GITHUB_OUTPUT, text.includes('\n') ? `${name}<<${delimiter}\n${text}\n${delimiter}\n` : `${name}=${text}\n`);
    },
    /** @param {string} text */
    summary(text) {
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    },
    /** @param {string} text */
    log(text) {
      console.log(text);
    },
  };
}

/** @typedef {ReturnType<typeof createOutput>} Output */
/** @typedef {{ env: NodeJS.ProcessEnv, gh: GitHub, out: Output }} Context */

/** @param {NodeJS.ProcessEnv} env */
const runUrlOf = (env) => `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;

/** @param {unknown} value @param {string} name */
function requireIssue(value, name = 'ISSUE') {
  const issue = flow.parseIssueNumber(value);
  if (issue === null) throw new Error(`${name} 不是有效的 Issue 編號`);
  return issue;
}

/** @param {string | undefined} text */
function parseVerification(text) {
  try {
    const data = JSON.parse(text ?? '');
    return data && Array.isArray(data.checks) ? data : null;
  } catch {
    return null;
  }
}

/** @param {{ started_at?: string, completed_at?: string } | undefined} job */
function jobMinutes(job) {
  if (!job?.started_at || !job?.completed_at) return null;
  const minutes = (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 60000;
  return Number.isFinite(minutes) ? minutes : null;
}

/** 同 Issue 的 claude.yml（claude-issue-N）與 verify-only（verify-only-issue-N）run。 @param {GitHub} gh @param {number} issue @param {string | undefined} selfRunId */
async function countOtherActiveRuns(gh, issue, selfRunId) {
  const titles = [`claude-issue-${issue}`, `verify-only-issue-${issue}`];
  const runs = await gh.activeRuns();
  return runs.filter((run) => String(run.id) !== String(selfRunId) && titles.includes(run.display_title)).length;
}

/** Issue 入口：權限、狀態、重複派發檢查後取得執行鎖。 @param {Context} context */
export async function issueGuard({ env, gh, out }) {
  const issue = requireIssue(env.ISSUE);
  const [actorPermission, info, heads] = await Promise.all([gh.permission(env.ACTOR ?? ''), gh.issue(issue), gh.openPullHeads()]);
  const labels = info?.labels ?? [];
  const verdict = flow.evaluateIssueGuard({
    actorPermission,
    issueState: info && !info.isPullRequest ? info.state : 'missing',
    labels,
    triggerLabelPresent: labels.includes('claude-ready'),
    openClaudePrs: heads.filter((head) => flow.isIssueBranch(head, issue)).length,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? '1'),
  });
  if (!verdict.proceed) {
    if (labels.includes('claude-ready')) await gh.removeLabel(issue, 'claude-ready');
    await gh.comment(issue, `未執行：${verdict.reason}（沒有開分支；排除後請由 Human 重新加上 claude-ready。）Run：${runUrlOf(env)}`);
    out.setOutput('proceed', 'false');
    return verdict;
  }
  await gh.removeLabel(issue, 'claude-ready');
  await gh.addLabels(issue, ['agent-working']);
  out.setOutput('proceed', 'true');
  return verdict;
}

/** 模型 job 之後讀取遠端分支，固定要驗證的 head SHA。 @param {Context} context */
export async function collect({ env, gh, out }) {
  const issue = requireIssue(env.ISSUE);
  const branch = flow.checkRunBranch({ issue, runId: env.GITHUB_RUN_ID, actionBranch: env.ACTION_BRANCH ?? '' });
  if (!branch.ok) {
    out.log(branch.reason);
    return { collected: false };
  }
  const head = await gh.branchHead(branch.branch);
  if (!head) return { collected: false };
  const { aheadBy, mergeBase } = await gh.compare(env.DEFAULT_BRANCH ?? 'main', head);
  if (!(aheadBy > 0) || !flow.isSha(mergeBase)) return { collected: false };
  const info = await gh.issue(issue);
  out.setOutput('head_sha', head);
  out.setOutput('merge_base', mergeBase);
  out.setOutput('declared_profile', flow.parseDeclaredProfile(info?.body ?? ''));
  await gh.comment(issue, flow.renderPending({ issue, branch: branch.branch, sha: head, runUrl: runUrlOf(env) }));
  return { collected: true, head };
}

/**
 * 回收已推送成果：建立或沿用 draft PR、最後重讀 head、決定標籤並留言。
 * @param {Context} context @param {{ mode: 'issue' | 'backstop', issue: number, runId: string, actionBranch: string,
 *   stop: { reason: string, detail: string }, snapshotSha: string, verification: flow.Verification | null, execTurns: string }} input
 */
async function recover({ env, gh, out }, input) {
  const { mode, issue, runId, actionBranch, stop, verification, execTurns } = input;
  const defaultBranch = env.DEFAULT_BRANCH ?? 'main';
  const branch = flow.checkRunBranch({ issue, runId, actionBranch });
  let head = null;
  let aheadBy = 0;
  let message = '';
  if (branch.ok) {
    head = await gh.branchHead(branch.branch);
    if (head) {
      aheadBy = (await gh.compare(defaultBranch, head)).aheadBy;
      message = await gh.commitMessage(head);
    }
  }
  const hasCommits = branch.ok && Boolean(head) && aheadBy > 0;
  const snapshotSha = flow.isSha(input.snapshotSha) ? input.snapshotSha : head ?? '';
  const { delivery, checkpoint } = flow.parseDelivery(message, issue);
  const info = await gh.issue(issue);
  /** @type {{ number: number, draft: boolean, url: string, nodeId: string } | null} */
  let pr = null;
  if (hasCommits) {
    pr = await gh.findOpenPull(branch.branch);
    if (!pr) {
      const title = `[#${issue}] ${info?.title ?? ''}`.slice(0, 250);
      const body = flow.renderPrBody({ issue, branch: branch.branch, sha: snapshotSha, runUrl: runUrlOf(env), mode });
      pr = await gh.createPull({ head: branch.branch, base: defaultBranch, title, body, draft: true });
    }
  }
  // 最後重讀 head：與驗證的 SHA 不同就不能 human-review。
  const finalSha = hasCommits ? await gh.branchHead(branch.branch) : head;
  const decision = flow.decideFinal({
    mode,
    branchOk: branch.ok,
    branchReason: branch.reason,
    hasCommits,
    snapshotSha,
    finalSha,
    delivery,
    stop,
    verification,
    existingPr: pr,
  });
  const notes = [];
  if (pr && decision.pr.markReady) {
    try {
      await gh.markReady(pr.nodeId);
      pr = { ...pr, draft: false };
    } catch (error) {
      notes.push(`PR 標記 ready 失敗，仍為 draft：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (decision.label) {
    await gh.removeLabel(issue, 'agent-working');
    await gh.addLabels(issue, [decision.label]);
  }
  const report = flow.renderReport({
    mode,
    issue,
    branch: branch.branch,
    sha: snapshotSha,
    finalSha,
    runUrl: runUrlOf(env),
    decision,
    delivery,
    checkpoint,
    pr,
    execTurns,
    notes,
  });
  await gh.comment(issue, report);
  out.summary(report);
  return { decision, pr, report };
}

/** claude.yml 的 run 內收尾（if: always()）。 @param {Context} context */
export async function finalize(context) {
  const { env, gh } = context;
  const issue = requireIssue(env.ISSUE);
  const runId = String(env.GITHUB_RUN_ID ?? '');
  const jobs = await gh.runJobs(runId);
  const claudeJob = jobs.find((job) => job.name === 'claude');
  const stop = flow.classifyStop({
    stepOutcome: env.CLAUDE_OUTCOME ?? '',
    actionConclusion: env.ACTION_CONCLUSION ?? '',
    execPresent: env.EXEC_PRESENT === 'true',
    execSubtype: env.EXEC_SUBTYPE ?? '',
    jobConclusion: claudeJob?.conclusion ?? env.CLAUDE_RESULT ?? '',
    jobMinutes: jobMinutes(claudeJob),
  });
  return recover(context, {
    mode: 'issue',
    issue,
    runId,
    actionBranch: env.ACTION_BRANCH ?? '',
    stop,
    snapshotSha: env.SNAPSHOT_SHA ?? '',
    verification: parseVerification(env.VERIFY_RESULTS),
    execTurns: env.EXEC_TURNS ?? '',
  });
}

/** workflow_run 補收尾：只處理 run 內 finalize 沒完成且鎖還在的情況。 @param {Context} context */
export async function backstop(context) {
  const { env, gh, out } = context;
  const match = /^claude-issue-([1-9][0-9]{0,9})$/.exec(env.TARGET_TITLE ?? '');
  const runId = String(env.TARGET_RUN_ID ?? '');
  if (!match || !/^[1-9][0-9]*$/.test(runId)) {
    out.log('不是 claude-ready 的 Issue run，略過。');
    return { acted: false, code: 'not-issue-run' };
  }
  const issue = Number(match[1]);
  const run = await gh.run(runId);
  const trusted = run?.event === 'issues' && run?.repository?.full_name === env.GITHUB_REPOSITORY && (!run?.path || run.path === '.github/workflows/claude.yml');
  if (!trusted) {
    out.log('run metadata 不是本 repo 的 claude.yml issues run，略過。');
    return { acted: false, code: 'untrusted' };
  }
  const jobs = await gh.runJobs(runId);
  const info = await gh.issue(issue);
  const verdict = flow.evaluateBackstop({
    jobs,
    issueState: info && !info.isPullRequest ? info.state : null,
    labels: info?.labels ?? [],
    otherActiveRuns: await countOtherActiveRuns(gh, issue, runId),
  });
  out.log(verdict.reason);
  if (!verdict.act) return { acted: false, code: verdict.code };
  const claudeJob = jobs.find((job) => job.name === 'claude');
  const stop = flow.classifyStop({ jobConclusion: claudeJob?.conclusion ?? '', jobMinutes: jobMinutes(claudeJob) });
  const result = await recover(context, { mode: 'backstop', issue, runId, actionBranch: '', stop, snapshotSha: '', verification: null, execTurns: '' });
  return { acted: true, code: verdict.code, ...result };
}

/** verify-only 入口的檢查。不寫任何東西。 @param {Context} context */
export async function verifyOnlyGuard({ env, gh, out }) {
  const issue = flow.parseIssueNumber(env.INPUT_ISSUE);
  const branch = String(env.INPUT_BRANCH ?? '').trim();
  const inputSha = String(env.INPUT_SHA ?? '').trim();
  const actorPermission = await gh.permission(env.ACTOR ?? '');
  /** @type {Awaited<ReturnType<GitHub['issue']>>} */
  let info = null;
  /** @type {string | null} */
  let branchSha = null;
  let aheadBy = 0;
  let mergeBase = '';
  let activeRuns = 0;
  if (issue !== null && flow.WRITE_PERMISSIONS.includes(actorPermission)) {
    info = await gh.issue(issue);
    activeRuns = await countOtherActiveRuns(gh, issue, env.GITHUB_RUN_ID);
    if (flow.isIssueBranch(branch, issue)) {
      branchSha = await gh.branchHead(branch);
      if (branchSha) ({ aheadBy, mergeBase } = await gh.compare(env.DEFAULT_BRANCH ?? 'main', branchSha));
    }
  }
  const verdict = flow.evaluateVerifyOnlyGuard({
    actorPermission,
    ref: env.GITHUB_REF ?? '',
    defaultBranch: env.DEFAULT_BRANCH ?? 'main',
    issue,
    issueState: info ? info.state : null,
    isPullRequest: Boolean(info?.isPullRequest),
    labels: info?.labels ?? [],
    activeRuns,
    branch,
    inputSha,
    branchSha,
    aheadBy,
  });
  out.setOutput('proceed', String(verdict.proceed));
  if (!verdict.proceed) {
    out.summary(`verify-only 沒有執行：${verdict.reason}`);
    throw new Error(`verify-only 沒有執行：${verdict.reason}`);
  }
  out.setOutput('merge_base', mergeBase);
  out.setOutput('declared_profile', flow.parseDeclaredProfile(info?.body ?? ''));
  return verdict;
}

/** verify-only 的回報：建立或沿用 draft PR、留言；不變更流程標籤。 @param {Context} context */
export async function verifyOnlyReport({ env, gh, out }) {
  const issue = requireIssue(env.INPUT_ISSUE, 'INPUT_ISSUE');
  const branch = String(env.INPUT_BRANCH ?? '').trim();
  const sha = String(env.INPUT_SHA ?? '').trim();
  if (!flow.isIssueBranch(branch, issue) || !flow.isSha(sha)) throw new Error('branch 或 SHA 不符合 verify-only 規則');
  const info = await gh.issue(issue);
  let pr = await gh.findOpenPull(branch);
  if (!pr) {
    const title = `[#${issue}] ${info?.title ?? ''}`.slice(0, 250);
    pr = await gh.createPull({ head: branch, base: env.DEFAULT_BRANCH ?? 'main', title, body: flow.renderPrBody({ issue, branch, sha, runUrl: runUrlOf(env), mode: 'verify-only' }), draft: true });
  }
  const finalSha = await gh.branchHead(branch);
  const { delivery, checkpoint } = flow.parseDelivery(await gh.commitMessage(sha), issue);
  const decision = flow.decideFinal({
    mode: 'verify-only',
    hasCommits: true,
    snapshotSha: sha,
    finalSha,
    delivery,
    stop: { reason: 'unknown', detail: 'verify-only 不判定先前模型 run 的停止原因' },
    verification: parseVerification(env.VERIFY_RESULTS),
    existingPr: pr,
  });
  const report = flow.renderReport({ mode: 'verify-only', issue, branch, sha, finalSha, runUrl: runUrlOf(env), decision, delivery, checkpoint, pr });
  await gh.comment(issue, report);
  out.summary(report);
  return { decision, pr, report };
}

/** @param {string} dir */
const gitIn = (dir) => (/** @type {string[]} */ args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** 驗證 job：以預設分支上的這支腳本讀取受驗分支的 diff（不執行受驗分支的程式）。 @param {{ env: NodeJS.ProcessEnv, out: Output }} context */
export function plan({ env, out }) {
  const sha = env.SHA ?? '';
  const base = env.BASE ?? '';
  if (!flow.isSha(sha) || !flow.isSha(base)) throw new Error('SHA／BASE 必須是 40 碼 SHA');
  const git = gitIn(env.DELIVERY_DIR ?? 'delivery');
  if (git(['rev-parse', 'HEAD']).trim() !== sha) throw new Error('checkout 的 commit 不是指定的 SHA');
  const files = git(['diff', '--name-only', '-z', base, sha]).split('\0').filter(Boolean);
  const result = flow.planChecks(files, env.DECLARED_PROFILE ?? '');
  out.setOutput('plan', JSON.stringify(result));
  out.setOutput('product', String(result.product));
  out.setOutput('workflow', String(result.workflow));
  out.summary(`驗證範圍：${flow.scopeName(result)}；變更 ${files.length} 個檔案；超出 profile：${result.violations.length}`);
  return result;
}

const PATH_TOKEN_RE = /`((?:\.github|doc|src|public)\/[^`\s*?<>{}[\]]*)`/g;

/** 文件一致性：變更的 Markdown 中以反引號引用的 repo 路徑必須存在。 @param {{ env: NodeJS.ProcessEnv, out: Output }} context */
export function docsCheck({ env, out }) {
  const root = env.DELIVERY_DIR ?? 'delivery';
  const data = JSON.parse(env.PLAN ?? '{}');
  const files = (Array.isArray(data.files) ? data.files : []).filter((/** @type {string} */ file) => file.endsWith('.md') && existsSync(join(root, file)));
  const missing = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const match of text.matchAll(PATH_TOKEN_RE)) {
      const path = match[1].replace(/[#:].*$/, '');
      if (!existsSync(join(root, path))) missing.push(`${file} → ${path}`);
    }
  }
  if (missing.length > 0) {
    out.summary(`文件引用了不存在的路徑：\n${missing.map((item) => `- ${item}`).join('\n')}`);
    throw new Error(`文件引用了不存在的路徑：${missing.join('；')}`);
  }
  out.log(`文件路徑引用檢查：${files.length} 個 Markdown 檔，沒有缺少的路徑。`);
  return { files, missing };
}

/** @type {Record<string, string>} */
const OUTCOME_ENV = {
  'npm-ci': 'OUTCOME_NPM_CI',
  'tsc-app': 'OUTCOME_TSC_APP',
  'tsc-spec': 'OUTCOME_TSC_SPEC',
  'ng-build': 'OUTCOME_NG_BUILD',
  'ng-test': 'OUTCOME_NG_TEST',
  actionlint: 'OUTCOME_ACTIONLINT',
  'flow-tests': 'OUTCOME_FLOW_TESTS',
  'diff-check': 'OUTCOME_DIFF_CHECK',
  'doc-refs': 'OUTCOME_DOC_REFS',
};

/** 把各 job 的步驟 outcome 整理成綁定 SHA 的結果；沒有 plan 就不輸出（視為 pending）。 @param {{ env: NodeJS.ProcessEnv, out: Output }} context */
export function summarize({ env, out }) {
  const sha = env.SHA ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(env.PLAN ?? '');
  } catch {
    parsed = null;
  }
  if (!flow.isSha(sha) || !parsed || !Array.isArray(parsed.files)) {
    out.summary('沒有可用的檢查計畫，結果視為 pending。');
    return null;
  }
  /** @type {Record<string, string>} */
  const outcomes = {};
  for (const [id, name] of Object.entries(OUTCOME_ENV)) outcomes[id] = env[name] ?? '';
  const results = flow.summarizeChecks({ sha, plan: parsed, outcomes });
  out.setOutput('sha', sha);
  out.setOutput('results', JSON.stringify(results));
  out.summary(results.checks.map((check) => `- ${check.result} ${check.label}${check.note ? `（${check.note}）` : ''}`).join('\n'));
  return results;
}

/** @type {Record<string, (context: any) => unknown>} */
export const COMMANDS = {
  'issue-guard': issueGuard,
  collect,
  finalize,
  backstop,
  'verify-only-guard': verifyOnlyGuard,
  'verify-only-report': verifyOnlyReport,
  plan,
  'docs-check': docsCheck,
  summarize,
};

/** @param {string | undefined} command @param {NodeJS.ProcessEnv} env */
export async function main(command, env) {
  const handler = COMMANDS[command ?? ''];
  if (!handler) throw new Error(`未知指令：${command}`);
  const gh = env.GH_TOKEN
    ? createGitHub({ token: env.GH_TOKEN, repo: env.GITHUB_REPOSITORY ?? '', apiUrl: env.GITHUB_API_URL, graphqlUrl: env.GITHUB_GRAPHQL_URL })
    : null;
  return handler({ env, gh, out: createOutput(env) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.env).catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
