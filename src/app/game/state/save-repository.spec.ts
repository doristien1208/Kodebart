import { RECORDS } from '../content/records';
import { STORAGE } from '../content/text';
import { BATCH_DAY01_ARCHIVE, DAY_01, DAY_02 } from '../core/day-map';
import { createSave, setDraft } from '../core/rules';
import { isValidSave } from '../core/save-schema';
import { SaveV2, SaveV3 } from '../core/types';
import { SAVE_KEY, SaveRepository } from './save-repository';

/** 一份合法的 v2 舊檔（已完成 Day 1、走到 day2）；用來驗證載入時會轉換而不是拒絕。 */
const legacyDay2: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day2',
  archived: {
    H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
    B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
    B607: { archiveCode: '0607', refusal: true, origin: 'source' },
  },
  drafts: { B102: { value: '0102', policy: 'default_false' } },
  night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
  evidence: { reportOpened: true, receiptOpened: false },
  events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source' } }],
};

const legacyDay1: SaveV2 = {
  version: 2,
  seed: 7,
  phase: 'day1',
  archived: { B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } },
  drafts: { H17: { value: 'H-1' } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [],
};

describe('SaveRepository', () => {
  let repo: SaveRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new SaveRepository();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('SAVE_KEY 仍為 kodebart-save-v2（版本號寫在內容裡，換 key 會讓舊進度消失）', () => {
    expect(SAVE_KEY).toBe('kodebart-save-v2');
  });

  it('沒存檔 → { save: null, issue: "", migrated: false }', () => {
    expect(repo.load()).toEqual({ save: null, issue: '', migrated: false });
  });

  it('persist 後 load 回同內容、issue 空字串、migrated false', () => {
    const save: SaveV3 = setDraft(createSave(42), 'B102', { value: '0102', policy: 'request_review' });
    expect(repo.persist(save)).toBe('');
    expect(localStorage.getItem(SAVE_KEY)).toBe(JSON.stringify(save));
    const loaded = repo.load();
    expect(loaded.issue).toBe('');
    expect(loaded.migrated).toBeFalse();
    expect(loaded.save).toEqual(save);
    expect(loaded.save).not.toBe(save);
    expect(loaded.save!.version).toBe(3);
  });

  it('再次 persist 會覆寫前一份', () => {
    repo.persist(createSave(1));
    repo.persist(createSave(2));
    expect(repo.load().save?.seed).toBe(2);
  });

  /* ---------- v2 → v3 遷移路徑（KB-R4-05） ---------- */

  describe('v2 舊檔遷移', () => {
    it('合法 v2 → migrated true、save.version 3、內容進到 Day 1 批次', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay2));
      const loaded = repo.load();

      expect(loaded.issue).toBe('');
      expect(loaded.migrated).toBeTrue();
      expect(loaded.save).not.toBeNull();
      const save = loaded.save!;
      expect(save.version).toBe(3);
      expect(save.phase).toBe('day2');
      expect(save.dayId).toBe(DAY_02);
      expect(save.seed).toBe(42);
      expect(save.readMessages).toEqual([]);
      expect(save.night).toEqual(legacyDay2.night!);

      const batch = save.batches[BATCH_DAY01_ARCHIVE]!;
      expect(Object.keys(batch.archived).sort()).toEqual(['B102', 'B607', 'H17']);
      expect(batch.archived['B102']!.archiveCode).toBe('0102');
      expect(batch.archived['B102']!.source).toEqual({
        name: null,
        code: '0102',
        refusal: null,
        refusalApplies: true,
      });
      expect(batch.drafts).toEqual({ B102: { value: '0102', policy: 'default_false' } });
      expect(isValidSave(save, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
    });

    it('day1 的 v2 舊檔也會轉換，dayId 為 day.01', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay1));
      const loaded = repo.load();
      expect(loaded.migrated).toBeTrue();
      expect(loaded.save!.dayId).toBe(DAY_01);
      expect(loaded.save!.phase).toBe('day1');
      expect(loaded.save!.batches[BATCH_DAY01_ARCHIVE]!.drafts).toEqual({ H17: { value: 'H-1' } });
    });

    it('load() 本身不寫檔：localStorage 仍是原本的 v2 字串（由呼叫端決定何時寫回）', () => {
      const raw = JSON.stringify(legacyDay2);
      localStorage.setItem(SAVE_KEY, raw);
      repo.load();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('寫回轉換結果後再載入不會再次遷移', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyDay2));
      const first = repo.load();
      expect(first.migrated).toBeTrue();
      expect(repo.persist(first.save!)).toBe('');

      const second = repo.load();
      expect(second.migrated).toBeFalse();
      expect(second.issue).toBe('');
      // 與「實際存下去的內容」比對：migrateSave 會留下 reply: undefined 這種自有屬性，
      // JSON 序列化時會被丟掉，所以比對序列化後的形狀才是真正的存檔內容。
      expect(second.save).toEqual(JSON.parse(JSON.stringify(first.save!)));
      expect(JSON.stringify(second.save)).toBe(JSON.stringify(first.save!));
    });

    it('v2 內容與來源資料不符 → 不轉換，視為讀取失敗', () => {
      const broken = JSON.stringify({
        ...legacyDay2,
        archived: { ...legacyDay2.archived, B102: { archiveCode: '102', refusal: false, origin: 'defaulted' } },
      });
      localStorage.setItem(SAVE_KEY, broken);
      expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
      expect(localStorage.getItem(SAVE_KEY)).toBe(broken);
    });
  });

  /* ---------- 讀取失敗 ---------- */

  it('壞 JSON "{" → save null、issue readIssue，且不會被覆蓋', () => {
    localStorage.setItem(SAVE_KEY, '{');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
    expect(localStorage.getItem(SAVE_KEY)).toBe('{');
  });

  it('合法 JSON 但 schema 不符 {"version":3} → save null、issue readIssue，且不會被覆蓋', () => {
    localStorage.setItem(SAVE_KEY, '{"version":3}');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
    expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":3}');
  });

  it('只有 version 的 v2 殘骸 {"version":2} → 不符 v2 形狀，同樣是讀取失敗', () => {
    localStorage.setItem(SAVE_KEY, '{"version":2}');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
    expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":2}');
  });

  it('v1 舊存檔（version 1＋archiveName）→ save null、issue readIssue，且原字串不被覆蓋', () => {
    const v1 = JSON.stringify({
      version: 1,
      seed: 42,
      phase: 'day1',
      archived: { B102: { archiveName: 102, refusal: false, origin: 'defaulted' } },
      drafts: {},
      events: [],
      evidence: { reportOpened: false, receiptOpened: false },
    });
    localStorage.setItem(SAVE_KEY, v1);
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
    expect(localStorage.getItem(SAVE_KEY)).toBe(v1);
  });

  it('合法 JSON 但為 null／陣列 → save null、issue readIssue', () => {
    localStorage.setItem(SAVE_KEY, 'null');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
    localStorage.setItem(SAVE_KEY, '[]');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
  });

  it('setItem 拋錯 → persist 回傳 writeIssue，不拋例外', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');
    expect(repo.persist(createSave(1))).toBe(STORAGE.writeIssue);
  });

  it('getItem 拋錯 → load 回 issue readIssue，不拋例外', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue, migrated: false });
  });

  it('clear() 移除 key', () => {
    repo.persist(createSave(1));
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    repo.clear();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(repo.load()).toEqual({ save: null, issue: '', migrated: false });
  });

  it('clear() 只移除自己的 key', () => {
    localStorage.setItem('other', 'x');
    repo.persist(createSave(1));
    repo.clear();
    expect(localStorage.getItem('other')).toBe('x');
  });

  it('removeItem 拋錯 → clear() 不拋例外', () => {
    spyOn(Storage.prototype, 'removeItem').and.throwError('blocked');
    expect(() => repo.clear()).not.toThrow();
  });
});
