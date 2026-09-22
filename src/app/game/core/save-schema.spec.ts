import { RECORDS } from '../content/records';
import { BATCH_DAY01_ARCHIVE, DAY_01, DAY_02 } from './day-map';
import { snapshotOf } from './rules';
import { migrateSave } from './save-migrate';
import { isValidLegacySave, isValidSave } from './save-schema';
import { ArchivedRecord, BatchState, RecordKey, SaveV2, SaveV3 } from './types';

/**
 * 存檔 v3：歸檔與草稿以批次為範圍，每筆歸檔另存來源快照。
 * v1（archiveName、整數編號）一律不合法；v2 不是現行格式，改由 isValidLegacySave 認、migrateSave 轉。
 */

function snap(key: RecordKey) {
  const r = RECORDS.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return snapshotOf(r);
}

const archivedAll: Record<RecordKey, ArchivedRecord> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source', source: snap('H17') },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snap('B102') },
  B607: { archiveCode: '0607', refusal: true, origin: 'source', source: snap('B607') },
};

function makeBatch(archived: BatchState['archived'] = {}, drafts: BatchState['drafts'] = {}): BatchState {
  return { archived, drafts };
}

/** 合法的 v3 存檔 fixture；只覆寫需要的欄位。 */
function makeSave(overrides: Partial<SaveV3> = {}): SaveV3 {
  return {
    version: 3,
    seed: 42,
    phase: 'day1',
    dayId: DAY_01,
    batches: {},
    events: [],
    evidence: { reportOpened: false, receiptOpened: false },
    readMessages: [],
    ...overrides,
  };
}

/** 帶一個 Day 1 批次的 fixture。 */
function withDay1Batch(archived: BatchState['archived'], overrides: Partial<SaveV3> = {}): SaveV3 {
  return makeSave({ batches: { [BATCH_DAY01_ARCHIVE]: makeBatch(archived) }, ...overrides });
}

const initial = makeSave();

const day2 = withDay1Batch({ ...archivedAll }, {
  phase: 'day2',
  dayId: DAY_02,
  night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
});

const end: SaveV3 = { ...day2, phase: 'end', reply: 'review' };

const valid = (s: unknown, batchId: string = BATCH_DAY01_ARCHIVE): boolean => isValidSave(s, RECORDS, batchId);

/* ---------- v3 ---------- */

describe('isValidSave：合法存檔', () => {
  const cases: Array<[string, unknown]> = [
    ['初始存檔', initial],
    [
      'day1 帶合法草稿（含 policy）',
      makeSave({ batches: { [BATCH_DAY01_ARCHIVE]: makeBatch({}, { B102: { value: '0102', policy: 'default_false' } }) } }),
    ],
    [
      'day1 帶合法草稿（無 policy）',
      makeSave({ batches: { [BATCH_DAY01_ARCHIVE]: makeBatch({}, { H17: { value: 'H-1' } }) } }),
    ],
    ['day1 已歸檔一筆', withDay1Batch({ B102: archivedAll['B102'] })],
    ['overnight 三筆齊、night 尚未判定', withDay1Batch({ ...archivedAll }, { phase: 'overnight' })],
    ['day2 三筆齊＋night（介入，revision 2）', day2],
    ['day2 三筆齊＋night（無介入，revision 1）', { ...day2, night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 } }],
    [
      'day2 B102 為 review／null',
      withDay1Batch(
        { ...archivedAll, B102: { archiveCode: '0102', refusal: null, origin: 'review', source: snap('B102') } },
        { phase: 'day2', dayId: DAY_02, night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 } },
      ),
    ],
    ['end＋reply review', end],
    ['end＋reply ack', { ...day2, phase: 'end', reply: 'ack' }],
    ['end＋reply ask', { ...day2, phase: 'end', reply: 'ask' }],
    ['seed 為 0', makeSave({ seed: 0 })],
    ['seed 為 MAX_SEED', makeSave({ seed: 4294967295 })],
    ['帶事件', makeSave({ events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'B102' } }] })],
    ['帶已讀訊息', makeSave({ readMessages: ['msg.a', 'msg.b'] })],
    ['readMessages 為空陣列', makeSave({ readMessages: [] })],
    ['dayId 為 day.02（phase day1 也只檢查是否為已知日）', makeSave({ dayId: DAY_02 })],
    ['批次存在但內容為空', makeSave({ batches: { [BATCH_DAY01_ARCHIVE]: makeBatch() } })],
    [
      '另有一個非目前批次（只檢查結構）',
      makeSave({
        batches: {
          [BATCH_DAY01_ARCHIVE]: makeBatch(),
          'batch.day03.archive': makeBatch({
            T1: { archiveCode: '0001', refusal: null, origin: 'source', source: { name: null, code: '0001', refusal: null, refusalApplies: false } },
          }),
        },
      }),
    ],
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
    ['phase day2 卻沒歸檔完', { ...initial, phase: 'day2', dayId: DAY_02, night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 } }],
    ['phase overnight 卻沒歸檔完', { ...initial, phase: 'overnight' }],
    ['phase day2 只歸檔兩筆', withDay1Batch({ H17: archivedAll['H17'], B102: archivedAll['B102'] }, { phase: 'day2', dayId: DAY_02, night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 } })],
    ['batches 缺', { ...initial, batches: undefined }],
    ['batches 是陣列', { ...initial, batches: [] }],
    ['批次不是物件', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: 'x' } }],
    ['批次缺 archived', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: { drafts: {} } } }],
    ['批次缺 drafts', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: { archived: {} } } }],
    ['批次的 archived 是陣列', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: { archived: [], drafts: {} } } }],
    ['批次的 drafts 是陣列', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: { archived: {}, drafts: [] } } }],
    ['events 不是陣列', { ...initial, events: {} }],
    ['seed -1', makeSave({ seed: -1 })],
    ['seed 非整數', makeSave({ seed: 1.5 })],
    ['seed 為字串', { ...initial, seed: '42' }],
    ['evidence 空物件', { ...initial, evidence: {} }],
    ['evidence 欄位非布林', { ...initial, evidence: { reportOpened: 'yes', receiptOpened: false } }],
    ['drafts.B102.value 是數字', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: { archived: {}, drafts: { B102: { value: 5 } } } }}],
    ['drafts.B102.policy 未知', { ...initial, batches: { [BATCH_DAY01_ARCHIVE]: { archived: {}, drafts: { B102: { value: '0102', policy: 'nope' } } } }}],
    ['version 1（v1 舊檔）', { ...initial, version: 1 }],
    ['version 2（v2 舊檔不是現行格式）', { ...initial, version: 2 }],
    ['version 4', { ...initial, version: 4 }],
    ['version 為字串 "3"', { ...initial, version: '3' }],
    ['version 缺', { ...initial, version: undefined }],
    ['phase 未知', { ...initial, phase: 'day3' }],
    ['dayId 缺', { ...initial, dayId: undefined }],
    ['dayId 未知（day.99）', { ...initial, dayId: 'day.99' }],
    ['dayId 為數字', { ...initial, dayId: 1 }],
    ['readMessages 缺', { ...initial, readMessages: undefined }],
    ['readMessages 不是陣列', { ...initial, readMessages: {} }],
    ['readMessages 含非字串', { ...initial, readMessages: ['msg.a', 3] }],
    ['目前批次含未知 key', withDay1Batch({ X99: { archiveCode: '99', refusal: null, origin: 'source', source: { name: null, code: '99', refusal: null, refusalApplies: false } } })],
    ['v1 形狀：archived 用 archiveName', withDay1Batch({ B102: { archiveName: 102, refusal: false, origin: 'defaulted' } as unknown as ArchivedRecord })],
    ['v2 形狀：archived 少了來源快照', withDay1Batch({ B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } as unknown as ArchivedRecord })],
    ['source.code 為數字 102', withDay1Batch({ B102: { ...archivedAll['B102'], source: { name: null, code: 102, refusal: null, refusalApplies: true } } as unknown as ArchivedRecord })],
    ['source.refusalApplies 缺', withDay1Batch({ B102: { ...archivedAll['B102'], source: { name: null, code: '0102', refusal: null } } as unknown as ArchivedRecord })],
    ['source.refusal 非布林亦非 null', withDay1Batch({ B102: { ...archivedAll['B102'], source: { name: null, code: '0102', refusal: 'no', refusalApplies: true } } as unknown as ArchivedRecord })],
    ['source 不是物件', withDay1Batch({ B102: { ...archivedAll['B102'], source: '0102' } as unknown as ArchivedRecord })],
    ['archived.B102.archiveCode 為數字 102', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: 102 } as unknown as ArchivedRecord })],
    ['archived.B102.archiveCode 為 "102"（少了前導零）', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: '102' } })],
    ['archived.B102.archiveCode 為空字串', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: '' } })],
    ['archived.H17.archiveCode 不等於來源編號', withDay1Batch({ H17: { ...archivedAll['H17'], archiveCode: 'H17' } })],
    ['archived.H17.archiveCode 為姓名', withDay1Batch({ H17: { ...archivedAll['H17'], archiveCode: '林予安' } })],
    ['archived.B102.origin 未知', withDay1Batch({ B102: { ...archivedAll['B102'], origin: 'manual' } as unknown as ArchivedRecord })],
    ['archived.B102.refusal 非布林亦非 null', withDay1Batch({ B102: { ...archivedAll['B102'], refusal: 'no' } as unknown as ArchivedRecord })],
    ['archived.B102 不是物件', withDay1Batch({ B102: '0102' as unknown as ArchivedRecord })],
    ['phase day2 三筆齊但 night 缺', withDay1Batch({ ...archivedAll }, { phase: 'day2', dayId: DAY_02 })],
    ['night.reportRevision 與 intervention 不一致（true 卻 1）', { ...day2, night: { intervention: true, smallTalkVariant: 1, reportRevision: 1 } }],
    ['night.reportRevision 與 intervention 不一致（false 卻 2）', { ...day2, night: { intervention: false, smallTalkVariant: 0, reportRevision: 2 } }],
    ['night.smallTalkVariant 為 2', { ...day2, night: { intervention: true, smallTalkVariant: 2, reportRevision: 2 } }],
    ['night.intervention 非布林', { ...day2, night: { intervention: 'yes', smallTalkVariant: 0, reportRevision: 2 } }],
    ['phase end 但 reply 缺', { ...day2, phase: 'end' }],
    ['phase end 但 reply 為 "x"', { ...day2, phase: 'end', reply: 'x' }],
    ['phase end 但 night 缺', withDay1Batch({ ...archivedAll }, { phase: 'end', dayId: DAY_02, reply: 'ack' })],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(valid(save)).toBeFalse());
  }
});

describe('isValidSave：批次範圍', () => {
  it('歷史批次的內容不與現行資料集合比對，只檢查結構', () => {
    const save = makeSave({
      batches: {
        [BATCH_DAY01_ARCHIVE]: makeBatch({ ...archivedAll }),
        'batch.day03.archive': makeBatch(),
      },
    });
    // Day 1 是目前批次時，內容要對得上
    expect(valid(save, BATCH_DAY01_ARCHIVE)).toBeTrue();
    // 換成 Day 3 是目前批次，Day 1 的內容不再被比對
    expect(valid(save, 'batch.day03.archive')).toBeTrue();
  });

  it('只有目前批次會被要求「key 必須在資料集合內」', () => {
    const stray: ArchivedRecord = {
      archiveCode: '0001',
      refusal: null,
      origin: 'source',
      source: { name: null, code: '0001', refusal: null, refusalApplies: false },
    };
    const save = makeSave({ batches: { 'batch.day03.archive': makeBatch({ T1: stray }) } });
    expect(valid(save, 'batch.day03.archive')).toBeFalse();
    expect(valid(save, BATCH_DAY01_ARCHIVE)).toBeTrue();
  });

  it('非目前批次的結構錯誤仍會被抓出來', () => {
    const save = makeSave({
      batches: {
        'batch.day03.archive': makeBatch({
          T1: { archiveCode: '0001', refusal: null, origin: 'source' } as unknown as ArchivedRecord,
        }),
      },
    });
    expect(valid(save, BATCH_DAY01_ARCHIVE)).toBeFalse();
  });
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

  it('往返後 B102 的編號與快照編號仍是字串 "0102"', () => {
    const restored = JSON.parse(JSON.stringify(day2)) as SaveV3;
    const b102 = restored.batches[BATCH_DAY01_ARCHIVE]!.archived['B102']!;
    expect(b102.archiveCode).toBe('0102');
    expect(typeof b102.archiveCode).toBe('string');
    expect(b102.source.code).toBe('0102');
    expect(typeof b102.source.code).toBe('string');
  });

  it('不改變傳入的物件', () => {
    const copy = JSON.parse(JSON.stringify(day2));
    valid(day2);
    expect(day2).toEqual(copy);
  });
});

/* ---------- v2 舊檔辨識 ---------- */

const legacyArchivedAll: SaveV2['archived'] = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
  B607: { archiveCode: '0607', refusal: true, origin: 'source' },
};

const legacyInitial: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day1',
  archived: {},
  drafts: {},
  events: [],
  evidence: { reportOpened: false, receiptOpened: false },
};

const legacyEnd: SaveV2 = {
  ...legacyInitial,
  phase: 'end',
  archived: { ...legacyArchivedAll },
  drafts: { B102: { value: '0102', policy: 'default_false' } },
  night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
  reply: 'review',
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source' } },
    { id: 'day2.reply:1', kind: 'day2.reply', payload: { choice: 'review' } },
  ],
};

const legacyValid = (s: unknown): boolean => isValidLegacySave(s, RECORDS);

describe('isValidLegacySave：合法的 v2 舊檔', () => {
  const cases: Array<[string, unknown]> = [
    ['v2 初始存檔', legacyInitial],
    ['v2 day1 已歸檔一筆＋草稿', { ...legacyInitial, archived: { B102: legacyArchivedAll['B102'] }, drafts: { H17: { value: 'H-1' } } }],
    ['v2 overnight 三筆齊', { ...legacyInitial, phase: 'overnight', archived: legacyArchivedAll }],
    ['v2 day2 三筆齊＋night', { ...legacyInitial, phase: 'day2', archived: legacyArchivedAll, night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 } }],
    ['v2 end 完整存檔', legacyEnd],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(legacyValid(save)).toBeTrue());
  }
});

describe('isValidLegacySave：不合法', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['空物件', {}],
    ['只有 version 的 {"version":2}', { version: 2 }],
    ['v1（archiveName）', { ...legacyInitial, archived: { B102: { archiveName: 102, refusal: false, origin: 'defaulted' } } }],
    ['version 1', { ...legacyInitial, version: 1 }],
    ['v3 存檔不是 v2', initial],
    ['archived 含未知 key', { ...legacyInitial, archived: { X99: { archiveCode: '99', refusal: null, origin: 'source' } } }],
    ['archiveCode 與來源不符', { ...legacyInitial, archived: { B102: { archiveCode: '102', refusal: false, origin: 'defaulted' } } }],
    ['archiveCode 為數字', { ...legacyInitial, archived: { B102: { archiveCode: 102, refusal: false, origin: 'defaulted' } } }],
    ['archived 是陣列', { ...legacyInitial, archived: [] }],
    ['drafts 是陣列', { ...legacyInitial, drafts: [] }],
    ['草稿 policy 未知', { ...legacyInitial, drafts: { B102: { value: '0102', policy: 'nope' } } }],
    ['phase day2 卻沒歸檔完', { ...legacyInitial, phase: 'day2', night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 } }],
    ['phase end 但 reply 缺', { ...legacyEnd, reply: undefined }],
    ['night 與 intervention 不一致', { ...legacyEnd, night: { intervention: true, smallTalkVariant: 1, reportRevision: 1 } }],
    ['seed 非整數', { ...legacyInitial, seed: 1.5 }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(legacyValid(save)).toBeFalse());
  }
});

/* ---------- v2 → v3 遷移 ---------- */

describe('migrateSave：v2 → v3', () => {
  it('完整 v2 存檔遷移後成為合法的 v3', () => {
    expect(legacyValid(legacyEnd)).toBeTrue();
    const migrated = migrateSave(legacyEnd, RECORDS);

    expect(migrated.version).toBe(3);
    expect(migrated.seed).toBe(legacyEnd.seed);
    expect(migrated.phase).toBe('end');
    // phase end／day2 → day.02；不是從批次名稱硬推
    expect(migrated.dayId).toBe(DAY_02);
    expect(migrated.readMessages).toEqual([]);
    expect(migrated.night).toEqual(legacyEnd.night!);
    expect(migrated.reply).toBe('review');
    expect(migrated.evidence).toEqual(legacyEnd.evidence);
    expect(migrated.events).toEqual(legacyEnd.events);

    // 內容進到 Day 1 的歸檔批次，而不是留在頂層
    expect(Object.keys(migrated.batches)).toEqual([BATCH_DAY01_ARCHIVE]);
    const batch = migrated.batches[BATCH_DAY01_ARCHIVE]!;
    expect(Object.keys(batch.archived).sort()).toEqual(['B102', 'B607', 'H17']);
    expect(batch.drafts).toEqual({ B102: { value: '0102', policy: 'default_false' } });

    // 遷移後仍要通過現行格式檢查
    expect(isValidSave(migrated, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
  });

  it('0102 遷移後仍是字串 "0102"，JSON 往返也不變', () => {
    const migrated = migrateSave(legacyEnd, RECORDS);
    const b102 = migrated.batches[BATCH_DAY01_ARCHIVE]!.archived['B102']!;
    expect(b102.archiveCode).toBe('0102');
    expect(typeof b102.archiveCode).toBe('string');

    const restored = JSON.parse(JSON.stringify(migrated)) as SaveV3;
    const restoredB102 = restored.batches[BATCH_DAY01_ARCHIVE]!.archived['B102']!;
    expect(restoredB102.archiveCode).toBe('0102');
    expect(typeof restoredB102.archiveCode).toBe('string');
    expect(isValidSave(restored, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
  });

  it('每一筆都補上來源快照（以遷移當下的資料表為準）', () => {
    const migrated = migrateSave(legacyEnd, RECORDS);
    const batch = migrated.batches[BATCH_DAY01_ARCHIVE]!;
    for (const r of RECORDS) {
      const a = batch.archived[r.key]!;
      expect(a.source).toEqual(snapshotOf(r));
      // 提交結果本身照抄舊檔，不被資料表覆寫
      expect(a.archiveCode).toBe(legacyArchivedAll[r.key]!.archiveCode);
      expect(a.refusal).toBe(legacyArchivedAll[r.key]!.refusal);
      expect(a.origin).toBe(legacyArchivedAll[r.key]!.origin);
    }
  });

  it('資料表已經沒有這個 key 時，快照至少保住已提交的編號', () => {
    const orphan: SaveV2 = {
      ...legacyInitial,
      archived: { GONE: { archiveCode: '0404', refusal: true, origin: 'source' } },
    };
    const migrated = migrateSave(orphan, RECORDS);
    expect(migrated.batches[BATCH_DAY01_ARCHIVE]!.archived['GONE']).toEqual({
      archiveCode: '0404',
      refusal: true,
      origin: 'source',
      source: { name: null, code: '0404', refusal: true, refusalApplies: false },
    });
  });

  it('dayId 依 phase 決定', () => {
    expect(migrateSave(legacyInitial, RECORDS).dayId).toBe(DAY_01);
    expect(migrateSave({ ...legacyInitial, phase: 'overnight', archived: legacyArchivedAll }, RECORDS).dayId).toBe(DAY_01);
    expect(
      migrateSave(
        { ...legacyInitial, phase: 'day2', archived: legacyArchivedAll, night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 } },
        RECORDS,
      ).dayId,
    ).toBe(DAY_02);
    expect(migrateSave(legacyEnd, RECORDS).dayId).toBe(DAY_02);
  });

  it('沒有 night／reply 的 day1 舊檔遷移後仍合法', () => {
    const migrated = migrateSave({ ...legacyInitial, drafts: { H17: { value: 'H-1' } } }, RECORDS);
    expect(migrated.night).toBeUndefined();
    expect(migrated.reply).toBeUndefined();
    expect(migrated.batches[BATCH_DAY01_ARCHIVE]!.archived).toEqual({});
    expect(migrated.batches[BATCH_DAY01_ARCHIVE]!.drafts).toEqual({ H17: { value: 'H-1' } });
    expect(isValidSave(migrated, RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
    expect(isValidSave(JSON.parse(JSON.stringify(migrated)), RECORDS, BATCH_DAY01_ARCHIVE)).toBeTrue();
  });

  it('不改動傳入的 v2 物件，事件與草稿都是複本', () => {
    const before = JSON.parse(JSON.stringify(legacyEnd));
    const migrated = migrateSave(legacyEnd, RECORDS);
    expect(legacyEnd).toEqual(before);
    expect(migrated.events).not.toBe(legacyEnd.events);
    expect(migrated.batches[BATCH_DAY01_ARCHIVE]!.drafts['B102']).not.toBe(legacyEnd.drafts['B102']);
    expect(migrated.evidence).not.toBe(legacyEnd.evidence);
  });

  it('遷移結果不再被當成 v2', () => {
    const migrated = migrateSave(legacyEnd, RECORDS);
    expect(legacyValid(migrated)).toBeFalse();
    expect(isValidSave(legacyEnd, RECORDS, BATCH_DAY01_ARCHIVE)).toBeFalse();
  });
});
