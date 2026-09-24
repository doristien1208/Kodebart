import { LEGACY_DAY_01, LEGACY_DAY_02, dayIdForPhase, stageForPhase } from './day-map';
import { DayDirectory, DayPlan, FieldMapTaskPlan, createDayDirectory } from './day-plan';
import {
  advanceDay,
  completeWork,
  isArrangedInSave,
  isTaskDone,
  isTaskSettled,
  isTaskWaived,
  markReportOpened,
  reconcileProgressOf,
  isTaskApplicable,
  resubmitReturn,
  returnNotified,
  sendReturnToWindow,
  setRecordReview,
  snapshotOf,
  startDay,
  submitReply,
} from './rules';
import {
  migrateToCurrent,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  migrateV10ToV11,
} from './save-migrate';
import { mailIdOfReceipt, receiptMail } from './mail';
import {
  isValidLegacySaveV2,
  isValidLegacySaveV3,
  isValidLegacySaveV4,
  isValidLegacySaveV5,
  isValidLegacySaveV6,
  isValidLegacySaveV7,
  isValidLegacySaveV8,
  isValidLegacySaveV9,
  isValidLegacySaveV10,
  isValidSave,
} from './save-schema';
import {
  ArchivedRecord,
  BatchState,
  LEGACY_SAVE_VERSIONS,
  NightResult,
  PHASES,
  Phase,
  RecordKey,
  SAVE_VERSION,
  Save,
  SaveV2,
  SaveV3,
  SaveV4,
  SaveV5,
  SaveV6,
  SaveV7,
  SaveV8,
  SaveV9,
  SaveV10,
  LegacyReturnCaseV9,
  ReturnCase,
  SourceRecord,
  Stage,
} from './types';

/**
 * v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 → v10 → v11 遷移（R6-02／R7／R8／R9／R10／R11／R12）。
 * 舊檔不被判定損壞或清空，只會被轉換；轉換結果必須通過現行 isValidSave。
 * 目錄與資料皆為測試自建。
 */

const DAY_01 = 'day.01';
const DAY_02 = 'day.02';
const DAY_03 = 'day.03';
const DAY_06 = 'day.06';
const TASK_DAY1 = 'task.day1.archive';
const TASK_DAY2 = 'task.day2.reconcile';
const TASK_DAY3 = 'task.day3.archive';
const BATCH_DAY01 = 'batch.day01.archive';
const BATCH_DAY03 = 'batch.day03.archive';

const DAY1_RECORDS: readonly SourceRecord[] = [
  { key: 'H17', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false },
  { key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true },
  { key: 'B607', name: null, code: '0607', refusal: true, refusalApplies: true },
];
const DAY3_RECORDS: readonly SourceRecord[] = [{ key: 'T1', name: null, code: '0001', refusal: null, refusalApplies: false }];

const PLAN_DAY1: DayPlan = {
  dayId: DAY_01,
  dayNumber: 1,
  nextDayId: DAY_02,
  tasks: [{ id: TASK_DAY1, kind: 'archive', batchId: BATCH_DAY01, recordKeys: DAY1_RECORDS.map((r) => r.key), caseReviews: [] }],
};
function planDay2(nextDayId: string | null): DayPlan {
  return { dayId: DAY_02, dayNumber: 2, nextDayId, tasks: [{ id: TASK_DAY2, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey: 'B102', recordKeys: ['B102'] }] };
}
const FIELD_MAP: FieldMapTaskPlan = {
  id: 'task.day6.field-map',
  kind: 'field-map',
  sourceFieldIds: ['s1'],
  targets: [{ id: 't1', sourceId: 's1', convert: 'text' }],
  rows: [{ id: 'row.1', values: { s1: '0102' } }],
};

/** 舊內容：兩天，Day 2 是最後一天（v4 當時的日程）。 */
const DIR2: DayDirectory = createDayDirectory([PLAN_DAY1, planDay2(null)], { [BATCH_DAY01]: DAY1_RECORDS });

/** 現行內容：Day 2 之後還有 Day 3…Day 6（中間幾天只放一筆，夠測試用）。 */
const DIR6: DayDirectory = createDayDirectory(
  [
    PLAN_DAY1,
    planDay2(DAY_03),
    { dayId: DAY_03, dayNumber: 3, nextDayId: 'day.04', tasks: [{ id: TASK_DAY3, kind: 'archive', batchId: BATCH_DAY03, recordKeys: ['T1'], caseReviews: [] }] },
    { dayId: 'day.04', dayNumber: 4, nextDayId: 'day.05', tasks: [{ id: 'task.day4.archive', kind: 'archive', batchId: 'batch.day04.archive', recordKeys: [], caseReviews: [] }] },
    { dayId: 'day.05', dayNumber: 5, nextDayId: DAY_06, tasks: [{ id: 'task.day5.archive', kind: 'archive', batchId: 'batch.day05.archive', recordKeys: [], caseReviews: [] }] },
    { dayId: DAY_06, dayNumber: 6, nextDayId: null, tasks: [FIELD_MAP] },
  ],
  { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_DAY03]: DAY3_RECORDS },
);

function snap(key: RecordKey) {
  const r = DAY1_RECORDS.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return snapshotOf(r);
}

const NIGHT_YES: NightResult = { intervention: true, smallTalkVariant: 1, reportRevision: 2 };
const NIGHT_NO: NightResult = { intervention: false, smallTalkVariant: 0, reportRevision: 1 };

function makeBatch(archived: BatchState['archived'] = {}, drafts: BatchState['drafts'] = {}): BatchState {
  return { archived, drafts };
}

const archivedAll: Record<RecordKey, ArchivedRecord> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source', source: snap('H17') },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snap('B102') },
  B607: { archiveCode: '0607', refusal: true, origin: 'source', source: snap('B607') },
};

function raw(s: unknown): Record<string, unknown> {
  return s as Record<string, unknown>;
}

function omitKey<T extends object>(o: T, key: string): Record<string, unknown> {
  const copy = { ...(o as Record<string, unknown>) };
  delete copy[key];
  return copy;
}

/** v8 → v11（測試輔助）：先補空 returns（v9），再補空排程與已讀回條（v10），再補角色／入職／郵件等（v11）。 */
function v8ToCurrent(v8: SaveV8, dir: DayDirectory): Save {
  return migrateV10ToV11(migrateV9ToV10(migrateV8ToV9(v8), dir), dir);
}

/** v9 → v11（測試輔助）。 */
function v9ToCurrent(v9: SaveV9, dir: DayDirectory): Save {
  return migrateV10ToV11(migrateV9ToV10(v9, dir), dir);
}

/** R12：從 v10 以前遷移上來的存檔，v11 欄位的共同期望（沒有退件時）。 */
function expectFreshV11Fields(save: Save, context = ''): void {
  expect(save.version).withContext(context).toBe(11);
  expect(save.mailbox).withContext(context).toEqual([]);
  expect(save.readMail).withContext(context).toEqual([]);
  expect(save.helpRequests).withContext(context).toEqual({});
  expect(save.issueDrafts).withContext(context).toEqual({});
  expect(save.profile).withContext(context).toEqual({ name: null });
  expect(save.onboarding).withContext(context).toEqual({ step: 0, complete: true });
  expect('readIssueReceipts' in save).withContext(context).toBeFalse();
}

/* ---------- v2 fixture ---------- */

const legacyArchivedAll: SaveV2['archived'] = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
  B607: { archiveCode: '0607', refusal: true, origin: 'source' },
};

const v2Initial: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day1',
  archived: {},
  drafts: {},
  events: [],
  evidence: { reportOpened: false, receiptOpened: false },
};

const v2Events = [
  { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source' } },
  { id: 'archive:1', kind: 'archive', payload: { key: 'B102', origin: 'defaulted' } },
  { id: 'archive:2', kind: 'archive', payload: { key: 'B607', origin: 'source' } },
  { id: 'day1.complete:3', kind: 'day1.complete', payload: {} },
  { id: 'night.resolved:4', kind: 'night.resolved', payload: { ...NIGHT_YES } },
  { id: 'day2.reply:5', kind: 'day2.reply', payload: { choice: 'review' } },
];

const v2End: SaveV2 = {
  ...v2Initial,
  phase: 'end',
  archived: { ...legacyArchivedAll },
  drafts: { B102: { value: '0102', policy: 'default_false' }, H17: { value: 'H-17' } },
  night: NIGHT_YES,
  evidence: { reportOpened: true, receiptOpened: true },
  reply: 'review',
  events: v2Events,
};

const v2Overnight: SaveV2 = { ...v2Initial, phase: 'overnight', archived: { ...legacyArchivedAll }, events: v2Events.slice(0, 4) };
const v2Day2: SaveV2 = { ...v2Overnight, phase: 'day2', night: NIGHT_NO, evidence: { reportOpened: true, receiptOpened: false }, events: v2Events.slice(0, 5) };

/* ---------- v3 fixture ---------- */

const v3Initial: SaveV3 = {
  version: 3,
  seed: 7,
  phase: 'day1',
  dayId: DAY_01,
  batches: {},
  events: [],
  evidence: { reportOpened: false, receiptOpened: false },
  readMessages: [],
};

const v3End: SaveV3 = {
  ...v3Initial,
  phase: 'end',
  dayId: DAY_02,
  batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }, { B102: { value: '0102', policy: 'default_false' } }) },
  night: NIGHT_YES,
  evidence: { reportOpened: true, receiptOpened: false },
  reply: 'ask',
  events: v2Events.slice(0, 5).concat([{ id: 'day2.reply:5', kind: 'day2.reply', payload: { choice: 'ask' } }]),
  readMessages: ['msg.day1.a', 'msg.day2.b'],
};

const v3Overnight: SaveV3 = { ...v3Initial, phase: 'overnight', batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) }, events: v2Events.slice(0, 4) };
const v3Day2: SaveV3 = { ...v3Overnight, phase: 'day2', dayId: DAY_02, night: NIGHT_NO, events: v2Events.slice(0, 5), readMessages: ['msg.a'] };

/* ---------- v4 fixture ---------- */

const v4Day1: SaveV4 = {
  version: 4,
  seed: 3,
  dayId: DAY_01,
  stage: 'work',
  taskId: TASK_DAY1,
  batches: { [BATCH_DAY01]: makeBatch({ B102: archivedAll['B102'] }, { H17: { value: 'H-1' } }) },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'B102', origin: 'defaulted', batchId: BATCH_DAY01 } }],
  readMessages: ['msg.day1.a'],
};
const v4Day1Wrap: SaveV4 = { ...v4Day1, stage: 'wrap', batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) } };
const v4Day2Work: SaveV4 = {
  ...v4Day1Wrap,
  dayId: DAY_02,
  stage: 'work',
  taskId: TASK_DAY2,
  night: NIGHT_NO,
  evidence: { reportOpened: true, receiptOpened: false },
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source', batchId: BATCH_DAY01 } },
    { id: 'day.complete:1', kind: 'day.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } },
    { id: 'night.resolved:2', kind: 'night.resolved', payload: { ...NIGHT_NO } },
  ],
  readMessages: ['msg.day1.a', 'msg.day2.a'],
};
/** v4 當時 Day 2 是最後一天：回覆後 stage=end。 */
const v4Day2End: SaveV4 = {
  ...v4Day2Work,
  stage: 'end',
  evidence: { reportOpened: true, receiptOpened: true },
  reply: 'review',
  events: [...v4Day2Work.events, { id: 'reply.submit:3', kind: 'reply.submit', payload: { taskId: TASK_DAY2, choice: 'review' } }],
};

/** phase → 預期 v4 (dayId, stage)。 */
const PHASE_MAP: ReadonlyArray<[Phase, string, Stage]> = [
  ['day1', DAY_01, 'work'],
  ['overnight', DAY_01, 'wrap'],
  ['day2', DAY_02, 'work'],
  ['end', DAY_02, 'end'],
];
/** phase → 在現行（六天）日程下的 v5–v7 stage：舊 end 改為 wrap。 */
const V5_STAGE_DIR6: Record<Phase, Stage> = { day1: 'work', overnight: 'wrap', day2: 'work', end: 'wrap' };

/* ---------- day-map：只供遷移的對照 ---------- */

describe('day-map（舊 phase 對照，只供遷移）', () => {
  it('LEGACY_DAY_01／02 為 day.01／day.02', () => {
    expect(LEGACY_DAY_01).toBe(DAY_01);
    expect(LEGACY_DAY_02).toBe(DAY_02);
  });

  it('dayIdForPhase／stageForPhase 四種對應', () => {
    for (const [phase, dayId, stage] of PHASE_MAP) {
      expect(dayIdForPhase(phase)).toBe(dayId);
      expect(stageForPhase(phase)).toBe(stage);
    }
    expect(PHASES.length).toBe(PHASE_MAP.length);
  });
});

/* ---------- v2 → v3 ---------- */

describe('migrateV2ToV3', () => {
  it('完整 v2 存檔遷移後成為結構合法的 v3，內容進到指定批次', () => {
    expect(isValidLegacySaveV2(v2End)).toBeTrue();
    const v3 = migrateV2ToV3(v2End, DAY1_RECORDS, BATCH_DAY01);
    expect(v3.version).toBe(3);
    expect(v3.seed).toBe(v2End.seed);
    expect(v3.phase).toBe('end');
    expect(v3.dayId).toBe(DAY_02);
    expect(v3.readMessages).toEqual([]);
    expect(v3.night).toEqual(v2End.night!);
    expect(v3.reply).toBe('review');
    expect(v3.evidence).toEqual(v2End.evidence);
    expect(v3.events).toEqual(v2End.events);
    expect(Object.keys(v3.batches)).toEqual([BATCH_DAY01]);
    const batch = v3.batches[BATCH_DAY01]!;
    expect(Object.keys(batch.archived).sort()).toEqual(['B102', 'B607', 'H17']);
    expect(batch.drafts).toEqual({ B102: { value: '0102', policy: 'default_false' }, H17: { value: 'H-17' } });
    expect(isValidLegacySaveV3(v3)).toBeTrue();
  });

  it('每一筆都補上來源快照，提交結果照抄舊檔', () => {
    const batch = migrateV2ToV3(v2End, DAY1_RECORDS, BATCH_DAY01).batches[BATCH_DAY01]!;
    for (const r of DAY1_RECORDS) {
      const a = batch.archived[r.key]!;
      expect(a.source).toEqual(snapshotOf(r));
      expect(a.archiveCode).toBe(legacyArchivedAll[r.key]!.archiveCode);
      expect(a.refusal).toBe(legacyArchivedAll[r.key]!.refusal);
      expect(a.origin).toBe(legacyArchivedAll[r.key]!.origin);
    }
    expect(batch.archived['B102']!.archiveCode).toBe('0102');
  });

  it('資料集合已經沒有這個 key 時，快照至少保住已提交的編號', () => {
    const orphan: SaveV2 = { ...v2Initial, archived: { GONE: { archiveCode: '0404', refusal: true, origin: 'source' } } };
    expect(migrateV2ToV3(orphan, DAY1_RECORDS, BATCH_DAY01).batches[BATCH_DAY01]!.archived['GONE']).toEqual({
      archiveCode: '0404',
      refusal: true,
      origin: 'source',
      source: { name: null, code: '0404', refusal: true, refusalApplies: false },
    });
  });

  it('dayId 依 phase 決定', () => {
    expect(migrateV2ToV3(v2Initial, DAY1_RECORDS, BATCH_DAY01).dayId).toBe(DAY_01);
    expect(migrateV2ToV3(v2Overnight, DAY1_RECORDS, BATCH_DAY01).dayId).toBe(DAY_01);
    expect(migrateV2ToV3(v2Day2, DAY1_RECORDS, BATCH_DAY01).dayId).toBe(DAY_02);
    expect(migrateV2ToV3(v2End, DAY1_RECORDS, BATCH_DAY01).dayId).toBe(DAY_02);
  });

  it('沒有 night／reply 的 day1 舊檔遷移後沒有多出這兩個鍵', () => {
    const v3 = migrateV2ToV3({ ...v2Initial, drafts: { H17: { value: 'H-1' } } }, DAY1_RECORDS, BATCH_DAY01);
    expect('night' in v3).toBeFalse();
    expect('reply' in v3).toBeFalse();
  });

  it('不改動傳入的 v2 物件，事件與草稿都是複本', () => {
    const before = JSON.parse(JSON.stringify(v2End));
    const v3 = migrateV2ToV3(v2End, DAY1_RECORDS, BATCH_DAY01);
    expect(v2End).toEqual(before);
    expect(v3.events).not.toBe(v2End.events);
    expect(v3.batches[BATCH_DAY01]!.drafts['B102']).not.toBe(v2End.drafts['B102']);
    expect(v3.evidence).not.toBe(v2End.evidence);
  });
});

/* ---------- v3 → v4 ---------- */

describe('migrateV3ToV4', () => {
  it('phase 拆成 stage、taskId 由該日 plan 查得（四種 phase）', () => {
    const fixtures: Record<Phase, SaveV3> = { day1: v3Initial, overnight: v3Overnight, day2: v3Day2, end: v3End };
    for (const [phase, dayId, stage] of PHASE_MAP) {
      const v4 = migrateV3ToV4(fixtures[phase], DIR6);
      expect(v4.version).toBe(4);
      expect(v4.dayId).toBe(dayId);
      expect(v4.stage).toBe(stage);
      expect(v4.taskId).toBe(dayId === DAY_01 ? TASK_DAY1 : TASK_DAY2);
      expect(raw(v4)['phase']).toBeUndefined();
      expect(isValidLegacySaveV4(v4)).toBeTrue();
    }
  });

  it('night／reply／events／readMessages／batches／evidence 原樣保留', () => {
    const v4 = migrateV3ToV4(v3End, DIR6);
    expect(v4.seed).toBe(7);
    expect(v4.night).toEqual(NIGHT_YES);
    expect(v4.reply).toBe('ask');
    expect(v4.events).toEqual(v3End.events);
    expect(v4.readMessages).toEqual(['msg.day1.a', 'msg.day2.b']);
    expect(v4.batches).toEqual(v3End.batches);
    expect(v4.evidence).toEqual({ reportOpened: true, receiptOpened: false });
  });

  it('v3 的 dayId 若不在目錄中，退回由 phase 對照', () => {
    const v4 = migrateV3ToV4({ ...v3Day2, dayId: 'day.zz' }, DIR6);
    expect(v4.dayId).toBe(DAY_02);
    expect(v4.taskId).toBe(TASK_DAY2);
    expect(v4.stage).toBe('work');
  });

  it('沒有 night／reply 的 day1 舊檔不會多出 undefined 鍵', () => {
    const v4 = migrateV3ToV4(v3Initial, DIR6);
    expect('night' in v4).toBeFalse();
    expect('reply' in v4).toBeFalse();
  });

  it('不改動傳入的 v3 物件', () => {
    const before = JSON.parse(JSON.stringify(v3End));
    const v4 = migrateV3ToV4(v3End, DIR6);
    expect(v3End).toEqual(before);
    expect(v4.events).not.toBe(v3End.events);
    expect(v4.readMessages).not.toBe(v3End.readMessages);
    expect(v4.evidence).not.toBe(v3End.evidence);
  });
});

/* ---------- v4 → v5 ---------- */

describe('migrateV4ToV5', () => {
  it('Day 2 v4 end＋reply → v5 Day 2 wrap；evidence／reply 移進核對工作的 taskProgress', () => {
    const v5 = migrateV4ToV5(v4Day2End, DIR6);
    expect(v5.version).toBe(5);
    expect(v5.dayId).toBe(DAY_02);
    expect(v5.stage).toBe('wrap');
    expect(v5.taskId).toBe(TASK_DAY2);
    expect(v5.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review' } });
    for (const key of ['evidence', 'reply']) expect(key in raw(v5)).withContext(key).toBeFalse();
    expect(isValidLegacySaveV5(v5, DIR6)).toBeTrue();
  });

  it('轉成的 Day 2 wrap（再補 v6、v7、v8、v9、v10、v11）可直接 advanceDay 接到 Day 3 的次日收件，night 不重擲', () => {
    const current = v8ToCurrent(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(v4Day2End, DIR6)), DIR6)), DIR6);
    const day3 = advanceDay(current, DIR6);
    expect([day3.dayId, day3.stage, day3.taskId]).toEqual([DAY_03, 'morning', TASK_DAY3]);
    expect(day3.night).toBe(current.night!);
    expect(day3.events.length).toBe(current.events.length);
    expect(reconcileProgressOf(day3, TASK_DAY2).reply).toBe('review');
    expect(isValidSave(day3, DIR6)).toBeTrue();
  });

  it('舊日程（Day 2 是最後一天）下 end 維持 end', () => {
    const v5 = migrateV4ToV5(v4Day2End, DIR2);
    expect(v5.stage).toBe('end');
    expect(isValidLegacySaveV5(v5, DIR2)).toBeTrue();
  });

  it('反向：v4 停在沒有下一日的 wrap → end', () => {
    const v4Wrap: SaveV4 = { ...v4Day2End, stage: 'wrap' };
    expect(migrateV4ToV5(v4Wrap, DIR2).stage).toBe('end');
    expect(migrateV4ToV5(v4Wrap, DIR6).stage).toBe('wrap');
  });

  it('Day 2 v4 work：只帶已開文件、沒有 reply', () => {
    const v5 = migrateV4ToV5(v4Day2Work, DIR6);
    expect(v5.stage).toBe('work');
    expect(v5.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } });
    expect('reply' in v5.taskProgress[TASK_DAY2]!).toBeFalse();
    expect(isValidLegacySaveV5(v5, DIR6)).toBeTrue();
  });

  it('Day 1 v4：捨棄預設 evidence，taskProgress 為空；work／wrap 不變', () => {
    const work = migrateV4ToV5(v4Day1, DIR6);
    expect(work.taskProgress).toEqual({});
    expect(work.stage).toBe('work');
    expect(isValidLegacySaveV5(work, DIR6)).toBeTrue();
    const wrap = migrateV4ToV5(v4Day1Wrap, DIR6);
    expect(wrap.taskProgress).toEqual({});
    expect(wrap.stage).toBe('wrap');
    expect(isValidLegacySaveV5(wrap, DIR6)).toBeTrue();
  });

  it('批次、事件、night、已讀、seed 原樣保留；事件與已讀為複本', () => {
    const v5 = migrateV4ToV5(v4Day2End, DIR6);
    expect(v5.seed).toBe(v4Day2End.seed);
    expect(v5.batches).toEqual(v4Day2End.batches);
    expect(v5.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
    expect(v5.events).toEqual(v4Day2End.events);
    expect(v5.events).not.toBe(v4Day2End.events);
    expect(v5.night).toEqual(NIGHT_NO);
    expect(v5.readMessages).toEqual(['msg.day1.a', 'msg.day2.a']);
    expect(v5.readMessages).not.toBe(v4Day2End.readMessages);
  });

  it('沒有 night 的 v4 不會多出 night 鍵', () => {
    expect('night' in migrateV4ToV5(v4Day1, DIR6)).toBeFalse();
  });

  it('taskId 以目錄查得', () => {
    const stray: SaveV4 = { ...v4Day2Work, taskId: 'task.old-name' };
    expect(migrateV4ToV5(stray, DIR6).taskId).toBe(TASK_DAY2);
  });

  it('dayId 不在目錄內時拋錯', () => {
    expect(() => migrateV4ToV5({ ...v4Day1, dayId: 'day.99' }, DIR6)).toThrowError(/day\.99/);
  });

  it('不改動傳入的 v4 物件', () => {
    const before = JSON.parse(JSON.stringify(v4Day2End));
    migrateV4ToV5(v4Day2End, DIR6);
    expect(v4Day2End).toEqual(before);
  });
});

/* ---------- migrateToCurrent ---------- */

describe('migrateToCurrent：v4 → v11', () => {
  it('v4 Day 2 end → from 4、v11 Day 2 wrap（空 chatReplies／waivedTasks／caseReviews／returns／issueSchedule／mailbox／readMail，入職已完成），可接 Day 3', () => {
    const result = migrateToCurrent(v4Day2End, DIR6);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(4);
    expectFreshV11Fields(result!.save);
    expect(result!.save.chatReplies).toEqual({});
    expect(result!.save.waivedTasks).toEqual([]);
    expect(result!.save.caseReviews).toEqual({});
    expect(result!.save.returns).toEqual([]);
    expect(result!.save.issueSchedule).toEqual({});
    expect(result!.save.stage).toBe('wrap');
    expect(advanceDay(result!.save, DIR6).dayId).toBe(DAY_03);
    expect(isValidSave(JSON.parse(JSON.stringify(result!.save)), DIR6)).toBeTrue();
  });

  it('v4 Day 1 work／wrap、Day 2 work 都能遷移', () => {
    for (const v4 of [v4Day1, v4Day1Wrap, v4Day2Work]) {
      const result = migrateToCurrent(v4, DIR6);
      expect(result).withContext(`${v4.dayId}/${v4.stage}`).not.toBeNull();
      expect(result!.from).toBe(4);
      expectFreshV11Fields(result!.save, `${v4.dayId}/${v4.stage}`);
      expect(result!.save.returns).toEqual([]);
      expect(result!.save.issueSchedule).toEqual({});
      expect(result!.save.chatReplies).toEqual({});
      expect(result!.save.waivedTasks).toEqual([]);
      expect(result!.save.dayId).toBe(v4.dayId);
      expect(result!.save.stage).toBe(v4.stage);
    }
  });

  it('v4 stage 為 morning（v4 不存在的階段）→ null', () => {
    expect(isValidLegacySaveV4({ ...v4Day2Work, stage: 'morning' })).toBeTrue();
    expect(migrateToCurrent({ ...v4Day2Work, stage: 'morning' }, DIR6)).toBeNull();
  });
});

describe('migrateToCurrent：v3 → v11', () => {
  it('完整合法 v3（end）→ from 3、Day 2 wrap；evidence／reply 進 taskProgress，其餘原樣保留', () => {
    const result = migrateToCurrent(v3End, DIR6);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(3);
    const save = result!.save;
    expectFreshV11Fields(save);
    expect(save.chatReplies).toEqual({});
    expect(save.waivedTasks).toEqual([]);
    expect(save.returns).toEqual([]);
    expect(save.issueSchedule).toEqual({});
    expect(save.seed).toBe(7);
    expect(save.dayId).toBe(DAY_02);
    expect(save.stage).toBe('wrap');
    expect(save.taskId).toBe(TASK_DAY2);
    expect(save.batches).toEqual(v3End.batches);
    expect(save.night).toEqual(NIGHT_YES);
    expect(save.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ask' } });
    expect(save.events).toEqual(v3End.events);
    expect(save.readMessages).toEqual(['msg.day1.a', 'msg.day2.b']);
    expect(isValidSave(JSON.parse(JSON.stringify(save)), DIR6)).toBeTrue();
    expect(advanceDay(save, DIR6).dayId).toBe(DAY_03);
  });

  it('舊日程下 v3 end 仍為 end', () => {
    const result = migrateToCurrent(v3End, DIR2)!;
    expect(result.from).toBe(3);
    expect(result.save.stage).toBe('end');
  });

  it('四種 phase 各自對應 dayId／stage，結果都通過 isValidSave', () => {
    const fixtures: Record<Phase, SaveV3> = { day1: v3Initial, overnight: v3Overnight, day2: v3Day2, end: v3End };
    for (const [phase, dayId] of PHASE_MAP) {
      const result = migrateToCurrent(fixtures[phase], DIR6);
      expect(result).withContext(phase).not.toBeNull();
      expect(result!.from).toBe(3);
      expect(result!.save.dayId).toBe(dayId);
      expect(result!.save.stage).toBe(V5_STAGE_DIR6[phase]);
      expect(isValidSave(result!.save, DIR6)).toBeTrue();
    }
  });

  it('v3 dayId 不在目錄中時以 phase 對照，仍成功遷移', () => {
    const result = migrateToCurrent({ ...v3Day2, dayId: 'day.zz' }, DIR6)!;
    expect(result.from).toBe(3);
    expect(result.save.dayId).toBe(DAY_02);
    expect(result.save.taskId).toBe(TASK_DAY2);
  });

  it('不改動傳入的 v3 物件', () => {
    const before = JSON.parse(JSON.stringify(v3End));
    migrateToCurrent(v3End, DIR6);
    expect(v3End).toEqual(before);
  });
});

describe('migrateToCurrent：v2 → v11', () => {
  it('完整合法 v2（end）→ from 2、Day 2 wrap，快照、草稿、事件、回覆原樣保留', () => {
    const result = migrateToCurrent(v2End, DIR6);
    expect(result).not.toBeNull();
    expect(result!.from).toBe(2);
    const save = result!.save;
    expectFreshV11Fields(save);
    expect(save.chatReplies).toEqual({});
    expect(save.waivedTasks).toEqual([]);
    expect(save.returns).toEqual([]);
    expect(save.issueSchedule).toEqual({});
    expect(save.seed).toBe(42);
    expect(save.dayId).toBe(DAY_02);
    expect(save.stage).toBe('wrap');
    expect(save.taskId).toBe(TASK_DAY2);
    for (const key of ['phase', 'evidence', 'reply']) expect(key in raw(save)).withContext(key).toBeFalse();

    const batch = save.batches[BATCH_DAY01]!;
    expect(Object.keys(batch.archived).sort()).toEqual(['B102', 'B607', 'H17']);
    for (const r of DAY1_RECORDS) expect(batch.archived[r.key]!.source).toEqual(snapshotOf(r));
    expect(batch.archived['B102']!.archiveCode).toBe('0102');
    expect(batch.drafts).toEqual({ B102: { value: '0102', policy: 'default_false' }, H17: { value: 'H-17' } });

    expect(save.night).toEqual(NIGHT_YES);
    expect(save.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review' } });
    expect(save.events).toEqual(v2Events);
    expect(save.readMessages).toEqual([]);
    expect(isValidSave(JSON.parse(JSON.stringify(save)), DIR6)).toBeTrue();
  });

  it('四種 phase 各自對應 dayId／stage／taskId，結果都通過 isValidSave', () => {
    const fixtures: Record<Phase, SaveV2> = { day1: v2Initial, overnight: v2Overnight, day2: v2Day2, end: v2End };
    for (const [phase, dayId] of PHASE_MAP) {
      const result = migrateToCurrent(fixtures[phase], DIR6);
      expect(result).withContext(phase).not.toBeNull();
      expect(result!.from).toBe(2);
      expect(result!.save.dayId).toBe(dayId);
      expect(result!.save.stage).toBe(V5_STAGE_DIR6[phase]);
      expect(result!.save.taskId).toBe(dayId === DAY_01 ? TASK_DAY1 : TASK_DAY2);
      expect(isValidSave(result!.save, DIR6)).toBeTrue();
    }
  });

  it('day2 v2 的已開摘要移進 taskProgress', () => {
    const save = migrateToCurrent(v2Day2, DIR6)!.save;
    expect(save.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } });
  });

  it('day1 v2（已歸檔一筆＋草稿）→ day.01／work，內容進 Day 1 批次，沒有進度', () => {
    const partial: SaveV2 = {
      ...v2Initial,
      archived: { B102: legacyArchivedAll['B102']! },
      drafts: { H17: { value: 'H-1' } },
      events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'B102', origin: 'defaulted' } }],
    };
    const result = migrateToCurrent(partial, DIR6)!;
    expect(result.from).toBe(2);
    expect(result.save.dayId).toBe(DAY_01);
    expect(result.save.stage).toBe('work');
    expect(result.save.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
    expect(result.save.batches[BATCH_DAY01]!.drafts).toEqual({ H17: { value: 'H-1' } });
    expect(result.save.taskProgress).toEqual({});
    expect('night' in result.save).toBeFalse();
  });

  it('舊日程下 v2 end 仍為 end', () => {
    expect(migrateToCurrent(v2End, DIR2)!.save.stage).toBe('end');
  });

  it('不改動傳入的 v2 物件', () => {
    const before = JSON.parse(JSON.stringify(v2End));
    migrateToCurrent(v2End, DIR6);
    expect(v2End).toEqual(before);
  });
});

/* ---------- v5 → v6 ---------- */

/** 各種 v5 舊檔：Day 2 work、Day 3 做到一半（含草稿）、Day 6 已提交後 end。 */
const v5Day2: SaveV5 = {
  version: 5,
  seed: 1,
  dayId: DAY_02,
  stage: 'work',
  taskId: TASK_DAY2,
  batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }, { B102: { value: '0102', policy: 'request_review' } }) },
  taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } },
  night: NIGHT_NO,
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source', batchId: BATCH_DAY01 } },
    { id: 'day1.complete:1', kind: 'day1.complete', payload: {} },
    { id: 'night.resolved:2', kind: 'night.resolved', payload: { ...NIGHT_NO } },
  ],
  readMessages: ['msg.a', 'msg.day2.b'],
};
const v5Day3: SaveV5 = {
  ...v5Day2,
  dayId: DAY_03,
  taskId: TASK_DAY3,
  batches: {
    ...v5Day2.batches,
    [BATCH_DAY03]: makeBatch({}, { T1: { value: '00' } }),
  },
  taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review' } },
  events: [...v5Day2.events, { id: 'reply.submit:3', kind: 'reply.submit', payload: { taskId: TASK_DAY2, choice: 'review' } }],
};
const T1_ARCHIVED: ArchivedRecord = {
  archiveCode: '0001',
  refusal: null,
  origin: 'source',
  source: snapshotOf(DAY3_RECORDS[0]),
};
const v5Day6End: SaveV5 = {
  ...v5Day3,
  dayId: DAY_06,
  stage: 'end',
  taskId: FIELD_MAP.id,
  batches: { ...v5Day3.batches, [BATCH_DAY03]: makeBatch({ T1: T1_ARCHIVED }) },
  taskProgress: {
    ...v5Day3.taskProgress,
    [FIELD_MAP.id]: {
      kind: 'field-map',
      assignments: { t1: 's1' },
      previewed: true,
      submitted: { rowCount: 1, affectedCount: 0, blankPolicy: null, rows: [{ id: 'row.1', values: { t1: '0102' } }] },
    },
  },
};
const V5_FIXTURES: Array<[string, SaveV5]> = [
  ['Day 2 work', v5Day2],
  ['Day 3 work（草稿）', v5Day3],
  ['Day 6 end', v5Day6End],
];

/** 除了 version／chatReplies／waivedTasks／caseReviews／returns／issueSchedule／readIssueReceipts 與 v11 欄位之外的欄位。 */
function body(s: unknown): Record<string, unknown> {
  const copy = { ...(s as Record<string, unknown>) };
  for (const key of [
    'version',
    'chatReplies',
    'waivedTasks',
    'caseReviews',
    'returns',
    'issueSchedule',
    'readIssueReceipts',
    'issueDrafts',
    'mailbox',
    'readMail',
    'helpRequests',
    'profile',
    'onboarding',
  ]) {
    delete copy[key];
  }
  return copy;
}

describe('migrateV5ToV6', () => {
  it('fixture 都是合法的 v5 舊檔', () => {
    for (const [name, v5] of V5_FIXTURES) {
      expect(isValidLegacySaveV5(v5, DIR6)).withContext(name).toBeTrue();
      expect(isValidSave(v5, DIR6)).withContext(name).toBeFalse();
    }
  });

  for (const [name, v5] of V5_FIXTURES) {
    it(`${name}：只新增空的 chatReplies、version 改 6，其他欄位逐字相同`, () => {
      const v6 = migrateV5ToV6(v5);
      expect(v6.version).toBe(6);
      expect(v6.chatReplies).toEqual({});
      expect(Object.keys(v6).sort()).toEqual([...Object.keys(v5), 'chatReplies'].sort());
      expect(body(v6)).toEqual(body(v5));
      expect(JSON.stringify(body(v6))).toBe(JSON.stringify(body(v5)));
      expect(v6.batches).toEqual(v5.batches);
      expect(v6.taskProgress).toEqual(v5.taskProgress);
      expect(v6.events).toEqual(v5.events);
      expect(v6.readMessages).toEqual(v5.readMessages);
      expect(v6.night).toEqual(v5.night!);
      expect(isValidLegacySaveV6(v6, DIR6)).toBeTrue();
      expect(isValidSave(v6, DIR6)).toBeFalse();
      expect(isValidLegacySaveV7(migrateV6ToV7(v6, DIR6), DIR6)).toBeTrue();
      expect(isValidSave(v8ToCurrent(migrateV7ToV8(migrateV6ToV7(v6, DIR6)), DIR6), DIR6)).toBeTrue();
    });
  }

  it('chatReplies 不放進 taskProgress', () => {
    const v6 = migrateV5ToV6(v5Day3);
    expect(v6.taskProgress).toEqual(v5Day3.taskProgress);
    for (const p of Object.values(v6.taskProgress)) expect('chatReplies' in p!).toBeFalse();
  });

  it('沒有 night 的 v5 不會多出 night 鍵', () => {
    const d1: SaveV5 = { version: 5, seed: 1, dayId: DAY_01, stage: 'work', taskId: TASK_DAY1, batches: {}, taskProgress: {}, events: [], readMessages: [] };
    const v6 = migrateV5ToV6(d1);
    expect('night' in v6).toBeFalse();
    expect(isValidLegacySaveV6(v6, DIR6)).toBeTrue();
    expect('night' in migrateV6ToV7(v6, DIR6)).toBeFalse();
  });

  it('不改動傳入的 v5 物件', () => {
    const before = JSON.parse(JSON.stringify(v5Day6End));
    migrateV5ToV6(v5Day6End);
    expect(v5Day6End).toEqual(before);
    expect('chatReplies' in v5Day6End).toBeFalse();
  });

  it('SAVE_VERSION 為 11，舊版本清單為 2／3／4／5／6／7／8／9／10', () => {
    expect(SAVE_VERSION).toBe(11);
    expect([...LEGACY_SAVE_VERSIONS]).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('migrateToCurrent：v5 → v11', () => {
  for (const [name, v5] of V5_FIXTURES) {
    it(`${name} → from 5、v11，除 version／chatReplies／waivedTasks／caseReviews／returns／issueSchedule 與 v11 欄位外逐字保留`, () => {
      const result = migrateToCurrent(v5, DIR6);
      expect(result).not.toBeNull();
      expect(result!.from).toBe(5);
      expectFreshV11Fields(result!.save);
      expect(result!.save.issueSchedule).toEqual({});
      expect(result!.save.chatReplies).toEqual({});
      expect(result!.save.waivedTasks).toEqual([]);
      expect(result!.save.caseReviews).toEqual({});
      expect(result!.save.returns).toEqual([]);
      expect(body(result!.save)).toEqual(body(v5));
      expect(isValidSave(JSON.parse(JSON.stringify(result!.save)), DIR6)).toBeTrue();
    });
  }

  it('JSON 字串形式的 v5（localStorage 讀回）也能遷移', () => {
    const parsed: unknown = JSON.parse(JSON.stringify(v5Day3));
    const result = migrateToCurrent(parsed, DIR6)!;
    expect(result.from).toBe(5);
    expect(body(result.save)).toEqual(body(v5Day3));
  });

  it('舊事件（含舊字串 day1.complete）原樣保留', () => {
    const save = migrateToCurrent(v5Day2, DIR6)!.save;
    expect(save.events).toEqual(v5Day2.events);
    expect(save.events.map((e) => e.kind)).toContain('day1.complete');
  });

  it('不改動傳入的 v5 物件', () => {
    const before = JSON.parse(JSON.stringify(v5Day2));
    migrateToCurrent(v5Day2, DIR6);
    expect(v5Day2).toEqual(before);
  });

  it('v5 本體不合法 → null（不會因補上 chatReplies／waivedTasks 就被放行）', () => {
    expect(migrateToCurrent({ ...v5Day2, stage: 'end' }, DIR6)).toBeNull();
    expect(migrateToCurrent({ ...v5Day2, night: undefined }, DIR6)).toBeNull();
    expect(migrateToCurrent({ ...v5Day3, taskProgress: {} }, DIR6)).toBeNull();
  });
});

describe('migrateToCurrent：v11、v10、v9、v8、v7、v6 與損壞資料', () => {
  /** v10 舊檔（R11）：有一則舊回覆快照（沒有送達時間）。 */
  const v10: SaveV10 = {
    version: 10,
    seed: 1,
    dayId: DAY_02,
    stage: 'work',
    taskId: TASK_DAY2,
    batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) },
    taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } },
    chatReplies: {
      'prompt.test.a': { kind: 'answered', choiceId: 'join', playerText: '好', responses: [{ id: 'msg.test.r1', actorId: 'actor.test', time: '12:00', lines: ['收到'] }] },
      'prompt.retired.gone': { kind: 'skipped' },
    },
    waivedTasks: [],
    caseReviews: {},
    returns: [],
    issueSchedule: {},
    readIssueReceipts: [],
    night: NIGHT_NO,
    events: [
      { id: 'chat.reply:0', kind: 'chat.reply', payload: { promptId: 'prompt.test.a', choiceId: 'join' } },
      { id: 'chat.skip:1', kind: 'chat.skip', payload: { promptId: 'prompt.retired.gone' } },
    ],
    readMessages: ['msg.a'],
  };
  /**
   * v10 → v11 的期望結果：沒有退件就沒有郵件；角色名 null、入職視為已完成；沒有詢問與修訂草稿；
   * 舊回覆快照沒有 deliverAt → 視為已送達的已讀歷史（回應 ID 併入 readMessages，不重新亮紅點）。
   */
  const v11: Save = (() => {
    const { readIssueReceipts: _ri, version: _v, ...rest } = v10;
    return {
      ...rest,
      version: 11,
      issueDrafts: {},
      mailbox: [],
      readMail: [],
      helpRequests: {},
      profile: { name: null },
      onboarding: { step: 0, complete: true },
      readMessages: ['msg.a', 'msg.test.r1'],
    };
  })();
  const { issueSchedule: _is, readIssueReceipts: _ri, version: _v10, returns: _r10, ...v9Body } = v10;
  const v9: SaveV9 = { ...v9Body, version: 9, returns: [] };
  const { returns: _r, version: _v9, ...v8Body } = v9;
  const v8: SaveV8 = { ...v8Body, version: 8 };
  const { caseReviews: _c, version: _v8, ...v7Body } = v8;
  const v7: SaveV7 = { ...v7Body, version: 7 };
  const { waivedTasks: _w, version: _v, ...v6Body } = v7;
  const v6: SaveV6 = { ...v6Body, version: 6 };

  it('現行 v11 → from 11，回傳同一個物件（不複製、不轉換）', () => {
    expect(isValidSave(v11, DIR6)).toBeTrue();
    const result = migrateToCurrent(v11, DIR6);
    expect(result).toEqual({ save: v11, from: 11 });
    expect(result!.save).toBe(v11);
    expect(result!.save.chatReplies).toBe(v11.chatReplies);
  });

  it('v11 JSON 往返後 → from 11，chatReplies 保留（含內容已移除的 prompt）', () => {
    const result = migrateToCurrent(JSON.parse(JSON.stringify(v11)), DIR6)!;
    expect(result.from).toBe(11);
    expect(result.save).toEqual(v11);
  });

  it('v10（沒有退件）→ from 10：拿掉 readIssueReceipts、補 v11 欄位，舊回覆的回應 ID 併入已讀；其他欄位逐字相同', () => {
    expect(isValidLegacySaveV10(v10, DIR6)).toBeTrue();
    expect(isValidSave(v10, DIR6)).toBeFalse();
    const result = migrateToCurrent(v10, DIR6)!;
    expect(result.from).toBe(10);
    expect(result.save).toEqual(v11);
    expect(migrateV10ToV11(v10, DIR6)).toEqual(v11);
    const added = ['issueDrafts', 'mailbox', 'readMail', 'helpRequests', 'profile', 'onboarding'];
    expect(Object.keys(result.save).sort()).toEqual([...Object.keys(v10).filter((k) => k !== 'readIssueReceipts'), ...added].sort());
    // 輸入不變
    expect(v10.readMessages).toEqual(['msg.a']);
    expect('readIssueReceipts' in v10).toBeTrue();
  });

  it('v9（沒有退件）→ from 9、補空 issueSchedule 再補 v11 欄位，其他欄位逐字相同', () => {
    expect(isValidLegacySaveV9(v9, DIR6)).toBeTrue();
    expect(isValidSave(v9, DIR6)).toBeFalse();
    const result = migrateToCurrent(v9, DIR6)!;
    expect(result.from).toBe(9);
    expect(result.save).toEqual(v11);
    expect(result.save).not.toBe(v11);
    expect(migrateV9ToV10(v9, DIR6)).toEqual(v10);
    expect(v9ToCurrent(v9, DIR6)).toEqual(v11);
  });

  it('v8 → from 8、補空 returns／issueSchedule 與 v11 欄位，其他欄位逐字相同', () => {
    expect(isValidLegacySaveV8(v8, DIR6)).toBeTrue();
    expect(isValidSave(v8, DIR6)).toBeFalse();
    const result = migrateToCurrent(v8, DIR6)!;
    expect(result.from).toBe(8);
    expect(result.save).toEqual(v11);
    expect(result.save).not.toBe(v11);
    expect(result.save.returns).toEqual([]);
  });

  it('v7 → from 7、補空 caseReviews／returns，其他欄位逐字相同', () => {
    expect(isValidLegacySaveV7(v7, DIR6)).toBeTrue();
    expect(isValidSave(v7, DIR6)).toBeFalse();
    const result = migrateToCurrent(v7, DIR6)!;
    expect(result.from).toBe(7);
    expect(result.save).toEqual(v11);
    expect(result.save).not.toBe(v11);
    expect(result.save.caseReviews).toEqual({});
  });

  it('v6 → from 6、補空 waivedTasks／caseReviews／returns，其他欄位逐字相同', () => {
    const result = migrateToCurrent(v6, DIR6)!;
    expect(result.from).toBe(6);
    expect(result.save).toEqual(v11);
    expect(result.save).not.toBe(v11);
  });

  it('遷移結果再丟進 migrateToCurrent 會被視為 v11（不會再次遷移、已讀不再增加）', () => {
    for (const legacy of [v2End, v3End, v4Day2End, v5Day3, v6, v7, v8, v9, v10] as unknown[]) {
      const once = migrateToCurrent(legacy, DIR6)!;
      const twice = migrateToCurrent(JSON.parse(JSON.stringify(once.save)), DIR6)!;
      expect(twice.from).toBe(11);
      expect(JSON.stringify(twice.save)).toBe(JSON.stringify(once.save));
    }
  });

  it('每個舊版本各自回報正確的 from，鏈一律停在 v11', () => {
    const cases: Array<[unknown, number]> = [
      [v2End, 2],
      [v3End, 3],
      [v4Day2End, 4],
      [v5Day2, 5],
      [v6, 6],
      [v7, 7],
      [v8, 8],
      [v9, 9],
      [v10, 10],
      [v11, 11],
    ];
    for (const [input, from] of cases) {
      const result = migrateToCurrent(input, DIR6);
      expect(result).withContext(`v${from}`).not.toBeNull();
      expect(result!.from).withContext(`v${from}`).toBe(from as never);
      expect(result!.save.version).withContext(`v${from}`).toBe(11);
      expect(result!.save.caseReviews).withContext(`v${from}`).toEqual({});
      expect(result!.save.returns).withContext(`v${from}`).toEqual([]);
      expect(result!.save.issueSchedule).withContext(`v${from}`).toEqual({});
      expect(result!.save.mailbox).withContext(`v${from}`).toEqual([]);
      expect(result!.save.readMail).withContext(`v${from}`).toEqual([]);
      expect(result!.save.onboarding).withContext(`v${from}`).toEqual({ step: 0, complete: true });
      expect(result!.save.profile).withContext(`v${from}`).toEqual({ name: null });
      expect('readIssueReceipts' in result!.save).withContext(`v${from}`).toBeFalse();
      expect(isValidSave(result!.save, DIR6)).withContext(`v${from}`).toBeTrue();
    }
  });

  it('R10：舊檔中與來源不同的編號照樣遷移，原樣保留、不猜測補回', () => {
    const v2 = { ...v2Initial, archived: { B102: { archiveCode: '102', refusal: false, origin: 'defaulted' } } };
    const fromV2 = migrateToCurrent(v2, DIR6)!;
    expect(fromV2).not.toBeNull();
    expect(fromV2.from).toBe(2);
    expect(fromV2.save.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
    expect(fromV2.save.batches[BATCH_DAY01]!.archived['B102']!.source.code).toBe('0102');
    const v3 = { ...v3Day2, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '102' } }) } };
    const fromV3 = migrateToCurrent(v3, DIR6)!;
    expect(fromV3).not.toBeNull();
    expect(fromV3.from).toBe(3);
    expect(fromV3.save.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
    const fromV8 = migrateToCurrent({ ...v8, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B607: { ...archivedAll['B607'], archiveCode: '607' } }) } }, DIR6)!;
    expect(fromV8).not.toBeNull();
    expect(fromV8.from).toBe(8);
    expect(fromV8.save.batches[BATCH_DAY01]!.archived['B607']!.archiveCode).toBe('607');
    for (const r of [fromV2, fromV3, fromV8]) expect(isValidSave(JSON.parse(JSON.stringify(r.save)), DIR6)).toBeTrue();
  });

  const broken: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['空物件', {}],
    ['陣列', []],
    ['字串', 'save'],
    ['{"version":2}', { version: 2 }],
    ['{"version":3}', { version: 3 }],
    ['{"version":4}', { version: 4 }],
    ['{"version":5}', { version: 5 }],
    ['{"version":6}', { version: 6 }],
    ['{"version":7}', { version: 7 }],
    ['{"version":8}', { version: 8 }],
    ['{"version":9}', { version: 9 }],
    ['{"version":10}', { version: 10 }],
    ['{"version":11}', { version: 11 }],
    ['version 12', { ...v11, version: 12 }],
    ['v9 形狀但標為 version 10', { ...v9, version: 10 }],
    ['v10 形狀但標為 version 11', { ...v10, version: 11 }],
    ['v10 缺 issueSchedule', omitKey(v10, 'issueSchedule')],
    ['v10 缺 readIssueReceipts', omitKey(v10, 'readIssueReceipts')],
    ['v10 readIssueReceipts 含未知回條', { ...v10, readIssueReceipts: ['return.x#0'] }],
    ['v10 issueSchedule 排在未來的日子', { ...v10, issueSchedule: { [DAY_03]: ['return.x'] } }],
    ['v10 returns 為物件', { ...v10, returns: {} }],
    ['v11 缺 mailbox', omitKey(v11, 'mailbox')],
    ['v11 缺 profile', omitKey(v11, 'profile')],
    ['v11 onboarding 為 null', { ...v11, onboarding: null }],
    ['v11 帶 readIssueReceipts 且缺 readMail', { ...omitKey(v11, 'readMail'), readIssueReceipts: [] }],
    ['v9 缺 returns', omitKey(v9, 'returns')],
    ['v9 returns 為物件', { ...v9, returns: {} }],
    ['v9 returns 含未知稽核的退件', { ...v9, returns: [{ id: 'return.audit.x.B102', auditId: 'audit.x', recordKey: 'B102' }] }],
    ['v8 缺 caseReviews', omitKey(v8, 'caseReviews')],
    ['v8 caseReviews 含未知案件', { ...v8, caseReviews: { 'case.unknown': { variantId: 'received', marks: [] } } }],
    ['v8 缺 waivedTasks', omitKey(v8, 'waivedTasks')],
    ['v8 非第一天無 night', { ...v8, night: undefined }],
    ['v1（archiveName）', { ...v2Initial, version: 1, archived: { B102: { archiveName: 102, refusal: false, origin: 'defaulted' } } }],
    ['v2 archived 含未知 key', { ...v2Initial, archived: { X99: { archiveCode: '99', refusal: null, origin: 'source' } } }],
    ['v2 archiveCode 為空字串', { ...v2Initial, archived: { B102: { archiveCode: '', refusal: false, origin: 'defaulted' } } }],
    ['v2 archiveCode 為數字 102', { ...v2Initial, archived: { B102: { archiveCode: 102, refusal: false, origin: 'defaulted' } } }],
    ['v2 drafts 含未知 key', { ...v2Initial, drafts: { X99: { value: '1' } } }],
    ['v2 overnight 卻沒歸檔完', { ...v2Initial, phase: 'overnight' }],
    ['v2 day2 卻沒歸檔完', { ...v2Initial, phase: 'day2', night: NIGHT_YES }],
    ['v2 end 但 reply 缺', { ...v2End, reply: undefined }],
    ['v2 end 回覆 review 卻沒開副本（矛盾）', { ...v2End, evidence: { reportOpened: true, receiptOpened: false } }],
    ['v3 目前批次 B102 編號為純空白', { ...v3Day2, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '  ' } }) } }],
    ['v3 overnight 卻沒歸檔完', { ...v3Initial, phase: 'overnight' }],
    ['v3 phase 未知', { ...v3Initial, phase: 'work' }],
    ['v3 end 回覆卻沒開摘要（矛盾）', { ...v3End, evidence: { reportOpened: false, receiptOpened: false } }],
    ['v4 Day 2 但 Day 1 批次為空', { ...v4Day2Work, batches: {} }],
    ['v4 stage 非法', { ...v4Day2Work, stage: 'day2' }],
    ['v4 非第一天無 night', { ...v4Day2Work, night: undefined }],
    ['v4 dayId 未知', { ...v4Day2Work, dayId: 'day.99' }],
    ['v4 Day 2 end 卻沒有 reply（遷移成 wrap 也未完成）', { ...v4Day2End, reply: undefined }],
    ['v4 Day 2 reply review 卻沒開副本', { ...v4Day2End, evidence: { reportOpened: true, receiptOpened: false } }],
    ['v4 Day 1 wrap 卻沒歸檔完', { ...v4Day1, stage: 'wrap' }],
    ['v4 Day 1 end（有下一日，轉 wrap 後仍未完成）', { ...v4Day1, stage: 'end' }],
    ['v4 evidence 缺', { ...v4Day1, evidence: undefined }],
    ['v5 day.02 end（有下一日）', { ...v5Day2, stage: 'end', taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'ack' } } }],
    ['v5 taskProgress kind 不符', { ...v5Day2, taskProgress: { [TASK_DAY2]: { kind: 'field-map', assignments: {}, previewed: false } } }],
    ['v5 帶 v4 的全域 evidence 卻沒有 taskProgress', { ...v5Day2, taskProgress: undefined, evidence: { reportOpened: true, receiptOpened: false } }],
    ['v6 缺 chatReplies', { ...body(v6), version: 6 }],
    ['v6 stage 為 morning（v6 沒有次日收件）', { ...v6, stage: 'morning' }],
    ['v6 taskId 不屬於該日', { ...v6, taskId: TASK_DAY3 }],
    ['v6 chatReplies 為陣列', { ...v6, chatReplies: [] }],
    ['v6 chatReplies kind 未知', { ...v6, chatReplies: { 'prompt.test.a': { kind: 'maybe' } } }],
    ['v6 answered 缺 playerText', { ...v6, chatReplies: { 'prompt.test.a': { kind: 'answered', choiceId: 'join', responses: [] } } }],
    ['v6 day.02 end（有下一日）', { ...v6, stage: 'end', taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'ack' } } }],
    ['v6 非第一天無 night', { ...v6, night: undefined }],
    ['v7 缺 waivedTasks', omitKey(v7, 'waivedTasks')],
    ['v7 waivedTasks 含未知工作', { ...v7, waivedTasks: ['task.unknown'] }],
    ['v7 day.02 end（有下一日）', { ...v7, stage: 'end', taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'ack' } } }],
    ['v7 非第一天無 night', { ...v7, night: undefined }],
  ];
  for (const [name, input] of broken) {
    it(`${name} → null`, () => expect(migrateToCurrent(input, DIR6)).toBeNull());
  }
});

/* ---------- R8：v6 → v7 舊檔免補 ---------- */

/**
 * 現行 R8 形狀的目錄（測試自建）：Day 1、Day 2 各多一件工作，Day 3–6 維持一件。
 * day.01：歸檔（第一批）→ 歸檔（跟進）；day.02：核對（看 Day 1 第一批）→ 歸檔；day.03…day.06 同 DIR6。
 */
const TASK_DAY1_FOLLOWUP = 'task.day1.archive-followup';
const TASK_DAY2_ARCHIVE = 'task.day2.archive';
const BATCH_DAY01_FOLLOWUP = 'batch.day01.archive-followup';
const BATCH_DAY02 = 'batch.day02.archive';
const FOLLOWUP_RECORDS: readonly SourceRecord[] = [
  { key: 'F1', name: null, code: '0801', refusal: false, refusalApplies: true },
  { key: 'F2', name: null, code: '0802', refusal: null, refusalApplies: false },
];
const DAY2_ARCHIVE_RECORDS: readonly SourceRecord[] = [
  // 故意與 Day 1 第一批的 B102 同鍵：驗證 Day 2 新批次不影響四格矩陣
  { key: 'B102', name: null, code: '0102', refusal: false, refusalApplies: true },
  { key: 'W1', name: null, code: '0901', refusal: true, refusalApplies: true },
];

const DIR_R8: DayDirectory = createDayDirectory(
  [
    {
      ...PLAN_DAY1,
      tasks: [
        ...PLAN_DAY1.tasks,
        { id: TASK_DAY1_FOLLOWUP, kind: 'archive', batchId: BATCH_DAY01_FOLLOWUP, recordKeys: FOLLOWUP_RECORDS.map((r) => r.key), caseReviews: [] },
      ],
    },
    {
      ...planDay2(DAY_03),
      tasks: [
        ...planDay2(DAY_03).tasks,
        { id: TASK_DAY2_ARCHIVE, kind: 'archive', batchId: BATCH_DAY02, recordKeys: DAY2_ARCHIVE_RECORDS.map((r) => r.key), caseReviews: [] },
      ],
    },
    ...DIR6.days.slice(2).map((d) => DIR6.plan(d)!),
  ],
  { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_DAY01_FOLLOWUP]: FOLLOWUP_RECORDS, [BATCH_DAY02]: DAY2_ARCHIVE_RECORDS, [BATCH_DAY03]: DAY3_RECORDS },
);

function archivedOf(records: readonly SourceRecord[]): Record<RecordKey, ArchivedRecord> {
  const out: Record<RecordKey, ArchivedRecord> = {};
  for (const r of records) out[r.key] = { archiveCode: r.code, refusal: r.refusal, origin: 'source', source: snapshotOf(r) };
  return out;
}

const REPLY_ACK = { kind: 'reconcile' as const, reportOpened: true, receiptOpened: false, reply: 'ack' as const };
const CHAT = {
  'prompt.test.a': { kind: 'answered' as const, choiceId: 'join', playerText: '好', responses: [{ id: 'msg.test.r1', actorId: 'actor.test', time: '12:00', lines: ['收到'] }] },
  'prompt.test.b': { kind: 'skipped' as const },
};
const LEGACY_EVENTS = [
  { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source', batchId: BATCH_DAY01 } },
  { id: 'day.complete:1', kind: 'day.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } },
  { id: 'night.resolved:2', kind: 'night.resolved', payload: { ...NIGHT_NO } },
  { id: 'chat.reply:3', kind: 'chat.reply', payload: { promptId: 'prompt.test.a', choiceId: 'join' } },
];

/** v6 舊檔：當時每天只有一件工作（taskId＝當日第一件），階段只有 work／wrap／end。 */
const v6D1Work: SaveV6 = {
  version: 6,
  seed: 1,
  dayId: DAY_01,
  stage: 'work',
  taskId: TASK_DAY1,
  batches: { [BATCH_DAY01]: makeBatch({ B102: archivedAll['B102'] }, { H17: { value: 'H-1' } }) },
  taskProgress: {},
  chatReplies: { 'prompt.test.b': { kind: 'skipped' } },
  events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'B102', origin: 'defaulted', batchId: BATCH_DAY01 } }],
  readMessages: ['msg.day1.a'],
};
const v6D1Wrap: SaveV6 = { ...v6D1Work, stage: 'wrap', batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }, { H17: { value: 'H-17' } }) } };
const v6D2Work: SaveV6 = {
  ...v6D1Wrap,
  dayId: DAY_02,
  stage: 'work',
  taskId: TASK_DAY2,
  taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } },
  chatReplies: CHAT,
  night: NIGHT_NO,
  events: LEGACY_EVENTS,
  readMessages: ['msg.day1.a', 'msg.day2.a'],
};
const v6D2Wrap: SaveV6 = { ...v6D2Work, stage: 'wrap', taskProgress: { [TASK_DAY2]: REPLY_ACK } };
const v6D3Work: SaveV6 = { ...v6D2Wrap, dayId: DAY_03, stage: 'work', taskId: TASK_DAY3, batches: { ...v6D2Wrap.batches, [BATCH_DAY03]: makeBatch({}, { T1: { value: '00' } }) } };
const v6D6End: SaveV6 = {
  ...v6D3Work,
  dayId: DAY_06,
  stage: 'end',
  taskId: FIELD_MAP.id,
  batches: { ...v6D3Work.batches, [BATCH_DAY03]: makeBatch({ T1: T1_ARCHIVED }) },
  taskProgress: {
    ...v6D2Wrap.taskProgress,
    [FIELD_MAP.id]: {
      kind: 'field-map',
      assignments: { t1: 's1' },
      previewed: true,
      submitted: { rowCount: 1, affectedCount: 0, blankPolicy: null, rows: [{ id: 'row.1', values: { t1: '0102' } }] },
    },
  },
};

describe('migrateV6ToV7（R8 舊檔免補）', () => {
  it('fixture 都是合法的 v6 舊檔，不是 v7', () => {
    for (const v6 of [v6D1Work, v6D1Wrap, v6D2Work, v6D2Wrap, v6D3Work, v6D6End]) {
      expect(isValidLegacySaveV6(v6, DIR_R8)).withContext(`${v6.dayId}/${v6.stage}`).toBeTrue();
      expect(isValidSave(v6, DIR_R8)).withContext(`${v6.dayId}/${v6.stage}`).toBeFalse();
    }
  });

  const cases: Array<[string, SaveV6, string[]]> = [
    ['Day 1 work：目前日仍在 work，不免補（做完舊工作後接新工作）', v6D1Work, []],
    ['Day 1 wrap：Day 1 跟進工作免補', v6D1Wrap, [TASK_DAY1_FOLLOWUP]],
    ['Day 2 work（核對）：Day 1 跟進免補，Day 2 第二件不免補', v6D2Work, [TASK_DAY1_FOLLOWUP]],
    ['Day 2 wrap：Day 1、Day 2 第二件都免補', v6D2Wrap, [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
    ['Day 3 work：Day 1、Day 2 第二件免補', v6D3Work, [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
    ['Day 6 end：Day 1、Day 2 第二件免補', v6D6End, [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
  ];
  for (const [name, v6, waived] of cases) {
    it(`${name}`, () => {
      const v7 = migrateV6ToV7(v6, DIR_R8);
      expect(v7.version).toBe(7);
      expect(v7.waivedTasks).toEqual(waived);
      expect(isValidLegacySaveV7(v7, DIR_R8)).toBeTrue();
      expect(isValidSave(v7, DIR_R8)).toBeFalse();
      expect(isValidSave(v8ToCurrent(migrateV7ToV8(v7), DIR_R8), DIR_R8)).toBeTrue();
      // 每天的第一件永遠不免補
      for (const dayId of DIR_R8.days) expect(v7.waivedTasks).not.toContain(DIR_R8.plan(dayId)!.tasks[0]!.id);
      // 其他欄位逐字保留，不新增事件
      expect(body(v7)).toEqual(body(v6));
      expect(v7.chatReplies).toEqual(v6.chatReplies);
      expect(v7.events).toEqual(v6.events);
      const result = migrateToCurrent(v6, DIR_R8)!;
      expect(result.from).toBe(6);
      expect(result.save).toEqual(v8ToCurrent(migrateV7ToV8(v7), DIR_R8));
    });
  }

  it('舊檔已真的做完的第二件工作不列免補', () => {
    const done: SaveV6 = { ...v6D2Wrap, batches: { ...v6D2Wrap.batches, [BATCH_DAY01_FOLLOWUP]: makeBatch(archivedOf(FOLLOWUP_RECORDS)) } };
    expect(migrateV6ToV7(done, DIR_R8).waivedTasks).toEqual([TASK_DAY2_ARCHIVE]);
    const partial: SaveV6 = { ...v6D2Wrap, batches: { ...v6D2Wrap.batches, [BATCH_DAY01_FOLLOWUP]: makeBatch({ F1: archivedOf(FOLLOWUP_RECORDS)['F1'] }) } };
    expect(migrateV6ToV7(partial, DIR_R8).waivedTasks).toEqual([TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]);
  });

  it('批次、草稿、回覆、聊天回覆、已讀、night、事件全部保留；遷移不寫任何事件', () => {
    const v7 = migrateToCurrent(JSON.parse(JSON.stringify(v6D2Wrap)), DIR_R8)!.save;
    expect(v7.batches).toEqual(v6D2Wrap.batches);
    expect(v7.batches[BATCH_DAY01]!.drafts).toEqual({ H17: { value: 'H-17' } });
    expect(v7.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
    expect(reconcileProgressOf(v7, TASK_DAY2).reply).toBe('ack');
    expect(v7.chatReplies).toEqual(CHAT);
    // R12：舊回覆快照（沒有送達時間）的回應視為已讀歷史，併入已讀清單尾端
    expect(v7.readMessages).toEqual(['msg.day1.a', 'msg.day2.a', 'msg.test.r1']);
    expect(v7.night).toEqual(NIGHT_NO);
    expect(v7.events).toEqual(LEGACY_EVENTS);
    expect(v7.events.some((e) => e.kind === 'task.complete')).toBeFalse();
    // 免補的工作沒有被當成已提交：沒有批次、沒有進度
    expect(v7.batches[BATCH_DAY01_FOLLOWUP]).toBeUndefined();
    expect(v7.batches[BATCH_DAY02]).toBeUndefined();
  });

  it('免補不是完成：isTaskDone false、isTaskWaived／isTaskSettled true', () => {
    const v7 = v8ToCurrent(migrateV7ToV8(migrateV6ToV7(v6D2Wrap, DIR_R8)), DIR_R8);
    for (const [dayId, index] of [[DAY_01, 1], [DAY_02, 1]] as const) {
      const task = DIR_R8.plan(dayId)!.tasks[index]!;
      expect(isTaskDone(v7, DIR_R8, task)).withContext(task.id).toBeFalse();
      expect(isTaskWaived(v7, task.id)).withContext(task.id).toBeTrue();
      expect(isTaskSettled(v7, DIR_R8, task)).withContext(task.id).toBeTrue();
    }
    const first = DIR_R8.plan(DAY_01)!.tasks[0]!;
    expect(isTaskWaived(v7, first.id)).toBeFalse();
    expect(isTaskDone(v7, DIR_R8, first)).toBeTrue();
  });

  it('前面日子的第一件沒真的完成 → null（不會被免補硬救）', () => {
    const d2Empty: SaveV6 = { ...v6D2Work, batches: {} };
    expect(isValidLegacySaveV6(d2Empty, DIR_R8)).toBeTrue();
    expect(migrateV6ToV7(d2Empty, DIR_R8).waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
    expect(migrateToCurrent(d2Empty, DIR_R8)).toBeNull();
    const d3NoReply: SaveV6 = { ...v6D3Work, taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } } };
    expect(migrateToCurrent(d3NoReply, DIR_R8)).toBeNull();
    const d1WrapPartial: SaveV6 = { ...v6D1Wrap, batches: { [BATCH_DAY01]: makeBatch({ B102: archivedAll['B102'] }) } };
    expect(migrateToCurrent(d1WrapPartial, DIR_R8)).toBeNull();
  });

  it('v6 的 taskId 若不是當日第一件 → null', () => {
    expect(migrateToCurrent({ ...v6D1Work, taskId: TASK_DAY1_FOLLOWUP }, DIR_R8)).toBeNull();
    expect(migrateToCurrent({ ...v6D2Work, taskId: TASK_DAY2_ARCHIVE }, DIR_R8)).toBeNull();
  });

  it('不改動傳入的 v6 物件', () => {
    const before = JSON.parse(JSON.stringify(v6D2Wrap));
    migrateV6ToV7(v6D2Wrap, DIR_R8);
    migrateToCurrent(v6D2Wrap, DIR_R8);
    expect(v6D2Wrap).toEqual(before);
    expect('waivedTasks' in v6D2Wrap).toBeFalse();
  });
});

describe('migrateV7ToV8（R9）', () => {
  const v7s: Array<[string, SaveV7]> = [
    ['Day 1 work', migrateV6ToV7(v6D1Work, DIR_R8)],
    ['Day 2 wrap（兩件免補）', migrateV6ToV7(v6D2Wrap, DIR_R8)],
    ['Day 6 end', migrateV6ToV7(v6D6End, DIR_R8)],
  ];
  for (const [name, v7] of v7s) {
    it(`${name}：只新增空的 caseReviews、version 改 8，其他欄位逐字相同；再補 returns（v9）、排程（v10）與 v11 欄位才是現行格式`, () => {
      expect(isValidLegacySaveV7(v7, DIR_R8)).toBeTrue();
      const before = JSON.stringify(v7);
      const v8 = migrateV7ToV8(v7);
      expect(v8.version).toBe(8);
      expect(v8.caseReviews).toEqual({});
      expect(Object.keys(v8).sort()).toEqual([...Object.keys(v7), 'caseReviews'].sort());
      expect(omitKey(omitKey(v8, 'caseReviews'), 'version')).toEqual(omitKey(v7, 'version'));
      expect(v8.waivedTasks).toEqual(v7.waivedTasks);
      expect(v8.chatReplies).toEqual(v7.chatReplies);
      expect(v8.batches).toEqual(v7.batches);
      expect(v8.events).toEqual(v7.events);
      expect(isValidLegacySaveV8(v8, DIR_R8)).toBeTrue();
      expect(isValidSave(v8, DIR_R8)).toBeFalse();
      expect(isValidSave(migrateV8ToV9(v8), DIR_R8)).toBeFalse();
      expect(isValidLegacySaveV9(migrateV8ToV9(v8), DIR_R8)).toBeTrue();
      expect(isValidSave(v8ToCurrent(v8, DIR_R8), DIR_R8)).toBeTrue();
      expect(isValidLegacySaveV7(v8, DIR_R8)).toBeFalse();
      // 不改動傳入物件、不寫事件
      expect(JSON.stringify(v7)).toBe(before);
      expect('caseReviews' in v7).toBeFalse();
      expect(v8.events.length).toBe(v7.events.length);
      // 與 migrateToCurrent 的結果一致
      const result = migrateToCurrent(JSON.parse(before), DIR_R8)!;
      expect(result.from).toBe(7);
      expect(result.save).toEqual(v8ToCurrent(v8, DIR_R8));
    });
  }
});

describe('R8 遷移後可以繼續玩', () => {
  it('v6 Day 1 work：做完舊工作後接本輪新增的跟進工作，不直接進日結', () => {
    const v7 = migrateToCurrent(v6D1Work, DIR_R8)!.save;
    const s = { ...v7, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) } };
    const next = completeWork(s, DIR_R8);
    expect([next.stage, next.taskId]).toEqual(['work', TASK_DAY1_FOLLOWUP]);
    expect(next.events.slice(-1)).toEqual([{ id: `task.complete:${s.events.length}`, kind: 'task.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } }]);
    expect(isValidSave(next, DIR_R8)).toBeTrue();
  });

  it('v6 Day 1 wrap：advanceDay 進 Day 2 次日收件（第一件核對），夜間只擲一次', () => {
    const v7 = migrateToCurrent(v6D1Wrap, DIR_R8)!.save;
    const morning = advanceDay(v7, DIR_R8);
    expect([morning.dayId, morning.stage, morning.taskId]).toEqual([DAY_02, 'morning', TASK_DAY2]);
    expect(morning.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
    expect(morning.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
    expect(isValidSave(morning, DIR_R8)).toBeTrue();
    expect(startDay(morning).stage).toBe('work');
  });

  it('v6 Day 2 work：回覆核對後接 Day 2 新增的歸檔工作（不免補）', () => {
    const v7 = migrateToCurrent(v6D2Work, DIR_R8)!.save;
    // R10：舊檔進行中的核對仍要先逐筆審查才能回覆
    expect(submitReply(markReportOpened(v7, DIR_R8), DIR_R8, 'ask').taskId).toBe(TASK_DAY2);
    const next = submitReply(setRecordReview(markReportOpened(v7, DIR_R8), DIR_R8, 'B102', 'hold'), DIR_R8, 'ask');
    expect([next.dayId, next.stage, next.taskId]).toEqual([DAY_02, 'work', TASK_DAY2_ARCHIVE]);
    expect(next.events.slice(-3).map((e) => e.kind)).toEqual(['record.review', 'reply.submit', 'task.complete']);
    expect(next.events.some((e) => e.kind === 'day.complete' && (e.payload as { dayId?: string }).dayId === DAY_02)).toBeFalse();
    expect(isValidSave(next, DIR_R8)).toBeTrue();
  });

  it('v6 Day 2 wrap：advanceDay 直接接 Day 3（不被 Day 2 新工作卡住）', () => {
    const v7 = migrateToCurrent(v6D2Wrap, DIR_R8)!.save;
    const day3 = advanceDay(v7, DIR_R8);
    expect([day3.dayId, day3.stage, day3.taskId]).toEqual([DAY_03, 'morning', TASK_DAY3]);
    expect(day3.night).toBe(v7.night!);
    expect(isValidSave(day3, DIR_R8)).toBeTrue();
  });

  it('四格矩陣只看 Day 1 第一批：Day 2 新批次（同鍵 B102 為 false）不影響', () => {
    // Day 1 第一批 B102 送覆核（null）、無介入 → 待資料覆核
    const held = migrateToCurrent(
      { ...v6D2Work, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: { ...archivedAll['B102'], refusal: null, origin: 'review' } }) } },
      DIR_R8,
    )!.save;
    expect(isArrangedInSave(held, DIR_R8)).toBeFalse();
    const onDay2Archive = submitReply(setRecordReview(markReportOpened(held, DIR_R8), DIR_R8, 'B102', 'hold'), DIR_R8, 'ack');
    expect(onDay2Archive.taskId).toBe(TASK_DAY2_ARCHIVE);
    const withSecond = { ...onDay2Archive, batches: { ...onDay2Archive.batches, [BATCH_DAY02]: makeBatch(archivedOf(DAY2_ARCHIVE_RECORDS)) } };
    expect(withSecond.batches[BATCH_DAY02]!.archived['B102']!.refusal).toBeFalse();
    expect(isArrangedInSave(withSecond, DIR_R8)).toBeFalse();
    expect(isArrangedInSave({ ...withSecond, night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 } }, DIR_R8)).toBeTrue();
  });
});

describe('R8：v5／v4／v3／v2 鏈都走到 v11', () => {
  const chains: Array<[string, unknown, number, string, Stage, string[]]> = [
    ['v5 Day 2 work', { ...body(v6D2Work), version: 5 }, 5, DAY_02, 'work', [TASK_DAY1_FOLLOWUP]],
    ['v5 Day 2 wrap', { ...body(v6D2Wrap), version: 5 }, 5, DAY_02, 'wrap', [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
    ['v4 Day 1 work', v4Day1, 4, DAY_01, 'work', []],
    ['v4 Day 1 wrap', v4Day1Wrap, 4, DAY_01, 'wrap', [TASK_DAY1_FOLLOWUP]],
    ['v4 Day 2 work', v4Day2Work, 4, DAY_02, 'work', [TASK_DAY1_FOLLOWUP]],
    ['v4 Day 2 end（現行日程轉 wrap）', v4Day2End, 4, DAY_02, 'wrap', [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
    ['v3 day1', v3Initial, 3, DAY_01, 'work', []],
    ['v3 overnight', v3Overnight, 3, DAY_01, 'wrap', [TASK_DAY1_FOLLOWUP]],
    ['v3 day2', v3Day2, 3, DAY_02, 'work', [TASK_DAY1_FOLLOWUP]],
    ['v3 end', v3End, 3, DAY_02, 'wrap', [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
    ['v2 day1', v2Initial, 2, DAY_01, 'work', []],
    ['v2 overnight', v2Overnight, 2, DAY_01, 'wrap', [TASK_DAY1_FOLLOWUP]],
    ['v2 day2', v2Day2, 2, DAY_02, 'work', [TASK_DAY1_FOLLOWUP]],
    ['v2 end', v2End, 2, DAY_02, 'wrap', [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE]],
  ];
  for (const [name, input, from, dayId, stage, waived] of chains) {
    it(`${name} → from ${from}、v11 ${dayId}/${stage}，免補 ${waived.length} 件，事件不增加`, () => {
      const before = JSON.stringify(input);
      const result = migrateToCurrent(input, DIR_R8);
      expect(result).not.toBeNull();
      expect(result!.from).toBe(from as never);
      const save = result!.save;
      expectFreshV11Fields(save, name);
      expect([save.dayId, save.stage]).toEqual([dayId, stage]);
      expect(save.taskId).toBe(DIR_R8.plan(dayId)!.tasks[0]!.id);
      expect(save.waivedTasks).toEqual(waived);
      expect(save.caseReviews).toEqual({});
      expect(save.returns).toEqual([]);
      expect(save.issueSchedule).toEqual({});
      expect(save.events).toEqual((input as { events: unknown[] }).events as never);
      expect(isValidSave(JSON.parse(JSON.stringify(save)), DIR_R8)).toBeTrue();
      expect(JSON.stringify(input)).toBe(before);
    });
  }
});

/* ---------- R10：v8 → v9（延後退件） ---------- */

describe('migrateV8ToV9（R10）', () => {
  const v8s: Array<[string, SaveV8]> = [
    ['Day 1 work', migrateV7ToV8(migrateV6ToV7(v6D1Work, DIR_R8))],
    ['Day 2 wrap（兩件免補）', migrateV7ToV8(migrateV6ToV7(v6D2Wrap, DIR_R8))],
    ['Day 6 end', migrateV7ToV8(migrateV6ToV7(v6D6End, DIR_R8))],
  ];
  for (const [name, v8] of v8s) {
    it(`${name}：只新增空的 returns、version 改 9，其他欄位逐字相同；不寫事件、不補造審查`, () => {
      expect(isValidLegacySaveV8(v8, DIR_R8)).toBeTrue();
      expect(isValidSave(v8, DIR_R8)).toBeFalse();
      const before = JSON.stringify(v8);
      const v9 = migrateV8ToV9(v8);
      expect(v9.version).toBe(9);
      expect(v9.returns).toEqual([]);
      expect(Object.keys(v9).sort()).toEqual([...Object.keys(v8), 'returns'].sort());
      expect(omitKey(omitKey(v9, 'returns'), 'version')).toEqual(omitKey(v8, 'version'));
      expect(v9.taskProgress).toEqual(v8.taskProgress);
      expect(v9.events).toEqual(v8.events);
      expect(isValidSave(v9, DIR_R8)).toBeFalse();
      expect(isValidLegacySaveV9(v9, DIR_R8)).toBeTrue();
      expect(isValidLegacySaveV10(migrateV9ToV10(v9, DIR_R8), DIR_R8)).toBeTrue();
      expect(isValidSave(v9ToCurrent(v9, DIR_R8), DIR_R8)).toBeTrue();
      expect(isValidLegacySaveV8(v9, DIR_R8)).toBeFalse();
      // 不改動傳入物件
      expect(JSON.stringify(v8)).toBe(before);
      expect('returns' in v8).toBeFalse();
      // 舊核對進度沒有審查處置：不補造
      for (const p of Object.values(v9.taskProgress)) if (p?.kind === 'reconcile') expect(p.reviews).toBeUndefined();
      // 與 migrateToCurrent 的結果一致
      const result = migrateToCurrent(JSON.parse(before), DIR_R8)!;
      expect(result.from).toBe(8);
      expect(result.save).toEqual(v9ToCurrent(v9, DIR_R8));
    });
  }
});

/* ---------- R10／R11：舊檔的退件 → 持續的文件問題案件 ---------- */

const M_AUDIT = 'audit.test.day1-code';
const M_ID = `return.${M_AUDIT}.B102`;
const M_ID_607 = `return.${M_AUDIT}.B607`;
const mDay = (n: number): string => `day.${String(n).padStart(2, '0')}`;
const mTask = (n: number): string => `task.day${n}.archive`;
const mSlot = (n: number): string => `task.day${n}.return-review`;
const mBatch = (n: number): string => `batch.day${String(n).padStart(2, '0')}.archive`;
function mRecords(n: number): readonly SourceRecord[] {
  return [{ key: `R${n}`, name: null, code: String(n * 100 + 1).padStart(4, '0'), refusal: false, refusalApplies: true }];
}

/**
 * 測試自建（6 天）：day.01 歸檔 → day.02 核對 [B102, B607]＋稽核（Day 3 通知）
 * → day.03～day.06 各 [歸檔, 錯誤文件處理]。v9 時代的「退件複審」就是 day.04 的那一個位置。
 */
const DIR_M: DayDirectory = (() => {
  const plans: DayPlan[] = [
    PLAN_DAY1,
    {
      dayId: DAY_02,
      dayNumber: 2,
      nextDayId: DAY_03,
      tasks: [
        {
          id: TASK_DAY2,
          kind: 'reconcile',
          sourceBatchId: BATCH_DAY01,
          subjectKey: 'B102',
          recordKeys: ['B102', 'B607'],
          returnAudit: { id: M_AUDIT, notifyDayId: DAY_03 },
        },
      ],
    },
  ];
  const records: Record<string, readonly SourceRecord[]> = { [BATCH_DAY01]: DAY1_RECORDS };
  for (let n = 3; n <= 6; n++) {
    records[mBatch(n)] = mRecords(n);
    plans.push({
      dayId: mDay(n),
      dayNumber: n,
      nextDayId: n < 6 ? mDay(n + 1) : null,
      tasks: [
        { id: mTask(n), kind: 'archive', batchId: mBatch(n), recordKeys: mRecords(n).map((r) => r.key), caseReviews: [] },
        { id: mSlot(n), kind: 'return-review', dayId: mDay(n) },
      ],
    });
  }
  return createDayDirectory(plans, records);
})();
const mSlotTask = (n: number) => DIR_M.plan(mDay(n))!.tasks[1]!;

/** 從目前的 work 做完當日（錯誤文件處理若適用須已不再待修正）→ wrap／end。 */
function mFinishDay(s: Save): Save {
  let t = s;
  const n = DIR_M.plan(t.dayId)!.dayNumber;
  if (t.taskId === mTask(n)) t = completeWork({ ...t, batches: { ...t.batches, [mBatch(n)]: makeBatch(archivedOf(mRecords(n))) } }, DIR_M);
  if (t.stage === 'work') t = completeWork(t, DIR_M);
  expect(['wrap', 'end']).withContext(`${t.dayId}/${t.taskId}`).toContain(t.stage);
  return t;
}

function mRunToEnd(s: Save): Save {
  let t = s;
  for (let guard = 0; t.stage !== 'end' && guard < 20; guard++) {
    if (t.stage === 'morning') t = startDay(t);
    else if (t.stage === 'work') t = mFinishDay(t);
    else t = advanceDay(t, DIR_M);
  }
  expect(t.stage).toBe('end');
  return t;
}

const M_REVIEWED = {
  kind: 'reconcile' as const,
  reportOpened: true,
  receiptOpened: false,
  reviews: {
    B102: { disposition: 'release' as const, batchId: BATCH_DAY01, archiveTaskId: TASK_DAY1, recordKey: 'B102', sourceCode: '0102', reviewedCode: '102' },
    B607: { disposition: 'release' as const, batchId: BATCH_DAY01, archiveTaskId: TASK_DAY1, recordKey: 'B607', sourceCode: '0607', reviewedCode: '607' },
  },
  reply: 'ack' as const,
  reportRevision: 1,
};
const M_DAY1_BATCH = makeBatch({
  ...archivedAll,
  B102: { ...archivedAll['B102'], archiveCode: '102' },
  B607: { ...archivedAll['B607'], archiveCode: '607' },
});
const LEGACY_PENDING: LegacyReturnCaseV9 = {
  id: M_ID,
  auditId: M_AUDIT,
  batchId: BATCH_DAY01,
  recordKey: 'B102',
  archiveTaskId: TASK_DAY1,
  reviewTaskId: TASK_DAY2,
  sourceCode: '0102',
  submittedCode: '102',
  reviewedCode: '102',
  disposition: 'release',
  reason: 'code-mismatch',
  notifyDayId: DAY_03,
  returnDayId: mDay(4),
  status: 'pending',
  versions: [],
};
const LEGACY_607: LegacyReturnCaseV9 = { ...LEGACY_PENDING, id: M_ID_607, recordKey: 'B607', sourceCode: '0607', submittedCode: '607', reviewedCode: '607' };
const legacyResubmitted = (code: string, base: LegacyReturnCaseV9 = LEGACY_PENDING): LegacyReturnCaseV9 => ({
  ...base,
  status: 'resubmitted',
  versions: [{ action: 'resubmit', code, dayId: mDay(4) }],
});
const LEGACY_WINDOW: LegacyReturnCaseV9 = { ...LEGACY_PENDING, status: 'window', versions: [{ action: 'window', code: '102', dayId: mDay(4) }] };

/** v9 存檔：Day 1／Day 2 已完成（B102 "102"、B607 "607" 都放行），Day 3…doneThrough 的歸檔已完成。 */
function v9At(dayNum: number, stage: Stage, taskId: string, returns: LegacyReturnCaseV9[], doneThrough: number): SaveV9 {
  const batches: Record<string, BatchState> = { [BATCH_DAY01]: M_DAY1_BATCH };
  for (let n = 3; n <= doneThrough; n++) batches[mBatch(n)] = makeBatch(archivedOf(mRecords(n)));
  return {
    version: 9,
    seed: 1,
    dayId: mDay(dayNum),
    stage,
    taskId,
    batches,
    taskProgress: { [TASK_DAY2]: M_REVIEWED },
    chatReplies: {},
    waivedTasks: [],
    caseReviews: {},
    returns,
    night: NIGHT_NO,
    events: [{ id: 'return.notified:0', kind: 'return.notified', payload: { dayId: DAY_03, auditId: M_AUDIT, count: returns.length } }],
    readMessages: ['msg.a'],
  };
}

const RECEIPT_0 = { id: `${M_ID}#0`, kind: 'returned' as const, dayId: DAY_03, versionIndex: null, code: '102', reason: 'code-mismatch' as const };

/**
 * v9 → v10 → v11 的共同檢查：v10 通過 legacy v10 驗證（只有一張初次回條且已讀）、版本沒有核對結果、事件不增加；
 * v11（R12）每份回條恰有一封郵件（初次回條的郵件已讀）、通過現行驗證；輸入不變。回傳 v11（現行格式，可續玩）。
 */
function migrateChecked(v9: SaveV9): Save {
  const before = JSON.stringify(v9);
  expect(isValidLegacySaveV9(v9, DIR_M)).toBeTrue();
  expect(isValidSave(v9, DIR_M)).toBeFalse();
  const v10 = migrateV9ToV10(v9, DIR_M);
  expect(v10.version).toBe(10);
  expect(isValidLegacySaveV10(JSON.parse(JSON.stringify(v10)), DIR_M)).withContext(`${v9.dayId}/${v9.stage}`).toBeTrue();
  // 遷移不偽造之後的回條或核對結果
  for (const item of v10.returns) {
    expect(item.receipts.length).toBe(1);
    expect(item.receipts[0]!.kind).toBe('returned');
    expect(item.versions.every((v) => v.outcome === undefined && v.checkedDayId === undefined)).toBeTrue();
  }
  expect(v10.readIssueReceipts).toEqual(v10.returns.map((r) => `${r.id}#0`));
  expect(v10.events).toEqual(v9.events);
  const v11 = migrateV10ToV11(v10, DIR_M);
  expect(isValidSave(JSON.parse(JSON.stringify(v11)), DIR_M)).withContext(`${v9.dayId}/${v9.stage}`).toBeTrue();
  expect(v11.mailbox).toEqual(v10.returns.map((r) => receiptMail(r, r.receipts[0]!)));
  expect(v11.readMail).toEqual(v10.returns.map((r) => mailIdOfReceipt(`${r.id}#0`)));
  expect(v11.returns).toEqual(v10.returns);
  expect(v11.issueSchedule).toEqual(v10.issueSchedule);
  expect(v11.events).toEqual(v9.events);
  expect(JSON.stringify(v9)).toBe(before);
  // 與 migrateToCurrent 的結果一致（含 JSON 字串讀回）
  const result = migrateToCurrent(JSON.parse(before), DIR_M)!;
  expect(result).not.toBeNull();
  expect(result.from).toBe(9);
  expect(result.save).toEqual(v11);
  return v11;
}

describe('migrateV9ToV10（R11）：pending → 待修正', () => {
  it('Day 3 work（通知日、舊複審日 Day 4 尚未到）：dueDayId＝Day 4、尚未排程；初次退件回條由通知資料推得並標為已讀', () => {
    const cur = migrateChecked(v9At(3, 'work', mTask(3), [LEGACY_PENDING], 2));
    const item = cur.returns[0]!;
    const expected: ReturnCase = {
      id: M_ID,
      auditId: M_AUDIT,
      batchId: BATCH_DAY01,
      recordKey: 'B102',
      archiveTaskId: TASK_DAY1,
      reviewTaskId: TASK_DAY2,
      sourceCode: '0102',
      submittedCode: '102',
      reviewedCode: '102',
      disposition: 'release',
      reason: 'code-mismatch',
      notifyDayId: DAY_03,
      status: 'pending',
      dueDayId: mDay(4),
      versions: [],
      receipts: [RECEIPT_0],
    };
    expect(item).toEqual(expected);
    expect('returnDayId' in item).toBeFalse();
    expect(cur.issueSchedule).toEqual({});
    // 初次退件回條的已讀轉成郵件已讀（R12）
    expect(cur.mailbox.map((m) => m.id)).toEqual([mailIdOfReceipt(`${M_ID}#0`)]);
    expect(cur.readMail).toEqual([mailIdOfReceipt(`${M_ID}#0`)]);
    // 續玩：進入 Day 4 時由規則排入當日錯誤文件處理
    const day4 = advanceDay(mFinishDay(cur), DIR_M);
    expect([day4.dayId, day4.stage]).toEqual([mDay(4), 'morning']);
    expect(day4.issueSchedule).toEqual({ [mDay(4)]: [M_ID] });
    expect(isTaskApplicable(day4, mSlotTask(4))).toBeTrue();
    expect(isValidSave(JSON.parse(JSON.stringify(day4)), DIR_M)).toBeTrue();
  });

  it('Day 4 work（舊複審日＝今天、目前工作仍是歸檔）：dueDayId＝Day 4，排程記錄當天引用的案件；續玩到錯誤文件處理', () => {
    const cur = migrateChecked(v9At(4, 'work', mTask(4), [LEGACY_PENDING], 3));
    expect(cur.returns[0]!.status).toBe('pending');
    expect(cur.returns[0]!.dueDayId).toBe(mDay(4));
    expect(cur.issueSchedule).toEqual({ [mDay(4)]: [M_ID] });
    expect(isTaskApplicable(cur, mSlotTask(4))).toBeTrue();
    const onSlot = completeWork({ ...cur, batches: { ...cur.batches, [mBatch(4)]: makeBatch(archivedOf(mRecords(4))) } }, DIR_M);
    expect([onSlot.stage, onSlot.taskId]).toEqual(['work', mSlot(4)]);
    expect(isValidSave(onSlot, DIR_M)).toBeTrue();
  });

  it('Day 4 work 停在舊的退件複審（同一個 task id）：仍是當天的錯誤文件處理，可以改對後交付，下一工作日核對結案', () => {
    const cur = migrateChecked(v9At(4, 'work', mSlot(4), [LEGACY_PENDING], 4));
    expect(cur.taskId).toBe(mSlot(4));
    expect(isTaskDone(cur, DIR_M, mSlotTask(4))).toBeFalse();
    const s = resubmitReturn(cur, DIR_M, M_ID, '0102', `${M_ID}#0`);
    expect(s.returns[0]!.versions).toEqual([{ index: 0, action: 'resubmit', code: '0102', dayId: mDay(4), checkDayId: mDay(5) }]);
    const day5 = advanceDay(completeWork(s, DIR_M), DIR_M);
    expect(day5.returns[0]!.status).toBe('resolved');
    expect(day5.returns[0]!.receipts.map((r) => [r.id, r.kind])).toEqual([[`${M_ID}#0`, 'returned'], [`${M_ID}#1`, 'resolved']]);
    // 新回條寄出新郵件、沒有被標為已讀；初次回條的郵件維持已讀
    expect(day5.mailbox.map((m) => [m.id, m.templateId, m.dayId])).toEqual([
      [mailIdOfReceipt(`${M_ID}#0`), 'returned', DAY_03],
      [mailIdOfReceipt(`${M_ID}#1`), 'resolved', mDay(5)],
    ]);
    expect(day5.readMail).toEqual([mailIdOfReceipt(`${M_ID}#0`)]);
    expect(isValidSave(JSON.parse(JSON.stringify(day5)), DIR_M)).toBeTrue();
  });

  it('migrateV9ToV10 本身：舊複審日已過的 pending 改排到目前日的下一工作日（最後一天為 null）', () => {
    // v9 規則下這種狀態不會出現（Day 4 複審未完成不能跨日），這裡只驗對照規則本身
    const passed = migrateV9ToV10(v9At(5, 'work', mTask(5), [LEGACY_PENDING], 4), DIR_M);
    expect(passed.returns[0]!.dueDayId).toBe(mDay(6));
    const lastDay = migrateV9ToV10(v9At(6, 'work', mTask(6), [LEGACY_PENDING], 5), DIR_M);
    expect(lastDay.returns[0]!.dueDayId).toBeNull();
  });
});

describe('migrateV9ToV10（R11）：resubmitted → 已重送／待核對（不因名稱視為已解決）', () => {
  it('Day 4 wrap（當天重新送審）：採最後保存版本，預定核對日＝受理日的下一工作日（Day 5）；排程保留 Day 4', () => {
    const cur = migrateChecked(v9At(4, 'wrap', mSlot(4), [legacyResubmitted('0102')], 4));
    const item = cur.returns[0]!;
    expect(item.status).toBe('awaiting-check');
    expect(item.status).not.toBe('resolved');
    expect(item.dueDayId).toBeNull();
    expect(item.versions).toEqual([{ index: 0, action: 'resubmit', code: '0102', dayId: mDay(4), checkDayId: mDay(5) }]);
    expect(cur.issueSchedule).toEqual({ [mDay(4)]: [M_ID] });
    expect(isTaskDone(cur, DIR_M, mSlotTask(4))).toBeTrue();
    // 續玩：Day 5 下游核對一致才結案
    const day5 = advanceDay(cur, DIR_M);
    expect(day5.returns[0]!.status).toBe('resolved');
    expect(day5.returns[0]!.versions[0]!.checkedDayId).toBe(mDay(5));
    expect(isValidSave(JSON.parse(JSON.stringify(day5)), DIR_M)).toBeTrue();
  });

  it('Day 4 work（已重新送審、尚未交付複審）：預定核對日 Day 5，可直接交付', () => {
    const cur = migrateChecked(v9At(4, 'work', mSlot(4), [legacyResubmitted('102')], 4));
    expect(cur.returns[0]!.versions[0]!.checkDayId).toBe(mDay(5));
    const wrap = completeWork(cur, DIR_M);
    expect([wrap.stage, wrap.taskId]).toEqual(['wrap', mSlot(4)]);
    expect(isValidSave(wrap, DIR_M)).toBeTrue();
  });

  it('Day 5（原本的核對日已經開始）：預定核對日改為目前日的下一工作日（Day 6），不在已開始的日子補核對', () => {
    for (const stage of ['morning', 'work'] as const) {
      const cur = migrateChecked(v9At(5, stage, mTask(5), [legacyResubmitted('0102')], 4));
      expect(cur.returns[0]!.status).withContext(stage).toBe('awaiting-check');
      expect(cur.returns[0]!.versions[0]!.checkDayId).withContext(stage).toBe(mDay(6));
      expect(cur.issueSchedule).toEqual({ [mDay(4)]: [M_ID] });
    }
    // 續玩：Day 6 核對一致 → 已解決
    const end = mRunToEnd(v9ToCurrent(v9At(5, 'work', mTask(5), [legacyResubmitted('0102')], 4), DIR_M));
    expect(end.returns[0]!.status).toBe('resolved');
    expect(end.returns[0]!.receipts.map((r) => [r.kind, r.dayId])).toEqual([['returned', DAY_03], ['resolved', DAY_06]]);
    expect(isValidSave(JSON.parse(JSON.stringify(end)), DIR_M)).toBeTrue();
  });

  it('Day 5 wrap（原核對日已過、今天就要結束）：預定核對日 Day 6，跨日才核對', () => {
    const cur = migrateChecked(v9At(5, 'wrap', mTask(5), [legacyResubmitted('0102')], 5));
    expect(cur.returns[0]!.versions[0]!.checkDayId).toBe(mDay(6));
    expect(advanceDay(cur, DIR_M).returns[0]!.status).toBe('resolved');
  });

  it('最後一天（Day 6 end）：預定核對日為 null，保留待核對，不為結束畫面結案', () => {
    const cur = migrateChecked(v9At(6, 'end', mTask(6), [legacyResubmitted('102')], 6));
    expect(cur.returns[0]!.status).toBe('awaiting-check');
    expect(cur.returns[0]!.versions[0]!.checkDayId).toBeNull();
    expect(advanceDay(cur, DIR_M)).toBe(cur);
  });
});

describe('migrateV9ToV10（R11）：window → 待窗口回覆', () => {
  it('Day 4 wrap 送窗口：待窗口回覆、沒有核對日；續玩到結束都不會自動結案或加回條', () => {
    const cur = migrateChecked(v9At(4, 'wrap', mSlot(4), [LEGACY_WINDOW], 4));
    const item = cur.returns[0]!;
    expect(item.status).toBe('awaiting-window');
    expect(item.dueDayId).toBeNull();
    expect(item.versions).toEqual([{ index: 0, action: 'window', code: '102', dayId: mDay(4), checkDayId: null }]);
    expect(cur.issueSchedule).toEqual({ [mDay(4)]: [M_ID] });
    const end = mRunToEnd(cur);
    expect(end.returns[0]!.status).toBe('awaiting-window');
    expect(end.returns[0]!.receipts).toEqual([RECEIPT_0]);
    expect(end.events.some((e) => e.kind === 'return.checked')).toBeFalse();
    expect(isValidSave(JSON.parse(JSON.stringify(end)), DIR_M)).toBeTrue();
  });
});

describe('migrateV9ToV10（R11）：多案、空 returns 與輸入不變', () => {
  it('兩案同一個舊複審日：依 returns 順序排入 Day 4；各自只有一張已讀的初次回條', () => {
    const cur = migrateChecked(v9At(4, 'work', mSlot(4), [LEGACY_PENDING, legacyResubmitted('0607', LEGACY_607)], 4));
    expect(cur.returns.map((r) => [r.id, r.status, r.dueDayId])).toEqual([
      [M_ID, 'pending', mDay(4)],
      [M_ID_607, 'awaiting-check', null],
    ]);
    expect(cur.returns[1]!.receipts).toEqual([{ ...RECEIPT_0, id: `${M_ID_607}#0`, code: '607' }]);
    expect(cur.issueSchedule).toEqual({ [mDay(4)]: [M_ID, M_ID_607] });
    expect(cur.readMail).toEqual([mailIdOfReceipt(`${M_ID}#0`), mailIdOfReceipt(`${M_ID_607}#0`)]);
    expect(isTaskDone(cur, DIR_M, mSlotTask(4))).toBeFalse();
    expect(isTaskDone(sendReturnToWindow(cur, DIR_M, M_ID, `${M_ID}#0`), DIR_M, mSlotTask(4))).toBeTrue();
  });

  it('沒有退件的 v9：v10 只補空 issueSchedule／readIssueReceipts；v11 再補空郵件與入職已完成，其他欄位逐字相同', () => {
    const v9 = { ...v9At(3, 'work', mTask(3), [], 2), events: [] };
    const legacy = migrateV9ToV10(v9, DIR_M);
    expect(legacy.readIssueReceipts).toEqual([]);
    expect(omitKey(omitKey(omitKey(legacy, 'issueSchedule'), 'readIssueReceipts'), 'version')).toEqual(omitKey(v9, 'version'));
    const cur = migrateChecked(v9);
    expect(cur.returns).toEqual([]);
    expect(cur.issueSchedule).toEqual({});
    expectFreshV11Fields(cur);
    expect(body(cur)).toEqual(body(v9));
  });

  it('結構合法但遷移後不一致的 v9 → null（不硬救）：未知稽核、今天早於通知日', () => {
    const unknownAudit = v9At(3, 'work', mTask(3), [{ ...LEGACY_PENDING, auditId: 'audit.x', id: 'return.audit.x.B102' }], 2);
    expect(isValidLegacySaveV9(unknownAudit, DIR_M)).toBeTrue();
    expect(migrateToCurrent(unknownAudit, DIR_M)).toBeNull();
    const early: SaveV9 = { ...v9At(2, 'wrap', TASK_DAY2, [LEGACY_PENDING], 2) };
    expect(isValidLegacySaveV9(early, DIR_M)).toBeTrue();
    expect(migrateToCurrent(early, DIR_M)).toBeNull();
  });
});

/*
 * 回歸測試（R11 曾為原始碼缺陷，已修正）：舊 v9 的重送案件遷移後，下一工作日核對仍不一致而再次退回（pending），
 * 但 issueSchedule[舊複審日] 仍引用它 → save-schema 把舊複審日的錯誤文件處理判為未結清 → 整份存檔不合法、讀檔失敗。
 */
describe('R11：v9 重送仍錯的案件遷移後續玩（回歸測試）', () => {
  it('v9 Day 4 wrap 重送 "102" → 遷移 → Day 5 再次退回：存檔仍合法、讀檔不回傳 null', () => {
    const cur = v9ToCurrent(v9At(4, 'wrap', mSlot(4), [legacyResubmitted('102')], 4), DIR_M);
    const day5 = advanceDay(cur, DIR_M);
    expect(day5.returns[0]!.status).toBe('pending');
    expect(day5.returns[0]!.dueDayId).toBe(mDay(6));
    expect(isValidSave(JSON.parse(JSON.stringify(day5)), DIR_M)).toBeTrue();
    expect(migrateToCurrent(JSON.parse(JSON.stringify(day5)), DIR_M)).not.toBeNull();
  });
});

describe('R10：舊檔（沒有逐筆審查）遷移後不追罰，錯誤文件處理從不適用', () => {
  /** v8 Day 2 wrap：已回覆 ack、沒有 reviews；B102 甚至與來源不同。 */
  const v8Day2Wrap: SaveV8 = {
    version: 8,
    seed: 1,
    dayId: DAY_02,
    stage: 'wrap',
    taskId: TASK_DAY2,
    batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '102' } }) },
    taskProgress: { [TASK_DAY2]: REPLY_ACK },
    chatReplies: {},
    waivedTasks: [],
    caseReviews: {},
    night: NIGHT_NO,
    events: [],
    readMessages: [],
  };

  it('v8 → v11：from 8、returns／排程／郵件為空；跨入通知日不建立案件、不通知、不寄信', () => {
    const result = migrateToCurrent(v8Day2Wrap, DIR_M)!;
    expect(result).not.toBeNull();
    expect(result.from).toBe(8);
    expect(result.save.returns).toEqual([]);
    expect(result.save.issueSchedule).toEqual({});
    expectFreshV11Fields(result.save);
    const day3 = advanceDay(result.save, DIR_M);
    expect(day3.mailbox).toEqual([]);
    expect([day3.dayId, day3.stage]).toEqual([DAY_03, 'morning']);
    expect(day3.returns).toEqual([]);
    expect(day3.events.some((e) => e.kind === 'return.notified')).toBeFalse();
    expect(returnNotified(day3, DIR_M, M_AUDIT)).toBeFalse();
    expect(isValidSave(JSON.parse(JSON.stringify(day3)), DIR_M)).toBeTrue();
  });

  it('之後每天的錯誤文件處理都不適用、不佔佇列；一路到結束', () => {
    const day4 = startDay(advanceDay(mFinishDay(startDay(advanceDay(migrateToCurrent(v8Day2Wrap, DIR_M)!.save, DIR_M))), DIR_M));
    expect([day4.dayId, day4.stage, day4.taskId]).toEqual([mDay(4), 'work', mTask(4)]);
    expect(isTaskApplicable(day4, mSlotTask(4))).toBeFalse();
    expect(isTaskSettled(day4, DIR_M, mSlotTask(4))).toBeTrue();
    const end = mRunToEnd(day4);
    expect([end.dayId, end.taskId]).toEqual([DAY_06, mTask(6)]);
    expect(end.issueSchedule).toEqual({});
    expect(isValidSave(JSON.parse(JSON.stringify(end)), DIR_M)).toBeTrue();
  });

  it('已經走過通知日的 v8（Day 4 work）也只補空 returns／排程，不回溯追罰；不能停在錯誤文件處理', () => {
    const v8Day4: SaveV8 = {
      ...v8Day2Wrap,
      dayId: mDay(4),
      stage: 'work',
      taskId: mTask(4),
      batches: { ...v8Day2Wrap.batches, [mBatch(3)]: makeBatch(archivedOf(mRecords(3))) },
    };
    const result = migrateToCurrent(v8Day4, DIR_M)!;
    expect(result.from).toBe(8);
    expect(result.save.returns).toEqual([]);
    expect(isTaskApplicable(result.save, mSlotTask(4))).toBeFalse();
    // v8 不可能停在本輪才新增的錯誤文件處理（不適用的工作不會成為目前工作）
    expect(migrateToCurrent({ ...v8Day4, taskId: mSlot(4) }, DIR_M)).toBeNull();
  });
});

/* ---------- R12：v10 → v11（角色／入職、郵件、已讀歷史） ---------- */

/** v11 → v10 形狀（R11 存檔）：拿掉 v11 欄位，已讀回條另外指定。 */
function downgradeToV10(s: Save, readIssueReceipts: string[]): SaveV10 {
  const { issueDrafts: _d, mailbox: _m, readMail: _rm, helpRequests: _h, profile: _p, onboarding: _o, version: _v, ...rest } = s;
  return { ...rest, version: 10, readIssueReceipts };
}

/**
 * 以 R11 規則實際玩出的 v10 存檔（Day 5 morning）：
 * B102、B607 在 Day 3 建立（#0）→ 兩案都提前重送仍錯 → Day 4 各再次退回（#1）→ B102 再重送仍錯、B607 送窗口 → Day 5 B102 再次退回（#2）。
 * 回條依案件排列：B102 #0 #1 #2、B607 #0 #1；時間順序則是 Day 3 兩張、Day 4 兩張、Day 5 一張。
 */
function playedV10(readIssueReceipts: string[] = []): SaveV10 {
  let s = startDay(v9ToCurrent(v9At(3, 'morning', mTask(3), [LEGACY_PENDING, LEGACY_607], 2), DIR_M));
  s = resubmitReturn(s, DIR_M, M_ID, '0l02', `${M_ID}#0`);
  s = resubmitReturn(s, DIR_M, M_ID_607, '6O7', `${M_ID_607}#0`);
  s = startDay(advanceDay(mFinishDay(s), DIR_M));
  s = resubmitReturn(s, DIR_M, M_ID, '1O2', `${M_ID}#1`);
  s = sendReturnToWindow(s, DIR_M, M_ID_607, `${M_ID_607}#1`);
  s = advanceDay(mFinishDay(s), DIR_M);
  expect([s.dayId, s.stage]).toEqual([mDay(5), 'morning']);
  expect(s.returns.map((r) => [r.id, r.status, r.receipts.length])).toEqual([
    [M_ID, 'pending', 3],
    [M_ID_607, 'awaiting-window', 2],
  ]);
  const v10 = downgradeToV10(s, readIssueReceipts);
  expect(isValidLegacySaveV10(v10, DIR_M)).toBeTrue();
  return v10;
}

describe('migrateV10ToV11（R12）', () => {
  it('每份既有回條寄成一封郵件：固定 ID、依回條日期再依建立順序（不是依案件）；欄位與回條一致', () => {
    const v10 = playedV10();
    const v11 = migrateV10ToV11(v10, DIR_M);
    expect(v11.mailbox.map((m) => [m.id, m.templateId, m.dayId, m.attachments[0]!.caseId, m.attachments[0]!.versionIndex])).toEqual([
      [`mail.${M_ID}#0`, 'returned', DAY_03, M_ID, null],
      [`mail.${M_ID_607}#0`, 'returned', DAY_03, M_ID_607, null],
      [`mail.${M_ID}#1`, 'returned', mDay(4), M_ID, 0],
      [`mail.${M_ID_607}#1`, 'returned', mDay(4), M_ID_607, 0],
      [`mail.${M_ID}#2`, 'returned', mDay(5), M_ID, 1],
    ]);
    for (const m of v11.mailbox) {
      expect(m.packId).toBe('mail.return-receipts');
      expect(m.attachments.length).toBe(1);
      expect(m.attachments[0]!.kind).toBe('return-receipt');
      expect(m.id).toBe(mailIdOfReceipt(m.attachments[0]!.receiptId));
    }
    expect(isValidSave(v11, DIR_M)).toBeTrue();
    expect(isValidSave(JSON.parse(JSON.stringify(v11)), DIR_M)).toBeTrue();
  });

  it('收件回條寄成模板 resolved 的郵件', () => {
    const cur = startDay(v9ToCurrent(v9At(4, 'work', mSlot(4), [LEGACY_PENDING], 4), DIR_M));
    const day5 = advanceDay(completeWork(resubmitReturn(cur, DIR_M, M_ID, '0102', `${M_ID}#0`), DIR_M), DIR_M);
    const v10 = downgradeToV10(day5, [`${M_ID}#0`]);
    expect(isValidLegacySaveV10(v10, DIR_M)).toBeTrue();
    const v11 = migrateV10ToV11(v10, DIR_M);
    expect(v11.mailbox.map((m) => [m.id, m.templateId, m.dayId])).toEqual([
      [`mail.${M_ID}#0`, 'returned', DAY_03],
      [`mail.${M_ID}#1`, 'resolved', mDay(5)],
    ]);
    expect(v11.readMail).toEqual([`mail.${M_ID}#0`]);
    expect(isValidSave(v11, DIR_M)).toBeTrue();
  });

  it('已讀回條轉成已讀郵件（郵件 ID；依郵件順序）；未讀的回條郵件維持未讀', () => {
    const v10 = playedV10([`${M_ID}#2`, `${M_ID_607}#0`, `${M_ID}#0`]);
    const v11 = migrateV10ToV11(v10, DIR_M);
    expect(v11.readMail).toEqual([`mail.${M_ID}#0`, `mail.${M_ID_607}#0`, `mail.${M_ID}#2`]);
    expect('readIssueReceipts' in v11).toBeFalse();
    expect(isValidSave(v11, DIR_M)).toBeTrue();
    expect(migrateV10ToV11(playedV10([]), DIR_M).readMail).toEqual([]);
  });

  it('案件、版本、回條、排程與未解決狀態原樣保留；不寫事件', () => {
    const v10 = playedV10([`${M_ID}#0`]);
    const v11 = migrateV10ToV11(v10, DIR_M);
    expect(v11.returns).toEqual(v10.returns);
    expect(v11.issueSchedule).toEqual(v10.issueSchedule);
    expect(v11.returns.map((r) => r.status)).toEqual(['pending', 'awaiting-window']);
    expect(v11.events).toEqual(v10.events);
    expect(v11.batches).toEqual(v10.batches);
    expect(v11.taskProgress).toEqual(v10.taskProgress);
    expect([v11.dayId, v11.stage, v11.taskId, v11.seed]).toEqual([v10.dayId, v10.stage, v10.taskId, v10.seed]);
  });

  it('角色名 null（顯示「員工」由 state 決定）、入職視為已完成；沒有詢問紀錄與修訂草稿', () => {
    const v11 = migrateV10ToV11(playedV10(), DIR_M);
    expect(v11.version).toBe(11);
    expect(v11.profile).toEqual({ name: null });
    expect(v11.onboarding).toEqual({ step: 0, complete: true });
    expect(v11.helpRequests).toEqual({});
    expect(v11.issueDrafts).toEqual({});
  });

  it('舊回覆快照（沒有 deliverAt）視為已送達的已讀歷史：回應 ID 併入 readMessages（去重、保留原順序）；略過與已有送達時間的回應不加', () => {
    const base = playedV10();
    const v10: SaveV10 = {
      ...base,
      chatReplies: {
        'prompt.test.a': {
          kind: 'answered',
          choiceId: 'join',
          playerText: '好',
          responses: [
            { id: 'msg.test.a1', actorId: 'actor.test', time: '12:00', lines: ['一'] },
            { id: 'msg.test.a2', actorId: 'actor.test', time: '12:01', lines: ['二'] },
          ],
        },
        'prompt.test.b': { kind: 'skipped' },
        'prompt.test.c': {
          kind: 'answered',
          choiceId: 'no',
          playerText: '不了',
          responses: [
            { id: 'msg.test.c1', actorId: 'actor.test', time: '12:05', lines: ['好'] },
            { id: 'msg.test.c2', actorId: 'actor.test', time: '12:06', lines: ['嗯'], deliverAt: 1000 },
          ],
        },
      },
      readMessages: ['msg.a', 'msg.test.a2'],
    };
    expect(isValidLegacySaveV10(v10, DIR_M)).toBeTrue();
    const before = JSON.stringify(v10);
    const v11 = migrateV10ToV11(v10, DIR_M);
    expect(v11.readMessages).toEqual(['msg.a', 'msg.test.a2', 'msg.test.a1', 'msg.test.c1']);
    expect(v11.chatReplies).toEqual(v10.chatReplies);
    expect(JSON.stringify(v10)).toBe(before);
    expect(isValidSave(v11, DIR_M)).toBeTrue();
  });

  it('migrateToCurrent：v10 → from 10，結果與 migrateV10ToV11 相同；JSON 字串讀回也一樣；輸入不變；再讀一次是 from 11', () => {
    const v10 = playedV10([`${M_ID}#0`, `${M_ID_607}#1`]);
    const before = JSON.stringify(v10);
    const result = migrateToCurrent(JSON.parse(before), DIR_M)!;
    expect(result).not.toBeNull();
    expect(result.from).toBe(10);
    expect(result.save).toEqual(migrateV10ToV11(v10, DIR_M));
    expect(JSON.stringify(v10)).toBe(before);
    const again = migrateToCurrent(JSON.parse(JSON.stringify(result.save)), DIR_M)!;
    expect(again.from).toBe(11);
    expect(again.save).toEqual(result.save);
  });

  it('遷移後續玩：可修訂的是最新回條（#2），舊回條過期；下一天新回條的郵件接在後面、未讀', () => {
    const cur = startDay(migrateToCurrent(playedV10([`${M_ID}#0`]), DIR_M)!.save);
    expect(resubmitReturn(cur, DIR_M, M_ID, '0102', `${M_ID}#1`)).toBe(cur);
    let s = resubmitReturn(cur, DIR_M, M_ID, '0102', `${M_ID}#2`);
    expect(s.returns[0]!.status).toBe('awaiting-check');
    s = advanceDay(mFinishDay(s), DIR_M);
    expect(s.returns[0]!.status).toBe('resolved');
    expect(s.mailbox.map((m) => m.id).slice(-2)).toEqual([`mail.${M_ID}#2`, `mail.${M_ID}#3`]);
    expect(s.mailbox[s.mailbox.length - 1]!.templateId).toBe('resolved');
    expect(s.readMail).toEqual([`mail.${M_ID}#0`]);
    expect(isValidSave(JSON.parse(JSON.stringify(s)), DIR_M)).toBeTrue();
  });

  it('不合法的 v10 不轉換：已讀回條指向不存在的回條 → null', () => {
    const v10 = playedV10();
    expect(migrateToCurrent({ ...v10, readIssueReceipts: [`${M_ID}#9`] }, DIR_M)).toBeNull();
    expect(migrateToCurrent({ ...v10, readIssueReceipts: [`mail.${M_ID}#0`] }, DIR_M)).toBeNull();
  });
});
