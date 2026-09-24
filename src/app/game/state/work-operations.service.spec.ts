import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { STORAGE } from '../content/text';
import { isValidSave } from '../core/save-schema';
import { MissingPolicy, RecordKey, Save, ValidationOk } from '../core/types';
import { SettingsService } from '../platform/settings.service';
import { DAY_DIRECTORY } from './day-directory';
import { GameStateService } from './game-state.service';
import { SAVE_KEY, SaveRepository } from './save-repository';
import { OperationStage, WorkOperationsService } from './work-operations.service';

/**
 * 提交的執行過程（R10 §3）：接收 → 驗證結構／型別 → 處理 → 保存 → 成功／失敗。
 * 用正式內容與正式 DAY_DIRECTORY；每個測試重建 injector，讓 GameStateService 重新讀 localStorage。
 */

const TASK_DAY1 = 'task.day1.archive';
const TASK_DAY2 = 'task.day2.reconcile';
const TASK_DAY3 = 'task.day3.archive';
const TASK_DAY4_RETURN = 'task.day4.return-review';
const TASK_DAY6 = 'task.day6.field-map';
const CASE_H204 = 'case.day3.h204';
const RETURN_B102 = 'return.day1-code-audit.B102';
/** B102 案的回條：#0＝Day 3 第一次退件；#1＝下一次核對的回條（再次退回或收件確認）。 */
const R0 = `${RETURN_B102}#0`;
const R1 = `${RETURN_B102}#1`;
const FULL_TRAIL: readonly OperationStage[] = ['received', 'validating', 'validated', 'processing', 'saving', 'done'];
/** 動態開啟時各階段之間的等待（毫秒），依序：validating、processing、saving、done。 */
const PACING = [120, 160, 160, 120];

interface Ctx {
  game: GameStateService;
  ops: WorkOperationsService;
  settings: SettingsService;
  repo: SaveRepository;
}

/** 重建 injector；motion＝遊戲內動態設定，reducedMotion＝系統偏好。 */
function setup(motion = true, reducedMotion = false): Ctx {
  TestBed.resetTestingModule();
  const settings = TestBed.inject(SettingsService);
  settings.setMotion(motion);
  settings.reducedMotion.set(reducedMotion);
  return {
    settings,
    game: TestBed.inject(GameStateService),
    ops: TestBed.inject(WorkOperationsService),
    repo: TestBed.inject(SaveRepository),
  };
}

/** 等待函式換成立即完成（仍是非同步），並記下每次等待時的毫秒數與階段。 */
function instantWait(ops: WorkOperationsService, onWait?: (ms: number) => void): number[] {
  const calls: number[] = [];
  ops.wait = (ms) => {
    calls.push(ms);
    onWait?.(ms);
    return Promise.resolve();
  };
  return calls;
}

/** 以指定編號寫入草稿並通過驗證（缺拒絕紀錄者用指定政策）。 */
function okWith(game: GameStateService, key: RecordKey, value: string, policy: MissingPolicy = 'default_false'): ValidationOk {
  const r = game.record(key);
  game.updateDraft(key, r.refusalApplies && r.refusal === null ? { value, policy } : { value });
  const v = game.validate(key);
  if (!v.ok) throw new Error(`validation for ${key} failed: ${v.error}`);
  return v;
}

function stored(): Save | null {
  const raw = localStorage.getItem(SAVE_KEY);
  return raw === null ? null : (JSON.parse(raw) as Save);
}

function countKind(game: GameStateService, kind: string): number {
  return game.save()!.events.filter((e) => e.kind === kind).length;
}

/* ---------- 直接用 GameStateService 推進到需要的工作（不經 operation） ---------- */

/** 目前歸檔批次全部以指定編號（預設來源）提交；案件（H204）開案後依登記表、以來源編號提交。 */
function archiveAll(game: GameStateService, codes: Partial<Record<RecordKey, string>> = {}): void {
  for (const r of game.records()) {
    if (game.archived(r.key)) continue;
    const code = codes[r.key] ?? r.code;
    const plan = game.caseFor(r.key);
    if (plan) {
      game.openCase(plan.id);
      expect(game.commitCase(r.key, 'registry', code)).toBeTrue();
      continue;
    }
    game.archive(r.key, okWith(game, r.key, code));
  }
}

/** 完成今天全部工作並停在 wrap／end。核對：兩筆放行後確認收件；映射：預設對應；錯誤文件處理：待修正者送窗口待查。 */
function finishToday(game: GameStateService, codes: Partial<Record<RecordKey, string>> = {}): void {
  game.startDay();
  const dayId = game.dayId();
  while (game.stage() === 'work' && game.dayId() === dayId) {
    const t = game.task()!;
    switch (t.kind) {
      case 'archive':
        archiveAll(game, codes);
        expect(game.completeWork()).toBeTrue();
        break;
      case 'reconcile':
        game.openReport();
        for (const key of t.recordKeys) game.setRecordReview(key, 'release');
        expect(game.submitReply('ack')).toBeTrue();
        break;
      case 'field-map':
        for (const target of t.targets) game.setFieldAssignment(target.id, target.sourceId);
        game.setFieldBlankPolicy('default_false');
        game.previewFieldMap();
        expect(game.submitFieldMap()).toBeTrue();
        expect(game.completeWork()).toBeTrue();
        break;
      case 'return-review':
        // 錯誤文件處理：當天排入且仍待修正的案件送窗口待查（已從文件問題頁處理的不再送）
        for (const r of game.activeReturns()) if (r.status === 'pending') expect(game.sendReturnToWindowStrict(r.id, game.editableReceiptId(r.id)!)).toBe('ok');
        expect(game.completeWork()).toBeTrue();
        break;
    }
  }
}

/** Day 1 B102 填 "102"、Day 2 放行 → Day 3 退件回條 → Day 4 原歸檔工作交付後，目前是錯誤文件處理。 */
function toDay4IssueTask(game: GameStateService): void {
  game.newGame();
  finishToday(game, { B102: '102' });
  game.advanceDay();
  finishToday(game);
  game.advanceDay();
  finishToday(game);
  game.advanceDay();
  game.startDay();
  archiveAll(game);
  expect(game.completeWork()).toBeTrue();
  expect(game.taskId()).toBe(TASK_DAY4_RETURN);
  expect(game.activeReturns().map((r) => r.id)).toEqual([RETURN_B102]);
}

/** 新遊戲一路走到指定日的 work。 */
function playTo(game: GameStateService, dayId: string, codes: Partial<Record<RecordKey, string>> = {}): void {
  game.newGame();
  while (game.dayId() !== dayId) {
    finishToday(game, codes);
    game.advanceDay();
  }
  game.startDay();
  expect(game.stage()).toBe('work');
}

describe('WorkOperationsService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('初始：沒有進行中的提交、busy false；沒有失敗時 retry 回傳 false', async () => {
    const { ops } = setup();
    expect(ops.current()).toBeNull();
    expect(ops.busy()).toBeFalse();
    expect(await ops.retry()).toBeFalse();
    expect(ops.current()).toBeNull();
  });

  describe('階段與節奏', () => {
    it('動態開啟：received → validating → validated → processing → saving → done；只在 saving 寫入；節奏合計 0.4–0.9 秒', async () => {
      const { game, ops } = setup(true);
      game.newGame();
      const ok = okWith(game, 'B102', '102');
      const rawBefore = localStorage.getItem(SAVE_KEY);
      const atWait: { stage: OperationStage; archived: boolean; stored: boolean }[] = [];
      const waits = instantWait(ops, () =>
        atWait.push({
          stage: ops.current()!.stage,
          archived: game.archived('B102') !== undefined,
          stored: stored()!.batches['batch.day01.archive']?.archived['B102'] !== undefined,
        }),
      );

      const pending = ops.archive('B102', ok);
      // 同步回傳時已接收、處理中，尚未寫入
      expect(ops.current()).toEqual({ id: 1, kind: 'archive', taskId: TASK_DAY1, arg: '102', stage: 'received', trail: ['received'], failure: null });
      expect(ops.busy()).toBeTrue();
      expect(localStorage.getItem(SAVE_KEY)).toBe(rawBefore);

      expect(await pending).toBeTrue();
      expect(ops.current()).toEqual({ id: 1, kind: 'archive', taskId: TASK_DAY1, arg: '102', stage: 'done', trail: [...FULL_TRAIL], failure: null });
      expect(ops.busy()).toBeFalse();
      expect(waits).toEqual(PACING);
      const total = waits.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(400);
      expect(total).toBeLessThanOrEqual(900);
      // 等待「前」看到的階段；寫入只發生在 saving 之後（最後一段等待時才看得到）
      expect(atWait.map((w) => w.stage)).toEqual(['received', 'validated', 'processing', 'saving']);
      expect(atWait.map((w) => w.archived)).toEqual([false, false, false, true]);
      expect(atWait.map((w) => w.stored)).toEqual([false, false, false, true]);

      expect(game.archived('B102')!.archiveCode).toBe('102');
      expect(countKind(game, 'archive')).toBe(1);
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();
    });

    it('實際計時（fakeAsync）：0 received、120ms validated、280ms processing、440ms saving（已保存）、560ms done', fakeAsync(() => {
      const { game, ops } = setup(true);
      game.newGame();
      const ok = okWith(game, 'H17', 'H-17');
      let result: boolean | undefined;
      void ops.archive('H17', ok).then((v) => (result = v));
      const stage = () => ops.current()!.stage;

      expect(stage()).toBe('received');
      tick(119);
      expect(stage()).toBe('received');
      tick(1);
      expect(stage()).toBe('validated');
      expect(ops.current()!.trail).toEqual(['received', 'validating', 'validated']);
      tick(160);
      expect(stage()).toBe('processing');
      expect(game.archived('H17')).toBeUndefined();
      tick(160);
      expect(stage()).toBe('saving');
      expect(game.archived('H17')).toBeDefined();
      expect(stored()!.batches['batch.day01.archive']!.archived['H17']!.archiveCode).toBe('H-17');
      expect(ops.busy()).toBeTrue();
      tick(119);
      expect(stage()).toBe('saving');
      tick(1);
      flushMicrotasks();
      expect(stage()).toBe('done');
      expect(result).toBeTrue();
      expect(ops.busy()).toBeFalse();
    }));

    for (const [name, motion, reduced] of [
      ['關閉遊戲動態', false, false],
      ['系統 reduced-motion', true, true],
    ] as const) {
      it(`${name}：不等待、不用計時器即完成，階段文字照樣完整`, async () => {
        const { game, ops, settings } = setup(motion, reduced);
        expect(settings.animationsEnabled()).toBeFalse();
        game.newGame();
        const ok = okWith(game, 'B102', '0103');
        const wait = spyOn(ops, 'wait').and.callThrough();
        jasmine.clock().install(); // 若用到 setTimeout，這裡不會前進，await 就不會完成
        let result: boolean;
        try {
          result = await ops.archive('B102', ok);
        } finally {
          jasmine.clock().uninstall();
        }
        expect(result).toBeTrue();
        expect(wait).not.toHaveBeenCalled();
        expect(ops.current()!.trail).toEqual([...FULL_TRAIL]);
        expect(game.archived('B102')!.archiveCode).toBe('0103');
      });
    }

    it('資料結果與播放節奏無關：動態開／關提交同一筆，保存內容與事件相同', async () => {
      const results: { batches: unknown; kinds: string[] }[] = [];
      for (const motion of [true, false]) {
        localStorage.clear();
        const { game, ops } = setup(motion);
        instantWait(ops);
        game.newGame();
        expect(await ops.archive('B102', okWith(game, 'B102', '102', 'request_review'))).toBeTrue();
        expect(await ops.archive('B607', okWith(game, 'B607', '0607'))).toBeTrue();
        results.push({ batches: game.save()!.batches, kinds: game.save()!.events.map((e) => e.kind) });
      }
      expect(results[1]).toEqual(results[0]);
    });
  });

  describe('防重送', () => {
    it('處理中再次提交（連點）被拒：只保存一次、只寫一個事件；其他種類的提交也被擋', async () => {
      const { game, ops } = setup(true);
      instantWait(ops);
      game.newGame();
      const ok = okWith(game, 'B102', '102');
      const first = ops.archive('B102', ok);
      const second = ops.archive('B102', ok);
      const other = ops.archive('H17', okWith(game, 'H17', 'H-17'));
      expect(await second).toBeFalse();
      expect(await other).toBeFalse();
      expect(ops.current()!.id).toBe(1); // 被擋下的提交不建立新的 operation
      expect(await first).toBeTrue();
      expect(countKind(game, 'archive')).toBe(1);
      expect(game.archived('H17')).toBeUndefined();
      expect(stored()!.events.filter((e) => e.kind === 'archive').length).toBe(1);

      // 完成後再送同一筆：規則不允許（已提交鎖定）→ failed rejected，不寫入
      const after = game.save();
      expect(await ops.archive('B102', { ...ok, code: '0102' })).toBeFalse();
      expect(ops.current()).toEqual(jasmine.objectContaining({ id: 2, stage: 'failed', failure: 'rejected' }));
      expect(game.save()).toBe(after);
      expect(game.archived('B102')!.archiveCode).toBe('102');
    });

    it('處理中重新整理：新的 service 沒有進行中的提交，未保存的處理不假裝完成（只剩已保存的草稿）', () => {
      const { game, ops } = setup(true);
      game.newGame();
      const ok = okWith(game, 'B102', '102');
      ops.wait = () => new Promise<void>(() => undefined); // 停在第一段節奏，永遠不到 saving
      void ops.archive('B102', ok);
      expect(ops.busy()).toBeTrue();
      expect(ops.current()!.stage).toBe('received');

      const fresh = setup(true);
      expect(fresh.ops.current()).toBeNull();
      expect(fresh.ops.busy()).toBeFalse();
      expect(fresh.game.archived('B102')).toBeUndefined();
      expect(fresh.game.draft('B102')).toEqual({ value: '102', policy: 'default_false' });
      expect(stored()!.events).toEqual([]);
    });

    it('處理中切去看訊息（標記已讀）不影響提交；兩者都保存', async () => {
      const { game, ops } = setup(true);
      game.newGame();
      let once = false;
      instantWait(ops, () => {
        if (once) return;
        once = true;
        game.markMessagesRead(['msg.day1.welcome']);
      });
      expect(await ops.archive('H17', okWith(game, 'H17', 'H-17'))).toBeTrue();
      expect(game.isMessageRead('msg.day1.welcome')).toBeTrue();
      expect(stored()!.readMessages).toEqual(['msg.day1.welcome']);
      expect(stored()!.batches['batch.day01.archive']!.archived['H17']!.archiveCode).toBe('H-17');
    });
  });

  describe('失敗與重試', () => {
    it('寫入失敗 → failed storage：存檔與畫面都停在原狀；修好後重試成功，事件恰好一個', async () => {
      const { game, ops, repo } = setup(false);
      game.newGame();
      const ok = okWith(game, 'B102', '102');
      const before = game.save();
      const rawBefore = localStorage.getItem(SAVE_KEY);
      const persist = spyOn(repo, 'persist').and.returnValue(STORAGE.writeIssue);

      expect(await ops.archive('B102', ok)).toBeFalse();
      expect(ops.current()).toEqual({
        id: 1,
        kind: 'archive',
        taskId: TASK_DAY1,
        arg: '102',
        stage: 'failed',
        trail: ['received', 'validating', 'validated', 'processing', 'saving', 'failed'],
        failure: 'storage',
      });
      expect(ops.busy()).toBeFalse();
      expect(game.save()).toBe(before);
      expect(game.archived('B102')).toBeUndefined();
      expect(game.archivedCount()).toBe(0);
      expect(localStorage.getItem(SAVE_KEY)).toBe(rawBefore);
      expect(game.storageIssue()).toBe(STORAGE.writeIssue);
      expect(persist).toHaveBeenCalledTimes(1);

      // 仍然寫不進去 → 再失敗一次，仍不前進
      expect(await ops.retry()).toBeFalse();
      expect(ops.current()!.failure).toBe('storage');
      expect(game.save()).toBe(before);

      persist.and.callThrough();
      expect(await ops.retry()).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ id: 3, kind: 'archive', arg: '102', stage: 'done', failure: null }));
      expect(ops.current()!.trail).toEqual([...FULL_TRAIL]);
      expect(game.archived('B102')!.archiveCode).toBe('102');
      expect(countKind(game, 'archive')).toBe(1);
      expect(stored()!.events.filter((e) => e.kind === 'archive').length).toBe(1);
      expect(game.storageIssue()).toBe('');
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();

      // 成功之後 retry 無事可做
      const done = game.save();
      expect(await ops.retry()).toBeFalse();
      expect(game.save()).toBe(done);
    });

    it('結構／型別不符（空白編號）→ failed invalid，不進 processing、不寫入', async () => {
      const { game, ops, repo } = setup(false);
      game.newGame();
      const before = game.save();
      const persist = spyOn(repo, 'persist').and.callThrough();
      for (const code of ['', '   ']) {
        expect(await ops.archive('B102', { ok: true, code, refusal: false, origin: 'defaulted' })).toBeFalse();
        expect(ops.current()).toEqual(
          jasmine.objectContaining({ kind: 'archive', arg: code, stage: 'failed', trail: ['received', 'validating', 'failed'], failure: 'invalid' }),
        );
        expect(ops.busy()).toBeFalse();
      }
      expect(persist).not.toHaveBeenCalled();
      expect(game.save()).toBe(before);
      expect(stored()!.events).toEqual([]);
      // 重試同一件無效提交仍是 invalid
      expect(await ops.retry()).toBeFalse();
      expect(ops.current()!.failure).toBe('invalid');
      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe('各種提交', () => {
    it('案件（H204）：玩家編號原樣保存；空白編號或未選方式 → invalid；未開案 → rejected', async () => {
      const { game, ops } = setup(false);
      playTo(game, 'day.03');
      expect(game.taskId()).toBe(TASK_DAY3);
      const before = game.save();
      expect(await ops.commitCase('H204', 'registry', ' ')).toBeFalse();
      expect(ops.current()!.failure).toBe('invalid');
      expect(await ops.commitCase('H204', '', 'H-204')).toBeFalse();
      expect(ops.current()!.failure).toBe('invalid');
      expect(await ops.commitCase('H204', 'registry', 'H-204')).toBeFalse();
      expect(ops.current()!.failure).toBe('rejected'); // 尚未開案
      expect(game.save()).toBe(before);

      game.openCase(CASE_H204);
      expect(await ops.commitCase('H204', 'supplement', 'H-2O4')).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'case', taskId: TASK_DAY3, arg: 'H-2O4', stage: 'done' }));
      expect(game.archived('H204')!.archiveCode).toBe('H-2O4');
      expect(game.archived('H204')!.caseDecision!.decisionId).toBe('supplement');
      expect(countKind(game, 'archive')).toBe(1 + 3 + 3 + 4);
    });

    it('核對回覆：逐筆審查前 → invalid；審查後 → done，只寫一次 reply.submit 並保存摘要版本', async () => {
      const { game, ops } = setup(false);
      playTo(game, 'day.02');
      expect(game.taskId()).toBe(TASK_DAY2);
      game.openReport();
      expect(await ops.submitReply('ack')).toBeFalse();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'reply', arg: 'ack', failure: 'invalid' }));
      game.setRecordReview('B102', 'release');
      game.setRecordReview('B607', 'hold');
      expect(await ops.submitReply('ack')).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'reply', taskId: TASK_DAY2, stage: 'done' }));
      expect(countKind(game, 'reply.submit')).toBe(1);
      expect(game.save()!.taskProgress[TASK_DAY2]).toEqual(jasmine.objectContaining({ reply: 'ack', reportRevision: game.night()!.reportRevision }));
      expect(await ops.submitReply('ack')).toBeFalse(); // 已交付
      expect(countKind(game, 'reply.submit')).toBe(1);
    });

    it('欄位匯入：未預覽 → invalid；預覽後 → done（arg 為實際列數），只寫一次 field-map.submit', async () => {
      const { game, ops } = setup(false);
      playTo(game, 'day.06');
      expect(game.taskId()).toBe(TASK_DAY6);
      for (const t of game.fieldMapPlan()!.targets) game.setFieldAssignment(t.id, t.sourceId);
      game.setFieldBlankPolicy('request_review');
      expect(await ops.submitFieldMap()).toBeFalse();
      expect(ops.current()!.failure).toBe('invalid');
      expect(game.previewFieldMap()?.ok).toBeTrue();
      expect(await ops.submitFieldMap()).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'field-map', taskId: TASK_DAY6, arg: '8', stage: 'done' }));
      expect(countKind(game, 'field-map.submit')).toBe(1);
      expect(await ops.submitFieldMap()).toBeFalse();
      expect(countKind(game, 'field-map.submit')).toBe(1);
    });

    it('錯誤文件處理：空白編號 → invalid；重送（仍錯 102）→ done、附加版本（待核對、checkDayId day.05）與一個 return.resubmit；同一版本不能再送，送窗口也 rejected', async () => {
      const { game, ops } = setup(false);
      toDay4IssueTask(game);

      expect(await ops.resubmitReturn(RETURN_B102, R0, '  ')).toBeFalse();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-resubmit', failure: 'invalid' }));
      expect(game.returns()[0].status).toBe('pending');
      expect(game.editableReceiptId(RETURN_B102)).toBe(R0);
      expect(await ops.resubmitReturn(RETURN_B102, R0, '102')).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-resubmit', taskId: TASK_DAY4_RETURN, arg: '102', stage: 'done' }));
      expect(game.returns()[0].status).toBe('awaiting-check');
      expect(game.returns()[0].versions).toEqual([{ index: 0, action: 'resubmit', code: '102', dayId: 'day.04', checkDayId: 'day.05' }]);
      expect(game.returns()[0].receipts.length).toBe(1); // 送出不等於結案，也沒有新回條
      expect(countKind(game, 'return.resubmit')).toBe(1);

      // 同一案已送出、待核對：再送同一版本或改送窗口都不寫入（失敗種類見「版本鎖定」）
      const after = game.save();
      expect(await ops.resubmitReturn(RETURN_B102, R0, '102')).toBeFalse();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-resubmit', stage: 'failed' }));
      expect(await ops.sendReturnToWindow(RETURN_B102, R0)).toBeFalse();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-window', stage: 'failed' }));
      expect(game.save()).toBe(after);
      expect(countKind(game, 'return.resubmit')).toBe(1);
      expect(countKind(game, 'return.window')).toBe(0);
      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('wrap');
      expect(game.returns()[0].status).toBe('awaiting-check');
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();
    });

    it('錯誤文件處理：送窗口待查 → done、待窗口回覆（未解決）、一個 return.window', async () => {
      const { game, ops } = setup(false);
      toDay4IssueTask(game);
      expect(await ops.sendReturnToWindow(RETURN_B102, R0)).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-window', taskId: TASK_DAY4_RETURN, arg: '', stage: 'done' }));
      expect(game.returns()[0].status).toBe('awaiting-window');
      expect(game.returns()[0].versions).toEqual([{ index: 0, action: 'window', code: '102', dayId: 'day.04', checkDayId: null }]);
      expect(countKind(game, 'return.window')).toBe(1);
      expect(game.taskDone()).toBeTrue();
    });

    it('處理中連點（busy）：同一案第二次重送或送窗口被擋，只保存一個版本、一個事件', async () => {
      const { game, ops } = setup(true);
      instantWait(ops);
      toDay4IssueTask(game);
      const first = ops.resubmitReturn(RETURN_B102, R0, '0102');
      expect(ops.busy()).toBeTrue();
      const second = ops.resubmitReturn(RETURN_B102, R0, '0102');
      const window = ops.sendReturnToWindow(RETURN_B102, R0);
      expect(await second).toBeFalse();
      expect(await window).toBeFalse();
      expect(ops.current()!.id).toBe(1);
      expect(await first).toBeTrue();
      expect(game.returns()[0].versions.length).toBe(1);
      expect(countKind(game, 'return.resubmit')).toBe(1);
      expect(countKind(game, 'return.window')).toBe(0);
      expect(stored()!.returns[0].versions).toEqual([{ index: 0, action: 'resubmit', code: '0102', dayId: 'day.04', checkDayId: 'day.05' }]);
    });

    it('寫入失敗 → failed storage、案件仍待修正；重試成功後恰好一個版本與事件', async () => {
      const { game, ops, repo } = setup(false);
      toDay4IssueTask(game);
      const before = game.save();
      const persist = spyOn(repo, 'persist').and.returnValue(STORAGE.writeIssue);
      expect(await ops.resubmitReturn(RETURN_B102, R0, '0102')).toBeFalse();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-resubmit', stage: 'failed', failure: 'storage' }));
      expect(game.save()).toBe(before);
      expect(game.returns()[0].status).toBe('pending');
      expect(stored()!.returns[0].status).toBe('pending');
      persist.and.callThrough();
      expect(await ops.retry()).toBeTrue();
      expect(game.returns()[0].versions.length).toBe(1);
      expect(countKind(game, 'return.resubmit')).toBe(1);
      expect(stored()!.returns[0].status).toBe('awaiting-check');
      expect(await ops.retry()).toBeFalse();
      expect(countKind(game, 'return.resubmit')).toBe(1);
    });

    it('文件問題頁：目前工作不是錯誤文件處理（Day 5 歸檔）也能經 operation 重送；operation 記下當時的目前工作；隔一工作日才核對', async () => {
      const { game, ops } = setup(false);
      toDay4IssueTask(game);
      expect(await ops.resubmitReturn(RETURN_B102, R0, '103')).toBeTrue();
      finishToday(game);
      game.advanceDay();
      // Day 5：下游核對 103 仍錯 → 再次退回（待修正、下一工作日才排入）
      expect(game.returns()[0]).toEqual(jasmine.objectContaining({ status: 'pending', dueDayId: 'day.06' }));
      expect(game.returns()[0].receipts.length).toBe(2);
      game.startDay();
      expect(game.task()!.kind).toBe('archive');
      expect(game.dayTasks().map((t) => t.kind)).toEqual(['archive']);

      expect(game.editableReceiptId(RETURN_B102)).toBe(R1);
      expect(await ops.resubmitReturn(RETURN_B102, R1, '0102')).toBeTrue();
      expect(ops.current()).toEqual(jasmine.objectContaining({ kind: 'return-resubmit', taskId: 'task.day5.archive', arg: '0102', stage: 'done' }));
      expect(game.taskId()).toBe('task.day5.archive'); // 不改變目前工作
      expect(game.returns()[0].status).toBe('awaiting-check');
      expect(game.returns()[0].versions[1]).toEqual({ index: 1, action: 'resubmit', code: '0102', dayId: 'day.05', checkDayId: 'day.06' });
      expect(await ops.resubmitReturn(RETURN_B102, R1, '0102')).toBeFalse();
      expect(ops.current()!.stage).toBe('failed');
      expect(countKind(game, 'return.resubmit')).toBe(2);
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();

      finishToday(game);
      expect(game.returns()[0].status).toBe('awaiting-check');
      game.advanceDay();
      expect(game.returns()[0].status).toBe('resolved');
      expect(game.returns()[0].receipts.map((r) => r.kind)).toEqual(['returned', 'returned', 'resolved']);
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();
    });
  });

  describe('版本鎖定（R12）：操作引用的回條必須仍是案件目前可修訂的回條', () => {
    /** 預期被規則拒絕：failed rejected、不寫入（repository 沒被呼叫）、存檔物件不變。 */
    async function expectRejected(ctx: Ctx, run: () => Promise<boolean>, label: string): Promise<void> {
      const before = ctx.game.save();
      const raw = localStorage.getItem(SAVE_KEY);
      const persist = jasmine.isSpy(ctx.repo.persist) ? (ctx.repo.persist as jasmine.Spy) : spyOn(ctx.repo, 'persist').and.callThrough();
      persist.calls.reset();
      expect(await run()).withContext(label).toBeFalse();
      expect(ctx.ops.current()!.stage).withContext(label).toBe('failed');
      // R12 契約：過期回條是「規則不允許」（rejected），不是結構／型別不符（invalid）
      expect(ctx.ops.current()!.failure).withContext(`${label}：過期回條應為 rejected`).toBe('rejected');
      expect(persist).withContext(label).not.toHaveBeenCalled();
      expect(ctx.game.save()).withContext(label).toBe(before);
      expect(localStorage.getItem(SAVE_KEY)).withContext(label).toBe(raw);
    }

    it('過期回條（不存在的下一張、已送出待核對、再次退回後的舊回條、待窗口、已結案）→ failed rejected、不寫入', async () => {
      const ctx = setup(false);
      const { game, ops } = ctx;
      toDay4IssueTask(game);
      // 待修正：只有 #0 可修訂
      await expectRejected(ctx, () => ops.resubmitReturn(RETURN_B102, R1, '0102'), '尚不存在的 #1 重送');
      await expectRejected(ctx, () => ops.sendReturnToWindow(RETURN_B102, R1), '尚不存在的 #1 送窗口');
      await expectRejected(ctx, () => ops.resubmitReturn('return.nope', R0, '0102'), '未知案件');
      // 已送出、待核對：#0 只能檢閱
      expect(await ops.resubmitReturn(RETURN_B102, R0, '103')).toBeTrue();
      await expectRejected(ctx, () => ops.resubmitReturn(RETURN_B102, R0, '0102'), '待核對時用 #0 重送');
      await expectRejected(ctx, () => ops.sendReturnToWindow(RETURN_B102, R0), '待核對時用 #0 送窗口');
      finishToday(game);
      game.advanceDay();
      game.startDay();
      // Day 5 再次退回：可修訂的是 #1，舊的 #0 附件過期
      expect(game.editableReceiptId(RETURN_B102)).toBe(R1);
      await expectRejected(ctx, () => ops.resubmitReturn(RETURN_B102, R0, '0102'), '再次退回後用 #0 重送');
      await expectRejected(ctx, () => ops.sendReturnToWindow(RETURN_B102, R0), '再次退回後用 #0 送窗口');
      // 待窗口回覆：#1 也只能檢閱
      expect(await ops.sendReturnToWindow(RETURN_B102, R1)).toBeTrue();
      expect(game.returns()[0].status).toBe('awaiting-window');
      await expectRejected(ctx, () => ops.resubmitReturn(RETURN_B102, R1, '0102'), '待窗口時用 #1 重送');
      await expectRejected(ctx, () => ops.sendReturnToWindow(RETURN_B102, R1), '待窗口時用 #1 送窗口');
      expect(countKind(game, 'return.resubmit')).toBe(1);
      expect(countKind(game, 'return.window')).toBe(1);
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();
    });

    it('已結案（收件回條）→ 任何回條的重送／送窗口都 rejected、不寫入', async () => {
      const ctx = setup(false);
      const { game, ops } = ctx;
      toDay4IssueTask(game);
      expect(await ops.resubmitReturn(RETURN_B102, R0, '0102')).toBeTrue();
      finishToday(game);
      game.advanceDay();
      game.startDay();
      expect(game.returns()[0].status).toBe('resolved');
      expect(game.editableReceiptId(RETURN_B102)).toBeNull();
      for (const rid of [R0, R1]) {
        await expectRejected(ctx, () => ops.resubmitReturn(RETURN_B102, rid, '0102'), `已結案用 ${rid} 重送`);
        await expectRejected(ctx, () => ops.sendReturnToWindow(RETURN_B102, rid), `已結案用 ${rid} 送窗口`);
      }
    });

    it('第一段節奏中（驗證前）另一個視窗先送出 → 以 rejected 結束，不覆寫新版本', async () => {
      const ctx = setup(true);
      const { game, ops } = ctx;
      toDay4IssueTask(game);
      let changed = false;
      instantWait(ops, () => {
        if (changed || ops.current()!.stage !== 'received') return;
        changed = true;
        expect(game.resubmitReturnStrict(RETURN_B102, R0, '0102')).toBe('ok'); // 另一個視窗
      });
      expect(await ops.resubmitReturn(RETURN_B102, R0, '103')).toBeFalse();
      expect(changed).toBeTrue();
      expect(ops.current()!.stage).toBe('failed');
      expect(ops.current()!.failure).withContext('處理途中案件已被送出：應為 rejected（work-operations.service.ts 註解與 R12 契約）').toBe('rejected');
      expect(game.returns()[0].versions).toEqual([{ index: 0, action: 'resubmit', code: '0102', dayId: 'day.04', checkDayId: 'day.05' }]);
      expect(countKind(game, 'return.resubmit')).toBe(1);
    });

    for (const kind of ['resubmit', 'window'] as const) {
      it(`${kind}：驗證通過後、保存前案件被另一個視窗送出 → 保存階段重新確認 → failed rejected；另一個視窗的新版本不被覆寫`, async () => {
        const ctx = setup(true);
        const { game, ops } = ctx;
        toDay4IssueTask(game);
        let changedAt: OperationStage | null = null;
        instantWait(ops, () => {
          // processing 之後、saving 之前的那段節奏（驗證已通過）
          if (changedAt !== null || ops.current()!.stage !== 'processing') return;
          changedAt = ops.current()!.stage;
          expect(game.resubmitReturnStrict(RETURN_B102, R0, '0102')).toBe('ok');
        });
        const run = kind === 'resubmit' ? ops.resubmitReturn(RETURN_B102, R0, '103') : ops.sendReturnToWindow(RETURN_B102, R0);
        expect(await run).toBeFalse();
        expect<OperationStage | null>(changedAt).toBe('processing');
        expect(ops.current()).toEqual(
          jasmine.objectContaining({
            kind: kind === 'resubmit' ? 'return-resubmit' : 'return-window',
            stage: 'failed',
            trail: ['received', 'validating', 'validated', 'processing', 'saving', 'failed'],
            failure: 'rejected',
          }),
        );
        const newer = [{ index: 0, action: 'resubmit', code: '0102', dayId: 'day.04', checkDayId: 'day.05' }];
        expect(game.returns()[0].status).toBe('awaiting-check');
        expect(game.returns()[0].versions).toEqual(newer as never);
        expect(stored()!.returns[0].versions).toEqual(newer as never);
        expect(countKind(game, 'return.resubmit')).toBe(1);
        expect(countKind(game, 'return.window')).toBe(0);
        // 失敗的操作重試也不會覆寫（仍是過期回條）
        expect(await ops.retry()).toBeFalse();
        expect(game.returns()[0].versions).toEqual(newer as never);
        expect(countKind(game, 'return.resubmit')).toBe(1);
        expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();
      });
    }

    it('成功的重送移除該回條的修訂草稿；寫入失敗時草稿保留', async () => {
      const ctx = setup(false);
      const { game, ops, repo } = ctx;
      toDay4IssueTask(game);
      game.setIssueDraft(R0, '0102');
      expect(game.issueDraft(R0)).toBe('0102');
      const persist = spyOn(repo, 'persist').and.returnValue(STORAGE.writeIssue);
      expect(await ops.resubmitReturn(RETURN_B102, R0, '0102')).toBeFalse();
      expect(ops.current()!.failure).toBe('storage');
      expect(game.issueDraft(R0)).toBe('0102');
      expect(stored()!.issueDrafts).toEqual({ [R0]: '0102' });
      persist.and.callThrough();
      expect(await ops.retry()).toBeTrue();
      expect(game.issueDraft(R0)).toBeUndefined();
      expect(stored()!.issueDrafts).toEqual({});
      expect(isValidSave(stored(), DAY_DIRECTORY)).toBeTrue();
    });
  });
});
