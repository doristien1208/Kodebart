import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOOL_STOP, TOOL_REMIND, preTool, executionSummary, recoveryPath, capture, prepare, finish } from '../agent-runtime.mjs';

const script = fileURLToPath(new URL('../agent-runtime.mjs', import.meta.url));
const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kodebart-runtime-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const attempt = (id) => ({ hook_event_name: 'PreToolUse', tool_use_id: String(id), tool_name: 'Read' });
const write = (root, name, data) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), data);
};
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repository(t) {
  const root = temp(t);
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  write(root, 'src/example.ts', 'old\n'); write(root, 'src/deleted.ts', 'delete me\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture base');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

test('提前停點：20起只提醒、40停止；去重、不放寬工具權限', (t) => {
  const dir = temp(t);
  for (let i = 1; i < TOOL_REMIND; i++) assert.deepEqual(preTool(attempt(i), dir), {});
  const warning = preTool(attempt(TOOL_REMIND), dir);
  assert.match(warning.hookSpecificOutput.additionalContext, /checkpoint/);
  assert.equal(warning.hookSpecificOutput.permissionDecision, undefined);
  preTool(attempt(TOOL_REMIND), dir);
  assert.equal(fs.readdirSync(path.join(dir, 'attempts')).length, TOOL_REMIND);
  for (let i = TOOL_REMIND + 1; i < TOOL_STOP; i++) assert.notEqual(preTool(attempt(i), dir).continue, false);
  assert.equal(preTool(attempt(TOOL_STOP), dir).continue, false);
  assert.equal(preTool(attempt(1), dir).continue, false);
});

test('停點輸入缺失 fail closed，不使用工具輸入作路徑', (t) => {
  const dir = temp(t);
  preTool(attempt('../../escape'), dir);
  assert.match(fs.readdirSync(path.join(dir, 'attempts'))[0], /^[a-f0-9]{64}$/);
  assert.equal(preTool({}, dir).continue, false);
  assert.equal(fs.existsSync(path.join(dir, 'stopped')), true);
});

test('並行 hook 同一 tool ID 只計一次，不遺失不同請求', async (t) => {
  const dir = temp(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'hook', dir], { stdio: ['pipe', 'ignore', 'pipe'] });
    child.once('error', reject); child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    child.stdin.end(JSON.stringify(attempt(i % 6)));
  })));
  assert.equal(fs.readdirSync(path.join(dir, 'attempts')).length, 6);
});

test('原始83保留；assistant多區塊與tool IDs去重，診斷不保存內容／拒絕參數', () => {
  const secret = 'DO_NOT_UPLOAD_SECRET';
  const block = { type: 'tool_use', id: 't1', input: { command: secret } };
  const summary = executionSummary([
    { type: 'assistant', message: { id: 'a1', content: [block] } },
    { type: 'assistant', message: { id: 'a1', content: [block, { type: 'text', text: secret }] } },
    { type: 'assistant', message: { id: 'a2', content: [] } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 83, permission_denials: [{ tool_input: secret }] },
  ]);
  assert.equal(summary.turns, 83); assert.equal(summary.uniqueAssistantMessages, 2);
  assert.equal(summary.uniqueToolCalls, 1); assert.equal(summary.toolUseRounds, 1);
  assert.equal(summary.permissionDenials, 1);
  assert.doesNotMatch(JSON.stringify(summary), /DO_NOT_UPLOAD|a1|t1/);
  assert.equal(executionSummary([]).resultPresent, false);
  assert.throws(() => executionSummary({}));
});

test('保存 staged/unstaged/untracked/刪除與未推 commit，來源與 HEAD 分開，不碰原工作樹', (t) => {
  const { root, base } = repository(t);
  write(root, 'src/example.ts', 'committed but not pushed\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'checkpoint');
  write(root, 'src/example.ts', 'unstaged newer\n'); write(root, 'src/staged.ts', 'staged\n'); git(root, 'add', 'src/staged.ts');
  write(root, 'src/new.ts', 'untracked\n'); fs.unlinkSync(path.join(root, 'src/deleted.ts'));
  write(root, '.env', 'secret'); write(root, '.github/not-allowed.yml', 'no');
  const status = git(root, 'status', '--porcelain');
  const saved = capture(root, base);
  assert.equal(saved.base, base); assert.notEqual(saved.head, base);
  assert.equal(saved.files.length, 4); assert.equal(saved.omitted, 2);
  assert.equal(saved.files.find((f) => f.path === 'src/example.ts').text, 'unstaged newer\n');
  assert.equal(saved.files.find((f) => f.path === 'src/deleted.ts').deleted, true);
  assert.equal(git(root, 'status', '--porcelain'), status);
  assert.doesNotMatch(JSON.stringify(saved), /secret|not-allowed/);
});

test('拒絕越界／hidden／symlink／hardlink／token／binary，不讀連結指向內容', (t) => {
  const { root, base } = repository(t);
  for (const bad of ['../src/a.ts', 'src/../a.ts', '/src/a.ts', 'src/.env.ts', 'src/a.png', '.git/config', 'angular.json']) assert.equal(recoveryPath(bad), false, bad);
  const outside = temp(t); write(outside, 'secret.ts', 'OUTSIDE_SECRET');
  fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src/link.ts'));
  fs.symlinkSync(outside, path.join(root, 'src/directory'));
  fs.linkSync(path.join(outside, 'secret.ts'), path.join(root, 'src/hard.ts'));
  write(root, 'src/key.ts', 'ghp_' + 'A'.repeat(36)); write(root, 'src/binary.ts', Buffer.from([0, 1]));
  write(root, 'src/large.ts', 'x'.repeat(2 * 1024 * 1024 + 1));
  const result = capture(root, base);
  assert.equal(result.files.length, 0); assert.ok(result.omitted >= 6);
  assert.doesNotMatch(JSON.stringify(result), /OUTSIDE_SECRET|ghp_/);
});

test('runner保存不依賴SDK成功、git push或exec file；缺證據保持 stopped', (t) => {
  const { root } = repository(t); const dir = temp(t); const output = path.join(dir, 'outputs');
  prepare(root, dir, script); write(root, 'src/new.ts', 'recover me');
  finish(root, dir, undefined, output);
  assert.match(fs.readFileSync(output, 'utf8'), /stopped=true/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'artifact/recovery.json')));
  assert.equal(saved.files[0].text, 'recover me');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'artifact')).sort(), ['execution-summary.json', 'recovery.json']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json')));
  assert.deepEqual(Object.keys(settings), ['hooks']);
  assert.deepEqual(Object.keys(settings.hooks), ['PreToolUse']);
});

test('正常局部執行完整證據可非 stopped；40工具即使SDK success也 stopped', (t) => {
  const { root } = repository(t); const dir = temp(t); const output = path.join(dir, 'outputs');
  prepare(root, dir, script); preTool(attempt('first'), dir);
  const exec = path.join(dir, 'execution.json');
  fs.writeFileSync(exec, JSON.stringify([{ type: 'result', subtype: 'success', num_turns: 5, is_error: false }]));
  finish(root, dir, exec, output);
  assert.match(fs.readFileSync(output, 'utf8'), /stopped=false/);
  for (let i = 1; i < TOOL_STOP; i++) preTool(attempt(i), dir);
  finish(root, dir, exec, output);
  assert.match(fs.readFileSync(output, 'utf8'), /stopped=true/);
});

test('兩個模型入口接上可信helper、提前timeout、精確artifact；80/60與原模型pin保留', () => {
  for (const name of ['claude.yml', 'claude-resume.yml']) {
    const yaml = fs.readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
    assert.match(yaml, /git show "\$TOOLING_SHA:.github\/scripts\/agent-runtime.mjs"/);
    assert.match(yaml, /settings: \$\{\{ runner.temp \}\}\/kodebart-runtime\/settings.json/);
    assert.match(yaml, /timeout-minutes: 50/); assert.match(yaml, /timeout-minutes: 60/);
    assert.match(yaml, /--max-turns 80/); assert.match(yaml, /--model claude-opus-5-5/);
    assert.match(yaml, /claude-code-action@8ce9314fa9a404564fa7e954cd84f25bcba2b829/);
    assert.match(yaml, /RUNTIME_STOPPED: \$\{\{ needs.claude.outputs.runtime_stopped != 'false' \}\}/);
    assert.match(yaml, /if: always\(\)\n        uses: actions\/upload-artifact@ea165/);
    assert.doesNotMatch(yaml, /show_full_output: true|path:.*execution_file|include-hidden-files: true/);
    assert.equal((yaml.match(/--append-system-prompt /g) ?? []).length, 1);
  }
});
