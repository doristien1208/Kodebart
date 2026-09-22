import { STORAGE } from '../content/text';
import { createSave, setDraft } from '../core/rules';
import { SaveV2 } from '../core/types';
import { SAVE_KEY, SaveRepository } from './save-repository';

describe('SaveRepository', () => {
  let repo: SaveRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new SaveRepository();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('SAVE_KEY 為 kodebart-save-v2', () => {
    expect(SAVE_KEY).toBe('kodebart-save-v2');
  });

  it('沒存檔 → { save: null, issue: "" }', () => {
    expect(repo.load()).toEqual({ save: null, issue: '' });
  });

  it('persist 後 load 回同內容、issue 空字串', () => {
    const save: SaveV2 = setDraft(createSave(42), 'B102', { value: '0102', policy: 'request_review' });
    expect(repo.persist(save)).toBe('');
    expect(localStorage.getItem(SAVE_KEY)).toBe(JSON.stringify(save));
    const loaded = repo.load();
    expect(loaded.issue).toBe('');
    expect(loaded.save).toEqual(save);
    expect(loaded.save).not.toBe(save);
  });

  it('再次 persist 會覆寫前一份', () => {
    repo.persist(createSave(1));
    repo.persist(createSave(2));
    expect(repo.load().save?.seed).toBe(2);
  });

  it('壞 JSON "{" → save null、issue readIssue，且不會被覆蓋', () => {
    localStorage.setItem(SAVE_KEY, '{');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue });
    expect(localStorage.getItem(SAVE_KEY)).toBe('{');
  });

  it('合法 JSON 但 schema 不符 {"version":2} → save null、issue readIssue，且不會被覆蓋', () => {
    localStorage.setItem(SAVE_KEY, '{"version":2}');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue });
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
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue });
    expect(localStorage.getItem(SAVE_KEY)).toBe(v1);
  });

  it('合法 JSON 但為 null／陣列 → save null、issue readIssue', () => {
    localStorage.setItem(SAVE_KEY, 'null');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue });
    localStorage.setItem(SAVE_KEY, '[]');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue });
  });

  it('setItem 拋錯 → persist 回傳 writeIssue，不拋例外', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');
    expect(repo.persist(createSave(1))).toBe(STORAGE.writeIssue);
  });

  it('getItem 拋錯 → load 回 issue readIssue，不拋例外', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    expect(repo.load()).toEqual({ save: null, issue: STORAGE.readIssue });
  });

  it('clear() 移除 key', () => {
    repo.persist(createSave(1));
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    repo.clear();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(repo.load()).toEqual({ save: null, issue: '' });
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
