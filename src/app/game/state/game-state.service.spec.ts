import { TestBed } from '@angular/core/testing';
import { RECORDS } from '../content/records';
import { DAY1, STORAGE } from '../content/text';
import { isValidSeed } from '../core/rand';
import { isValidSave } from '../core/save-schema';
import { MissingPolicy, RecordKey, SaveV2, ValidationOk } from '../core/types';
import { VALIDATION_MESSAGES } from '../core/validate';
import { GameStateService } from './game-state.service';
import { SAVE_KEY } from './save-repository';

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

function stored(): SaveV2 | null {
  const raw = localStorage.getItem(SAVE_KEY);
  return raw === null ? null : (JSON.parse(raw) as SaveV2);
}

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
    it('hasSave true、phase day1、seed 合法、已寫入 localStorage、needsOverwriteConfirm true', () => {
      game.newGame();
      expect(game.hasSave()).toBeTrue();
      expect(game.phase()).toBe('day1');
      expect(game.day()).toBe(1);
      expect(isValidSeed(game.save()!.seed)).toBeTrue();
      expect(game.storageIssue()).toBe('');
      expect(game.statusText()).toBe(STORAGE.saved);
      const persisted = stored();
      expect(persisted).not.toBeNull();
      expect(persisted).toEqual(game.save()!);
      expect(isValidSave(persisted, RECORDS)).toBeTrue();
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

    it('updateDraft 寫入草稿並持久化', () => {
      game.updateDraft('B102', { value: '0102' });
      expect(game.draft('B102').value).toBe('0102');
      expect(stored()!.drafts['B102']).toEqual({ value: '0102' });
    });

    it('updateDraft 以 patch 合併，保留既有 value', () => {
      game.updateDraft('B102', { value: '0102' });
      game.updateDraft('B102', { policy: 'default_false' });
      expect(game.draft('B102')).toEqual({ value: '0102', policy: 'default_false' });
      expect(stored()!.drafts['B102']).toEqual({ value: '0102', policy: 'default_false' });
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
      expect(stored()!.drafts).toEqual({});
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

    it('archived 有值、archivedCount 1、status 為 DAY1.statusArchived、已持久化', () => {
      game.updateDraft('B102', { value: '0102', policy: 'request_review' });
      game.archive('B102', okOf(game, 'B102'));
      expect(game.archived('B102')).toEqual({ archiveCode: '0102', refusal: null, origin: 'review' });
      expect(game.archivedCount()).toBe(1);
      expect(game.allArchived()).toBeFalse();
      expect(game.status()).toBe(DAY1.statusArchived);
      expect(game.statusText()).toBe(DAY1.statusArchived);
      expect(stored()!.archived['B102']).toEqual({ archiveCode: '0102', refusal: null, origin: 'review' });
      expect(stored()!.events.length).toBe(1);
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
      expect(game.archived('H17')).toEqual({ archiveCode: 'H-17', refusal: null, origin: 'source' });
      expect(game.archived('B607')).toEqual({ archiveCode: '0607', refusal: true, origin: 'source' });
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
      expect(game.status()).toBe('');
      expect(game.night()).toBeNull();
      expect(stored()!.phase).toBe('overnight');

      game.advanceToDay2();
      expect(game.phase()).toBe('day2');
      expect(game.day()).toBe(2);
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
      expect(isValidSave(stored(), RECORDS)).toBeTrue();

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
      localStorage.setItem(SAVE_KEY, '{"version":2}');
      const g = freshService();
      expect(g.hasSave()).toBeFalse();
      expect(g.storageIssue()).toBe(STORAGE.readIssue);
      expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":2}');

      g.newGame();
      expect(g.hasSave()).toBeTrue();
      expect(g.storageIssue()).toBe('');
      expect(g.statusText()).toBe(STORAGE.saved);
      expect(isValidSave(stored(), RECORDS)).toBeTrue();
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
