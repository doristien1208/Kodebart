import { CasePlan, DayDirectory, DayPlan, FieldMapTaskPlan, TaskPlan, createDayDirectory } from './day-plan';
import { checkFieldMap } from './field-map';
import { rand } from './rand';
import {
  EVENT_IDS,
  EVENT_KINDS,
  INTERVENTION_THRESHOLD,
  ChatChoiceInput,
  activeTaskOf,
  advanceDay,
  allArchived,
  answerChat,
  archivedCount,
  batchHasReview,
  batchOf,
  canReply,
  caseDecisionOf,
  caseStateOf,
  chatChoiceOf,
  chatReplyOf,
  commitArchive,
  commitCase,
  completeWork,
  createSave,
  currentBatchId,
  eventDayId,
  fieldMapCheck,
  fieldMapProgressOf,
  isArranged,
  isArrangedInSave,
  isMessageRead,
  isTaskApplicable,
  isTaskDone,
  isTaskSettled,
  isTaskWaived,
  latestIssueCode,
  editableReceiptOf,
  isMailRead,
  markMailRead,
  setIssueDraft,
  requestHelp,
  advanceOnboarding,
  signContract,
  completeOnboarding,
  markMessagesRead,
  markReceiptOpened,
  markReportOpened,
  nextOpenTask,
  openCase,
  planOf,
  previewFieldMap,
  reconcileProgressOf,
  resolveNight,
  resubmitReturn,
  returnNotified,
  returnsOfAudit,
  scheduledIssues,
  sendReturnToWindow,
  setDraft,
  setFieldAssignment,
  setFieldBlankPolicy,
  setRecordReview,
  skipChat,
  snapshotOf,
  startDay,
  submitFieldMap,
  submitReply,
  toggleCaseMark,
  withEvent,
} from './rules';
import { isValidSave } from './save-schema';
import { RETURN_RECEIPT_MAIL_PACK, mailIdOfReceipt, receiptMail } from './mail';
import { migrateToCurrent } from './save-migrate';
import {
  ArchivedRecord,
  BatchId,
  BatchState,
  Draft,
  LEGACY_STAGES,
  MISSING_POLICIES,
  MissingPolicy,
  NightResult,
  REPLIES,
  RecordKey,
  RecordReview,
  Reply,
  ReturnReceipt,
  ReturnCase,
  ReviewDisposition,
  HelpDelivery,
  MailRecord,
  SAVE_VERSION,
  STAGES,
  Save,
  SourceRecord,
  ValidationOk,
  ReturnReceiptAttachment,
} from './types';
import { PLAYER_NAME_MAX, validateRecord } from './validate';

/* ---------- 測試自建的日程目錄（不依賴 content） ---------- */

const DAY_01 = 'day.01';
const DAY_02 = 'day.02';
const DAY_03 = 'day.03';
const DAY_04 = 'day.04';
const DAY_05 = 'day.05';
const DAY_06 = 'day.06';
const TASK_DAY1 = 'task.day1.archive';
const TASK_DAY2 = 'task.day2.reconcile';
const TASK_DAY3 = 'task.day3.archive';
const TASK_DAY4 = 'task.day4.archive';
const TASK_DAY5 = 'task.day5.archive';
const TASK_DAY6 = 'task.day6.field-map';
const BATCH_DAY01 = 'batch.day01.archive';
const BATCH_DAY03: BatchId = 'batch.day03.archive';
const BATCH_DAY04: BatchId = 'batch.day04.archive';
const BATCH_DAY05: BatchId = 'batch.day05.archive';

/** 與正式資料同形的三筆測試紀錄（編號一律字串）。 */
const DAY1_RECORDS: readonly SourceRecord[] = [
  { key: 'H17', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false },
  { key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true },
  { key: 'B607', name: null, code: '0607', refusal: true, refusalApplies: true },
];

/** 測試用 Day 3 批次：鍵名與 Day 1 完全不同；T3 缺拒絕紀錄，會用到 policy。 */
const DAY3_RECORDS: readonly SourceRecord[] = [
  { key: 'T1', name: null, code: '0001', refusal: null, refusalApplies: false },
  { key: 'T2', name: '測試對象 2', code: '0002', refusal: null, refusalApplies: false },
  { key: 'T3', name: null, code: '0003', refusal: null, refusalApplies: true },
];
const DAY4_RECORDS: readonly SourceRecord[] = [
  { key: 'U1', name: null, code: '0401', refusal: null, refusalApplies: true },
  { key: 'U2', name: null, code: '0402', refusal: false, refusalApplies: true },
];
const DAY5_RECORDS: readonly SourceRecord[] = [{ key: 'V1', name: null, code: '0501', refusal: true, refusalApplies: true }];

function day1Plan(records: readonly SourceRecord[], nextDayId: string | null = DAY_02): DayPlan {
  return {
    dayId: DAY_01,
    dayNumber: 1,
    nextDayId,
    tasks: [{ id: TASK_DAY1, kind: 'archive', batchId: BATCH_DAY01, recordKeys: records.map((r) => r.key), caseReviews: [] }],
  };
}

function reconcilePlan(nextDayId: string | null, subjectKey: RecordKey = 'B102'): DayPlan {
  return { dayId: DAY_02, dayNumber: 2, nextDayId, tasks: [{ id: TASK_DAY2, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey, recordKeys: [subjectKey] }] };
}

function archivePlan(dayId: string, dayNumber: number, nextDayId: string | null, taskId: string, batchId: BatchId, records: readonly SourceRecord[]): DayPlan {
  return { dayId, dayNumber, nextDayId, tasks: [{ id: taskId, kind: 'archive', batchId, recordKeys: records.map((r) => r.key), caseReviews: [] }] };
}

/** Day 6 欄位映射（對照 doc/COLLABORATION.md §6）。 */
const FIELD_MAP_TASK: FieldMapTaskPlan = {
  id: TASK_DAY6,
  kind: 'field-map',
  sourceFieldIds: ['legacy-id', 'objection-reply', 'contact-result', 'record-date'],
  targets: [
    { id: 'personnel-code', sourceId: 'legacy-id', convert: 'text' },
    { id: 'exclude-flag', sourceId: 'objection-reply', convert: 'boolean', trueValue: '有', falseValue: '無' },
    { id: 'contact-status', sourceId: 'contact-result', convert: 'text' },
    { id: 'effective-date', sourceId: 'record-date', convert: 'text' },
  ],
  rows: [
    ['row.0102', '0102', '', '未接', '2026-09-16'],
    ['row.0314', '0314', '無', '已確認', '2026-09-17'],
    ['row.0521', '0521', '', '待回覆', '2026-09-17'],
    ['row.0716', '0716', '有', '已確認', '2026-09-18'],
    ['row.0905', '0905', '', '未接', '2026-09-18'],
    ['row.1013', '1013', '無', '待回覆', '2026-09-19'],
    ['row.1108', '1108', '無', '已確認', '2026-09-19'],
    ['row.1219', '1219', '', '未接', '2026-09-20'],
  ].map(([id, a, b, c, d]) => ({
    id,
    values: { 'legacy-id': a, 'objection-reply': b, 'contact-result': c, 'record-date': d },
  })),
};
const CORRECT: Readonly<Record<string, string>> = {
  'personnel-code': 'legacy-id',
  'exclude-flag': 'objection-reply',
  'contact-status': 'contact-result',
  'effective-date': 'record-date',
};
const BLANK_ROWS = ['row.0102', 'row.0521', 'row.0905', 'row.1219'];

/** 兩天：day.01 歸檔 → day.02 核對（最後一天）。 */
function twoDayDirectory(day1Records: readonly SourceRecord[] = DAY1_RECORDS, subjectKey: RecordKey = 'B102'): DayDirectory {
  return createDayDirectory([day1Plan(day1Records), reconcilePlan(null, subjectKey)], { [BATCH_DAY01]: day1Records });
}

/** 三天：day.01 歸檔 → day.02 核對 → day.03 歸檔（另一個批次、不同鍵；最後一天）。 */
function threeDayDirectory(day1Records: readonly SourceRecord[] = DAY1_RECORDS): DayDirectory {
  return createDayDirectory(
    [day1Plan(day1Records), reconcilePlan(DAY_03), archivePlan(DAY_03, 3, null, TASK_DAY3, BATCH_DAY03, DAY3_RECORDS)],
    { [BATCH_DAY01]: day1Records, [BATCH_DAY03]: DAY3_RECORDS },
  );
}

/** 六天：archive → reconcile → archive → archive → archive → field-map（與 R6 日程同形）。 */
function sixDayDirectory(): DayDirectory {
  return createDayDirectory(
    [
      day1Plan(DAY1_RECORDS),
      reconcilePlan(DAY_03),
      archivePlan(DAY_03, 3, DAY_04, TASK_DAY3, BATCH_DAY03, DAY3_RECORDS),
      archivePlan(DAY_04, 4, DAY_05, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS),
      archivePlan(DAY_05, 5, DAY_06, TASK_DAY5, BATCH_DAY05, DAY5_RECORDS),
      { dayId: DAY_06, dayNumber: 6, nextDayId: null, tasks: [FIELD_MAP_TASK] },
    ],
    { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_DAY03]: DAY3_RECORDS, [BATCH_DAY04]: DAY4_RECORDS, [BATCH_DAY05]: DAY5_RECORDS },
  );
}

/** 只有欄位映射一天（第一天、最後一天），方便單測映射規則。 */
const DIR_FM: DayDirectory = createDayDirectory([{ dayId: DAY_06, dayNumber: 6, nextDayId: null, tasks: [FIELD_MAP_TASK] }], {});

const DIR = twoDayDirectory();
const DIR3 = threeDayDirectory();
const DIR6 = sixDayDirectory();

/* ---------- 測試輔助：用真正的 validateRecord 產生 ok 結果，走完整流程 ---------- */

function record(key: RecordKey, records: readonly SourceRecord[] = DAY1_RECORDS): SourceRecord {
  const r = records.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return r;
}

function okFor(key: RecordKey, draft: Draft, records: readonly SourceRecord[] = DAY1_RECORDS): ValidationOk {
  const r = validateRecord(record(key, records), draft);
  if (!r.ok) throw new Error(`validation failed for ${key}: ${r.error}`);
  return r;
}

/** 合法的 v10 存檔 fixture；只覆寫需要的欄位，其餘沿用 createSave。 */
function makeSave(overrides: Partial<Save> = {}): Save {
  return { ...createSave(42, DIR), ...overrides };
}

function makeBatch(archived: BatchState['archived'] = {}, drafts: BatchState['drafts'] = {}): BatchState {
  return { archived, drafts };
}

/** 測試用的歸檔紀錄：快照與提交編號一致，不對應任何真實人物。 */
function fakeArchived(code: string, origin: ArchivedRecord['origin'] = 'source'): ArchivedRecord {
  return {
    archiveCode: code,
    refusal: origin === 'defaulted' ? false : null,
    origin,
    source: { name: null, code, refusal: null, refusalApplies: origin !== 'source' },
  };
}

function putArchived(save: Save, entries: Record<RecordKey, ArchivedRecord>, batchId: BatchId = BATCH_DAY01): Save {
  const b = batchOf(save, batchId);
  return { ...save, batches: { ...save.batches, [batchId]: { ...b, archived: { ...b.archived, ...entries } } } };
}

function validSave(save: unknown, dir: DayDirectory = DIR): boolean {
  return isValidSave(save, dir);
}

function archivedIn(save: Save, key: RecordKey, batchId: BatchId = BATCH_DAY01): ArchivedRecord {
  const a = batchOf(save, batchId).archived[key];
  if (!a) throw new Error(`${key} not archived in ${batchId}`);
  return a;
}

function archiveOne(save: Save, key: RecordKey, draft: Draft, batchId: BatchId = BATCH_DAY01): Save {
  const s = setDraft(save, batchId, key, draft);
  return commitArchive(s, batchId, record(key), okFor(key, batchOf(s, batchId).drafts[key]!));
}

function archiveAll(save: Save, b102Policy: MissingPolicy, batchId: BatchId = BATCH_DAY01): Save {
  let s = save;
  s = archiveOne(s, 'H17', { value: 'H-17' }, batchId);
  s = archiveOne(s, 'B102', { value: '0102', policy: b102Policy }, batchId);
  s = archiveOne(s, 'B607', { value: '0607' }, batchId);
  return s;
}

/** 依任意集合逐筆走完整驗證＋提交流程；一律附 policy，適用缺值的那幾筆才會用到。 */
function archiveEvery(save: Save, batchId: BatchId, records: readonly SourceRecord[], policy: MissingPolicy = 'default_false'): Save {
  let s = save;
  for (const r of records) {
    s = setDraft(s, batchId, r.key, { value: r.code, policy });
    const v = validateRecord(r, batchOf(s, batchId).drafts[r.key]!);
    if (!v.ok) throw new Error(`validation failed for ${r.key}: ${v.error}`);
    s = commitArchive(s, batchId, r, v);
  }
  return s;
}

function playToWrap(seed: number, b102Policy: MissingPolicy, dir: DayDirectory = DIR): Save {
  return completeWork(archiveAll(createSave(seed, dir), b102Policy), dir);
}

/** 跨日並開始當日工作：wrap → 次日收件（morning）→ work。 */
function toNextDay(save: Save, dir: DayDirectory): Save {
  return startDay(advanceDay(save, dir));
}

function playToDay2(seed: number, b102Policy: MissingPolicy, dir: DayDirectory = DIR): Save {
  return toNextDay(playToWrap(seed, b102Policy, dir), dir);
}

/** 第二輪逐筆審查（R10）：目前核對工作引用的每一筆都給同一個處置；回覆前必須做完。 */
function reviewAll(save: Save, dir: DayDirectory, disposition: ReviewDisposition = 'hold'): Save {
  const task = activeTaskOf(save, dir);
  if (task.kind !== 'reconcile') return save;
  let s = save;
  for (const key of task.recordKeys) s = setRecordReview(s, dir, key, disposition);
  return s;
}

/** Day 1 批次某筆的審查紀錄（提交編號與來源相同時）。 */
function day1Review(key: RecordKey, disposition: ReviewDisposition = 'hold', reviewedCode = record(key).code): RecordReview {
  return { disposition, batchId: BATCH_DAY01, archiveTaskId: TASK_DAY1, recordKey: key, sourceCode: record(key).code, reviewedCode };
}

/** 開摘要並完成逐筆審查（保留待查），可以回覆 ack／ask。 */
function readyToReply(save: Save, dir: DayDirectory): Save {
  return reviewAll(markReportOpened(save, dir), dir);
}

function playFull(seed: number, b102Policy: MissingPolicy, reply: Reply, dir: DayDirectory = DIR): Save {
  let s = playToDay2(seed, b102Policy, dir);
  s = markReportOpened(s, dir);
  s = markReceiptOpened(s, dir);
  s = reviewAll(s, dir);
  return submitReply(s, dir, reply);
}

/** 六天目錄：一路玩到指定日的 work（前面每一天都照規則完成）。 */
function playSixTo(dayId: string, seed = 42, day3Policy: MissingPolicy = 'default_false'): Save {
  let s = playFull(seed, 'request_review', 'ack', DIR6); // day.02 wrap
  if (dayId === DAY_02) throw new Error('use playToDay2 for day.02');
  s = toNextDay(s, DIR6); // day.03 work
  const archiveDays: Array<[string, BatchId, readonly SourceRecord[], MissingPolicy]> = [
    [DAY_03, BATCH_DAY03, DAY3_RECORDS, day3Policy],
    [DAY_04, BATCH_DAY04, DAY4_RECORDS, 'default_false'],
    [DAY_05, BATCH_DAY05, DAY5_RECORDS, 'default_false'],
  ];
  for (const [d, batchId, records, policy] of archiveDays) {
    if (s.dayId === dayId) return s;
    expect(s.dayId).toBe(d);
    s = toNextDay(completeWork(archiveEvery(s, batchId, records, policy), DIR6), DIR6);
  }
  expect(s.dayId).toBe(DAY_06);
  return s;
}

function mapAll(save: Save, dir: DayDirectory, assignments: Readonly<Record<string, string>> = CORRECT): Save {
  let s = save;
  for (const [target, source] of Object.entries(assignments)) s = setFieldAssignment(s, dir, target, source);
  return s;
}

/** 對應全對、選政策、預覽、確認匯入。 */
function submitMapping(save: Save, dir: DayDirectory, policy: MissingPolicy): Save {
  return submitFieldMap(previewFieldMap(setFieldBlankPolicy(mapAll(save, dir), dir, policy), dir), dir);
}

/** 只在測試內使用的臨時假資料集合，用來證明規則由集合長度驅動。 */
function fakeRecords(n: number): readonly SourceRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `T${i + 1}`,
    name: i % 3 === 0 ? null : `測試對象 ${i + 1}`,
    code: String(i + 1).padStart(4, '0'),
    refusal: null,
    refusalApplies: false,
  }));
}

const archivedAll: Record<RecordKey, ArchivedRecord> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source', source: snapshotOf(record('H17')) },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapshotOf(record('B102')) },
  B607: { archiveCode: '0607', refusal: true, origin: 'source', source: snapshotOf(record('B607')) },
};

const NIGHT_YES: NightResult = { intervention: true, smallTalkVariant: 1, reportRevision: 2 };

/** 黃金值：seed 42 介入（rand 0.2928 < 0.45）、seed 1 不介入（0.4957）。 */
const SEED_INTERVENE = 42;
const SEED_NO_INTERVENE = 1;

/* ---------- 每日／工作／批次識別 ---------- */

describe('dayId、stage、taskId 與批次識別', () => {
  it('createSave 起於目錄第一天的 work 階段，taskId 為該日工作，目前批次為其歸檔批次', () => {
    const s = createSave(1, DIR);
    expect(s.dayId).toBe(DAY_01);
    expect(s.stage).toBe('work');
    expect(s.taskId).toBe(TASK_DAY1);
    expect(currentBatchId(s, DIR)).toBe(BATCH_DAY01);
    expect(s.batches).toEqual({});
    expect(s.taskProgress).toEqual({});
    expect(s.readMessages).toEqual([]);
  });

  it('createSave 以目錄的第一天為準，不寫死 day.01', () => {
    const dir = createDayDirectory(
      [{ dayId: 'day.07', dayNumber: 7, nextDayId: null, tasks: [{ id: 'task.seven', kind: 'archive', batchId: 'batch.seven', recordKeys: [], caseReviews: [] }] }],
      {},
    );
    const s = createSave(1, dir);
    expect(s.dayId).toBe('day.07');
    expect(s.taskId).toBe('task.seven');
    expect(currentBatchId(s, dir)).toBe('batch.seven');
  });

  it('advanceDay 後 dayId 變成 day.02（次日收件）、taskId 變成核對工作，但仍檢視同一批 Day 1 歸檔', () => {
    const wrap = playToWrap(1, 'default_false');
    expect(wrap.dayId).toBe(DAY_01);
    const day2 = advanceDay(wrap, DIR);
    expect(day2.dayId).toBe(DAY_02);
    expect(day2.stage).toBe('morning');
    expect(day2.taskId).toBe(TASK_DAY2);
    expect(currentBatchId(day2, DIR)).toBe(BATCH_DAY01);
    expect(archivedCount(day2, BATCH_DAY01)).toBe(DAY1_RECORDS.length);
  });

  it('欄位映射日沒有歸檔批次：currentBatchId 為 null', () => {
    const day6 = playSixTo(DAY_06);
    expect(day6.taskId).toBe(TASK_DAY6);
    expect(currentBatchId(day6, DIR6)).toBeNull();
    expect(currentBatchId(createSave(1, DIR_FM), DIR_FM)).toBeNull();
  });

  it('planOf 對存檔 dayId 不在目錄內時拋錯，不會靜默退回別的日別', () => {
    const stray: Save = { ...createSave(1, DIR), dayId: 'day.99' };
    expect(() => planOf(stray, DIR)).toThrowError(/day\.99/);
    expect(() => currentBatchId(stray, DIR)).toThrowError(/day\.99/);
  });

  it('batchOf 對不存在的批次回傳空批次，不寫入存檔', () => {
    const s = createSave(1, DIR);
    expect(batchOf(s, BATCH_DAY03)).toEqual({ archived: {}, drafts: {} });
    expect(s.batches).toEqual({});
  });

  it('核對工作的對象由 plan.subjectKey 指定，且在來源批次的資料集合內', () => {
    const task = DIR.plan(DAY_02)!.tasks[0]!;
    expect(task.kind).toBe('reconcile');
    if (task.kind !== 'reconcile') return;
    expect(task.subjectKey).toBe('B102');
    expect(DIR.records(task.sourceBatchId).some((r) => r.key === task.subjectKey)).toBeTrue();
  });

  it('EVENT_KINDS 為通用名稱，不含 day1／day2 字樣', () => {
    expect(EVENT_KINDS).toEqual({
      archive: 'archive',
      dayComplete: 'day.complete',
      nightResolved: 'night.resolved',
      replySubmit: 'reply.submit',
      fieldMapSubmit: 'field-map.submit',
      taskComplete: 'task.complete',
      chatReply: 'chat.reply',
      chatSkip: 'chat.skip',
      recordReview: 'record.review',
      returnNotified: 'return.notified',
      returnResubmit: 'return.resubmit',
      returnWindow: 'return.window',
      returnChecked: 'return.checked',
      helpRequest: 'help.request',
      attachmentSubmit: 'attachment.submit',
      attachmentRevise: 'attachment.revise',
      attachmentChecked: 'attachment.checked',
      transformSubmit: 'transform.submit',
      reportSubmit: 'report.submit',
    });
    for (const kind of Object.values(EVENT_KINDS)) expect(kind).not.toMatch(/day[0-9]/);
  });
});

/* ---------- 日與階段分離 ---------- */

describe('日與階段分離', () => {
  it('同一個 dayId（day.01）可處於 work 與 wrap，兩者都合法', () => {
    const work = archiveAll(createSave(1, DIR), 'default_false');
    const wrap = completeWork(work, DIR);
    expect(work.dayId).toBe(DAY_01);
    expect(work.stage).toBe('work');
    expect(wrap.dayId).toBe(DAY_01);
    expect(wrap.stage).toBe('wrap');
    expect(wrap.taskId).toBe(work.taskId);
    expect(validSave(work)).toBeTrue();
    expect(validSave(wrap)).toBeTrue();
  });

  it('核對日（day.02）在有下一天的目錄中可處於 work 與 wrap', () => {
    const work = readyToReply(playToDay2(1, 'default_false', DIR6), DIR6);
    const wrap = submitReply(work, DIR6, 'ack');
    expect(work.dayId).toBe(DAY_02);
    expect(work.stage).toBe('work');
    expect(wrap.dayId).toBe(DAY_02);
    expect(wrap.stage).toBe('wrap');
    expect(validSave(work, DIR6)).toBeTrue();
    expect(validSave(wrap, DIR6)).toBeTrue();
  });

  it('stage 是存檔自己的欄位，不從 dayId 推導：手造 day.01/wrap 與 day.02/work 各自合法', () => {
    const day1Wrap = makeSave({ stage: 'wrap', batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) } });
    const day2Work = makeSave({
      dayId: DAY_02,
      stage: 'work',
      taskId: TASK_DAY2,
      batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) },
      night: NIGHT_YES,
    });
    expect(validSave(day1Wrap)).toBeTrue();
    expect(validSave(day2Work)).toBeTrue();
  });

  it('Stage union 為 work／wrap／morning／end 四個通用值；舊檔（v2–v6）只有 work／wrap／end', () => {
    expect(STAGES).toEqual(['work', 'wrap', 'morning', 'end']);
    expect(LEGACY_STAGES).toEqual(['work', 'wrap', 'end']);
  });
});

/* ---------- next-day 由目錄決定 ---------- */

describe('next-day 由目錄決定', () => {
  it('六天目錄：day.01 → … → day.06 → end，每一步都依 nextDayId 前進且通過 schema', () => {
    let s = createSave(SEED_INTERVENE, DIR6);
    expect(validSave(s, DIR6)).toBeTrue();

    s = completeWork(archiveAll(s, 'request_review'), DIR6);
    expect([s.dayId, s.stage]).toEqual([DAY_01, 'wrap']);
    expect(validSave(s, DIR6)).toBeTrue();

    s = advanceDay(s, DIR6);
    expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_02, 'morning', TASK_DAY2]);
    expect(validSave(s, DIR6)).toBeTrue();
    s = startDay(s);
    expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_02, 'work', TASK_DAY2]);
    expect(validSave(s, DIR6)).toBeTrue();

    s = submitReply(markReceiptOpened(readyToReply(s, DIR6), DIR6), DIR6, 'review');
    expect([s.dayId, s.stage]).toEqual([DAY_02, 'wrap']);
    expect(reconcileProgressOf(s, TASK_DAY2).reply).toBe('review');
    expect(validSave(s, DIR6)).toBeTrue();

    const archiveDays: Array<[string, string, BatchId, readonly SourceRecord[], string]> = [
      [DAY_03, TASK_DAY3, BATCH_DAY03, DAY3_RECORDS, DAY_04],
      [DAY_04, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS, DAY_05],
      [DAY_05, TASK_DAY5, BATCH_DAY05, DAY5_RECORDS, DAY_06],
    ];
    for (const [dayId, taskId, batchId, records, next] of archiveDays) {
      s = advanceDay(s, DIR6);
      expect([s.dayId, s.stage, s.taskId]).toEqual([dayId, 'morning', taskId]);
      expect(validSave(s, DIR6)).toBeTrue();
      expect(completeWork(s, DIR6)).toBe(s);
      s = startDay(s);
      expect([s.dayId, s.stage, s.taskId]).toEqual([dayId, 'work', taskId]);
      expect(currentBatchId(s, DIR6)).toBe(batchId);
      expect(archivedCount(s, batchId)).toBe(0);
      expect(validSave(s, DIR6)).toBeTrue();
      expect(completeWork(s, DIR6)).toBe(s);
      s = completeWork(archiveEvery(s, batchId, records), DIR6);
      expect([s.dayId, s.stage]).toEqual([dayId, 'wrap']);
      expect(DIR6.plan(dayId)!.nextDayId).toBe(next);
      expect(validSave(s, DIR6)).toBeTrue();
    }

    s = advanceDay(s, DIR6);
    expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_06, 'morning', TASK_DAY6]);
    s = startDay(s);
    expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_06, 'work', TASK_DAY6]);
    expect(validSave(s, DIR6)).toBeTrue();
    expect(completeWork(s, DIR6)).toBe(s);

    s = submitMapping(s, DIR6, 'request_review');
    expect(s.stage).toBe('work');
    expect(validSave(s, DIR6)).toBeTrue();

    // 最後一天 nextDayId: null → 直接 end，dayId 停在最後一天
    s = completeWork(s, DIR6);
    expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_06, 'end', TASK_DAY6]);
    expect(validSave(s, DIR6)).toBeTrue();
    expect(advanceDay(s, DIR6)).toBe(s);
    expect(completeWork(s, DIR6)).toBe(s);
  });

  it('兩天目錄：核對日沒有下一天時 submitReply 直接進 end', () => {
    const ready = readyToReply(playToDay2(1, 'default_false', DIR), DIR);
    expect(DIR.plan(DAY_02)!.nextDayId).toBeNull();
    const end = submitReply(ready, DIR, 'ack');
    expect(end.stage).toBe('end');
    expect(end.dayId).toBe(DAY_02);
    expect(validSave(end, DIR)).toBeTrue();
  });

  it('六天目錄：Day 2 回覆後進 wrap（不是 end），advanceDay 接到 day.03', () => {
    const ready = readyToReply(playToDay2(1, 'default_false', DIR6), DIR6);
    expect(DIR6.plan(DAY_02)!.nextDayId).toBe(DAY_03);
    const wrap = submitReply(ready, DIR6, 'ack');
    expect(wrap.stage).toBe('wrap');
    expect(wrap.dayId).toBe(DAY_02);
    const n = wrap.events.length;
    expect(wrap.events.slice(-3)).toEqual([
      { id: `reply.submit:${n - 3}`, kind: 'reply.submit', payload: { taskId: TASK_DAY2, choice: 'ack' } },
      { id: `task.complete:${n - 2}`, kind: 'task.complete', payload: { dayId: DAY_02, taskId: TASK_DAY2 } },
      { id: `day.complete:${n - 1}`, kind: 'day.complete', payload: { dayId: DAY_02 } },
    ]);
    const day3 = advanceDay(wrap, DIR6);
    expect([day3.dayId, day3.stage, day3.taskId]).toEqual([DAY_03, 'morning', TASK_DAY3]);
    expect(validSave(day3, DIR6)).toBeTrue();
  });

  it('同一份 day.02 存檔：用兩天目錄回 end、用六天目錄回 wrap（決定權在目錄）', () => {
    const ready = readyToReply(playToDay2(1, 'default_false', DIR), DIR);
    expect(submitReply(ready, DIR, 'ask').stage).toBe('end');
    expect(submitReply(ready, DIR6, 'ask').stage).toBe('wrap');
  });

  it('最後一天是歸檔日：completeWork 直接 end（不經 wrap）', () => {
    const day3 = toNextDay(submitReply(readyToReply(playToDay2(1, 'default_false', DIR3), DIR3), DIR3, 'ack'), DIR3);
    const end = completeWork(archiveEvery(day3, BATCH_DAY03, DAY3_RECORDS), DIR3);
    expect([end.dayId, end.stage]).toEqual([DAY_03, 'end']);
    expect(end.events[end.events.length - 1].kind).toBe('day.complete');
    expect(validSave(end, DIR3)).toBeTrue();
  });

  it('只有一天的目錄：第一天就是最後一天，completeWork 直接 end', () => {
    const dir = createDayDirectory([day1Plan(DAY1_RECORDS, null)], { [BATCH_DAY01]: DAY1_RECORDS });
    const end = completeWork(archiveAll(createSave(1, dir), 'default_false'), dir);
    expect(end.stage).toBe('end');
    expect(end.night).toBeUndefined();
    expect(validSave(end, dir)).toBeTrue();
  });

  it('最後一天處於 wrap（手造）時 advanceDay 轉為 end，不改 dayId', () => {
    const lastWrap: Save = { ...playSixTo(DAY_06), stage: 'wrap' };
    const end = advanceDay(lastWrap, DIR6);
    expect(end.stage).toBe('end');
    expect(end.dayId).toBe(DAY_06);
    expect(end.taskId).toBe(TASK_DAY6);
    expect(end.events).toEqual(lastWrap.events);
  });

  it('nextDayId 指向目錄沒有的日別時 advanceDay 拋錯，不會靜默結束', () => {
    const broken = createDayDirectory([day1Plan(DAY1_RECORDS, 'day.99')], { [BATCH_DAY01]: DAY1_RECORDS });
    const wrap = playToWrap(1, 'default_false', broken);
    expect(wrap.stage).toBe('wrap');
    expect(() => advanceDay(wrap, broken)).toThrowError(/day\.99/);
  });

  it('completeWork 對核對工作一律 no-op（即使已回覆也不走這裡）', () => {
    const day2 = playToDay2(1, 'default_false', DIR6);
    expect(completeWork(day2, DIR6)).toBe(day2);
    const replied = submitReply(readyToReply(day2, DIR6), DIR6, 'ack');
    expect(completeWork(replied, DIR6)).toBe(replied);
    // 手造一份「已回覆但仍在 work」：completeWork 也不接手
    const stuck: Save = { ...replied, stage: 'work' };
    expect(completeWork(stuck, DIR6)).toBe(stuck);
  });
});

/* ---------- 夜間只擲一次 ---------- */

describe('夜間只擲一次', () => {
  it('六天目錄連續跨五夜：night 內容不變、只有一個 night.resolved 事件', () => {
    const day2 = playToDay2(SEED_INTERVENE, 'request_review', DIR6);
    expect(day2.night).toEqual(resolveNight(SEED_INTERVENE));
    const day6 = playSixTo(DAY_06, SEED_INTERVENE);
    expect(day6.night).toEqual(resolveNight(SEED_INTERVENE));
    expect(day6.events.filter((e) => e.kind === EVENT_KINDS.nightResolved).length).toBe(1);

    const end = completeWork(submitMapping(day6, DIR6, 'default_false'), DIR6);
    expect(end.stage).toBe('end');
    expect(end.night).toBe(day6.night!);
    expect(end.events.filter((e) => e.kind === EVENT_KINDS.nightResolved).length).toBe(1);
  });

  it('night 已存在則不重算：內容相同且沒有新增 night.resolved 事件', () => {
    const preset: NightResult = { intervention: false, smallTalkVariant: 0, reportRevision: 1 };
    expect(preset).not.toEqual(resolveNight(SEED_INTERVENE));
    const wrap: Save = { ...playToWrap(SEED_INTERVENE, 'default_false'), night: preset };
    const day2 = advanceDay(wrap, DIR);
    expect(day2.stage).toBe('morning');
    expect(day2.dayId).toBe(DAY_02);
    expect(day2.night).toBe(preset);
    expect(day2.events).toEqual(wrap.events);
    expect(day2.events.some((e) => e.kind === 'night.resolved')).toBeFalse();
  });
});

/* ---------- 後續日資料不污染 Day 1 ---------- */

describe('後續日資料不污染 Day 1', () => {
  it('目錄多幾天、多幾個批次後，Day 1 批次的 records() 完全不變', () => {
    expect(DIR6.days).toEqual([DAY_01, DAY_02, DAY_03, DAY_04, DAY_05, DAY_06]);
    expect(DIR6.records(BATCH_DAY01)).toEqual(DIR.records(BATCH_DAY01));
    expect(DIR6.records(BATCH_DAY01).map((r) => r.key)).toEqual(['H17', 'B102', 'B607']);
    const day1Keys = new Set(DIR6.records(BATCH_DAY01).map((r) => r.key));
    for (const batch of [BATCH_DAY03, BATCH_DAY04, BATCH_DAY05]) {
      for (const r of DIR6.records(batch)) expect(day1Keys.has(r.key)).toBeFalse();
    }
  });

  it('createSave 與 Day 1 全部歸檔的結果，在兩天與六天目錄下逐字相同', () => {
    expect(JSON.stringify(createSave(1, DIR6))).toBe(JSON.stringify(createSave(1, DIR)));
    const a = archiveAll(createSave(1, DIR), 'request_review');
    const b = archiveAll(createSave(1, DIR6), 'request_review');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(currentBatchId(b, DIR6)).toBe(BATCH_DAY01);
  });

  it('Day 1 的 archivedCount／allArchived 不受後續批次存在影響', () => {
    let s = createSave(1, DIR3);
    expect(archivedCount(s, BATCH_DAY01)).toBe(0);
    expect(allArchived(s, BATCH_DAY01, DIR3.records(BATCH_DAY01))).toBeFalse();
    s = archiveOne(s, 'B607', { value: '0607' });
    expect(archivedCount(s, BATCH_DAY01)).toBe(1);
    s = archiveAll(createSave(1, DIR3), 'default_false');
    expect(archivedCount(s, BATCH_DAY01)).toBe(3);
    expect(allArchived(s, BATCH_DAY01, DIR3.records(BATCH_DAY01))).toBeTrue();
    expect(s.batches[BATCH_DAY03]).toBeUndefined();
    expect(archivedCount(s, BATCH_DAY03)).toBe(0);
  });

  it('每一天只讀寫自己的批次：Day 3–5 完成後 Day 1 歷史完整、各批次筆數各自正確', () => {
    const day6 = playSixTo(DAY_06);
    expect(archivedCount(day6, BATCH_DAY01)).toBe(DAY1_RECORDS.length);
    expect(archivedCount(day6, BATCH_DAY03)).toBe(DAY3_RECORDS.length);
    expect(archivedCount(day6, BATCH_DAY04)).toBe(DAY4_RECORDS.length);
    expect(archivedCount(day6, BATCH_DAY05)).toBe(DAY5_RECORDS.length);
    expect(archivedIn(day6, 'B102').origin).toBe('review');
    expect(archivedIn(day6, 'U1', BATCH_DAY04).archiveCode).toBe('0401');
  });

  it('Day 3 批次的鍵不能拿來對 Day 1 批次歸檔（完成度以各批次自己的集合為準）', () => {
    const cross = putArchived(createSave(1, DIR3), { T1: fakeArchived('0001'), T2: fakeArchived('0002') });
    expect(archivedCount(cross, BATCH_DAY01)).toBe(2);
    expect(allArchived(cross, BATCH_DAY01, DIR3.records(BATCH_DAY01))).toBeFalse();
    expect(validSave(cross, DIR3)).toBeFalse();
  });
});

/* ---------- 四格矩陣（Spec §5） ---------- */

describe('isArranged 四格矩陣', () => {
  const matrix: Array<[boolean | null, boolean, boolean]> = [
    [false, false, true],
    [false, true, true],
    [null, false, false],
    [null, true, true],
  ];

  for (const [refusal, intervention, expected] of matrix) {
    it(`isArranged(${refusal}, ${intervention}) → ${expected}`, () => {
      expect(isArranged(refusal, intervention)).toBe(expected);
    });

    it(`isArrangedInSave：B102.refusal=${refusal}、night.intervention=${intervention} → ${expected}`, () => {
      const b102: ArchivedRecord =
        refusal === false
          ? { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapshotOf(record('B102')) }
          : { archiveCode: '0102', refusal: null, origin: 'review', source: snapshotOf(record('B102')) };
      const save = makeSave({
        seed: 7,
        dayId: DAY_02,
        stage: 'work',
        taskId: TASK_DAY2,
        batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: b102 }) },
        night: { intervention, smallTalkVariant: 0, reportRevision: intervention ? 2 : 1 },
      });
      expect(validSave(save)).toBeTrue();
      expect(isArrangedInSave(save, DIR)).toBe(expected);
    });
  }

  it('isArrangedInSave 只在核對工作判定：歸檔日、欄位映射日一律 false', () => {
    expect(isArrangedInSave(createSave(1, DIR), DIR)).toBeFalse();
    const day1 = archiveAll(createSave(1, DIR), 'default_false');
    expect(archivedIn(day1, 'B102').refusal).toBeFalse();
    expect(isArrangedInSave(day1, DIR)).toBeFalse();
    const day6 = playSixTo(DAY_06, SEED_INTERVENE);
    expect(day6.night!.intervention).toBeTrue();
    expect(isArrangedInSave(day6, DIR6)).toBeFalse();
  });

  it('isArrangedInSave 看 plan.subjectKey，不寫死 B102', () => {
    // 對象改成 B607：來源 refusal=true，無介入 → 未安排；B102 寫了 false 也不算數
    const dirB607 = twoDayDirectory(DAY1_RECORDS, 'B607');
    const day2 = playToDay2(SEED_NO_INTERVENE, 'default_false', dirB607);
    expect(archivedIn(day2, 'B102').refusal).toBeFalse();
    expect(archivedIn(day2, 'B607').refusal).toBeTrue();
    expect(isArrangedInSave(day2, dirB607)).toBeFalse();
    expect(isArrangedInSave(day2, DIR)).toBeTrue();
    // 對象若不在批次內，視同 null：只看夜間介入
    const dirMissing = twoDayDirectory(DAY1_RECORDS, 'NOPE');
    expect(isArrangedInSave(day2, dirMissing)).toBeFalse();
    expect(isArrangedInSave({ ...day2, night: NIGHT_YES }, dirMissing)).toBeTrue();
  });

  it('isArrangedInSave 看核對工作指定的來源批次，不受其他批次影響', () => {
    const day2 = playToDay2(SEED_NO_INTERVENE, 'request_review');
    expect(day2.night!.intervention).toBeFalse();
    const save = putArchived(day2, { B102: { ...fakeArchived('0102'), refusal: false, origin: 'defaulted' } }, BATCH_DAY03);
    expect(archivedIn(save, 'B102', BATCH_DAY03).refusal).toBeFalse();
    expect(archivedIn(save, 'B102', BATCH_DAY01).refusal).toBeNull();
    expect(isArrangedInSave(save, DIR)).toBeFalse();
  });

  it('實際流程：default_false 恒為已列入安排；request_review 依夜間介入而定（seed 1..50）', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const fixed = playToDay2(seed, 'default_false');
      expect(isArrangedInSave(fixed, DIR)).toBeTrue();
      const held = playToDay2(seed, 'request_review');
      expect(isArrangedInSave(held, DIR)).toBe(held.night!.intervention);
    }
  });

  it('Spec §5 結果矩陣的四個格子都能由實際流程產生（六天目錄亦同）', () => {
    for (const dir of [DIR, DIR6]) {
      const ff = playToDay2(SEED_NO_INTERVENE, 'default_false', dir);
      expect(ff.night!.intervention).toBeFalse();
      expect(ff.night!.reportRevision).toBe(1);
      expect(isArrangedInSave(ff, dir)).toBeTrue();

      const ft = playToDay2(SEED_INTERVENE, 'default_false', dir);
      expect(ft.night!.intervention).toBeTrue();
      expect(ft.night!.reportRevision).toBe(2);
      expect(isArrangedInSave(ft, dir)).toBeTrue();

      const nf = playToDay2(SEED_NO_INTERVENE, 'request_review', dir);
      expect(nf.night!.intervention).toBeFalse();
      expect(isArrangedInSave(nf, dir)).toBeFalse();

      const nt = playToDay2(SEED_INTERVENE, 'request_review', dir);
      expect(nt.night!.intervention).toBeTrue();
      expect(isArrangedInSave(nt, dir)).toBeTrue();
    }
  });
});

/* ---------- 夜間判定 ---------- */

describe('resolveNight', () => {
  it('同 seed 可重現', () => {
    expect(resolveNight(42)).toEqual(resolveNight(42));
    expect(resolveNight(999)).toEqual(resolveNight(999));
  });

  it('seed 42 → 介入、variant 1、revision 2（黃金值）', () => {
    expect(resolveNight(SEED_INTERVENE)).toEqual({ intervention: true, smallTalkVariant: 1, reportRevision: 2 });
  });

  it('seed 1 → 不介入、revision 1（黃金值）', () => {
    const n = resolveNight(SEED_NO_INTERVENE);
    expect(n.intervention).toBeFalse();
    expect(n.reportRevision).toBe(1);
  });

  it('seed 1..1000：reportRevision === (intervention ? 2 : 1)、variant ∈ {0,1}、與 rand 門檻一致、兩種結果皆出現', () => {
    let yes = 0;
    let no = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const n = resolveNight(seed);
      expect(n.reportRevision).toBe(n.intervention ? 2 : 1);
      expect([0, 1]).toContain(n.smallTalkVariant);
      expect(n.intervention).toBe(rand(seed, EVENT_IDS.nightIntervention) < INTERVENTION_THRESHOLD);
      expect(n.smallTalkVariant).toBe(Math.floor(rand(seed, EVENT_IDS.nightSmallTalk) * 2));
      if (n.intervention) yes++;
      else no++;
    }
    expect(yes).toBeGreaterThan(0);
    expect(no).toBeGreaterThan(0);
  });

  it('intervention 與 smallTalk 用不同 eventId', () => {
    expect(EVENT_IDS.nightIntervention).not.toBe(EVENT_IDS.nightSmallTalk);
    expect(INTERVENTION_THRESHOLD).toBe(0.45);
  });
});

/* ---------- 編號逐字保存 ---------- */

describe('歸檔編號保留前導零', () => {
  it('commitArchive 後 B102.archiveCode 為 "0102"，JSON 往返後仍是 "0102"', () => {
    const save = commitArchive(createSave(42, DIR), BATCH_DAY01, record('B102'), okFor('B102', { value: '0102', policy: 'default_false' }));
    expect(archivedIn(save, 'B102').archiveCode).toBe('0102');
    expect(typeof archivedIn(save, 'B102').archiveCode).toBe('string');

    const restored = JSON.parse(JSON.stringify(save)) as Save;
    expect(archivedIn(restored, 'B102').archiveCode).toBe('0102');
    expect(archivedIn(restored, 'B102').source.code).toBe('0102');
    expect(validSave(restored)).toBeTrue();
  });

  it('三筆齊時各自寫入來源原字串編號', () => {
    const s = archiveAll(createSave(1, DIR), 'default_false');
    expect(archivedIn(s, 'H17').archiveCode).toBe('H-17');
    expect(archivedIn(s, 'B102').archiveCode).toBe('0102');
    expect(archivedIn(s, 'B607').archiveCode).toBe('0607');
    expect(batchOf(s, BATCH_DAY01).archived).toEqual(archivedAll);
  });
});

/* ---------- 來源快照 ---------- */

describe('來源快照', () => {
  it('commitArchive 寫入提交當下的來源快照，與提交結果各自獨立', () => {
    const b102 = record('B102');
    const s = commitArchive(createSave(1, DIR), BATCH_DAY01, b102, okFor('B102', { value: '0102', policy: 'default_false' }));
    const a = archivedIn(s, 'B102');
    expect(a.source).toEqual(snapshotOf(b102));
    expect(a.source).toEqual({ name: null, code: '0102', refusal: null, refusalApplies: true });
    expect<object>(a.source).not.toBe(b102);
    expect(a.source.refusal).toBeNull();
    expect(a.refusal).toBeFalse();
    expect(a.origin).toBe('defaulted');
  });

  it('每一筆歸檔都帶有與來源逐欄相同的快照', () => {
    const s = archiveAll(createSave(1, DIR), 'request_review');
    for (const r of DAY1_RECORDS) {
      expect(archivedIn(s, r.key).source).toEqual({ name: r.name, code: r.code, refusal: r.refusal, refusalApplies: r.refusalApplies });
    }
  });

  it('來源資料日後被改寫時，非目前批次的歷史結果不會被判定損壞', () => {
    const changed: readonly SourceRecord[] = DAY1_RECORDS.map((r) => (r.key === 'B102' ? { ...r, code: '9999', name: '改版後的登記' } : r));
    const changedDir3 = threeDayDirectory(changed);
    const done = archiveAll(createSave(1, DIR), 'default_false');

    // 存檔已走到 Day 3 → Day 1 批次只檢查結構，不與現行資料表比對
    const onDay3: Save = {
      ...done,
      dayId: DAY_03,
      taskId: TASK_DAY3,
      night: NIGHT_YES,
      taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ack' } },
    };
    expect(validSave(onDay3, changedDir3)).toBeTrue();
    expect(archivedIn(onDay3, 'B102').source).toEqual({ name: null, code: '0102', refusal: null, refusalApplies: true });
    expect(archivedIn(onDay3, 'B102').archiveCode).toBe('0102');

    // R10：即使是「目前批次」，提交編號與現行來源不同也只是格式合法的內容差異，不是毀損存檔
    expect(validSave(done, twoDayDirectory(changed))).toBeTrue();
    expect(validSave(done, DIR)).toBeTrue();
    // 對照組：目前批次仍要求 key 在該批次的資料集合內
    expect(validSave(done, twoDayDirectory(DAY1_RECORDS.filter((r) => r.key !== 'B102')))).toBeFalse();
  });
});

/* ---------- 批次範圍 ---------- */

describe('批次範圍', () => {
  function twoBatches(): Save {
    return makeSave({
      seed: 3,
      batches: {
        [BATCH_DAY01]: makeBatch({ ...archivedAll }, { H17: { value: 'H-17' } }),
        [BATCH_DAY03]: makeBatch({ T1: fakeArchived('0001') }, { T2: { value: '000' } }),
      },
    });
  }

  it('archivedCount 只計算指定批次', () => {
    const s = twoBatches();
    expect(currentBatchId(s, DIR)).toBe(BATCH_DAY01);
    expect(archivedCount(s, BATCH_DAY01)).toBe(3);
    expect(archivedCount(s, BATCH_DAY03)).toBe(1);
    expect(archivedCount(s, 'batch.nonexistent')).toBe(0);
  });

  it('某批次完成不會讓另一批次被視為完成', () => {
    const s = twoBatches();
    expect(allArchived(s, BATCH_DAY01, DAY1_RECORDS)).toBeTrue();
    expect(allArchived(s, BATCH_DAY03, DAY3_RECORDS)).toBeFalse();
    expect(allArchived(s, BATCH_DAY03, DAY1_RECORDS)).toBeFalse();
    expect(allArchived(s, BATCH_DAY01, DAY3_RECORDS)).toBeFalse();
  });

  it('commitArchive 寫進指定批次，其他批次不受影響', () => {
    const s = twoBatches();
    const next = commitArchive(s, BATCH_DAY03, record('H17'), okFor('H17', { value: 'H-17' }));
    expect(archivedCount(next, BATCH_DAY03)).toBe(2);
    expect(archivedIn(next, 'H17', BATCH_DAY03).archiveCode).toBe('H-17');
    expect(batchOf(next, BATCH_DAY01).archived).toEqual(archivedAll);
    expect(next.events[next.events.length - 1].payload).toEqual({ key: 'H17', origin: 'source', batchId: BATCH_DAY03 });
  });

  it('setDraft 寫進指定批次，其他批次的草稿不變', () => {
    const s = twoBatches();
    const next = setDraft(s, BATCH_DAY03, 'H17', { value: '改過的草稿' });
    expect(batchOf(next, BATCH_DAY03).drafts['H17']).toEqual({ value: '改過的草稿' });
    expect(batchOf(next, BATCH_DAY01).drafts).toEqual({ H17: { value: 'H-17' } });
    expect(batchOf(s, BATCH_DAY03).drafts['H17']).toBeUndefined();
  });

  it('兩個批次並存的存檔仍通過 schema（歷史批次只檢查結構）', () => {
    const s = twoBatches();
    expect(validSave(s, DIR)).toBeTrue();
    expect(validSave(s, DIR3)).toBeTrue();
  });
});

/* ---------- 某批次是否有送覆核（R6-03：Day 4 互斥訊息） ---------- */

describe('batchHasReview', () => {
  it('批次內有任一筆 origin=review → true；只有 source／defaulted → false；空或未知批次 → false', () => {
    const s0 = createSave(1, DIR);
    expect(batchHasReview(s0, BATCH_DAY01)).toBeFalse();
    expect(batchHasReview(s0, 'batch.nonexistent')).toBeFalse();

    const fixed = archiveAll(createSave(1, DIR), 'default_false');
    expect(Object.values(batchOf(fixed, BATCH_DAY01).archived).map((a) => a!.origin)).toEqual(['source', 'defaulted', 'source']);
    expect(batchHasReview(fixed, BATCH_DAY01)).toBeFalse();

    const held = archiveAll(createSave(1, DIR), 'request_review');
    expect(batchHasReview(held, BATCH_DAY01)).toBeTrue();
  });

  it('只看指定批次：Day 1 有 review 不會讓 Day 3 為 true', () => {
    const s = putArchived(putArchived(createSave(1, DIR), { B102: fakeArchived('0102', 'review') }), { T1: fakeArchived('0001', 'defaulted') }, BATCH_DAY03);
    expect(batchHasReview(s, BATCH_DAY01)).toBeTrue();
    expect(batchHasReview(s, BATCH_DAY03)).toBeFalse();
  });

  it('草稿選了 request_review 但尚未提交不算', () => {
    const s = setDraft(createSave(1, DIR), BATCH_DAY01, 'B102', { value: '0102', policy: 'request_review' });
    expect(batchHasReview(s, BATCH_DAY01)).toBeFalse();
  });

  it('實際六天流程：Day 3 的選擇決定 Day 3 批次的判斷，Day 4 之後不變（唯讀推導，不寫存檔）', () => {
    const review = playSixTo(DAY_04, 1, 'request_review');
    const none = playSixTo(DAY_04, 1, 'default_false');
    expect(batchHasReview(review, BATCH_DAY03)).toBeTrue();
    expect(batchHasReview(none, BATCH_DAY03)).toBeFalse();
    // 兩份存檔只差在 Day 3 批次內容，沒有另存分支欄位
    expect(Object.keys(review).sort()).toEqual(Object.keys(none).sort());
    expect(review.taskProgress).toEqual(none.taskProgress);
    const snapshot = JSON.stringify(review);
    batchHasReview(review, BATCH_DAY03);
    expect(JSON.stringify(review)).toBe(snapshot);
  });
});

/* ---------- 筆數由資料集合決定 ---------- */

describe('筆數由資料集合決定（4–12 筆假集合）', () => {
  for (const n of [4, 7, 12]) {
    it(`${n} 筆：archivedCount 逐筆遞增，allArchived 只在最後一筆後為 true`, () => {
      const records = fakeRecords(n);
      const dir = twoDayDirectory(records, 'T1');
      let s = createSave(1, dir);
      records.forEach((r, i) => {
        s = archiveEvery(s, BATCH_DAY01, [r]);
        expect(archivedCount(s, BATCH_DAY01)).toBe(i + 1);
        expect(allArchived(s, BATCH_DAY01, records)).toBe(i === n - 1);
      });
      expect(allArchived(s, BATCH_DAY01, dir.records(BATCH_DAY01))).toBeTrue();
      expect(validSave(s, dir)).toBeTrue();
    });

    it(`${n} 筆：完成全部後 completeWork 進 wrap，且存檔通過 schema`, () => {
      const records = fakeRecords(n);
      const dir = twoDayDirectory(records, 'T1');
      const full = archiveEvery(createSave(3, dir), BATCH_DAY01, records);
      const next = completeWork(full, dir);
      expect(next).not.toBe(full);
      expect(next.stage).toBe('wrap');
      expect(next.dayId).toBe(DAY_01);
      expect(validSave(next, dir)).toBeTrue();
    });
  }

  it('allArchived 不是「數量夠了」：湊到 12 筆但少一個鍵仍為 false', () => {
    const records = fakeRecords(12);
    const dir = twoDayDirectory(records, 'T1');
    const partial = archiveEvery(createSave(1, dir), BATCH_DAY01, records.slice(0, 11));
    const padded = putArchived(partial, { EXTRA: fakeArchived('9999') });
    expect(archivedCount(padded, BATCH_DAY01)).toBe(12);
    expect(allArchived(padded, BATCH_DAY01, records)).toBeFalse();
    expect(validSave(padded, dir)).toBeFalse();
    expect(completeWork(padded, dir)).toBe(padded);
  });

  it('isValidSave 仍拒絕目前批次內不在集合的 key', () => {
    const dir12 = twoDayDirectory(fakeRecords(12), 'T1');
    const unknown = putArchived(createSave(1, DIR), { UNKNOWN: fakeArchived('0001') });
    expect(validSave(unknown, dir12)).toBeFalse();
    expect(validSave(unknown, DIR)).toBeFalse();
    const known = putArchived(createSave(1, DIR), { T1: fakeArchived('0001') });
    expect(validSave(known, dir12)).toBeTrue();
    expect(validSave(known, DIR)).toBeFalse();
  });

  it('isValidSave 完全信任傳入的目錄：來源批次的集合變大，核對日的存檔就會被判定未完成', () => {
    const end = playFull(SEED_INTERVENE, 'default_false', 'ack');
    expect(validSave(end, DIR)).toBeTrue();
    expect(validSave(end, twoDayDirectory([...DAY1_RECORDS, ...fakeRecords(3)]))).toBeFalse();
  });
});

describe('archivedCount／allArchived', () => {
  it('空存檔 0、未齊 false；三筆齊 3、true', () => {
    const s0 = createSave(1, DIR);
    expect(archivedCount(s0, BATCH_DAY01)).toBe(0);
    expect(allArchived(s0, BATCH_DAY01, DAY1_RECORDS)).toBeFalse();
    const s1 = commitArchive(s0, BATCH_DAY01, record('B607'), okFor('B607', { value: '0607' }));
    expect(archivedCount(s1, BATCH_DAY01)).toBe(1);
    expect(allArchived(s1, BATCH_DAY01, DAY1_RECORDS)).toBeFalse();
    const s3 = archiveAll(createSave(1, DIR), 'default_false');
    expect(archivedCount(s3, BATCH_DAY01)).toBe(3);
    expect(allArchived(s3, BATCH_DAY01, DAY1_RECORDS)).toBeTrue();
  });

  it('allArchived 對空集合為 true（vacuous），對未知批次與非空集合為 false', () => {
    const s = createSave(1, DIR);
    expect(allArchived(s, BATCH_DAY01, [])).toBeTrue();
    expect(allArchived(s, 'batch.nonexistent', DAY1_RECORDS)).toBeFalse();
  });
});

/* ---------- 狀態轉移 ---------- */

describe('createSave', () => {
  it('version 11、day.01／work／task.day1.archive、空 batches／taskProgress／chatReplies／waivedTasks／caseReviews／returns／issueSchedule／events／readMessages；R12：profile.name null、onboarding {0, 未完成}、空 mailbox／readMail／helpRequests／issueDrafts；沒有 readIssueReceipts 與全域 evidence／reply', () => {
    expect(createSave(42, DIR)).toEqual({
      version: SAVE_VERSION,
      seed: 42,
      dayId: DAY_01,
      stage: 'work',
      taskId: TASK_DAY1,
      batches: {},
      taskProgress: {},
      chatReplies: {},
      waivedTasks: [],
      caseReviews: {},
      returns: [],
      issueSchedule: {},
      issueDrafts: {},
      mailbox: [],
      readMail: [],
      helpRequests: {},
      profile: { name: null },
      onboarding: { step: 0, complete: false },
      events: [],
      readMessages: [],
    });
    expect(SAVE_VERSION).toBe(11);
    const raw = createSave(42, DIR) as unknown as Record<string, unknown>;
    for (const key of ['night', 'evidence', 'reply', 'phase', 'readIssueReceipts']) expect(key in raw).withContext(key).toBeFalse();
  });

  it('新存檔通過 schema 檢查', () => {
    expect(validSave(createSave(0, DIR))).toBeTrue();
    expect(validSave(createSave(0, DIR6), DIR6)).toBeTrue();
    expect(validSave(createSave(0, DIR_FM), DIR_FM)).toBeTrue();
  });
});

describe('withEvent', () => {
  it('附加事件、id 為 kind:index、不改原物件', () => {
    const s = createSave(1, DIR);
    const a = withEvent(s, 'x', { n: 1 });
    const b = withEvent(a, 'y', null);
    expect(s.events).toEqual([]);
    expect(a.events).toEqual([{ id: 'x:0', kind: 'x', payload: { n: 1 } }]);
    expect(b.events).toEqual([
      { id: 'x:0', kind: 'x', payload: { n: 1 } },
      { id: 'y:1', kind: 'y', payload: null },
    ]);
  });
});

describe('setDraft', () => {
  it('不改原物件；新物件的指定批次有草稿', () => {
    const s = createSave(1, DIR);
    const next = setDraft(s, BATCH_DAY01, 'B102', { value: '0102', policy: 'request_review' });
    expect(next).not.toBe(s);
    expect(s.batches).toEqual({});
    expect(batchOf(next, BATCH_DAY01).drafts['B102']).toEqual({ value: '0102', policy: 'request_review' });
    expect(batchOf(next, BATCH_DAY01).archived).toEqual({});
    expect(validSave(next)).toBeTrue();
  });

  it('覆寫同 key 草稿、保留其他 key', () => {
    const s = setDraft(setDraft(createSave(1, DIR), BATCH_DAY01, 'H17', { value: '林' }), BATCH_DAY01, 'B102', { value: '01' });
    const next = setDraft(s, BATCH_DAY01, 'B102', { value: '0102' });
    expect(batchOf(next, BATCH_DAY01).drafts).toEqual({ H17: { value: '林' }, B102: { value: '0102' } });
  });

  it('不影響已歸檔內容', () => {
    const s = commitArchive(createSave(1, DIR), BATCH_DAY01, record('B607'), okFor('B607', { value: '0607' }));
    const next = setDraft(s, BATCH_DAY01, 'H17', { value: 'H-1' });
    expect(batchOf(next, BATCH_DAY01).archived).toEqual(batchOf(s, BATCH_DAY01).archived);
  });
});

describe('commitArchive', () => {
  const base = createSave(42, DIR);
  const ok = okFor('B102', { value: '0102', policy: 'default_false' });
  const committed = commitArchive(base, BATCH_DAY01, record('B102'), ok);

  it('成功寫入並推一個 archive 事件（含批次）；dayId／stage／taskId 不變', () => {
    expect(committed).not.toBe(base);
    expect(base.batches).toEqual({});
    expect(archivedIn(committed, 'B102')).toEqual({ archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapshotOf(record('B102')) });
    expect(committed.events).toEqual([{ id: 'archive:0', kind: 'archive', payload: { key: 'B102', origin: 'defaulted', batchId: BATCH_DAY01 } }]);
    expect(committed.dayId).toBe(DAY_01);
    expect(committed.stage).toBe('work');
    expect(committed.taskId).toBe(TASK_DAY1);
  });

  it('重複 commit 同 key 回傳同一物件（不重複、不覆寫）', () => {
    const again = commitArchive(committed, BATCH_DAY01, record('B102'), okFor('B102', { value: '0102', policy: 'request_review' }));
    expect(again).toBe(committed);
    expect(archivedIn(again, 'B102').refusal).toBeFalse();
    expect(again.events.length).toBe(1);
  });

  it('同一 key 在不同批次各自獨立，不會被「已提交」擋下', () => {
    const other = commitArchive(committed, BATCH_DAY03, record('B102'), ok);
    expect(other).not.toBe(committed);
    expect(archivedCount(other, BATCH_DAY01)).toBe(1);
    expect(archivedCount(other, BATCH_DAY03)).toBe(1);
  });

  it('stage 非 work 時忽略（wrap／end）', () => {
    const wrap = playToWrap(1, 'default_false');
    expect(commitArchive(wrap, BATCH_DAY03, record('H17'), okFor('H17', { value: 'H-17' }))).toBe(wrap);
    const end = playFull(1, 'default_false', 'ack');
    expect(commitArchive(end, BATCH_DAY03, record('H17'), okFor('H17', { value: 'H-17' }))).toBe(end);
  });

  it('review 結果寫入 refusal null／origin review，快照仍記錄來源的 null', () => {
    const held = commitArchive(base, BATCH_DAY01, record('B102'), okFor('B102', { value: '0102', policy: 'request_review' }));
    expect(archivedIn(held, 'B102')).toEqual({ archiveCode: '0102', refusal: null, origin: 'review', source: snapshotOf(record('B102')) });
    expect(held.events[0].payload).toEqual({ key: 'B102', origin: 'review', batchId: BATCH_DAY01 });
  });
});

describe('completeWork', () => {
  it('歸檔批次未齊回傳原物件', () => {
    const s0 = createSave(1, DIR);
    expect(completeWork(s0, DIR)).toBe(s0);
    const s2 = archiveOne(archiveOne(s0, 'H17', { value: 'H-17' }), 'B607', { value: '0607' });
    expect(completeWork(s2, DIR)).toBe(s2);
  });

  it('齊了且有下一天 → stage wrap、dayId 不變，依序推 task.complete（dayId／taskId）與 day.complete（dayId）', () => {
    const s = archiveAll(createSave(1, DIR), 'request_review');
    const next = completeWork(s, DIR);
    expect(next).not.toBe(s);
    expect(s.stage).toBe('work');
    expect(next.stage).toBe('wrap');
    expect(next.dayId).toBe(DAY_01);
    expect(next.taskId).toBe(TASK_DAY1);
    expect(next.events.slice(3)).toEqual([
      { id: 'task.complete:3', kind: 'task.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } },
      { id: 'day.complete:4', kind: 'day.complete', payload: { dayId: DAY_01 } },
    ]);
    expect(next.night).toBeUndefined();
    expect(validSave(next)).toBeTrue();
  });

  it('只看目前工作的批次：另一個批次已完成不算數', () => {
    const s = putArchived(createSave(1, DIR), { ...archivedAll }, BATCH_DAY03);
    expect(allArchived(s, BATCH_DAY03, DAY1_RECORDS)).toBeTrue();
    expect(completeWork(s, DIR)).toBe(s);
  });

  it('欄位映射：未提交（含已預覽）回傳原物件；提交後最後一天 → end、推 day.complete', () => {
    const s0 = createSave(1, DIR_FM);
    expect(completeWork(s0, DIR_FM)).toBe(s0);
    const previewed = previewFieldMap(setFieldBlankPolicy(mapAll(s0, DIR_FM), DIR_FM, 'default_false'), DIR_FM);
    expect(fieldMapProgressOf(previewed, TASK_DAY6).previewed).toBeTrue();
    expect(completeWork(previewed, DIR_FM)).toBe(previewed);

    const submitted = submitFieldMap(previewed, DIR_FM);
    const end = completeWork(submitted, DIR_FM);
    expect(end.stage).toBe('end');
    expect(end.dayId).toBe(DAY_06);
    expect(end.events[end.events.length - 1]).toEqual({
      id: `day.complete:${end.events.length - 1}`,
      kind: 'day.complete',
      payload: { dayId: DAY_06 },
    });
    expect(end.events[end.events.length - 2]).toEqual({
      id: `task.complete:${end.events.length - 2}`,
      kind: 'task.complete',
      payload: { dayId: DAY_06, taskId: TASK_DAY6 },
    });
    expect(validSave(end, DIR_FM)).toBeTrue();
  });

  it('欄位映射日若還有下一天 → wrap（由目錄決定，不寫死 end）', () => {
    const dir = createDayDirectory(
      [
        { dayId: DAY_06, dayNumber: 6, nextDayId: 'day.07', tasks: [FIELD_MAP_TASK] },
        { dayId: 'day.07', dayNumber: 7, nextDayId: null, tasks: [{ id: 'task.day7.archive', kind: 'archive', batchId: 'batch.day07', recordKeys: [], caseReviews: [] }] },
      ],
      {},
    );
    const wrap = completeWork(submitMapping(createSave(1, dir), dir, 'request_review'), dir);
    expect(wrap.stage).toBe('wrap');
    expect(validSave(wrap, dir)).toBeTrue();
    const day7 = advanceDay(wrap, dir);
    expect([day7.dayId, day7.stage]).toEqual(['day.07', 'morning']);
    expect(startDay(day7).stage).toBe('work');
  });

  it('stage 非 work 時忽略', () => {
    const wrap = playToWrap(1, 'default_false');
    expect(completeWork(wrap, DIR)).toBe(wrap);
    const end = playFull(1, 'default_false', 'ack');
    expect(completeWork(end, DIR)).toBe(end);
  });
});

describe('isTaskDone', () => {
  it('歸檔＝批次全完成；核對＝已回覆；欄位映射＝已提交（不看 stage）', () => {
    const t1 = DIR6.plan(DAY_01)!.tasks[0]!;
    const t2 = DIR6.plan(DAY_02)!.tasks[0]!;
    const t6 = DIR6.plan(DAY_06)!.tasks[0]!;
    const s0 = createSave(1, DIR6);
    expect(isTaskDone(s0, DIR6, t1)).toBeFalse();
    expect(isTaskDone(s0, DIR6, t2)).toBeFalse();
    expect(isTaskDone(s0, DIR6, t6)).toBeFalse();
    expect(isTaskDone(archiveAll(s0, 'default_false'), DIR6, t1)).toBeTrue();
    const day2Done = playFull(1, 'default_false', 'ask', DIR6);
    expect(isTaskDone(day2Done, DIR6, t2)).toBeTrue();
    const day6 = playSixTo(DAY_06);
    expect(isTaskDone(day6, DIR6, t6)).toBeFalse();
    expect(isTaskDone(submitMapping(day6, DIR6, 'default_false'), DIR6, t6)).toBeTrue();
  });
});

describe('advanceDay', () => {
  it('從 wrap → 下一天次日收件（morning）、dayId 轉為 day.02，並寫入 night 與 night.resolved 事件', () => {
    const wrap = playToWrap(SEED_INTERVENE, 'default_false');
    const day2 = advanceDay(wrap, DIR);
    expect(day2).not.toBe(wrap);
    expect(wrap.night).toBeUndefined();
    expect(day2.stage).toBe('morning');
    expect(day2.dayId).toBe(DAY_02);
    expect(day2.taskId).toBe(TASK_DAY2);
    expect(day2.night).toEqual(resolveNight(SEED_INTERVENE));
    expect(day2.events.length).toBe(wrap.events.length + 1);
    const last = day2.events[day2.events.length - 1];
    expect(last.kind).toBe('night.resolved');
    expect(last.payload).toEqual(resolveNight(SEED_INTERVENE));
    expect(validSave(day2)).toBeTrue();
  });

  it('跨日不動 taskProgress：Day 2 的回覆在 Day 3 之後仍保留', () => {
    const wrap2 = playFull(1, 'default_false', 'review', DIR6);
    const day3 = advanceDay(wrap2, DIR6);
    expect(day3.taskProgress).toBe(wrap2.taskProgress);
    expect(reconcileProgressOf(day3, TASK_DAY2)).toEqual({
      kind: 'reconcile',
      reportOpened: true,
      receiptOpened: true,
      reviews: { B102: day1Review('B102') },
      reply: 'review',
      reportRevision: resolveNight(1).reportRevision,
    });
  });

  it('stage 非 wrap 時忽略', () => {
    const day1 = createSave(1, DIR);
    expect(advanceDay(day1, DIR)).toBe(day1);
    const day2 = playToDay2(1, 'default_false');
    expect(advanceDay(day2, DIR)).toBe(day2);
    const end = playFull(1, 'default_false', 'ack');
    expect(advanceDay(end, DIR)).toBe(end);
    const morning = advanceDay(playToWrap(1, 'default_false'), DIR);
    expect(morning.stage).toBe('morning');
    expect(advanceDay(morning, DIR)).toBe(morning);
  });
});

/* ---------- 核對工作（taskProgress） ---------- */

describe('markReportOpened／markReceiptOpened', () => {
  const day2 = playToDay2(1, 'default_false', DIR6);

  it('寫進 taskProgress[核對工作]，不改原物件；存檔沒有全域 evidence', () => {
    expect(day2.taskProgress).toEqual({});
    const r = markReportOpened(day2, DIR6);
    expect(day2.taskProgress).toEqual({});
    expect(r.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } });
    const rr = markReceiptOpened(r, DIR6);
    expect(rr.taskProgress[TASK_DAY2]).toEqual({ kind: 'reconcile', reportOpened: true, receiptOpened: true });
    expect(reconcileProgressOf(r, TASK_DAY2).receiptOpened).toBeFalse();
    expect('evidence' in (rr as unknown as Record<string, unknown>)).toBeFalse();
    expect(validSave(rr, DIR6)).toBeTrue();
  });

  it('只開副本也可以（順序不限）', () => {
    const r = markReceiptOpened(day2, DIR6);
    expect(r.taskProgress[TASK_DAY2]).toEqual({ kind: 'reconcile', reportOpened: false, receiptOpened: true });
  });

  it('已 true 時回傳原物件', () => {
    const r = markReportOpened(day2, DIR6);
    expect(markReportOpened(r, DIR6)).toBe(r);
    const rr = markReceiptOpened(r, DIR6);
    expect(markReceiptOpened(rr, DIR6)).toBe(rr);
  });

  it('不是核對日或不在 work 階段 → 回傳原物件，不寫任何進度', () => {
    const day1 = createSave(1, DIR6);
    expect(markReportOpened(day1, DIR6)).toBe(day1);
    expect(markReceiptOpened(day1, DIR6)).toBe(day1);
    const wrap1 = playToWrap(1, 'default_false', DIR6);
    expect(markReportOpened(wrap1, DIR6)).toBe(wrap1);
    const wrap2 = playFull(1, 'default_false', 'ack', DIR6);
    expect(markReportOpened({ ...wrap2 }, DIR6).taskProgress).toBe(wrap2.taskProgress);
    const day6 = playSixTo(DAY_06);
    expect(markReportOpened(day6, DIR6)).toBe(day6);
  });

  it('reconcileProgressOf 對沒有進度或 kind 不符的 taskId 回傳預設值', () => {
    expect(reconcileProgressOf(day2, TASK_DAY2)).toEqual({ kind: 'reconcile', reportOpened: false, receiptOpened: false });
    const fm = setFieldAssignment(createSave(1, DIR_FM), DIR_FM, 'personnel-code', 'legacy-id');
    expect(reconcileProgressOf(fm, TASK_DAY6)).toEqual({ kind: 'reconcile', reportOpened: false, receiptOpened: false });
  });
});

describe('canReply／submitReply', () => {
  const day2 = playToDay2(SEED_INTERVENE, 'request_review', DIR6);
  /** R10：回覆前必須先完成逐筆審查。 */
  const reviewed = reviewAll(day2, DIR6);

  it('未開摘要 → 三種皆 false（即使已審查）', () => {
    for (const reply of REPLIES) expect(canReply(day2, DIR6, reply)).toBeFalse();
    for (const reply of REPLIES) expect(canReply(reviewed, DIR6, reply)).toBeFalse();
  });

  it('開摘要未開副本 → ack／ask true、review false', () => {
    const s = markReportOpened(reviewed, DIR6);
    expect(canReply(s, DIR6, 'ack')).toBeTrue();
    expect(canReply(s, DIR6, 'ask')).toBeTrue();
    expect(canReply(s, DIR6, 'review')).toBeFalse();
  });

  it('只開副本未開摘要 → 三種皆 false', () => {
    const s = markReceiptOpened(reviewed, DIR6);
    for (const reply of REPLIES) expect(canReply(s, DIR6, reply)).toBeFalse();
  });

  it('皆開 → 三者 true', () => {
    const s = markReceiptOpened(markReportOpened(reviewed, DIR6), DIR6);
    for (const reply of REPLIES) expect(canReply(s, DIR6, reply)).toBeTrue();
  });

  it('R10：皆開但尚未逐筆審查 → 三種皆 false，submit 回傳原物件（確認收件不等於放行）', () => {
    const s = markReceiptOpened(markReportOpened(day2, DIR6), DIR6);
    for (const reply of REPLIES) {
      expect(canReply(s, DIR6, reply)).toBeFalse();
      expect(submitReply(s, DIR6, reply)).toBe(s);
    }
  });

  it('submit（有下一天）→ stage wrap、reply／reviews／reportRevision 寫入 taskProgress、推 reply.submit 事件；再 submit 回傳原物件', () => {
    const ready = markReceiptOpened(markReportOpened(reviewed, DIR6), DIR6);
    const wrap = submitReply(ready, DIR6, 'review');
    expect(wrap).not.toBe(ready);
    expect(ready.stage).toBe('work');
    expect(reconcileProgressOf(ready, TASK_DAY2).reply).toBeUndefined();
    expect(wrap.stage).toBe('wrap');
    expect(wrap.dayId).toBe(DAY_02);
    expect(wrap.taskProgress[TASK_DAY2]).toEqual({
      kind: 'reconcile',
      reportOpened: true,
      receiptOpened: true,
      reviews: { B102: day1Review('B102') },
      reply: 'review',
      reportRevision: resolveNight(SEED_INTERVENE).reportRevision,
    });
    expect('reply' in (wrap as unknown as Record<string, unknown>)).toBeFalse();
    expect(wrap.events.length).toBe(ready.events.length + 3);
    expect(wrap.events.slice(-3).map((e) => e.kind)).toEqual(['reply.submit', 'task.complete', 'day.complete']);
    expect(wrap.events[wrap.events.length - 3].payload).toEqual({ taskId: TASK_DAY2, choice: 'review' });
    expect(validSave(wrap, DIR6)).toBeTrue();

    expect(submitReply(wrap, DIR6, 'ack')).toBe(wrap);
    for (const reply of REPLIES) expect(canReply(wrap, DIR6, reply)).toBeFalse();
    // 即使手造回 work，已回覆也不能再回覆
    const reopened: Save = { ...wrap, stage: 'work' };
    for (const reply of REPLIES) expect(canReply(reopened, DIR6, reply)).toBeFalse();
    expect(submitReply(reopened, DIR6, 'ack')).toBe(reopened);
  });

  it('submit 保存當時的摘要版本：有 night → night.reportRevision；沒有 night（手造）→ null', () => {
    for (const seed of [SEED_INTERVENE, SEED_NO_INTERVENE]) {
      const done = playFull(seed, 'default_false', 'ack', DIR6);
      expect(reconcileProgressOf(done, TASK_DAY2).reportRevision).withContext(`seed ${seed}`).toBe(resolveNight(seed).reportRevision);
    }
    const noNight: Save = { ...markReportOpened(reviewed, DIR6) };
    delete noNight.night;
    const done = submitReply(noNight, DIR6, 'ack');
    expect(reconcileProgressOf(done, TASK_DAY2).reply).toBe('ack');
    expect(reconcileProgressOf(done, TASK_DAY2).reportRevision).toBeNull();
  });

  it('submit（最後一天）→ stage end', () => {
    const ready = markReportOpened(reviewAll(playToDay2(SEED_INTERVENE, 'request_review', DIR), DIR), DIR);
    const end = submitReply(ready, DIR, 'ask');
    expect(end.stage).toBe('end');
    expect(reconcileProgressOf(end, TASK_DAY2).reply).toBe('ask');
    expect(validSave(end, DIR)).toBeTrue();
  });

  it('不符條件的 submit 回傳原物件', () => {
    expect(submitReply(day2, DIR6, 'ack')).toBe(day2);
    const reportOnly = markReportOpened(reviewed, DIR6);
    expect(submitReply(reportOnly, DIR6, 'review')).toBe(reportOnly);
    expect(submitReply(reportOnly, DIR6, 'ask').stage).toBe('wrap');
  });

  it('不是核對工作（歸檔日 work／wrap、欄位映射日）→ false', () => {
    const day1 = createSave(1, DIR6);
    const wrap = playToWrap(1, 'default_false', DIR6);
    const day6 = playSixTo(DAY_06);
    for (const reply of REPLIES) {
      for (const s of [day1, wrap, day6]) {
        expect(canReply(s, DIR6, reply)).toBeFalse();
        expect(submitReply(s, DIR6, reply)).toBe(s);
      }
    }
  });

  it('三種回覆各自留下不同事件與 reply', () => {
    for (const reply of REPLIES) {
      const done = playFull(1, 'default_false', reply, DIR6);
      expect(reconcileProgressOf(done, TASK_DAY2).reply).toBe(reply);
      expect(done.events.filter((e) => e.kind === 'reply.submit').map((e) => e.payload)).toEqual([{ taskId: TASK_DAY2, choice: reply }]);
    }
  });

  it('進度以 taskId 為鍵：兩個核對日各自獨立，前一日的已開文件、審查與回覆不帶到下一日', () => {
    const TASK_B = 'task.day3.reconcile';
    const dir = createDayDirectory(
      [
        day1Plan(DAY1_RECORDS),
        reconcilePlan(DAY_03),
        { dayId: DAY_03, dayNumber: 3, nextDayId: null, tasks: [{ id: TASK_B, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey: 'H17', recordKeys: ['H17'] }] },
      ],
      { [BATCH_DAY01]: DAY1_RECORDS },
    );
    const day3 = toNextDay(playFull(SEED_NO_INTERVENE, 'default_false', 'review', dir), dir);
    expect(day3.dayId).toBe(DAY_03);
    expect(validSave(day3, dir)).toBeTrue();
    for (const reply of REPLIES) expect(canReply(day3, dir, reply)).toBeFalse();
    // Day 3 的對象 H17（refusal null）＋無介入 → 未安排；Day 2 的 B102（false）不影響
    expect(isArrangedInSave(day3, dir)).toBeFalse();

    const end = submitReply(reviewAll(markReportOpened(day3, dir), dir, 'release'), dir, 'ack');
    expect(end.stage).toBe('end');
    expect(end.taskProgress).toEqual({
      [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reviews: { B102: day1Review('B102') }, reply: 'review', reportRevision: 1 },
      [TASK_B]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reviews: { H17: day1Review('H17', 'release') }, reply: 'ack', reportRevision: 1 },
    });
    expect(validSave(end, dir)).toBeTrue();
  });
});

/* ---------- 欄位映射工作（Day 6） ---------- */

describe('欄位映射：setFieldAssignment／setFieldBlankPolicy', () => {
  const s0 = createSave(1, DIR_FM);

  it('fieldMapProgressOf 在沒有進度時回傳空對應、未預覽', () => {
    expect(fieldMapProgressOf(s0, TASK_DAY6)).toEqual({ kind: 'field-map', assignments: {}, previewed: false });
  });

  it('設定對應寫進 taskProgress[欄位映射工作]，不改原物件', () => {
    const s1 = setFieldAssignment(s0, DIR_FM, 'personnel-code', 'legacy-id');
    expect(s0.taskProgress).toEqual({});
    expect(s1.taskProgress[TASK_DAY6]).toEqual({ kind: 'field-map', assignments: { 'personnel-code': 'legacy-id' }, previewed: false });
    expect(validSave(s1, DIR_FM)).toBeTrue();
  });

  it('未知 target 或未知 source → 回傳原物件', () => {
    expect(setFieldAssignment(s0, DIR_FM, 'nope', 'legacy-id')).toBe(s0);
    expect(setFieldAssignment(s0, DIR_FM, 'personnel-code', 'nope')).toBe(s0);
    // 來源 id 不能拿目標 id 冒充
    expect(setFieldAssignment(s0, DIR_FM, 'personnel-code', 'exclude-flag')).toBe(s0);
  });

  it('空字串清除該目標的對應', () => {
    const s1 = mapAll(s0, DIR_FM);
    expect(fieldMapProgressOf(s1, TASK_DAY6).assignments).toEqual(CORRECT);
    const s2 = setFieldAssignment(s1, DIR_FM, 'exclude-flag', '');
    const a = fieldMapProgressOf(s2, TASK_DAY6).assignments;
    expect('exclude-flag' in a).toBeFalse();
    expect(Object.keys(a).sort()).toEqual(['contact-status', 'effective-date', 'personnel-code']);
  });

  it('暫時重複的來源允許存在於進度中（由檢查回報 duplicate），但 schema 會拒絕重複', () => {
    const dup = setFieldAssignment(setFieldAssignment(s0, DIR_FM, 'personnel-code', 'legacy-id'), DIR_FM, 'contact-status', 'legacy-id');
    expect(fieldMapCheck(dup, DIR_FM)).toEqual({ ok: false, error: 'incomplete' });
    expect(fieldMapProgressOf(dup, TASK_DAY6).assignments).toEqual({ 'personnel-code': 'legacy-id', 'contact-status': 'legacy-id' });
    expect(validSave(dup, DIR_FM)).toBeFalse();
  });

  it('任何對應改動都會清除 previewed', () => {
    const previewed = previewFieldMap(setFieldBlankPolicy(mapAll(s0, DIR_FM), DIR_FM, 'default_false'), DIR_FM);
    expect(fieldMapProgressOf(previewed, TASK_DAY6).previewed).toBeTrue();
    const same = setFieldAssignment(previewed, DIR_FM, 'personnel-code', 'legacy-id');
    expect(fieldMapProgressOf(same, TASK_DAY6).previewed).toBeFalse();
    const cleared = setFieldAssignment(previewed, DIR_FM, 'personnel-code', '');
    expect(fieldMapProgressOf(cleared, TASK_DAY6).previewed).toBeFalse();
  });

  it('設定政策寫入 blankPolicy 並清除 previewed；同一政策回傳原物件', () => {
    const base = previewFieldMap(setFieldBlankPolicy(mapAll(s0, DIR_FM), DIR_FM, 'default_false'), DIR_FM);
    expect(setFieldBlankPolicy(base, DIR_FM, 'default_false')).toBe(base);
    const switched = setFieldBlankPolicy(base, DIR_FM, 'request_review');
    expect(fieldMapProgressOf(switched, TASK_DAY6).blankPolicy).toBe('request_review');
    expect(fieldMapProgressOf(switched, TASK_DAY6).previewed).toBeFalse();
  });

  it('不是欄位映射日或不在 work 階段 → 回傳原物件', () => {
    const day1 = createSave(1, DIR6);
    expect(setFieldAssignment(day1, DIR6, 'personnel-code', 'legacy-id')).toBe(day1);
    expect(setFieldBlankPolicy(day1, DIR6, 'default_false')).toBe(day1);
    expect(previewFieldMap(day1, DIR6)).toBe(day1);
    expect(submitFieldMap(day1, DIR6)).toBe(day1);
    const day2 = playToDay2(1, 'default_false', DIR6);
    expect(setFieldAssignment(day2, DIR6, 'personnel-code', 'legacy-id')).toBe(day2);
    const end = completeWork(submitMapping(s0, DIR_FM, 'default_false'), DIR_FM);
    expect(end.stage).toBe('end');
    expect(setFieldAssignment(end, DIR_FM, 'personnel-code', '')).toBe(end);
  });
});

describe('欄位映射：fieldMapCheck／previewFieldMap', () => {
  const s0 = createSave(1, DIR_FM);

  it('fieldMapCheck 不是欄位映射日回傳 null', () => {
    expect(fieldMapCheck(createSave(1, DIR6), DIR6)).toBeNull();
    expect(fieldMapCheck(playToDay2(1, 'default_false', DIR6), DIR6)).toBeNull();
  });

  it('fieldMapCheck 反映目前對應與政策，錯誤順序 incomplete → duplicate → unconvertible → policyRequired（R10 無 mismatch）', () => {
    expect(fieldMapCheck(s0, DIR_FM)).toEqual({ ok: false, error: 'incomplete' });
    const dup = mapAll(s0, DIR_FM, { ...CORRECT, 'contact-status': 'legacy-id' });
    expect(fieldMapCheck(dup, DIR_FM)).toEqual({ ok: false, error: 'duplicate' });
    const bad = mapAll(s0, DIR_FM, { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' });
    expect(fieldMapCheck(bad, DIR_FM)).toEqual({ ok: false, error: 'unconvertible' });
    // 文字欄位間配錯不是錯誤：只差政策
    const swapped = mapAll(s0, DIR_FM, { ...CORRECT, 'contact-status': 'record-date', 'effective-date': 'contact-result' });
    expect(fieldMapCheck(swapped, DIR_FM)).toEqual({ ok: false, error: 'policyRequired' });
    expect(fieldMapCheck(mapAll(s0, DIR_FM), DIR_FM)).toEqual({ ok: false, error: 'policyRequired' });
    const ok = fieldMapCheck(setFieldBlankPolicy(mapAll(s0, DIR_FM), DIR_FM, 'default_false'), DIR_FM);
    expect(ok).toEqual(checkFieldMap(FIELD_MAP_TASK, CORRECT, 'default_false'));
  });

  it('檢查不寫存檔', () => {
    const s = mapAll(s0, DIR_FM);
    const before = JSON.stringify(s);
    fieldMapCheck(s, DIR_FM);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('previewFieldMap 只有檢查通過時才標記 previewed；錯誤不改存檔', () => {
    expect(previewFieldMap(s0, DIR_FM)).toBe(s0);
    const dup = mapAll(s0, DIR_FM, { ...CORRECT, 'contact-status': 'legacy-id' });
    expect(previewFieldMap(dup, DIR_FM)).toBe(dup);
    const bad = mapAll(s0, DIR_FM, { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' });
    const badWithPolicy = setFieldBlankPolicy(bad, DIR_FM, 'default_false');
    expect(previewFieldMap(badWithPolicy, DIR_FM)).toBe(badWithPolicy);
    // R10：文字欄位間配錯可以預覽
    const swapped = setFieldBlankPolicy(
      mapAll(s0, DIR_FM, { ...CORRECT, 'contact-status': 'record-date', 'effective-date': 'contact-result' }),
      DIR_FM,
      'default_false',
    );
    expect(fieldMapProgressOf(previewFieldMap(swapped, DIR_FM), TASK_DAY6).previewed).toBeTrue();
    const noPolicy = mapAll(s0, DIR_FM);
    expect(previewFieldMap(noPolicy, DIR_FM)).toBe(noPolicy);

    const ready = setFieldBlankPolicy(noPolicy, DIR_FM, 'request_review');
    const previewed = previewFieldMap(ready, DIR_FM);
    expect(fieldMapProgressOf(ready, TASK_DAY6).previewed).toBeFalse();
    expect(fieldMapProgressOf(previewed, TASK_DAY6).previewed).toBeTrue();
    expect(previewed.events).toEqual(ready.events);
    expect(previewFieldMap(previewed, DIR_FM)).toBe(previewed);
    expect(validSave(previewed, DIR_FM)).toBeTrue();
  });
});

describe('欄位映射：submitFieldMap', () => {
  const s0 = createSave(1, DIR_FM);
  const ready = setFieldBlankPolicy(mapAll(s0, DIR_FM), DIR_FM, 'default_false');

  it('未預覽不能提交；預覽後改了對應也不能提交', () => {
    expect(submitFieldMap(ready, DIR_FM)).toBe(ready);
    const changed = setFieldAssignment(previewFieldMap(ready, DIR_FM), DIR_FM, 'contact-status', 'contact-result');
    expect(submitFieldMap(changed, DIR_FM)).toBe(changed);
  });

  it('R10：文字欄位互換（聯絡結果 ↔ 紀錄日期）可以預覽、提交，提交快照與存檔反映玩家的對應', () => {
    const swap = { ...CORRECT, 'contact-status': 'record-date', 'effective-date': 'contact-result' };
    const done = submitFieldMap(previewFieldMap(setFieldBlankPolicy(mapAll(s0, DIR_FM, swap), DIR_FM, 'request_review'), DIR_FM), DIR_FM);
    const sub = fieldMapProgressOf(done, TASK_DAY6).submitted!;
    expect(sub).toBeDefined();
    expect(sub.rows[0]!.values).toEqual({ 'personnel-code': '0102', 'exclude-flag': null, 'contact-status': '2026-09-16', 'effective-date': '未接' });
    expect(sub.affectedCount).toBe(4);
    expect(fieldMapCheck(done, DIR_FM)).toEqual({ ok: true, result: sub });
    const end = completeWork(done, DIR_FM);
    expect(end.stage).toBe('end');
    const restored = JSON.parse(JSON.stringify(end)) as Save;
    expect(validSave(restored, DIR_FM)).toBeTrue();
    expect(fieldMapProgressOf(restored, TASK_DAY6).submitted!.rows[0]!.values['contact-status']).toBe('2026-09-16');
  });

  it('R10：布林目標配到含「未接」的文字來源 → 無法預覽也無法提交（不靜默當 null）', () => {
    const bad = setFieldBlankPolicy(mapAll(s0, DIR_FM, { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' }), DIR_FM, 'default_false');
    expect(fieldMapCheck(bad, DIR_FM)).toEqual({ ok: false, error: 'unconvertible' });
    expect(previewFieldMap(bad, DIR_FM)).toBe(bad);
    const forced: Save = { ...bad, taskProgress: { [TASK_DAY6]: { ...fieldMapProgressOf(bad, TASK_DAY6), previewed: true } } };
    expect(submitFieldMap(forced, DIR_FM)).toBe(forced);
  });

  it('提交鎖定快照、寫 field-map.submit 事件；stage 仍為 work，由 completeWork 結束當日', () => {
    const previewed = previewFieldMap(ready, DIR_FM);
    const done = submitFieldMap(previewed, DIR_FM);
    const progress = fieldMapProgressOf(done, TASK_DAY6);
    const expected = checkFieldMap(FIELD_MAP_TASK, CORRECT, 'default_false');
    expect(expected.ok).toBeTrue();
    if (!expected.ok) return;
    expect(progress.submitted).toEqual(expected.result);
    expect(progress.assignments).toEqual(CORRECT);
    expect(progress.blankPolicy).toBe('default_false');
    expect(progress.previewed).toBeTrue();
    expect(done.stage).toBe('work');
    expect(done.events.length).toBe(previewed.events.length + 1);
    expect(done.events[done.events.length - 1]).toEqual({
      id: `field-map.submit:${done.events.length - 1}`,
      kind: 'field-map.submit',
      payload: { taskId: TASK_DAY6, blankPolicy: 'default_false', rowCount: 8, affectedCount: 4 },
    });
    expect(validSave(done, DIR_FM)).toBeTrue();
  });

  it('提交後鎖定：setFieldAssignment／setFieldBlankPolicy／previewFieldMap／submitFieldMap 皆回傳原物件', () => {
    const done = submitMapping(s0, DIR_FM, 'request_review');
    expect(setFieldAssignment(done, DIR_FM, 'personnel-code', '')).toBe(done);
    expect(setFieldAssignment(done, DIR_FM, 'contact-status', 'record-date')).toBe(done);
    expect(setFieldBlankPolicy(done, DIR_FM, 'default_false')).toBe(done);
    expect(previewFieldMap(done, DIR_FM)).toBe(done);
    expect(submitFieldMap(done, DIR_FM)).toBe(done);
    expect(done.events.filter((e) => e.kind === 'field-map.submit').length).toBe(1);
  });

  it('提交後 fieldMapCheck 回傳提交快照（不重新計算）', () => {
    const done = submitMapping(s0, DIR_FM, 'request_review');
    const check = fieldMapCheck(done, DIR_FM);
    expect(check).toEqual({ ok: true, result: fieldMapProgressOf(done, TASK_DAY6).submitted! });
    expect(check!.ok && check!.result).toBe(fieldMapProgressOf(done, TASK_DAY6).submitted!);
  });

  for (const policy of MISSING_POLICIES) {
    it(`政策 ${policy}：8 列、4 列受影響；空值 ${policy === 'default_false' ? '→ false' : '→ null'}，有／無 → true／false，0102 保留前導零`, () => {
      const done = submitMapping(s0, DIR_FM, policy);
      const sub = fieldMapProgressOf(done, TASK_DAY6).submitted!;
      expect(sub.rowCount).toBe(8);
      expect(sub.affectedCount).toBe(4);
      expect(sub.blankPolicy).toBe(policy);
      expect(sub.rows.map((r) => r.id)).toEqual(FIELD_MAP_TASK.rows.map((r) => r.id));
      const byId = new Map(sub.rows.map((r) => [r.id, r.values] as const));
      for (const id of BLANK_ROWS) expect(byId.get(id)!['exclude-flag']).toBe(policy === 'default_false' ? false : null);
      expect(byId.get('row.0716')!['exclude-flag']).toBeTrue();
      expect(byId.get('row.0314')!['exclude-flag']).toBeFalse();
      expect(byId.get('row.0102')!).toEqual({
        'personnel-code': '0102',
        'exclude-flag': policy === 'default_false' ? false : null,
        'contact-status': '未接',
        'effective-date': '2026-09-16',
      });
      expect(typeof byId.get('row.0102')!['personnel-code']).toBe('string');
    });
  }

  it('JSON 往返保留對應、政策、預覽與提交結果（含 null 與 "0102"），且通過 schema', () => {
    for (const policy of MISSING_POLICIES) {
      const done = completeWork(submitMapping(s0, DIR_FM, policy), DIR_FM);
      const restored = JSON.parse(JSON.stringify(done)) as Save;
      expect(restored).toEqual(done);
      const p = fieldMapProgressOf(restored, TASK_DAY6);
      expect(p.assignments).toEqual(CORRECT);
      expect(p.blankPolicy).toBe(policy);
      expect(p.previewed).toBeTrue();
      expect(p.submitted!.rows[0].values['personnel-code']).toBe('0102');
      expect(p.submitted!.rows[0].values['exclude-flag']).toBe(policy === 'default_false' ? false : null);
      expect(validSave(restored, DIR_FM)).toBeTrue();
    }
  });

  it('六天流程中的 Day 6：提交快照不受前面各日影響，完成後 end 通過 schema', () => {
    const day6 = playSixTo(DAY_06);
    const end = completeWork(submitMapping(day6, DIR6, 'request_review'), DIR6);
    expect(end.stage).toBe('end');
    expect(fieldMapProgressOf(end, TASK_DAY6).submitted!.affectedCount).toBe(4);
    expect(Object.keys(end.taskProgress).sort()).toEqual([TASK_DAY2, TASK_DAY6]);
    expect(validSave(end, DIR6)).toBeTrue();
  });
});

/* ---------- 訊息固定回覆（R7） ---------- */

describe('訊息固定回覆：answerChat／skipChat／chatChoiceOf／chatReplyOf', () => {
  const PROMPT = 'prompt.test.lunch';
  const PROMPT_B = 'prompt.test.other';
  const RETIRED = 'prompt.retired.not-in-content';

  /** 測試自建的選項（不依賴正式內容）。 */
  function choice(id = 'join'): ChatChoiceInput {
    return {
      id,
      text: `玩家選項 ${id}`,
      responses: [
        { id: `msg.test.${id}.1`, actorId: 'actor.test.a', time: '12:01', lines: ['第一行', '第二行'] },
        { id: `msg.test.${id}.2`, actorId: 'actor.test.b', time: '12:03', lines: ['回應'] },
      ],
    };
  }

  it('新存檔：chatReplies 為空、chatReplyOf undefined、chatChoiceOf null', () => {
    const s = createSave(1, DIR);
    expect(s.chatReplies).toEqual({});
    expect(chatReplyOf(s, PROMPT)).toBeUndefined();
    expect(chatChoiceOf(s, PROMPT)).toBeNull();
  });

  it('answerChat 保存 answered＋choiceId＋playerText＋回應快照', () => {
    const s0 = createSave(1, DIR);
    const s1 = answerChat(s0, PROMPT, choice('join'));
    expect(s1).not.toBe(s0);
    expect(s1.chatReplies).toEqual({
      [PROMPT]: {
        kind: 'answered',
        choiceId: 'join',
        playerText: '玩家選項 join',
        responses: [
          { id: 'msg.test.join.1', actorId: 'actor.test.a', time: '12:01', lines: ['第一行', '第二行'] },
          { id: 'msg.test.join.2', actorId: 'actor.test.b', time: '12:03', lines: ['回應'] },
        ],
      },
    });
    expect(chatReplyOf(s1, PROMPT)).toBe(s1.chatReplies[PROMPT]!);
    expect(chatChoiceOf(s1, PROMPT)).toBe('join');
    expect(chatChoiceOf(s1, PROMPT_B)).toBeNull();
  });

  it('answerChat 寫事件 chat.reply，payload 只有 promptId、choiceId', () => {
    const s0 = archiveOne(createSave(1, DIR), 'B102', { value: '0102', policy: 'default_false' });
    const s1 = answerChat(s0, PROMPT, choice('join'));
    expect(s1.events.length).toBe(s0.events.length + 1);
    const e = s1.events[s1.events.length - 1];
    expect(e.kind).toBe(EVENT_KINDS.chatReply);
    expect(e.kind).toBe('chat.reply');
    expect(e.id).toBe(`chat.reply:${s0.events.length}`);
    expect(e.payload).toEqual({ promptId: PROMPT, choiceId: 'join' });
    expect(Object.keys(e.payload as object).sort()).toEqual(['choiceId', 'promptId']);
  });

  it('回應快照是深複本：回答後改動傳入的選項不影響存檔', () => {
    const input = choice('join');
    const s1 = answerChat(createSave(1, DIR), PROMPT, input);
    const before = JSON.parse(JSON.stringify(s1));
    const reply = s1.chatReplies[PROMPT];
    if (reply?.kind !== 'answered') throw new Error('expected answered');
    expect(reply.responses).not.toBe(input.responses as never);
    expect(reply.responses[0]).not.toBe(input.responses[0]);
    expect(reply.responses[0].lines).not.toBe(input.responses[0].lines);

    input.text = '被改掉的文字';
    input.id = 'changed';
    (input.responses as ChatChoiceInput['responses'][number][]).push({ id: 'msg.x', actorId: 'actor.x', time: '00:00', lines: ['x'] });
    input.responses[0].lines.push('追加一行');
    input.responses[0].lines[0] = '改寫';
    (input.responses[1] as { time: string }).time = '23:59';
    expect(s1).toEqual(before);
  });

  it('快照只保留 id／actorId／time／lines 四個欄位', () => {
    const input = choice('join');
    const extra = { ...input, responses: input.responses.map((r) => ({ ...r, channelId: 'ch.x', visibleFrom: 'day.01' })) };
    const s1 = answerChat(createSave(1, DIR), PROMPT, extra);
    const reply = s1.chatReplies[PROMPT];
    if (reply?.kind !== 'answered') throw new Error('expected answered');
    for (const r of reply.responses) expect(Object.keys(r).sort()).toEqual(['actorId', 'id', 'lines', 'time']);
    expect(Object.keys(reply).sort()).toEqual(['choiceId', 'kind', 'playerText', 'responses']);
  });

  it('沒有回應的選項保存空陣列', () => {
    const s1 = answerChat(createSave(1, DIR), PROMPT, { id: 'quiet', text: '好', responses: [] });
    expect(s1.chatReplies[PROMPT]).toEqual({ kind: 'answered', choiceId: 'quiet', playerText: '好', responses: [] });
    expect(validSave(s1)).toBeTrue();
  });

  it('skipChat 只保存 {kind:"skipped"}，寫事件 chat.skip，payload 只有 promptId', () => {
    const s0 = createSave(1, DIR);
    const s1 = skipChat(s0, PROMPT);
    expect(s1).not.toBe(s0);
    expect(s1.chatReplies).toEqual({ [PROMPT]: { kind: 'skipped' } });
    expect(Object.keys(s1.chatReplies[PROMPT]!)).toEqual(['kind']);
    expect(chatReplyOf(s1, PROMPT)).toEqual({ kind: 'skipped' });
    expect(chatChoiceOf(s1, PROMPT)).toBeNull();
    expect(s1.events).toEqual([{ id: 'chat.skip:0', kind: EVENT_KINDS.chatSkip, payload: { promptId: PROMPT } }]);
    expect(EVENT_KINDS.chatSkip).toBe('chat.skip');
    expect(Object.keys(s1.events[0].payload as object)).toEqual(['promptId']);
  });

  it('不改動傳入的存檔', () => {
    const s0 = createSave(1, DIR);
    const before = JSON.parse(JSON.stringify(s0));
    answerChat(s0, PROMPT, choice());
    skipChat(s0, PROMPT_B);
    expect(s0).toEqual(before);
    expect(s0.chatReplies).toEqual({});
    expect(s0.events).toEqual([]);
  });

  describe('同一 prompt 一旦記錄就不可改選（重複點擊回傳同一物件）', () => {
    const answered = () => answerChat(createSave(1, DIR), PROMPT, choice('join'));
    const skipped = () => skipChat(createSave(1, DIR), PROMPT);

    it('再次回答同一選項', () => {
      const s1 = answered();
      expect(answerChat(s1, PROMPT, choice('join'))).toBe(s1);
    });
    it('回答後改選其他選項', () => {
      const s1 = answered();
      const s2 = answerChat(s1, PROMPT, choice('decline'));
      expect(s2).toBe(s1);
      expect(chatChoiceOf(s2, PROMPT)).toBe('join');
      expect(s2.events.length).toBe(1);
    });
    it('回答後再按不回覆', () => {
      const s1 = answered();
      expect(skipChat(s1, PROMPT)).toBe(s1);
    });
    it('不回覆後再按不回覆', () => {
      const s1 = skipped();
      expect(skipChat(s1, PROMPT)).toBe(s1);
    });
    it('不回覆後再回答', () => {
      const s1 = skipped();
      const s2 = answerChat(s1, PROMPT, choice('join'));
      expect(s2).toBe(s1);
      expect(chatChoiceOf(s2, PROMPT)).toBeNull();
      expect(s2.events.length).toBe(1);
    });
    it('連點多次事件仍只有一筆', () => {
      let s = createSave(1, DIR);
      for (let i = 0; i < 5; i++) s = answerChat(s, PROMPT, choice(i % 2 ? 'join' : 'decline'));
      for (let i = 0; i < 3; i++) s = skipChat(s, PROMPT);
      expect(s.events.map((e) => e.kind)).toEqual(['chat.reply']);
      expect(chatChoiceOf(s, PROMPT)).toBe('decline');
    });
  });

  it('不同 prompt 互不影響；已記錄的回覆物件沿用同一參照', () => {
    const s1 = answerChat(createSave(1, DIR), PROMPT, choice('join'));
    const s2 = skipChat(s1, PROMPT_B);
    expect(s2.chatReplies[PROMPT]).toBe(s1.chatReplies[PROMPT]!);
    expect(chatChoiceOf(s2, PROMPT)).toBe('join');
    expect(chatChoiceOf(s2, PROMPT_B)).toBeNull();
    expect(Object.keys(s2.chatReplies).sort()).toEqual([PROMPT, PROMPT_B].sort());
    expect(s2.events.map((e) => e.id)).toEqual(['chat.reply:0', 'chat.skip:1']);
  });

  it('回覆不動 dayId／stage／taskId、night、批次、工作進度或已讀', () => {
    const day2 = markMessagesRead(markReportOpened(playToDay2(SEED_INTERVENE, 'request_review'), DIR), ['msg.a']);
    for (const next of [answerChat(day2, PROMPT, choice()), skipChat(day2, PROMPT)]) {
      expect(next.dayId).toBe(day2.dayId);
      expect(next.stage).toBe(day2.stage);
      expect(next.taskId).toBe(day2.taskId);
      expect(next.night).toBe(day2.night!);
      expect(next.batches).toBe(day2.batches);
      expect(next.taskProgress).toBe(day2.taskProgress);
      expect(next.readMessages).toBe(day2.readMessages);
      expect(validSave(next)).toBeTrue();
    }
  });

  it('chatReplies 不放進 taskProgress', () => {
    const s = skipChat(answerChat(createSave(1, DIR), PROMPT, choice()), PROMPT_B);
    expect(s.taskProgress).toEqual({});
  });

  it('JSON 往返保留 chatReplies，仍通過 schema；內容不存在的 prompt 也有效', () => {
    let s = playFull(SEED_INTERVENE, 'request_review', 'review');
    s = answerChat(s, PROMPT, choice('join'));
    s = skipChat(s, PROMPT_B);
    s = answerChat(s, RETIRED, choice('gone'));
    const restored = JSON.parse(JSON.stringify(s)) as Save;
    expect(restored.chatReplies).toEqual(s.chatReplies);
    expect(restored).toEqual(s);
    expect(chatChoiceOf(restored, PROMPT)).toBe('join');
    expect(chatChoiceOf(restored, PROMPT_B)).toBeNull();
    expect(chatChoiceOf(restored, RETIRED)).toBe('gone');
    expect(validSave(restored)).toBeTrue();
    // 往返後仍不可改選
    expect(answerChat(restored, PROMPT, choice('decline'))).toBe(restored);
    expect(skipChat(restored, PROMPT_B)).toBe(restored);
  });

  it('跨日後回覆仍保留；回覆不影響夜間判定', () => {
    const plainWrap = playToWrap(SEED_INTERVENE, 'request_review');
    const chattedWrap = answerChat(plainWrap, PROMPT, choice('join'));
    const plain = advanceDay(plainWrap, DIR);
    const chatted = advanceDay(chattedWrap, DIR);
    expect(chatted.night).toEqual(plain.night!);
    expect(chatted.chatReplies).toBe(chattedWrap.chatReplies);
    expect(chatChoiceOf(chatted, PROMPT)).toBe('join');
    chatted.events.forEach((e, i) => expect(e.id).toBe(`${e.kind}:${i}`));
    expect(validSave(chatted)).toBeTrue();
  });

  it('相同操作跑兩次 JSON 逐字相等', () => {
    const run = (): Save => skipChat(answerChat(playFull(SEED_NO_INTERVENE, 'default_false', 'ack'), PROMPT, choice('join')), PROMPT_B);
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

/* ---------- 訊息已讀 ---------- */

describe('isMessageRead／markMessagesRead', () => {
  it('新存檔沒有已讀訊息', () => {
    const s = createSave(1, DIR);
    expect(s.readMessages).toEqual([]);
    expect(isMessageRead(s, 'msg.any')).toBeFalse();
  });

  it('標記已讀寫入新物件，不改原物件', () => {
    const s0 = createSave(1, DIR);
    const s1 = markMessagesRead(s0, ['msg.a', 'msg.b']);
    expect(s1).not.toBe(s0);
    expect(s0.readMessages).toEqual([]);
    expect(s1.readMessages).toEqual(['msg.a', 'msg.b']);
    expect(isMessageRead(s1, 'msg.a')).toBeTrue();
    expect(isMessageRead(s1, 'msg.c')).toBeFalse();
  });

  it('同一次呼叫內的重複 ID 只會加入一次', () => {
    const s = markMessagesRead(createSave(1, DIR), ['msg.a', 'msg.b', 'msg.a']);
    expect(s.readMessages).toEqual(['msg.a', 'msg.b']);
  });

  it('沒有新增任何一筆時回傳同一物件（不製造多餘寫檔）', () => {
    const s1 = markMessagesRead(createSave(1, DIR), ['msg.a', 'msg.b']);
    expect(markMessagesRead(s1, [])).toBe(s1);
    expect(markMessagesRead(s1, ['msg.a'])).toBe(s1);
    expect(markMessagesRead(s1, ['msg.b', 'msg.a'])).toBe(s1);
    const s2 = markMessagesRead(s1, ['msg.b', 'msg.c']);
    expect(s2).not.toBe(s1);
    expect(s2.readMessages).toEqual(['msg.a', 'msg.b', 'msg.c']);
  });

  it('查看訊息不動 dayId／stage／taskId、night、批次、進度或事件', () => {
    const day2 = markReportOpened(playToDay2(SEED_INTERVENE, 'request_review'), DIR);
    const read = markMessagesRead(day2, ['msg.a', 'msg.b']);
    expect(read.dayId).toBe(day2.dayId);
    expect(read.stage).toBe(day2.stage);
    expect(read.taskId).toBe(day2.taskId);
    expect(read.night).toBe(day2.night!);
    expect(read.events).toBe(day2.events);
    expect(read.batches).toBe(day2.batches);
    expect(read.taskProgress).toBe(day2.taskProgress);
    expect(validSave(read)).toBeTrue();
  });

  it('已讀清單通過 JSON 往返與 schema 檢查', () => {
    const read = markMessagesRead(playFull(SEED_INTERVENE, 'default_false', 'ack'), ['msg.a', 'msg.b']);
    const restored = JSON.parse(JSON.stringify(read)) as Save;
    expect(restored.readMessages).toEqual(['msg.a', 'msg.b']);
    expect(validSave(restored)).toBeTrue();
  });
});

/* ---------- 可重現性 ---------- */

describe('完整流程可重現', () => {
  it('相同 seed 與相同選擇跑兩次，最終存檔 JSON.stringify 相等', () => {
    for (const seed of [SEED_INTERVENE, SEED_NO_INTERVENE, 12345]) {
      for (const policy of MISSING_POLICIES) {
        for (const reply of REPLIES) {
          const a = playFull(seed, policy, reply);
          const b = playFull(seed, policy, reply);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
          expect(a.stage).toBe('end');
          expect(a.dayId).toBe(DAY_02);
          expect(a.version).toBe(12);
          expect(isValidSave(JSON.parse(JSON.stringify(a)), DIR)).toBeTrue();
        }
      }
    }
  });

  it('六天目錄跑到 end 兩次也逐字相等', () => {
    const run = (): Save => completeWork(submitMapping(playSixTo(DAY_06, SEED_INTERVENE, 'request_review'), DIR6, 'request_review'), DIR6);
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.stage).toBe('end');
    expect(a.dayId).toBe(DAY_06);
    expect(isValidSave(JSON.parse(JSON.stringify(a)), DIR6)).toBeTrue();
  });

  it('查看訊息後重跑仍相等：已讀不影響夜間判定與事件序列', () => {
    const a = markMessagesRead(playFull(SEED_INTERVENE, 'request_review', 'review'), ['msg.a']);
    const b = markMessagesRead(playFull(SEED_INTERVENE, 'request_review', 'review'), ['msg.a']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plain = playFull(SEED_INTERVENE, 'request_review', 'review');
    expect(a.night).toEqual(plain.night!);
    expect(a.events).toEqual(plain.events);
  });

  it('兩天流程的事件序列固定：3 archive → task.complete → day.complete → night.resolved → record.review → reply.submit → task.complete → day.complete', () => {
    const end = playFull(SEED_INTERVENE, 'request_review', 'review');
    expect(end.events.map((e) => e.id)).toEqual([
      'archive:0',
      'archive:1',
      'archive:2',
      'task.complete:3',
      'day.complete:4',
      'night.resolved:5',
      'record.review:6',
      'reply.submit:7',
      'task.complete:8',
      'day.complete:9',
    ]);
  });

  it('六天流程的事件序列：只有一個 night.resolved；每天結尾 task.complete＋day.complete；Day 6 為 field-map.submit＋task.complete＋day.complete', () => {
    const end = completeWork(submitMapping(playSixTo(DAY_06, SEED_INTERVENE), DIR6, 'default_false'), DIR6);
    const arch = (n: number) => Array.from({ length: n }, () => 'archive');
    expect(end.events.map((e) => e.kind)).toEqual([
      ...arch(3),
      'task.complete',
      'day.complete',
      'night.resolved',
      'record.review',
      'reply.submit',
      'task.complete',
      'day.complete',
      ...arch(DAY3_RECORDS.length),
      'task.complete',
      'day.complete',
      ...arch(DAY4_RECORDS.length),
      'task.complete',
      'day.complete',
      ...arch(DAY5_RECORDS.length),
      'task.complete',
      'day.complete',
      'field-map.submit',
      'task.complete',
      'day.complete',
    ]);
    expect(end.events.filter((e) => e.kind === 'day.complete').map((e) => e.payload)).toEqual(
      [DAY_01, DAY_02, DAY_03, DAY_04, DAY_05, DAY_06].map((dayId) => ({ dayId })),
    );
    expect(end.events.filter((e) => e.kind === 'task.complete').map((e) => e.payload)).toEqual([
      { dayId: DAY_01, taskId: TASK_DAY1 },
      { dayId: DAY_02, taskId: TASK_DAY2 },
      { dayId: DAY_03, taskId: TASK_DAY3 },
      { dayId: DAY_04, taskId: TASK_DAY4 },
      { dayId: DAY_05, taskId: TASK_DAY5 },
      { dayId: DAY_06, taskId: TASK_DAY6 },
    ]);
    end.events.forEach((e, i) => expect(e.id).toBe(`${e.kind}:${i}`));
  });

  it('不同 seed 可得到不同夜間結果', () => {
    const a = playToDay2(SEED_INTERVENE, 'request_review');
    const b = playToDay2(SEED_NO_INTERVENE, 'request_review');
    expect(a.night!.intervention).not.toBe(b.night!.intervention);
  });
});

/* ---------- R8：同日多工作 ---------- */

const MIX_01 = 'day.mix.01';
const MIX_02 = 'day.mix.02';
const MIX_03 = 'day.mix.03';
const MIX_A1 = 'task.mix.archive-a';
const MIX_B = 'task.mix.reconcile';
const MIX_C = TASK_DAY6; // FIELD_MAP_TASK
const MIX_A2 = 'task.mix.archive-b';
const MIX_D2 = 'task.mix2.archive';
const MIX_D3 = 'task.mix3.archive';
const MIX_BATCH_A1: BatchId = 'batch.mix.a1';
const MIX_BATCH_A2: BatchId = 'batch.mix.a2';
const MIX_BATCH_D2: BatchId = 'batch.mix2';
const MIX_BATCH_D3: BatchId = 'batch.mix3';

/** 合成目錄：第一天 archive → reconcile → field-map → archive（A→B→C→A），接著兩個單一工作日。 */
const DIR_MIX: DayDirectory = createDayDirectory(
  [
    {
      dayId: MIX_01,
      dayNumber: 1,
      nextDayId: MIX_02,
      tasks: [
        { id: MIX_A1, kind: 'archive', batchId: MIX_BATCH_A1, recordKeys: DAY1_RECORDS.map((r) => r.key), caseReviews: [] },
        { id: MIX_B, kind: 'reconcile', sourceBatchId: MIX_BATCH_A1, subjectKey: 'B102', recordKeys: ['B102'] },
        FIELD_MAP_TASK,
        { id: MIX_A2, kind: 'archive', batchId: MIX_BATCH_A2, recordKeys: DAY3_RECORDS.map((r) => r.key), caseReviews: [] },
      ],
    },
    archivePlan(MIX_02, 2, MIX_03, MIX_D2, MIX_BATCH_D2, DAY4_RECORDS),
    archivePlan(MIX_03, 3, null, MIX_D3, MIX_BATCH_D3, DAY5_RECORDS),
  ],
  { [MIX_BATCH_A1]: DAY1_RECORDS, [MIX_BATCH_A2]: DAY3_RECORDS, [MIX_BATCH_D2]: DAY4_RECORDS, [MIX_BATCH_D3]: DAY5_RECORDS },
);

const SAME_01 = 'day.same.01';
const SAME_02 = 'day.same.02';
const SAME_A1 = 'task.same.archive-1';
const SAME_A2 = 'task.same.archive-2';
const SAME_R1 = 'task.same.reconcile-1';
const SAME_R2 = 'task.same.reconcile-2';
const SAME_BATCH_1: BatchId = 'batch.same.1';
const SAME_BATCH_2: BatchId = 'batch.same.2';

/** 合成目錄：同 kind 連續兩次（第一天兩件歸檔、第二天兩件核對，最後一天）。 */
const DIR_SAME: DayDirectory = createDayDirectory(
  [
    {
      dayId: SAME_01,
      dayNumber: 1,
      nextDayId: SAME_02,
      tasks: [
        { id: SAME_A1, kind: 'archive', batchId: SAME_BATCH_1, recordKeys: DAY1_RECORDS.map((r) => r.key), caseReviews: [] },
        { id: SAME_A2, kind: 'archive', batchId: SAME_BATCH_2, recordKeys: DAY4_RECORDS.map((r) => r.key), caseReviews: [] },
      ],
    },
    {
      dayId: SAME_02,
      dayNumber: 2,
      nextDayId: null,
      tasks: [
        { id: SAME_R1, kind: 'reconcile', sourceBatchId: SAME_BATCH_1, subjectKey: 'B102', recordKeys: ['B102'] },
        { id: SAME_R2, kind: 'reconcile', sourceBatchId: SAME_BATCH_2, subjectKey: 'U1', recordKeys: ['U1'] },
      ],
    },
  ],
  { [SAME_BATCH_1]: DAY1_RECORDS, [SAME_BATCH_2]: DAY4_RECORDS },
);

function taskOf(dir: DayDirectory, dayId: string, index: number): TaskPlan {
  return dir.plan(dayId)!.tasks[index]!;
}

function kindsAfter(before: Save, after: Save): string[] {
  return after.events.slice(before.events.length).map((e) => e.kind);
}

describe('R8：activeTaskOf／createSave', () => {
  it('createSave 的 taskId 是第一天的第一件；activeTaskOf 依 taskId 精確取得，不讀 tasks[0]', () => {
    const s = createSave(1, DIR_MIX);
    expect(s.taskId).toBe(MIX_A1);
    expect(s.waivedTasks).toEqual([]);
    expect(activeTaskOf(s, DIR_MIX).id).toBe(MIX_A1);
    expect(activeTaskOf({ ...s, taskId: MIX_C }, DIR_MIX)).toBe(FIELD_MAP_TASK);
    expect(activeTaskOf({ ...s, taskId: MIX_A2 }, DIR_MIX).id).toBe(MIX_A2);
    expect(currentBatchId({ ...s, taskId: MIX_A2 }, DIR_MIX)).toBe(MIX_BATCH_A2);
    expect(currentBatchId({ ...s, taskId: MIX_B }, DIR_MIX)).toBe(MIX_BATCH_A1);
    expect(currentBatchId({ ...s, taskId: MIX_C }, DIR_MIX)).toBeNull();
  });

  it('activeTaskOf 對不屬於當日的 taskId 拋錯', () => {
    const s = createSave(1, DIR_MIX);
    expect(() => activeTaskOf({ ...s, taskId: MIX_D2 }, DIR_MIX)).toThrowError(/task\.mix2\.archive/);
    expect(() => activeTaskOf({ ...s, taskId: 'task.none' }, DIR_MIX)).toThrowError(/task\.none/);
  });
});

describe('R8：A→B→C→A 同日交付', () => {
  it('每件交付只寫一次 task.complete，停在 work 換到下一件；最後一件才寫 day.complete 進 wrap', () => {
    let s = createSave(SEED_INTERVENE, DIR_MIX);
    expect(completeWork(s, DIR_MIX)).toBe(s);

    // A：歸檔
    s = archiveAll(s, 'request_review', MIX_BATCH_A1);
    let next = completeWork(s, DIR_MIX);
    expect([next.dayId, next.stage, next.taskId]).toEqual([MIX_01, 'work', MIX_B]);
    expect(next.events.slice(s.events.length)).toEqual([
      { id: `task.complete:${s.events.length}`, kind: 'task.complete', payload: { dayId: MIX_01, taskId: MIX_A1 } },
    ]);
    expect(validSave(next, DIR_MIX)).toBeTrue();
    expect(completeWork(next, DIR_MIX)).toBe(next); // 重複點擊：目前是核對工作 → no-op
    s = next;

    // B：核對
    expect(canReply(s, DIR_MIX, 'ack')).toBeFalse();
    s = markReceiptOpened(markReportOpened(s, DIR_MIX), DIR_MIX);
    expect(s.taskProgress[MIX_B]).toEqual({ kind: 'reconcile', reportOpened: true, receiptOpened: true });
    expect(canReply(s, DIR_MIX, 'review')).toBeFalse(); // R10：尚未逐筆審查
    s = reviewAll(s, DIR_MIX);
    next = submitReply(s, DIR_MIX, 'review');
    expect([next.stage, next.taskId]).toEqual(['work', MIX_C]);
    // 同日第一夜之前回覆：沒有夜間結果 → 摘要版本 null
    expect(reconcileProgressOf(next, MIX_B).reportRevision).toBeNull();
    expect(kindsAfter(s, next)).toEqual(['reply.submit', 'task.complete']);
    expect(next.events[next.events.length - 1].payload).toEqual({ dayId: MIX_01, taskId: MIX_B });
    expect(submitReply(next, DIR_MIX, 'ack')).toBe(next);
    expect(completeWork(next, DIR_MIX)).toBe(next); // 欄位映射尚未提交
    expect(validSave(next, DIR_MIX)).toBeTrue();
    s = next;

    // C：欄位映射
    s = submitMapping(s, DIR_MIX, 'default_false');
    expect(s.stage).toBe('work');
    next = completeWork(s, DIR_MIX);
    expect([next.stage, next.taskId]).toEqual(['work', MIX_A2]);
    expect(kindsAfter(s, next)).toEqual(['task.complete']);
    expect(completeWork(next, DIR_MIX)).toBe(next); // A2 尚未歸檔
    expect(currentBatchId(next, DIR_MIX)).toBe(MIX_BATCH_A2);
    expect(validSave(next, DIR_MIX)).toBeTrue();
    s = next;

    // A（第二次歸檔）：最後一件
    s = archiveEvery(s, MIX_BATCH_A2, DAY3_RECORDS);
    next = completeWork(s, DIR_MIX);
    expect([next.dayId, next.stage, next.taskId]).toEqual([MIX_01, 'wrap', MIX_A2]);
    expect(next.events.slice(s.events.length)).toEqual([
      { id: `task.complete:${s.events.length}`, kind: 'task.complete', payload: { dayId: MIX_01, taskId: MIX_A2 } },
      { id: `day.complete:${s.events.length + 1}`, kind: 'day.complete', payload: { dayId: MIX_01 } },
    ]);
    expect(completeWork(next, DIR_MIX)).toBe(next);
    expect(validSave(next, DIR_MIX)).toBeTrue();

    // 同日切換工作不擲夜間
    expect(next.night).toBeUndefined();
    expect(next.events.some((e) => e.kind === 'night.resolved')).toBeFalse();
    expect(next.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId)).toEqual([MIX_A1, MIX_B, MIX_C, MIX_A2]);
    expect(next.events.filter((e) => e.kind === 'day.complete').length).toBe(1);
  });

  it('混合日之後跨日：wrap → 次日 morning（第一件）→ work；夜間只在第一次跨日擲一次；最後一天 → end', () => {
    const wrap1 = completeWork(
      archiveEvery(completeWork(submitMapping(submitReply(readyToReply(completeWork(archiveAll(createSave(SEED_INTERVENE, DIR_MIX), 'default_false', MIX_BATCH_A1), DIR_MIX), DIR_MIX), DIR_MIX, 'ack'), DIR_MIX, 'request_review'), DIR_MIX), MIX_BATCH_A2, DAY3_RECORDS),
      DIR_MIX,
    );
    expect(wrap1.stage).toBe('wrap');

    const morning2 = advanceDay(wrap1, DIR_MIX);
    expect([morning2.dayId, morning2.stage, morning2.taskId]).toEqual([MIX_02, 'morning', MIX_D2]);
    expect(morning2.night).toEqual(resolveNight(SEED_INTERVENE));
    expect(kindsAfter(wrap1, morning2)).toEqual(['night.resolved']);
    expect(validSave(morning2, DIR_MIX)).toBeTrue();
    expect(advanceDay(morning2, DIR_MIX)).toBe(morning2);
    expect(completeWork(morning2, DIR_MIX)).toBe(morning2);
    expect(commitArchive(morning2, MIX_BATCH_D2, record('U1', DAY4_RECORDS), okFor('U1', { value: '0401', policy: 'default_false' }, DAY4_RECORDS))).toBe(morning2);

    const work2 = startDay(morning2);
    expect([work2.dayId, work2.stage, work2.taskId]).toEqual([MIX_02, 'work', MIX_D2]);
    expect(work2.events).toBe(morning2.events);
    expect(startDay(work2)).toBe(work2);
    expect(validSave(work2, DIR_MIX)).toBeTrue();

    const wrap2 = completeWork(archiveEvery(work2, MIX_BATCH_D2, DAY4_RECORDS), DIR_MIX);
    expect(wrap2.stage).toBe('wrap');
    expect(kindsAfter(work2, wrap2).slice(-2)).toEqual(['task.complete', 'day.complete']);
    const work3 = toNextDay(wrap2, DIR_MIX);
    expect([work3.dayId, work3.stage, work3.taskId]).toEqual([MIX_03, 'work', MIX_D3]);
    expect(work3.night).toBe(morning2.night!);
    expect(work3.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);

    const end = completeWork(archiveEvery(work3, MIX_BATCH_D3, DAY5_RECORDS), DIR_MIX);
    expect([end.dayId, end.stage]).toEqual([MIX_03, 'end']);
    expect(end.events.filter((e) => e.kind === 'day.complete').map((e) => e.payload)).toEqual([{ dayId: MIX_01 }, { dayId: MIX_02 }, { dayId: MIX_03 }]);
    expect(advanceDay(end, DIR_MIX)).toBe(end);
    expect(startDay(end)).toBe(end);
    expect(validSave(end, DIR_MIX)).toBeTrue();
  });

  it('刷新（JSON 往返）停在第 2 件時仍合法且可繼續', () => {
    const onB = completeWork(archiveAll(createSave(1, DIR_MIX), 'default_false', MIX_BATCH_A1), DIR_MIX);
    const restored = JSON.parse(JSON.stringify(onB)) as Save;
    expect(restored).toEqual(onB);
    expect(validSave(restored, DIR_MIX)).toBeTrue();
    expect(completeWork(restored, DIR_MIX)).toBe(restored);
    const onC = submitReply(readyToReply(restored, DIR_MIX), DIR_MIX, 'ask');
    expect(onC.taskId).toBe(MIX_C);
    expect(onC.events.filter((e) => e.kind === 'task.complete').length).toBe(2);
  });
});

describe('R8：越序與重複交付', () => {
  const s0 = createSave(1, DIR_MIX);

  it('後面的工作先做完也不能交付目前工作：A1 未齊、A2 已齊 → completeWork no-op', () => {
    const later = archiveEvery(s0, MIX_BATCH_A2, DAY3_RECORDS);
    expect(allArchived(later, MIX_BATCH_A2, DAY3_RECORDS)).toBeTrue();
    expect(completeWork(later, DIR_MIX)).toBe(later);
    const withReply: Save = { ...later, taskProgress: { [MIX_B]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ack' } } };
    expect(completeWork(withReply, DIR_MIX)).toBe(withReply);
  });

  it('目前是核對工作時 completeWork 一律 no-op（即使已回覆、即使後面工作已完成）', () => {
    const onB = completeWork(archiveAll(s0, 'default_false', MIX_BATCH_A1), DIR_MIX);
    expect(onB.taskId).toBe(MIX_B);
    expect(completeWork(onB, DIR_MIX)).toBe(onB);
    const stuck: Save = { ...onB, taskProgress: { [MIX_B]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ack' } } };
    expect(completeWork(stuck, DIR_MIX)).toBe(stuck);
    expect(completeWork(archiveEvery(onB, MIX_BATCH_A2, DAY3_RECORDS), DIR_MIX).taskId).toBe(MIX_B);
  });

  it('目前是歸檔／欄位映射工作時 submitReply／markReportOpened no-op', () => {
    expect(markReportOpened(s0, DIR_MIX)).toBe(s0);
    expect(submitReply(s0, DIR_MIX, 'ack')).toBe(s0);
    const onC: Save = { ...s0, taskId: MIX_C };
    expect(markReportOpened(onC, DIR_MIX)).toBe(onC);
    expect(submitReply(onC, DIR_MIX, 'ack')).toBe(onC);
  });

  it('欄位映射規則只作用於目前工作：目前不是 field-map 時 setFieldAssignment no-op', () => {
    expect(setFieldAssignment(s0, DIR_MIX, 'personnel-code', 'legacy-id')).toBe(s0);
    expect(fieldMapCheck(s0, DIR_MIX)).toBeNull();
  });

  it('重複 completeWork／submitReply 回傳同一物件，事件不增加', () => {
    const done = archiveAll(s0, 'default_false', MIX_BATCH_A1);
    const once = completeWork(done, DIR_MIX);
    expect(completeWork(once, DIR_MIX)).toBe(once);
    const replied = submitReply(readyToReply(once, DIR_MIX), DIR_MIX, 'ack');
    expect(submitReply(replied, DIR_MIX, 'ack')).toBe(replied);
    expect(submitReply(replied, DIR_MIX, 'ask')).toBe(replied);
    expect(replied.events.filter((e) => e.kind === 'task.complete').length).toBe(2);
    expect(replied.events.filter((e) => e.kind === 'reply.submit').length).toBe(1);
  });

  it('morning 階段不能交付、回覆或歸檔', () => {
    const morning: Save = { ...createSave(1, DIR), dayId: DAY_02, stage: 'morning', taskId: TASK_DAY2, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) }, night: NIGHT_YES };
    expect(validSave(morning)).toBeTrue();
    expect(completeWork(morning, DIR)).toBe(morning);
    expect(markReportOpened(morning, DIR)).toBe(morning);
    expect(canReply(morning, DIR, 'ack')).toBeFalse();
    expect(submitReply(morning, DIR, 'ack')).toBe(morning);
    expect(commitArchive(morning, BATCH_DAY03, record('H17'), okFor('H17', { value: 'H-17' }))).toBe(morning);
  });
});

describe('R8：同 kind 連續、單一工作日', () => {
  it('同日兩件歸檔：交付第一件後目前批次換成第二件（空批次），第二件齊了才進 wrap', () => {
    let s = archiveAll(createSave(1, DIR_SAME), 'default_false', SAME_BATCH_1);
    s = completeWork(s, DIR_SAME);
    expect([s.stage, s.taskId]).toEqual(['work', SAME_A2]);
    expect(currentBatchId(s, DIR_SAME)).toBe(SAME_BATCH_2);
    expect(archivedCount(s, SAME_BATCH_2)).toBe(0);
    expect(completeWork(s, DIR_SAME)).toBe(s);
    expect(validSave(s, DIR_SAME)).toBeTrue();
    const partial = archiveEvery(s, SAME_BATCH_2, DAY4_RECORDS.slice(0, 1));
    expect(completeWork(partial, DIR_SAME)).toBe(partial);
    const wrap = completeWork(archiveEvery(s, SAME_BATCH_2, DAY4_RECORDS), DIR_SAME);
    expect(wrap.stage).toBe('wrap');
    expect(wrap.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId)).toEqual([SAME_A1, SAME_A2]);
    expect(wrap.events.filter((e) => e.kind === 'day.complete').length).toBe(1);
    expect(validSave(wrap, DIR_SAME)).toBeTrue();
  });

  it('同日兩件核對：進度以 taskId 為鍵各自獨立，第一件的已開文件與回覆不帶到第二件', () => {
    let s = archiveAll(createSave(SEED_NO_INTERVENE, DIR_SAME), 'default_false', SAME_BATCH_1);
    s = completeWork(archiveEvery(completeWork(s, DIR_SAME), SAME_BATCH_2, DAY4_RECORDS, 'request_review'), DIR_SAME);
    s = toNextDay(s, DIR_SAME);
    expect([s.dayId, s.stage, s.taskId]).toEqual([SAME_02, 'work', SAME_R1]);
    // 第一件核對看 SAME_BATCH_1 的 B102（default_false → false）→ 已安排
    expect(isArrangedInSave(s, DIR_SAME)).toBeTrue();

    s = submitReply(markReceiptOpened(readyToReply(s, DIR_SAME), DIR_SAME), DIR_SAME, 'review');
    expect([s.stage, s.taskId]).toEqual(['work', SAME_R2]);
    for (const reply of REPLIES) expect(canReply(s, DIR_SAME, reply)).toBeFalse();
    expect(reconcileProgressOf(s, SAME_R2)).toEqual({ kind: 'reconcile', reportOpened: false, receiptOpened: false });
    // 第二件看 SAME_BATCH_2 的 U1（request_review → null）＋無介入 → 未安排
    expect(isArrangedInSave(s, DIR_SAME)).toBeFalse();
    expect(validSave(s, DIR_SAME)).toBeTrue();

    const end = submitReply(readyToReply(s, DIR_SAME), DIR_SAME, 'ack');
    expect(end.stage).toBe('end');
    const u1 = record('U1', DAY4_RECORDS);
    expect(end.taskProgress).toEqual({
      [SAME_R1]: {
        kind: 'reconcile',
        reportOpened: true,
        receiptOpened: true,
        reviews: { B102: { ...day1Review('B102'), batchId: SAME_BATCH_1, archiveTaskId: SAME_A1 } },
        reply: 'review',
        reportRevision: 1,
      },
      [SAME_R2]: {
        kind: 'reconcile',
        reportOpened: true,
        receiptOpened: false,
        reviews: { U1: { disposition: 'hold', batchId: SAME_BATCH_2, archiveTaskId: SAME_A2, recordKey: 'U1', sourceCode: u1.code, reviewedCode: u1.code } },
        reply: 'ack',
        reportRevision: 1,
      },
    });
    expect(kindsAfter(s, end).slice(-3)).toEqual(['reply.submit', 'task.complete', 'day.complete']);
    expect(validSave(end, DIR_SAME)).toBeTrue();
  });

  it('只有一件工作的日：completeWork 一次寫 task.complete＋day.complete 並進 wrap', () => {
    const s = archiveAll(createSave(1, DIR), 'default_false');
    const wrap = completeWork(s, DIR);
    expect(kindsAfter(s, wrap)).toEqual(['task.complete', 'day.complete']);
    expect(wrap.stage).toBe('wrap');
    expect(wrap.taskId).toBe(TASK_DAY1);
  });
});

describe('R8：isTaskSettled／isTaskWaived／nextOpenTask', () => {
  it('nextOpenTask 回傳之後第一件未完成且非免補的工作；沒有則 null', () => {
    const s = createSave(1, DIR_MIX);
    expect(nextOpenTask(s, DIR_MIX, MIX_A1)!.id).toBe(MIX_B);
    expect(nextOpenTask(s, DIR_MIX, MIX_C)!.id).toBe(MIX_A2);
    expect(nextOpenTask(s, DIR_MIX, MIX_A2)).toBeNull();
    const waivedB: Save = { ...s, waivedTasks: [MIX_B] };
    expect(nextOpenTask(waivedB, DIR_MIX, MIX_A1)!.id).toBe(MIX_C);
    const a2Done = archiveEvery(s, MIX_BATCH_A2, DAY3_RECORDS);
    expect(nextOpenTask(a2Done, DIR_MIX, MIX_C)).toBeNull();
  });

  it('交付時跳過免補工作；後面都已結清則直接完成當日', () => {
    const done = archiveAll({ ...createSave(1, DIR_MIX), waivedTasks: [MIX_B] }, 'default_false', MIX_BATCH_A1);
    const onC = completeWork(done, DIR_MIX);
    expect(onC.taskId).toBe(MIX_C);
    // 規則層會跳過免補工作；但「目前日進行中就免補」只可能來自手改存檔，存檔驗證刻意拒絕
    expect(validSave(onC, DIR_MIX)).toBeFalse();
    // 免補的核對沒有產生任何事件或進度
    expect(onC.events.some((e) => JSON.stringify(e.payload).includes(MIX_B))).toBeFalse();
    expect(onC.taskProgress[MIX_B]).toBeUndefined();

    const allWaived = completeWork({ ...done, waivedTasks: [MIX_B, MIX_C, MIX_A2] }, DIR_MIX);
    expect(allWaived.stage).toBe('wrap');
    expect(kindsAfter(done, allWaived)).toEqual(['task.complete', 'day.complete']);
    // 當日已 wrap：第 2 件以後的免補合法
    expect(validSave(allWaived, DIR_MIX)).toBeTrue();
  });

  it('免補不是完成：isTaskDone false、isTaskWaived／isTaskSettled true；完成的工作 settled 但非 waived', () => {
    const s: Save = { ...archiveAll(createSave(1, DIR_MIX), 'default_false', MIX_BATCH_A1), waivedTasks: [MIX_A2] };
    const a1 = taskOf(DIR_MIX, MIX_01, 0);
    const a2 = taskOf(DIR_MIX, MIX_01, 3);
    const b = taskOf(DIR_MIX, MIX_01, 1);
    expect([isTaskDone(s, DIR_MIX, a2), isTaskWaived(s, MIX_A2), isTaskSettled(s, DIR_MIX, a2)]).toEqual([false, true, true]);
    expect([isTaskDone(s, DIR_MIX, a1), isTaskWaived(s, MIX_A1), isTaskSettled(s, DIR_MIX, a1)]).toEqual([true, false, true]);
    expect([isTaskDone(s, DIR_MIX, b), isTaskWaived(s, MIX_B), isTaskSettled(s, DIR_MIX, b)]).toEqual([false, false, false]);
  });

  it('advanceDay 的 taskId 為次日第一件未結清的工作', () => {
    const wrap = completeWork(archiveEvery(completeWork(archiveAll(createSave(1, DIR_SAME), 'default_false', SAME_BATCH_1), DIR_SAME), SAME_BATCH_2, DAY4_RECORDS), DIR_SAME);
    expect(advanceDay(wrap, DIR_SAME).taskId).toBe(SAME_R1);
    expect(advanceDay({ ...wrap, waivedTasks: [SAME_R1] }, DIR_SAME).taskId).toBe(SAME_R2);
  });
});

describe('R8：isArrangedInSave 只看當日核對工作的來源批次', () => {
  const R8_DAY2_ARCHIVE = 'task.day2.archive';
  const BATCH_DAY02: BatchId = 'batch.day02.archive';
  const DAY2_RECORDS: readonly SourceRecord[] = [
    { key: 'B102', name: null, code: '0102', refusal: false, refusalApplies: true },
    { key: 'W1', name: null, code: '0901', refusal: null, refusalApplies: true },
  ];
  const dirR8 = createDayDirectory(
    [
      day1Plan(DAY1_RECORDS),
      { ...reconcilePlan(DAY_03), tasks: [...reconcilePlan(DAY_03).tasks, { id: R8_DAY2_ARCHIVE, kind: 'archive', batchId: BATCH_DAY02, recordKeys: DAY2_RECORDS.map((r) => r.key), caseReviews: [] }] },
      archivePlan(DAY_03, 3, null, TASK_DAY3, BATCH_DAY03, DAY3_RECORDS),
    ],
    { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_DAY02]: DAY2_RECORDS, [BATCH_DAY03]: DAY3_RECORDS },
  );

  for (const [seed, policy] of [
    [SEED_NO_INTERVENE, 'default_false'],
    [SEED_INTERVENE, 'default_false'],
    [SEED_NO_INTERVENE, 'request_review'],
    [SEED_INTERVENE, 'request_review'],
  ] as const) {
    it(`四格：seed ${seed}／${policy} 在 Day 2 第二批前後結果相同`, () => {
      const day2 = playToDay2(seed, policy, dirR8);
      const expected = isArranged(archivedIn(day2, 'B102').refusal, day2.night!.intervention);
      expect(isArrangedInSave(day2, dirR8)).toBe(expected);
      const onArchive = submitReply(readyToReply(day2, dirR8), dirR8, 'ack');
      expect(onArchive.taskId).toBe(R8_DAY2_ARCHIVE);
      expect(isArrangedInSave(onArchive, dirR8)).toBe(expected);
      const second = archiveEvery(onArchive, BATCH_DAY02, DAY2_RECORDS, 'request_review');
      expect(archivedIn(second, 'B102', BATCH_DAY02).refusal).toBeFalse();
      expect(isArrangedInSave(second, dirR8)).toBe(expected);
      const wrap = completeWork(second, dirR8);
      expect(wrap.stage).toBe('wrap');
      expect(isArrangedInSave(wrap, dirR8)).toBe(expected);
      expect(validSave(wrap, dirR8)).toBeTrue();
    });
  }
});

describe('R8：eventDayId', () => {
  it('archive 依 batchId（含同日第二批）、reply／field-map／task.complete 依 taskId、day.complete 依 dayId', () => {
    const wrap = completeWork(
      archiveEvery(completeWork(submitMapping(submitReply(readyToReply(completeWork(archiveAll(createSave(1, DIR_MIX), 'default_false', MIX_BATCH_A1), DIR_MIX), DIR_MIX), DIR_MIX, 'ack'), DIR_MIX, 'default_false'), DIR_MIX), MIX_BATCH_A2, DAY3_RECORDS),
      DIR_MIX,
    );
    const day2 = toNextDay(answerChat(wrap, 'prompt.test', { id: 'c', text: 'ok', responses: [] }), DIR_MIX);
    const day2Wrap = completeWork(archiveEvery(skipChat(day2, 'prompt.test.b'), MIX_BATCH_D2, DAY4_RECORDS), DIR_MIX);
    for (const e of day2Wrap.events) {
      const expected = ['chat.reply', 'chat.skip', 'night.resolved'].includes(e.kind)
        ? undefined
        : e.kind === 'archive'
          ? (e.payload as { batchId: string }).batchId === MIX_BATCH_D2
            ? MIX_02
            : MIX_01
          : e.id.startsWith('day.complete') || e.id.startsWith('task.complete')
            ? (e.payload as { dayId: string }).dayId
            : MIX_01;
      expect(eventDayId(e, DIR_MIX)).withContext(e.id).toBe(expected);
    }
    const kinds = new Set(day2Wrap.events.map((e) => e.kind));
    for (const k of ['archive', 'reply.submit', 'field-map.submit', 'task.complete', 'day.complete', 'night.resolved', 'chat.reply', 'chat.skip']) {
      expect(kinds.has(k)).withContext(k).toBeTrue();
    }
  });

  it('逐一 payload：dayId 優先、未知 dayId 退回 taskId、再退回 batchId；聊天／夜間／舊事件無法歸屬', () => {
    const e = (payload: unknown) => ({ payload });
    expect(eventDayId(e({ key: 'T1', origin: 'source', batchId: MIX_BATCH_A2 }), DIR_MIX)).toBe(MIX_01);
    expect(eventDayId(e({ key: 'U1', origin: 'source', batchId: MIX_BATCH_D2 }), DIR_MIX)).toBe(MIX_02);
    expect(eventDayId(e({ taskId: MIX_B, choice: 'ack' }), DIR_MIX)).toBe(MIX_01);
    expect(eventDayId(e({ taskId: MIX_C, blankPolicy: null, rowCount: 8, affectedCount: 4 }), DIR_MIX)).toBe(MIX_01);
    expect(eventDayId(e({ dayId: MIX_02, taskId: MIX_D2 }), DIR_MIX)).toBe(MIX_02);
    expect(eventDayId(e({ dayId: MIX_03 }), DIR_MIX)).toBe(MIX_03);
    expect(eventDayId(e({ dayId: 'day.99', taskId: MIX_D3 }), DIR_MIX)).toBe(MIX_03);
    expect(eventDayId(e({ dayId: 'day.99' }), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({ promptId: 'prompt.x', choiceId: 'a' }), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({ promptId: 'prompt.x' }), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({ ...NIGHT_YES }), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({}), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e(null), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e('archive'), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({ batchId: 'batch.unknown' }), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({ taskId: 'task.unknown' }), DIR_MIX)).toBeUndefined();
    expect(eventDayId(e({ dayId: 1, taskId: 2 }), DIR_MIX)).toBeUndefined();
  });
});

describe('R8：聊天回覆與已讀在多工作日保存', () => {
  it('同日切換工作時 chatReplies／readMessages 不變，JSON 往返仍合法', () => {
    const PROMPT = 'prompt.test.multi';
    let s = answerChat(createSave(1, DIR_MIX), PROMPT, { id: 'join', text: '好', responses: [{ id: 'msg.r', actorId: 'actor.a', time: '12:00', lines: ['收到'] }] });
    s = markMessagesRead(s, ['msg.a']);
    const replies = s.chatReplies;
    const read = s.readMessages;
    s = completeWork(archiveAll(s, 'default_false', MIX_BATCH_A1), DIR_MIX);
    s = submitReply(readyToReply(s, DIR_MIX), DIR_MIX, 'ack');
    expect(s.taskId).toBe(MIX_C);
    expect(s.chatReplies).toBe(replies);
    expect(s.readMessages).toBe(read);
    expect(chatChoiceOf(s, PROMPT)).toBe('join');
    const restored = JSON.parse(JSON.stringify(s)) as Save;
    expect(validSave(restored, DIR_MIX)).toBeTrue();
    expect(chatReplyOf(restored, PROMPT)).toEqual(replies[PROMPT]!);
    expect(isMessageRead(restored, 'msg.a')).toBeTrue();
  });
});

/* ---------- R9：多來源比對案件 ---------- */

/**
 * 測試自建的案件日：day.03 有兩件歸檔工作（先一件普通批次，再一件含案件的批次），
 * 案件紀錄 H204 的來源編號為 H-204；三種決定 registry（H-204／archive）、supplement（H-205／archive）、
 * review（H-204／review）。同批另有 T1 與 C102（編號 0102，缺拒絕紀錄）。
 */
const CASE_ID = 'case.day3.h204';
const TASK_CASE_PRE = 'task.day3.intake';
const TASK_CASE = TASK_DAY3;
const BATCH_CASE_PRE: BatchId = 'batch.day03.intake';
const BATCH_CASE: BatchId = 'batch.day03.case';
const DOC_REGISTRY = 'doc.test.h204.registry';
const DOC_SUPPLEMENT = 'doc.test.h204.supplement';
const CASE_PRE_RECORDS: readonly SourceRecord[] = [{ key: 'P1', name: null, code: '0301', refusal: true, refusalApplies: true }];
const CASE_RECORDS: readonly SourceRecord[] = [
  { key: 'T1', name: null, code: '0001', refusal: null, refusalApplies: false },
  { key: 'H204', name: '測試案件', code: 'H-204', refusal: null, refusalApplies: false },
  { key: 'C102', name: null, code: '0102', refusal: null, refusalApplies: true },
];
const CASE_PLAN: CasePlan = {
  id: CASE_ID,
  recordKey: 'H204',
  variantIds: ['received', 'pending'],
  decisions: [
    { id: 'registry', archiveCode: 'H-204', destination: 'archive', basisDocumentId: DOC_REGISTRY, note: '採用原表，保留補件。' },
    { id: 'supplement', archiveCode: 'H-205', destination: 'archive', basisDocumentId: DOC_SUPPLEMENT, note: '採用補件，保留原表。' },
    { id: 'review', archiveCode: 'H-204', destination: 'review', basisDocumentId: DOC_REGISTRY, note: '待窗口確認。' },
  ],
};
const DIR_CASE: DayDirectory = createDayDirectory(
  [
    day1Plan(DAY1_RECORDS),
    // 核對量取自 task 自己引用的紀錄（2 筆），不是來源批次的 3 筆
    { dayId: DAY_02, dayNumber: 2, nextDayId: DAY_03, tasks: [{ id: TASK_DAY2, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey: 'B102', recordKeys: ['H17', 'B102'] }] },
    {
      dayId: DAY_03,
      dayNumber: 3,
      nextDayId: DAY_04,
      tasks: [
        { id: TASK_CASE_PRE, kind: 'archive', batchId: BATCH_CASE_PRE, recordKeys: ['P1'], caseReviews: [] },
        { id: TASK_CASE, kind: 'archive', batchId: BATCH_CASE, recordKeys: CASE_RECORDS.map((r) => r.key), caseReviews: [CASE_PLAN] },
      ],
    },
    archivePlan(DAY_04, 4, null, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS),
  ],
  { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_CASE_PRE]: CASE_PRE_RECORDS, [BATCH_CASE]: CASE_RECORDS, [BATCH_DAY04]: DAY4_RECORDS },
);

/** 黃金值：rand(1, CASE_ID)=0.338 → received；rand(42, CASE_ID)=0.615 → pending。 */
const SEED_RECEIVED = 1;
const SEED_PENDING = 42;

function caseRecord(key: RecordKey): SourceRecord {
  return record(key, CASE_RECORDS);
}

/** Day 3 次日收件（目前工作是同日第一件普通批次）。 */
function playToCaseMorning(seed: number): Save {
  const wrap = playFull(seed, 'default_false', 'ack', DIR_CASE);
  expect([wrap.dayId, wrap.stage]).toEqual([DAY_02, 'wrap']);
  return advanceDay(wrap, DIR_CASE);
}

/** Day 3 work，目前工作是含案件的批次。 */
function playToCaseTask(seed: number = SEED_RECEIVED): Save {
  let s = startDay(playToCaseMorning(seed));
  expect(s.taskId).toBe(TASK_CASE_PRE);
  s = completeWork(archiveEvery(s, BATCH_CASE_PRE, CASE_PRE_RECORDS), DIR_CASE);
  expect([s.stage, s.taskId]).toEqual(['work', TASK_CASE]);
  return s;
}

function openedCase(seed: number = SEED_RECEIVED): Save {
  return openCase(playToCaseTask(seed), DIR_CASE, CASE_ID);
}

/** 案件以外的紀錄走一般流程。 */
function archiveCaseOthers(save: Save): Save {
  return archiveEvery(save, BATCH_CASE, CASE_RECORDS.filter((r) => r.key !== 'H204'), 'default_false');
}

describe('R9：openCase 變體依 seed＋case ID 選一次並保存', () => {
  it('黃金值：兩個 seed 各自選到不同變體', () => {
    expect(rand(SEED_RECEIVED, CASE_ID)).toBeLessThan(0.5);
    expect(rand(SEED_PENDING, CASE_ID)).toBeGreaterThanOrEqual(0.5);
    expect(caseStateOf(openedCase(SEED_RECEIVED), CASE_ID)).toEqual({ variantId: 'received', marks: [] });
    expect(caseStateOf(openedCase(SEED_PENDING), CASE_ID)).toEqual({ variantId: 'pending', marks: [] });
  });

  it('變體只由 seed 與 case ID 決定，和開案前做了什麼無關', () => {
    for (const seed of [SEED_RECEIVED, SEED_PENDING, 7, 12345]) {
      const expected = CASE_PLAN.variantIds[Math.floor(rand(seed, CASE_ID) * 2)];
      const plain = openCase(playToCaseTask(seed), DIR_CASE, CASE_ID);
      const afterOthers = openCase(archiveCaseOthers(playToCaseTask(seed)), DIR_CASE, CASE_ID);
      expect(caseStateOf(plain, CASE_ID)!.variantId).withContext(`seed ${seed}`).toBe(expected!);
      expect(caseStateOf(afterOthers, CASE_ID)!.variantId).withContext(`seed ${seed}`).toBe(expected!);
    }
  });

  it('未開案前 caseStateOf 為 undefined，開案不寫事件、不改批次', () => {
    const before = playToCaseTask();
    expect(caseStateOf(before, CASE_ID)).toBeUndefined();
    const after = openCase(before, DIR_CASE, CASE_ID);
    expect(after.events).toBe(before.events);
    expect(after.batches).toBe(before.batches);
    expect(Object.keys(after.caseReviews)).toEqual([CASE_ID]);
  });

  it('重複開案回傳同一物件；JSON 往返（重新整理）後再開也不重抽', () => {
    const opened = openedCase(SEED_PENDING);
    expect(openCase(opened, DIR_CASE, CASE_ID)).toBe(opened);
    const reloaded = JSON.parse(JSON.stringify(opened)) as Save;
    expect(validSave(reloaded, DIR_CASE)).toBeTrue();
    expect(openCase(reloaded, DIR_CASE, CASE_ID)).toBe(reloaded);
    expect(caseStateOf(reloaded, CASE_ID)!.variantId).toBe('pending');
  });

  it('已保存的變體即使與目前 seed 算出的不同也保留（不重抽）', () => {
    const tampered: Save = { ...playToCaseTask(SEED_RECEIVED), caseReviews: { [CASE_ID]: { variantId: 'pending', marks: ['姓名'] } } };
    expect(openCase(tampered, DIR_CASE, CASE_ID)).toBe(tampered);
  });

  it('不在 work、案件不屬於目前工作、未知案件 → 原物件', () => {
    const morning = playToCaseMorning(SEED_RECEIVED);
    expect(morning.stage).toBe('morning');
    expect(openCase(morning, DIR_CASE, CASE_ID)).toBe(morning);
    // 同日第一件普通批次進行中
    const pre = startDay(morning);
    expect(openCase(pre, DIR_CASE, CASE_ID)).toBe(pre);
    // 目前工作是案件批次，但階段不是 work
    const task = playToCaseTask();
    const wrapped: Save = { ...task, stage: 'wrap' };
    expect(openCase(wrapped, DIR_CASE, CASE_ID)).toBe(wrapped);
    // 前面的日子也不能提早開後面日子的案件
    const day1 = createSave(SEED_RECEIVED, DIR_CASE);
    expect(openCase(day1, DIR_CASE, CASE_ID)).toBe(day1);
    expect(openCase(task, DIR_CASE, 'case.unknown')).toBe(task);
    // 目錄裡沒有案件
    expect(openCase(task, DIR, CASE_ID)).toBe(task);
  });
});

describe('R9：toggleCaseMark', () => {
  it('標記／取消標記，順序依點選；不影響變體', () => {
    let s = openedCase();
    s = toggleCaseMark(s, DIR_CASE, CASE_ID, '人員編號');
    expect(caseStateOf(s, CASE_ID)).toEqual({ variantId: 'received', marks: ['人員編號'] });
    s = toggleCaseMark(s, DIR_CASE, CASE_ID, '送件時間');
    expect(caseStateOf(s, CASE_ID)!.marks).toEqual(['人員編號', '送件時間']);
    s = toggleCaseMark(s, DIR_CASE, CASE_ID, '人員編號');
    expect(caseStateOf(s, CASE_ID)).toEqual({ variantId: 'received', marks: ['送件時間'] });
    s = toggleCaseMark(s, DIR_CASE, CASE_ID, '送件時間');
    expect(caseStateOf(s, CASE_ID)!.marks).toEqual([]);
    expect(validSave(JSON.parse(JSON.stringify(s)), DIR_CASE)).toBeTrue();
  });

  it('未開案、不在 work、不是目前工作 → 原物件', () => {
    const notOpened = playToCaseTask();
    expect(toggleCaseMark(notOpened, DIR_CASE, CASE_ID, '人員編號')).toBe(notOpened);
    const opened = openedCase();
    const wrapped: Save = { ...opened, stage: 'wrap' };
    expect(toggleCaseMark(wrapped, DIR_CASE, CASE_ID, '人員編號')).toBe(wrapped);
    const onPre: Save = { ...startDay(playToCaseMorning(SEED_RECEIVED)), caseReviews: opened.caseReviews };
    expect(onPre.taskId).toBe(TASK_CASE_PRE);
    expect(toggleCaseMark(onPre, DIR_CASE, CASE_ID, '人員編號')).toBe(onPre);
    expect(toggleCaseMark(opened, DIR_CASE, 'case.unknown', '人員編號')).toBe(opened);
  });

  it('提交決定後鎖定', () => {
    const marked = toggleCaseMark(openedCase(), DIR_CASE, CASE_ID, '人員編號');
    const committed = commitCase(marked, DIR_CASE, caseRecord('H204'), 'supplement', 'H-205');
    expect(caseDecisionOf(committed, DIR_CASE, CASE_ID)).toBe('supplement');
    expect(toggleCaseMark(committed, DIR_CASE, CASE_ID, '人員編號')).toBe(committed);
    expect(toggleCaseMark(committed, DIR_CASE, CASE_ID, '姓名')).toBe(committed);
    expect(caseStateOf(committed, CASE_ID)!.marks).toEqual(['人員編號']);
  });
});

describe('R9／R10：commitCase 三種決定都合法，人員編號是玩家填寫的值', () => {
  const expected: Array<[string, 'archive' | 'review', string, string]> = [
    ['registry', 'archive', DOC_REGISTRY, '採用原表，保留補件。'],
    ['supplement', 'archive', DOC_SUPPLEMENT, '採用補件，保留原表。'],
    ['review', 'review', DOC_REGISTRY, '待窗口確認。'],
  ];
  for (const [decisionId, destination, basis, note] of expected) {
    for (const code of ['H-204', 'H-205', 'h204', ' H-209 ', '0102']) {
      it(`${decisionId} ＋ 編號 ${JSON.stringify(code)}：編號原樣保存、去向 ${destination}，依據與註記存成快照`, () => {
        const opened = openedCase();
        const s = commitCase(opened, DIR_CASE, caseRecord('H204'), decisionId, code);
        const a = archivedIn(s, 'H204', BATCH_CASE);
        expect(a).toEqual({
          archiveCode: code,
          refusal: null,
          origin: 'source',
          source: snapshotOf(caseRecord('H204')),
          caseDecision: { caseId: CASE_ID, decisionId, destination, basisDocumentId: basis, note },
        });
        // 來源快照保留來源登記表的原字串，不被決定或玩家編號改寫
        expect(a.source.code).toBe('H-204');
        expect(caseDecisionOf(s, DIR_CASE, CASE_ID)).toBe(decisionId);
        expect(s.events.slice(opened.events.length)).toEqual([
          {
            id: `archive:${opened.events.length}`,
            kind: 'archive',
            payload: { key: 'H204', origin: 'source', batchId: BATCH_CASE, caseId: CASE_ID, decisionId },
          },
        ]);
        expect(eventDayId(s.events[s.events.length - 1]!, DIR_CASE)).toBe(DAY_03);
        // 案件去向不是拒絕紀錄的 review：不觸發「批次有送覆核」
        expect(batchHasReview(s, BATCH_CASE)).toBeFalse();
        // 閱讀狀態（變體）保留
        expect(caseStateOf(s, CASE_ID)).toEqual(caseStateOf(opened, CASE_ID)!);
        const restored = JSON.parse(JSON.stringify(s)) as Save;
        expect(validSave(restored, DIR_CASE)).toBeTrue();
        expect(caseDecisionOf(restored, DIR_CASE, CASE_ID)).toBe(decisionId);
        expect(archivedIn(restored, 'H204', BATCH_CASE).archiveCode).toBe(code);
      });
    }
  }

  it('決定不覆寫編號：supplement（預設 H-205）配 H-204、registry（預設 H-204）配 H-205 都照玩家的值', () => {
    const sup = archivedIn(commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'supplement', 'H-204'), 'H204', BATCH_CASE);
    expect(sup.archiveCode).toBe('H-204');
    expect(sup.caseDecision!.basisDocumentId).toBe(DOC_SUPPLEMENT);
    const reg = archivedIn(commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'registry', 'H-205'), 'H204', BATCH_CASE);
    expect(reg.archiveCode).toBe('H-205');
    expect(reg.caseDecision!.basisDocumentId).toBe(DOC_REGISTRY);
    const rev = archivedIn(commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'review', 'H-205'), 'H204', BATCH_CASE);
    expect([rev.archiveCode, rev.caseDecision!.destination]).toEqual(['H-205', 'review']);
  });

  it('草稿可同時保存編號與處理方式（Draft.decisionId）；改選方式不動編號，存檔仍合法', () => {
    let s = setDraft(openedCase(), BATCH_CASE, 'H204', { value: 'H-209' });
    s = setDraft(s, BATCH_CASE, 'H204', { ...batchOf(s, BATCH_CASE).drafts['H204']!, decisionId: 'registry' });
    s = setDraft(s, BATCH_CASE, 'H204', { ...batchOf(s, BATCH_CASE).drafts['H204']!, decisionId: 'supplement' });
    expect(batchOf(s, BATCH_CASE).drafts['H204']).toEqual({ value: 'H-209', decisionId: 'supplement' });
    expect(validSave(JSON.parse(JSON.stringify(s)), DIR_CASE)).toBeTrue();
    const draft = batchOf(s, BATCH_CASE).drafts['H204']!;
    const committed = commitCase(s, DIR_CASE, caseRecord('H204'), draft.decisionId!, draft.value);
    expect(archivedIn(committed, 'H204', BATCH_CASE).archiveCode).toBe('H-209');
    expect(caseDecisionOf(committed, DIR_CASE, CASE_ID)).toBe('supplement');
  });

  it('編號只驗型別：空字串、純空白不提交（回傳原物件）', () => {
    const opened = openedCase();
    for (const code of ['', '   ', '\t']) {
      expect(commitCase(opened, DIR_CASE, caseRecord('H204'), 'registry', code)).withContext(JSON.stringify(code)).toBe(opened);
    }
    expect(commitCase(opened, DIR_CASE, caseRecord('H204'), 'registry', 204 as unknown as string)).toBe(opened);
    expect(commitCase(opened, DIR_CASE, caseRecord('H204'), 'registry', null as unknown as string)).toBe(opened);
  });

  it('案件紀錄與另一筆填成相同編號：兩筆各自保存，不合併、不覆蓋', () => {
    let s = commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'registry', '0102');
    s = archiveCaseOthers(s);
    expect(archivedIn(s, 'H204', BATCH_CASE).archiveCode).toBe('0102');
    expect(archivedIn(s, 'C102', BATCH_CASE).archiveCode).toBe('0102');
    expect(archivedIn(s, 'H204', BATCH_CASE).source.code).toBe('H-204');
    expect(archivedIn(s, 'C102', BATCH_CASE).source.code).toBe('0102');
    expect(archivedCount(s, BATCH_CASE)).toBe(3);
    expect(validSave(JSON.parse(JSON.stringify(s)), DIR_CASE)).toBeTrue();
  });

  it('決定之後其他紀錄照一般流程；C102 保留前導零；batchHasReview 只看拒絕紀錄', () => {
    let s = commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'review', 'H-204');
    s = archiveCaseOthers(s);
    expect(archivedIn(s, 'C102', BATCH_CASE)).toEqual({ archiveCode: '0102', refusal: false, origin: 'defaulted', source: snapshotOf(caseRecord('C102')) });
    expect(archivedIn(s, 'T1', BATCH_CASE).archiveCode).toBe('0001');
    expect(archivedIn(s, 'T1', BATCH_CASE).caseDecision).toBeUndefined();
    expect(batchHasReview(s, BATCH_CASE)).toBeFalse();
    const withReview = archiveEvery(commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'registry', 'H-204'), BATCH_CASE, [caseRecord('C102')], 'request_review');
    expect(archivedIn(withReview, 'C102', BATCH_CASE)).toEqual({ archiveCode: '0102', refusal: null, origin: 'review', source: snapshotOf(caseRecord('C102')) });
    expect(batchHasReview(withReview, BATCH_CASE)).toBeTrue();
  });

  it('案件紀錄適用拒絕紀錄且缺值時，仍需 policy，origin 照既有規則', () => {
    const refusalRecords: readonly SourceRecord[] = [{ key: 'H204', name: null, code: 'H-204', refusal: null, refusalApplies: true }];
    const dir = createDayDirectory(
      [{ dayId: DAY_03, dayNumber: 3, nextDayId: null, tasks: [{ id: TASK_CASE, kind: 'archive', batchId: BATCH_CASE, recordKeys: ['H204'], caseReviews: [CASE_PLAN] }] }],
      { [BATCH_CASE]: refusalRecords },
    );
    const opened = openCase(createSave(SEED_RECEIVED, dir), dir, CASE_ID);
    const r = refusalRecords[0]!;
    expect(commitCase(opened, dir, r, 'supplement', 'H-205')).toBe(opened);
    const defaulted = archivedIn(commitCase(opened, dir, r, 'supplement', 'H-205', 'default_false'), 'H204', BATCH_CASE);
    expect([defaulted.archiveCode, defaulted.refusal, defaulted.origin]).toEqual(['H-205', false, 'defaulted']);
    const review = commitCase(opened, dir, r, 'registry', 'X-1', 'request_review');
    expect([archivedIn(review, 'H204', BATCH_CASE).archiveCode, archivedIn(review, 'H204', BATCH_CASE).refusal, archivedIn(review, 'H204', BATCH_CASE).origin]).toEqual(['X-1', null, 'review']);
    expect(archivedIn(review, 'H204', BATCH_CASE).caseDecision!.destination).toBe('archive');
  });

  it('allArchived／completeWork 要等案件紀錄提交；之後進本日交接', () => {
    let s = archiveCaseOthers(openedCase());
    expect(archivedCount(s, BATCH_CASE)).toBe(2);
    expect(allArchived(s, BATCH_CASE, DIR_CASE.records(BATCH_CASE))).toBeFalse();
    expect(completeWork(s, DIR_CASE)).toBe(s);
    s = commitCase(s, DIR_CASE, caseRecord('H204'), 'supplement', 'H-205');
    expect(allArchived(s, BATCH_CASE, DIR_CASE.records(BATCH_CASE))).toBeTrue();
    const wrap = completeWork(s, DIR_CASE);
    expect([wrap.dayId, wrap.stage]).toEqual([DAY_03, 'wrap']);
    expect(validSave(JSON.parse(JSON.stringify(wrap)), DIR_CASE)).toBeTrue();
    // 跨日後決定仍由歸檔快照推導，閱讀狀態保留
    const day4 = toNextDay(wrap, DIR_CASE);
    expect([day4.dayId, day4.stage]).toEqual([DAY_04, 'work']);
    expect(caseDecisionOf(day4, DIR_CASE, CASE_ID)).toBe('supplement');
    expect(caseStateOf(day4, CASE_ID)!.variantId).toBe('received');
    expect(validSave(JSON.parse(JSON.stringify(day4)), DIR_CASE)).toBeTrue();
    // 跨日後也不能再開案或標記
    expect(toggleCaseMark(day4, DIR_CASE, CASE_ID, '姓名')).toBe(day4);
  });
});

describe('R9：commitCase 拒絕的情況（回傳原物件）', () => {
  it('尚未開案', () => {
    const s = playToCaseTask();
    expect(commitCase(s, DIR_CASE, caseRecord('H204'), 'registry', 'H-204')).toBe(s);
  });

  it('重複提交：第一次的決定與編號不變', () => {
    const once = commitCase(openedCase(), DIR_CASE, caseRecord('H204'), 'registry', 'H-204');
    for (const id of ['registry', 'supplement', 'review']) expect(commitCase(once, DIR_CASE, caseRecord('H204'), id, 'H-999')).toBe(once);
    expect(caseDecisionOf(once, DIR_CASE, CASE_ID)).toBe('registry');
    expect(archivedIn(once, 'H204', BATCH_CASE).archiveCode).toBe('H-204');
  });

  it('未知決定、非案件紀錄', () => {
    const s = openedCase();
    expect(commitCase(s, DIR_CASE, caseRecord('H204'), 'nope', 'H-204')).toBe(s);
    expect(commitCase(s, DIR_CASE, caseRecord('H204'), '', 'H-204')).toBe(s);
    expect(commitCase(s, DIR_CASE, caseRecord('T1'), 'registry', '0001')).toBe(s);
    expect(commitCase(s, DIR_CASE, caseRecord('C102'), 'registry', '0102', 'default_false')).toBe(s);
  });

  it('不在 work、目前工作不是案件批次', () => {
    const s = openedCase();
    for (const stage of ['wrap', 'morning', 'end'] as const) {
      const other: Save = { ...s, stage };
      expect(commitCase(other, DIR_CASE, caseRecord('H204'), 'registry', 'H-204')).withContext(stage).toBe(other);
    }
    const onPre: Save = { ...startDay(playToCaseMorning(SEED_RECEIVED)), caseReviews: s.caseReviews };
    expect(commitCase(onPre, DIR_CASE, caseRecord('H204'), 'registry', 'H-204')).toBe(onPre);
  });

  it('已用一般流程歸檔（舊檔、沒有案件決定）：不補造決定，caseDecisionOf 為 null', () => {
    const legacy = putArchived(openedCase(), { H204: { archiveCode: 'H-204', refusal: null, origin: 'source', source: snapshotOf(caseRecord('H204')) } }, BATCH_CASE);
    expect(commitCase(legacy, DIR_CASE, caseRecord('H204'), 'supplement', 'H-205')).toBe(legacy);
    expect(caseDecisionOf(legacy, DIR_CASE, CASE_ID)).toBeNull();
    expect(validSave(legacy, DIR_CASE)).toBeTrue();
  });
});

describe('R9：caseDecisionOf', () => {
  it('未提交、未知案件、目錄沒有案件 → null', () => {
    const s = openedCase();
    expect(caseDecisionOf(s, DIR_CASE, CASE_ID)).toBeNull();
    expect(caseDecisionOf(s, DIR_CASE, 'case.unknown')).toBeNull();
    expect(caseDecisionOf(commitCase(s, DIR_CASE, caseRecord('H204'), 'review', 'H-204'), DIR, CASE_ID)).toBeNull();
  });

  it('快照的 caseId 不是這個案件 → null（不誤認）', () => {
    const s = putArchived(
      openedCase(),
      {
        H204: {
          archiveCode: 'H-204',
          refusal: null,
          origin: 'source',
          source: snapshotOf(caseRecord('H204')),
          caseDecision: { caseId: 'case.other', decisionId: 'registry', destination: 'archive', basisDocumentId: DOC_REGISTRY, note: 'x' },
        },
      },
      BATCH_CASE,
    );
    expect(caseDecisionOf(s, DIR_CASE, CASE_ID)).toBeNull();
  });
});

describe('R9：核對量與四格判定', () => {
  it('核對工作的 recordKeys 只列 task 引用的紀錄（2 筆），來源批次仍是 3 筆', () => {
    const task = DIR_CASE.plan(DAY_02)!.tasks[0]!;
    expect(task.kind).toBe('reconcile');
    if (task.kind !== 'reconcile') return;
    expect(task.recordKeys.length).toBe(2);
    expect(DIR_CASE.records(task.sourceBatchId).length).toBe(3);
  });

  it('四格結果不變：B102 false／null × 介入有無', () => {
    for (const [policy, seed, arranged] of [
      ['default_false', SEED_NO_INTERVENE, true],
      ['default_false', SEED_INTERVENE, true],
      ['request_review', SEED_NO_INTERVENE, false],
      ['request_review', SEED_INTERVENE, true],
    ] as const) {
      const s = playToDay2(seed, policy, DIR_CASE);
      expect(isArrangedInSave(s, DIR_CASE)).withContext(`${policy}/${seed}`).toBe(arranged);
    }
  });
});

describe('R9：同日「案件批次 → 核對該批次」時，已決定的案件存檔仍合法', () => {
  const TASK_CHECK = 'task.day3.check-case';
  const DIR_CASE_CHECK: DayDirectory = createDayDirectory(
    [
      day1Plan(DAY1_RECORDS),
      { dayId: DAY_02, dayNumber: 2, nextDayId: DAY_03, tasks: [{ id: TASK_DAY2, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey: 'B102', recordKeys: ['H17', 'B102'] }] },
      {
        dayId: DAY_03,
        dayNumber: 3,
        nextDayId: DAY_04,
        tasks: [
          { id: TASK_CASE_PRE, kind: 'archive', batchId: BATCH_CASE_PRE, recordKeys: ['P1'], caseReviews: [] },
          { id: TASK_CASE, kind: 'archive', batchId: BATCH_CASE, recordKeys: CASE_RECORDS.map((r) => r.key), caseReviews: [CASE_PLAN] },
          { id: TASK_CHECK, kind: 'reconcile', sourceBatchId: BATCH_CASE, subjectKey: 'H204', recordKeys: ['H204'] },
        ],
      },
      archivePlan(DAY_04, 4, null, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS),
    ],
    { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_CASE_PRE]: CASE_PRE_RECORDS, [BATCH_CASE]: CASE_RECORDS, [BATCH_DAY04]: DAY4_RECORDS },
  );

  for (const decisionId of ['registry', 'supplement', 'review']) {
    it(`${decisionId}：交付案件批次後，目前工作是核對，存檔仍通過驗證`, () => {
      let s = startDay(advanceDay(playFull(SEED_RECEIVED, 'default_false', 'ack', DIR_CASE_CHECK), DIR_CASE_CHECK));
      s = completeWork(archiveEvery(s, BATCH_CASE_PRE, CASE_PRE_RECORDS), DIR_CASE_CHECK);
      s = openCase(s, DIR_CASE_CHECK, CASE_ID);
      s = commitCase(s, DIR_CASE_CHECK, caseRecord('H204'), decisionId, 'H-2O4');
      s = completeWork(archiveCaseOthers(s), DIR_CASE_CHECK);
      expect([s.stage, s.taskId]).toEqual(['work', TASK_CHECK]);
      expect(isValidSave(JSON.parse(JSON.stringify(s)), DIR_CASE_CHECK)).toBeTrue();
    });
  }
});

describe('R9：openCase 對已歸檔的案件紀錄不動作', () => {
  it('舊檔已把 H204 以來源編號歸檔（沒有案件決定）→ 不抽變體、不寫閱讀狀態', () => {
    const s = playToCaseTask();
    const legacy = commitArchive(s, BATCH_CASE, caseRecord('H204'), { ok: true, code: 'H-204', refusal: null, origin: 'source' });
    expect(openCase(legacy, DIR_CASE, CASE_ID)).toBe(legacy);
  });
});

/* ---------- R10：人員編號只驗型別、照玩家輸入保存 ---------- */

describe('R10：歸檔編號照玩家輸入保存（不比對來源）', () => {
  /** 以真正的 validateRecord 走完整提交流程；value 為玩家輸入。 */
  function archiveTyped(save: Save, key: RecordKey, value: string, batchId: BatchId = BATCH_DAY01): Save {
    const s = setDraft(save, batchId, key, { value, policy: 'default_false' });
    const v = validateRecord(record(key), batchOf(s, batchId).drafts[key]!);
    if (!v.ok) throw new Error(`validation failed for ${key}: ${v.error}`);
    return commitArchive(s, batchId, record(key), v);
  }

  for (const value of ['0102', '102', '0103', '  x ']) {
    it(`來源 "0102"、輸入 ${JSON.stringify(value)} → archiveCode 原樣保存，來源快照仍是 "0102"；刷新、跨日不被修回`, () => {
      let s = archiveTyped(createSave(1, DIR6), 'B102', value);
      expect(archivedIn(s, 'B102').archiveCode).toBe(value);
      expect(archivedIn(s, 'B102').source.code).toBe('0102');
      const restored = JSON.parse(JSON.stringify(s)) as Save;
      expect(validSave(restored, DIR6)).toBeTrue();
      expect(archivedIn(restored, 'B102').archiveCode).toBe(value);
      // 完成當日並跨日：Day 2 核對看的是同一份提交
      s = archiveTyped(archiveTyped(restored, 'H17', 'H-17'), 'B607', '0607');
      s = toNextDay(completeWork(s, DIR6), DIR6);
      expect([s.dayId, s.stage]).toEqual([DAY_02, 'work']);
      expect(archivedIn(s, 'B102').archiveCode).toBe(value);
      expect(validSave(JSON.parse(JSON.stringify(s)), DIR6)).toBeTrue();
      // 審查快照取前一階段保存的 archiveCode，不取來源
      s = setRecordReview(s, DIR6, 'B102', 'hold');
      expect(reconcileProgressOf(s, TASK_DAY2).reviews!['B102']).toEqual(day1Review('B102', 'hold', value));
    });
  }

  it('兩筆填成相同編號：各自以 recordKey 保存，不互相覆蓋或合併', () => {
    let s = archiveTyped(createSave(1, DIR), 'B102', '0607');
    s = archiveTyped(s, 'B607', '0607');
    expect(archivedCount(s, BATCH_DAY01)).toBe(2);
    expect(archivedIn(s, 'B102')).toEqual({ archiveCode: '0607', refusal: false, origin: 'defaulted', source: snapshotOf(record('B102')) });
    expect(archivedIn(s, 'B607')).toEqual({ archiveCode: '0607', refusal: true, origin: 'source', source: snapshotOf(record('B607')) });
    expect(s.events.filter((e) => e.kind === 'archive').map((e) => (e.payload as { key: string }).key)).toEqual(['B102', 'B607']);
    const restored = JSON.parse(JSON.stringify(archiveTyped(s, 'H17', 'H-17'))) as Save;
    expect(validSave(restored)).toBeTrue();
    expect(validSave(completeWork(restored, DIR))).toBeTrue();
  });

  it('commitArchive 直接使用 ok.code（不以來源值覆寫）', () => {
    const s = commitArchive(createSave(1, DIR), BATCH_DAY01, record('H17'), { ok: true, code: 'h-17 ', refusal: null, origin: 'source' });
    expect(archivedIn(s, 'H17').archiveCode).toBe('h-17 ');
    expect(archivedIn(s, 'H17').source.code).toBe('H-17');
  });
});

/* ---------- R10：第二輪逐筆審查 ---------- */

describe('R10：setRecordReview 逐筆審查處置', () => {
  /** Day 2 work：B102 輸入 "102"（與來源不同），其餘照來源。 */
  function day2With102(): Save {
    let s = createSave(SEED_NO_INTERVENE, DIR_CASE);
    s = archiveEvery(s, BATCH_DAY01, DAY1_RECORDS.filter((r) => r.key !== 'B102'));
    s = setDraft(s, BATCH_DAY01, 'B102', { value: '102', policy: 'default_false' });
    s = commitArchive(s, BATCH_DAY01, record('B102'), okFor('B102', { value: '102', policy: 'default_false' }));
    return toNextDay(completeWork(s, DIR_CASE), DIR_CASE);
  }

  it('保存處置與所看的版本，附上來源批次／歸檔工作／recordKey／sourceCode／reviewedCode', () => {
    const day2 = day2With102();
    expect([day2.dayId, day2.taskId]).toEqual([DAY_02, TASK_DAY2]);
    const s = setRecordReview(day2, DIR_CASE, 'B102', 'release');
    expect(reconcileProgressOf(s, TASK_DAY2).reviews).toEqual({
      B102: { disposition: 'release', batchId: BATCH_DAY01, archiveTaskId: TASK_DAY1, recordKey: 'B102', sourceCode: '0102', reviewedCode: '102' },
    });
    expect(s.events.slice(day2.events.length)).toEqual([
      { id: `record.review:${day2.events.length}`, kind: 'record.review', payload: { taskId: TASK_DAY2, key: 'B102', disposition: 'release' } },
    ]);
    expect(eventDayId(s.events[s.events.length - 1]!, DIR_CASE)).toBe(DAY_02);
    // 審查不改提交本身
    expect(s.batches).toBe(day2.batches);
    expect(validSave(JSON.parse(JSON.stringify(s)), DIR_CASE)).toBeTrue();
  });

  it('回覆前可以改變處置；同一處置重複點擊回傳同一物件；回覆後鎖定', () => {
    let s = setRecordReview(day2With102(), DIR_CASE, 'B102', 'release');
    expect(setRecordReview(s, DIR_CASE, 'B102', 'release')).toBe(s);
    s = setRecordReview(s, DIR_CASE, 'B102', 'hold');
    expect(reconcileProgressOf(s, TASK_DAY2).reviews!['B102']!.disposition).toBe('hold');
    s = setRecordReview(s, DIR_CASE, 'B102', 'release');
    expect(reconcileProgressOf(s, TASK_DAY2).reviews!['B102']!.disposition).toBe('release');
    expect(s.events.filter((e) => e.kind === 'record.review').map((e) => (e.payload as { disposition: string }).disposition)).toEqual([
      'release',
      'hold',
      'release',
    ]);
    s = setRecordReview(s, DIR_CASE, 'H17', 'hold');
    const replied = submitReply(markReportOpened(s, DIR_CASE), DIR_CASE, 'ack');
    expect(replied.stage).toBe('wrap');
    const reopened: Save = { ...replied, stage: 'work' };
    expect(setRecordReview(reopened, DIR_CASE, 'B102', 'hold')).toBe(reopened);
    expect(reconcileProgressOf(replied, TASK_DAY2).reviews!['B102']!.disposition).toBe('release');
  });

  it('canReply 要求工作引用的每一筆都已審查（部分審查仍不能回覆）', () => {
    let s = markReceiptOpened(markReportOpened(day2With102(), DIR_CASE), DIR_CASE);
    for (const reply of REPLIES) expect(canReply(s, DIR_CASE, reply)).toBeFalse();
    s = setRecordReview(s, DIR_CASE, 'B102', 'release');
    for (const reply of REPLIES) expect(canReply(s, DIR_CASE, reply)).toBeFalse();
    s = setRecordReview(s, DIR_CASE, 'H17', 'hold');
    for (const reply of REPLIES) expect(canReply(s, DIR_CASE, reply)).toBeTrue();
  });

  it('不在工作範圍的紀錄、未知處置、非核對工作、非 work → 原物件', () => {
    const day2 = day2With102();
    // B607 在來源批次中，但不在這件核對工作的 recordKeys
    expect(setRecordReview(day2, DIR_CASE, 'B607', 'release')).toBe(day2);
    expect(setRecordReview(day2, DIR_CASE, 'ZZZ', 'release')).toBe(day2);
    expect(setRecordReview(day2, DIR_CASE, 'B102', 'approve' as ReviewDisposition)).toBe(day2);
    const morning: Save = { ...day2, stage: 'morning' };
    expect(setRecordReview(morning, DIR_CASE, 'B102', 'release')).toBe(morning);
    const day1 = createSave(1, DIR_CASE);
    expect(setRecordReview(day1, DIR_CASE, 'B102', 'release')).toBe(day1);
  });

  it('來源紀錄尚未歸檔（手造）→ 原物件，不補造審查版本', () => {
    const day2 = day2With102();
    const b = batchOf(day2, BATCH_DAY01);
    const archived = { ...b.archived };
    delete archived['B102'];
    const missing: Save = { ...day2, batches: { [BATCH_DAY01]: { ...b, archived } } };
    expect(setRecordReview(missing, DIR_CASE, 'B102', 'release')).toBe(missing);
  });
});

/* ---------- R10／R11：延後退件 → 持續的文件問題案件 ---------- */

const AUDIT_ID = 'audit.test.day1-code';
const RET_B102 = `return.${AUDIT_ID}.B102`;
const RET_B607 = `return.${AUDIT_ID}.B607`;

const issDayId = (n: number): string => `day.${String(n).padStart(2, '0')}`;
const issTaskId = (n: number): string => `task.day${n}.archive`;
const issSlotId = (n: number): string => `task.day${n}.return-review`;
const issBatchId = (n: number): BatchId => `batch.day${String(n).padStart(2, '0')}.archive`;
/** Day 3 起每天一筆測試紀錄（拒絕紀錄已附，不需 policy）。 */
function issRecords(n: number): readonly SourceRecord[] {
  return [{ key: `R${n}`, name: null, code: String(n * 100 + 1).padStart(4, '0'), refusal: false, refusalApplies: true }];
}

/**
 * 測試自建（≥ 6 天）：Day 1 歸檔（H17 H-17、B102 0102、B607 0607）→ Day 2 核對 [B102, B607]＋下游稽核（Day 3 通知）
 * → Day 3…Day N 各一件歸檔，第一件之後各有一個錯誤文件處理位置 { kind: 'return-review', dayId }。
 * 稽核不綁定複審工作；錯誤文件處理也不綁定稽核或特定日子。
 */
function issueDirectory(lastDay: number): DayDirectory {
  const plans: DayPlan[] = [
    day1Plan(DAY1_RECORDS),
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
          returnAudit: { id: AUDIT_ID, notifyDayId: DAY_03 },
        },
      ],
    },
  ];
  const records: Record<BatchId, readonly SourceRecord[]> = { [BATCH_DAY01]: DAY1_RECORDS };
  for (let n = 3; n <= lastDay; n++) {
    records[issBatchId(n)] = issRecords(n);
    plans.push({
      dayId: issDayId(n),
      dayNumber: n,
      nextDayId: n < lastDay ? issDayId(n + 1) : null,
      tasks: [
        { id: issTaskId(n), kind: 'archive', batchId: issBatchId(n), recordKeys: issRecords(n).map((r) => r.key), caseReviews: [] },
        { id: issSlotId(n), kind: 'return-review', dayId: issDayId(n) },
      ],
    });
  }
  return createDayDirectory(plans, records);
}

const DIR_ISS = issueDirectory(6);
const DIR_ISS_LONG = issueDirectory(14);
const slotOf = (n: number, dir: DayDirectory = DIR_ISS): TaskPlan => dir.plan(issDayId(n))!.tasks[1]!;

type IssCodes = Partial<Record<RecordKey, string>>;
type IssReviews = Partial<Record<'B102' | 'B607', ReviewDisposition>>;
const WRONG: IssCodes = { B102: '102' };
const RELEASE_BOTH: IssReviews = { B102: 'release', B607: 'release' };

/** Day 1：依玩家輸入歸檔（未指定者照來源）→ wrap。 */
function issDay1Wrap(codes: IssCodes = {}, dir: DayDirectory = DIR_ISS): Save {
  let s = createSave(SEED_NO_INTERVENE, dir);
  for (const r of DAY1_RECORDS) {
    const draft: Draft = { value: codes[r.key] ?? r.code, policy: 'default_false' };
    s = setDraft(s, BATCH_DAY01, r.key, draft);
    s = commitArchive(s, BATCH_DAY01, r, okFor(r.key, draft));
  }
  return completeWork(s, dir);
}

/** Day 2：開摘要、逐筆審查、回覆 → wrap。 */
function issDay2Wrap(codes: IssCodes = WRONG, reviews: IssReviews = RELEASE_BOTH, dir: DayDirectory = DIR_ISS, reply: Reply = 'ack'): Save {
  let s = markReportOpened(toNextDay(issDay1Wrap(codes, dir), dir), dir);
  for (const key of ['B102', 'B607'] as const) s = setRecordReview(s, dir, key, reviews[key] ?? 'release');
  s = submitReply(s, dir, reply);
  expect([s.dayId, s.stage]).toEqual([DAY_02, 'wrap']);
  return s;
}

/** Day 3 次日收件（通知日）。 */
function issDay3Morning(codes: IssCodes = WRONG, reviews: IssReviews = RELEASE_BOTH, dir: DayDirectory = DIR_ISS): Save {
  return advanceDay(issDay2Wrap(codes, reviews, dir), dir);
}

/** 當日歸檔做完並交付：錯誤文件處理適用且未完成時停在它（work），否則進 wrap／end。 */
function issArchiveToday(s: Save, dir: DayDirectory = DIR_ISS): Save {
  const n = dir.plan(s.dayId)!.dayNumber;
  return completeWork(archiveEvery(s, issBatchId(n), issRecords(n)), dir);
}

/** 完成當日（錯誤文件處理若適用，呼叫端須先處理好）→ wrap／end。 */
function issFinishDay(s: Save, dir: DayDirectory = DIR_ISS): Save {
  let t = s;
  if (activeTaskOf(t, dir).kind === 'archive') t = issArchiveToday(t, dir);
  if (t.stage === 'work') t = completeWork(t, dir);
  if (t.stage !== 'wrap' && t.stage !== 'end') throw new Error(`${t.dayId} not finished (${t.taskId})`);
  return t;
}

/** 一路照規則走到 Demo 結束（途中的錯誤文件處理必須已不再待修正）。 */
function issRunToEnd(s: Save, dir: DayDirectory = DIR_ISS): Save {
  let t = s;
  for (let guard = 0; t.stage !== 'end' && guard < 60; guard++) {
    if (t.stage === 'morning') t = startDay(t);
    else if (t.stage === 'work') t = issFinishDay(t, dir);
    else t = advanceDay(t, dir);
  }
  expect(t.stage).toBe('end');
  return t;
}

/** Day 4 次日收件（案件在 Day 3 建立、未提前處理 → Day 4 排入）。 */
function issDay4Morning(codes: IssCodes = WRONG, reviews: IssReviews = RELEASE_BOTH): Save {
  return advanceDay(issFinishDay(startDay(issDay3Morning(codes, reviews))), DIR_ISS);
}

/** Day 4：交付歸檔後停在錯誤文件處理。 */
function issDay4Slot(codes: IssCodes = WRONG, reviews: IssReviews = RELEASE_BOTH): Save {
  const s = issArchiveToday(startDay(issDay4Morning(codes, reviews)));
  expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_04, 'work', issSlotId(4)]);
  return s;
}

function countKind(save: Save, kind: string): number {
  return save.events.filter((e) => e.kind === kind).length;
}

function reloadValid(save: Save, dir: DayDirectory = DIR_ISS): boolean {
  return validSave(JSON.parse(JSON.stringify(save)), dir);
}

const RECEIPT_0: ReturnReceipt = { id: `${RET_B102}#0`, kind: 'returned', dayId: DAY_03, versionIndex: null, code: '102', reason: 'code-mismatch' };

/** 目前可修訂的回條 ID（R12 版本鎖定）；沒有可修訂的回條時為 ''（任何修訂操作都會被拒絕）。 */
function editableId(save: Save, returnId: string): string {
  const item = save.returns.find((r) => r.id === returnId);
  return (item ? editableReceiptOf(item)?.id : undefined) ?? '';
}

/** R11 的操作語意：玩家開啟的正是案件目前可修訂的回條（R12 起必須明確傳入）。 */
function resubmitNow(save: Save, dir: DayDirectory, returnId: string, code: string): Save {
  return resubmitReturn(save, dir, returnId, code, editableId(save, returnId));
}

function windowNow(save: Save, dir: DayDirectory, returnId: string): Save {
  return sendReturnToWindow(save, dir, returnId, editableId(save, returnId));
}

describe('R11：文件問題案件的建立（進入通知日）', () => {
  it('B102 輸入 "102"＋放行 → 進入 Day 3 建立一案：待修正、dueDayId＝Day 4、初次退件回條 #0；Day 3 不排入、錯誤文件處理不適用', () => {
    const wrap2 = issDay2Wrap();
    expect(wrap2.returns).toEqual([]);
    expect(returnNotified(wrap2, DIR_ISS, AUDIT_ID)).toBeFalse();

    const day3 = advanceDay(wrap2, DIR_ISS);
    expect([day3.dayId, day3.stage, day3.taskId]).toEqual([DAY_03, 'morning', issTaskId(3)]);
    expect(day3.returns).toEqual([
      {
        id: RET_B102,
        auditId: AUDIT_ID,
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
        dueDayId: DAY_04,
        versions: [],
        receipts: [RECEIPT_0],
      },
    ]);
    expect(day3.issueSchedule).toEqual({});
    // R12：建立回條的同時寄出一封郵件（未讀）
    expect(day3.mailbox).toEqual([receiptMail(day3.returns[0]!, RECEIPT_0)]);
    expect(day3.readMail).toEqual([]);
    expect(scheduledIssues(day3, DAY_03)).toEqual([]);
    expect(isTaskApplicable(day3, slotOf(3))).toBeFalse();
    expect(isTaskDone(day3, DIR_ISS, slotOf(3))).toBeFalse();
    expect(isTaskSettled(day3, DIR_ISS, slotOf(3))).toBeTrue();
    const notified = day3.events.filter((e) => e.kind === 'return.notified');
    expect(notified.map((e) => e.payload)).toEqual([{ dayId: DAY_03, auditId: AUDIT_ID, count: 1 }]);
    expect(eventDayId(notified[0]!, DIR_ISS)).toBe(DAY_03);
    expect(countKind(day3, 'return.checked')).toBe(0);
    expect(returnNotified(day3, DIR_ISS, AUDIT_ID)).toBeTrue();
    expect(returnsOfAudit(day3, AUDIT_ID).length).toBe(1);
    expect(returnsOfAudit(day3, 'audit.other')).toEqual([]);
    expect(reloadValid(day3)).toBeTrue();
    // Day 3 交付第一件後直接日結：空的錯誤文件處理不佔佇列
    const wrap3 = issArchiveToday(startDay(day3));
    expect([wrap3.stage, wrap3.taskId]).toEqual(['wrap', issTaskId(3)]);
    expect(reloadValid(wrap3)).toBeTrue();
  });

  it('下一工作日（Day 4）次日收件時排入：issueSchedule[day.04]＝[案件]；錯誤文件處理適用、排在第一件之後；未處理不能交付', () => {
    const day4 = issDay4Morning();
    expect([day4.dayId, day4.stage, day4.taskId]).toEqual([DAY_04, 'morning', issTaskId(4)]);
    expect(day4.issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
    expect(scheduledIssues(day4, DAY_04).map((r) => r.id)).toEqual([RET_B102]);
    expect(scheduledIssues(day4, DAY_05)).toEqual([]);
    // 跨日本身不增加回條、不改變狀態
    expect(day4.returns[0]!.receipts).toEqual([RECEIPT_0]);
    expect(day4.returns[0]!.status).toBe('pending');
    expect(isTaskApplicable(day4, slotOf(4))).toBeTrue();
    expect(isTaskDone(day4, DIR_ISS, slotOf(4))).toBeFalse();
    expect(isTaskSettled(day4, DIR_ISS, slotOf(4))).toBeFalse();
    expect(isTaskApplicable(day4, slotOf(3))).toBeFalse();
    expect(isTaskApplicable(day4, slotOf(5))).toBeFalse();
    expect(reloadValid(day4)).toBeTrue();
    const work = startDay(day4);
    expect(nextOpenTask(work, DIR_ISS, issTaskId(4))!.id).toBe(issSlotId(4));
    const onSlot = issArchiveToday(work);
    expect([onSlot.dayId, onSlot.stage, onSlot.taskId]).toEqual([DAY_04, 'work', issSlotId(4)]);
    expect(activeTaskOf(onSlot, DIR_ISS).kind).toBe('return-review');
    expect(currentBatchId(onSlot, DIR_ISS)).toBeNull();
    expect(completeWork(onSlot, DIR_ISS)).toBe(onSlot);
    expect(reloadValid(onSlot)).toBeTrue();
  });

  it('重跑 advanceDay、刷新（JSON 往返）都不重複建立、通知或排程', () => {
    const day3 = issDay3Morning();
    expect(advanceDay(day3, DIR_ISS)).toBe(day3);
    const reloaded = JSON.parse(JSON.stringify(day3)) as Save;
    expect(validSave(reloaded, DIR_ISS)).toBeTrue();
    expect(advanceDay(reloaded, DIR_ISS)).toBe(reloaded);
    // 手造「已有案件卻又從 Day 2 跨日」：以穩定 ID 去重，不再寫事件、不再加回條
    const replay = advanceDay({ ...reloaded, dayId: DAY_02, stage: 'wrap', taskId: TASK_DAY2 }, DIR_ISS);
    expect(replay.returns).toEqual(reloaded.returns);
    expect(countKind(replay, 'return.notified')).toBe(1);
    // 手造「重跑進入 Day 4」：排程只在第一次進入時決定
    const day4 = issDay4Morning();
    const replay4 = advanceDay({ ...day4, dayId: DAY_03, stage: 'wrap', taskId: issTaskId(3) }, DIR_ISS);
    expect(replay4.issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
    expect(replay4.returns).toEqual(day4.returns);
    expect(countKind(replay4, 'return.notified')).toBe(1);
    // 已排過的日子不重算：即使案件已不再待修正，排程仍維持原狀
    const handled = { ...day4, returns: [{ ...day4.returns[0]!, status: 'awaiting-window' as const, dueDayId: null }] };
    expect(advanceDay({ ...handled, dayId: DAY_03, stage: 'wrap', taskId: issTaskId(3) }, DIR_ISS).issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
  });

  it('兩筆都填錯且都放行 → 兩案（各自獨立、依 recordKeys 順序）同時排入 Day 4；兩案都處理完才能交付', () => {
    const codes = { B102: '102', B607: '607' };
    const day3 = issDay3Morning(codes);
    expect(day3.returns.map((r) => [r.id, r.recordKey, r.sourceCode, r.submittedCode, r.dueDayId])).toEqual([
      [RET_B102, 'B102', '0102', '102', DAY_04],
      [RET_B607, 'B607', '0607', '607', DAY_04],
    ]);
    expect(day3.returns.map((r) => r.receipts.map((x) => x.id))).toEqual([[`${RET_B102}#0`], [`${RET_B607}#0`]]);
    expect(day3.events.filter((e) => e.kind === 'return.notified').map((e) => e.payload)).toEqual([{ dayId: DAY_03, auditId: AUDIT_ID, count: 2 }]);
    const onSlot = issDay4Slot(codes);
    expect(onSlot.issueSchedule).toEqual({ [DAY_04]: [RET_B102, RET_B607] });
    expect(scheduledIssues(onSlot, DAY_04).map((r) => r.id)).toEqual([RET_B102, RET_B607]);
    let s = resubmitNow(onSlot, DIR_ISS, RET_B607, '6O7');
    expect(isTaskDone(s, DIR_ISS, slotOf(4))).toBeFalse();
    expect(completeWork(s, DIR_ISS)).toBe(s);
    expect(reloadValid(s)).toBeTrue();
    s = windowNow(s, DIR_ISS, RET_B102);
    expect(isTaskDone(s, DIR_ISS, slotOf(4))).toBeTrue();
    expect(s.returns.map((r) => [r.recordKey, r.status, r.versions.map((v) => v.code)])).toEqual([
      ['B102', 'awaiting-window', ['102']],
      ['B607', 'awaiting-check', ['6O7']],
    ]);
    const wrap = completeWork(s, DIR_ISS);
    expect([wrap.stage, wrap.taskId]).toEqual(['wrap', issSlotId(4)]);
    expect(reloadValid(wrap)).toBeTrue();
  });

  const none: Array<[string, IssCodes, IssReviews]> = [
    ['正確編號＋放行', {}, RELEASE_BOTH],
    ['填錯＋保留待查', WRONG, { B102: 'hold', B607: 'release' }],
    ['兩筆填錯＋都保留待查', { B102: '102', B607: '607' }, { B102: 'hold', B607: 'hold' }],
    ['H17 填錯但不在第二輪審查範圍', { H17: 'H17' }, RELEASE_BOTH],
    ['正確編號＋兩筆都保留待查', {}, { B102: 'hold', B607: 'hold' }],
  ];
  for (const [label, codes, reviews] of none) {
    it(`不產生案件：${label}；每天的錯誤文件處理都不適用、不佔佇列，一路到結束`, () => {
      const day3 = issDay3Morning(codes, reviews);
      expect(day3.returns).toEqual([]);
      expect(countKind(day3, 'return.notified')).toBe(0);
      expect(returnNotified(day3, DIR_ISS, AUDIT_ID)).toBeFalse();
      const day4 = startDay(advanceDay(issFinishDay(startDay(day3)), DIR_ISS));
      expect(day4.taskId).toBe(issTaskId(4));
      expect(day4.issueSchedule).toEqual({});
      expect(isTaskApplicable(day4, slotOf(4))).toBeFalse();
      expect(isTaskDone(day4, DIR_ISS, slotOf(4))).toBeFalse();
      expect(isTaskSettled(day4, DIR_ISS, slotOf(4))).toBeTrue();
      expect(nextOpenTask(day4, DIR_ISS, issTaskId(4))).toBeNull();
      const end = issRunToEnd(day4);
      expect([end.dayId, end.taskId]).toEqual([issDayId(6), issTaskId(6)]);
      const delivered = end.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId);
      for (const n of [3, 4, 5, 6]) expect(delivered).not.toContain(issSlotId(n));
      expect(end.issueSchedule).toEqual({});
      expect(reloadValid(end)).toBeTrue();
    });
  }

  it('比對是逐字的：輸入 "0102 "（多一個空白）＋放行 → 也視為與來源不一致而建立案件', () => {
    const day3 = issDay3Morning({ B102: '0102 ' });
    expect(day3.returns.map((r) => [r.recordKey, r.submittedCode, r.receipts[0]!.code])).toEqual([['B102', '0102 ', '0102 ']]);
  });

  it('只有其中一筆「填錯＋放行」才建立：B102 填錯放行、B607 填錯保留 → 只有 B102', () => {
    const day3 = issDay3Morning({ B102: '102', B607: '607' }, { B102: 'release', B607: 'hold' });
    expect(day3.returns.map((r) => r.recordKey)).toEqual(['B102']);
  });

  it('放行後在回覆前改成保留待查 → 以最後的處置為準，不建立案件', () => {
    let s = markReportOpened(toNextDay(issDay1Wrap(WRONG), DIR_ISS), DIR_ISS);
    s = setRecordReview(s, DIR_ISS, 'B102', 'release');
    s = setRecordReview(s, DIR_ISS, 'B607', 'release');
    s = setRecordReview(s, DIR_ISS, 'B102', 'hold');
    const day3 = advanceDay(submitReply(s, DIR_ISS, 'ask'), DIR_ISS);
    expect(day3.returns).toEqual([]);
  });

  it('只確認收件（沒有逐筆審查）無法回覆，因此也不會建立案件', () => {
    const s = markReceiptOpened(markReportOpened(toNextDay(issDay1Wrap(WRONG), DIR_ISS), DIR_ISS), DIR_ISS);
    for (const reply of REPLIES) expect(submitReply(s, DIR_ISS, reply)).toBe(s);
  });

  it('舊檔（Day 2 已回覆但沒有審查處置）→ 不補造放行、不追罰；錯誤文件處理從不適用，可一路結束', () => {
    const day2 = toNextDay(issDay1Wrap(WRONG), DIR_ISS);
    const legacy: Save = {
      ...day2,
      stage: 'wrap',
      taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ack' } },
    };
    expect(validSave(legacy, DIR_ISS)).toBeTrue();
    const day3 = advanceDay(legacy, DIR_ISS);
    expect(day3.returns).toEqual([]);
    expect(returnNotified(day3, DIR_ISS, AUDIT_ID)).toBeFalse();
    const end = issRunToEnd(day3);
    expect(end.returns).toEqual([]);
    expect(end.issueSchedule).toEqual({});
    expect(reloadValid(end)).toBeTrue();
  });

  it('跨到非通知日不會建立案件', () => {
    const day4 = issDay4Morning({}, RELEASE_BOTH);
    expect(day4.returns).toEqual([]);
    expect(countKind(day4, 'return.notified')).toBe(0);
  });
});

describe('R11：重送不等於正確（下一工作日由下游核對）', () => {
  it('Day 4 錯誤文件處理重送仍錯的 "102"：已重送／待核對（版本 0 預定 Day 5 核對）；本日處理已交付但案件未解決；原提交不被覆寫', () => {
    const onSlot = issDay4Slot();
    const n = onSlot.events.length;
    const s = resubmitNow(onSlot, DIR_ISS, RET_B102, '102');
    const item = s.returns[0]!;
    expect(item.status).toBe('awaiting-check');
    expect(item.dueDayId).toBeNull();
    expect(item.versions).toEqual([{ index: 0, action: 'resubmit', code: '102', dayId: DAY_04, checkDayId: DAY_05 }]);
    expect('outcome' in item.versions[0]!).toBeFalse();
    // 送出當下不核對、不加回條
    expect(item.receipts).toEqual([RECEIPT_0]);
    expect([item.sourceCode, item.submittedCode, item.reviewedCode]).toEqual(['0102', '102', '102']);
    expect(archivedIn(s, 'B102').archiveCode).toBe('102');
    expect(reconcileProgressOf(s, TASK_DAY2).reviews!['B102']!.reviewedCode).toBe('102');
    expect(s.events.slice(n)).toEqual([
      { id: `return.resubmit:${n}`, kind: 'return.resubmit', payload: { dayId: DAY_04, returnId: RET_B102, versionIndex: 0 } },
    ]);
    expect(eventDayId(s.events[n]!, DIR_ISS)).toBe(DAY_04);
    expect(isTaskDone(s, DIR_ISS, slotOf(4))).toBeTrue();
    expect(reloadValid(s)).toBeTrue();
    // 同一版本不能重複送出（狀態已不是待修正）
    expect(resubmitNow(s, DIR_ISS, RET_B102, '0102')).toBe(s);
    expect(resubmitNow(s, DIR_ISS, RET_B102, '102')).toBe(s);
    expect(windowNow(s, DIR_ISS, RET_B102)).toBe(s);
    const wrap = completeWork(s, DIR_ISS);
    expect([wrap.dayId, wrap.stage, wrap.taskId]).toEqual([DAY_04, 'wrap', issSlotId(4)]);
    expect(wrap.events.slice(-2).map((e) => e.kind)).toEqual(['task.complete', 'day.complete']);
    expect(wrap.events[wrap.events.length - 2]!.payload).toEqual({ dayId: DAY_04, taskId: issSlotId(4) });
    // 交付不等於結案
    expect(wrap.returns[0]!.status).toBe('awaiting-check');
    expect(reloadValid(wrap)).toBeTrue();
  });

  it('Day 5 進入時核對一次：仍不一致 → 同一案再次退回（回條 #1、原因 code-mismatch）、待修正、dueDayId＝Day 6；Day 5 不排入', () => {
    const wrap4 = completeWork(resubmitNow(issDay4Slot(), DIR_ISS, RET_B102, '102'), DIR_ISS);
    const day5 = advanceDay(wrap4, DIR_ISS);
    expect([day5.dayId, day5.stage, day5.taskId]).toEqual([DAY_05, 'morning', issTaskId(5)]);
    expect(day5.returns.length).toBe(1);
    const item = day5.returns[0]!;
    expect(item.id).toBe(RET_B102);
    expect(item.status).toBe('pending');
    expect(item.dueDayId).toBe(DAY_06);
    expect(item.versions).toEqual([
      { index: 0, action: 'resubmit', code: '102', dayId: DAY_04, checkDayId: DAY_05, outcome: 'returned', checkedDayId: DAY_05 },
    ]);
    expect(item.receipts).toEqual([
      RECEIPT_0,
      { id: `${RET_B102}#1`, kind: 'returned', dayId: DAY_05, versionIndex: 0, code: '102', reason: 'code-mismatch' },
    ]);
    const checked = day5.events.filter((e) => e.kind === 'return.checked');
    expect(checked.map((e) => e.payload)).toEqual([{ dayId: DAY_05, returnId: RET_B102, versionIndex: 0, outcome: 'returned' }]);
    expect(eventDayId(checked[0]!, DIR_ISS)).toBe(DAY_05);
    // 到期日是 Day 6：Day 5 不排入、錯誤文件處理不適用
    expect(day5.issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
    expect(isTaskApplicable(day5, slotOf(5))).toBeFalse();
    expect(latestIssueCode(item)).toBe('102');
    // 再次退回後可以再修正（新增版本 1，舊版本不覆寫）
    const again = resubmitNow(startDay(day5), DIR_ISS, RET_B102, '0103');
    expect(again.returns[0]!.versions).toEqual([item.versions[0]!, { index: 1, action: 'resubmit', code: '0103', dayId: DAY_05, checkDayId: DAY_06 }]);
    expect(again.returns[0]!.status).toBe('awaiting-check');
  });

  it('改成正確編號：送出時只是已重送／待核對，下一工作日下游核對一致後才結案（收件回條、原因 null）', () => {
    const onSlot = issDay4Slot();
    const s = resubmitNow(onSlot, DIR_ISS, RET_B102, '0102');
    expect(s.returns[0]!.status).toBe('awaiting-check');
    expect(s.returns[0]!.receipts.length).toBe(1);
    expect(countKind(s, 'return.checked')).toBe(0);
    const day5 = advanceDay(completeWork(s, DIR_ISS), DIR_ISS);
    const item = day5.returns[0]!;
    expect(item.status).toBe('resolved');
    expect(item.dueDayId).toBeNull();
    expect(item.versions[0]).toEqual({ index: 0, action: 'resubmit', code: '0102', dayId: DAY_04, checkDayId: DAY_05, outcome: 'resolved', checkedDayId: DAY_05 });
    expect(item.receipts[1]).toEqual({ id: `${RET_B102}#1`, kind: 'resolved', dayId: DAY_05, versionIndex: 0, code: '0102', reason: null });
    expect(day5.events.filter((e) => e.kind === 'return.checked').map((e) => e.payload)).toEqual([
      { dayId: DAY_05, returnId: RET_B102, versionIndex: 0, outcome: 'resolved' },
    ]);
    // 原提交與來源仍在（結案不刪歷史）
    expect([item.submittedCode, item.sourceCode, item.receipts[0]!.code]).toEqual(['102', '0102', '102']);
    // 已結案不能再處理
    const work5 = startDay(day5);
    expect(resubmitNow(work5, DIR_ISS, RET_B102, '0102')).toBe(work5);
    expect(windowNow(work5, DIR_ISS, RET_B102)).toBe(work5);
    // Day 4 的任務已交付且案件不再待修正：存檔合法；之後各日不再排入
    expect(reloadValid(day5)).toBeTrue();
    const end = issRunToEnd(day5);
    expect(end.returns[0]!.status).toBe('resolved');
    expect(end.returns[0]!.receipts.length).toBe(2);
    expect(end.issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
    expect(countKind(end, 'return.checked')).toBe(1);
    expect(reloadValid(end)).toBeTrue();
  });

  it('連續三次仍錯（第 1／2／3 次）：每次都在下一工作日再次退回，同一案 ID、回條遞增、從不結案；最後一天改對也保留待核對', () => {
    const wrongs = ['102', '0l02', '1020'];
    let s = startDay(issDay3Morning());
    s = resubmitNow(s, DIR_ISS, RET_B102, wrongs[0]!);
    for (let i = 0; i < wrongs.length; i++) {
      const dayNum = 3 + i;
      expect(s.dayId).toBe(issDayId(dayNum));
      expect(s.returns[0]!.status).toBe('awaiting-check');
      s = advanceDay(issFinishDay(s), DIR_ISS);
      const item = s.returns[0]!;
      expect(s.returns.length).toBe(1);
      expect(item.id).toBe(RET_B102);
      expect(item.status).withContext(`第 ${i + 1} 次仍錯`).toBe('pending');
      expect(item.receipts.length).toBe(i + 2);
      expect(item.receipts[i + 1]).toEqual({
        id: `${RET_B102}#${i + 1}`,
        kind: 'returned',
        dayId: issDayId(dayNum + 1),
        versionIndex: i,
        code: wrongs[i]!,
        reason: 'code-mismatch',
      });
      expect(item.versions.map((v) => v.outcome)).toEqual(wrongs.slice(0, i + 1).map(() => 'returned'));
      expect(item.dueDayId).toBe(dayNum + 1 < 6 ? issDayId(dayNum + 2) : null);
      expect(latestIssueCode(item)).toBe(wrongs[i]!);
      // 每次都在到期前（從文件問題頁）重送，從未排入每日工作
      expect(s.issueSchedule).toEqual({});
      expect(reloadValid(s)).withContext(`第 ${i + 1} 次退回後`).toBeTrue();
      s = startDay(s);
      if (i + 1 < wrongs.length) s = resubmitNow(s, DIR_ISS, RET_B102, wrongs[i + 1]!);
    }
    // Day 6（最後一天）：待修正、沒有下一次到期日，仍留在清單；錯誤文件處理不適用
    expect(s.dayId).toBe(DAY_06);
    expect(s.returns[0]!.dueDayId).toBeNull();
    expect(isTaskApplicable(s, slotOf(6))).toBeFalse();
    expect(countKind(s, 'return.checked')).toBe(3);
    // 最後一天改對：預定核對日為 null → 保留待核對，不為結束畫面自動結案
    s = resubmitNow(s, DIR_ISS, RET_B102, '0102');
    expect(s.returns[0]!.versions[3]).toEqual({ index: 3, action: 'resubmit', code: '0102', dayId: DAY_06, checkDayId: null });
    const end = issFinishDay(s);
    expect(end.stage).toBe('end');
    expect(end.returns[0]!.status).toBe('awaiting-check');
    expect(end.returns[0]!.receipts.length).toBe(4);
    expect(end.returns[0]!.receipts.every((r) => r.kind === 'returned')).toBeTrue();
    expect(advanceDay(end, DIR_ISS)).toBe(end);
    expect(reloadValid(end)).toBeTrue();
  });

  it('第 10 次仍錯也不會自動通過（沒有提交次數門檻）；第 11 次改對，下一工作日核對後才結案', () => {
    const dir = DIR_ISS_LONG;
    let s = startDay(issDay3Morning(WRONG, RELEASE_BOTH, dir));
    for (let k = 1; k <= 10; k++) {
      s = resubmitNow(s, dir, RET_B102, `10${k}`);
      expect(s.returns[0]!.status).toBe('awaiting-check');
      s = startDay(advanceDay(issFinishDay(s, dir), dir));
      const item = s.returns[0]!;
      expect(item.status).withContext(`第 ${k} 次仍錯`).toBe('pending');
      expect(item.receipts.length).toBe(k + 1);
      expect(item.versions.length).toBe(k);
      expect(item.versions.every((v) => v.outcome === 'returned')).toBeTrue();
    }
    expect(s.dayId).toBe(issDayId(13));
    expect(s.returns.length).toBe(1);
    expect(s.returns[0]!.receipts.map((r) => r.id)).toEqual(Array.from({ length: 11 }, (_, i) => `${RET_B102}#${i}`));
    expect(s.returns[0]!.receipts.every((r) => r.kind === 'returned' && r.reason === 'code-mismatch')).toBeTrue();
    expect(latestIssueCode(s.returns[0]!)).toBe('1010');
    expect(validSave(JSON.parse(JSON.stringify(s)), dir)).toBeTrue();
    s = resubmitNow(s, dir, RET_B102, '0102');
    expect(s.returns[0]!.status).toBe('awaiting-check');
    s = advanceDay(issFinishDay(s, dir), dir);
    expect(s.dayId).toBe(issDayId(14));
    expect(s.returns[0]!.status).toBe('resolved');
    expect(s.returns[0]!.receipts.length).toBe(12);
    expect(s.returns[0]!.receipts[11]!.kind).toBe('resolved');
    expect(validSave(JSON.parse(JSON.stringify(s)), dir)).toBeTrue();
  });

  it('排入的路徑：Day 4 重送仍錯 → Day 5 再次退回 → Day 6 排入錯誤文件處理（同一案、同一天只排一次）；最後一天重送保留待核對', () => {
    let s = completeWork(resubmitNow(issDay4Slot(), DIR_ISS, RET_B102, '102'), DIR_ISS);
    s = advanceDay(s, DIR_ISS);
    expect(s.issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
    // Day 5 不處理（案件到期日是 Day 6），照常交付
    s = issFinishDay(startDay(s));
    expect([s.stage, s.taskId]).toEqual(['wrap', issTaskId(5)]);
    s = advanceDay(s, DIR_ISS);
    expect([s.dayId, s.stage]).toEqual([DAY_06, 'morning']);
    expect(s.issueSchedule).toEqual({ [DAY_04]: [RET_B102], [DAY_06]: [RET_B102] });
    expect(s.returns[0]!.receipts.length).toBe(2);
    expect(isTaskApplicable(s, slotOf(6))).toBeTrue();
    expect(isTaskApplicable(s, slotOf(5))).toBeFalse();
    s = issArchiveToday(startDay(s));
    expect(s.taskId).toBe(issSlotId(6));
    // 修訂表單預填最後一次提交值，不是來源答案
    expect(latestIssueCode(s.returns[0]!)).toBe('102');
    s = resubmitNow(s, DIR_ISS, RET_B102, '0102');
    expect(s.returns[0]!.versions[1]).toEqual({ index: 1, action: 'resubmit', code: '0102', dayId: DAY_06, checkDayId: null });
    const end = completeWork(s, DIR_ISS);
    expect([end.stage, end.taskId]).toEqual(['end', issSlotId(6)]);
    expect(end.returns[0]!.status).toBe('awaiting-check');
    expect(end.returns[0]!.receipts.length).toBe(2);
    expect(advanceDay(end, DIR_ISS)).toBe(end);
    // 兩個排入日的案件都已不再待修正：結束存檔合法
    expect(reloadValid(end)).toBeTrue();
  });

  it('最後一天再次退回：dueDayId 為 null，案件留在清單待修正（不排入不存在的下一天）', () => {
    // Day 5 從文件問題頁重送仍錯 → Day 6 再次退回
    let s = completeWork(resubmitNow(issDay4Slot(), DIR_ISS, RET_B102, '102'), DIR_ISS);
    s = startDay(advanceDay(s, DIR_ISS));
    s = resubmitNow(s, DIR_ISS, RET_B102, '1O2');
    s = advanceDay(issFinishDay(s), DIR_ISS);
    expect(s.dayId).toBe(DAY_06);
    expect(s.returns[0]!.status).toBe('pending');
    expect(s.returns[0]!.dueDayId).toBeNull();
    expect(s.issueSchedule[DAY_06]).toBeUndefined();
    const end = issRunToEnd(s);
    expect(end.returns[0]!.status).toBe('pending');
  });
});

describe('R11：送窗口待查不結案', () => {
  it('Day 4 送窗口：待窗口回覆（版本記錄當時最後提交的編號、沒有核對日）；任務結清但之後跨日都不會自動結案或加回條', () => {
    const onSlot = issDay4Slot();
    const n = onSlot.events.length;
    const s = windowNow(onSlot, DIR_ISS, RET_B102);
    const item = s.returns[0]!;
    expect(item.status).toBe('awaiting-window');
    expect(item.dueDayId).toBeNull();
    expect(item.versions).toEqual([{ index: 0, action: 'window', code: '102', dayId: DAY_04, checkDayId: null }]);
    expect(s.events.slice(n)).toEqual([
      { id: `return.window:${n}`, kind: 'return.window', payload: { dayId: DAY_04, returnId: RET_B102, versionIndex: 0 } },
    ]);
    expect(isTaskDone(s, DIR_ISS, slotOf(4))).toBeTrue();
    expect(resubmitNow(s, DIR_ISS, RET_B102, '0102')).toBe(s);
    expect(windowNow(s, DIR_ISS, RET_B102)).toBe(s);
    expect(reloadValid(s)).toBeTrue();
    const end = issRunToEnd(completeWork(s, DIR_ISS));
    expect(end.returns[0]!.status).toBe('awaiting-window');
    expect(end.returns[0]!.receipts).toEqual([RECEIPT_0]);
    expect(countKind(end, 'return.checked')).toBe(0);
    expect(end.issueSchedule).toEqual({ [DAY_04]: [RET_B102] });
    expect(reloadValid(end)).toBeTrue();
  });

  it('再次退回後才送窗口：版本記錄最後一次提交的錯值（不是原提交、不是來源）', () => {
    let s = resubmitNow(startDay(issDay3Morning()), DIR_ISS, RET_B102, 'X-1');
    s = startDay(advanceDay(issFinishDay(s), DIR_ISS));
    expect(s.returns[0]!.status).toBe('pending');
    s = windowNow(s, DIR_ISS, RET_B102);
    expect(s.returns[0]!.versions.map((v) => [v.index, v.action, v.code, v.checkDayId])).toEqual([
      [0, 'resubmit', 'X-1', DAY_04],
      [1, 'window', 'X-1', null],
    ]);
    expect(latestIssueCode(s.returns[0]!)).toBe('X-1');
    expect(reloadValid(s)).toBeTrue();
  });
});

describe('R11：從文件問題頁提前處理（不限定目前工作）', () => {
  it('通知日（Day 3）目前工作是歸檔也能重送：受理日 Day 3、Day 4 核對；Day 4 開始時已不是待修正 → 不排入 Day 4', () => {
    const day3 = startDay(issDay3Morning());
    expect(activeTaskOf(day3, DIR_ISS).kind).toBe('archive');
    const s = resubmitNow(day3, DIR_ISS, RET_B102, '0l02');
    expect(s.returns[0]!.versions).toEqual([{ index: 0, action: 'resubmit', code: '0l02', dayId: DAY_03, checkDayId: DAY_04 }]);
    expect(s.taskId).toBe(issTaskId(3));
    expect(reloadValid(s)).toBeTrue();
    const day4 = advanceDay(issFinishDay(s), DIR_ISS);
    expect(day4.returns[0]!.status).toBe('pending');
    expect(day4.returns[0]!.dueDayId).toBe(DAY_05);
    expect(day4.issueSchedule).toEqual({});
    expect(isTaskApplicable(day4, slotOf(4))).toBeFalse();
    // Day 4 交付歸檔後直接日結（不出現空的錯誤文件處理）
    const wrap4 = issArchiveToday(startDay(day4));
    expect([wrap4.stage, wrap4.taskId]).toEqual(['wrap', issTaskId(4)]);
    expect(reloadValid(wrap4)).toBeTrue();
  });

  it('排入 Day 4 的案件在輪到錯誤文件處理前（文件問題頁）先處理 → 當日任務同步完成，交付歸檔後直接日結', () => {
    const day4 = startDay(issDay4Morning());
    expect(day4.taskId).toBe(issTaskId(4));
    const s = windowNow(day4, DIR_ISS, RET_B102);
    expect(s.taskId).toBe(issTaskId(4));
    expect(isTaskDone(s, DIR_ISS, slotOf(4))).toBeTrue();
    expect(isTaskSettled(s, DIR_ISS, slotOf(4))).toBeTrue();
    expect(nextOpenTask(s, DIR_ISS, issTaskId(4))).toBeNull();
    const wrap = issArchiveToday(s);
    expect([wrap.stage, wrap.taskId]).toEqual(['wrap', issTaskId(4)]);
    const delivered = wrap.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId);
    expect(delivered).not.toContain(issSlotId(4));
    expect(reloadValid(wrap)).toBeTrue();
  });

  it('只在 work 階段：morning／wrap／end、未知案件、空白／純空白編號 → 原物件；任何非空文字（含前導零、空白）原樣保存', () => {
    const morning = issDay3Morning();
    expect(resubmitNow(morning, DIR_ISS, RET_B102, '0102')).toBe(morning);
    expect(windowNow(morning, DIR_ISS, RET_B102)).toBe(morning);
    const work = startDay(morning);
    const wrap = issFinishDay(work);
    expect(wrap.stage).toBe('wrap');
    expect(resubmitNow(wrap, DIR_ISS, RET_B102, '0102')).toBe(wrap);
    expect(windowNow(wrap, DIR_ISS, RET_B102)).toBe(wrap);
    const end: Save = { ...work, stage: 'end' };
    expect(resubmitNow(end, DIR_ISS, RET_B102, '0102')).toBe(end);
    for (const code of ['', '   ']) expect(resubmitNow(work, DIR_ISS, RET_B102, code)).toBe(work);
    expect(resubmitNow(work, DIR_ISS, 'return.unknown', '0102')).toBe(work);
    expect(windowNow(work, DIR_ISS, 'return.unknown')).toBe(work);
    for (const code of ['abc', ' 0102', '00102', 'ＯＯ']) {
      const s = resubmitNow(work, DIR_ISS, RET_B102, code);
      expect(s.returns[0]!.versions[0]!.code).toBe(code);
      expect(reloadValid(s)).withContext(code).toBeTrue();
    }
  });
});

describe('R11：每個版本只評估一次（刷新、重跑不加速、不重複）', () => {
  it('核對後重跑 advanceDay、JSON 往返：不再評估、不重複回條／事件／排程', () => {
    const s = resubmitNow(startDay(issDay3Morning()), DIR_ISS, RET_B102, '102');
    const day4 = advanceDay(issFinishDay(s), DIR_ISS);
    expect(countKind(day4, 'return.checked')).toBe(1);
    expect(day4.returns[0]!.receipts.length).toBe(2);
    expect(advanceDay(day4, DIR_ISS)).toBe(day4);
    const reloaded = JSON.parse(JSON.stringify(day4)) as Save;
    expect(validSave(reloaded, DIR_ISS)).toBeTrue();
    expect(advanceDay(reloaded, DIR_ISS)).toBe(reloaded);
    expect(startDay(reloaded).returns).toEqual(day4.returns);
    // 手造「重跑進入 Day 4」：版本已有 outcome，不再評估
    const replay = advanceDay({ ...reloaded, dayId: DAY_03, stage: 'wrap', taskId: issTaskId(3) }, DIR_ISS);
    expect(replay.returns).toEqual(reloaded.returns);
    expect(countKind(replay, 'return.checked')).toBe(1);
    expect(replay.issueSchedule).toEqual(reloaded.issueSchedule);
  });

  it('待核對的版本只在預定核對日評估：刷新、切頁、同日重讀都不提前核對', () => {
    const s = resubmitNow(startDay(issDay3Morning()), DIR_ISS, RET_B102, '0102');
    const reloaded = JSON.parse(JSON.stringify(s)) as Save;
    expect(reloaded.returns[0]!.status).toBe('awaiting-check');
    // 同日的其他操作（完成歸檔、交付）都不核對
    const wrap = issFinishDay(reloaded);
    expect(wrap.returns[0]!.status).toBe('awaiting-check');
    expect(countKind(wrap, 'return.checked')).toBe(0);
    // 預定核對日不是新的一天 → 不評估（手造：版本預定 Day 5，進入 Day 4 時不動）
    const later = { ...wrap, returns: [{ ...wrap.returns[0]!, versions: [{ ...wrap.returns[0]!.versions[0]!, checkDayId: DAY_05 }] }] };
    const day4 = advanceDay(later, DIR_ISS);
    expect(day4.returns[0]!.status).toBe('awaiting-check');
    expect(day4.returns[0]!.versions[0]!.outcome).toBeUndefined();
    expect(countKind(day4, 'return.checked')).toBe(0);
  });

  it('相同選擇跑兩次，文件問題流程的存檔逐字相同', () => {
    const run = () => {
      let s = resubmitNow(issDay4Slot(), DIR_ISS, RET_B102, '102');
      s = startDay(advanceDay(completeWork(s, DIR_ISS), DIR_ISS));
      s = resubmitNow(s, DIR_ISS, RET_B102, '0102');
      return issRunToEnd(s);
    };
    const a = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(run()));
    expect(a.returns[0]!.status).toBe('resolved');
  });
});

describe('R11：latestIssueCode／scheduledIssues／R12 markMailRead', () => {
  it('latestIssueCode：沒有版本時是第一次提交（不是來源）；之後是最後一次送出的值（含送窗口）', () => {
    const day3 = issDay3Morning();
    const base = day3.returns[0]!;
    expect(latestIssueCode(base)).toBe('102');
    expect(latestIssueCode(base)).not.toBe(base.sourceCode);
    const v = (index: number, code: string, action: 'resubmit' | 'window' = 'resubmit') => ({ index, action, code, dayId: DAY_04, checkDayId: null });
    expect(latestIssueCode({ ...base, versions: [v(0, 'A1')] })).toBe('A1');
    expect(latestIssueCode({ ...base, versions: [v(0, 'A1'), v(1, 'A2')] })).toBe('A2');
    expect(latestIssueCode({ ...base, versions: [v(0, 'A1'), v(1, 'A1', 'window')] })).toBe('A1');
  });

  it('scheduledIssues：依 returns 的建立順序回傳當天排入的案件；未排的日子為空', () => {
    const onSlot = issDay4Slot({ B102: '102', B607: '607' });
    const reversed: Save = { ...onSlot, issueSchedule: { [DAY_04]: [RET_B607, RET_B102] } };
    expect(scheduledIssues(reversed, DAY_04).map((r) => r.id)).toEqual([RET_B102, RET_B607]);
    expect(scheduledIssues(onSlot, DAY_03)).toEqual([]);
    expect(scheduledIssues(onSlot, 'day.99')).toEqual([]);
    expect(scheduledIssues({ ...onSlot, issueSchedule: { [DAY_04]: ['return.unknown'] } }, DAY_04)).toEqual([]);
  });

  it('R12 markMailRead（取代 markIssueReceiptsRead）：只加入既有郵件、清單內去重；沒有新增回傳同一物件；不改案件或待處理狀態', () => {
    const day3 = issDay3Morning();
    const mail0 = mailIdOfReceipt(`${RET_B102}#0`);
    expect(day3.mailbox.map((m) => m.id)).toEqual([mail0]);
    expect(isMailRead(day3, mail0)).toBeFalse();
    const read = markMailRead(day3, [mail0]);
    expect(read.readMail).toEqual([mail0]);
    expect(isMailRead(read, mail0)).toBeTrue();
    expect(read.returns).toBe(day3.returns);
    expect(read.mailbox).toBe(day3.mailbox);
    expect(read.issueSchedule).toBe(day3.issueSchedule);
    expect(read.events).toBe(day3.events);
    expect(read.returns[0]!.status).toBe('pending');
    expect(markMailRead(read, [mail0])).toBe(read);
    expect(markMailRead(read, [])).toBe(read);
    expect(markMailRead(read, [mail0, mail0])).toBe(read);
    expect(reloadValid(read)).toBeTrue();
    // 新回條（新郵件）出現後只加新的，順序依傳入；已讀與案件是否解決無關
    let s = resubmitNow(startDay(read), DIR_ISS, RET_B102, '102');
    s = advanceDay(issFinishDay(s), DIR_ISS);
    const ids = s.mailbox.map((m) => m.id);
    expect(ids).toEqual([mail0, mailIdOfReceipt(`${RET_B102}#1`)]);
    expect(s.readMail).toEqual([mail0]);
    const again = markMailRead(s, [ids[1]!, ids[1]!, ids[0]!]);
    expect(again.readMail).toEqual([mail0, ids[1]!]);
    expect(markMailRead(again, ids)).toBe(again);
    expect(again.returns[0]!.status).toBe('pending');
    expect(reloadValid(again)).toBeTrue();
  });
});

describe('R11：當日錯誤文件處理只由排程決定', () => {
  it('isTaskApplicable 只看 issueSchedule[該位置的日子]；isTaskDone 需有排入案件且都不再待修正', () => {
    const day3 = startDay(issDay3Morning());
    expect(isTaskApplicable(day3, slotOf(3))).toBeFalse();
    const forced: Save = { ...day3, issueSchedule: { [DAY_03]: [RET_B102] } };
    expect(isTaskApplicable(forced, slotOf(3))).toBeTrue();
    expect(isTaskApplicable(forced, slotOf(4))).toBeFalse();
    expect(isTaskDone(forced, DIR_ISS, slotOf(3))).toBeFalse();
    const handled = resubmitNow(forced, DIR_ISS, RET_B102, '102');
    expect(isTaskDone(handled, DIR_ISS, slotOf(3))).toBeTrue();
    // 排程引用的 ID 不存在 → 沒有可處理的案件，不算完成
    expect(isTaskDone({ ...day3, issueSchedule: { [DAY_03]: ['return.unknown'] } }, DIR_ISS, slotOf(3))).toBeFalse();
    // 其他種類的工作永遠適用
    expect(isTaskApplicable(day3, DIR_ISS.plan(DAY_03)!.tasks[0]!)).toBeTrue();
  });

  it('returnNotified：Day 3 起為真（不論狀態）；Day 2、未知稽核、沒有此稽核的目錄為假', () => {
    expect(returnNotified(issDay2Wrap(), DIR_ISS, AUDIT_ID)).toBeFalse();
    expect(returnNotified(issDay3Morning(), DIR_ISS, AUDIT_ID)).toBeTrue();
    const done = windowNow(issDay4Slot(), DIR_ISS, RET_B102);
    expect(returnNotified(done, DIR_ISS, AUDIT_ID)).toBeTrue();
    expect(returnNotified(done, DIR_ISS, 'audit.unknown')).toBeFalse();
    expect(returnNotified(done, DIR, AUDIT_ID)).toBeFalse();
    const early: Save = { ...issDay3Morning(), dayId: DAY_02, stage: 'wrap', taskId: TASK_DAY2 };
    expect(returnNotified(early, DIR_ISS, AUDIT_ID)).toBeFalse();
  });
});

/*
 * 回歸測試（R11 曾為原始碼缺陷，已修正）：已排入並已交付的錯誤文件處理日，案件隔天被再次退回（回到 pending）後，
 * save-schema isRawTaskDone（return-review）把那一天的工作重新判成「未完成」，isValidSaveBody 的「前面每一天都已結清」
 * 因此拒絕整份存檔 → 讀檔（migrateToCurrent）回傳 null。本日處理已交付 ≠ 案件已解決，存檔應維持合法。
 */
describe('R11：已交付的錯誤文件處理日，案件隔天再次退回後存檔仍須合法（回歸測試）', () => {
  it('Day 4 排入並重送仍錯 → Day 5 再次退回：Day 5 存檔 JSON 往返後仍合法、可讀檔續玩', () => {
    const day5 = advanceDay(completeWork(resubmitNow(issDay4Slot(), DIR_ISS, RET_B102, '102'), DIR_ISS), DIR_ISS);
    expect(day5.returns[0]!.status).toBe('pending');
    expect(reloadValid(day5)).toBeTrue();
  });

  it('同一路徑到 Day 6 次日收件（再次排入、仍待修正）：存檔仍合法；讀檔（migrateToCurrent）不回傳 null', () => {
    let s = completeWork(resubmitNow(issDay4Slot(), DIR_ISS, RET_B102, '102'), DIR_ISS);
    s = advanceDay(issFinishDay(startDay(advanceDay(s, DIR_ISS))), DIR_ISS);
    expect([s.dayId, s.stage, s.returns[0]!.status]).toEqual([DAY_06, 'morning', 'pending']);
    expect(s.issueSchedule).toEqual({ [DAY_04]: [RET_B102], [DAY_06]: [RET_B102] });
    expect(reloadValid(s)).toBeTrue();
    expect(migrateToCurrent(JSON.parse(JSON.stringify(s)), DIR_ISS)).not.toBeNull();
  });
});

describe('R10：commitArchive 不接受空白編號（直接呼叫也一樣）', () => {
  it('code 為空白字串 → 回傳原物件', () => {
    const s = createSave(1, DIR);
    const r = record('B102', DAY1_RECORDS);
    expect(commitArchive(s, BATCH_DAY01, r, { ok: true, code: '   ', refusal: null, origin: 'review' })).toBe(s);
    expect(commitArchive(s, BATCH_DAY01, r, { ok: true, code: '', refusal: null, origin: 'review' })).toBe(s);
  });
});

describe('R12：markMailRead 忽略未知郵件 ID', () => {
  it('未知 ID（含回條 ID 本身、不存在的郵件）不寫入（回傳原物件）', () => {
    const s = createSave(1, DIR);
    expect(markMailRead(s, ['mail.return.nope#0'])).toBe(s);
    const day3 = issDay3Morning();
    expect(markMailRead(day3, [`${RET_B102}#0`, 'mail.unknown', ''])).toBe(day3);
    const mixed = markMailRead(day3, ['mail.unknown', mailIdOfReceipt(`${RET_B102}#0`)]);
    expect(mixed.readMail).toEqual([mailIdOfReceipt(`${RET_B102}#0`)]);
  });
});

/* ====================================================================================
 * R12：退件回條 ↔ 郵件、版本鎖定、修訂草稿、郵件已讀、向同事詢問、回覆送達時間、入職簽名
 * ==================================================================================== */

/** 一份回條應寄出的郵件（逐欄寫出，不經 receiptMail，避免測試與實作共用同一段程式）。 */
function expectedMail(caseId: string, receipt: ReturnReceipt): MailRecord {
  return {
    id: `mail.${receipt.id}`,
    packId: 'mail.return-receipts',
    templateId: receipt.kind,
    dayId: receipt.dayId,
    attachments: [{ kind: 'return-receipt', caseId, receiptId: receipt.id, versionIndex: receipt.versionIndex }],
  };
}

/** 每份回條恰有一封郵件、欄位一致；郵件依收到順序（遊戲日不倒退）。 */
function expectMailMirrorsReceipts(save: Save, context = ''): void {
  const receipts = save.returns.flatMap((r) => r.receipts.map((rc) => ({ caseId: r.id, rc })));
  expect(save.mailbox.length).withContext(`${context} mail count`).toBe(receipts.length);
  for (const { caseId, rc } of receipts) {
    const mails = save.mailbox.filter((m) => m.id === `mail.${rc.id}`);
    expect(mails).withContext(`${context} ${rc.id}`).toEqual([expectedMail(caseId, rc)]);
  }
  const order = save.mailbox.map((m) => DIR_ISS_LONG.days.indexOf(m.dayId));
  expect(order).withContext(`${context} chronological`).toEqual([...order].sort((a, b) => a - b));
}

describe('R12：mail.ts 常數與回條郵件', () => {
  it('郵件包 ID、固定郵件 ID、receiptMail 的欄位', () => {
    expect(RETURN_RECEIPT_MAIL_PACK).toBe('mail.return-receipts');
    expect(mailIdOfReceipt(`${RET_B102}#3`)).toBe(`mail.${RET_B102}#3`);
    const item = startDay(issDay3Morning()).returns[0]!;
    expect(receiptMail(item, RECEIPT_0)).toEqual(expectedMail(RET_B102, RECEIPT_0));
    const resolved: ReturnReceipt = { id: `${RET_B102}#1`, kind: 'resolved', dayId: DAY_04, versionIndex: 0, code: '0102', reason: null };
    expect(receiptMail(item, resolved)).toEqual(expectedMail(RET_B102, resolved));
    expect(receiptMail(item, resolved).templateId).toBe('resolved');
  });
});

describe('R12：每份回條在建立當下寄出恰好一封郵件', () => {
  it('初次退件（進入通知日）：mail.<回條 ID>、郵件包 mail.return-receipts、模板 returned、Day 3、附件引用案件／回條／原始送件（null）', () => {
    const wrap2 = issDay2Wrap();
    expect(wrap2.mailbox).toEqual([]);
    const day3 = advanceDay(wrap2, DIR_ISS);
    expect(day3.mailbox).toEqual([
      {
        id: `mail.${RET_B102}#0`,
        packId: 'mail.return-receipts',
        templateId: 'returned',
        dayId: DAY_03,
        attachments: [{ kind: 'return-receipt', caseId: RET_B102, receiptId: `${RET_B102}#0`, versionIndex: null }],
      },
    ]);
    expect(day3.readMail).toEqual([]);
    expect(reloadValid(day3)).toBeTrue();
  });

  it('兩案同一天建立：兩封郵件，依案件建立順序', () => {
    const day3 = issDay3Morning({ B102: '102', B607: '607' });
    expect(day3.mailbox.map((m) => [m.id, (m.attachments[0] as ReturnReceiptAttachment).caseId])).toEqual([
      [`mail.${RET_B102}#0`, RET_B102],
      [`mail.${RET_B607}#0`, RET_B607],
    ]);
    expectMailMirrorsReceipts(day3);
  });

  it('沒有案件就沒有郵件；跨日、刷新都不會補寄', () => {
    const end = issRunToEnd(startDay(issDay3Morning({}, RELEASE_BOTH)));
    expect(end.mailbox).toEqual([]);
    expect(end.readMail).toEqual([]);
  });

  it('重送、送窗口本身不寄信（只有下游回條才寄）', () => {
    const day3 = startDay(issDay3Morning());
    const resubmitted = resubmitReturn(day3, DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`);
    expect(resubmitted.mailbox).toBe(day3.mailbox);
    const windowed = sendReturnToWindow(day3, DIR_ISS, RET_B102, `${RET_B102}#0`);
    expect(windowed.mailbox).toBe(day3.mailbox);
    // 送窗口待查一路到結束：沒有新回條，也沒有新郵件
    const end = issRunToEnd(windowed);
    expect(end.mailbox).toEqual(day3.mailbox);
  });

  it('再次退回：下一工作日核對仍錯 → 回條 #1 與郵件（模板 returned、版本 0、Day 4）一起出現', () => {
    let s = resubmitReturn(startDay(issDay3Morning()), DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`);
    s = advanceDay(issFinishDay(s), DIR_ISS);
    expect(s.mailbox.map((m) => [m.id, m.templateId, m.dayId, (m.attachments[0] as ReturnReceiptAttachment).versionIndex])).toEqual([
      [`mail.${RET_B102}#0`, 'returned', DAY_03, null],
      [`mail.${RET_B102}#1`, 'returned', DAY_04, 0],
    ]);
    expectMailMirrorsReceipts(s);
    expect(reloadValid(s)).toBeTrue();
  });

  it('結案：下一工作日核對一致 → 收件回條與郵件（模板 resolved、版本 0）一起出現；之後不再寄信', () => {
    let s = resubmitReturn(issDay4Slot(), DIR_ISS, RET_B102, '0102', `${RET_B102}#0`);
    s = advanceDay(completeWork(s, DIR_ISS), DIR_ISS);
    expect(s.returns[0]!.status).toBe('resolved');
    expect(s.mailbox.map((m) => [m.id, m.templateId, m.dayId, (m.attachments[0] as ReturnReceiptAttachment).versionIndex])).toEqual([
      [`mail.${RET_B102}#0`, 'returned', DAY_03, null],
      [`mail.${RET_B102}#1`, 'resolved', DAY_05, 0],
    ]);
    expectMailMirrorsReceipts(s);
    const end = issRunToEnd(s);
    expect(end.mailbox).toEqual(s.mailbox);
    expect(reloadValid(end)).toBeTrue();
  });

  it('連續三次重送仍錯：初次＋3 次再次退回＝4 份回條、4 封郵件，版本 null／0／1／2、日期 Day 3／4／5／6，ID 穩定', () => {
    const wrongs = ['0l02', '1O2', 'abc'];
    let s = startDay(issDay3Morning());
    for (let i = 0; i < wrongs.length; i++) {
      s = resubmitReturn(s, DIR_ISS, RET_B102, wrongs[i]!, `${RET_B102}#${i}`);
      expect(s.returns[0]!.status).withContext(`第 ${i + 1} 次重送`).toBe('awaiting-check');
      expect(s.mailbox.length).withContext(`第 ${i + 1} 次重送後`).toBe(i + 1);
      s = startDay(advanceDay(issFinishDay(s), DIR_ISS));
      expect(s.returns[0]!.status).withContext(`第 ${i + 1} 次核對`).toBe('pending');
      expect(s.mailbox.length).withContext(`第 ${i + 1} 次核對後`).toBe(i + 2);
      expectMailMirrorsReceipts(s, `第 ${i + 1} 次`);
      expect(reloadValid(s)).withContext(`第 ${i + 1} 次`).toBeTrue();
    }
    expect(s.dayId).toBe(DAY_06);
    expect(s.mailbox.map((m) => [m.id, m.templateId, m.dayId, (m.attachments[0] as ReturnReceiptAttachment).versionIndex])).toEqual([
      [`mail.${RET_B102}#0`, 'returned', DAY_03, null],
      [`mail.${RET_B102}#1`, 'returned', DAY_04, 0],
      [`mail.${RET_B102}#2`, 'returned', DAY_05, 1],
      [`mail.${RET_B102}#3`, 'returned', DAY_06, 2],
    ]);
    expect(new Set(s.mailbox.map((m) => m.id)).size).toBe(4);
  });

  it('刷新與重跑都不重寄：重跑 advanceDay、JSON 往返、手造「重新進入同一天」郵件數不變', () => {
    let s = resubmitReturn(startDay(issDay3Morning()), DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`);
    const day4 = advanceDay(issFinishDay(s), DIR_ISS);
    expect(day4.mailbox.length).toBe(2);
    expect(advanceDay(day4, DIR_ISS)).toBe(day4);
    const reloaded = JSON.parse(JSON.stringify(day4)) as Save;
    expect(advanceDay(reloaded, DIR_ISS)).toBe(reloaded);
    expect(startDay(reloaded).mailbox).toEqual(day4.mailbox);
    // 手造「已處理過的日子又跨一次」：通知以穩定 ID 去重、已核對版本不再評估 → 不寄新信
    const replay3 = advanceDay({ ...reloaded, dayId: DAY_02, stage: 'wrap', taskId: TASK_DAY2 }, DIR_ISS);
    expect(replay3.mailbox).toEqual(day4.mailbox);
    const replay4 = advanceDay({ ...reloaded, dayId: DAY_03, stage: 'wrap', taskId: issTaskId(3) }, DIR_ISS);
    expect(replay4.mailbox).toEqual(day4.mailbox);
    s = startDay(day4);
    expect(markMailRead(s, [`mail.${RET_B102}#1`]).mailbox).toBe(s.mailbox);
  });

  it('郵件已讀與案件狀態互不影響：讀信不改案件，結案不標已讀', () => {
    let s = startDay(issDay3Morning());
    s = markMailRead(s, [`mail.${RET_B102}#0`]);
    expect(s.returns[0]!.status).toBe('pending');
    expect(editableReceiptOf(s.returns[0]!)!.id).toBe(`${RET_B102}#0`);
    s = resubmitReturn(s, DIR_ISS, RET_B102, '0102', `${RET_B102}#0`);
    s = advanceDay(issFinishDay(s), DIR_ISS);
    expect(s.returns[0]!.status).toBe('resolved');
    expect(s.readMail).toEqual([`mail.${RET_B102}#0`]);
    expect(isMailRead(s, `mail.${RET_B102}#1`)).toBeFalse();
  });
});

describe('R12：editableReceiptOf（只有待修正案件的最新退件回條可修訂）', () => {
  it('通知日：初次退件回條可修訂', () => {
    const item = startDay(issDay3Morning()).returns[0]!;
    expect(editableReceiptOf(item)).toEqual(RECEIPT_0);
  });

  it('重送後（待核對）、送窗口後（待窗口回覆）都沒有可修訂的回條', () => {
    const day3 = startDay(issDay3Morning());
    expect(editableReceiptOf(resubmitReturn(day3, DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`).returns[0]!)).toBeNull();
    expect(editableReceiptOf(sendReturnToWindow(day3, DIR_ISS, RET_B102, `${RET_B102}#0`).returns[0]!)).toBeNull();
  });

  it('再次退回後：只有最新的 #1 可修訂，較早的 #0 變成唯讀', () => {
    const s = advanceDay(issFinishDay(resubmitReturn(startDay(issDay3Morning()), DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`)), DIR_ISS);
    const item = s.returns[0]!;
    expect(item.receipts.map((r) => r.id)).toEqual([`${RET_B102}#0`, `${RET_B102}#1`]);
    expect(editableReceiptOf(item)!.id).toBe(`${RET_B102}#1`);
  });

  it('結案後沒有可修訂的回條', () => {
    const s = advanceDay(completeWork(resubmitReturn(issDay4Slot(), DIR_ISS, RET_B102, '0102', `${RET_B102}#0`), DIR_ISS), DIR_ISS);
    expect(s.returns[0]!.status).toBe('resolved');
    expect(editableReceiptOf(s.returns[0]!)).toBeNull();
  });

  it('純函式邊界：最新回條是收件回條、狀態不是 pending、沒有回條 → null', () => {
    const item: ReturnCase = startDay(issDay3Morning()).returns[0]!;
    const resolvedReceipt: ReturnReceipt = { id: `${RET_B102}#1`, kind: 'resolved', dayId: DAY_04, versionIndex: 0, code: '0102', reason: null };
    expect(editableReceiptOf({ ...item, receipts: [RECEIPT_0, resolvedReceipt] })).toBeNull();
    for (const status of ['awaiting-check', 'awaiting-window', 'resolved'] as const) {
      expect(editableReceiptOf({ ...item, status })).withContext(status).toBeNull();
    }
    expect(editableReceiptOf({ ...item, receipts: [] })).toBeNull();
  });
});

describe('R12：版本鎖定——重送／送窗口必須指定目前可修訂的回條，過期操作回傳同一物件', () => {
  /** Day 4：#0 已重送仍錯、再次退回 → 目前可修訂的是 #1（另有 B607 案件的 #0）。 */
  function day4Returned(): Save {
    const day3 = startDay(issDay3Morning({ B102: '102', B607: '607' }));
    const s = resubmitReturn(day3, DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`);
    const day4 = startDay(advanceDay(issFinishDay(sendReturnToWindow(s, DIR_ISS, RET_B607, `${RET_B607}#0`)), DIR_ISS));
    expect(day4.returns.map((r) => [r.id, r.status])).toEqual([
      [RET_B102, 'pending'],
      [RET_B607, 'awaiting-window'],
    ]);
    return day4;
  }

  it('過期或錯誤的回條 ID：較早回條 #0、別案的回條、未知 ID、空字串、郵件 ID、正確 ID 的大小寫變體 → 回傳同一物件（不寫版本、不寫事件）', () => {
    const s = day4Returned();
    for (const stale of [`${RET_B102}#0`, `${RET_B607}#0`, `${RET_B102}#2`, '', `mail.${RET_B102}#1`, `${RET_B102.toUpperCase()}#1`]) {
      expect(resubmitReturn(s, DIR_ISS, RET_B102, '0102', stale)).withContext(`resubmit ${stale}`).toBe(s);
      expect(sendReturnToWindow(s, DIR_ISS, RET_B102, stale)).withContext(`window ${stale}`).toBe(s);
    }
    // 正確回條才成立
    const ok = resubmitReturn(s, DIR_ISS, RET_B102, '0102', `${RET_B102}#1`);
    expect(ok.returns[0]!.versions.length).toBe(2);
    expect(ok.returns[0]!.status).toBe('awaiting-check');
  });

  it('重送成功後同一份回條就過期：再送一次（重複點擊、另一個視窗）回傳同一物件，不會覆寫新版本', () => {
    const once = resubmitReturn(day4Returned(), DIR_ISS, RET_B102, '0102', `${RET_B102}#1`);
    expect(resubmitReturn(once, DIR_ISS, RET_B102, '0103', `${RET_B102}#1`)).toBe(once);
    expect(sendReturnToWindow(once, DIR_ISS, RET_B102, `${RET_B102}#1`)).toBe(once);
    expect(once.returns[0]!.versions[1]!.code).toBe('0102');
  });

  it('待窗口回覆的案件：用它最後的回條也不能重送或再送窗口', () => {
    const s = day4Returned();
    expect(resubmitReturn(s, DIR_ISS, RET_B607, '0607', `${RET_B607}#0`)).toBe(s);
    expect(sendReturnToWindow(s, DIR_ISS, RET_B607, `${RET_B607}#0`)).toBe(s);
  });

  it('已結案：收件回條與較早的退件回條都不能再修訂', () => {
    const s = startDay(advanceDay(completeWork(resubmitReturn(issDay4Slot(), DIR_ISS, RET_B102, '0102', `${RET_B102}#0`), DIR_ISS), DIR_ISS));
    expect(s.returns[0]!.status).toBe('resolved');
    for (const id of [`${RET_B102}#0`, `${RET_B102}#1`]) {
      expect(resubmitReturn(s, DIR_ISS, RET_B102, '0102', id)).withContext(id).toBe(s);
      expect(sendReturnToWindow(s, DIR_ISS, RET_B102, id)).withContext(id).toBe(s);
    }
  });

  it('正確回條但其他條件不成立（非工作階段、空白編號、未知案件）仍拒絕', () => {
    const morning = issDay3Morning();
    expect(resubmitReturn(morning, DIR_ISS, RET_B102, '0102', `${RET_B102}#0`)).toBe(morning);
    expect(sendReturnToWindow(morning, DIR_ISS, RET_B102, `${RET_B102}#0`)).toBe(morning);
    const work = startDay(morning);
    expect(resubmitReturn(work, DIR_ISS, RET_B102, '  ', `${RET_B102}#0`)).toBe(work);
    expect(resubmitReturn(work, DIR_ISS, 'return.unknown', '0102', `${RET_B102}#0`)).toBe(work);
  });
});

describe('R12：修訂草稿 setIssueDraft（只寫目前可修訂的回條；成功送出後移除該回條的草稿）', () => {
  it('可修訂的回條可以寫入、覆寫、寫空字串；相同值回傳同一物件；不寫事件、不改案件', () => {
    const day3 = startDay(issDay3Morning());
    const a = setIssueDraft(day3, `${RET_B102}#0`, '01');
    expect(a.issueDrafts).toEqual({ [`${RET_B102}#0`]: '01' });
    expect(a.returns).toBe(day3.returns);
    expect(a.events).toBe(day3.events);
    expect(setIssueDraft(a, `${RET_B102}#0`, '01')).toBe(a);
    const b = setIssueDraft(a, `${RET_B102}#0`, '0102');
    expect(b.issueDrafts).toEqual({ [`${RET_B102}#0`]: '0102' });
    expect(setIssueDraft(b, `${RET_B102}#0`, '').issueDrafts).toEqual({ [`${RET_B102}#0`]: '' });
    expect(reloadValid(b)).toBeTrue();
  });

  it('不可寫：非工作階段、未知回條、待核對／待窗口的回條、非字串值 → 回傳同一物件', () => {
    const morning = issDay3Morning();
    expect(setIssueDraft(morning, `${RET_B102}#0`, 'x')).toBe(morning);
    const work = startDay(morning);
    expect(setIssueDraft(work, 'return.unknown#0', 'x')).toBe(work);
    expect(setIssueDraft(work, `mail.${RET_B102}#0`, 'x')).toBe(work);
    expect(setIssueDraft(work, `${RET_B102}#0`, 1 as unknown as string)).toBe(work);
    const resubmitted = resubmitReturn(work, DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`);
    expect(setIssueDraft(resubmitted, `${RET_B102}#0`, 'x')).toBe(resubmitted);
    const windowed = sendReturnToWindow(work, DIR_ISS, RET_B102, `${RET_B102}#0`);
    expect(setIssueDraft(windowed, `${RET_B102}#0`, 'x')).toBe(windowed);
  });

  it('重送成功移除該回條的草稿；送窗口也一樣；別案的草稿保留', () => {
    let s = startDay(issDay3Morning({ B102: '102', B607: '607' }));
    s = setIssueDraft(s, `${RET_B102}#0`, '0102');
    s = setIssueDraft(s, `${RET_B607}#0`, '06');
    const resubmitted = resubmitReturn(s, DIR_ISS, RET_B102, '0102', `${RET_B102}#0`);
    expect(resubmitted.issueDrafts).toEqual({ [`${RET_B607}#0`]: '06' });
    const windowed = sendReturnToWindow(resubmitted, DIR_ISS, RET_B607, `${RET_B607}#0`);
    expect(windowed.issueDrafts).toEqual({});
    expect(reloadValid(windowed)).toBeTrue();
    // 被拒絕的操作不動草稿
    expect(resubmitReturn(s, DIR_ISS, RET_B102, '0102', `${RET_B102}#9`).issueDrafts).toBe(s.issueDrafts);
  });

  it('草稿不影響送出的值：重送用呼叫端傳入的編號（草稿只是暫存）', () => {
    let s = setIssueDraft(startDay(issDay3Morning()), `${RET_B102}#0`, '0102');
    s = resubmitReturn(s, DIR_ISS, RET_B102, '1O2', `${RET_B102}#0`);
    expect(s.returns[0]!.versions[0]!.code).toBe('1O2');
  });

  it('過期回條的草稿保留原值供查看，不能再寫；新回條另開草稿；重送新回條只移除新回條的草稿', () => {
    const day3 = startDay(issDay3Morning());
    let s = resubmitReturn(day3, DIR_ISS, RET_B102, '0l02', `${RET_B102}#0`);
    s = startDay(advanceDay(issFinishDay(s), DIR_ISS));
    // 舊回條 #0 的草稿（例如另一個視窗在送出前寫下的）只保留、不再更新
    const withStale: Save = { ...s, issueDrafts: { [`${RET_B102}#0`]: '舊草稿' } };
    expect(reloadValid(withStale)).toBeTrue();
    expect(setIssueDraft(withStale, `${RET_B102}#0`, '新值')).toBe(withStale);
    const drafted = setIssueDraft(withStale, `${RET_B102}#1`, '0102');
    expect(drafted.issueDrafts).toEqual({ [`${RET_B102}#0`]: '舊草稿', [`${RET_B102}#1`]: '0102' });
    const sent = resubmitReturn(drafted, DIR_ISS, RET_B102, '0102', `${RET_B102}#1`);
    expect(sent.issueDrafts).toEqual({ [`${RET_B102}#0`]: '舊草稿' });
    expect(reloadValid(sent)).toBeTrue();
  });
});

describe('R12：requestHelp（每份存檔只問一次）', () => {
  const REQ = 'request.test.help';
  const ASKED = 1_000_000;
  const DELIVERIES: readonly HelpDelivery[] = [
    { messageId: 'msg.test.help.1', at: 1_003_400 },
    { messageId: 'msg.test.help.2', at: 1_007_100 },
  ];

  it('保存提問的遊戲日、實際時間與逐則送達時間，寫一次 help.request 事件', () => {
    const s0 = createSave(1, DIR);
    const s = requestHelp(s0, REQ, ASKED, DELIVERIES);
    expect(s.helpRequests).toEqual({ [REQ]: { dayId: DAY_01, askedAt: ASKED, deliveries: [...DELIVERIES] } });
    expect(s.events.slice(-1)).toEqual([{ id: `help.request:${s0.events.length}`, kind: 'help.request', payload: { dayId: DAY_01, requestId: REQ } }]);
    expect(countKind(s, EVENT_KINDS.helpRequest)).toBe(1);
    expect(validSave(s)).toBeTrue();
    expect(validSave(JSON.parse(JSON.stringify(s)))).toBeTrue();
  });

  it('dayId 是目前的遊戲日（Day 3 問就記 Day 3）', () => {
    const day3 = startDay(issDay3Morning());
    const s = requestHelp(day3, REQ, ASKED, DELIVERIES);
    expect(s.helpRequests[REQ]!.dayId).toBe(DAY_03);
    expect(reloadValid(s)).toBeTrue();
  });

  it('只問一次：已問過回傳同一物件（不改時間、不再寫事件）', () => {
    const s = requestHelp(createSave(1, DIR), REQ, ASKED, DELIVERIES);
    expect(requestHelp(s, REQ, ASKED + 5000, [{ messageId: 'msg.test.help.1', at: ASKED + 9000 }])).toBe(s);
    expect(requestHelp(s, REQ, ASKED, DELIVERIES)).toBe(s);
    // 不同的提問 ID 各自獨立
    const other = requestHelp(s, 'request.test.other', ASKED, DELIVERIES);
    expect(Object.keys(other.helpRequests).sort()).toEqual(['request.test.help', 'request.test.other']);
  });

  it('保存的是副本：之後改動傳入的陣列不影響存檔', () => {
    const input = DELIVERIES.map((d) => ({ ...d }));
    const s = requestHelp(createSave(1, DIR), REQ, ASKED, input);
    input[0]!.at = 0;
    input.push({ messageId: 'msg.test.help.3', at: 2_000_000 });
    expect(s.helpRequests[REQ]!.deliveries).toEqual([...DELIVERIES]);
  });

  it('送達時間可以與前一則（或提問時間）相同', () => {
    const s = requestHelp(createSave(1, DIR), REQ, ASKED, [
      { messageId: 'a', at: ASKED },
      { messageId: 'b', at: ASKED },
    ]);
    expect(s.helpRequests[REQ]!.deliveries.map((d) => d.at)).toEqual([ASKED, ASKED]);
    expect(validSave(s)).toBeTrue();
  });

  const bad: Array<[string, string, number, readonly HelpDelivery[]]> = [
    ['提問 ID 為空字串', '', ASKED, DELIVERIES],
    ['沒有說明訊息', REQ, ASKED, []],
    ['訊息 ID 重複', REQ, ASKED, [DELIVERIES[0]!, { ...DELIVERIES[1]!, messageId: DELIVERIES[0]!.messageId }]],
    ['訊息 ID 為空字串', REQ, ASKED, [{ messageId: '', at: ASKED + 1 }]],
    ['提問時間為負數', REQ, -1, DELIVERIES],
    ['提問時間為 NaN', REQ, NaN, DELIVERIES],
    ['提問時間為 Infinity', REQ, Infinity, DELIVERIES],
    ['送達時間早於提問時間', REQ, ASKED, [{ messageId: 'a', at: ASKED - 1 }]],
    ['送達時間倒退（非遞增）', REQ, ASKED, [{ messageId: 'a', at: ASKED + 4000 }, { messageId: 'b', at: ASKED + 3000 }]],
    ['送達時間為 NaN', REQ, ASKED, [{ messageId: 'a', at: NaN }]],
    ['送達時間為 Infinity', REQ, ASKED, [{ messageId: 'a', at: Infinity }]],
  ];
  for (const [name, requestId, askedAt, deliveries] of bad) {
    it(`拒絕：${name} → 回傳同一物件、不寫事件`, () => {
      const s = createSave(1, DIR);
      expect(requestHelp(s, requestId, askedAt, deliveries)).toBe(s);
    });
  }
});

describe('R12：answerChat 的回答時間與逐則送達時間', () => {
  const PROMPT = 'prompt.test.timing';
  const CHOICE: ChatChoiceInput = {
    id: 'join',
    text: '好，一起',
    responses: [
      { id: 'msg.test.timing.1', actorId: 'actor.test.a', time: '12:01', lines: ['第一行'] },
      { id: 'msg.test.timing.2', actorId: 'actor.test.b', time: '12:02', lines: ['第二則'] },
    ],
  };
  const AT = 1_700_000_000_000;

  it('有 timing：保存 answeredAt、遊戲日與每則回應的 deliverAt；事件照舊', () => {
    const s0 = createSave(1, DIR);
    const s = answerChat(s0, PROMPT, CHOICE, { answeredAt: AT, deliverAt: [AT + 3200, AT + 6900] });
    expect(s.chatReplies[PROMPT]).toEqual({
      kind: 'answered',
      choiceId: 'join',
      playerText: '好，一起',
      responses: [
        { ...CHOICE.responses[0]!, deliverAt: AT + 3200 },
        { ...CHOICE.responses[1]!, deliverAt: AT + 6900 },
      ],
      answeredAt: AT,
      dayId: DAY_01,
    });
    expect(s.events.slice(-1)).toEqual([{ id: `chat.reply:${s0.events.length}`, kind: 'chat.reply', payload: { promptId: PROMPT, choiceId: 'join' } }]);
    expect(validSave(s)).toBeTrue();
    expect(validSave(JSON.parse(JSON.stringify(s)))).toBeTrue();
  });

  it('遊戲日取自存檔（Day 3 回答記 Day 3）', () => {
    const day3 = startDay(issDay3Morning());
    const s = answerChat(day3, PROMPT, CHOICE, { answeredAt: AT, deliverAt: [AT + 3000, AT + 6000] });
    const reply = s.chatReplies[PROMPT];
    expect(reply?.kind === 'answered' ? reply.dayId : null).toBe(DAY_03);
    expect(reloadValid(s)).toBeTrue();
  });

  it('沒有 timing：與 R7 相同，不寫 answeredAt／dayId／deliverAt 欄位', () => {
    const s = answerChat(createSave(1, DIR), PROMPT, CHOICE);
    const reply = s.chatReplies[PROMPT] as Record<string, unknown>;
    expect('answeredAt' in reply).toBeFalse();
    expect('dayId' in reply).toBeFalse();
    for (const r of reply['responses'] as Record<string, unknown>[]) expect('deliverAt' in r).toBeFalse();
    expect(validSave(s)).toBeTrue();
  });

  it('送達時間可以等於回答時間或前一則；沒有回應時 deliverAt 為空陣列', () => {
    const same = answerChat(createSave(1, DIR), PROMPT, CHOICE, { answeredAt: AT, deliverAt: [AT, AT] });
    expect(same.chatReplies[PROMPT]).toBeDefined();
    const none: ChatChoiceInput = { id: 'quiet', text: '嗯', responses: [] };
    const s = answerChat(createSave(1, DIR), PROMPT, none, { answeredAt: AT, deliverAt: [] });
    expect(s.chatReplies[PROMPT]).toEqual({ kind: 'answered', choiceId: 'quiet', playerText: '嗯', responses: [], answeredAt: AT, dayId: DAY_01 });
  });

  const bad: Array<[string, number, number[]]> = [
    ['deliverAt 比回應少', AT, [AT + 3000]],
    ['deliverAt 比回應多', AT, [AT + 3000, AT + 6000, AT + 9000]],
    ['deliverAt 倒退', AT, [AT + 6000, AT + 3000]],
    ['第一則早於回答時間', AT, [AT - 1, AT + 3000]],
    ['回答時間為負數', -1, [3000, 6000]],
    ['回答時間為 NaN', NaN, [AT + 3000, AT + 6000]],
    ['回答時間為 Infinity', Infinity, [AT + 3000, AT + 6000]],
    ['deliverAt 含 NaN', AT, [AT + 3000, NaN]],
  ];
  for (const [name, answeredAt, deliverAt] of bad) {
    it(`拒絕不合法的 timing：${name} → 回傳同一物件（不保存回覆、不寫事件）`, () => {
      const s = createSave(1, DIR);
      expect(answerChat(s, PROMPT, CHOICE, { answeredAt, deliverAt })).toBe(s);
    });
  }

  it('已回答或已略過的 prompt，帶 timing 也不能改選', () => {
    const answered = answerChat(createSave(1, DIR), PROMPT, CHOICE, { answeredAt: AT, deliverAt: [AT + 3000, AT + 6000] });
    expect(answerChat(answered, PROMPT, CHOICE, { answeredAt: AT + 1, deliverAt: [AT + 3001, AT + 6001] })).toBe(answered);
    const skipped = skipChat(createSave(1, DIR), PROMPT);
    expect(answerChat(skipped, PROMPT, CHOICE, { answeredAt: AT, deliverAt: [AT + 3000, AT + 6000] })).toBe(skipped);
  });
});

describe('R12：入職前情與簽名（signContract／advanceOnboarding／completeOnboarding）', () => {
  /** 停在第 5 段（合約段，由內容決定；核心不知道哪一段是合約）的新存檔。 */
  const atStep = (step: number, patch: Partial<Save> = {}): Save => ({ ...createSave(1, DIR), onboarding: { step, complete: false }, ...patch });

  it('新存檔：未簽名、停在第 0 段、未完成', () => {
    const s = createSave(1, DIR);
    expect(s.profile).toEqual({ name: null });
    expect(s.onboarding).toEqual({ step: 0, complete: false });
  });

  it('簽名：保存正規化後的名字並前進一段（同一次寫入）；不寫事件、不改工作進度', () => {
    const s0 = atStep(5);
    const s = signContract(s0, '  林予安  ');
    expect(s.profile).toEqual({ name: '林予安' });
    expect(s.onboarding).toEqual({ step: 6, complete: false });
    expect(s.events).toBe(s0.events);
    expect(s.batches).toBe(s0.batches);
    expect(validSave(s)).toBeTrue();
  });

  it('名字長度以字素計：24 個可以、25 個不行；表情 ZWJ／組合字各算一個；中文可以', () => {
    expect(signContract(atStep(5), '林'.repeat(PLAYER_NAME_MAX)).profile.name).toBe('林'.repeat(24));
    const tooLong = atStep(5);
    expect(signContract(tooLong, '林'.repeat(PLAYER_NAME_MAX + 1))).toBe(tooLong);
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(signContract(atStep(5), family.repeat(24)).profile.name).toBe(family.repeat(24));
    const tooManyEmoji = atStep(5);
    expect(signContract(tooManyEmoji, family.repeat(25))).toBe(tooManyEmoji);
    expect(signContract(atStep(5), 'e\u0301'.repeat(24)).profile.name).toBe('e\u0301'.repeat(24));
    expect(signContract(atStep(5), '王小明').profile.name).toBe('王小明');
  });

  it('不合法的名字（空白、控制字元）回傳同一物件：不簽名也不前進', () => {
    // 首尾的 Tab／換行／行分隔屬於空白會被去除，因此控制字元放在中間
    for (const raw of ['', '   ', '林\n予安', '林\t安', '\u0000', '林\u0000安', '林\u2028安', '林\u007f']) {
      const s = atStep(5);
      expect(signContract(s, raw)).withContext(JSON.stringify(raw)).toBe(s);
    }
  });

  it('已簽名或已完成入職 → 回傳同一物件（不能改名）', () => {
    const signed = signContract(atStep(5), '林予安');
    expect(signContract(signed, '陳大文')).toBe(signed);
    const complete = atStep(6, { onboarding: { step: 6, complete: true } });
    expect(signContract(complete, '陳大文')).toBe(complete);
    const legacy = { ...createSave(1, DIR), onboarding: { step: 0, complete: true } };
    expect(signContract(legacy, '陳大文')).toBe(legacy);
  });

  it('advanceOnboarding：只能前進到下一段（step＝目前＋1）；跳段、原地、倒退都不動', () => {
    const s = atStep(2);
    const next = advanceOnboarding(s, 3);
    expect(next.onboarding).toEqual({ step: 3, complete: false });
    expect(next.profile).toBe(s.profile);
    for (const step of [2, 4, 1, 0, -1, 2.5, NaN]) expect(advanceOnboarding(s, step)).withContext(String(step)).toBe(s);
  });

  it('advanceOnboarding：已完成入職就不再前進', () => {
    const done = atStep(3, { onboarding: { step: 3, complete: true } });
    expect(advanceOnboarding(done, 4)).toBe(done);
  });

  it('completeOnboarding：必須已簽名；完成後再呼叫回傳同一物件', () => {
    const unsigned = atStep(8);
    expect(completeOnboarding(unsigned)).toBe(unsigned);
    const signed = { ...atStep(8), profile: { name: '林予安' } };
    const done = completeOnboarding(signed);
    expect(done.onboarding).toEqual({ step: 8, complete: true });
    expect(done.profile).toEqual({ name: '林予安' });
    expect(completeOnboarding(done)).toBe(done);
    expect(validSave(done)).toBeTrue();
  });

  it('完整流程：逐段前進 → 簽名（前進一段）→ 前進 → 完成', () => {
    let s = createSave(1, DIR);
    for (let step = 1; step <= 5; step++) s = advanceOnboarding(s, step);
    expect(s.onboarding.step).toBe(5);
    expect(completeOnboarding(s)).toBe(s);
    s = signContract(s, 'Ada');
    expect([s.profile.name, s.onboarding.step]).toEqual(['Ada', 6]);
    s = advanceOnboarding(s, 7);
    s = completeOnboarding(s);
    expect(s.onboarding).toEqual({ step: 7, complete: true });
    expect(validSave(JSON.parse(JSON.stringify(s)))).toBeTrue();
  });
});
