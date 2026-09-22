import { TestBed } from '@angular/core/testing';
import { RECORDS } from '../content/records';
import { DAY1, STORAGE } from '../content/text';
import { BATCH_DAY01_ARCHIVE, DAY_01, DAY_02 } from '../core/day-map';
import { isValidSeed } from '../core/rand';
import { currentBatchId, snapshotOf } from '../core/rules';
import { isValidSave } from '../core/save-schema';
import { ArchivedRecord, BatchState, MissingPolicy, RecordKey, SaveV2, SaveV3, ValidationOk } from '../core/types';
import { VALIDATION_MESSAGES } from '../core/validate';
import { GameStateService } from './game-state.service';
import { SAVE_KEY, SaveRepository } from './save-repository';

/** service 在建構時讀 localStorage，所以每次都要重建 injector 才能拿到乾淨的實例。 */
function freshService(): GameStateService {
  TestBed.resetTestingModule();
  return TestBed.inject(GameStateService);
}

function okOf(game: GameStateService, key: RecordKey): ValidationOk {
  const r = game.validate(key);
  if (!r.ok) throw new Error(`validation for ${key} failed: ${r.error}`);
  return r;
}

function snapOf(key: RecordKey) {
  const r = RECORDS.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return snapshotOf(r);
}

function archiveAll(game: GameStateService, b102Policy: MissingPolicy): void {
  game.updateDraft('H17', { value: 'H-17' });
  game.archive('H17', okOf(game, 'H17'));
  game.updateDraft('B102', { value: '0102', policy: b102Policy });
  game.archive('B102', okOf(game, 'B102'));
  game.updateDraft('B607', { value: '0607' });
  game.archive('B607', okOf(game, 'B607'));
}

function playToDay2(game: GameStateService, b102Policy: MissingPolicy): void {
  game.newGame();
  archiveAll(game, b102Policy);
  expect(game.completeDay1()).toBeTrue();
  game.advanceToDay2();
  expect(game.phase()).toBe('day2');
}

function stored(): SaveV3 | null {
  const raw = localStorage.getItem(SAVE_KEY);
  return raw === null ? null : (JSON.parse(raw) as SaveV3);
}

/** localStorage 內目前批次的內容（歸檔與草稿都以批次為範圍）。 */
function storedBatch(): BatchState {
  const s = stored();
  if (s === null) throw new Error('localStorage 沒有存檔');
  return s.batches[currentBatchId(s)] ?? { archived: {}, drafts: {} };
}

function storedIsValid(): boolean {
  const s = stored();
  return s !== null && isValidSave(s, RECORDS, currentBatchId(s));
}

/** 一份合法的 v2 舊檔（已走到 day2，摘要已開）。 */
const legacyDay2: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day2',
  archived: {
    H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
    B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
    B607: { archiveCode: '0607', refusal: true, origin: 'source' },
  },
  drafts: {},
  night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
  evidence: { reportOpened: true, receiptOpened: false },
  events: [],
};

/** 一份還在 Day 1 的 v2 舊檔。 */
const legacyDay1: SaveV2 = {
  version: 2,
  seed: 7,
  phase: 'day1',
  archived: { B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } },
  drafts: { H17: { value: 'H-1' } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [],
};

describe('GameStateService', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    game = freshService();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('初始狀態', () => {
    it('hasSave false、phase null、day 1、statusText 為 STORAGE.saved', () => {
      expect(game.hasSave()).toBeFalse();
      expect(game.save()).toBeNull();
      expect(game.phase()).toBeNull();
      expect(game.day()).toBe(1);
      expect(game.storageIssue()).toBe('');
      expect(game.status()).toBe('');
      expect(game.statusText()).toBe(STORAGE.saved);
      expect(game.needsOverwriteConfirm()).toBeFalse();
    });

    it('衍生 signals 在無存檔時皆為空值', () => {
      expect(game.archivedCount()).toBe(0);
      expect(game.allArchived()).toBeFalse();
      expect(game.night()).toBeNull();
      expect(game.reply()).toBeNull();
      expect(game.evidence()).toEqual({ reportOpened: false, receiptOpened: false });
      expect(game.arranged()).toBeFalse();
      expect(game.archived('B102')).toBeUndefined();
      expect(game.draft('B102')).toEqual({ value: '' });
      expect(game.records).toBe(RECORDS);
      expect(game.dayId()).toBeNull();
      expect(game.batchId()).toBeNull();
      expect(game.isMessageRead('msg.a')).toBeFalse();
    });

    it('totalRecords 由資料集合計算，不是寫死的 3', () => {
      expect(game.totalRecords()).toBe(RECORDS.length);
      expect(game.totalRecords()).toBe(game.records.length);
      // 無存檔時總筆數仍有效，已處理筆數才是 0。
      expect(game.archivedCount()).toBe(0);
    });

    it('無存檔時的操作不拋例外也不建立存檔', () => {
      game.updateDraft('B102', { value: '0102' });
      expect(game.completeDay1()).toBeFalse();
      game.advanceToDay2();
      game.openReport();
      game.openReceipt();
      game.markMessagesRead(['msg.a']);
      expect(game.canReply('ack')).toBeFalse();
      expect(game.submitReply('ack')).toBeFalse();
      expect(game.hasSave()).toBeFalse();
      expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    });

    it('record() 回傳來源資料', () => {
      expect(game.record('B102')).toEqual({
        key: 'B102',
        name: null,
        code: '0102',
        refusal: null,
        refusalApplies: true,
      });
      expect(game.record('H17')).toEqual({
        key: 'H17',
        name: '林予安',
        code: 'H-17',
        refusal: null,
        refusalApplies: false,
      });
    });

    it('record() 對不在集合內的 key 仍然 throw（RecordKey 放寬為 string 後的保護）', () => {
      expect(() => game.record('NOPE')).toThrowError(/Unknown record NOPE/);
      expect(game.archived('NOPE')).toBeUndefined();
      expect(game.draft('NOPE')).toEqual({ value: '' });
    });
  });

  describe('newGame', () => {
    it('hasSave true、phase day1、day.01 批次、seed 合法、已寫入 localStorage', () => {
      game.newGame();
      expect(game.hasSave()).toBeTrue();
      expect(game.phase()).toBe('day1');
      expect(game.day()).toBe(1);
      expect(game.dayId()).toBe(DAY_01);
      expect(game.batchId()).toBe(BATCH_DAY01_ARCHIVE);
      expect(isValidSeed(game.save()!.seed)).toBeTrue();
      expect(game.storageIssue()).toBe('');
      expect(game.statusText()).toBe(STORAGE.saved);
      const persisted = stored();
      expect(persisted).not.toBeNull();
      expect(persisted).toEqual(game.save()!);
      expect(persisted!.version).toBe(3);
      expect(persisted!.readMessages).toEqual([]);
      expect(storedIsValid()).toBeTrue();
      expect(game.needsOverwriteConfirm()).toBeTrue();
    });

    it('再次 newGame 會取代既有進度並清除 status', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.status()).toBe(DAY1.statusArchived);
      game.newGame();
      expect(game.archivedCount()).toBe(0);
      expect(game.draft('B102')).toEqual({ value: '' });
      expect(game.status()).toBe('');
      expect(game.save()!.batches).toEqual({});
    });

    it('localStorage 寫入失敗 → storageIssue 為 writeIssue，本次仍可遊玩', () => {
      spyOn(Storage.prototype, 'setItem').and.throwError('quota');
      game.newGame();
      expect(game.hasSave()).toBeTrue();
      expect(game.phase()).toBe('day1');
      expect(game.storageIssue()).toBe(STORAGE.writeIssue);
      expect(game.statusText()).toBe(STORAGE.writeIssue);
      game.updateDraft('B102', { value: '0102' });
      expect(game.draft('B102').value).toBe('0102');
    });
  });

  describe('updateDraft／validate', () => {
    beforeEach(() => game.newGame());

    it('updateDraft 寫入目前批次的草稿並持久化', () => {
      game.updateDraft('B102', { value: '0102' });
      expect(game.draft('B102').value).toBe('0102');
      expect(storedBatch().drafts['B102']).toEqual({ value: '0102' });
    });

    it('updateDraft 以 patch 合併，保留既有 value', () => {
      game.updateDraft('B102', { value: '0102' });
      game.updateDraft('B102', { policy: 'default_false' });
      expect(game.draft('B102')).toEqual({ value: '0102', policy: 'default_false' });
      expect(storedBatch().drafts['B102']).toEqual({ value: '0102', policy: 'default_false' });
    });

    it('validate 缺 policy 時回 error；設 policy 後 ok', () => {
      game.updateDraft('B102', { value: '0102' });
      const err = game.validate('B102');
      expect(err.ok).toBeFalse();
      if (!err.ok) expect(err.error).toBe(VALIDATION_MESSAGES.policyRequired);

      game.updateDraft('B102', { policy: 'default_false' });
      const ok = game.validate('B102');
      expect(ok.ok).toBeTrue();
      if (ok.ok) {
        expect(ok.code).toBe('0102');
        expect(typeof ok.code).toBe('string');
        expect(ok.refusal).toBeFalse();
        expect(ok.origin).toBe('defaulted');
      }
    });

    it('validate 讀空草稿時回 error，不寫入存檔', () => {
      expect(game.validate('H17').ok).toBeFalse();
      expect(storedBatch().drafts).toEqual({});
    });

    it('phase 非 day1 時 updateDraft 忽略', () => {
      archiveAll(game, 'default_false');
      game.completeDay1();
      const before = game.save();
      game.updateDraft('B102', { value: 'x' });
      expect(game.save()).toBe(before);
    });
  });

  describe('archive', () => {
    beforeEach(() => game.newGame());

    it('archived 有值（含來源快照）、archivedCount 1、status 為 DAY1.statusArchived、已持久化', () => {
      game.updateDraft('B102', { value: '0102', policy: 'request_review' });
      game.archive('B102', okOf(game, 'B102'));
      const expected: ArchivedRecord = {
        archiveCode: '0102',
        refusal: null,
        origin: 'review',
        source: snapOf('B102'),
      };
      expect(game.archived('B102')).toEqual(expected);
      expect(game.archivedCount()).toBe(1);
      expect(game.allArchived()).toBeFalse();
      expect(game.status()).toBe(DAY1.statusArchived);
      expect(game.statusText()).toBe(DAY1.statusArchived);
      expect(storedBatch().archived['B102']).toEqual(expected);
      expect(stored()!.events.length).toBe(1);
      expect(stored()!.events[0].payload).toEqual({
        key: 'B102',
        origin: 'review',
        batchId: BATCH_DAY01_ARCHIVE,
      });
    });

    it('來源快照記錄提交當下的來源，與玩家補值的結果分開', () => {
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      const a = game.archived('B102')!;
      expect(a.refusal).toBeFalse();
      expect(a.origin).toBe('defaulted');
      expect(a.source).toEqual({ name: null, code: '0102', refusal: null, refusalApplies: true });
    });

    it('重複 archive 不變', () => {
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      const ok = okOf(game, 'B102');
      game.archive('B102', ok);
      const before = game.save();
      game.archive('B102', { ...ok, refusal: null, origin: 'review' });
      expect(game.save()).toBe(before);
      expect(game.archived('B102')!.refusal).toBeFalse();
      expect(game.archivedCount()).toBe(1);
      expect(game.save()!.events.length).toBe(1);
    });

    it('三筆齊 → allArchived true、archivedCount 3', () => {
      archiveAll(game, 'default_false');
      expect(game.archivedCount()).toBe(3);
      expect(game.allArchived()).toBeTrue();
      expect(game.archived('H17')).toEqual({
        archiveCode: 'H-17',
        refusal: null,
        origin: 'source',
        source: snapOf('H17'),
      });
      expect(game.archived('B607')).toEqual({
        archiveCode: '0607',
        refusal: true,
        origin: 'source',
        source: snapOf('B607'),
      });
    });
  });

  describe('完整流程', () => {
    it('day1 → overnight → day2 → end（review）', () => {
      game.newGame();
      archiveAll(game, 'request_review');
      expect(game.allArchived()).toBeTrue();

      expect(game.completeDay1()).toBeTrue();
      expect(game.phase()).toBe('overnight');
      expect(game.day()).toBe(1);
      expect(game.dayId()).toBe(DAY_01);
      expect(game.status()).toBe('');
      expect(game.night()).toBeNull();
      expect(stored()!.phase).toBe('overnight');

      game.advanceToDay2();
      expect(game.phase()).toBe('day2');
      expect(game.day()).toBe(2);
      expect(game.dayId()).toBe(DAY_02);
      // Day 2 檢視的仍是 Day 1 送出的那一批
      expect(game.batchId()).toBe(BATCH_DAY01_ARCHIVE);
      expect(game.archivedCount()).toBe(RECORDS.length);
      expect(game.night()).not.toBeNull();
      expect(game.night()!.reportRevision).toBe(game.night()!.intervention ? 2 : 1);
      expect(stored()!.night).toEqual(game.night()!);

      expect(game.canReply('ack')).toBeFalse();
      expect(game.canReply('review')).toBeFalse();
      game.openReport();
      expect(game.evidence().reportOpened).toBeTrue();
      expect(game.canReply('ack')).toBeTrue();
      expect(game.canReply('ask')).toBeTrue();
      expect(game.canReply('review')).toBeFalse();
      expect(game.submitReply('review')).toBeFalse();
      expect(game.phase()).toBe('day2');

      game.openReceipt();
      expect(game.evidence().receiptOpened).toBeTrue();
      expect(game.canReply('review')).toBeTrue();

      expect(game.submitReply('review')).toBeTrue();
      expect(game.phase()).toBe('end');
      expect(game.day()).toBe(2);
      expect(game.reply()).toBe('review');
      expect(stored()!.phase).toBe('end');
      expect(stored()!.reply).toBe('review');
      expect(storedIsValid()).toBeTrue();

      expect(game.submitReply('ack')).toBeFalse();
      expect(game.reply()).toBe('review');
      expect(game.canReply('ack')).toBeFalse();
    });

    it('completeDay1 未齊三筆回 false 且 phase 不變', () => {
      game.newGame();
      game.updateDraft('H17', { value: 'H-17' });
      game.archive('H17', okOf(game, 'H17'));
      expect(game.completeDay1()).toBeFalse();
      expect(game.phase()).toBe('day1');
    });

    it('advanceToDay2 在 day1 為 no-op', () => {
      game.newGame();
      const before = game.save();
      game.advanceToDay2();
      expect(game.save()).toBe(before);
      expect(game.phase()).toBe('day1');
      expect(game.night()).toBeNull();
    });

    it('openReport／openReceipt 重複呼叫不新增變更', () => {
      playToDay2(game, 'default_false');
      game.openReport();
      const after = game.save();
      game.openReport();
      expect(game.save()).toBe(after);
      game.openReceipt();
      const after2 = game.save();
      game.openReceipt();
      expect(game.save()).toBe(after2);
    });

    it('ack 與 ask 不需先開副本', () => {
      playToDay2(game, 'default_false');
      game.openReport();
      expect(game.submitReply('ask')).toBeTrue();
      expect(game.reply()).toBe('ask');
      expect(game.phase()).toBe('end');
    });
  });

  describe('訊息已讀', () => {
    it('markMessagesRead 寫入存檔，isMessageRead 正確', () => {
      game.newGame();
      expect(game.isMessageRead('msg.a')).toBeFalse();
      game.markMessagesRead(['msg.a', 'msg.b']);
      expect(game.isMessageRead('msg.a')).toBeTrue();
      expect(game.isMessageRead('msg.b')).toBeTrue();
      expect(game.isMessageRead('msg.c')).toBeFalse();
      expect(stored()!.readMessages).toEqual(['msg.a', 'msg.b']);
      expect(storedIsValid()).toBeTrue();
    });

    // 目前失敗：核心的 markMessagesRead 不對輸入陣列本身去重（見回報）。
    it('同一批訊息 ID 有重複時只會存一次', () => {
      game.newGame();
      game.markMessagesRead(['msg.a', 'msg.b', 'msg.a']);
      expect(stored()!.readMessages).toEqual(['msg.a', 'msg.b']);
    });

    it('查看訊息不重抽亂數、不觸發工作事件', () => {
      playToDay2(game, 'request_review');
      const before = game.save()!;
      const beforeNight = before.night!;
      const beforeEvents = before.events.length;

      game.markMessagesRead(['msg.a', 'msg.b']);
      const after = game.save()!;
      expect(after).not.toBe(before);
      expect(after.phase).toBe('day2');
      expect(after.dayId).toBe(DAY_02);
      expect(after.night).toEqual(beforeNight);
      expect(after.events.length).toBe(beforeEvents);
      expect(after.events).toEqual(before.events);
      expect(after.batches).toEqual(before.batches);
      expect(game.night()).toEqual(beforeNight);
      expect(game.arranged()).toBe(beforeNight.intervention);
      expect(game.archivedCount()).toBe(RECORDS.length);
    });

    it('重複標記同一則不再寫檔（signal 物件不變）', () => {
      game.newGame();
      game.markMessagesRead(['msg.a']);
      const after = game.save();
      game.markMessagesRead(['msg.a']);
      expect(game.save()).toBe(after);
      game.markMessagesRead([]);
      expect(game.save()).toBe(after);
    });

    it('重新 inject 後已讀狀態保留', () => {
      game.newGame();
      game.markMessagesRead(['msg.a']);
      const restored = freshService();
      expect(restored.isMessageRead('msg.a')).toBeTrue();
      expect(restored.isMessageRead('msg.b')).toBeFalse();
    });
  });

  describe('從 localStorage 復原', () => {
    it('走到 day2 後重新 inject → phase 仍 day2、night 相同（刷新不重算）', () => {
      playToDay2(game, 'request_review');
      const before = game.save()!;

      const restored = freshService();
      expect(restored).not.toBe(game);
      expect(restored.hasSave()).toBeTrue();
      expect(restored.storageIssue()).toBe('');
      expect(restored.phase()).toBe('day2');
      expect(restored.day()).toBe(2);
      expect(restored.dayId()).toBe(DAY_02);
      expect(restored.night()).toEqual(before.night!);
      expect(restored.save()).toEqual(JSON.parse(JSON.stringify(before)));
      expect(restored.arranged()).toBe(game.arranged());

      // 再前進一次也不會重擲。
      restored.advanceToDay2();
      expect(restored.night()).toEqual(before.night!);
      expect(restored.save()!.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
    });

    it('歸檔後重新 inject → B102.archiveCode 仍是字串 "0102"（前導零不消失）', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.archived('B102')!.archiveCode).toBe('0102');

      const restored = freshService();
      expect(restored.hasSave()).toBeTrue();
      expect(restored.storageIssue()).toBe('');
      expect(restored.archived('B102')!.archiveCode).toBe('0102');
      expect(typeof restored.archived('B102')!.archiveCode).toBe('string');
      expect(restored.archived('B102')!.source.code).toBe('0102');
    });

    it('day1 草稿在重新 inject 後保留', () => {
      game.newGame();
      game.updateDraft('B102', { value: '01', policy: 'request_review' });
      const restored = freshService();
      expect(restored.phase()).toBe('day1');
      expect(restored.draft('B102')).toEqual({ value: '01', policy: 'request_review' });
    });

    it('end 存檔在重新 inject 後保留 reply', () => {
      playToDay2(game, 'default_false');
      game.openReport();
      game.submitReply('ack');
      const restored = freshService();
      expect(restored.phase()).toBe('end');
      expect(restored.reply()).toBe('ack');
    });
  });

  describe('v2 舊檔遷移', () => {
    it('載入合法 v2 → 可直接續玩，且 localStorage 已寫回 v3', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay2));
      const g = freshService();

      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.phase()).toBe('day2');
      expect(g.day()).toBe(2);
      expect(g.dayId()).toBe(DAY_02);
      expect(g.batchId()).toBe(BATCH_DAY01_ARCHIVE);
      expect(g.archived('B102')!.archiveCode).toBe('0102');
      expect(typeof g.archived('B102')!.archiveCode).toBe('string');
      expect(g.archived('B102')!.source).toEqual(snapOf('B102'));
      expect(g.archivedCount()).toBe(RECORDS.length);
      expect(g.allArchived()).toBeTrue();
      expect(g.night()).toEqual(legacyDay2.night!);
      expect(g.arranged()).toBeTrue();

      // 寫回後 localStorage 已是 v3
      expect(stored()!.version).toBe(3);
      expect(stored()!.readMessages).toEqual([]);
      // migrateSave 會留下 reply: undefined 這種自有屬性，序列化後才是真正寫進去的內容
      expect(stored()).toEqual(JSON.parse(JSON.stringify(g.save()!)));
      expect(storedIsValid()).toBeTrue();
    });

    it('不會每次載入都重新遷移', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay2));
      const first = freshService();
      const afterFirst = localStorage.getItem(SAVE_KEY)!;
      expect(JSON.parse(afterFirst).version).toBe(3);
      // 寫回之後，repository 直接讀 v3，不再走遷移路徑
      expect(new SaveRepository().load().migrated).toBeFalse();

      const second = freshService();
      expect(second.storageIssue()).toBe('');
      expect(second.save()).toEqual(JSON.parse(afterFirst));
      expect(JSON.stringify(second.save())).toBe(JSON.stringify(first.save()!));
      expect(localStorage.getItem(SAVE_KEY)).toBe(afterFirst);
    });

    it('day1 的 v2 舊檔遷移後可以接著歸檔並完成當日', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay1));
      const g = freshService();
      expect(g.phase()).toBe('day1');
      expect(g.dayId()).toBe(DAY_01);
      expect(g.archivedCount()).toBe(1);
      expect(g.draft('H17')).toEqual({ value: 'H-1' });
      expect(stored()!.version).toBe(3);

      g.updateDraft('H17', { value: 'H-17' });
      g.archive('H17', okOf(g, 'H17'));
      g.updateDraft('B607', { value: '0607' });
      g.archive('B607', okOf(g, 'B607'));
      expect(g.allArchived()).toBeTrue();
      expect(g.completeDay1()).toBeTrue();
      expect(g.phase()).toBe('overnight');
      expect(storedIsValid()).toBeTrue();
    });

    it('遷移後仍可走完 Day 2 回覆流程', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay2));
      const g = freshService();
      // v2 舊檔已開過摘要，證據狀態一併沿用
      expect(g.evidence()).toEqual({ reportOpened: true, receiptOpened: false });
      expect(g.canReply('ack')).toBeTrue();
      expect(g.canReply('review')).toBeFalse();
      g.openReceipt();
      expect(g.submitReply('review')).toBeTrue();
      expect(g.phase()).toBe('end');
      expect(storedIsValid()).toBeTrue();
    });
  });

  describe('壞存檔', () => {
    it('壞 JSON → hasSave false、storageIssue readIssue、needsOverwriteConfirm true、原字串不被覆蓋', () => {
      localStorage.setItem(SAVE_KEY, '{');
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.phase()).toBeNull();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(g.statusText()).toBe(STORAGE.readIssue);
      expect(g.needsOverwriteConfirm()).toBeTrue();
      expect(localStorage.getItem(SAVE_KEY)).toBe('{');
    });

    it('schema 不符 → 同樣提示且不覆蓋；newGame 後才取代並清除提示', () => {
      localStorage.setItem(SAVE_KEY, '{"version":3}');
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":3}');

      g.newGame();
      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.statusText()).toBe(STORAGE.saved);
      expect(storedIsValid()).toBeTrue();
    });

    it('殘缺的 v2（無法轉換）→ 提示且不覆蓋', () => {
      localStorage.setItem(SAVE_KEY, '{"version":2}');
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":2}');
    });
  });

  describe('arranged（四格矩陣）', () => {
    it('B102 request_review 走到 day2 → arranged() === night().intervention', () => {
      playToDay2(game, 'request_review');
      expect(game.archived('B102')!.refusal).toBeNull();
      expect(game.arranged()).toBe(game.night()!.intervention);
    });

    it('B102 default_false 走到 day2 → arranged() 恒 true', () => {
      playToDay2(game, 'default_false');
      expect(game.archived('B102')!.refusal).toBeFalse();
      expect(game.arranged()).toBeTrue();
    });

    it('day1 已用 default_false 歸檔 B102 時即為 true；request_review 在夜間判定前為 false', () => {
      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'default_false' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.arranged()).toBeTrue();

      game.newGame();
      game.updateDraft('B102', { value: '0102', policy: 'request_review' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.arranged()).toBeFalse();
    });
  });
});
