import { RECORDS } from '../content/records';
import { isValidSave } from './save-schema';
import { SaveV2 } from './types';

/** 存檔 v2：人員編號以字串逐字保存，舊的 v1（archiveName、整數編號）一律視為不合法。 */
const initial: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day1',
  archived: {},
  drafts: {},
  events: [],
  evidence: { reportOpened: false, receiptOpened: false },
};

const archivedAll: SaveV2['archived'] = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
  B607: { archiveCode: '0607', refusal: true, origin: 'source' },
};

const day2: SaveV2 = {
  ...initial,
  phase: 'day2',
  archived: archivedAll,
  night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
};

const end: SaveV2 = { ...day2, phase: 'end', reply: 'review' };

const valid = (s: unknown): boolean => isValidSave(s, RECORDS);

describe('isValidSave：合法存檔', () => {
  const cases: Array<[string, unknown]> = [
    ['初始存檔', initial],
    ['day1 帶合法草稿（含 policy）', { ...initial, drafts: { B102: { value: '0102', policy: 'default_false' } } }],
    ['day1 帶合法草稿（無 policy）', { ...initial, drafts: { H17: { value: 'H-1' } } }],
    ['day1 已歸檔一筆', { ...initial, archived: { B102: archivedAll['B102'] } }],
    ['overnight 三筆齊、night 尚未判定', { ...initial, phase: 'overnight', archived: archivedAll }],
    ['day2 三筆齊＋night（介入，revision 2）', day2],
    ['day2 三筆齊＋night（無介入，revision 1）', { ...day2, night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 } }],
    ['day2 B102 為 review／null', { ...day2, archived: { ...archivedAll, B102: { archiveCode: '0102', refusal: null, origin: 'review' } } }],
    ['end＋reply review', end],
    ['end＋reply ack', { ...day2, phase: 'end', reply: 'ack' }],
    ['end＋reply ask', { ...day2, phase: 'end', reply: 'ask' }],
    ['seed 為 0', { ...initial, seed: 0 }],
    ['seed 為 MAX_SEED', { ...initial, seed: 4294967295 }],
    ['帶事件', { ...initial, events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'B102' } }] }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(valid(save)).toBeTrue());
  }
});

describe('isValidSave：不合法存檔', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['空物件', {}],
    ['陣列', []],
    ['字串', 'save'],
    ['phase day2 卻沒歸檔完', { ...initial, phase: 'day2' }],
    ['phase overnight 卻沒歸檔完', { ...initial, phase: 'overnight' }],
    ['archived 是陣列', { ...initial, archived: [] }],
    ['drafts 是陣列', { ...initial, drafts: [] }],
    ['events 不是陣列', { ...initial, events: {} }],
    ['seed -1', { ...initial, seed: -1 }],
    ['seed 非整數', { ...initial, seed: 1.5 }],
    ['seed 為字串', { ...initial, seed: '42' }],
    ['evidence 空物件', { ...initial, evidence: {} }],
    ['evidence 欄位非布林', { ...initial, evidence: { reportOpened: 'yes', receiptOpened: false } }],
    ['drafts.B102.value 是數字', { ...initial, drafts: { B102: { value: 5 } } }],
    ['drafts.B102.policy 未知', { ...initial, drafts: { B102: { value: '0102', policy: 'nope' } } }],
    ['version 1（v1 舊檔）', { ...initial, version: 1 }],
    ['version 3', { ...initial, version: 3 }],
    ['version 為字串 "2"', { ...initial, version: '2' }],
    ['version 缺', { ...initial, version: undefined }],
    ['phase 未知', { ...initial, phase: 'day3' }],
    ['archived 含未知 key', { ...initial, archived: { X99: { archiveCode: '99', refusal: null, origin: 'source' } } }],
    ['v1 形狀：archived 用 archiveName', { ...initial, archived: { B102: { archiveName: 102, refusal: false, origin: 'defaulted' } } }],
    ['archived.B102.archiveCode 為數字 102', { ...initial, archived: { B102: { archiveCode: 102, refusal: false, origin: 'defaulted' } } }],
    ['archived.B102.archiveCode 為 "102"（少了前導零）', { ...initial, archived: { B102: { archiveCode: '102', refusal: false, origin: 'defaulted' } } }],
    ['archived.B102.archiveCode 缺', { ...initial, archived: { B102: { refusal: false, origin: 'defaulted' } } }],
    ['archived.H17.archiveCode 不等於來源編號', { ...initial, archived: { H17: { archiveCode: 'H17', refusal: null, origin: 'source' } } }],
    ['archived.H17.archiveCode 為姓名', { ...initial, archived: { H17: { archiveCode: '林予安', refusal: null, origin: 'source' } } }],
    ['archived.B102.origin 未知', { ...initial, archived: { B102: { archiveCode: '0102', refusal: false, origin: 'manual' } } }],
    ['archived.B102.refusal 非布林亦非 null', { ...initial, archived: { B102: { archiveCode: '0102', refusal: 'no', origin: 'defaulted' } } }],
    ['archived.B102 不是物件', { ...initial, archived: { B102: '0102' } }],
    ['phase day2 三筆齊但 night 缺', { ...initial, phase: 'day2', archived: archivedAll }],
    ['night.reportRevision 與 intervention 不一致（true 卻 1）', { ...day2, night: { intervention: true, smallTalkVariant: 1, reportRevision: 1 } }],
    ['night.reportRevision 與 intervention 不一致（false 卻 2）', { ...day2, night: { intervention: false, smallTalkVariant: 0, reportRevision: 2 } }],
    ['night.smallTalkVariant 為 2', { ...day2, night: { intervention: true, smallTalkVariant: 2, reportRevision: 2 } }],
    ['night.intervention 非布林', { ...day2, night: { intervention: 'yes', smallTalkVariant: 0, reportRevision: 2 } }],
    ['phase end 但 reply 缺', { ...day2, phase: 'end' }],
    ['phase end 但 reply 為 "x"', { ...day2, phase: 'end', reply: 'x' }],
    ['phase end 但 night 缺', { ...initial, phase: 'end', archived: archivedAll, reply: 'ack' }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(valid(save)).toBeFalse());
  }
});

describe('isValidSave：JSON 往返', () => {
  it('初始存檔往返仍合法', () => {
    expect(valid(JSON.parse(JSON.stringify(initial)))).toBeTrue();
  });

  it('day2 存檔往返仍合法且內容相等', () => {
    const restored: unknown = JSON.parse(JSON.stringify(day2));
    expect(valid(restored)).toBeTrue();
    expect(restored).toEqual(day2);
  });

  it('end 存檔往返仍合法且內容相等', () => {
    const restored: unknown = JSON.parse(JSON.stringify(end));
    expect(valid(restored)).toBeTrue();
    expect(restored).toEqual(end);
  });

  it('往返後 B102 的編號仍是字串 "0102"', () => {
    const restored = JSON.parse(JSON.stringify(day2)) as SaveV2;
    expect(restored.archived['B102']!.archiveCode).toBe('0102');
    expect(typeof restored.archived['B102']!.archiveCode).toBe('string');
  });

  it('不改變傳入的物件', () => {
    const copy = JSON.parse(JSON.stringify(day2));
    valid(day2);
    expect(day2).toEqual(copy);
  });
});
