// Trusted runner helper, copied from the workflow SHA before the model starts.
// No network, push, label, credential, auto-apply, or SDK success override capability.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_STOP = 40;
export const TOOL_REMIND = 20;
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const jsonWrite = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
const git = (root, ...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
  cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
}).trimEnd();

// A tool attempt is NOT an SDK turn. This smaller operational stop supplements maxTurns=80.
// Dedup by tool_use_id; exclusive create makes concurrent hooks count the same attempt once.
export function preTool(input, directory) {
  fs.mkdirSync(path.join(directory, 'attempts'), { recursive: true, mode: 0o700 });
  if (input?.hook_event_name !== 'PreToolUse' || typeof input.tool_use_id !== 'string' || !input.tool_use_id) {
    fs.writeFileSync(path.join(directory, 'stopped'), 'invalid-hook');
    return { continue: false, stopReason: '停點計數輸入缺失；停止並保留 runner 工作。' };
  }
  const key = digest(input.tool_use_id);
  try { fs.writeFileSync(path.join(directory, 'attempts', key), '', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const count = fs.readdirSync(path.join(directory, 'attempts')).length;
  if (count >= TOOL_STOP || fs.existsSync(path.join(directory, 'stopped'))) {
    fs.writeFileSync(path.join(directory, 'stopped'), 'tool-stop');
    return { continue: false, stopReason: '已到提前工具停點；runner 將保存候選工作。這不是完成，也不會自動重跑。' };
  }
  return count >= TOOL_REMIND ? {
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext:
      `已使用 ${count} 次工具請求；第 ${TOOL_STOP} 次會提前停止（不是 SDK 回合數）。現在停止擴充範圍，保存已完成的 checkpoint、push 到授權分支並回報 Remaining；不要跑完整測試或輪詢 CI。` },
  } : {};
}

// Deliberately omit message text, tool inputs/results, commands, session IDs, and denial details.
export function executionSummary(messages) {
  if (!Array.isArray(messages)) throw new Error('execution-format');
  const results = messages.filter((m) => m?.type === 'result');
  const result = results.at(-1);
  const ids = new Set();
  const toolIds = new Set();
  const toolRounds = new Set();
  for (const message of messages) {
    if (message?.type !== 'assistant' || typeof message.message?.id !== 'string') continue;
    ids.add(message.message.id);
    for (const block of message.message.content ?? []) {
      if (block?.type === 'tool_use' && typeof block.id === 'string') {
        toolIds.add(block.id); toolRounds.add(message.message.id);
      }
    }
  }
  const subtypes = new Set(['success', 'error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries']);
  return {
    resultPresent: Boolean(result), subtype: subtypes.has(result?.subtype) ? result.subtype : '',
    turns: Number.isSafeInteger(result?.num_turns) && result.num_turns >= 0 ? result.num_turns : null,
    isError: typeof result?.is_error === 'boolean' ? result.is_error : null,
    uniqueAssistantMessages: ids.size, toolUseRounds: toolRounds.size, uniqueToolCalls: toolIds.size,
    permissionDenials: Array.isArray(result?.permission_denials) ? result.permission_denials.length : null,
  };
}

// Only game source and explicit delivery reports; never .git/.env/settings/workflow/transcripts.
export function recoveryPath(name) {
  return typeof name === 'string' && !name.split('/').some((s) => !s || s.startsWith('.')) &&
    (/^src\/[A-Za-z0-9_./-]+\.(ts|html|scss|css|json)$/.test(name) ||
     /^doc\/reports\/[A-Za-z0-9_-]+\.md$/.test(name));
}

export function capture(root, base) {
  if (!sha(base)) throw new Error('invalid-base');
  const head = git(root, 'rev-parse', 'HEAD');
  if (!sha(head)) throw new Error('invalid-head');
  const changed = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', base, '--').split('\0');
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0');
  const names = [...new Set([...changed, ...untracked].filter(Boolean))].sort();
  const files = []; let omitted = 0; let bytes = 0;
  const realRoot = fs.realpathSync(root);
  for (const name of names) {
    if (!recoveryPath(name)) { omitted++; continue; }
    const target = path.join(root, name);
    let descriptor;
    try {
      // Reject symlinked ancestors, symlink files and hardlinks before reading any bytes.
      if (!fs.realpathSync(path.dirname(target)).startsWith(realRoot + path.sep)) throw new Error('outside-root');
      if (fs.existsSync(target)) {
        const before = fs.lstatSync(target);
        if (!before.isFile() || before.nlink !== 1) throw new Error('unsafe-file');
        descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('unsafe-file');
        const data = fs.readFileSync(descriptor);
        const text = data.toString('utf8');
        if (data.includes(0) || !Buffer.from(text).equals(data) ||
            /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|sk-ant-|sk-proj-)[A-Za-z0-9_-]{16,}/.test(text)) throw new Error('unsafe-content');
        bytes += data.length;
        if (bytes > 8 * 1024 * 1024) throw new Error('size-limit');
        files.push({ path: name, sha256: digest(data), text });
      } else {
        // A dangling symlink is not a deletion.
        try { fs.lstatSync(target); throw new Error('unsafe-link'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        files.push({ path: name, deleted: true });
      }
    } catch { omitted++; }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  }
  return { format: 1, base, head, kind: 'unverified-source-recovery-not-a-commit', omitted, files };
}

export function prepare(root, directory, script) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  jsonWrite(path.join(directory, 'identity.json'), { base: git(root, 'rev-parse', 'HEAD') });
  // Command contains only runner-owned paths, never Issue text or tool arguments.
  const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
  jsonWrite(path.join(directory, 'settings.json'), { hooks: { PreToolUse: [{ matcher: '.*', hooks: [{
    type: 'command', command: `node ${quote(script)} hook ${quote(directory)}`, timeout: 10,
  }] }] } });
}

export function finish(root, directory, execFile, output) {
  let summary = { resultPresent: false, subtype: '', turns: null };
  let invalid = false;
  try {
    if (!execFile || fs.statSync(execFile).size > 128 * 1024 * 1024) throw new Error('missing-execution');
    summary = executionSummary(JSON.parse(fs.readFileSync(execFile, 'utf8')));
  } catch { invalid = true; }
  const attempts = fs.existsSync(path.join(directory, 'attempts')) ? fs.readdirSync(path.join(directory, 'attempts')).length : 0;
  // Missing hooks / result must fail closed, not silently claim the early stop worked.
  const stopped = invalid || !summary.resultPresent || !summary.subtype || summary.turns === null ||
    attempts === 0 || fs.existsSync(path.join(directory, 'stopped'));
  const artifact = path.join(directory, 'artifact');
  fs.mkdirSync(artifact, { recursive: true, mode: 0o700 });
  const identity = JSON.parse(fs.readFileSync(path.join(directory, 'identity.json'), 'utf8'));
  let recovery;
  try { recovery = capture(root, identity.base); }
  catch { recovery = { kind: 'recovery-unavailable', base: identity.base }; }
  jsonWrite(path.join(artifact, 'recovery.json'), recovery);
  jsonWrite(path.join(artifact, 'execution-summary.json'), { ...summary, base: identity.base, attempts, stopped,
    note: 'Tool attempts, tool-use rounds and SDK num_turns are different metrics. No transcript/tool arguments retained.' });
  fs.appendFileSync(output, `present=${summary.resultPresent}\nsubtype=${summary.subtype}\nturns=${summary.turns ?? ''}\nstopped=${stopped}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  if (command === 'prepare') prepare(process.cwd(), directory, fileURLToPath(import.meta.url));
  else if (command === 'finish') finish(process.cwd(), directory, process.env.EXEC_FILE, process.env.GITHUB_OUTPUT);
  else if (command === 'hook') {
    try { process.stdout.write(JSON.stringify(preTool(JSON.parse(fs.readFileSync(0, 'utf8')), directory))); }
    catch {
      fs.writeFileSync(path.join(directory, 'stopped'), 'hook-error');
      process.stdout.write(JSON.stringify({ continue: false, stopReason: '停點守衛失敗，停止執行。' }));
    }
  } else throw new Error('unknown-command');
}
