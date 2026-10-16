import { CasePlan, DayDirectory, DayPlan, FieldMapTaskPlan, createDayDirectory } from './day-plan';
import { checkFieldMap } from './field-map';
import { snapshotOf } from './rules';
import { migrateToCurrent } from './save-migrate';
import {
  isRawTaskDone,
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
import { RETURN_RECEIPT_MAIL_PACK, mailIdOfReceipt, receiptMail } from './mail';
import {
  ArchivedRecord,
  BatchState,
  ChatReply,
  FieldMapProgress,
  FieldMapSubmission,
  NightResult,
  ReconcileProgress,
  RecordKey,
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
  MailRecord,
  RecordReview,
  ReturnCase,
  ReturnReceipt,
  ReturnVersion,
  SourceRecord,
  ReturnReceiptAttachment,
} from './types';

/**
 * 存檔 v10（R11）＝ v9 ＋ 持續的文件問題：案件狀態（待修正／已重送待核對／待窗口回覆／已解決）、版本與下游回條、
 * issueSchedule（每日錯誤文件處理引用的案件）、readIssueReceipts（已讀回條，與待處理件數分開）。
 * 存檔 v9（R10）＝ v8 ＋ returns（延後退件）；逐筆審查處置、摘要版本與草稿的處理方式都在既有欄位內。
 * R10 起人員編號只驗型別（文字、非空白），不論目前或歷史批次都不與來源／案件決定預設值比較。
 * 存檔 v8（R9）＝ v7 ＋ caseReviews（多來源比對案件）。v7（R8）：v6 的全部規則（taskProgress[taskId]、欄位映射進度、chatReplies）＋ 多工作日程、morning 階段、waivedTasks。
 * v1 一律不合法；v2–v6 不是現行格式，改由 isValidLegacySaveV2／V3／V4／V5／V6 認結構、save-migrate 轉。
 * 所有目錄與資料皆為測試自建，不依賴正式內容。
 */

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
const BATCH_DAY03 = 'batch.day03.archive';
const BATCH_DAY04 = 'batch.day04.archive';
const BATCH_DAY05 = 'batch.day05.archive';

const DAY1_RECORDS: readonly SourceRecord[] = [
  { key: 'H17', name: '林予安', code: 'H-17', refusal: null, refusalApplies: false },
  { key: 'B102', name: null, code: '0102', refusal: null, refusalApplies: true },
  { key: 'B607', name: null, code: '0607', refusal: true, refusalApplies: true },
];
const DAY3_RECORDS: readonly SourceRecord[] = [
  { key: 'T1', name: null, code: '0001', refusal: null, refusalApplies: false },
  { key: 'T2', name: '測試對象 2', code: '0002', refusal: null, refusalApplies: false },
];
const DAY4_RECORDS: readonly SourceRecord[] = [{ key: 'U1', name: null, code: '0401', refusal: false, refusalApplies: true }];
const DAY5_RECORDS: readonly SourceRecord[] = [{ key: 'V1', name: null, code: '0501', refusal: true, refusalApplies: true }];

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
  ].map(([id, a, b, c, d]) => ({ id, values: { 'legacy-id': a, 'objection-reply': b, 'contact-result': c, 'record-date': d } })),
};
const CORRECT: Record<string, string> = {
  'personnel-code': 'legacy-id',
  'exclude-flag': 'objection-reply',
  'contact-status': 'contact-result',
  'effective-date': 'record-date',
};

function archivePlan(dayId: string, dayNumber: number, nextDayId: string | null, id: string, batchId: string, records: readonly SourceRecord[]): DayPlan {
  return { dayId, dayNumber, nextDayId, tasks: [{ id, kind: 'archive', batchId, recordKeys: records.map((r) => r.key), caseReviews: [] }] };
}
function reconcilePlan(nextDayId: string | null): DayPlan {
  return { dayId: DAY_02, dayNumber: 2, nextDayId, tasks: [{ id: TASK_DAY2, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey: 'B102', recordKeys: ['B102'] }] };
}

const PLAN_DAY1 = archivePlan(DAY_01, 1, DAY_02, TASK_DAY1, BATCH_DAY01, DAY1_RECORDS);

/** 兩天：day.01 歸檔 → day.02 核對（最後一天）。 */
const DIR2: DayDirectory = createDayDirectory([PLAN_DAY1, reconcilePlan(null)], { [BATCH_DAY01]: DAY1_RECORDS });

/** 六天：archive → reconcile → archive → archive → archive → field-map。 */
function sixDays(day1Records: readonly SourceRecord[] = DAY1_RECORDS): DayDirectory {
  return createDayDirectory(
    [
      archivePlan(DAY_01, 1, DAY_02, TASK_DAY1, BATCH_DAY01, day1Records),
      reconcilePlan(DAY_03),
      archivePlan(DAY_03, 3, DAY_04, TASK_DAY3, BATCH_DAY03, DAY3_RECORDS),
      archivePlan(DAY_04, 4, DAY_05, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS),
      archivePlan(DAY_05, 5, DAY_06, TASK_DAY5, BATCH_DAY05, DAY5_RECORDS),
      { dayId: DAY_06, dayNumber: 6, nextDayId: null, tasks: [FIELD_MAP_TASK] },
    ],
    { [BATCH_DAY01]: day1Records, [BATCH_DAY03]: DAY3_RECORDS, [BATCH_DAY04]: DAY4_RECORDS, [BATCH_DAY05]: DAY5_RECORDS },
  );
}
const DIR = sixDays();

function snap(r: SourceRecord) {
  return snapshotOf(r);
}
function archivedOf(records: readonly SourceRecord[]): Record<RecordKey, ArchivedRecord> {
  const out: Record<RecordKey, ArchivedRecord> = {};
  for (const r of records) {
    out[r.key] =
      r.refusalApplies && r.refusal === null
        ? { archiveCode: r.code, refusal: false, origin: 'defaulted', source: snap(r) }
        : { archiveCode: r.code, refusal: r.refusal, origin: 'source', source: snap(r) };
  }
  return out;
}

const archivedAll = archivedOf(DAY1_RECORDS);
const NIGHT_YES: NightResult = { intervention: true, smallTalkVariant: 1, reportRevision: 2 };
const NIGHT_NO: NightResult = { intervention: false, smallTalkVariant: 0, reportRevision: 1 };

function makeBatch(archived: BatchState['archived'] = {}, drafts: BatchState['drafts'] = {}): BatchState {
  return { archived, drafts };
}

/** 合法的 v11 存檔 fixture（day.01／work、入職已完成）；只覆寫需要的欄位。 */
function makeSave(overrides: Partial<Save> = {}): Save {
  return {
    version: 12,
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
    profile: { name: '測試員' },
    onboarding: { step: 6, complete: true },
    events: [],
    readMessages: [],
    ...overrides,
  };
}

function withDay1Batch(archived: BatchState['archived'], overrides: Partial<Save> = {}): Save {
  return makeSave({ batches: { [BATCH_DAY01]: makeBatch(archived) }, ...overrides });
}

function reconcile(p: Partial<ReconcileProgress> = {}): ReconcileProgress {
  return { kind: 'reconcile', reportOpened: false, receiptOpened: false, ...p };
}

const SUBMISSION_DEFAULT: FieldMapSubmission = (() => {
  const c = checkFieldMap(FIELD_MAP_TASK, CORRECT, 'default_false');
  if (!c.ok) throw new Error('fixture');
  return c.result;
})();
const SUBMISSION_REVIEW: FieldMapSubmission = (() => {
  const c = checkFieldMap(FIELD_MAP_TASK, CORRECT, 'request_review');
  if (!c.ok) throw new Error('fixture');
  return c.result;
})();

function omit<T extends object>(o: T, key: string): T {
  const copy = { ...o } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

function fieldMap(p: Partial<FieldMapProgress> = {}): FieldMapProgress {
  return { kind: 'field-map', assignments: {}, previewed: false, ...p };
}

/* ---------- 六天鏈上每個階段的合法 fixture ---------- */

const REPLIED = reconcile({ reportOpened: true, receiptOpened: true, reply: 'review' });

const initial = makeSave();
const d1Wrap = withDay1Batch({ ...archivedAll }, { stage: 'wrap' });
const d2Work = withDay1Batch({ ...archivedAll }, { dayId: DAY_02, taskId: TASK_DAY2, night: NIGHT_YES });
const d2Opened: Save = { ...d2Work, taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true }) } };
const d2Wrap: Save = { ...d2Work, stage: 'wrap', taskProgress: { [TASK_DAY2]: REPLIED } };
const d3Work: Save = { ...d2Wrap, dayId: DAY_03, stage: 'work', taskId: TASK_DAY3 };
const d3Partial: Save = { ...d3Work, batches: { ...d3Work.batches, [BATCH_DAY03]: makeBatch({ T1: archivedOf(DAY3_RECORDS)['T1'] }, { T2: { value: '00' } }) } };
const d3Wrap: Save = { ...d3Work, stage: 'wrap', batches: { ...d3Work.batches, [BATCH_DAY03]: makeBatch(archivedOf(DAY3_RECORDS)) } };
const d4Work: Save = { ...d3Wrap, dayId: DAY_04, stage: 'work', taskId: TASK_DAY4 };
const d4Wrap: Save = { ...d4Work, stage: 'wrap', batches: { ...d4Work.batches, [BATCH_DAY04]: makeBatch(archivedOf(DAY4_RECORDS)) } };
const d5Work: Save = { ...d4Wrap, dayId: DAY_05, stage: 'work', taskId: TASK_DAY5 };
const d5Wrap: Save = { ...d5Work, stage: 'wrap', batches: { ...d5Work.batches, [BATCH_DAY05]: makeBatch(archivedOf(DAY5_RECORDS)) } };
const d6Work: Save = { ...d5Wrap, dayId: DAY_06, stage: 'work', taskId: TASK_DAY6 };
const withFm = (base: Save, p: FieldMapProgress): Save => ({ ...base, taskProgress: { ...base.taskProgress, [TASK_DAY6]: p } });
const d6Partial = withFm(d6Work, fieldMap({ assignments: { 'personnel-code': 'legacy-id' } }));
const d6Mapped = withFm(d6Work, fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'default_false' }));
const d6Previewed = withFm(d6Work, fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'default_false', previewed: true }));
const d6Submitted = withFm(d6Work, fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'default_false', previewed: true, submitted: SUBMISSION_DEFAULT }));
const d6End: Save = { ...d6Submitted, stage: 'end' };
const d6EndReview = withFm(
  { ...d6Work, stage: 'end' },
  fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'request_review', previewed: true, submitted: SUBMISSION_REVIEW }),
);

const valid = (s: unknown, dir: DayDirectory = DIR): boolean => isValidSave(s, dir);

/* ---------- v10：合法 ---------- */

describe('isValidSave：六天鏈每個階段都合法', () => {
  const chain: Array<[string, Save]> = [
    ['day.01 work（初始）', initial],
    ['day.01 wrap', d1Wrap],
    ['day.02 work', d2Work],
    ['day.02 work 已開摘要', d2Opened],
    ['day.02 wrap（已回覆）', d2Wrap],
    ['day.03 work', d3Work],
    ['day.03 work 做了一筆＋草稿', d3Partial],
    ['day.03 wrap', d3Wrap],
    ['day.04 work', d4Work],
    ['day.04 wrap', d4Wrap],
    ['day.05 work', d5Work],
    ['day.05 wrap', d5Wrap],
    ['day.06 work（無進度）', d6Work],
    ['day.06 work 部分對應', d6Partial],
    ['day.06 work 對應齊＋政策', d6Mapped],
    ['day.06 work 已預覽', d6Previewed],
    ['day.06 work 已提交（等 completeWork）', d6Submitted],
    ['day.06 end（default_false）', d6End],
    ['day.06 end（request_review）', d6EndReview],
  ];
  for (const [name, save] of chain) {
    it(name, () => expect(valid(save)).toBeTrue());
  }

  it('每一個階段都能 JSON 往返且內容相等', () => {
    for (const [name, save] of chain) {
      const restored: unknown = JSON.parse(JSON.stringify(save));
      expect(valid(restored)).withContext(name).toBeTrue();
      expect(restored).withContext(name).toEqual(save);
    }
  });
});

describe('isValidSave：其他合法存檔', () => {
  const cases: Array<[string, unknown, DayDirectory?]> = [
    ['day.01 work 帶合法草稿（含 policy）', makeSave({ batches: { [BATCH_DAY01]: makeBatch({}, { B102: { value: '0102', policy: 'default_false' } }) } })],
    ['day.01 work 帶合法草稿（無 policy）', makeSave({ batches: { [BATCH_DAY01]: makeBatch({}, { H17: { value: 'H-1' } }) } })],
    ['day.01 work 已歸檔一筆', withDay1Batch({ B102: archivedAll['B102'] })],
    ['day.01 work 三筆齊（尚未按完成）', withDay1Batch({ ...archivedAll })],
    ['day.02 work 三筆齊＋night（無介入）', { ...d2Work, night: NIGHT_NO }],
    ['day.02 B102 為 review／null', withDay1Batch({ ...archivedAll, B102: { archiveCode: '0102', refusal: null, origin: 'review', source: snap(DAY1_RECORDS[1]) } }, { dayId: DAY_02, taskId: TASK_DAY2, night: NIGHT_YES })],
    ['day.02 work 只開副本', { ...d2Work, taskProgress: { [TASK_DAY2]: reconcile({ receiptOpened: true }) } }],
    ['day.02 wrap＋reply ack（只開摘要即可）', { ...d2Work, stage: 'wrap', taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'ack' }) } }],
    ['day.02 wrap＋reply ask', { ...d2Work, stage: 'wrap', taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'ask' }) } }],
    ['兩天目錄：day.02 end＋reply review（最後一天）', { ...d2Work, stage: 'end', taskProgress: { [TASK_DAY2]: REPLIED } }, DIR2],
    ['day.06 對應重新指派中（空物件）', withFm(d6Work, fieldMap({ blankPolicy: 'request_review' }))],
    ['day.06 對應錯但不重複（進度可保存，由檢查回報錯誤）', withFm(d6Work, fieldMap({ assignments: { ...CORRECT, 'contact-status': 'record-date', 'effective-date': 'contact-result' } }))],
    ['seed 為 0', makeSave({ seed: 0 })],
    ['seed 為 MAX_SEED', makeSave({ seed: 4294967295 })],
    ['帶事件', makeSave({ events: [{ id: 'archive:0', kind: 'archive', payload: { key: 'B102' } }] })],
    ['帶舊字串事件 day1.complete（遷移而來的舊檔不轉換）', makeSave({ events: [{ id: 'day1.complete:3', kind: 'day1.complete', payload: {} }] })],
    ['帶已讀訊息', makeSave({ readMessages: ['msg.a', 'msg.b'] })],
    ['第一天帶合法 night（多餘但結構正確）', makeSave({ night: NIGHT_YES })],
    ['批次存在但內容為空', makeSave({ batches: { [BATCH_DAY01]: makeBatch() } })],
    ['多個批次並存（非目前批次只檢查結構）', makeSave({ batches: { [BATCH_DAY01]: makeBatch(), [BATCH_DAY03]: makeBatch(archivedOf(DAY3_RECORDS)) } })],
    ['歷史批次含已下架 key（結構正確）', makeSave({ batches: { 'batch.day00.archive': makeBatch({ RETIRED: { archiveCode: '0000', refusal: true, origin: 'source', source: { name: '已下架', code: '0000', refusal: true, refusalApplies: true } } }) } })],
    /* R10：非來源編號是格式合法的內容差異，不是毀損存檔（目前批次與歷史批次皆同） */
    ['目前批次 B102 為 "102"（與來源 0102 不同）', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: '102' } })],
    ['目前批次 B102 為 "0103"、B607 為 "  x "', withDay1Batch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '0103' }, B607: { ...archivedAll['B607'], archiveCode: '  x ' } }, { stage: 'wrap' })],
    ['目前批次兩筆填成相同編號', withDay1Batch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '0607' } })],
    ['day.02 work（核對目前看的批次）B102 為 "102"', { ...d2Work, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '102' } }) } }],
    ['Day 4 目前批次 U1 為 "401"', { ...d4Work, batches: { ...d4Work.batches, [BATCH_DAY04]: makeBatch({ U1: { ...archivedOf(DAY4_RECORDS)['U1'], archiveCode: '401' } }) } }],
    ['歷史批次（day.06）B102 為 "102"', { ...d6Work, batches: { ...d6Work.batches, [BATCH_DAY01]: makeBatch({ ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '102' } }) } }],
    ['草稿帶 decisionId（處理方式與編號分開保存）', makeSave({ batches: { [BATCH_DAY01]: makeBatch({}, { H17: { value: 'H-209', decisionId: 'registry' } }) } })],
    ['草稿值為純空白（尚未填寫，只驗型別為文字）', makeSave({ batches: { [BATCH_DAY01]: makeBatch({}, { H17: { value: '   ' } }) } })],
  ];
  for (const [name, save, dir] of cases) {
    it(name, () => expect(valid(save, dir)).toBeTrue());
  }
});

/* ---------- v10：不合法 ---------- */

describe('isValidSave：不合法存檔', () => {
  const badSubmission = (patch: Record<string, unknown>) =>
    withFm(d6Work, { ...fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'default_false', previewed: true }), submitted: { ...SUBMISSION_DEFAULT, ...patch } as FieldMapSubmission });

  const cases: Array<[string, unknown, DayDirectory?]> = [
    ['null', null],
    ['undefined', undefined],
    ['空物件', {}],
    ['陣列', []],
    ['字串', 'save'],
    /* 版本 */
    ['version 1', { ...initial, version: 1 }],
    ['version 2', { ...initial, version: 2 }],
    ['version 3', { ...initial, version: 3 }],
    ['version 4（v4 舊檔不是現行格式）', { ...initial, version: 4 }],
    ['version 5（v5 舊檔不是現行格式，即使帶 chatReplies）', { ...initial, version: 5 }],
    ['version 6（v6 舊檔不是現行格式，即使帶 waivedTasks）', { ...initial, version: 6 }],
    ['version 7（v7 舊檔不是現行格式，即使帶 caseReviews）', { ...initial, version: 7 }],
    ['version 8（v8 舊檔不是現行格式，即使帶 returns）', { ...initial, version: 8 }],
    ['version 9（v9 舊檔不是現行格式，即使帶 issueSchedule）', { ...initial, version: 9 }],
    ['version 10（v10 舊檔不是現行格式，即使帶 mailbox／profile）', { ...initial, version: 10 }],
    ['version 13', { ...initial, version: 13 }],
    ['version 為字串 "11"', { ...initial, version: '11' }],
    ['version 缺', { ...initial, version: undefined }],
    /* dayId／taskId */
    ['dayId 缺', { ...initial, dayId: undefined }],
    ['dayId 未知（day.99）', { ...initial, dayId: 'day.99' }],
    ['dayId 為數字', { ...initial, dayId: 1 }],
    ['dayId 為 day.03 但目錄只有兩天', d3Work, DIR2],
    ['taskId 缺', { ...initial, taskId: undefined }],
    ['taskId 不屬於該日：day.01 帶核對工作', { ...initial, taskId: TASK_DAY2 }],
    ['taskId 不屬於該日：day.02 帶歸檔工作', { ...d2Work, taskId: TASK_DAY1 }],
    ['taskId 不屬於該日：day.06 帶 Day 5 工作', { ...d6Work, taskId: TASK_DAY5 }],
    ['taskId 不屬於該日：day.05 帶 Day 6 工作', { ...d5Work, taskId: TASK_DAY6 }],
    ['taskId 未知', { ...initial, taskId: 'task.unknown' }],
    /* stage */
    ['stage 缺', { ...initial, stage: undefined }],
    ['stage 為舊 phase 名稱 day1', { ...initial, stage: 'day1' }],
    ['stage 為舊 phase 名稱 overnight', { ...d1Wrap, stage: 'overnight' }],
    ['帶舊 phase 欄位而沒有 stage', { ...initial, stage: undefined, phase: 'day1' }],
    /* 有下一日卻 end／無下一日卻 wrap */
    ['day.01 end（有下一日）', { ...d1Wrap, stage: 'end' }],
    ['day.02 end（有下一日；舊 v4 的形狀）', { ...d2Wrap, stage: 'end' }],
    ['day.03 end（有下一日）', { ...d3Wrap, stage: 'end' }],
    ['day.05 end（有下一日）', { ...d5Wrap, stage: 'end' }],
    ['day.06 wrap（最後一天沒有下一日）', { ...d6Submitted, stage: 'wrap' }],
    ['兩天目錄：day.02 wrap（最後一天沒有下一日）', d2Wrap, DIR2],
    /* 未完成卻離開 work */
    ['歸檔日 wrap 但批次為空', { ...initial, stage: 'wrap' }],
    ['歸檔日 wrap 但只歸檔兩筆', withDay1Batch({ H17: archivedAll['H17'], B102: archivedAll['B102'] }, { stage: 'wrap' })],
    ['day.03 wrap 但 Day 3 批次未完成', { ...d3Partial, stage: 'wrap' }],
    ['day.04 wrap 但 Day 4 批次為空', { ...d4Work, stage: 'wrap' }],
    ['核對日 wrap 但沒有回覆', { ...d2Opened, stage: 'wrap' }],
    ['核對日 wrap 但沒有任何進度', { ...d2Work, stage: 'wrap' }],
    ['兩天目錄：核對日 end 但沒有回覆', { ...d2Opened, stage: 'end' }, DIR2],
    ['欄位映射日 end 但只預覽未提交', { ...d6Previewed, stage: 'end' }],
    ['欄位映射日 end 但沒有進度', { ...d6Work, stage: 'end' }],
    /* 前面某一天未完成 */
    ['day.02 work 但 Day 1 批次為空', { ...d2Work, batches: {} }],
    ['day.02 work 但 Day 1 只歸檔兩筆', { ...d2Work, batches: { [BATCH_DAY01]: makeBatch({ H17: archivedAll['H17'], B102: archivedAll['B102'] }) } }],
    ['day.03 work 但 Day 2 沒有回覆', { ...d3Work, taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true }) } }],
    ['day.03 work 但沒有 Day 2 進度', { ...d3Work, taskProgress: {} }],
    ['day.04 work 但 Day 3 批次未完成', { ...d4Work, batches: { ...d4Work.batches, [BATCH_DAY03]: makeBatch({ T1: archivedOf(DAY3_RECORDS)['T1'] }) } }],
    ['day.06 work 但 Day 5 批次缺', { ...d6Work, batches: omit(d6Work.batches, BATCH_DAY05) }],
    ['day.06 work 但 Day 1 批次被清空', { ...d6Work, batches: { ...d6Work.batches, [BATCH_DAY01]: makeBatch() } }],
    /* taskProgress 結構 */
    ['taskProgress 缺', { ...initial, taskProgress: undefined }],
    ['taskProgress 為陣列', { ...initial, taskProgress: [] }],
    ['taskProgress 項目不是物件', { ...initial, taskProgress: { [TASK_DAY2]: 'x' } }],
    ['taskProgress 為未知工作', { ...initial, taskProgress: { 'task.unknown': reconcile() } }],
    ['taskProgress 以 dayId 當鍵', { ...d2Opened, taskProgress: { [DAY_02]: reconcile({ reportOpened: true }) } }],
    ['taskProgress 給歸檔工作（kind archive）', { ...initial, taskProgress: { [TASK_DAY1]: { kind: 'archive' } } }],
    ['taskProgress 給歸檔工作（kind reconcile）', { ...initial, taskProgress: { [TASK_DAY1]: reconcile() } }],
    ['kind 不符：核對工作帶 field-map 進度', { ...d2Work, taskProgress: { [TASK_DAY2]: fieldMap() } }],
    ['kind 不符：欄位映射工作帶 reconcile 進度', { ...d6Work, taskProgress: { ...d6Work.taskProgress, [TASK_DAY6]: reconcile() } }],
    ['kind 缺', { ...d2Work, taskProgress: { [TASK_DAY2]: { reportOpened: true, receiptOpened: false } } }],
    /* reconcile 進度 */
    ['reconcile reportOpened 非布林', { ...d2Work, taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: 'yes', receiptOpened: false } } }],
    ['reconcile receiptOpened 缺', { ...d2Work, taskProgress: { [TASK_DAY2]: { kind: 'reconcile', reportOpened: true } } }],
    ['reconcile reply 非法值', { ...d2Work, taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'maybe' as never }) } }],
    ['reply 但沒開摘要', { ...d2Work, stage: 'wrap', taskProgress: { [TASK_DAY2]: reconcile({ receiptOpened: true, reply: 'ack' }) } }],
    ['review 回覆但沒開副本', { ...d2Work, stage: 'wrap', taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'review' }) } }],
    ['歷史日（day.03 時）的 Day 2 進度 review 但沒開副本', { ...d3Work, taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'review' }) } }],
    /* field-map 進度 */
    ['assignments 缺', withFm(d6Work, { kind: 'field-map', previewed: false } as unknown as FieldMapProgress)],
    ['assignments 為陣列', withFm(d6Work, fieldMap({ assignments: [] as unknown as Record<string, string> }))],
    ['映射目標欄位不存在', withFm(d6Work, fieldMap({ assignments: { 'no-such-target': 'legacy-id' } }))],
    ['映射來源欄位不存在', withFm(d6Work, fieldMap({ assignments: { 'personnel-code': 'no-such-source' } }))],
    ['映射來源用目標 id 冒充', withFm(d6Work, fieldMap({ assignments: { 'personnel-code': 'exclude-flag' } }))],
    ['映射來源重複', withFm(d6Work, fieldMap({ assignments: { 'personnel-code': 'legacy-id', 'contact-status': 'legacy-id' } }))],
    ['映射來源不是字串', withFm(d6Work, fieldMap({ assignments: { 'personnel-code': 1 as unknown as string } }))],
    ['映射來源為空字串', withFm(d6Work, fieldMap({ assignments: { 'personnel-code': '' } }))],
    ['blankPolicy 未知', withFm(d6Work, fieldMap({ blankPolicy: 'skip' as never }))],
    ['previewed 缺', withFm(d6Work, { kind: 'field-map', assignments: {} } as unknown as FieldMapProgress)],
    ['previewed 非布林', withFm(d6Work, fieldMap({ previewed: 'yes' as unknown as boolean }))],
    ['submitted 但 previewed false', withFm(d6Work, fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'default_false', previewed: false, submitted: SUBMISSION_DEFAULT }))],
    ['submitted 不是物件', withFm(d6Work, fieldMap({ previewed: true, submitted: 'done' as unknown as FieldMapSubmission }))],
    ['submitted.rowCount 非數字', badSubmission({ rowCount: '8' })],
    ['submitted.affectedCount 缺', badSubmission({ affectedCount: undefined })],
    ['submitted.blankPolicy 未知', badSubmission({ blankPolicy: 'skip' })],
    ['submitted.blankPolicy 缺（undefined 而非 null）', badSubmission({ blankPolicy: undefined })],
    ['submitted.rows 不是陣列', badSubmission({ rows: {} })],
    ['submitted.rows 長度與 rowCount 不符', badSubmission({ rows: SUBMISSION_DEFAULT.rows.slice(1) })],
    ['submitted.rows 項目缺 id', badSubmission({ rows: SUBMISSION_DEFAULT.rows.map((r, i) => (i === 0 ? { values: r.values } : r)) })],
    ['submitted.rows 項目 values 不是物件', badSubmission({ rows: SUBMISSION_DEFAULT.rows.map((r, i) => (i === 0 ? { id: r.id, values: 'x' } : r)) })],
    ['submitted.rows values 鍵不是目標欄位', badSubmission({ rows: SUBMISSION_DEFAULT.rows.map((r, i) => (i === 0 ? { id: r.id, values: { 'legacy-id': '0102' } } : r)) })],
    ['submitted.rows values 值為數字（0102 被轉成 102）', badSubmission({ rows: SUBMISSION_DEFAULT.rows.map((r, i) => (i === 0 ? { id: r.id, values: { ...r.values, 'personnel-code': 102 } } : r)) })],
    ['end 時 submitted 結構錯誤', { ...badSubmission({ rows: {} }), stage: 'end' }],
    ['submitted 但對應不完整', withFm(d6Work, fieldMap({ assignments: { 'personnel-code': 'legacy-id' }, blankPolicy: 'default_false', previewed: true, submitted: SUBMISSION_DEFAULT }))],
    ['submitted 但缺空值政策', withFm(d6Work, fieldMap({ assignments: { ...CORRECT }, previewed: true, submitted: SUBMISSION_DEFAULT }))],
    /* 非第一天需有 night */
    ['day.02 work 但 night 缺', { ...d2Work, night: undefined }],
    ['day.03 work 但 night 缺', { ...d3Work, night: undefined }],
    ['day.06 end 但 night 缺', { ...d6End, night: undefined }],
    /* night 結構 */
    ['night.reportRevision 與 intervention 不一致（true 卻 1）', { ...d2Work, night: { intervention: true, smallTalkVariant: 1, reportRevision: 1 } }],
    ['night.reportRevision 與 intervention 不一致（false 卻 2）', { ...d2Work, night: { intervention: false, smallTalkVariant: 0, reportRevision: 2 } }],
    ['night.smallTalkVariant 為 2', { ...d2Work, night: { intervention: true, smallTalkVariant: 2, reportRevision: 2 } }],
    ['第一天的 night 結構錯誤也不放行', { ...initial, night: { intervention: true } }],
    /* 全域 evidence／reply 已不屬於 v5–v7：出現也不影響（多餘鍵），但 reply 不能取代 taskProgress */
    ['day.02 wrap 只有舊全域 reply、沒有 taskProgress 回覆', { ...d2Work, stage: 'wrap', reply: 'ack', evidence: { reportOpened: true, receiptOpened: true } }],
    /* 目前批次的 key 必須存在於該批次的集合 */
    ['目前批次含不存在的 archived key', withDay1Batch({ X99: { archiveCode: '99', refusal: null, origin: 'source', source: { name: null, code: '99', refusal: null, refusalApplies: false } } })],
    ['目前批次含不存在的 draft key', makeSave({ batches: { [BATCH_DAY01]: makeBatch({}, { X99: { value: '99' } }) } })],
    ['目前批次含 Day 3 的 key', withDay1Batch({ T1: archivedOf(DAY3_RECORDS)['T1'] })],
    ['Day 3 目前批次含 Day 1 的 key', { ...d3Work, batches: { ...d3Work.batches, [BATCH_DAY03]: makeBatch({ H17: archivedAll['H17'] }) } }],
    /* 批次結構 */
    ['batches 缺', { ...initial, batches: undefined }],
    ['batches 是陣列', { ...initial, batches: [] }],
    ['批次不是物件', { ...initial, batches: { [BATCH_DAY01]: 'x' } }],
    ['批次缺 archived', { ...initial, batches: { [BATCH_DAY01]: { drafts: {} } } }],
    ['批次缺 drafts', { ...initial, batches: { [BATCH_DAY01]: { archived: {} } } }],
    ['drafts.B102.value 是數字', { ...initial, batches: { [BATCH_DAY01]: { archived: {}, drafts: { B102: { value: 5 } } } } }],
    ['drafts.B102.policy 未知', { ...initial, batches: { [BATCH_DAY01]: { archived: {}, drafts: { B102: { value: '0102', policy: 'nope' } } } } }],
    ['drafts.decisionId 為空字串', { ...initial, batches: { [BATCH_DAY01]: { archived: {}, drafts: { H17: { value: 'H-17', decisionId: '' } } } } }],
    ['drafts.decisionId 為數字', { ...initial, batches: { [BATCH_DAY01]: { archived: {}, drafts: { H17: { value: 'H-17', decisionId: 1 } } } } }],
    ['v2 形狀：archived 少了來源快照', withDay1Batch({ B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } as unknown as ArchivedRecord })],
    ['source.code 為數字 102', withDay1Batch({ B102: { ...archivedAll['B102'], source: { name: null, code: 102, refusal: null, refusalApplies: true } } as unknown as ArchivedRecord })],
    ['archived.B102.archiveCode 為空字串', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: '' } })],
    ['archived.B102.archiveCode 為純空白', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: '   ' } })],
    ['archived.B102.archiveCode 為數字 102', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: 102 } as unknown as ArchivedRecord })],
    ['archived.B102.archiveCode 為 null', withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: null } as unknown as ArchivedRecord })],
    ['歷史批次 archiveCode 為純空白也不放行', { ...d3Work, batches: { ...d3Work.batches, [BATCH_DAY01]: makeBatch({ ...archivedAll, B607: { ...archivedAll['B607'], archiveCode: ' ' } }) } }],
    ['歷史批次 archiveCode 為數字也不放行', { ...d6Work, batches: { ...d6Work.batches, [BATCH_DAY04]: makeBatch({ U1: { ...archivedOf(DAY4_RECORDS)['U1'], archiveCode: 401 } as unknown as ArchivedRecord }) } }],
    ['archived.B102.origin 未知', withDay1Batch({ B102: { ...archivedAll['B102'], origin: 'manual' } as unknown as ArchivedRecord })],
    ['歷史批次結構錯誤（少快照）也不放行', { ...d6Work, batches: { ...d6Work.batches, 'batch.day00.archive': makeBatch({ R: { archiveCode: '0', refusal: null, origin: 'source' } as unknown as ArchivedRecord }) } }],
    /* 其他欄位 */
    ['events 不是陣列', { ...initial, events: {} }],
    ['seed -1', makeSave({ seed: -1 })],
    ['seed 非整數', makeSave({ seed: 1.5 })],
    ['readMessages 缺', { ...initial, readMessages: undefined }],
    ['readMessages 含非字串', { ...initial, readMessages: ['msg.a', 3] }],
  ];
  for (const [name, save, dir] of cases) {
    it(name, () => expect(valid(save, dir)).toBeFalse());
  }
});

/* ---------- 批次範圍：以存檔自己的 dayId 決定目前批次 ---------- */

describe('isValidSave：批次範圍', () => {
  it('歷史批次的內容不與現行資料集合比對，只檢查結構', () => {
    const changed: readonly SourceRecord[] = DAY1_RECORDS.map((r) => (r.key === 'B102' ? { ...r, code: '9999' } : r));
    const changedDir = sixDays(changed);
    // R10：Day 1 是目前日也不比對編號（只要求 key 在集合內）
    expect(valid(withDay1Batch({ ...archivedAll }), changedDir)).toBeTrue();
    expect(valid(withDay1Batch({ ...archivedAll }), sixDays(DAY1_RECORDS.filter((r) => r.key !== 'B102')))).toBeFalse();
    // Day 3 起：Day 1 的內容不再被比對（完成度仍以 key 是否齊全判斷）
    expect(valid(d3Work, changedDir)).toBeTrue();
    expect(valid(d6End, changedDir)).toBeTrue();
  });

  it('只有目前批次會被要求「key 必須在資料集合內」', () => {
    const t1 = archivedOf(DAY3_RECORDS)['T1'];
    expect(valid(makeSave({ batches: { [BATCH_DAY03]: makeBatch({ T1: t1 }) } }))).toBeTrue();
    expect(valid(withDay1Batch({ T1: t1 }))).toBeFalse();
  });

  it('核對日只檢查來源批次完成度，不要求後續批次存在', () => {
    expect(valid(d2Work)).toBeTrue();
    expect(d2Work.batches[BATCH_DAY03]).toBeUndefined();
  });

  it('欄位映射日沒有目前批次：前面各批次只需完成，不比對編號', () => {
    const tweaked: Save = { ...d6Work, batches: { ...d6Work.batches, [BATCH_DAY04]: makeBatch({ U1: { ...archivedOf(DAY4_RECORDS)['U1'], archiveCode: 'ZZZ' } }) } };
    expect(valid(tweaked)).toBeTrue();
  });
});

/* ---------- JSON 往返與不改動輸入 ---------- */

describe('isValidSave：JSON 往返', () => {
  it('往返後 B102 的編號與快照編號仍是字串 "0102"', () => {
    const restored = JSON.parse(JSON.stringify(d2Work)) as Save;
    const b102 = restored.batches[BATCH_DAY01]!.archived['B102']!;
    expect(b102.archiveCode).toBe('0102');
    expect(b102.source.code).toBe('0102');
  });

  it('提交快照往返後 personnel-code 仍是 "0102"、request_review 的空值仍是 null', () => {
    const restored = JSON.parse(JSON.stringify(d6EndReview)) as Save;
    const p = restored.taskProgress[TASK_DAY6] as FieldMapProgress;
    expect(p.submitted!.rows[0].values).toEqual({ 'personnel-code': '0102', 'exclude-flag': null, 'contact-status': '未接', 'effective-date': '2026-09-16' });
    expect(valid(restored)).toBeTrue();
  });

  it('不改變傳入的物件', () => {
    for (const s of [d2Wrap, d6End]) {
      const copy = JSON.parse(JSON.stringify(s));
      valid(s);
      expect(s).toEqual(copy);
    }
  });
});

/* ---------- v2 舊檔結構辨識 ---------- */

const legacyArchivedAll: SaveV2['archived'] = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source' },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' },
  B607: { archiveCode: '0607', refusal: true, origin: 'source' },
};

const legacyV2Initial: SaveV2 = {
  version: 2,
  seed: 42,
  phase: 'day1',
  archived: {},
  drafts: {},
  events: [],
  evidence: { reportOpened: false, receiptOpened: false },
};

const legacyV2End: SaveV2 = {
  ...legacyV2Initial,
  phase: 'end',
  archived: { ...legacyArchivedAll },
  drafts: { B102: { value: '0102', policy: 'default_false' } },
  night: NIGHT_YES,
  reply: 'review',
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source' } },
    { id: 'day2.reply:1', kind: 'day2.reply', payload: { choice: 'review' } },
  ],
};

describe('isValidLegacySaveV2：結構合法的 v2 舊檔', () => {
  const cases: Array<[string, unknown]> = [
    ['v2 初始存檔', legacyV2Initial],
    ['v2 day1 已歸檔一筆＋草稿', { ...legacyV2Initial, archived: { B102: legacyArchivedAll['B102'] }, drafts: { H17: { value: 'H-1' } } }],
    ['v2 overnight 三筆齊', { ...legacyV2Initial, phase: 'overnight', archived: legacyArchivedAll }],
    ['v2 day2 三筆齊＋night', { ...legacyV2Initial, phase: 'day2', archived: legacyArchivedAll, night: NIGHT_NO }],
    ['v2 end 完整存檔', legacyV2End],
    ['v2 archived 含未知 key（結構合法，內容由遷移後驗證判定）', { ...legacyV2Initial, archived: { X99: { archiveCode: '99', refusal: null, origin: 'source' } } }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(isValidLegacySaveV2(save)).toBeTrue());
  }
});

describe('isValidLegacySaveV2：不合法', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['空物件', {}],
    ['只有 version 的 {"version":2}', { version: 2 }],
    ['v1（archiveName）', { ...legacyV2Initial, archived: { B102: { archiveName: 102, refusal: false, origin: 'defaulted' } } }],
    ['version 1', { ...legacyV2Initial, version: 1 }],
    ['v3 存檔不是 v2', { ...legacyV2Initial, version: 3 }],
    ['v7 存檔不是 v2', initial],
    ['archiveCode 為數字', { ...legacyV2Initial, archived: { B102: { archiveCode: 102, refusal: false, origin: 'defaulted' } } }],
    ['archiveCode 為空字串', { ...legacyV2Initial, archived: { B102: { archiveCode: '', refusal: false, origin: 'defaulted' } } }],
    ['archived 是陣列', { ...legacyV2Initial, archived: [] }],
    ['archived 缺', { ...legacyV2Initial, archived: undefined }],
    ['drafts 是陣列', { ...legacyV2Initial, drafts: [] }],
    ['草稿 policy 未知', { ...legacyV2Initial, drafts: { B102: { value: '0102', policy: 'nope' } } }],
    ['phase 未知', { ...legacyV2Initial, phase: 'day3' }],
    ['phase 為 stage 名稱', { ...legacyV2Initial, phase: 'work' }],
    ['phase day2 但 night 缺', { ...legacyV2Initial, phase: 'day2', archived: legacyArchivedAll }],
    ['phase end 但 reply 缺', { ...legacyV2End, reply: undefined }],
    ['night 與 intervention 不一致', { ...legacyV2End, night: { intervention: true, smallTalkVariant: 1, reportRevision: 1 } }],
    ['seed 非整數', { ...legacyV2Initial, seed: 1.5 }],
    ['events 不是陣列', { ...legacyV2Initial, events: {} }],
    ['evidence 缺', { ...legacyV2Initial, evidence: undefined }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(isValidLegacySaveV2(save)).toBeFalse());
  }
});

/* ---------- v3 舊檔結構辨識 ---------- */

const legacyV3Initial: SaveV3 = {
  version: 3,
  seed: 42,
  phase: 'day1',
  dayId: DAY_01,
  batches: {},
  events: [],
  evidence: { reportOpened: false, receiptOpened: false },
  readMessages: [],
};

const legacyV3End: SaveV3 = {
  ...legacyV3Initial,
  phase: 'end',
  dayId: DAY_02,
  batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }, { B102: { value: '0102', policy: 'default_false' } }) },
  night: NIGHT_YES,
  reply: 'ack',
  events: [{ id: 'day1.complete:3', kind: 'day1.complete', payload: {} }],
  readMessages: ['msg.a'],
};

describe('isValidLegacySaveV3：結構合法的 v3 舊檔', () => {
  const cases: Array<[string, unknown]> = [
    ['v3 初始存檔', legacyV3Initial],
    ['v3 overnight 三筆齊', { ...legacyV3Initial, phase: 'overnight', batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) } }],
    ['v3 day2＋night', { ...legacyV3End, phase: 'day2', reply: undefined }],
    ['v3 end 完整存檔', legacyV3End],
    ['v3 dayId 不在目錄內（結構檢查不看目錄）', { ...legacyV3Initial, dayId: 'day.99' }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(isValidLegacySaveV3(save)).toBeTrue());
  }
});

describe('isValidLegacySaveV3：不合法', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['空物件', {}],
    ['只有 version 的 {"version":3}', { version: 3 }],
    ['v2 存檔不是 v3', legacyV2End],
    ['v7 存檔不是 v3', d2Wrap],
    ['version 為字串 "3"', { ...legacyV3Initial, version: '3' }],
    ['dayId 缺', { ...legacyV3Initial, dayId: undefined }],
    ['readMessages 缺', { ...legacyV3Initial, readMessages: undefined }],
    ['readMessages 含非字串', { ...legacyV3Initial, readMessages: [1] }],
    ['batches 是陣列', { ...legacyV3Initial, batches: [] }],
    ['批次 archived 少了來源快照（v2 形狀）', { ...legacyV3Initial, batches: { [BATCH_DAY01]: makeBatch({ B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } as unknown as ArchivedRecord }) } }],
    ['phase 未知', { ...legacyV3Initial, phase: 'work' }],
    ['phase day2 但 night 缺', { ...legacyV3End, phase: 'day2', night: undefined }],
    ['phase end 但 reply 缺', { ...legacyV3End, reply: undefined }],
    ['seed 非整數', { ...legacyV3Initial, seed: 1.5 }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(isValidLegacySaveV3(save)).toBeFalse());
  }
});

/* ---------- v4 舊檔結構辨識 ---------- */

const legacyV4Day1: SaveV4 = {
  version: 4,
  seed: 42,
  dayId: DAY_01,
  stage: 'work',
  taskId: TASK_DAY1,
  batches: {},
  evidence: { reportOpened: false, receiptOpened: false },
  events: [],
  readMessages: [],
};
const legacyV4End: SaveV4 = {
  ...legacyV4Day1,
  dayId: DAY_02,
  stage: 'end',
  taskId: TASK_DAY2,
  batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) },
  night: NIGHT_YES,
  evidence: { reportOpened: true, receiptOpened: true },
  reply: 'review',
  readMessages: ['msg.a'],
};

describe('isValidLegacySaveV4：結構合法的 v4 舊檔', () => {
  const cases: Array<[string, unknown]> = [
    ['v4 初始存檔', legacyV4Day1],
    ['v4 day.01 wrap', { ...legacyV4Day1, stage: 'wrap', batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) } }],
    ['v4 day.02 work（沒有 reply）', { ...legacyV4End, stage: 'work', reply: undefined }],
    ['v4 day.02 end＋reply', legacyV4End],
    // 結構檢查不看目錄與階段一致性；交給遷移後的 v5 驗證
    ['v4 dayId／taskId 不在目錄內', { ...legacyV4Day1, dayId: 'day.99', taskId: 'task.x' }],
    ['v4 end 但沒有 reply（結構上允許，遷移後才判定）', { ...legacyV4End, reply: undefined }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(isValidLegacySaveV4(save)).toBeTrue());
  }
});

describe('isValidLegacySaveV4：不合法', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['陣列', []],
    ['空物件', {}],
    ['只有 version 的 {"version":4}', { version: 4 }],
    ['version 為字串 "4"', { ...legacyV4Day1, version: '4' }],
    ['v7 存檔不是 v4', initial],
    ['v3 存檔不是 v4', legacyV3End],
    ['seed 非整數', { ...legacyV4Day1, seed: 1.5 }],
    ['stage 為舊 phase', { ...legacyV4Day1, stage: 'day1' }],
    ['dayId 缺', { ...legacyV4Day1, dayId: undefined }],
    ['taskId 為數字', { ...legacyV4Day1, taskId: 1 }],
    ['events 不是陣列', { ...legacyV4Day1, events: {} }],
    ['evidence 缺', { ...legacyV4Day1, evidence: undefined }],
    ['evidence 欄位非布林', { ...legacyV4Day1, evidence: { reportOpened: 'yes', receiptOpened: false } }],
    ['readMessages 缺', { ...legacyV4Day1, readMessages: undefined }],
    ['readMessages 含非字串', { ...legacyV4Day1, readMessages: [1] }],
    ['reply 非法值', { ...legacyV4End, reply: 'maybe' }],
    ['night 結構錯誤', { ...legacyV4End, night: { intervention: true, smallTalkVariant: 0, reportRevision: 1 } }],
    ['batches 是陣列', { ...legacyV4Day1, batches: [] }],
    ['批次少了來源快照', { ...legacyV4Day1, batches: { [BATCH_DAY01]: makeBatch({ B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } as unknown as ArchivedRecord }) } }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(isValidLegacySaveV4(save)).toBeFalse());
  }
});

/* ---------- v7：chatReplies（R7） ---------- */

const ANSWERED: ChatReply = {
  kind: 'answered',
  choiceId: 'join',
  playerText: '好，我也去。',
  responses: [
    { id: 'msg.test.r1', actorId: 'actor.test.a', time: '12:05', lines: ['那就一起。', '十二點半樓下。'] },
    { id: 'msg.test.r2', actorId: 'actor.test.b', time: '12:06', lines: ['收到'] },
  ],
};
const SKIPPED: ChatReply = { kind: 'skipped' };

const withChat = (base: Save, chatReplies: unknown): unknown => ({ ...base, chatReplies });
const answeredWith = (patch: Record<string, unknown>): unknown => ({ 'prompt.test.a': { ...ANSWERED, ...patch } });
const responseWith = (patch: Record<string, unknown>): unknown => answeredWith({ responses: [{ ...ANSWERED.responses[0], ...patch }] });
const responseWithout = (key: string): unknown => answeredWith({ responses: [omit(ANSWERED.responses[0], key)] });

describe('isValidSave：chatReplies 合法', () => {
  const cases: Array<[string, unknown]> = [
    ['空物件', withChat(initial, {})],
    ['skipped', withChat(initial, { 'prompt.test.a': SKIPPED })],
    ['answered（含回應快照）', withChat(initial, { 'prompt.test.a': ANSWERED })],
    ['answered 沒有回應（空陣列）', withChat(initial, answeredWith({ responses: [] }))],
    ['answered 與 skipped 並存', withChat(d2Work, { 'prompt.test.a': ANSWERED, 'prompt.test.b': SKIPPED })],
    ['指向內容中不存在的 prompt（歷史快照仍有效）', withChat(d3Work, { 'prompt.retired.gone': ANSWERED, 'prompt.never.existed': SKIPPED })],
    ['回應的 actor／id 不在內容中（只驗結構）', withChat(initial, responseWith({ id: 'msg.retired', actorId: 'actor.retired' }))],
    ['最後一天 end 帶回覆', withChat(d6End, { 'prompt.test.a': ANSWERED })],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(valid(save)).toBeTrue());
  }

  it('JSON 往返後 chatReplies 逐字保留且仍合法', () => {
    const save = withChat(d6EndReview, { 'prompt.test.a': ANSWERED, 'prompt.test.b': SKIPPED }) as Save;
    const restored = JSON.parse(JSON.stringify(save)) as Save;
    expect(restored.chatReplies).toEqual(save.chatReplies);
    expect(restored).toEqual(save);
    expect(valid(restored)).toBeTrue();
  });

  it('不改變傳入的物件', () => {
    const save = withChat(d2Work, { 'prompt.test.a': ANSWERED });
    const copy = JSON.parse(JSON.stringify(save));
    valid(save);
    expect(save).toEqual(copy);
  });
});

describe('isValidSave：chatReplies 不合法', () => {
  const cases: Array<[string, unknown]> = [
    ['chatReplies 缺', omit(initial, 'chatReplies')],
    ['chatReplies 為 undefined', withChat(initial, undefined)],
    ['chatReplies 為 null', withChat(initial, null)],
    ['chatReplies 為陣列', withChat(initial, [])],
    ['chatReplies 為字串', withChat(initial, 'none')],
    ['chatReplies 為數字', withChat(initial, 0)],
    ['項目為字串 "skipped"', withChat(initial, { 'prompt.test.a': 'skipped' })],
    ['項目為 null', withChat(initial, { 'prompt.test.a': null })],
    ['項目為陣列', withChat(initial, { 'prompt.test.a': [] })],
    ['kind 未知', withChat(initial, { 'prompt.test.a': { kind: 'pending' } })],
    ['kind 缺', withChat(initial, { 'prompt.test.a': omit(ANSWERED, 'kind') })],
    ['kind 大小寫不符', withChat(initial, { 'prompt.test.a': { kind: 'Skipped' } })],
    ['answered 缺 choiceId', withChat(initial, { 'prompt.test.a': omit(ANSWERED, 'choiceId') })],
    ['answered choiceId 為空字串', withChat(initial, answeredWith({ choiceId: '' }))],
    ['answered choiceId 為數字', withChat(initial, answeredWith({ choiceId: 1 }))],
    ['answered 缺 playerText', withChat(initial, { 'prompt.test.a': omit(ANSWERED, 'playerText') })],
    ['answered playerText 為空字串', withChat(initial, answeredWith({ playerText: '' }))],
    ['answered playerText 為陣列', withChat(initial, answeredWith({ playerText: ['好'] }))],
    ['answered 缺 responses', withChat(initial, { 'prompt.test.a': omit(ANSWERED, 'responses') })],
    ['answered responses 為物件', withChat(initial, answeredWith({ responses: {} }))],
    ['answered responses 為 null', withChat(initial, answeredWith({ responses: null }))],
    ['回應項目為字串', withChat(initial, answeredWith({ responses: ['那就一起。'] }))],
    ['回應項目為 null', withChat(initial, answeredWith({ responses: [null] }))],
    ['回應缺 id', withChat(initial, responseWithout('id'))],
    ['回應 actorId 為數字', withChat(initial, responseWith({ actorId: 7 }))],
    ['回應缺 time', withChat(initial, responseWithout('time'))],
    ['回應缺 lines', withChat(initial, responseWithout('lines'))],
    ['回應 lines 為字串（非陣列）', withChat(initial, responseWith({ lines: '那就一起。' }))],
    ['回應 lines 含數字', withChat(initial, responseWith({ lines: ['那就一起。', 2] }))],
    ['回應 lines 含 null', withChat(initial, responseWith({ lines: [null] }))],
    ['第二筆回應結構錯誤也不放行', withChat(initial, answeredWith({ responses: [ANSWERED.responses[0], { ...ANSWERED.responses[1], lines: [1] }] }))],
    ['一筆合法、另一筆不合法', withChat(initial, { 'prompt.test.a': ANSWERED, 'prompt.test.b': { kind: 'unknown' } })],
    ['後續日（day.06 end）chatReplies 錯誤也不放行', withChat(d6End, { 'prompt.test.a': { kind: 'answered' } })],
    ['v5 形狀（沒有 chatReplies）但標為 version 11', omit({ ...d2Wrap }, 'chatReplies')],
    ['v7 形狀（沒有 caseReviews）但標為 version 11', omit({ ...d2Wrap }, 'caseReviews')],
    ['v8 形狀（沒有 returns）但標為 version 11', omit({ ...d2Wrap }, 'returns')],
    ['v9 形狀（沒有 issueSchedule）但標為 version 11', omit({ ...d2Wrap }, 'issueSchedule')],
    ['v10 形狀（有 readIssueReceipts、沒有 v11 欄位）但標為 version 11', { ...toV10(d2Wrap), version: 11 }],
    ['v10 形狀（缺 mailbox）但標為 version 11', omit({ ...d2Wrap }, 'mailbox')],
    ['v10 形狀（缺 readMail）但標為 version 11', omit({ ...d2Wrap }, 'readMail')],
    ['v10 形狀（缺 profile）但標為 version 11', omit({ ...d2Wrap }, 'profile')],
    ['v10 形狀（缺 onboarding）但標為 version 11', omit({ ...d2Wrap }, 'onboarding')],
    ['v10 形狀（缺 helpRequests）但標為 version 11', omit({ ...d2Wrap }, 'helpRequests')],
    ['v10 形狀（缺 issueDrafts）但標為 version 11', omit({ ...d2Wrap }, 'issueDrafts')],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(valid(save)).toBeFalse());
  }
});

/* ---------- v5／v6 舊檔結構辨識（R8：兩者都是遷移來源） ---------- */

/** v11 專屬欄位（R12）：降版時一律拿掉。 */
type V11Only = 'issueDrafts' | 'mailbox' | 'readMail' | 'helpRequests' | 'profile' | 'onboarding';
function stripV11<T extends Partial<Save>>(s: T): Omit<T, V11Only> {
  const { issueDrafts: _d, mailbox: _m, readMail: _rm, helpRequests: _h, profile: _p, onboarding: _o, ...rest } = s;
  return rest;
}

/**
 * v11 → v10 形狀（R11 存檔）：拿掉 v11 欄位；已讀郵件換回已讀回條（回條 ID）。
 * readIssueReceipts 未指定時由 readMail 推回（郵件 ID＝'mail.'＋回條 ID）。
 */
function toV10(s: Save, readIssueReceipts?: string[]): SaveV10 {
  const { version: _v, ...rest } = stripV11(s);
  const derived = s.readMail.map((id) => id.replace(/^mail\./, ''));
  return { ...rest, version: 10, readIssueReceipts: readIssueReceipts ?? derived };
}

/** v11 → v9 形狀：拿掉 v11 欄位、排程；returns 換成指定的舊格式（預設為空）。 */
function toV9(s: Save, returns: LegacyReturnCaseV9[] = []): SaveV9 {
  const { issueSchedule: _i, returns: _r, version: _v, ...rest } = stripV11(s);
  return { ...rest, version: 9, returns };
}

function toV8(s: Save): SaveV8 {
  const { returns: _r, issueSchedule: _i, version: _v, ...rest } = stripV11(s);
  return { ...rest, version: 8 };
}

function toV7(s: Save): SaveV7 {
  const { caseReviews: _c, returns: _r, issueSchedule: _i, version: _v, ...rest } = stripV11(s);
  return { ...rest, version: 7 };
}

function toV6(s: Save): SaveV6 {
  const { waivedTasks: _drop, caseReviews: _c, returns: _r, issueSchedule: _i, version: _v, ...rest } = stripV11(s);
  return { ...rest, version: 6 };
}

function toV5(s: Save): SaveV5 {
  const { chatReplies: _drop, waivedTasks: _w, caseReviews: _c, returns: _r, issueSchedule: _i, version: _v, ...rest } = stripV11(s);
  return { ...rest, version: 5 };
}

describe('isValidLegacySaveV5／V6：舊檔', () => {
  const chain: Array<[string, Save]> = [
    ['day.01 work', initial],
    ['day.01 wrap', d1Wrap],
    ['day.02 wrap', d2Wrap],
    ['day.03 work 做了一筆＋草稿', d3Partial],
    ['day.06 work 已預覽', d6Previewed],
    ['day.06 end（request_review）', d6EndReview],
  ];
  for (const [name, save] of chain) {
    it(`${name}：v5 形狀只被 legacy v5 認`, () => {
      const v5 = toV5(save);
      expect('chatReplies' in v5).toBeFalse();
      expect('waivedTasks' in v5).toBeFalse();
      expect(isValidLegacySaveV5(v5, DIR)).toBeTrue();
      expect(isValidLegacySaveV6(v5, DIR)).toBeFalse();
      expect(valid(v5)).toBeFalse();
    });
    it(`${name}：v6 形狀只被 legacy v6 認`, () => {
      const v6 = toV6(save);
      expect('waivedTasks' in v6).toBeFalse();
      expect(isValidLegacySaveV6(v6, DIR)).toBeTrue();
      expect(isValidLegacySaveV5(v6, DIR)).toBeFalse();
      expect(valid(v6)).toBeFalse();
    });
  }

  it('JSON 往返後仍被 legacy v5／v6 認', () => {
    expect(isValidLegacySaveV5(JSON.parse(JSON.stringify(toV5(d6End))), DIR)).toBeTrue();
    expect(isValidLegacySaveV6(JSON.parse(JSON.stringify(toV6(d6End))), DIR)).toBeTrue();
  });

  const bad: Array<[string, (s: Save) => unknown, Save]> = [
    ['stage 為 morning（v5／v6 沒有次日收件）', (s) => ({ ...s, stage: 'morning' }), d3Work],
    ['stage 未知', (s) => ({ ...s, stage: 'overnight' }), d1Wrap],
    ['taskId 不屬於該日', (s) => ({ ...s, taskId: TASK_DAY3 }), d2Work],
    ['taskProgress kind 不符', (s) => ({ ...s, taskProgress: { [TASK_DAY2]: fieldMap() } }), d2Work],
    ['taskProgress 缺', (s) => ({ ...s, taskProgress: undefined }), initial],
    ['dayId 未知', (s) => ({ ...s, dayId: 'day.99' }), initial],
    ['readMessages 含非字串', (s) => ({ ...s, readMessages: [1] }), initial],
    ['night 結構錯誤', (s) => ({ ...s, night: { intervention: true, smallTalkVariant: 0, reportRevision: 1 } }), d2Work],
    ['批次少了來源快照', (s) => ({ ...s, batches: { [BATCH_DAY01]: makeBatch({ B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } as unknown as ArchivedRecord }) } }), initial],
    ['seed 非整數', (s) => ({ ...s, seed: 1.5 }), initial],
  ];
  for (const [name, patch, base] of bad) {
    it(`不合法（v5）：${name}`, () => expect(isValidLegacySaveV5(patch(toV5(base) as unknown as Save), DIR)).toBeFalse());
    it(`不合法（v6）：${name}`, () => expect(isValidLegacySaveV6(patch(toV6(base) as unknown as Save), DIR)).toBeFalse());
  }

  it('版本不符：v7／v4 不是 v5，v7／v5 不是 v6；v6 缺 chatReplies 不合法', () => {
    for (const s of [null, [], {}, { version: 5 }, { ...toV5(initial), version: '5' }, initial, legacyV4End]) {
      expect(isValidLegacySaveV5(s, DIR)).toBeFalse();
    }
    for (const s of [null, [], {}, { version: 6 }, { ...toV6(initial), version: '6' }, initial, toV5(initial), legacyV4End]) {
      expect(isValidLegacySaveV6(s, DIR)).toBeFalse();
    }
    expect(isValidLegacySaveV6(omit(toV6(initial), 'chatReplies'), DIR)).toBeFalse();
  });

  // 舊檔檢查只看結構與「taskId 是當日第一件」；日程一致性在遷移補上免補清單後以 v7 規則判定。
  const inconsistent: Array<[string, Save]> = [
    ['day.01 end（有下一日）', { ...d1Wrap, stage: 'end' }],
    ['day.02 work 但 night 缺', { ...d2Work, night: undefined }],
    ['day.03 work 但 Day 2 沒有回覆', { ...d3Work, taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true }) } }],
    ['目前批次含不存在的 key', withDay1Batch({ X99: { archiveCode: '99', refusal: null, origin: 'source', source: { name: null, code: '99', refusal: null, refusalApplies: false } } })],
    ['day.01 wrap 但批次未完成', { ...initial, stage: 'wrap' }],
  ];
  for (const [name, save] of inconsistent) {
    it(`結構合法但不一致：${name} → legacy 認結構，遷移後被 v7 規則拒絕`, () => {
      expect(isValidLegacySaveV5(toV5(save), DIR)).toBeTrue();
      expect(isValidLegacySaveV6(toV6(save), DIR)).toBeTrue();
      expect(migrateToCurrent(toV5(save), DIR)).toBeNull();
      expect(migrateToCurrent(toV6(save), DIR)).toBeNull();
    });
  }
});

describe('十種版本互不相認', () => {
  it('v11 只被 isValidSave 認；v10／v9／v8／v7／v6／v5／v4／v3／v2 只被各自的 legacy 檢查認', () => {
    const checks = [
      (s: unknown) => isValidSave(s, DIR2),
      (s: unknown) => isValidLegacySaveV10(s, DIR2),
      (s: unknown) => isValidLegacySaveV9(s, DIR2),
      (s: unknown) => isValidLegacySaveV8(s, DIR2),
      (s: unknown) => isValidLegacySaveV7(s, DIR2),
      (s: unknown) => isValidLegacySaveV6(s, DIR2),
      (s: unknown) => isValidLegacySaveV5(s, DIR2),
      isValidLegacySaveV4,
      isValidLegacySaveV3,
      isValidLegacySaveV2,
    ];
    const v11End: Save = { ...d2Work, stage: 'end', taskProgress: { [TASK_DAY2]: REPLIED }, chatReplies: { 'prompt.test.a': ANSWERED } };
    const samples: unknown[] = [
      v11End,
      toV10(v11End),
      toV9(v11End),
      toV8(v11End),
      toV7(v11End),
      toV6(v11End),
      toV5(v11End),
      legacyV4End,
      legacyV3End,
      legacyV2End,
    ];
    samples.forEach((sample, i) => {
      checks.forEach((check, j) => expect(check(sample)).withContext(`sample v${11 - i} / check v${11 - j}`).toBe(i === j));
    });
  });
});

/* ---------- R8：同日多工作、morning、waivedTasks ---------- */

/**
 * 多工作目錄（對照 R8 正式資料的形狀，但全部為測試自建）：
 * day.01：歸檔 A → 歸檔 A2（跟進批次）；
 * day.02：核對（看 Day 1 第一批）→ 歸檔 B；
 * day.03：欄位映射（最後一天）。
 */
const M_TASK_1A = 'task.m1.archive';
const M_TASK_1B = 'task.m1.archive-followup';
const M_TASK_2A = 'task.m2.reconcile';
const M_TASK_2B = 'task.m2.archive';
const M_TASK_3 = TASK_DAY6;
const M_BATCH_1B = 'batch.m1.followup';
const M_BATCH_2B = 'batch.m2.archive';
const FOLLOWUP_RECORDS: readonly SourceRecord[] = [
  { key: 'F1', name: null, code: '0801', refusal: false, refusalApplies: true },
  { key: 'F2', name: '測試跟進', code: '0802', refusal: null, refusalApplies: false },
];
const DAY2B_RECORDS: readonly SourceRecord[] = [{ key: 'W1', name: null, code: '0901', refusal: true, refusalApplies: true }];

const MDIR: DayDirectory = createDayDirectory(
  [
    {
      dayId: DAY_01,
      dayNumber: 1,
      nextDayId: DAY_02,
      tasks: [
        { id: M_TASK_1A, kind: 'archive', batchId: BATCH_DAY01, recordKeys: DAY1_RECORDS.map((r) => r.key), caseReviews: [] },
        // M1：同日工作以 dependsOn 保持先後（與正式 Day 1／2 相同）；沒有依賴的工作可以自選順序
        { id: M_TASK_1B, kind: 'archive', batchId: M_BATCH_1B, recordKeys: FOLLOWUP_RECORDS.map((r) => r.key), caseReviews: [], dependsOn: [M_TASK_1A] },
      ],
    },
    {
      dayId: DAY_02,
      dayNumber: 2,
      nextDayId: DAY_03,
      tasks: [
        { id: M_TASK_2A, kind: 'reconcile', sourceBatchId: BATCH_DAY01, subjectKey: 'B102', recordKeys: ['B102'] },
        { id: M_TASK_2B, kind: 'archive', batchId: M_BATCH_2B, recordKeys: DAY2B_RECORDS.map((r) => r.key), caseReviews: [], dependsOn: [M_TASK_2A] },
      ],
    },
    { dayId: DAY_03, dayNumber: 3, nextDayId: null, tasks: [FIELD_MAP_TASK] },
  ],
  { [BATCH_DAY01]: DAY1_RECORDS, [M_BATCH_1B]: FOLLOWUP_RECORDS, [M_BATCH_2B]: DAY2B_RECORDS },
);

const mvalid = (s: unknown): boolean => isValidSave(s, MDIR);

const m1a = makeSave({ taskId: M_TASK_1A });
const m1aDone = withDay1Batch({ ...archivedAll }, { taskId: M_TASK_1A });
const m1b: Save = { ...m1aDone, taskId: M_TASK_1B };
const m1bPartial: Save = { ...m1b, batches: { ...m1b.batches, [M_BATCH_1B]: makeBatch({ F1: archivedOf(FOLLOWUP_RECORDS)['F1'] }, { F2: { value: '08' } }) } };
const m1bDone: Save = { ...m1b, batches: { ...m1b.batches, [M_BATCH_1B]: makeBatch(archivedOf(FOLLOWUP_RECORDS)) } };
const m1Wrap: Save = { ...m1bDone, stage: 'wrap' };
const m1WrapWaived: Save = { ...m1aDone, taskId: M_TASK_1B, stage: 'wrap', waivedTasks: [M_TASK_1B] };
const m2Morning: Save = { ...m1Wrap, dayId: DAY_02, stage: 'morning', taskId: M_TASK_2A, night: NIGHT_NO };
const m2Work: Save = { ...m2Morning, stage: 'work' };
const m2B: Save = { ...m2Work, taskId: M_TASK_2B, taskProgress: { [M_TASK_2A]: REPLIED } };
const m2Wrap: Save = { ...m2B, stage: 'wrap', batches: { ...m2B.batches, [M_BATCH_2B]: makeBatch(archivedOf(DAY2B_RECORDS)) } };
const m2WrapWaived: Save = { ...m2B, stage: 'wrap', waivedTasks: [M_TASK_2B] };
const m3Morning: Save = { ...m2Wrap, dayId: DAY_03, stage: 'morning', taskId: M_TASK_3 };
const m3Work: Save = { ...m3Morning, stage: 'work' };
const m3End: Save = withFm(
  { ...m3Work, stage: 'end' },
  fieldMap({ assignments: { ...CORRECT }, blankPolicy: 'default_false', previewed: true, submitted: SUBMISSION_DEFAULT }),
);

describe('isValidSave（R8）：多工作日程合法', () => {
  const cases: Array<[string, Save]> = [
    ['day.01 work 第 1 項（初始）', m1a],
    ['day.01 work 第 1 項已齊、尚未交付', m1aDone],
    ['day.01 work 第 2 項（第 1 項已完成）', m1b],
    ['day.01 work 第 2 項做了一筆＋草稿', m1bPartial],
    ['day.01 work 第 2 項已齊、尚未交付', m1bDone],
    ['day.01 wrap（兩項皆完成）', m1Wrap],
    ['day.01 wrap（第 2 項免補）', m1WrapWaived],
    ['day.02 morning（第 1 項、有 night）', m2Morning],
    ['day.02 work 第 1 項（核對）', m2Work],
    ['day.02 work 第 2 項（核對已回覆）', m2B],
    ['day.02 wrap', m2Wrap],
    ['day.02 wrap（第 2 項免補）', m2WrapWaived],
    ['day.02 morning（Day 1 第 2 項免補）', { ...m2Morning, batches: omit(m2Morning.batches, M_BATCH_1B), waivedTasks: [M_TASK_1B] }],
    ['day.03 morning', m3Morning],
    ['day.03 work', m3Work],
    ['day.03 end', m3End],
    ['day.03 end（Day 1、Day 2 第 2 項都免補）', { ...m3End, batches: { [BATCH_DAY01]: makeBatch({ ...archivedAll }) }, waivedTasks: [M_TASK_1B, M_TASK_2B] }],
    ['day.01 第 2 項批次編號與來源不同（R10 合法）', { ...m1b, batches: { ...m1b.batches, [M_BATCH_1B]: makeBatch({ F1: { ...archivedOf(FOLLOWUP_RECORDS)['F1'], archiveCode: '801' } }) } }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(mvalid(save)).toBeTrue());
  }

  it('JSON 往返保留 waivedTasks 與 morning 並仍合法', () => {
    for (const [name, save] of cases) {
      const restored: unknown = JSON.parse(JSON.stringify(save));
      expect(restored).withContext(name).toEqual(save);
      expect(mvalid(restored)).withContext(name).toBeTrue();
    }
  });
});

describe('isValidSave（R8）：多工作日程不合法', () => {
  const cases: Array<[string, unknown]> = [
    /* active task 必須屬於當日 */
    ['day.01 帶 Day 2 的工作', { ...m1b, taskId: M_TASK_2B }],
    ['day.02 帶 Day 1 第 2 項', { ...m2Work, taskId: M_TASK_1B }],
    ['taskId 未知', { ...m1b, taskId: 'task.m1.nope' }],
    /* 同日排在 active 之前的工作須已完成或免補 */
    ['day.01 第 2 項但第 1 項批次為空', { ...m1a, taskId: M_TASK_1B }],
    ['day.01 第 2 項但第 1 項只歸檔兩筆', withDay1Batch({ H17: archivedAll['H17'], B102: archivedAll['B102'] }, { taskId: M_TASK_1B })],
    ['day.02 第 2 項但核對未回覆', { ...m2Work, taskId: M_TASK_2B, taskProgress: { [M_TASK_2A]: reconcile({ reportOpened: true }) } }],
    /* wrap／end 時全日須完成或免補 */
    ['day.01 wrap 但第 2 項未完成', { ...m1bPartial, stage: 'wrap' }],
    ['day.01 wrap 但停在第 1 項、第 2 項未做', { ...m1aDone, stage: 'wrap' }],
    ['day.02 wrap 但第 2 項未完成也未免補', { ...m2B, stage: 'wrap' }],
    ['day.03 end 但欄位映射未提交', { ...m3Work, stage: 'end' }],
    /* morning */
    ['第一天不能是 morning', { ...m1a, stage: 'morning' }],
    ['第一天 morning（批次齊）也不行', { ...m1aDone, stage: 'morning' }],
    ['day.02 morning 但 night 缺', { ...m2Morning, night: undefined }],
    ['day.02 morning 但停在第 2 項（第 1 項未回覆）', { ...m2Morning, taskId: M_TASK_2B }],
    /* 前面日子的每件工作都須完成或免補 */
    ['day.02 work 但 Day 1 第 2 項未完成', { ...m2Work, batches: omit(m2Work.batches, M_BATCH_1B) }],
    ['day.02 morning 但 Day 1 第 2 項只做一筆', { ...m2Morning, batches: { ...m2Morning.batches, [M_BATCH_1B]: makeBatch({ F1: archivedOf(FOLLOWUP_RECORDS)['F1'] }) } }],
    ['day.03 work 但 Day 2 第 2 項未完成', { ...m3Work, batches: omit(m3Work.batches, M_BATCH_2B) }],
    ['day.03 work 但 Day 1 第 1 項被清空（第一件不會免補）', { ...m3Work, batches: { ...m3Work.batches, [BATCH_DAY01]: makeBatch() } }],
    ['day.03 work 但 Day 1 第 1 項批次整個缺', { ...m3Work, batches: omit(m3Work.batches, BATCH_DAY01) }],
    /* 目前工作的批次：key 須屬於該批次（R10 起不比對編號） */
    ['day.01 第 2 項批次含第 1 項的 key', { ...m1b, batches: { ...m1b.batches, [M_BATCH_1B]: makeBatch({ H17: archivedAll['H17'] }) } }],
    /* waivedTasks 結構 */
    ['waivedTasks 缺', omit(m1a, 'waivedTasks')],
    ['waivedTasks 為 undefined', { ...m1a, waivedTasks: undefined }],
    ['waivedTasks 為 null', { ...m1a, waivedTasks: null }],
    ['waivedTasks 為物件', { ...m1a, waivedTasks: {} }],
    ['waivedTasks 為字串', { ...m1a, waivedTasks: M_TASK_1B }],
    ['waivedTasks 含數字', { ...m1a, waivedTasks: [1] }],
    ['waivedTasks 含未知工作', { ...m1WrapWaived, waivedTasks: [M_TASK_1B, 'task.unknown'] }],
    ['waivedTasks 以 dayId 當工作', { ...m1WrapWaived, waivedTasks: [DAY_01] }],
    ['waivedTasks 重複', { ...m1WrapWaived, waivedTasks: [M_TASK_1B, M_TASK_1B] }],
    /* 免補範圍：只允許已跨過日子的第 2 件以後工作（手改存檔不能跳過真正的第一件） */
    ['免補當日第一件（Day 1 wrap，第一批沒做）', { ...m1a, taskId: M_TASK_1B, stage: 'wrap', waivedTasks: [M_TASK_1A, M_TASK_1B] }],
    ['目前日仍在 work 就免補第 2 件', { ...m1aDone, taskId: M_TASK_1B, stage: 'work', waivedTasks: [M_TASK_1B] }],
    ['免補未來日子的工作', { ...m1a, waivedTasks: [M_TASK_2B] }],
    ['免補目前日第 2 件後停在 morning', { ...m2B, stage: 'morning', waivedTasks: [M_TASK_2B] }],
    ['核對已回覆卻仍停在該核對工作（會卡住）', { ...m2Work, taskId: M_TASK_2A, stage: 'work', taskProgress: { [M_TASK_2A]: REPLIED } }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(mvalid(save)).toBeFalse());
  }

  it('對照組：只差在 waivedTasks 的同一份存檔，免補 → 合法、未免補 → 不合法', () => {
    const unsettled: Save = { ...m1aDone, taskId: M_TASK_1B, stage: 'wrap', waivedTasks: [] };
    expect(mvalid(unsettled)).toBeFalse();
    expect(mvalid({ ...unsettled, waivedTasks: [M_TASK_1B] })).toBeTrue();
    const day2 = { ...m2Work, batches: omit(m2Work.batches, M_BATCH_1B) };
    expect(mvalid(day2)).toBeFalse();
    expect(mvalid({ ...day2, waivedTasks: [M_TASK_1B] })).toBeTrue();
  });
});

describe('isValidLegacySaveV6／V5（R8）：舊檔每天只有第一件工作', () => {
  it('taskId 必須是當日第一件：第 2 項、他日工作都拒絕', () => {
    const v6 = toV6(m1a);
    expect(isValidLegacySaveV6(v6, MDIR)).toBeTrue();
    expect(isValidLegacySaveV6({ ...v6, taskId: M_TASK_1B }, MDIR)).toBeFalse();
    expect(isValidLegacySaveV6({ ...toV6(m2Work), taskId: M_TASK_2B }, MDIR)).toBeFalse();
    expect(isValidLegacySaveV6({ ...v6, taskId: M_TASK_2A }, MDIR)).toBeFalse();
    expect(isValidLegacySaveV5({ ...toV5(m1a), taskId: M_TASK_1B }, MDIR)).toBeFalse();
    expect(isValidLegacySaveV5(toV5(m2Work), MDIR)).toBeTrue();
  });

  it('只接受舊階段 work／wrap／end：morning 在 v5／v6 都拒絕', () => {
    for (const stage of ['work', 'wrap', 'end'] as const) {
      expect(isValidLegacySaveV6({ ...toV6(m2Work), stage }, MDIR)).withContext(stage).toBeTrue();
      expect(isValidLegacySaveV5({ ...toV5(m2Work), stage }, MDIR)).withContext(stage).toBeTrue();
    }
    expect(isValidLegacySaveV6(toV6(m2Morning), MDIR)).toBeFalse();
    expect(isValidLegacySaveV5(toV5(m2Morning), MDIR)).toBeFalse();
    expect(isValidLegacySaveV6(toV6(m3Morning), MDIR)).toBeFalse();
  });
});

describe('isRawTaskDone（R8）', () => {
  const plan1 = MDIR.plan(DAY_01)!;
  const plan2 = MDIR.plan(DAY_02)!;
  const plan3 = MDIR.plan(DAY_03)!;
  const raw = (s: unknown) => s as Record<string, unknown>;

  it('歸檔＝該批次集合全部歸檔；核對＝已回覆；欄位映射＝已提交', () => {
    expect(isRawTaskDone(raw(m1a), MDIR, plan1.tasks[0]!)).toBeFalse();
    expect(isRawTaskDone(raw(m1aDone), MDIR, plan1.tasks[0]!)).toBeTrue();
    expect(isRawTaskDone(raw(m1bPartial), MDIR, plan1.tasks[1]!)).toBeFalse();
    expect(isRawTaskDone(raw(m1bDone), MDIR, plan1.tasks[1]!)).toBeTrue();
    expect(isRawTaskDone(raw(m2Work), MDIR, plan2.tasks[0]!)).toBeFalse();
    expect(isRawTaskDone(raw(m2B), MDIR, plan2.tasks[0]!)).toBeTrue();
    expect(isRawTaskDone(raw(m3Work), MDIR, plan3.tasks[0]!)).toBeFalse();
    expect(isRawTaskDone(raw(m3End), MDIR, plan3.tasks[0]!)).toBeTrue();
  });

  it('免補不是完成：waivedTasks 列入也不讓 isRawTaskDone 為 true', () => {
    expect(isRawTaskDone(raw(m1WrapWaived), MDIR, plan1.tasks[1]!)).toBeFalse();
    expect(isRawTaskDone(raw(m2WrapWaived), MDIR, plan2.tasks[1]!)).toBeFalse();
  });

  it('批次或進度欄位壞掉時視為未完成，不拋錯', () => {
    expect(isRawTaskDone(raw({ batches: { [BATCH_DAY01]: 'x' }, taskProgress: {} }), MDIR, plan1.tasks[0]!)).toBeFalse();
    expect(isRawTaskDone(raw({ batches: {}, taskProgress: { [M_TASK_2A]: 'x' } }), MDIR, plan2.tasks[0]!)).toBeFalse();
  });
});

/* ---------- R9：多來源比對案件（caseReviews＋caseDecision 快照） ---------- */

const CASE_ID = 'case.day3.h204';
const CASE_DOC_REGISTRY = 'doc.test.h204.registry';
const CASE_DOC_SUPPLEMENT = 'doc.test.h204.supplement';
const H204: SourceRecord = { key: 'H204', name: '測試案件', code: 'H-204', refusal: null, refusalApplies: false };
const CASE3_RECORDS: readonly SourceRecord[] = [...DAY3_RECORDS, H204];
const CASE_PLAN: CasePlan = {
  id: CASE_ID,
  recordKey: 'H204',
  variantIds: ['received', 'pending'],
  decisions: [
    { id: 'registry', archiveCode: 'H-204', destination: 'archive', basisDocumentId: CASE_DOC_REGISTRY, note: '採用原表。' },
    { id: 'supplement', archiveCode: 'H-205', destination: 'archive', basisDocumentId: CASE_DOC_SUPPLEMENT, note: '採用補件。' },
    { id: 'review', archiveCode: 'H-204', destination: 'review', basisDocumentId: CASE_DOC_REGISTRY, note: '待確認。' },
  ],
};
/** day.01 歸檔 → day.02 核對 → day.03 歸檔（含案件 H204）→ day.04 歸檔（最後一天）。 */
const CDIR: DayDirectory = createDayDirectory(
  [
    PLAN_DAY1,
    reconcilePlan(DAY_03),
    { dayId: DAY_03, dayNumber: 3, nextDayId: DAY_04, tasks: [{ id: TASK_DAY3, kind: 'archive', batchId: BATCH_DAY03, recordKeys: CASE3_RECORDS.map((r) => r.key), caseReviews: [CASE_PLAN] }] },
    archivePlan(DAY_04, 4, null, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS),
  ],
  { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_DAY03]: CASE3_RECORDS, [BATCH_DAY04]: DAY4_RECORDS },
);
const cvalid = (s: unknown): boolean => isValidSave(s, CDIR);

function caseArchived(decisionId: string, archiveCode?: string, patch: Record<string, unknown> = {}): ArchivedRecord {
  const d = CASE_PLAN.decisions.find((x) => x.id === decisionId);
  return {
    archiveCode: archiveCode ?? d?.archiveCode ?? 'H-204',
    refusal: null,
    origin: 'source',
    source: snap(H204),
    caseDecision: {
      caseId: CASE_ID,
      decisionId,
      destination: d?.destination ?? 'archive',
      basisDocumentId: d?.basisDocumentId ?? CASE_DOC_REGISTRY,
      note: d?.note ?? '註記',
      ...patch,
    } as ArchivedRecord['caseDecision'],
  };
}
const legacyH204: ArchivedRecord = { archiveCode: 'H-204', refusal: null, origin: 'source', source: snap(H204) };
const OPENED = { [CASE_ID]: { variantId: 'received', marks: [] as string[] } };

const c3Work: Save = { ...d3Work, caseReviews: {} };
const c3With = (h204: unknown, others: BatchState['archived'] = {}): Save =>
  ({ ...c3Work, caseReviews: OPENED, batches: { ...c3Work.batches, [BATCH_DAY03]: makeBatch({ ...others, H204: h204 as ArchivedRecord }) } }) as Save;
const c3Wrap = (h204: ArchivedRecord): Save => ({ ...c3With(h204, archivedOf(DAY3_RECORDS)), stage: 'wrap' });
const c4Work = (h204: unknown): Save =>
  ({ ...c3Wrap(h204 as ArchivedRecord), dayId: DAY_04, stage: 'work', taskId: TASK_DAY4 }) as Save;

describe('isValidSave（R9）：案件合法', () => {
  const cases: Array<[string, Save]> = [
    ['day.03 work 尚未開案', c3Work],
    ['day.03 work 已開案（received、無標記）', { ...c3Work, caseReviews: OPENED }],
    ['day.03 work 已開案（pending、兩個標記）', { ...c3Work, caseReviews: { [CASE_ID]: { variantId: 'pending', marks: ['人員編號', '送件時間'] } } }],
    ['day.03 work 決定 registry（H-204）', c3With(caseArchived('registry'))],
    ['day.03 work 決定 supplement（H-205，目前批次）', c3With(caseArchived('supplement'))],
    ['day.03 work 決定 review（H-204／review）', c3With(caseArchived('review'))],
    ['day.03 wrap 決定 supplement，其他紀錄一般流程', c3Wrap(caseArchived('supplement'))],
    ['day.03 work 舊檔已歸檔 H204、沒有案件決定（H-204）', c3With(legacyH204)],
    ['day.03 wrap 舊檔已歸檔 H204、沒有案件決定、也沒開過案', { ...c3Wrap(legacyH204), caseReviews: {} }],
    ['day.04 work 歷史批次含 supplement 決定', c4Work(caseArchived('supplement'))],
    ['day.04 work 歷史批次的決定已不在內容（只驗結構）', c4Work(caseArchived('retired', 'H-999'))],
    ['day.04 work 歷史批次的決定編號與內容不符（只驗結構）', c4Work(caseArchived('registry', 'H-205'))],
    /* R10：案件編號是玩家填寫的值，與決定預設值、來源都不比較（目前批次亦同） */
    ['day.03 work H-205 但沒有案件決定（舊流程保存的玩家輸入）', c3With({ ...legacyH204, archiveCode: 'H-205' })],
    ['day.03 work 沒有決定且編號任意', c3With({ ...legacyH204, archiveCode: 'H-999' })],
    ['day.03 work 決定 supplement 但編號 H-204', c3With(caseArchived('supplement', 'H-204'))],
    ['day.03 work 決定 registry 但編號 H-205', c3With(caseArchived('registry', 'H-205'))],
    ['day.03 work 決定 review 但編號 h204', c3With(caseArchived('review', 'h204'))],
    ['day.03 wrap 決定 registry、編號與同批 T1 相同', c3Wrap(caseArchived('registry', '0001'))],
  ];
  for (const [name, save] of cases) {
    it(name, () => {
      expect(cvalid(save)).toBeTrue();
      expect(cvalid(JSON.parse(JSON.stringify(save)))).toBeTrue();
    });
  }
});

describe('isValidSave（R9）：案件不合法', () => {
  const cases: Array<[string, unknown]> = [
    /* 目前批次：決定 ID 須存在，依據／去向須與該決定一致（編號只驗型別） */
    ['決定 ID 未知', c3With(caseArchived('nope', 'H-204'))],
    ['決定 registry 但去向 review', c3With(caseArchived('registry', undefined, { destination: 'review' }))],
    ['決定 review 但去向 archive', c3With(caseArchived('review', undefined, { destination: 'archive' }))],
    ['決定 supplement 但依據為原表', c3With(caseArchived('supplement', undefined, { basisDocumentId: CASE_DOC_REGISTRY }))],
    ['決定 registry 但依據為未知文件', c3With(caseArchived('registry', undefined, { basisDocumentId: 'doc.unknown' }))],
    ['案件編號為空字串', c3With(caseArchived('registry', ''))],
    ['案件編號為純空白', c3With(caseArchived('registry', '  '))],
    ['案件編號為數字', c3With(caseArchived('registry', 204 as unknown as string))],
    ['caseDecision 的 caseId 不是這個案件', c3With(caseArchived('registry', undefined, { caseId: 'case.other' }))],
    ['非案件紀錄帶 caseDecision', c3With(legacyH204, { T1: { ...archivedOf(DAY3_RECORDS)['T1']!, caseDecision: caseArchived('registry').caseDecision } })],
    /* caseDecision 結構（任何批次都檢查） */
    ['caseDecision destination 未知', c3With(caseArchived('registry', undefined, { destination: 'trash' }))],
    ['caseDecision 缺 note', c3With(caseArchived('registry', undefined, { note: undefined }))],
    ['caseDecision note 為空字串', c3With(caseArchived('registry', undefined, { note: '' }))],
    ['caseDecision basisDocumentId 為數字', c3With(caseArchived('registry', undefined, { basisDocumentId: 1 }))],
    ['caseDecision 為陣列', c3With({ ...legacyH204, caseDecision: [] })],
    ['caseDecision 為 null', c3With({ ...legacyH204, caseDecision: null })],
    ['歷史批次 caseDecision 缺 decisionId', c4Work(caseArchived('registry', undefined, { decisionId: undefined }))],
    ['歷史批次 caseDecision destination 未知', c4Work(caseArchived('registry', undefined, { destination: 'x' }))],
    /* caseReviews */
    ['caseReviews 缺', omit(c3Work, 'caseReviews')],
    ['caseReviews 為 null', { ...c3Work, caseReviews: null }],
    ['caseReviews 為陣列', { ...c3Work, caseReviews: [] }],
    ['caseReviews 含未知案件', { ...c3Work, caseReviews: { 'case.unknown': { variantId: 'received', marks: [] } } }],
    ['caseReviews 變體不屬於該案件', { ...c3Work, caseReviews: { [CASE_ID]: { variantId: 'lost', marks: [] } } }],
    ['caseReviews 標記重複', { ...c3Work, caseReviews: { [CASE_ID]: { variantId: 'received', marks: ['姓名', '姓名'] } } }],
    ['caseReviews 標記含數字', { ...c3Work, caseReviews: { [CASE_ID]: { variantId: 'received', marks: [1] } } }],
    ['caseReviews 缺 variantId', { ...c3Work, caseReviews: { [CASE_ID]: { marks: [] } } }],
    ['caseReviews 缺 marks', { ...c3Work, caseReviews: { [CASE_ID]: { variantId: 'received' } } }],
    ['caseReviews 狀態為字串', { ...c3Work, caseReviews: { [CASE_ID]: 'received' } }],
  ];
  for (const [name, save] of cases) {
    it(name, () => expect(cvalid(save)).toBeFalse());
  }

  it('沒有案件的目錄：任何 caseReviews 條目都不合法', () => {
    expect(valid({ ...d3Work, caseReviews: OPENED })).toBeFalse();
    expect(valid(d3Work)).toBeTrue();
  });
});

describe('isValidLegacySaveV7（R9）／v7 → v8', () => {
  it('v7 沒有 caseReviews：只被 legacy v7 認；補上空 caseReviews 後才是 v8', () => {
    const v7 = toV7(c3With(legacyH204));
    expect('caseReviews' in v7).toBeFalse();
    expect(isValidLegacySaveV7(v7, CDIR)).toBeTrue();
    expect(cvalid(v7)).toBeFalse();
    expect(isValidLegacySaveV7(c3With(legacyH204), CDIR)).toBeFalse();
  });

  it('舊檔已歸檔 H204（沒有決定）→ from 7，caseReviews 為空，不補造決定', () => {
    for (const base of [c3With(legacyH204), c3Wrap(legacyH204), c4Work(legacyH204)]) {
      const v7 = toV7(base);
      const result = migrateToCurrent(JSON.parse(JSON.stringify(v7)), CDIR)!;
      expect(result).withContext(`${base.dayId}/${base.stage}`).not.toBeNull();
      expect(result.from).toBe(7);
      expect(result.save.caseReviews).toEqual({});
      expect(result.save.batches[BATCH_DAY03]!.archived['H204']).toEqual(legacyH204);
      expect('caseDecision' in result.save.batches[BATCH_DAY03]!.archived['H204']!).toBeFalse();
    }
  });

  it('R10：v7 目前批次 H204 為 H-205 且沒有決定 → 照樣遷移（from 7），編號原樣保留、不補造決定', () => {
    const result = migrateToCurrent(toV7(c3With({ ...legacyH204, archiveCode: 'H-205' })), CDIR)!;
    expect(result).not.toBeNull();
    expect(result.from).toBe(7);
    expect(result.save.version).toBe(12);
    expect(result.save.returns).toEqual([]);
    expect(result.save.issueSchedule).toEqual({});
    expect(result.save.mailbox).toEqual([]);
    expect(result.save.readMail).toEqual([]);
    expect(result.save.onboarding).toEqual({ step: 0, complete: true });
    expect(result.save.profile).toEqual({ name: null });
    expect(result.save.batches[BATCH_DAY03]!.archived['H204']).toEqual({ ...legacyH204, archiveCode: 'H-205' });
  });

  it('v7 版本規則與 v8 相同：日程不一致一樣拒絕', () => {
    expect(isValidLegacySaveV7({ ...toV7(c3Work), stage: 'end' }, CDIR)).toBeFalse();
    expect(isValidLegacySaveV7({ ...toV7(c3Work), night: undefined }, CDIR)).toBeFalse();
    expect(isValidLegacySaveV7({ ...toV7(c3Work), version: 8 }, CDIR)).toBeFalse();
    for (const bad of [null, [], {}, { version: 7 }]) expect(isValidLegacySaveV7(bad, CDIR)).toBeFalse();
  });
});

/* ---------- R10：逐筆審查、摘要版本、欄位映射依玩家對應 ---------- */

function review(key: 'B102' | 'B607' | 'H17', patch: Partial<RecordReview> = {}): RecordReview {
  const r = DAY1_RECORDS.find((x) => x.key === key)!;
  return { disposition: 'hold', batchId: BATCH_DAY01, archiveTaskId: TASK_DAY1, recordKey: key, sourceCode: r.code, reviewedCode: r.code, ...patch };
}

describe('isValidSave（R10）：核對進度的審查與摘要版本', () => {
  const withRecon = (p: Partial<ReconcileProgress>, base: Save = d2Work): Save => ({ ...base, taskProgress: { [TASK_DAY2]: reconcile(p) } });

  const ok: Array<[string, Save]> = [
    ['day.02 work 已審查一筆（尚未回覆）', withRecon({ reportOpened: true, reviews: { B102: review('B102', { disposition: 'release' }) } })],
    ['day.02 work 審查的送件編號與來源不同（"102"）', withRecon({ reportOpened: true, reviews: { B102: review('B102', { disposition: 'release', reviewedCode: '102' }) } })],
    ['day.02 wrap 已審查＋回覆＋reportRevision 2', withRecon({ reportOpened: true, reviews: { B102: review('B102') }, reply: 'ack', reportRevision: 2 }, { ...d2Work, stage: 'wrap' })],
    ['day.02 wrap reportRevision 1', withRecon({ reportOpened: true, reviews: { B102: review('B102') }, reply: 'ask', reportRevision: 1 }, { ...d2Work, stage: 'wrap' })],
    ['day.02 wrap reportRevision null（回覆時沒有夜間結果）', withRecon({ reportOpened: true, reviews: { B102: review('B102') }, reply: 'ack', reportRevision: null }, { ...d2Work, stage: 'wrap' })],
    ['舊檔：已回覆但沒有 reviews／reportRevision', withRecon({ reportOpened: true, reply: 'ack' }, { ...d2Work, stage: 'wrap' })],
    ['reviews 為空物件', withRecon({ reviews: {} })],
    ['sourceCode 為空字串（只驗文字型別）', withRecon({ reviews: { B102: review('B102', { sourceCode: '' }) } })],
  ];
  for (const [name, save] of ok) {
    it(`合法：${name}`, () => {
      expect(valid(save)).toBeTrue();
      expect(valid(JSON.parse(JSON.stringify(save)))).toBeTrue();
    });
  }

  const bad: Array<[string, unknown]> = [
    ['reviews 為陣列', withRecon({ reviews: [] as never })],
    ['reviews 為 null', withRecon({ reviews: null as never })],
    ['審查項目為字串', withRecon({ reviews: { B102: 'release' } as never })],
    ['disposition 未知', withRecon({ reviews: { B102: review('B102', { disposition: 'approve' as never }) } })],
    ['disposition 缺', withRecon({ reviews: { B102: omit(review('B102'), 'disposition') } })],
    ['recordKey 與鍵不符', withRecon({ reviews: { B102: review('B607') } })],
    ['batchId 非字串', withRecon({ reviews: { B102: review('B102', { batchId: 1 as never }) } })],
    ['archiveTaskId 缺', withRecon({ reviews: { B102: omit(review('B102'), 'archiveTaskId') } })],
    ['sourceCode 為數字', withRecon({ reviews: { B102: review('B102', { sourceCode: 102 as never }) } })],
    ['reviewedCode 為空字串', withRecon({ reviews: { B102: review('B102', { reviewedCode: '' }) } })],
    ['reviewedCode 為純空白', withRecon({ reviews: { B102: review('B102', { reviewedCode: '  ' }) } })],
    ['reviewedCode 為數字', withRecon({ reviews: { B102: review('B102', { reviewedCode: 102 as never }) } })],
    ['reportRevision 為 3', withRecon({ reportOpened: true, reply: 'ack', reportRevision: 3 as never }, { ...d2Work, stage: 'wrap' })],
    ['reportRevision 為字串 "1"', withRecon({ reportOpened: true, reply: 'ack', reportRevision: '1' as never }, { ...d2Work, stage: 'wrap' })],
    ['歷史日的 Day 2 審查結構錯誤也不放行', { ...d3Work, taskProgress: { [TASK_DAY2]: { ...REPLIED, reviews: { B102: review('B102', { disposition: 'x' as never }) } } } }],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => expect(valid(save)).toBeFalse());
  }
});

describe('isValidSave（R10）：欄位映射提交依玩家對應', () => {
  const SWAP: Record<string, string> = { ...CORRECT, 'contact-status': 'record-date', 'effective-date': 'contact-result' };
  const swappedSubmission = (() => {
    const c = checkFieldMap(FIELD_MAP_TASK, SWAP, 'default_false');
    if (!c.ok) throw new Error('fixture');
    return c.result;
  })();

  it('文字欄位互換後提交（輸出反映互換）→ 合法，end 亦同', () => {
    const submitted = withFm(d6Work, fieldMap({ assignments: SWAP, blankPolicy: 'default_false', previewed: true, submitted: swappedSubmission }));
    expect(swappedSubmission.rows[0].values['contact-status']).toBe('2026-09-16');
    expect(valid(submitted)).toBeTrue();
    expect(valid({ ...submitted, stage: 'end' })).toBeTrue();
    expect(valid(JSON.parse(JSON.stringify({ ...submitted, stage: 'end' })))).toBeTrue();
  });

  it('布林目標配到無法轉換的來源卻標示已提交 → 不合法', () => {
    const bad = { ...CORRECT, 'exclude-flag': 'contact-result', 'contact-status': 'objection-reply' };
    const submitted = withFm(d6Work, fieldMap({ assignments: bad, blankPolicy: 'default_false', previewed: true, submitted: SUBMISSION_DEFAULT }));
    expect(valid(submitted)).toBeFalse();
    expect(valid({ ...submitted, stage: 'end' })).toBeFalse();
    // 尚未提交時，進度可以暫存這種對應（由檢查回報錯誤）
    expect(valid(withFm(d6Work, fieldMap({ assignments: bad, blankPolicy: 'default_false' })))).toBeTrue();
  });
});

/* ---------- R10／R11：文件問題案件（returns、issueSchedule、readIssueReceipts） ---------- */

const R_AUDIT = 'audit.test.day1-code';
const R_ID = `return.${R_AUDIT}.B102`;
const R_ID_607 = `return.${R_AUDIT}.B607`;
const rSlot = (n: number): string => `task.day${n}.return-review`;
const TASK_DAY6_ARCHIVE = 'task.day6.archive';
const BATCH_DAY06 = 'batch.day06.archive';
const DAY6_RECORDS: readonly SourceRecord[] = [{ key: 'W1', name: null, code: '0601', refusal: false, refusalApplies: true }];

function slotted(dayId: string, n: number, next: string | null, id: string, batchId: string, records: readonly SourceRecord[]): DayPlan {
  return {
    dayId,
    dayNumber: n,
    nextDayId: next,
    tasks: [
      { id, kind: 'archive', batchId, recordKeys: records.map((r) => r.key), caseReviews: [] },
      { id: rSlot(n), kind: 'return-review', dayId },
    ],
  };
}

/** day.01 歸檔 → day.02 核對 [B102, B607]＋稽核（Day 3 通知）→ day.03～day.06 各 [歸檔, 錯誤文件處理]（day.06 最後一天）。 */
const RDIR: DayDirectory = createDayDirectory(
  [
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
          returnAudit: { id: R_AUDIT, notifyDayId: DAY_03 },
        },
      ],
    },
    slotted(DAY_03, 3, DAY_04, TASK_DAY3, BATCH_DAY03, DAY3_RECORDS),
    slotted(DAY_04, 4, DAY_05, TASK_DAY4, BATCH_DAY04, DAY4_RECORDS),
    slotted(DAY_05, 5, DAY_06, TASK_DAY5, BATCH_DAY05, DAY5_RECORDS),
    slotted(DAY_06, 6, null, TASK_DAY6_ARCHIVE, BATCH_DAY06, DAY6_RECORDS),
  ],
  { [BATCH_DAY01]: DAY1_RECORDS, [BATCH_DAY03]: DAY3_RECORDS, [BATCH_DAY04]: DAY4_RECORDS, [BATCH_DAY05]: DAY5_RECORDS, [BATCH_DAY06]: DAY6_RECORDS },
);
/**
 * R12：v11 規定每份回條恰有一封郵件（advanceDay 建立回條時同時寄出，見 rules.spec）。
 * R11 的案件 fixture 只寫 returns；驗證前用核心的 receiptMail 依回條補上 mailbox（與遊玩時寄出的郵件相同），
 * 讓這些案例只測案件規則、不會因「少寄郵件」而假性不合法。郵件本身的規則在 R12 區塊以明確的 mailbox 測試。
 */
function mailed(s: unknown): unknown {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return s;
  const returns = (s as { returns?: unknown }).returns;
  if (!Array.isArray(returns)) return s;
  const mailbox: MailRecord[] = [];
  for (const item of returns) {
    if (typeof item !== 'object' || item === null || !Array.isArray((item as ReturnCase).receipts)) continue;
    for (const rc of (item as ReturnCase).receipts) {
      if (typeof rc === 'object' && rc !== null) mailbox.push(receiptMail(item as ReturnCase, rc));
    }
  }
  return { ...s, mailbox };
}
const rvalid = (s: unknown): boolean => isValidSave(mailed(s), RDIR);
const withDone = (base: Save, batchId: string, records: readonly SourceRecord[]): Save => ({
  ...base,
  batches: { ...base.batches, [batchId]: makeBatch(archivedOf(records)) },
});

const r1Archived: BatchState['archived'] = { ...archivedAll, B102: { ...archivedAll['B102'], archiveCode: '102' } };
const R_REPLIED: ReconcileProgress = reconcile({
  reportOpened: true,
  reviews: { B102: review('B102', { disposition: 'release', reviewedCode: '102' }), B607: review('B607', { disposition: 'release' }) },
  reply: 'ack',
  reportRevision: 1,
});
const r2Wrap: Save = withDay1Batch(r1Archived, { dayId: DAY_02, taskId: TASK_DAY2, stage: 'wrap', night: NIGHT_NO, taskProgress: { [TASK_DAY2]: R_REPLIED } });
const RECEIPT_0: ReturnReceipt = { id: `${R_ID}#0`, kind: 'returned', dayId: DAY_03, versionIndex: null, code: '102', reason: 'code-mismatch' };
const RETURN_B102: ReturnCase = {
  id: R_ID,
  auditId: R_AUDIT,
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
};

/* 排入路徑：Day 3 建立 → Day 4 排入錯誤文件處理 → 重送／送窗口 → Day 5 核對 */
const r3Morning: Save = { ...r2Wrap, dayId: DAY_03, stage: 'morning', taskId: TASK_DAY3, returns: [RETURN_B102] };
const r3Work: Save = { ...r3Morning, stage: 'work' };
const r3Wrap: Save = { ...withDone(r3Work, BATCH_DAY03, DAY3_RECORDS), stage: 'wrap' };
const r4Morning: Save = { ...r3Wrap, dayId: DAY_04, stage: 'morning', taskId: TASK_DAY4, issueSchedule: { [DAY_04]: [R_ID] } };
const r4Work: Save = { ...r4Morning, stage: 'work' };
const r4Slot: Save = { ...withDone(r4Work, BATCH_DAY04, DAY4_RECORDS), taskId: rSlot(4) };
const V_D4: ReturnVersion = { index: 0, action: 'resubmit', code: '102', dayId: DAY_04, checkDayId: DAY_05 };
const awaitingCheck: ReturnCase = { ...RETURN_B102, status: 'awaiting-check', dueDayId: null, versions: [V_D4] };
const windowed: ReturnCase = {
  ...RETURN_B102,
  status: 'awaiting-window',
  dueDayId: null,
  versions: [{ index: 0, action: 'window', code: '102', dayId: DAY_04, checkDayId: null }],
};
const r4Handled: Save = { ...r4Slot, returns: [awaitingCheck] };
const r4Wrap: Save = { ...r4Handled, stage: 'wrap' };
const resolvedCase: ReturnCase = {
  ...RETURN_B102,
  status: 'resolved',
  dueDayId: null,
  versions: [{ ...V_D4, code: '0102', outcome: 'resolved', checkedDayId: DAY_05 }],
  receipts: [RECEIPT_0, { id: `${R_ID}#1`, kind: 'resolved', dayId: DAY_05, versionIndex: 0, code: '0102', reason: null }],
};
const r5Morning: Save = { ...r4Wrap, dayId: DAY_05, stage: 'morning', taskId: TASK_DAY5, returns: [resolvedCase] };

/* 提前處理路徑：Day 3 重送仍錯 → Day 4 再次退回（不排入）→ Day 4 再重送仍錯 → Day 5 再次退回 → Day 6 排入 */
const V_D3: ReturnVersion = { index: 0, action: 'resubmit', code: '0l02', dayId: DAY_03, checkDayId: DAY_04 };
const r3Early: Save = { ...r3Work, returns: [{ ...RETURN_B102, status: 'awaiting-check', dueDayId: null, versions: [V_D3] }] };
const returnedOnce: ReturnCase = {
  ...RETURN_B102,
  status: 'pending',
  dueDayId: DAY_05,
  versions: [{ ...V_D3, outcome: 'returned', checkedDayId: DAY_04 }],
  receipts: [RECEIPT_0, { id: `${R_ID}#1`, kind: 'returned', dayId: DAY_04, versionIndex: 0, code: '0l02', reason: 'code-mismatch' }],
};
const r4EarlyMorning: Save = { ...r3Wrap, dayId: DAY_04, stage: 'morning', taskId: TASK_DAY4, returns: [returnedOnce] };
const returnedTwice: ReturnCase = {
  ...returnedOnce,
  dueDayId: DAY_06,
  versions: [...returnedOnce.versions, { index: 1, action: 'resubmit', code: 'abc', dayId: DAY_04, checkDayId: DAY_05, outcome: 'returned', checkedDayId: DAY_05 }],
  receipts: [...returnedOnce.receipts, { id: `${R_ID}#2`, kind: 'returned', dayId: DAY_05, versionIndex: 1, code: 'abc', reason: 'code-mismatch' }],
};
const r5EarlyMorning: Save = { ...withDone(r4EarlyMorning, BATCH_DAY04, DAY4_RECORDS), dayId: DAY_05, taskId: TASK_DAY5, returns: [returnedTwice] };
const r6Morning: Save = { ...withDone(r5EarlyMorning, BATCH_DAY05, DAY5_RECORDS), dayId: DAY_06, taskId: TASK_DAY6_ARCHIVE, issueSchedule: { [DAY_06]: [R_ID] } };
const r6Slot: Save = { ...withDone(r6Morning, BATCH_DAY06, DAY6_RECORDS), stage: 'work', taskId: rSlot(6) };
const lastDayCheck: ReturnCase = {
  ...returnedTwice,
  status: 'awaiting-check',
  dueDayId: null,
  versions: [...returnedTwice.versions, { index: 2, action: 'resubmit', code: '0102', dayId: DAY_06, checkDayId: null }],
};
const r6End: Save = { ...r6Slot, stage: 'end', returns: [lastDayCheck] };
const withCase = (base: Save, patch: Record<string, unknown>): unknown => ({ ...base, returns: [{ ...base.returns[0]!, ...patch }] });
const withVersion = (base: Save, i: number, patch: Record<string, unknown>): unknown => {
  const item = base.returns[0]!;
  return { ...base, returns: [{ ...item, versions: item.versions.map((v, j) => (j === i ? { ...v, ...patch } : v)) }] };
};
const withReceipt = (base: Save, i: number, patch: Record<string, unknown>): unknown => {
  const item = base.returns[0]!;
  return { ...base, returns: [{ ...item, receipts: item.receipts.map((r, j) => (j === i ? { ...r, ...patch } : r)) }] };
};

describe('isValidSave（R11）：文件問題案件合法', () => {
  const cases: Array<[string, Save]> = [
    ['day.02 wrap（放行 "102"，尚未到通知日、沒有案件）', r2Wrap],
    ['day.03 morning（通知日建立一案：待修正、到期 Day 4、初次退件回條）', r3Morning],
    ['day.03 work', r3Work],
    ['day.03 work 從文件問題頁提前重送（受理 Day 3、預定 Day 4 核對）', r3Early],
    ['day.03 wrap（錯誤文件處理不適用，直接日結）', r3Wrap],
    ['day.04 morning（排入當日錯誤文件處理）', r4Morning],
    ['day.04 work（目前工作仍是歸檔）', r4Work],
    ['day.04 work（錯誤文件處理進行中）', r4Slot],
    ['day.04 work 已重送（已重送／待核對，等交付）', r4Handled],
    ['day.04 wrap（本日處理已交付，案件仍待核對）', r4Wrap],
    ['day.04 wrap（送窗口待查）', { ...r4Wrap, returns: [windowed] }],
    ['day.05 morning（下游核對一致：已解決＋收件回條）', r5Morning],
    ['day.04 morning（提前重送仍錯 → 再次退回，到期 Day 5、不排入 Day 4）', r4EarlyMorning],
    ['day.05 morning（第二次仍錯 → 回條 #2、到期 Day 6）', r5EarlyMorning],
    ['day.06 morning（再次排入最後一天）', r6Morning],
    ['day.06 work（最後一天的錯誤文件處理）', r6Slot],
    ['day.06 end（最後一天重送：核對日 null，保留待核對）', r6End],
    ['day.06 end（最後一天再次退回：待修正、到期日 null，仍留在清單）', {
      ...withDone(withDone(r5EarlyMorning, BATCH_DAY05, DAY5_RECORDS), BATCH_DAY06, DAY6_RECORDS),
      dayId: DAY_06,
      stage: 'end',
      taskId: TASK_DAY6_ARCHIVE,
      returns: [{
        ...returnedTwice,
        dueDayId: null,
        versions: [...returnedTwice.versions, { index: 2, action: 'resubmit', code: '1O2', dayId: DAY_05, checkDayId: DAY_06, outcome: 'returned', checkedDayId: DAY_06 }],
        receipts: [...returnedTwice.receipts, { id: `${R_ID}#3`, kind: 'returned', dayId: DAY_06, versionIndex: 2, code: '1O2', reason: 'code-mismatch' }],
      }],
    }],
    ['已讀郵件清單（與待處理件數分開）', { ...r5EarlyMorning, readMail: [mailIdOfReceipt(`${R_ID}#0`), mailIdOfReceipt(`${R_ID}#1`)] }],
    ['錯誤內容本身不拒絕：重送與回條的編號是任意非空文字（含空白、全形）', {
      ...r4EarlyMorning,
      returns: [{
        ...returnedOnce,
        versions: [{ ...returnedOnce.versions[0]!, code: ' 0102 ' }],
        receipts: [RECEIPT_0, { ...returnedOnce.receipts[1]!, code: ' 0102 ' }],
      }],
    }],
    ['送出的編號為全形數字也只驗型別（不轉換、不比對）', { ...r4Handled, returns: [{ ...awaitingCheck, versions: [{ ...V_D4, code: '０１０２' }] }] }],
    ['兩案（B102、B607 都填錯放行）同一天排入', {
      ...r4Morning,
      batches: { ...r4Morning.batches, [BATCH_DAY01]: makeBatch({ ...r1Archived, B607: { ...archivedAll['B607'], archiveCode: '607' } }) },
      taskProgress: { [TASK_DAY2]: { ...R_REPLIED, reviews: { ...R_REPLIED.reviews, B607: review('B607', { disposition: 'release', reviewedCode: '607' }) } } },
      returns: [
        RETURN_B102,
        { ...RETURN_B102, id: R_ID_607, recordKey: 'B607', sourceCode: '0607', submittedCode: '607', reviewedCode: '607', receipts: [{ ...RECEIPT_0, id: `${R_ID_607}#0`, code: '607' }] },
      ],
      issueSchedule: { [DAY_04]: [R_ID, R_ID_607] },
    }],
    ['沒有案件：每天的錯誤文件處理都不適用，一路到 end', {
      ...withDone(withDone(withDone(r3Wrap, BATCH_DAY04, DAY4_RECORDS), BATCH_DAY05, DAY5_RECORDS), BATCH_DAY06, DAY6_RECORDS),
      dayId: DAY_06,
      stage: 'end',
      taskId: TASK_DAY6_ARCHIVE,
      returns: [],
      taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'ack' }) },
    }],
  ];
  for (const [name, save] of cases) {
    it(name, () => {
      expect(rvalid(save)).toBeTrue();
      expect(rvalid(JSON.parse(JSON.stringify(save)))).toBeTrue();
    });
  }
});

describe('isValidSave（R11）：文件問題案件不合法', () => {
  const cases: Array<[string, unknown, DayDirectory?]> = [
    ['returns 缺', omit(r3Work, 'returns')],
    ['returns 為 null', { ...r3Work, returns: null }],
    ['returns 為物件', { ...r3Work, returns: {} }],
    ['returns 項目為字串', { ...r3Work, returns: ['return.x'] }],
    /* 穩定 ID 與稽核：同一案重錯不會複製成新案件 */
    ['id 與 auditId／recordKey 不符', withCase(r3Work, { id: 'return.other.B102' })],
    ['id 重複（同一案兩筆）', { ...r3Work, returns: [RETURN_B102, RETURN_B102] }],
    ['auditId 未知', withCase(r3Work, { auditId: 'audit.unknown', id: 'return.audit.unknown.B102' })],
    ['auditId 非字串', withCase(r3Work, { auditId: 1 })],
    ['recordKey 不在稽核的核對範圍（H17）', withCase(r3Work, { recordKey: 'H17', id: `return.${R_AUDIT}.H17` })],
    ['在不含此稽核的目錄中', r3Work, DIR],
    /* 通知日與追蹤引用 */
    ['今天早於通知日（day.02 wrap 已有案件）', { ...r2Wrap, returns: [RETURN_B102] }],
    ['notifyDayId 與稽核不符', withCase(r3Work, { notifyDayId: DAY_02 })],
    ['reviewTaskId 與稽核的核對工作不符', withCase(r3Work, { reviewTaskId: TASK_DAY3 })],
    ['batchId 與核對來源批次不符', withCase(r3Work, { batchId: BATCH_DAY03 })],
    ['archiveTaskId 非字串', withCase(r3Work, { archiveTaskId: null })],
    ['sourceCode 非字串', withCase(r3Work, { sourceCode: 102 })],
    ['submittedCode 為純空白', withCase(r3Work, { submittedCode: '  ' })],
    ['reviewedCode 為空字串', withCase(r3Work, { reviewedCode: '' })],
    ['disposition 不是 release', withCase(r3Work, { disposition: 'hold' })],
    ['reason 未知', withCase(r3Work, { reason: 'late' })],
    ['reviewedCode 等於 sourceCode（沒有差異卻退件）', withCase(r3Work, { reviewedCode: '0102' })],
    /* 對應的第二輪審查必須是「放行」 */
    ['對應紀錄沒有審查處置（舊檔不追罰）', { ...r3Work, taskProgress: { [TASK_DAY2]: reconcile({ reportOpened: true, reply: 'ack' }) } }],
    ['對應紀錄的審查是保留待查', { ...r3Work, taskProgress: { [TASK_DAY2]: { ...R_REPLIED, reviews: { ...R_REPLIED.reviews, B102: review('B102', { reviewedCode: '102' }) } } } }],
    ['沒有 Day 2 進度', { ...r3Work, taskProgress: {} }],
    /* 狀態 */
    ['status 未知', withCase(r3Work, { status: 'closed' })],
    ['status 為 v9 的 resubmitted', withCase(r4Handled, { status: 'resubmitted' })],
    ['status 為 v9 的 window', withCase({ ...r4Wrap, returns: [windowed] }, { status: 'window' })],
    ['dueDayId 缺', withCase(r3Work, { dueDayId: undefined })],
    ['dueDayId 未知日', withCase(r3Work, { dueDayId: 'day.99' })],
    ['dueDayId 為數字', withCase(r3Work, { dueDayId: 4 })],
    ['待修正卻有尚未核對的版本', withCase(r4Handled, { status: 'pending', dueDayId: DAY_05 })],
    ['待修正但最後版本已結案', withCase(r5Morning, { status: 'pending', dueDayId: DAY_06 })],
    ['待修正但最後版本是送窗口', withCase({ ...r4Wrap, returns: [windowed] }, { status: 'pending', dueDayId: DAY_05 })],
    ['已重送／待核對卻沒有版本', withCase(r3Work, { status: 'awaiting-check', dueDayId: null })],
    ['已重送／待核對但最後版本是送窗口', withCase({ ...r4Wrap, returns: [windowed] }, { status: 'awaiting-check' })],
    ['已重送／待核對但最後版本已核對（已退回）', withCase(r4EarlyMorning, { status: 'awaiting-check', dueDayId: null })],
    ['已重送／待核對卻仍有到期日', withCase(r4Handled, { dueDayId: DAY_05 })],
    ['待窗口回覆卻沒有版本', withCase(r3Work, { status: 'awaiting-window', dueDayId: null })],
    ['待窗口回覆但最後版本是重送', withCase(r4Handled, { status: 'awaiting-window' })],
    ['待窗口回覆卻仍有到期日', withCase({ ...r4Wrap, returns: [windowed] }, { dueDayId: DAY_05 })],
    ['已解決卻沒有版本（只按送出、跨日不能結案）', withCase(r3Work, { status: 'resolved', dueDayId: null })],
    ['已解決但最後版本尚未核對', withCase(r4Handled, { status: 'resolved' })],
    ['已解決但最後版本核對結果是退回', withCase(r4EarlyMorning, { status: 'resolved', dueDayId: null })],
    ['已解決但最後版本是送窗口（送窗口不結案）', withCase({ ...r4Wrap, returns: [windowed] }, { status: 'resolved' })],
    ['已解決卻仍有到期日', withCase(r5Morning, { dueDayId: DAY_06 })],
    /* 版本 */
    ['versions 缺', withCase(r3Work, { versions: undefined })],
    ['版本項目為字串', withCase(r4Handled, { versions: ['102'] })],
    ['版本 index 不連續（第一個是 1）', withVersion(r4Handled, 0, { index: 1 })],
    ['版本 index 缺', withVersion(r4Handled, 0, { index: undefined })],
    ['版本 action 未知', withVersion(r4Handled, 0, { action: 'fix' })],
    ['版本 code 為空字串', withVersion(r4Handled, 0, { code: '' })],
    ['版本 code 為數字', withVersion(r4Handled, 0, { code: 102 })],
    ['版本受理日未知', withVersion(r4Handled, 0, { dayId: 'day.99' })],
    ['版本受理日在未來（Day 5，今天 Day 4）', withVersion(r4Handled, 0, { dayId: DAY_05 })],
    ['版本 checkDayId 未知日', withVersion(r4Handled, 0, { checkDayId: 'day.99' })],
    ['版本 checkDayId 缺', withVersion(r4Handled, 0, { checkDayId: undefined })],
    ['送窗口版本卻有核對日', withVersion({ ...r4Wrap, returns: [windowed] }, 0, { checkDayId: DAY_05 })],
    ['送窗口版本卻有核對結果', withVersion({ ...r4Wrap, returns: [windowed] }, 0, { outcome: 'returned', checkedDayId: null })],
    ['核對結果未知', withVersion(r4EarlyMorning, 0, { outcome: 'passed' })],
    ['核對日與預定核對日不符', withVersion(r4EarlyMorning, 0, { checkedDayId: DAY_03 })],
    ['有核對結果卻沒有 checkedDayId', withVersion(r4EarlyMorning, 0, { checkedDayId: undefined })],
    ['核對結果記在尚未到的日子（預定 Day 5、今天 Day 4）', withVersion(r4EarlyMorning, 0, { checkDayId: DAY_05, checkedDayId: DAY_05 })],
    ['較早的重送版本尚未核對，卻又有新版本', withVersion(r5EarlyMorning, 0, { outcome: undefined, checkedDayId: undefined })],
    ['較早的版本已結案，卻又有新版本', withVersion(r5EarlyMorning, 0, { outcome: 'resolved' })],
    ['較早的版本是送窗口，卻又有新版本（待窗口回覆不會回到待修正）', withVersion(r5EarlyMorning, 0, { action: 'window', checkDayId: null, outcome: undefined, checkedDayId: undefined })],
    /* 回條 */
    ['receipts 缺', withCase(r3Work, { receipts: undefined })],
    ['receipts 為空（案件一定有初次退件回條）', withCase(r3Work, { receipts: [] })],
    ['receipts 為物件', withCase(r3Work, { receipts: {} })],
    ['回條項目為字串', withCase(r3Work, { receipts: [`${R_ID}#0`] })],
    ['回條 ID 序號不符（第一張是 #1）', withReceipt(r3Work, 0, { id: `${R_ID}#1` })],
    ['回條 ID 屬於別的案件', withReceipt(r3Work, 0, { id: `${R_ID_607}#0` })],
    ['回條 ID 重複', withCase(r4EarlyMorning, { receipts: [RECEIPT_0, { ...returnedOnce.receipts[1]!, id: `${R_ID}#0` }] })],
    ['第一張回條不是退件', withReceipt(r3Work, 0, { kind: 'resolved', reason: null })],
    ['第一張回條指向版本', withReceipt(r4EarlyMorning, 0, { versionIndex: 0 })],
    ['回條 kind 未知', withReceipt(r4EarlyMorning, 1, { kind: 'accepted' })],
    ['退件回條沒有原因', withReceipt(r4EarlyMorning, 1, { reason: null })],
    ['收件回條帶退件原因', withReceipt(r5Morning, 1, { reason: 'code-mismatch' })],
    ['回條日期在未來（Day 5，今天 Day 4）', withReceipt(r4EarlyMorning, 1, { dayId: DAY_05 })],
    ['回條日期未知', withReceipt(r3Work, 0, { dayId: 'day.99' })],
    ['回條 code 為純空白', withReceipt(r3Work, 0, { code: '   ' })],
    ['回條 code 為數字', withReceipt(r3Work, 0, { code: 102 })],
    ['後續回條沒有 versionIndex', withReceipt(r4EarlyMorning, 1, { versionIndex: null })],
    ['後續回條 versionIndex 超出範圍', withReceipt(r4EarlyMorning, 1, { versionIndex: 5 })],
    ['後續回條 versionIndex 為字串', withReceipt(r4EarlyMorning, 1, { versionIndex: '0' })],
    /* 排程 */
    ['issueSchedule 缺', omit(r4Morning, 'issueSchedule')],
    ['issueSchedule 為 null', { ...r4Morning, issueSchedule: null }],
    ['issueSchedule 為陣列', { ...r4Morning, issueSchedule: [R_ID] }],
    ['issueSchedule 的日子未知', { ...r4Morning, issueSchedule: { 'day.99': [R_ID] } }],
    ['issueSchedule 排在未來的日子（Day 5，今天 Day 4）', { ...r4Morning, issueSchedule: { [DAY_04]: [R_ID], [DAY_05]: [R_ID] } }],
    ['issueSchedule 引用不存在的案件', { ...r4Morning, issueSchedule: { [DAY_04]: ['return.unknown'] } }],
    ['issueSchedule 同一天重複排同一案', { ...r4Morning, issueSchedule: { [DAY_04]: [R_ID, R_ID] } }],
    ['issueSchedule 當天清單為空', { ...r4Work, issueSchedule: { [DAY_04]: [] } }],
    ['issueSchedule 清單為字串', { ...r4Morning, issueSchedule: { [DAY_04]: R_ID } }],
    ['issueSchedule 清單含數字', { ...r4Morning, issueSchedule: { [DAY_04]: [R_ID, 1] } }],
    /* 已讀郵件（R12 取代已讀回條） */
    ['readMail 缺', omit(r4Morning, 'readMail')],
    ['readMail 為物件', { ...r4Morning, readMail: {} }],
    ['readMail 含數字', { ...r4Morning, readMail: [mailIdOfReceipt(`${R_ID}#0`), 1] }],
    ['readMail 用回條 ID（不是郵件 ID）', { ...r4Morning, readMail: [`${R_ID}#0`] }],
    /* 日程 */
    ['沒有排程卻停在錯誤文件處理（不適用的工作不會成為目前工作）', { ...r4Slot, issueSchedule: {} }],
    ['day.03 停在錯誤文件處理（當天沒有排入）', { ...withDone(r3Work, BATCH_DAY03, DAY3_RECORDS), taskId: rSlot(3) }],
    ['day.04 wrap 但排入的案件仍待修正', { ...r4Slot, stage: 'wrap' }],
    ['day.04 morning 目前工作卻是錯誤文件處理（第一件尚未完成）', { ...r4Morning, taskId: rSlot(4) }],
    ['day.06 end 但當天排入的案件仍待修正', { ...r6Slot, stage: 'end' }],
  ];
  for (const [name, save, dir] of cases) {
    it(name, () => {
      expect(() => isValidSave(mailed(save), dir ?? RDIR)).not.toThrow();
      expect(isValidSave(mailed(save), dir ?? RDIR)).toBeFalse();
    });
  }
});

describe('isValidSave（R11）：對照組', () => {
  it('不合法案例的基底本身合法；同一份存檔清空 returns／排程後，在有／沒有此稽核的目錄都合法', () => {
    for (const base of [r3Work, r4Morning, r4Handled, r4EarlyMorning, r5EarlyMorning, r5Morning, r6Slot]) {
      expect(rvalid(base)).withContext(`${base.dayId}/${base.stage}/${base.taskId}`).toBeTrue();
    }
    expect(rvalid({ ...r3Work, returns: [] })).toBeTrue();
    expect(isValidSave({ ...r3Work, returns: [] }, DIR)).toBeTrue();
    expect(isValidSave(mailed(r3Work), DIR)).toBeFalse();
  });
});

describe('isRawTaskDone（R11）：錯誤文件處理以當天排程為準', () => {
  const slot4 = RDIR.plan(DAY_04)!.tasks[1]!;
  const slot6 = RDIR.plan(DAY_06)!.tasks[1]!;
  const raw = (s: unknown) => s as Record<string, unknown>;

  it('排入的案件都不再待修正 → true（重送、送窗口、已解決都算，交付 ≠ 結案）；仍有待修正 → false', () => {
    expect(isRawTaskDone(raw(r4Slot), RDIR, slot4)).toBeFalse();
    expect(isRawTaskDone(raw(r4Handled), RDIR, slot4)).toBeTrue();
    expect(isRawTaskDone(raw({ ...r4Wrap, returns: [windowed] }), RDIR, slot4)).toBeTrue();
    expect(isRawTaskDone(raw(r5Morning), RDIR, slot4)).toBeTrue();
    expect(isRawTaskDone(raw(r6Slot), RDIR, slot6)).toBeFalse();
    expect(isRawTaskDone(raw(r6End), RDIR, slot6)).toBeTrue();
  });

  it('沒有排程、排程引用不存在的案件、returns 或 issueSchedule 毀損 → false（不丟例外）', () => {
    expect(isRawTaskDone(raw({ ...r4Handled, issueSchedule: {} }), RDIR, slot4)).toBeFalse();
    expect(isRawTaskDone(raw({ ...r4Handled, issueSchedule: { [DAY_04]: ['return.unknown'] } }), RDIR, slot4)).toBeFalse();
    expect(isRawTaskDone(raw({ ...r4Handled, returns: 'x' }), RDIR, slot4)).toBeFalse();
    expect(isRawTaskDone(raw({ ...r4Handled, issueSchedule: 'x' }), RDIR, slot4)).toBeFalse();
    expect(isRawTaskDone(raw({ ...r4Handled, issueSchedule: { [DAY_04]: 'x' } }), RDIR, slot4)).toBeFalse();
    // 其他日子的排程不算
    expect(isRawTaskDone(raw({ ...r4Handled, issueSchedule: { [DAY_03]: [R_ID] } }), RDIR, slot4)).toBeFalse();
  });
});

/* ---------- R11：v9 舊檔只驗結構 ---------- */

const LEGACY_B102: LegacyReturnCaseV9 = {
  id: R_ID,
  auditId: R_AUDIT,
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
  returnDayId: DAY_04,
  status: 'pending',
  versions: [],
};

describe('isValidLegacySaveV9（R11）', () => {
  it('v9（沒有 issueSchedule／readIssueReceipts、舊退件格式）只被 legacy v9 認；v10／v11 不被 legacy v9 認', () => {
    const samples: Array<[string, SaveV9]> = [
      ['day.01 work', toV9(initial)],
      ['day.03 work 待處理', toV9(r3Work, [LEGACY_B102])],
      ['day.04 work 已重新送審', toV9(r4Work, [{ ...LEGACY_B102, status: 'resubmitted', versions: [{ action: 'resubmit', code: '102', dayId: DAY_04 }] }])],
      ['day.04 work 送窗口', toV9(r4Work, [{ ...LEGACY_B102, status: 'window', versions: [{ action: 'window', code: '102', dayId: DAY_04 }] }])],
    ];
    for (const [name, v9] of samples) {
      expect('issueSchedule' in v9).withContext(name).toBeFalse();
      expect('readIssueReceipts' in v9).withContext(name).toBeFalse();
      expect('mailbox' in v9).withContext(name).toBeFalse();
      expect(isValidLegacySaveV9(v9, RDIR)).withContext(name).toBeTrue();
      expect(isValidLegacySaveV9(JSON.parse(JSON.stringify(v9)), RDIR)).withContext(name).toBeTrue();
      expect(rvalid(v9)).withContext(name).toBeFalse();
      expect(isValidLegacySaveV8(v9, RDIR)).withContext(name).toBeFalse();
    }
    for (const s of [r3Work, r4Handled, r6End]) {
      expect(isValidLegacySaveV9(mailed(s), RDIR)).toBeFalse();
      expect(isValidLegacySaveV9(toV10(mailed(s) as Save), RDIR)).toBeFalse();
    }
  });

  const base = toV9(r4Work, [LEGACY_B102]);
  const withLegacy = (patch: Record<string, unknown>): unknown => ({ ...base, returns: [{ ...LEGACY_B102, ...patch }] });
  const bad: Array<[string, unknown]> = [
    ['null', null],
    ['version 為 10', { ...base, version: 10 }],
    ['version 為字串 "9"', { ...base, version: '9' }],
    ['returns 缺', omit(base, 'returns')],
    ['returns 為物件', { ...base, returns: {} }],
    ['returns 項目為字串', { ...base, returns: ['x'] }],
    ['狀態為 v10 的 awaiting-check', withLegacy({ status: 'awaiting-check' })],
    ['狀態未知', withLegacy({ status: 'closed' })],
    ['缺 returnDayId', withLegacy({ returnDayId: undefined })],
    ['缺 notifyDayId', withLegacy({ notifyDayId: undefined })],
    ['id 非字串', withLegacy({ id: 1 })],
    ['versions 缺', withLegacy({ versions: undefined })],
    ['版本 action 未知', withLegacy({ status: 'resubmitted', versions: [{ action: 'fix', code: '102', dayId: DAY_04 }] })],
    ['版本 code 為純空白', withLegacy({ status: 'resubmitted', versions: [{ action: 'resubmit', code: '  ', dayId: DAY_04 }] })],
    ['版本 dayId 未知', withLegacy({ status: 'resubmitted', versions: [{ action: 'resubmit', code: '102', dayId: 'day.99' }] })],
    ['版本項目為字串', withLegacy({ status: 'resubmitted', versions: ['102'] })],
    ['dayId 未知', { ...base, dayId: 'day.99' }],
    ['seed 非整數', { ...base, seed: 1.5 }],
    ['caseReviews 含未知案件', { ...base, caseReviews: { 'case.unknown': { variantId: 'x', marks: [] } } }],
    ['chatReplies 為陣列', { ...base, chatReplies: [] }],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => expect(isValidLegacySaveV9(save, RDIR)).toBeFalse());
  }

  it('只驗結構：日程不一致的 v9 仍被 legacy v9 認，但遷移後被 v10 規則拒絕（migrateToCurrent → null）', () => {
    const inconsistent: SaveV9 = { ...toV9(r3Work, [LEGACY_B102]), stage: 'end' };
    expect(isValidLegacySaveV9(inconsistent, RDIR)).toBeTrue();
    expect(migrateToCurrent(inconsistent, RDIR)).toBeNull();
    const unknownAudit: SaveV9 = toV9(r3Work, [{ ...LEGACY_B102, auditId: 'audit.x', id: 'return.audit.x.B102' }]);
    expect(isValidLegacySaveV9(unknownAudit, RDIR)).toBeTrue();
    expect(migrateToCurrent(unknownAudit, RDIR)).toBeNull();
  });
});

describe('isValidLegacySaveV8（R10）', () => {
  it('v8 沒有 returns：只被 legacy v8 認；v10 形狀不被 legacy v8 認', () => {
    for (const s of [initial, d2Wrap, d3Work, d6End]) {
      const v8 = toV8(s);
      expect('returns' in v8).toBeFalse();
      expect('issueSchedule' in v8).toBeFalse();
      expect(isValidLegacySaveV8(v8, DIR)).toBeTrue();
      expect(valid(v8)).toBeFalse();
      expect(isValidLegacySaveV8(s, DIR)).toBeFalse();
      expect(isValidLegacySaveV7(v8, DIR)).toBeFalse();
      expect(isValidLegacySaveV9(v8, DIR)).toBeFalse();
    }
  });

  it('v8 的規則與 v10 相同（除 returns／排程）：日程、caseReviews、非來源編號', () => {
    expect(isValidLegacySaveV8({ ...toV8(d1Wrap), stage: 'end' }, DIR)).toBeFalse();
    expect(isValidLegacySaveV8(omit(toV8(d2Work), 'caseReviews'), DIR)).toBeFalse();
    expect(isValidLegacySaveV8(toV8(withDay1Batch({ B102: { ...archivedAll['B102'], archiveCode: '102' } })), DIR)).toBeTrue();
    for (const bad of [null, [], {}, { version: 8 }, { ...toV8(initial), version: '8' }]) expect(isValidLegacySaveV8(bad, DIR)).toBeFalse();
  });
});

describe('isValidSave（R11）：案件存在但其他欄位毀損時回傳 false，不丟例外', () => {
  const broken: Array<[string, unknown]> = [
    ['taskProgress 缺', (() => { const { taskProgress: _t, ...rest } = r3Work; return rest; })()],
    ['taskProgress 為 null', { ...r3Work, taskProgress: null }],
    ['taskProgress 為陣列', { ...r3Work, taskProgress: [] }],
    ['審查快照的 reviewedCode 與案件不一致', withCase(r3Work, { reviewedCode: '0103' })],
    ['審查快照的 sourceCode 與案件不一致', withCase(r3Work, { sourceCode: '9999' })],
    ['returns 項目為 null', { ...r4Morning, returns: [null] }],
    ['versions 項目為 null', withCase(r4Handled, { versions: [null] })],
    ['receipts 項目為 null', withCase(r4Handled, { receipts: [null] })],
    ['issueSchedule 引用的案件在 returns 中毀損', { ...r4Morning, returns: [{ id: R_ID }] }],
  ];
  for (const [name, save] of broken) {
    it(name, () => {
      expect(() => rvalid(save)).not.toThrow();
      expect(rvalid(save)).toBeFalse();
    });
  }
});

describe('isValidSave（R11）：回條與核對結果一一對應、待核對日合理、已讀郵件', () => {
  const caseOf = (s: Save) => s.returns[0]!;
  const patchCase = (s: Save, patch: Partial<Save['returns'][number]>): unknown => ({ ...s, returns: [{ ...caseOf(s), ...patch }] });
  const broken: Array<[string, () => unknown]> = [
    ['已核對的版本缺少回條', () => patchCase(r5Morning, { receipts: caseOf(r5Morning).receipts.slice(0, 1) })],
    ['回條種類與核對結果不符', () => patchCase(r5Morning, {
      receipts: caseOf(r5Morning).receipts.map((rc, i) => (i === 0 ? rc : { ...rc, kind: 'returned', reason: 'code-mismatch' })),
    })],
    ['未核對的版本卻有回條', () => patchCase(r3Early, {
      receipts: [...caseOf(r3Early).receipts, { ...caseOf(r3Early).receipts[0]!, id: `${caseOf(r3Early).id}#1`, versionIndex: 0 }],
    })],
    ['待核對版本的預定核對日已到（永遠不會被核對）', () => patchCase(r3Early, {
      versions: caseOf(r3Early).versions.map((v) => ({ ...v, checkDayId: v.dayId })),
    })],
    ['已讀郵件含未知 ID', () => ({ ...r3Work, readMail: ['mail.return.x#0'] })],
    ['已讀郵件重複', () => ({ ...r3Work, readMail: [mailIdOfReceipt(caseOf(r3Work).receipts[0]!.id), mailIdOfReceipt(caseOf(r3Work).receipts[0]!.id)] })],
  ];
  for (const [name, make] of broken) {
    it(name, () => expect(rvalid(make())).toBeFalse());
  }
});

/* ====================================================================================
 * R12：存檔 v11 的新欄位（郵件、郵件已讀、修訂草稿、向同事詢問、角色資料、入職進度、回覆送達時間）
 * ==================================================================================== */

/** 依回條補好郵件的 v11 fixture（型別仍是 Save）。 */
const withMail = (s: Save): Save => mailed(s) as Save;
const mailR3 = withMail(r3Work);
const mailR5Early = withMail(r5EarlyMorning);
const mailR5Resolved = withMail(r5Morning);
const MAIL_0 = mailR3.mailbox[0]!;
const patchMail = (s: Save, i: number, patch: Record<string, unknown>): unknown => ({
  ...s,
  mailbox: s.mailbox.map((m, j) => (j === i ? { ...m, ...patch } : m)),
});
const patchAttachment = (s: Save, i: number, patch: Record<string, unknown>): unknown =>
  patchMail(s, i, { attachments: [{ ...s.mailbox[i]!.attachments[0]!, ...patch }] });

describe('isValidSave（R12）：郵件——每份回條恰有一封、欄位與回條一致', () => {
  it('合法：初次退件、兩次再次退回、結案（收件回條）的郵件；JSON 往返後仍合法', () => {
    expect(MAIL_0).toEqual({
      id: `mail.${R_ID}#0`,
      packId: RETURN_RECEIPT_MAIL_PACK,
      templateId: 'returned',
      dayId: DAY_03,
      attachments: [{ kind: 'return-receipt', caseId: R_ID, receiptId: `${R_ID}#0`, versionIndex: null }],
    });
    expect(mailR5Early.mailbox.map((m) => [m.id, m.templateId, m.dayId, (m.attachments[0] as ReturnReceiptAttachment).versionIndex])).toEqual([
      [`mail.${R_ID}#0`, 'returned', DAY_03, null],
      [`mail.${R_ID}#1`, 'returned', DAY_04, 0],
      [`mail.${R_ID}#2`, 'returned', DAY_05, 1],
    ]);
    expect(mailR5Resolved.mailbox[1]!.templateId).toBe('resolved');
    for (const s of [mailR3, mailR5Early, mailR5Resolved]) {
      expect(isValidSave(s, RDIR)).withContext(`${s.dayId}/${s.stage}`).toBeTrue();
      expect(isValidSave(JSON.parse(JSON.stringify(s)), RDIR)).withContext(`${s.dayId}/${s.stage}`).toBeTrue();
    }
    // 沒有案件就沒有郵件
    expect(valid(initial)).toBeTrue();
    expect(initial.mailbox).toEqual([]);
  });

  const bad: Array<[string, unknown]> = [
    ['有回條卻沒有郵件（少寄）', { ...mailR3, mailbox: [] }],
    ['三份回條只有兩封郵件', { ...mailR5Early, mailbox: mailR5Early.mailbox.slice(0, 2) }],
    ['多一封指向不存在回條的郵件', { ...mailR3, mailbox: [MAIL_0, { ...MAIL_0, id: `mail.${R_ID}#1`, attachments: [{ ...MAIL_0.attachments[0]!, receiptId: `${R_ID}#1` }] }] }],
    ['同一份回條寄兩封（郵件 ID 重複）', { ...mailR3, mailbox: [MAIL_0, MAIL_0] }],
    ['郵件 ID 不是 mail.<回條 ID>', patchMail(mailR3, 0, { id: 'mail.other' })],
    ['郵件 ID 為數字', patchMail(mailR3, 0, { id: 7 })],
    ['郵件包不是 mail.return-receipts', patchMail(mailR3, 0, { packId: 'mail.other' })],
    ['模板與回條種類不符（退件寄成 resolved）', patchMail(mailR3, 0, { templateId: 'resolved' })],
    ['收件回條寄成 returned', patchMail(mailR5Resolved, 1, { templateId: 'returned' })],
    ['模板未知', patchMail(mailR3, 0, { templateId: 'notice' })],
    ['日期與回條不符', patchMail(mailR3, 0, { dayId: DAY_04 })],
    ['日期缺', patchMail(mailR3, 0, { dayId: undefined })],
    ['附件版本序號與回條不符（原始送件寄成版本 0）', patchAttachment(mailR3, 0, { versionIndex: 0 })],
    ['再次退回的附件版本寄成 null', patchAttachment(mailR5Early, 1, { versionIndex: null })],
    ['再次退回的附件版本寄成別的版本', patchAttachment(mailR5Early, 2, { versionIndex: 0 })],
    ['附件案件 ID 不符', patchAttachment(mailR3, 0, { caseId: R_ID_607 })],
    ['附件回條 ID 不符（指向另一份回條）', patchAttachment(mailR5Early, 1, { receiptId: `${R_ID}#2` })],
    ['附件回條 ID 為數字', patchAttachment(mailR3, 0, { receiptId: 0 })],
    ['附件種類未知', patchAttachment(mailR3, 0, { kind: 'file' })],
    ['沒有附件', patchMail(mailR3, 0, { attachments: [] })],
    ['兩個附件', patchMail(mailR3, 0, { attachments: [MAIL_0.attachments[0], MAIL_0.attachments[0]] })],
    ['附件為物件（非陣列）', patchMail(mailR3, 0, { attachments: MAIL_0.attachments[0] })],
    ['附件項目為 null', patchMail(mailR3, 0, { attachments: [null] })],
    ['郵件項目為 null', { ...mailR3, mailbox: [null] }],
    ['郵件項目為字串', { ...mailR3, mailbox: [MAIL_0.id] }],
    ['mailbox 缺', omit(mailR3, 'mailbox')],
    ['mailbox 為 null', { ...mailR3, mailbox: null }],
    ['mailbox 為物件', { ...mailR3, mailbox: { [MAIL_0.id]: MAIL_0 } }],
    ['沒有案件卻有郵件', { ...initial, mailbox: [MAIL_0] }],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => {
      expect(() => isValidSave(save, RDIR)).not.toThrow();
      expect(isValidSave(save, RDIR)).toBeFalse();
    });
  }
});

describe('isValidSave（R12）：郵件已讀 readMail', () => {
  it('合法：空、部分已讀、全部已讀（順序不限）', () => {
    const ids = mailR5Early.mailbox.map((m) => m.id);
    for (const readMail of [[], [ids[1]!], [...ids], [ids[2]!, ids[0]!]]) {
      expect(isValidSave({ ...mailR5Early, readMail }, RDIR)).withContext(JSON.stringify(readMail)).toBeTrue();
    }
  });

  const bad: Array<[string, unknown]> = [
    ['未知郵件 ID', { ...mailR3, readMail: [`mail.${R_ID}#1`] }],
    ['回條 ID（不是郵件 ID）', { ...mailR3, readMail: [`${R_ID}#0`] }],
    ['重複', { ...mailR3, readMail: [MAIL_0.id, MAIL_0.id] }],
    ['含數字', { ...mailR3, readMail: [1] }],
    ['為物件', { ...mailR3, readMail: { [MAIL_0.id]: true } }],
    ['缺', omit(mailR3, 'readMail')],
    ['沒有郵件卻有已讀', { ...initial, readMail: ['mail.x'] }],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => expect(isValidSave(save, RDIR)).toBeFalse());
  }
});

describe('isValidSave（R12）：修訂草稿 issueDrafts', () => {
  it('合法：目前可修訂回條的草稿、過期回條的草稿（保留供查看）、已結案回條的草稿、空字串', () => {
    const cases: Array<[string, Save]> = [
      ['可修訂的 #2', { ...mailR5Early, issueDrafts: { [`${R_ID}#2`]: '0102' } }],
      ['過期的 #0、#1 與可修訂的 #2 並存', { ...mailR5Early, issueDrafts: { [`${R_ID}#0`]: '舊', [`${R_ID}#1`]: '較舊', [`${R_ID}#2`]: '' } }],
      ['已結案案件的舊草稿', { ...mailR5Resolved, issueDrafts: { [`${R_ID}#0`]: '0102' } }],
    ];
    for (const [name, s] of cases) expect(isValidSave(s, RDIR)).withContext(name).toBeTrue();
  });

  const bad: Array<[string, unknown]> = [
    ['指向不存在的回條', { ...mailR3, issueDrafts: { [`${R_ID}#1`]: '0102' } }],
    ['以郵件 ID 為鍵', { ...mailR3, issueDrafts: { [MAIL_0.id]: '0102' } }],
    ['以案件 ID 為鍵', { ...mailR3, issueDrafts: { [R_ID]: '0102' } }],
    ['沒有案件卻有草稿', { ...initial, issueDrafts: { 'return.x#0': '1' } }],
    ['值為數字', { ...mailR3, issueDrafts: { [`${R_ID}#0`]: 102 } }],
    ['值為 null', { ...mailR3, issueDrafts: { [`${R_ID}#0`]: null } }],
    ['為陣列', { ...mailR3, issueDrafts: [] }],
    ['為 null', { ...mailR3, issueDrafts: null }],
    ['缺', omit(mailR3, 'issueDrafts')],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => expect(isValidSave(save, RDIR)).toBeFalse());
  }
});

describe('isValidSave（R12）：向同事詢問 helpRequests', () => {
  const REQ = 'request.test.help';
  const req = (patch: Record<string, unknown> = {}) => ({
    dayId: DAY_03,
    askedAt: 1_000_000,
    deliveries: [
      { messageId: 'msg.test.help.1', at: 1_003_500 },
      { messageId: 'msg.test.help.2', at: 1_007_000 },
    ],
    ...patch,
  });
  const withHelp = (base: Save, v: unknown): unknown => ({ ...base, helpRequests: v });

  it('合法：今天問的、之前某天問的、送達時間與提問時間相同、多個提問', () => {
    const cases: Array<[string, unknown]> = [
      ['今天（Day 3）', withHelp(d3Work, { [REQ]: req() })],
      ['之前（Day 1 問、今天 Day 3）', withHelp(d3Work, { [REQ]: req({ dayId: DAY_01 }) })],
      ['送達時間等於提問時間／前一則', withHelp(d3Work, { [REQ]: req({ deliveries: [{ messageId: 'a', at: 1_000_000 }, { messageId: 'b', at: 1_000_000 }] }) })],
      ['兩個提問', withHelp(d3Work, { [REQ]: req(), 'request.test.other': req({ dayId: DAY_02 }) })],
      ['提問 ID 不需要在內容中（只驗結構）', withHelp(d3Work, { 'request.retired': req() })],
    ];
    for (const [name, s] of cases) {
      expect(valid(s)).withContext(name).toBeTrue();
      expect(valid(JSON.parse(JSON.stringify(s)))).withContext(name).toBeTrue();
    }
  });

  const bad: Array<[string, unknown]> = [
    ['提問日在未來（Day 4，今天 Day 3）', withHelp(d3Work, { [REQ]: req({ dayId: DAY_04 }) })],
    ['提問日未知', withHelp(d3Work, { [REQ]: req({ dayId: 'day.99' }) })],
    ['提問日缺', withHelp(d3Work, { [REQ]: req({ dayId: undefined }) })],
    ['提問時間為負數', withHelp(d3Work, { [REQ]: req({ askedAt: -1 }) })],
    ['提問時間為字串', withHelp(d3Work, { [REQ]: req({ askedAt: '1000000' }) })],
    ['提問時間為 null（JSON 化的 NaN）', withHelp(d3Work, { [REQ]: req({ askedAt: null }) })],
    ['沒有說明訊息', withHelp(d3Work, { [REQ]: req({ deliveries: [] }) })],
    ['deliveries 為物件', withHelp(d3Work, { [REQ]: req({ deliveries: {} }) })],
    ['送達時間倒退（非遞增）', withHelp(d3Work, { [REQ]: req({ deliveries: [{ messageId: 'a', at: 1_007_000 }, { messageId: 'b', at: 1_003_000 }] }) })],
    ['送達時間早於提問時間', withHelp(d3Work, { [REQ]: req({ deliveries: [{ messageId: 'a', at: 999_999 }] }) })],
    ['送達時間為字串', withHelp(d3Work, { [REQ]: req({ deliveries: [{ messageId: 'a', at: '1003500' }] }) })],
    ['訊息 ID 重複', withHelp(d3Work, { [REQ]: req({ deliveries: [{ messageId: 'a', at: 1_003_000 }, { messageId: 'a', at: 1_006_000 }] }) })],
    ['訊息 ID 為空字串', withHelp(d3Work, { [REQ]: req({ deliveries: [{ messageId: '', at: 1_003_000 }] }) })],
    ['送達項目為 null', withHelp(d3Work, { [REQ]: req({ deliveries: [null] }) })],
    ['提問 ID 為空字串', withHelp(d3Work, { '': req() })],
    ['提問內容為 null', withHelp(d3Work, { [REQ]: null })],
    ['helpRequests 為陣列', withHelp(d3Work, [req()])],
    ['helpRequests 為 null', withHelp(d3Work, null)],
    ['helpRequests 缺', omit(d3Work, 'helpRequests')],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => expect(valid(save)).toBeFalse());
  }
});

describe('isValidSave（R12）：角色資料 profile 與入職進度 onboarding', () => {
  const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);

  it('合法：null（舊檔或尚未簽名）、中文、24 個字素（含表情 ZWJ 序列）', () => {
    for (const name of [null, '林予安', 'Ada Lovelace', '林'.repeat(24), family.repeat(24), 'é'.repeat(24)]) {
      expect(valid({ ...initial, profile: { name } })).withContext(String(name)).toBeTrue();
    }
  });

  const badProfile: Array<[string, unknown]> = [
    ['名字前後有空白（未正規化）', { name: ' 林予安 ' }],
    ['名字結尾有空白', { name: '林予安 ' }],
    ['25 個字素', { name: '林'.repeat(25) }],
    ['25 個表情 ZWJ 序列', { name: family.repeat(25) }],
    ['空字串', { name: '' }],
    ['純空白', { name: '   ' }],
    ['含換行', { name: '林\n予安' }],
    ['含 Tab', { name: '林\t予安' }],
    ['名字為數字', { name: 7 }],
    ['沒有 name 欄位', {}],
    ['profile 為 null', null],
    ['profile 為字串', '林予安'],
  ];
  for (const [label, profile] of badProfile) {
    it(`profile 不合法：${label}`, () => expect(valid({ ...initial, profile })).toBeFalse());
  }
  it('profile 缺 → 不合法', () => expect(valid(omit(initial, 'profile'))).toBeFalse());

  it('onboarding 合法：新存檔（0、未完成）、進行中、已完成且未簽名（舊檔遷移）；段落上限由 state 依內容限制，存檔只驗非負整數', () => {
    for (const onboarding of [
      { step: 0, complete: false },
      { step: 3, complete: false },
      { step: 0, complete: true },
      { step: 99, complete: false },
    ]) {
      expect(valid({ ...initial, profile: { name: null }, onboarding })).withContext(JSON.stringify(onboarding)).toBeTrue();
    }
  });

  const badOnboarding: Array<[string, unknown]> = [
    ['step 非整數（1.5）', { step: 1.5, complete: false }],
    ['step 為負數', { step: -1, complete: false }],
    ['step 為字串', { step: '1', complete: false }],
    ['step 為 NaN', { step: NaN, complete: false }],
    ['step 為 Infinity', { step: Infinity, complete: false }],
    ['step 缺', { complete: false }],
    ['complete 為字串', { step: 0, complete: 'true' }],
    ['complete 缺', { step: 0 }],
    ['onboarding 為 null', null],
    ['onboarding 為陣列', [0, false]],
  ];
  for (const [label, onboarding] of badOnboarding) {
    it(`onboarding 不合法：${label}`, () => expect(valid({ ...initial, onboarding })).toBeFalse());
  }
  it('onboarding 缺 → 不合法', () => expect(valid(omit(initial, 'onboarding'))).toBeFalse());
});

describe('isValidSave（R12）：回覆的回答時間與送達時間（可選、遞增）', () => {
  const R0 = ANSWERED.kind === 'answered' ? ANSWERED.responses[0]! : undefined;
  const R1 = ANSWERED.kind === 'answered' ? ANSWERED.responses[1]! : undefined;
  const timed = (patch: Record<string, unknown>, at: Array<number | undefined | unknown>): unknown =>
    withChat(initial, answeredWith({ ...patch, responses: [{ ...R0, deliverAt: at[0] }, { ...R1, deliverAt: at[1] }] }));

  it('合法：遞增、相等、只有部分回應有時間（舊檔混合）、沒有 answeredAt 但有 deliverAt、遊戲日字串', () => {
    const cases: Array<[string, unknown]> = [
      ['遞增', timed({ answeredAt: 1000, dayId: DAY_01 }, [4000, 7500])],
      ['相等（含等於回答時間）', timed({ answeredAt: 1000 }, [1000, 1000])],
      ['第二則沒有時間', timed({ answeredAt: 1000 }, [4000, undefined])],
      ['沒有 answeredAt', timed({}, [4000, 7000])],
      ['只有 answeredAt／dayId、回應沒有時間（沒有回應）', withChat(initial, answeredWith({ answeredAt: 1000, dayId: DAY_01, responses: [] }))],
    ];
    for (const [name, s] of cases) {
      expect(valid(s)).withContext(name).toBeTrue();
      expect(valid(JSON.parse(JSON.stringify(s)))).withContext(name).toBeTrue();
    }
  });

  const bad: Array<[string, unknown]> = [
    ['送達時間倒退', timed({ answeredAt: 1000 }, [7000, 4000])],
    ['第一則早於回答時間', timed({ answeredAt: 5000 }, [4000, 8000])],
    ['跳過沒有時間的回應後仍倒退', withChat(initial, answeredWith({ answeredAt: 1000, responses: [{ ...R0, deliverAt: 7000 }, { ...R1 }, { ...R1, id: 'msg.test.r3', deliverAt: 4000 }] }))],
    ['送達時間為負數（沒有 answeredAt）', timed({}, [-1, 4000])],
    ['送達時間為字串', timed({ answeredAt: 1000 }, ['4000', 7000])],
    ['送達時間為 null（JSON 化的 NaN）', timed({ answeredAt: 1000 }, [null, 7000])],
    ['回答時間為負數', timed({ answeredAt: -5 }, [4000, 7000])],
    ['回答時間為字串', timed({ answeredAt: '1000' }, [4000, 7000])],
    ['遊戲日為數字', timed({ answeredAt: 1000, dayId: 1 }, [4000, 7000])],
  ];
  for (const [name, save] of bad) {
    it(`不合法：${name}`, () => expect(valid(save)).toBeFalse());
  }
});

describe('isValidLegacySaveV10（R12）：接受 R11 存檔，拒絕 v11 與 v9', () => {
  it('R11（v10）存檔：已讀回條為既有回條 ID；沒有郵件、角色、入職欄位', () => {
    const samples: Array<[string, SaveV10]> = [
      ['day.01 work', toV10(initial)],
      ['day.03 work 有案件、回條未讀', toV10(mailR3, [])],
      ['day.03 work 回條已讀', toV10(mailR3, [`${R_ID}#0`])],
      ['day.05 morning 三份回條、兩份已讀', toV10(mailR5Early, [`${R_ID}#0`, `${R_ID}#1`])],
      ['day.05 morning 結案', toV10(mailR5Resolved, [`${R_ID}#1`])],
    ];
    for (const [name, v10] of samples) {
      for (const k of ['mailbox', 'readMail', 'profile', 'onboarding', 'helpRequests', 'issueDrafts']) expect(k in v10).withContext(`${name} ${k}`).toBeFalse();
      expect(isValidLegacySaveV10(v10, RDIR)).withContext(name).toBeTrue();
      expect(isValidLegacySaveV10(JSON.parse(JSON.stringify(v10)), RDIR)).withContext(name).toBeTrue();
      expect(isValidSave(v10, RDIR)).withContext(name).toBeFalse();
      expect(isValidLegacySaveV9(v10, RDIR)).withContext(name).toBeFalse();
    }
  });

  it('拒絕：v11 存檔、v9 存檔、已讀回條不合法', () => {
    for (const s of [mailR3, mailR5Early, initial]) expect(isValidLegacySaveV10(s, RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(toV9(initial), RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(toV10(mailR3, ['return.x#0']), RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(toV10(mailR3, [`${R_ID}#0`, `${R_ID}#0`]), RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(toV10(mailR3, [`mail.${R_ID}#0`]), RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(omit(toV10(mailR3), 'readIssueReceipts'), RDIR)).toBeFalse();
    expect(isValidLegacySaveV10({ ...toV10(mailR3), version: 11 }, RDIR)).toBeFalse();
    for (const bad of [null, [], {}, { version: 10 }]) expect(isValidLegacySaveV10(bad, RDIR)).toBeFalse();
  });

  it('v10 的案件／排程規則與 v11 相同：日程不一致一樣拒絕', () => {
    expect(isValidLegacySaveV10({ ...toV10(mailR3), stage: 'end' }, RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(toV10({ ...mailR3, issueSchedule: { [DAY_05]: [R_ID] } }), RDIR)).toBeFalse();
    expect(isValidLegacySaveV10(toV10(withMail({ ...r2Wrap, returns: [RETURN_B102] })), RDIR)).toBeFalse();
  });
});
