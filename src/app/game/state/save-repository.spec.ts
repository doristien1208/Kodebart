import { STORAGE } from '../content/text';
import { DayDirectory, casePlanOf, createDayDirectory } from '../core/day-plan';
import {
  activeTaskOf,
  advanceDay,
  answerChat,
  caseDecisionOf,
  commitArchive,
  commitCase,
  completeWork,
  createSave,
  markMessagesRead,
  markReceiptOpened,
  markReportOpened,
  openCase,
  previewFieldMap,
  editableReceiptOf,
  markMailRead,
  requestHelp,
  resubmitReturn,
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
} from '../core/rules';
import { isValidSave } from '../core/save-schema';
import {
  ArchivedRecord,
  BatchId,
  ChatReply,
  MissingPolicy,
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
  ReturnReceipt,
  SourceRecord,
} from '../core/types';
import { validateRecord } from '../core/validate';
import { generateReport, previewTransform, setTransformPolicy, submitAttachment, submitReport, submitTransform } from '../core/workday';
import { DAY_DIRECTORY } from './day-directory';
import { SAVE_KEY, SaveRepository } from './save-repository';

const DAY_01 = 'day.01';
const DAY_02 = 'day.02';
const DAY_03 = 'day.03';
const DAY_04 = 'day.04';
const DAY_05 = 'day.05';
const DAY_06 = 'day.06';
const TASK_DAY1 = 'task.day1.archive';
const TASK_DAY1_FOLLOWUP = 'task.day1.archive-followup';
const TASK_DAY2 = 'task.day2.reconcile';
const TASK_DAY2_ARCHIVE = 'task.day2.archive';
const TASK_DAY3 = 'task.day3.archive';
const TASK_DAY4 = 'task.day4.archive';
const TASK_DAY5 = 'task.day5.archive';
const TASK_DAY6 = 'task.day6.field-map';
const BATCH_DAY01 = 'batch.day01.archive';
const BATCH_DAY01_FOLLOWUP = 'batch.day01.archive-followup';
const BATCH_DAY02 = 'batch.day02.archive';
const BATCH_DAY03 = 'batch.day03.archive';
const BATCH_DAY04 = 'batch.day04.archive';
const TASK_DAY4_RETURN = 'task.day4.return-review';
/** Day 3 的多來源比對案件（R9）：H204。 */
const CASE_H204 = 'case.day3.h204';
/** 舊檔已跨過 Day 1、Day 2 時的免補清單（每天第 2 件以後、尚未完成的工作）。 */
const WAIVED_THROUGH_DAY2 = [TASK_DAY1_FOLLOWUP, TASK_DAY2_ARCHIVE];
/**
 * 已跨過 Day 4 的舊檔（R11）：錯誤文件處理位置（Day 4 的內容任務與各日虛擬位置）只在排入案件時才適用，
 * 遷移不把它列為免補，因此與跨過 Day 2 的免補清單相同。
 */
const WAIVED_THROUGH_DAY4 = WAIVED_THROUGH_DAY2;
/**
 * 已跨過 Day 6 的舊檔（M1）：Day 4／5 的附件關聯與批次轉換、Day 6 的交付報告是本輪新增的工作，
 * 落在舊檔已越過的日子，遷移列為免補（依日序、每天的工作順序）。
 */
const WAIVED_THROUGH_DAY6 = [
  ...WAIVED_THROUGH_DAY4,
  'task.day4.m1-attachment',
  'task.day4.m1-transform',
  'task.day5.m1-attachment',
  'task.day5.m1-transform',
  'task.day6.m1-report',
];

function snap(key: RecordKey) {
  const r = DAY_DIRECTORY.records(BATCH_DAY01).find((x) => x.key === key);
  if (!r) throw new Error(`Unknown record ${key}`);
  return snapshotOf(r);
}

const archivedAll: Record<RecordKey, ArchivedRecord> = {
  H17: { archiveCode: 'H-17', refusal: null, origin: 'source', source: snap('H17') },
  B102: { archiveCode: '0102', refusal: false, origin: 'defaulted', source: snap('B102') },
  B607: { archiveCode: '0607', refusal: true, origin: 'source', source: snap('B607') },
};

/** v10 → v11 遷移新增的欄位（沒有回條時）：未簽名、入職視為已完成、空郵件／已讀／提問／修訂草稿。 */
const V11_MIGRATED_EMPTY = {
  mailbox: [],
  readMail: [],
  helpRequests: {},
  issueDrafts: {},
  profile: { name: null },
  onboarding: { step: 0, complete: true },
};

/** v10 → v11：舊回覆快照（沒有 deliverAt）的回應視為已讀歷史，接在原已讀之後（去重）。 */
function legacyReadMessages(readMessages: readonly string[], chatReplies: Save['chatReplies'] = {}): string[] {
  const out = [...readMessages];
  for (const r of Object.values(chatReplies)) {
    if (r?.kind !== 'answered') continue;
    for (const x of r.responses) if (x.deliverAt === undefined && !out.includes(x.id)) out.push(x.id);
  }
  return out;
}

/** 案件目前可修訂的回條 ID（版本鎖定，R12）；沒有時拋錯。 */
function editableId(save: Save, returnId: string): string {
  const item = save.returns.find((r) => r.id === returnId);
  const id = item ? editableReceiptOf(item)?.id : undefined;
  if (!id) throw new Error(`${returnId} has no editable receipt`);
  return id;
}

/* ---------- 以純規則走出合法的現行（v11）存檔 ---------- */

/**
 * 案件決定：'registry' 等＝走 R9 案件流程（開案＋提交決定）；null＝舊檔寫法（以來源編號直接歸檔、沒有案件決定）。
 * v6／v7 時代還沒有案件，舊樣本一律用 null。
 * R10：案件的人員編號是玩家填寫的值；這裡帶入所選依據文件上的編號（畫面上的「帶入」按鈕）。
 */
type CaseChoice = string | null;

function decisionCode(dir: DayDirectory, save: Save, key: RecordKey, decision: string): string {
  const d = casePlanOf(activeTaskOf(save, dir), key)?.decisions.find((x) => x.id === decision);
  if (!d) throw new Error(`Unknown decision ${decision} for ${key}`);
  return d.archiveCode;
}

function archiveRecord(s: Save, dir: DayDirectory, batchId: BatchId, r: SourceRecord, policy: MissingPolicy, decision: CaseChoice): Save {
  const task = activeTaskOf(s, dir);
  const casePlan = casePlanOf(task, r.key);
  if (casePlan && decision !== null && !s.batches[batchId]?.archived[r.key]) {
    const next = commitCase(openCase(s, dir, casePlan.id), dir, r, decision, decisionCode(dir, s, r.key, decision), policy);
    if (next === s) throw new Error(`commitCase failed for ${r.key}`);
    return next;
  }
  const draft = r.refusalApplies && r.refusal === null ? { value: r.code, policy } : { value: r.code };
  const next = setDraft(s, batchId, r.key, draft);
  const ok = validateRecord(r, draft);
  if (!ok.ok) throw new Error(`validation failed for ${r.key}`);
  return commitArchive(next, batchId, r, ok);
}

/** 目前歸檔工作的批次提交前 n 筆（預設全部）；缺拒絕紀錄者用指定政策。 */
function archiveCurrent(save: Save, dir: DayDirectory, policy: MissingPolicy, n = Infinity, decision: CaseChoice = 'registry'): Save {
  const task = activeTaskOf(save, dir);
  if (task.kind !== 'archive') throw new Error(`${save.taskId} is not an archive task`);
  let s = save;
  for (const r of dir.records(task.batchId).slice(0, n)) s = archiveRecord(s, dir, task.batchId, r, policy, decision);
  return s;
}

/** 完成並交付目前這一件工作（任何種類）。 */
function finishTask(save: Save, dir: DayDirectory, decision: CaseChoice = 'registry'): Save {
  const task = activeTaskOf(save, dir);
  switch (task.kind) {
    case 'archive':
      return completeWork(archiveCurrent(save, dir, 'default_false', Infinity, decision), dir);
    case 'reconcile': {
      // R10：逐筆審查（全部放行；本檔以來源編號提交，不會產生退件）後才可回覆
      let s = markReceiptOpened(markReportOpened(save, dir), dir);
      for (const key of task.recordKeys) s = setRecordReview(s, dir, key, 'release');
      return submitReply(s, dir, 'review');
    }
    case 'return-review': {
      // 錯誤文件處理：當天排入且仍待修正的案件送窗口待查
      let s = save;
      for (const r of scheduledIssues(s, task.dayId).filter((x) => x.status === 'pending')) s = sendReturnToWindow(s, dir, r.id, editableId(s, r.id));
      return completeWork(s, dir);
    }
    case 'field-map': {
      let s = save;
      for (const t of task.targets) s = setFieldAssignment(s, dir, t.id, t.sourceId);
      s = setFieldBlankPolicy(s, dir, 'request_review');
      s = submitFieldMap(previewFieldMap(s, dir), dir);
      return completeWork(s, dir);
    }
    // M1：附件關聯引用第一份候選附件；批次保留缺漏送覆核；報告建立後交付
    case 'attachment':
      return completeWork(submitAttachment(save, dir, { choiceId: 'reference', documentId: task.candidates[0]?.documentId }), dir);
    case 'transform':
      return completeWork(submitTransform(previewTransform(setTransformPolicy(save, dir, 'review'), dir), dir), dir);
    case 'report':
      return completeWork(submitReport(generateReport(save, dir), dir), dir);
  }
}

/** 完成目前這一天的全部工作並停在 wrap／end（morning 先開始今日工作）。 */
function finishDay(save: Save, dir: DayDirectory, decision: CaseChoice = 'registry'): Save {
  let s = startDay(save);
  const dayId = s.dayId;
  while (s.stage === 'work' && s.dayId === dayId) {
    const next = finishTask(s, dir, decision);
    if (next === s) throw new Error(`cannot finish ${s.taskId}`);
    s = next;
  }
  return s;
}

/** 由新遊戲走到指定日的 work 階段（經過 morning → startDay）。 */
function playTo(dayId: string, seed = 42, dir: DayDirectory = DAY_DIRECTORY, decision: CaseChoice = 'registry'): Save {
  let s = createSave(seed, dir);
  while (s.dayId !== dayId) s = startDay(advanceDay(finishDay(s, dir, decision), dir));
  return s;
}

/**
 * R10：Day 1 第一件的 B102 以指定編號提交（其餘用來源編號）、Day 2 逐筆處置（B607 放行）後回覆並完成 → Day 2 wrap。
 */
function day2WrapWith(b102Code: string, b102Disposition: 'release' | 'hold' = 'release', seed = 42): Save {
  let s = createSave(seed, DAY_DIRECTORY);
  for (const r of DAY_DIRECTORY.records(BATCH_DAY01)) {
    const value = r.key === 'B102' ? b102Code : r.code;
    const draft = r.refusalApplies && r.refusal === null ? { value, policy: 'default_false' as const } : { value };
    const ok = validateRecord(r, draft);
    if (!ok.ok) throw new Error(`validation failed for ${r.key}`);
    s = commitArchive(setDraft(s, BATCH_DAY01, r.key, draft), BATCH_DAY01, r, ok);
  }
  s = finishDay(completeWork(s, DAY_DIRECTORY), DAY_DIRECTORY);
  s = startDay(advanceDay(s, DAY_DIRECTORY));
  s = markReportOpened(s, DAY_DIRECTORY);
  s = setRecordReview(setRecordReview(s, DAY_DIRECTORY, 'B102', b102Disposition), DAY_DIRECTORY, 'B607', 'release');
  s = submitReply(s, DAY_DIRECTORY, 'ack');
  s = completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
  if (s.stage !== 'wrap' || s.dayId !== DAY_02) throw new Error('day2WrapWith did not reach Day 2 wrap');
  return s;
}

/* ---------- v6 時代：每天只有一件工作（現行內容的當日第一件） ---------- */

/** 以現行內容建出 v6 當時的日程：每天只保留第一件工作。 */
const LEGACY_DIR: DayDirectory = (() => {
  const plans = DAY_DIRECTORY.days.map((d) => {
    const p = DAY_DIRECTORY.plan(d)!;
    return { ...p, tasks: [p.tasks[0]] };
  });
  const records: Record<BatchId, readonly SourceRecord[]> = {};
  for (const p of plans) for (const t of p.tasks) if (t.kind === 'archive') records[t.batchId] = DAY_DIRECTORY.records(t.batchId);
  return createDayDirectory(plans, records);
})();

/**
 * 現行存檔退回 v10 形狀（R11）：拿掉 R12 欄位（角色、入職、郵件、詢問、修訂草稿），
 * 已讀郵件推回 readIssueReceipts（郵件 ID＝'mail.'＋回條 ID）。回覆快照原樣保留。
 */
function toV10(save: Save): SaveV10 {
  const { issueDrafts: _d, mailbox: _m, readMail, helpRequests: _h, profile: _p, onboarding: _o, version: _v, ...rest } = save;
  return { ...rest, version: 10, readIssueReceipts: readMail.map((id) => id.replace(/^mail\./, '')) };
}

/**
 * 現行形狀退回 v8：拿掉 returns／issueSchedule／readIssueReceipts 與 R12 欄位、version 8；核對進度去掉 R10 才有的逐筆審查與摘要版本，
 * 也去掉 record.review 事件（舊檔不可能有；呼叫端保證沒有退件）。
 */
function toV8(save: Save): SaveV8 {
  if (save.returns.length > 0) throw new Error('legacy sample cannot carry returns');
  const { returns: _r, issueSchedule: _is, readIssueReceipts: _rr, version: _v, ...rest } = toV10(save);
  const taskProgress: Save['taskProgress'] = {};
  for (const [id, p] of Object.entries(save.taskProgress)) {
    if (p?.kind === 'reconcile') {
      const { reviews: _rv, reportRevision: _rr, ...legacy } = p;
      taskProgress[id] = legacy;
    } else if (p) taskProgress[id] = p;
  }
  return { ...rest, version: 8, taskProgress, events: save.events.filter((e) => e.kind !== 'record.review') };
}

/** 現行形狀退回 v7：再拿掉 caseReviews、version 7（舊檔不可能有案件決定，呼叫端自己保證）。 */
function toV7(save: Save): SaveV7 {
  const { caseReviews: _c, version: _v, ...rest } = toV8(save);
  return { ...rest, version: 7 };
}

/** 現行形狀退回 v6：再拿掉 waivedTasks、version 6。 */
function toV6(save: Save): SaveV6 {
  const { waivedTasks: _w, version: _v, ...rest } = toV7(save);
  return { ...rest, version: 6 };
}

/** 以 v6 當時的日程玩到指定日的 work，轉成 v6 形狀（Day 3 H204 以來源編號直接歸檔）。 */
function legacyV6At(dayId: string, seed = 42): SaveV6 {
  return toV6(playTo(dayId, seed, LEGACY_DIR, null));
}

/** v6 當時完成當日（只有一件）後停在 wrap／end。 */
function legacyV6Wrap(dayId: string, seed = 42): SaveV6 {
  return toV6(finishDay(playTo(dayId, seed, LEGACY_DIR, null), LEGACY_DIR, null));
}

/** v7（R8）當時的現行日程玩到指定日的 work：還沒有案件，H204 以來源編號直接歸檔。 */
function legacyV7At(dayId: string, seed = 42): SaveV7 {
  return toV7(playTo(dayId, seed, DAY_DIRECTORY, null));
}

/* ---------- 舊格式樣本 ---------- */

/** 一份合法的 v2 舊檔（已完成 Day 1、走到 day2）；用來驗證載入時會轉換而不是拒絕。 */
const legacyV2Day2: SaveV2 = {
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
  events: [
    { id: 'archive:0', kind: 'archive', payload: { key: 'H17', origin: 'source' } },
    { id: 'day1.complete:1', kind: 'day1.complete', payload: {} },
  ],
};

const legacyV2Day1: SaveV2 = {
  version: 2,
  seed: 7,
  phase: 'day1',
  archived: { B102: { archiveCode: '0102', refusal: false, origin: 'defaulted' } },
  drafts: { H17: { value: 'H-1' } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [],
};

/** 一份合法的 v3 舊檔（overnight，三筆齊，帶已讀）。 */
const legacyV3Overnight: SaveV3 = {
  version: 3,
  seed: 9,
  phase: 'overnight',
  dayId: DAY_01,
  batches: { [BATCH_DAY01]: { archived: { ...archivedAll }, drafts: {} } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [{ id: 'day1.complete:3', kind: 'day1.complete', payload: {} }],
  readMessages: ['msg.a', 'msg.b'],
};

const legacyV3End: SaveV3 = {
  ...legacyV3Overnight,
  phase: 'end',
  dayId: DAY_02,
  night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 },
  reply: 'ack',
  evidence: { reportOpened: true, receiptOpened: false },
};

/** v4 Day 1 work：全域 evidence 為預設值。 */
const legacyV4Day1: SaveV4 = {
  version: 4,
  seed: 5,
  dayId: DAY_01,
  stage: 'work',
  taskId: TASK_DAY1,
  batches: { [BATCH_DAY01]: { archived: { B102: { ...archivedAll['B102'] } }, drafts: { H17: { value: 'H-1' } } } },
  evidence: { reportOpened: false, receiptOpened: false },
  events: [],
  readMessages: ['msg.a'],
};

/** v4 當時 Day 2 是最後一天：回覆後停在 end。 */
const legacyV4Day2End: SaveV4 = {
  version: 4,
  seed: 13,
  dayId: DAY_02,
  stage: 'end',
  taskId: TASK_DAY2,
  batches: { [BATCH_DAY01]: { archived: { ...archivedAll }, drafts: {} } },
  night: { intervention: true, smallTalkVariant: 0, reportRevision: 2 },
  evidence: { reportOpened: true, receiptOpened: true },
  reply: 'review',
  events: [
    { id: 'day.complete:3', kind: 'day.complete', payload: { dayId: DAY_01, taskId: TASK_DAY1 } },
    { id: 'night.resolved:4', kind: 'night.resolved', payload: {} },
    { id: 'reply.submit:5', kind: 'reply.submit', payload: { choice: 'review' } },
  ],
  readMessages: ['msg.a', 'msg.b'],
};

/** 把 v6 存檔退回 v5 形狀：拿掉 chatReplies、version 5；其餘欄位原樣。 */
function toV5(save: SaveV6): SaveV5 {
  const { chatReplies: _drop, version: _v, ...rest } = save;
  return { ...rest, version: 5 };
}

/** 一份已回答的聊天回覆快照（結構合法即可；不比對內容檔）。 */
const ANSWERED: Extract<ChatReply, { kind: 'answered' }> = {
  kind: 'answered',
  choiceId: 'join',
  playerText: '好啊',
  responses: [{ id: 'msg.x.reply', actorId: 'actor.wu-wan-ting', time: '12:01', lines: ['一起'] }],
};

const NO_SAVE = { save: null, issue: '', migratedFrom: null };
const READ_FAIL = { save: null, issue: STORAGE.readIssue, migratedFrom: null };

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

  it('沒存檔 → { save: null, issue: "", migratedFrom: null }', () => {
    expect(repo.load()).toEqual(NO_SAVE);
  });

  /* ---------- v11（現行） ---------- */

  describe('v11 存取', () => {
    it('persist 寫入 key kodebart-save-v2，內容為 v11 JSON（returns／issueSchedule／mailbox／readMail／helpRequests／issueDrafts／caseReviews／waivedTasks 空、未簽名、入職未完成）；不寫其他 key', () => {
      const save = createSave(42, DAY_DIRECTORY);
      expect(repo.persist(save)).toBe('');
      expect(localStorage.length).toBe(1);
      expect(localStorage.key(0)).toBe('kodebart-save-v2');
      const raw = localStorage.getItem('kodebart-save-v2');
      expect(raw).toBe(JSON.stringify(save));
      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(12);
      expect(parsed.returns).toEqual([]);
      expect(parsed.issueSchedule).toEqual({});
      expect('readIssueReceipts' in parsed).toBeFalse();
      expect(parsed.mailbox).toEqual([]);
      expect(parsed.readMail).toEqual([]);
      expect(parsed.helpRequests).toEqual({});
      expect(parsed.issueDrafts).toEqual({});
      expect(parsed.profile).toEqual({ name: null });
      expect(parsed.onboarding).toEqual({ step: 0, complete: false });
      expect(parsed.caseReviews).toEqual({});
      expect(parsed.waivedTasks).toEqual([]);
      expect(parsed.chatReplies).toEqual({});
      expect(parsed.taskProgress).toEqual({});
      expect('evidence' in parsed).toBeFalse();
      expect('reply' in parsed).toBeFalse();
    });

    it('persist 後 load 回同內容、issue 空字串、migratedFrom 11', () => {
      const save: Save = setDraft(createSave(42, DAY_DIRECTORY), BATCH_DAY01, 'B102', { value: '0102', policy: 'request_review' });
      expect(repo.persist(save)).toBe('');
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
      expect(loaded.save).not.toBe(save);
      expect(loaded.save!.version).toBe(12);
      expect(loaded.save!.waivedTasks).toEqual([]);
      expect(loaded.save!.caseReviews).toEqual({});
      expect(loaded.save!.chatReplies).toEqual({});
      expect(loaded.save!.dayId).toBe(DAY_01);
      expect(loaded.save!.stage).toBe('work');
      expect(loaded.save!.taskId).toBe(TASK_DAY1);
    });

    it('再次 persist 會覆寫前一份', () => {
      repo.persist(createSave(1, DAY_DIRECTORY));
      repo.persist(createSave(2, DAY_DIRECTORY));
      expect(repo.load().save?.seed).toBe(2);
    });

    it('Day 1 第二件工作（補入批次）中途 → migratedFrom 11，taskId 與兩個批次原樣讀回', () => {
      let save = completeWork(archiveCurrent(createSave(42, DAY_DIRECTORY), DAY_DIRECTORY, 'request_review'), DAY_DIRECTORY);
      expect(save.stage).toBe('work');
      expect(save.taskId).toBe(TASK_DAY1_FOLLOWUP);
      save = archiveCurrent(save, DAY_DIRECTORY, 'default_false', 1);
      save = setDraft(save, BATCH_DAY01_FOLLOWUP, 'H19', { value: 'H-1' });
      expect(repo.persist(save)).toBe('');
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
      expect(loaded.save!.taskId).toBe(TASK_DAY1_FOLLOWUP);
      expect(Object.keys(loaded.save!.batches[BATCH_DAY01]!.archived).sort()).toEqual(['B102', 'B607', 'H17']);
      expect(Object.keys(loaded.save!.batches[BATCH_DAY01_FOLLOWUP]!.archived)).toEqual(['H18']);
      expect(loaded.save!.batches[BATCH_DAY01_FOLLOWUP]!.drafts['H19']).toEqual({ value: 'H-1' });
    });

    it('Day 2 morning 存檔 → migratedFrom 11，原樣讀回；Day 1 morning（不可能的階段）→ 讀取失敗且不覆蓋', () => {
      const morning = advanceDay(finishDay(createSave(42, DAY_DIRECTORY), DAY_DIRECTORY), DAY_DIRECTORY);
      expect(morning.dayId).toBe(DAY_02);
      expect(morning.stage).toBe('morning');
      expect(morning.taskId).toBe(TASK_DAY2);
      repo.persist(morning);
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(morning);

      const raw = JSON.stringify({ ...createSave(42, DAY_DIRECTORY), stage: 'morning' });
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('Day 3 work 存檔（含 Day 2 核對進度與新件批次）→ migratedFrom 11，原樣讀回', () => {
      const save = playTo(DAY_03);
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      expect(save.waivedTasks).toEqual([]);
      repo.persist(save);
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
      expect(loaded.save!.taskProgress[TASK_DAY2]).toEqual(
        jasmine.objectContaining({ kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review', reportRevision: save.night!.reportRevision }),
      );
      expect(Object.keys((loaded.save!.taskProgress[TASK_DAY2] as { reviews: object }).reviews).sort()).toEqual(['B102', 'B607']);
      expect(loaded.save!.returns).toEqual([]);
      expect(Object.keys(loaded.save!.batches[BATCH_DAY02]!.archived).length).toBe(4);
    });

    it('Day 6 end 存檔（欄位映射已提交）→ migratedFrom 12；0102 的前導零與保留缺漏的 null 都保留', () => {
      const save = finishDay(playTo(DAY_06), DAY_DIRECTORY);
      expect(save.stage).toBe('end');
      repo.persist(save);
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
      const p = loaded.save!.taskProgress[TASK_DAY6];
      expect(p?.kind).toBe('field-map');
      if (p?.kind !== 'field-map') return;
      expect(p.submitted!.rowCount).toBe(8);
      // M1：資料列讀保存資料——本檔的批次一律保留缺漏，所以 0314／0716／1013／1108／1219 為空白，
      // 0521 有本人回覆附件（無）、0102／0905 沿用歸檔補登的未拒絕
      expect(p.submitted!.affectedCount).toBe(5);
      expect(p.submitted!.blankPolicy).toBe('request_review');
      const row0102 = p.submitted!.rows.find((r) => r.id === 'row.0102')!;
      expect(row0102.values['personnel-code']).toBe('0102');
      expect(row0102.values['exclude-flag']).toBeFalse();
      expect(p.submitted!.rows.find((r) => r.id === 'row.0716')!.values['exclude-flag']).toBeNull();
    });

    it('v11 但階段與日程矛盾（有下一日卻 end、最後一日卻 wrap）→ 讀取失敗且不覆蓋', () => {
      const day2Wrap = finishDay(playTo(DAY_02), DAY_DIRECTORY);
      expect(day2Wrap.stage).toBe('wrap');
      const day6End = finishDay(playTo(DAY_06), DAY_DIRECTORY);
      for (const bad of [{ ...day2Wrap, stage: 'end' }, { ...day6End, stage: 'wrap' }]) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('v11 但 waivedTasks 缺少、手改免補第一件或目前進行中的工作 → 讀取失敗且不覆蓋', () => {
      const base = createSave(1, DAY_DIRECTORY);
      const { waivedTasks: _w, ...missing } = base;
      const day2 = playTo(DAY_02);
      const bads: unknown[] = [
        missing,
        { ...base, waivedTasks: null },
        { ...base, waivedTasks: [TASK_DAY1] },
        { ...base, waivedTasks: [TASK_DAY1_FOLLOWUP] },
        { ...base, waivedTasks: ['task.nope'] },
        { ...day2, waivedTasks: [TASK_DAY2_ARCHIVE] },
        { ...day2, waivedTasks: [TASK_DAY1_FOLLOWUP, TASK_DAY1_FOLLOWUP] },
      ];
      for (const bad of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw.slice(0, 120)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('v11 但 taskProgress 的 kind 與工作不符 → 讀取失敗', () => {
      const bad = {
        ...playTo(DAY_03),
        taskProgress: { [TASK_DAY2]: { kind: 'field-map', assignments: {}, previewed: false } },
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(bad));
      expect(repo.load()).toEqual(READ_FAIL);
    });

    it('v11 但欄位映射來源重複或目標不存在 → 讀取失敗', () => {
      const day6 = playTo(DAY_06);
      const dup = {
        ...day6,
        taskProgress: {
          ...day6.taskProgress,
          [TASK_DAY6]: { kind: 'field-map', assignments: { 'personnel-code': 'legacy-id', 'contact-status': 'legacy-id' }, previewed: false },
        },
      };
      const unknownTarget = {
        ...day6,
        taskProgress: { ...day6.taskProgress, [TASK_DAY6]: { kind: 'field-map', assignments: { nope: 'legacy-id' }, previewed: false } },
      };
      for (const bad of [dup, unknownTarget]) {
        localStorage.setItem(SAVE_KEY, JSON.stringify(bad));
        expect(repo.load()).toEqual(READ_FAIL);
      }
    });

    it('load(dir) 以傳入的目錄驗證：未知日的存檔在正式目錄被拒、在自訂目錄可讀', () => {
      const custom = createDayDirectory(
        [
          { ...DAY_DIRECTORY.plan(DAY_01)!, nextDayId: 'day.x2' },
          {
            dayId: 'day.x2',
            dayNumber: 2,
            nextDayId: null,
            tasks: [{ id: 'task.x2.archive', kind: 'archive', batchId: 'batch.x2.archive', recordKeys: [], caseReviews: [] }],
          },
        ],
        {
          [BATCH_DAY01]: DAY_DIRECTORY.records(BATCH_DAY01),
          [BATCH_DAY01_FOLLOWUP]: DAY_DIRECTORY.records(BATCH_DAY01_FOLLOWUP),
          'batch.x2.archive': [],
        },
      );
      const followup: Record<RecordKey, ArchivedRecord> = {};
      for (const r of DAY_DIRECTORY.records(BATCH_DAY01_FOLLOWUP)) {
        followup[r.key] = { archiveCode: r.code, refusal: null, origin: 'source', source: snapshotOf(r) };
      }
      const onX2: Save = {
        ...createSave(5, custom),
        dayId: 'day.x2',
        taskId: 'task.x2.archive',
        batches: {
          [BATCH_DAY01]: { archived: { ...archivedAll }, drafts: {} },
          [BATCH_DAY01_FOLLOWUP]: { archived: followup, drafts: {} },
        },
        night: { intervention: true, smallTalkVariant: 1, reportRevision: 2 },
      };
      expect(isValidSave(onX2, custom)).toBeTrue();
      expect(repo.persist(onX2)).toBe('');
      expect(repo.load()).toEqual(READ_FAIL);
      expect(repo.load(DAY_DIRECTORY)).toEqual(READ_FAIL);
      const loaded = repo.load(custom);
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save!.dayId).toBe('day.x2');
    });
  });

  /* ---------- v11 chatReplies ---------- */

  describe('v11 chatReplies（R7 回覆在 v11 仍保存）', () => {
    it('answered／skipped 保存後原樣讀回（含回應快照），migratedFrom 11', () => {
      let save = playTo(DAY_03);
      save = answerChat(save, 'prompt.day3.lunch-plan', { id: 'join', text: '好啊', responses: ANSWERED.responses });
      save = skipChat(save, 'prompt.day2.check-in');
      expect(repo.persist(save)).toBe('');
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
      expect(loaded.save!.chatReplies).toEqual({
        'prompt.day3.lunch-plan': { ...ANSWERED, responses: [{ ...ANSWERED.responses[0], lines: ['一起'] }] },
        'prompt.day2.check-in': { kind: 'skipped' },
      });
    });

    it('內容已不存在的 prompt 歷史快照不讓整份存檔失效', () => {
      const save: Save = { ...createSave(3, DAY_DIRECTORY), chatReplies: { 'prompt.removed.long-ago': { ...ANSWERED, responses: [...ANSWERED.responses] } } };
      repo.persist(save);
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save!.chatReplies['prompt.removed.long-ago']).toEqual(JSON.parse(JSON.stringify(ANSWERED)));
    });

    it('chatReplies 缺少或結構錯誤 → 讀取失敗且不覆蓋', () => {
      const base = createSave(3, DAY_DIRECTORY);
      const { chatReplies: _drop, ...missing } = base;
      const bads: unknown[] = [
        missing,
        { ...base, chatReplies: null },
        { ...base, chatReplies: [] },
        { ...base, chatReplies: { p: null } },
        { ...base, chatReplies: { p: { kind: 'maybe' } } },
        { ...base, chatReplies: { p: { ...ANSWERED, choiceId: '' } } },
        { ...base, chatReplies: { p: { ...ANSWERED, choiceId: 3 } } },
        { ...base, chatReplies: { p: { ...ANSWERED, playerText: '' } } },
        { ...base, chatReplies: { p: { kind: 'answered', choiceId: 'join', playerText: 'x' } } },
        { ...base, chatReplies: { p: { ...ANSWERED, responses: [{ id: 'msg.a', actorId: 'actor.a', time: '09:00', lines: 'x' }] } } },
        { ...base, chatReplies: { p: { ...ANSWERED, responses: [{ id: 'msg.a', actorId: 'actor.a', lines: [] }] } } },
        { ...base, chatReplies: { p: { ...ANSWERED, responses: [null] } } },
      ];
      for (const bad of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });
  });

  /* ---------- 多來源比對案件（R9；R10 起編號由玩家填寫） ---------- */

  describe('v11 案件決定（case.day3.h204）', () => {
    function h204(): SourceRecord {
      return DAY_DIRECTORY.records(BATCH_DAY03).find((r) => r.key === 'H204')!;
    }

    /** Day 3 work，H204 以指定決定與編號提交（其餘不動；編號預設帶入依據文件上的值）。 */
    function day3WithDecision(decision: string, code?: string): Save {
      const day3 = playTo(DAY_03);
      const s = commitCase(openCase(day3, DAY_DIRECTORY, CASE_H204), DAY_DIRECTORY, h204(), decision, code ?? decisionCode(DAY_DIRECTORY, day3, 'H204', decision));
      expect(s.batches[BATCH_DAY03]?.archived['H204']).toBeDefined();
      return s;
    }

    it('依補件決定提交的 H-205 → 原樣讀回（migratedFrom 11），決定快照、來源快照與變體都保留', () => {
      const save = day3WithDecision('supplement');
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      expect(repo.persist(save)).toBe('');
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
      const entry = loaded.save!.batches[BATCH_DAY03]!.archived['H204']!;
      expect(entry.archiveCode).toBe('H-205');
      expect(entry.origin).toBe('source');
      expect(entry.source.code).toBe('H-204');
      expect(entry.caseDecision).toEqual({
        caseId: CASE_H204,
        decisionId: 'supplement',
        destination: 'archive',
        basisDocumentId: 'doc.day3.h204.supplement',
        note: '原表與補件編號不同；採用補件，保留原表。',
      });
      expect(['received', 'pending']).toContain(loaded.save!.caseReviews[CASE_H204]!.variantId);
      expect(caseDecisionOf(loaded.save!, DAY_DIRECTORY, CASE_H204)).toBe('supplement');
    });

    it('三種決定都能完成 Day 3、跨到 Day 4，存檔讀回後仍帶原決定', () => {
      for (const decision of ['registry', 'supplement', 'review']) {
        const day4 = playTo(DAY_04, 42, DAY_DIRECTORY, decision);
        repo.persist(day4);
        const loaded = repo.load();
        expect(loaded.migratedFrom).withContext(decision).toBe(12);
        expect(loaded.save).withContext(decision).toEqual(day4);
        expect(caseDecisionOf(loaded.save!, DAY_DIRECTORY, CASE_H204)).withContext(decision).toBe(decision);
        expect(loaded.save!.batches[BATCH_DAY03]!.archived['H204']!.archiveCode).toBe(decision === 'supplement' ? 'H-205' : 'H-204');
      }
    });

    it('目前批次的案件決定不合法（決定與依據不符、未知決定／案件、非法去向、掛在非案件紀錄）→ 讀取失敗且不覆蓋', () => {
      const save = day3WithDecision('supplement');
      const entry = save.batches[BATCH_DAY03]!.archived['H204']!;
      const withEntry = (key: string, e: unknown) => ({
        ...save,
        batches: { ...save.batches, [BATCH_DAY03]: { ...save.batches[BATCH_DAY03]!, archived: { ...save.batches[BATCH_DAY03]!.archived, [key]: e } } },
      });
      const b448 = archiveCurrent(playTo(DAY_03), DAY_DIRECTORY, 'default_false').batches[BATCH_DAY03]!.archived['B448']!;
      const bads: unknown[] = [
        withEntry('H204', { ...entry, caseDecision: { ...entry.caseDecision!, decisionId: 'registry' } }),
        withEntry('H204', { ...entry, caseDecision: { ...entry.caseDecision!, decisionId: 'nope' } }),
        withEntry('H204', { ...entry, caseDecision: { ...entry.caseDecision!, caseId: 'case.nope' } }),
        withEntry('H204', { ...entry, caseDecision: { ...entry.caseDecision!, destination: 'elsewhere' } }),
        withEntry('B448', { ...b448, caseDecision: { ...entry.caseDecision! } }),
        withEntry('H204', { ...entry, archiveCode: '  ' }),
        withEntry('H204', { ...entry, archiveCode: 205 }),
      ];
      for (const bad of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw.slice(-240)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('R10：H204 編號不與來源或決定預設值比較 —— 任意合法編號、補件決定配登記表編號、無決定的舊寫法 H-205 都照樣讀回', () => {
      const save = day3WithDecision('supplement');
      const { caseDecision: _drop, ...bare } = save.batches[BATCH_DAY03]!.archived['H204']!;
      const bareSave: Save = {
        ...save,
        batches: { ...save.batches, [BATCH_DAY03]: { ...save.batches[BATCH_DAY03]!, archived: { ...save.batches[BATCH_DAY03]!.archived, H204: bare } } },
      };
      const goods: Save[] = [day3WithDecision('supplement', 'H-204'), day3WithDecision('registry', 'zz 0099'), day3WithDecision('review', 'H-205'), bareSave];
      for (const good of goods) {
        expect(isValidSave(good, DAY_DIRECTORY)).toBeTrue();
        expect(repo.persist(good)).toBe('');
        const loaded = repo.load();
        const code = good.batches[BATCH_DAY03]!.archived['H204']!.archiveCode;
        expect(loaded.issue).withContext(code).toBe('');
        expect(loaded.migratedFrom).withContext(code).toBe(12);
        expect(loaded.save).withContext(code).toEqual(good);
      }
    });

    it('caseReviews 缺少、未知案件、未知變體或重複標記 → 讀取失敗且不覆蓋', () => {
      const base = openCase(playTo(DAY_03), DAY_DIRECTORY, CASE_H204);
      const { caseReviews: _drop, ...missing } = base;
      const bads: unknown[] = [
        missing,
        { ...base, caseReviews: null },
        { ...base, caseReviews: { 'case.nope': { variantId: 'received', marks: [] } } },
        { ...base, caseReviews: { [CASE_H204]: { variantId: 'lost', marks: [] } } },
        { ...base, caseReviews: { [CASE_H204]: { variantId: 'received', marks: ['人員編號', '人員編號'] } } },
        { ...base, caseReviews: { [CASE_H204]: { variantId: 'received' } } },
      ];
      for (const bad of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw.slice(-200)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });
  });

  /* ---------- v7 → v11（R9 補 caseReviews、R10 補 returns、R11 補 issueSchedule、R12 補角色／入職／郵件） ---------- */

  describe('v7 舊檔遷移（R9：補空 caseReviews，不補造決定）', () => {
    function withArchived(save: Save, keys: readonly string[]): Save {
      const task = activeTaskOf(save, DAY_DIRECTORY);
      if (task.kind !== 'archive') throw new Error('not archive');
      let s = save;
      for (const r of DAY_DIRECTORY.records(task.batchId).filter((x) => keys.includes(x.key))) {
        s = archiveRecord(s, DAY_DIRECTORY, task.batchId, r, 'request_review', null);
      }
      return s;
    }

    function loadV7(v7: SaveV7) {
      expect(v7.version).toBe(7);
      expect('caseReviews' in v7).toBeFalse();
      const raw = JSON.stringify(v7);
      localStorage.setItem(SAVE_KEY, raw);
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(7);
      const save = loaded.save!;
      expect(save).toEqual({ ...JSON.parse(raw), version: 12, caseReviews: {}, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY });
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      // load() 不寫檔；寫回後再載入 → 11
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      expect(repo.persist(save)).toBe('');
      const again = repo.load();
      expect(again.migratedFrom).toBe(12);
      expect(JSON.stringify(again.save)).toBe(JSON.stringify(save));
      return save;
    }

    it('Day 3 批次中途、H204 尚未提交 → v11 caseReviews {}；可照新案件流程處理 H204（編號用玩家草稿）並完成當日', () => {
      let cur = withArchived(playTo(DAY_03, 42, DAY_DIRECTORY, null), ['H219', 'B314']);
      cur = setDraft(cur, BATCH_DAY03, 'H204', { value: 'H-20' });
      const save = loadV7(toV7(cur));
      expect(save.batches[BATCH_DAY03]!.archived['H204']).toBeUndefined();
      expect(save.batches[BATCH_DAY03]!.drafts['H204']).toEqual({ value: 'H-20' });
      expect(caseDecisionOf(save, DAY_DIRECTORY, CASE_H204)).toBeNull();

      let s = openCase(save, DAY_DIRECTORY, CASE_H204);
      expect(s.caseReviews[CASE_H204]!.marks).toEqual([]);
      s = commitCase(s, DAY_DIRECTORY, DAY_DIRECTORY.records(BATCH_DAY03)[0], 'review', 'H-20');
      expect(s.batches[BATCH_DAY03]!.archived['H204']!.caseDecision!.destination).toBe('review');
      expect(s.batches[BATCH_DAY03]!.archived['H204']!.archiveCode).toBe('H-20');
      s = completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
      expect(caseDecisionOf(s, DAY_DIRECTORY, CASE_H204)).toBe('review');
    });

    it('Day 3 已以 H-204 歸檔 H204（舊檔、沒有決定）→ 原樣保留，不補造決定、不要求重做；可完成當日並進 Day 4', () => {
      const cur = withArchived(playTo(DAY_03, 42, DAY_DIRECTORY, null), ['H204', 'B448']);
      const legacyEntry = cur.batches[BATCH_DAY03]!.archived['H204']!;
      expect(legacyEntry.archiveCode).toBe('H-204');
      expect(legacyEntry.caseDecision).toBeUndefined();
      const save = loadV7(toV7(cur));
      expect(save.batches[BATCH_DAY03]!.archived['H204']).toEqual(legacyEntry);
      expect('caseDecision' in save.batches[BATCH_DAY03]!.archived['H204']!).toBeFalse();
      expect(caseDecisionOf(save, DAY_DIRECTORY, CASE_H204)).toBeNull();
      expect(save.caseReviews).toEqual({});

      // 不能再以案件決定覆寫已提交的舊紀錄
      const opened = openCase(save, DAY_DIRECTORY, CASE_H204);
      expect(commitCase(opened, DAY_DIRECTORY, DAY_DIRECTORY.records(BATCH_DAY03)[0], 'supplement', 'H-205')).toBe(opened);

      let s = completeWork(archiveCurrent(save, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      expect(s.batches[BATCH_DAY03]!.archived['H204']).toEqual(legacyEntry);
      s = startDay(advanceDay(s, DAY_DIRECTORY));
      expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_04, 'work', TASK_DAY4]);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
      expect(caseDecisionOf(s, DAY_DIRECTORY, CASE_H204)).toBeNull();
    });

    it('Day 4 work 中途（Day 3 的 H204 為舊檔歸檔）→ 遷移後可完成 Day 4 並進 Day 5', () => {
      const legacy = toV7(archiveCurrent(playTo(DAY_04, 42, DAY_DIRECTORY, null), DAY_DIRECTORY, 'request_review', 2, null));
      expect(legacy.batches[BATCH_DAY03]).toEqual(legacyV7At(DAY_04).batches[BATCH_DAY03]);
      const save = loadV7(legacy);
      expect(save.batches[BATCH_DAY03]!.archived['H204']!.archiveCode).toBe('H-204');
      expect(save.batches[BATCH_DAY03]!.archived['H204']!.caseDecision).toBeUndefined();
      expect(Object.keys(save.batches[BATCH_DAY04]!.archived).length).toBe(2);
      let s = finishDay(save, DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      s = advanceDay(s, DAY_DIRECTORY);
      expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_05, 'morning', TASK_DAY5]);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
    });

    it('v7 形狀但本體不合法（dayId／taskId 矛盾）→ 讀取失敗且不覆蓋', () => {
      const raw = JSON.stringify({ ...legacyV7At(DAY_03), taskId: TASK_DAY2 });
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });
  });

  /* ---------- v6 → v11（R8 補 waivedTasks、R9 補 caseReviews、R10 補 returns、R11 補排程、R12 補角色／入職／郵件） ---------- */

  describe('v6 舊檔遷移（R8：補 waivedTasks）', () => {
    interface V6Case {
      name: string;
      build: () => SaveV6;
      dayId: string;
      stage: 'work' | 'wrap' | 'end';
      taskId: string;
      waived: string[];
    }

    const CASES: readonly V6Case[] = [
      {
        name: 'Day 1 work 批次中途',
        build: () => {
          let s = createSave(42, LEGACY_DIR);
          s = archiveCurrent(s, LEGACY_DIR, 'request_review', 2);
          s = setDraft(s, BATCH_DAY01, 'B607', { value: '06' });
          return toV6(markMessagesRead(s, ['msg.day1.welcome']));
        },
        dayId: DAY_01,
        stage: 'work',
        taskId: TASK_DAY1,
        waived: [],
      },
      { name: 'Day 1 wrap', build: () => legacyV6Wrap(DAY_01), dayId: DAY_01, stage: 'wrap', taskId: TASK_DAY1, waived: [TASK_DAY1_FOLLOWUP] },
      {
        name: 'Day 2 work 核對（已開摘要）',
        build: () => toV6(markReportOpened(playTo(DAY_02, 42, LEGACY_DIR), LEGACY_DIR)),
        dayId: DAY_02,
        stage: 'work',
        taskId: TASK_DAY2,
        waived: [TASK_DAY1_FOLLOWUP],
      },
      { name: 'Day 2 wrap', build: () => legacyV6Wrap(DAY_02), dayId: DAY_02, stage: 'wrap', taskId: TASK_DAY2, waived: WAIVED_THROUGH_DAY2 },
      {
        name: 'Day 4 work 批次中途（帶 R7 回覆）',
        build: () => {
          let s = playTo(DAY_04, 42, LEGACY_DIR, null);
          s = archiveCurrent(s, LEGACY_DIR, 'request_review', 3);
          s = answerChat(s, 'prompt.day4.review-returned', { id: 'ask-useful', text: '那送覆核有用嗎？', responses: ANSWERED.responses });
          s = skipChat(s, 'prompt.day3.lunch-plan');
          return toV6(markMessagesRead(s, ['msg.day4.dept-report']));
        },
        dayId: DAY_04,
        stage: 'work',
        taskId: TASK_DAY4,
        waived: WAIVED_THROUGH_DAY2,
      },
      { name: 'Day 6 end', build: () => legacyV6Wrap(DAY_06), dayId: DAY_06, stage: 'end', taskId: TASK_DAY6, waived: WAIVED_THROUGH_DAY6 },
    ];

    for (const c of CASES) {
      it(`${c.name} → migratedFrom 6、v11 waivedTasks ${JSON.stringify(c.waived)}、returns []，其餘欄位逐字保留、不新增事件`, () => {
        const v6 = c.build();
        expect(v6.version).toBe(6);
        expect(v6.dayId).toBe(c.dayId);
        expect(v6.stage).toBe(c.stage);
        expect(v6.taskId).toBe(c.taskId);
        const raw = JSON.stringify(v6);
        localStorage.setItem(SAVE_KEY, raw);

        const loaded = repo.load();
        expect(loaded.issue).toBe('');
        expect(loaded.migratedFrom).toBe(6);
        const save = loaded.save!;
        expect(save.version).toBe(12);
        expect(save.waivedTasks).toEqual(c.waived);
        // 舊回覆快照（沒有送達時間）的回應 ID 視為已讀歷史（R12）；其餘欄位逐字保留
        const readMessages = legacyReadMessages(v6.readMessages, v6.chatReplies);
        expect(save).toEqual({ ...JSON.parse(raw), version: 12, caseReviews: {}, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY, readMessages, waivedTasks: c.waived });
        expect(save.batches).toEqual(v6.batches);
        expect(save.taskProgress).toEqual(v6.taskProgress);
        expect(save.chatReplies).toEqual(v6.chatReplies);
        expect(save.readMessages).toEqual(readMessages);
        expect(save.events).toEqual(v6.events);
        expect(save.night).toEqual(v6.night);
        expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
        // load() 本身不寫檔
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);

        // 寫回後再載入 → 11，不再遷移
        expect(repo.persist(save)).toBe('');
        const again = repo.load();
        expect(again.migratedFrom).toBe(12);
        expect(JSON.stringify(again.save)).toBe(JSON.stringify(save));
      });
    }

    it('Day 1 work 中途 → 做完舊工作後接著做本輪新增的補入批次，再進 wrap', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(CASES[0].build()));
      let s = repo.load().save!;
      expect(completeWork(s, DAY_DIRECTORY)).toBe(s);
      s = completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
      expect(s.stage).toBe('work');
      expect(s.taskId).toBe(TASK_DAY1_FOLLOWUP);
      s = completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      expect(s.waivedTasks).toEqual([]);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 1 wrap → advanceDay → Day 2 morning（核對）→ startDay → work；夜間只判定一次', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV6Wrap(DAY_01)));
      const s = repo.load().save!;
      expect(s.night).toBeUndefined();
      const morning = advanceDay(s, DAY_DIRECTORY);
      expect(morning.dayId).toBe(DAY_02);
      expect(morning.stage).toBe('morning');
      expect(morning.taskId).toBe(TASK_DAY2);
      expect(morning.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      expect(morning.events.filter((e) => e.kind === 'night.resolved').length).toBe(1);
      expect(isValidSave(morning, DAY_DIRECTORY)).toBeTrue();
      const work = startDay(morning);
      expect(work.stage).toBe('work');
      expect(isValidSave(work, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 2 work 核對 → 逐筆審查、回覆後停在 work 接 Day 2 新件歸檔（不免補），完成後 wrap → Day 3 morning', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(CASES[2].build()));
      let s = repo.load().save!;
      // 舊檔沒有審查處置：R10 起仍須逐筆審查才能回覆（不補造放行）
      expect(submitReply(s, DAY_DIRECTORY, 'ack')).toBe(s);
      s = setRecordReview(setRecordReview(s, DAY_DIRECTORY, 'B102', 'release'), DAY_DIRECTORY, 'B607', 'hold');
      s = submitReply(s, DAY_DIRECTORY, 'ack');
      expect(s.stage).toBe('work');
      expect(s.taskId).toBe(TASK_DAY2_ARCHIVE);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
      s = completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      expect(s.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      s = advanceDay(s, DAY_DIRECTORY);
      expect(s.dayId).toBe(DAY_03);
      expect(s.stage).toBe('morning');
      expect(s.taskId).toBe(TASK_DAY3);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 2 wrap → advanceDay → Day 3 morning → startDay → work，night 不重擲，不會卡住', () => {
      const v6 = legacyV6Wrap(DAY_02);
      localStorage.setItem(SAVE_KEY, JSON.stringify(v6));
      const s = repo.load().save!;
      const morning = advanceDay(s, DAY_DIRECTORY);
      expect(morning.dayId).toBe(DAY_03);
      expect(morning.stage).toBe('morning');
      expect(morning.taskId).toBe(TASK_DAY3);
      expect(morning.night).toEqual(v6.night!);
      expect(morning.events).toEqual(v6.events);
      expect(isValidSave(morning, DAY_DIRECTORY)).toBeTrue();
      const done = finishDay(morning, DAY_DIRECTORY);
      expect(done.stage).toBe('wrap');
      expect(done.dayId).toBe(DAY_03);
      expect(isValidSave(done, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 4 work 中途 → 可接著完成當日並進 Day 5 morning', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(CASES[4].build()));
      let s = repo.load().save!;
      expect(Object.keys(s.batches[BATCH_DAY04]!.archived).length).toBe(3);
      s = finishDay(s, DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      s = advanceDay(s, DAY_DIRECTORY);
      expect(s.dayId).toBe(DAY_05);
      expect(s.stage).toBe('morning');
      expect(s.taskId).toBe(TASK_DAY5);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
    });

    it('v6 不可能的形狀（morning 階段、taskId 是當日第二件、dayId／taskId 矛盾）→ 讀取失敗且不覆蓋', () => {
      const day1 = toV6(createSave(1, LEGACY_DIR));
      const day2 = legacyV6At(DAY_02);
      for (const bad of [
        { ...day2, stage: 'morning' },
        { ...day1, taskId: TASK_DAY1_FOLLOWUP },
        { ...day2, taskId: TASK_DAY2_ARCHIVE },
        { ...day1, taskId: TASK_DAY2 },
        { ...legacyV6Wrap(DAY_02), stage: 'end' },
      ]) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw.slice(0, 120)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('v6 Day 2 但 Day 1 第一件其實未完成 → 不因免補而被硬救，讀取失敗', () => {
      const day2 = legacyV6At(DAY_02);
      const raw = JSON.stringify({
        ...day2,
        batches: { ...day2.batches, [BATCH_DAY01]: { archived: { H17: archivedAll['H17'] }, drafts: {} } },
      });
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });
  });

  /* ---------- v5 → v11 ---------- */

  describe('v5 舊檔遷移', () => {
    it('v5 Day 4 work → migratedFrom 5、v11 新增空 chatReplies、免補清單、空 caseReviews、空 returns 與空排程／已讀回條，其他欄位逐字保留', () => {
      let v6 = legacyV6At(DAY_04);
      v6 = { ...v6, readMessages: ['msg.day1.welcome', 'msg.day3.lunch-order'] };
      const r = DAY_DIRECTORY.records(BATCH_DAY04)[0];
      v6 = { ...v6, batches: { ...v6.batches, [BATCH_DAY04]: { archived: {}, drafts: { [r.key]: { value: 'draft' } } } } };
      const v5 = toV5(v6);
      const raw = JSON.stringify(v5);
      localStorage.setItem(SAVE_KEY, raw);

      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(5);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(save.chatReplies).toEqual({});
      expect(save.caseReviews).toEqual({});
      expect(save.waivedTasks).toEqual(WAIVED_THROUGH_DAY2);
      expect(save).toEqual({ ...JSON.parse(raw), version: 12, caseReviews: {}, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY, chatReplies: {}, waivedTasks: WAIVED_THROUGH_DAY2 });
      expect(save.batches).toEqual(v5.batches);
      expect(save.taskProgress).toEqual(v5.taskProgress);
      expect(save.events).toEqual(v5.events);
      expect(save.readMessages).toEqual(['msg.day1.welcome', 'msg.day3.lunch-order']);
      expect(save.night).toEqual(v5.night!);
      expect(save.seed).toBe(v5.seed);
      expect(save.dayId).toBe(DAY_04);
      expect(save.stage).toBe('work');
      expect(save.taskId).toBe(v5.taskId);
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      // load() 本身不寫檔
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('v5 Day 6 end（欄位映射已提交）→ migratedFrom 5，taskProgress 原樣', () => {
      const v6 = legacyV6Wrap(DAY_06);
      const v5 = toV5(v6);
      localStorage.setItem(SAVE_KEY, JSON.stringify(v5));
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(5);
      expect(loaded.save).toEqual({ ...v6, version: 12, caseReviews: {}, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY, chatReplies: {}, waivedTasks: WAIVED_THROUGH_DAY6 });
      expect(loaded.save!.stage).toBe('end');
    });

    it('寫回後再載入 → migratedFrom 11，不會再次遷移', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(toV5(legacyV6At(DAY_03))));
      const first = repo.load();
      expect(first.migratedFrom).toBe(5);
      expect(first.save!.waivedTasks).toEqual(WAIVED_THROUGH_DAY2);
      expect(repo.persist(first.save!)).toBe('');
      const second = repo.load();
      expect(second.migratedFrom).toBe(12);
      expect(JSON.stringify(second.save)).toBe(JSON.stringify(first.save!));
    });

    it('v5 本體不合法（dayId／taskId 矛盾、有下一日卻 end）→ 讀取失敗且不覆蓋', () => {
      const day2Wrap = toV5(legacyV6Wrap(DAY_02));
      for (const bad of [{ ...toV5(toV6(createSave(1, DAY_DIRECTORY))), taskId: TASK_DAY2 }, { ...day2Wrap, stage: 'end' }]) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });
  });

  /* ---------- v4 → v11 ---------- */

  describe('v4 舊檔遷移', () => {
    it('v4 Day 2 end（當時最後一天）→ migratedFrom 4、v11 Day 2 wrap，evidence／reply 移進 taskProgress，Day 1／2 新工作免補', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV4Day2End));
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(4);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(save.returns).toEqual([]);
      expect(save.issueSchedule).toEqual({});
      expect(save.mailbox).toEqual([]);
      expect(save.readMail).toEqual([]);
      expect(save.onboarding).toEqual({ step: 0, complete: true });
      expect(save.chatReplies).toEqual({});
      expect(save.caseReviews).toEqual({});
      expect(save.waivedTasks).toEqual(WAIVED_THROUGH_DAY2);
      expect(save.dayId).toBe(DAY_02);
      expect(save.stage).toBe('wrap');
      expect(save.taskId).toBe(TASK_DAY2);
      expect(save.taskProgress).toEqual({
        [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'review' },
      });
      const raw = save as unknown as Record<string, unknown>;
      expect(raw['evidence']).toBeUndefined();
      expect(raw['reply']).toBeUndefined();
      expect(save.batches).toEqual(legacyV4Day2End.batches);
      expect(save.night).toEqual(legacyV4Day2End.night!);
      expect(save.events).toEqual(legacyV4Day2End.events);
      expect(save.readMessages).toEqual(['msg.a', 'msg.b']);
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
    });

    it('轉出的 Day 2 wrap 可直接接 Day 3 morning，night 不重擲；沒有審查處置 → 不產生退件', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV4Day2End));
      const next = advanceDay(repo.load().save!, DAY_DIRECTORY);
      expect(next.returns).toEqual([]);
      expect(next.dayId).toBe(DAY_03);
      expect(next.stage).toBe('morning');
      expect(next.taskId).toBe(TASK_DAY3);
      expect(next.night).toEqual(legacyV4Day2End.night!);
      expect(next.events).toEqual(legacyV4Day2End.events);
      expect(isValidSave(next, DAY_DIRECTORY)).toBeTrue();
      expect(startDay(next).stage).toBe('work');
    });

    it('v4 Day 1 work → migratedFrom 4，預設 evidence 捨棄、taskProgress 為空、不免補，批次與已讀保留（v11、returns 空）', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV4Day1));
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(4);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(save.chatReplies).toEqual({});
      expect(save.caseReviews).toEqual({});
      expect(save.waivedTasks).toEqual([]);
      expect(save.dayId).toBe(DAY_01);
      expect(save.stage).toBe('work');
      expect(save.taskProgress).toEqual({});
      expect(save.batches).toEqual(legacyV4Day1.batches);
      expect(save.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
      expect(save.readMessages).toEqual(['msg.a']);
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
    });

    it('load() 不寫檔；寫回後再載入 → migratedFrom 11', () => {
      const raw = JSON.stringify(legacyV4Day2End);
      localStorage.setItem(SAVE_KEY, raw);
      const first = repo.load();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      expect(repo.persist(first.save!)).toBe('');
      const second = repo.load();
      expect(second.migratedFrom).toBe(12);
      expect(second.save).toEqual(JSON.parse(JSON.stringify(first.save!)));
      expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).version).toBe(12);
    });

    it('v4 的 taskId 以目錄重新查得（舊值不採信）；dayId 不在目錄 → 讀取失敗且不覆蓋', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...legacyV4Day1, taskId: TASK_DAY2 }));
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(4);
      expect(loaded.save!.taskId).toBe(TASK_DAY1);

      const raw = JSON.stringify({ ...legacyV4Day1, dayId: 'day.99' });
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('v4 不可能有 morning 階段 → 讀取失敗且不覆蓋', () => {
      const raw = JSON.stringify({ ...legacyV4Day2End, stage: 'morning' });
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('R10：v4 目前批次的 B102 為 "102"（格式合法、與來源不同）→ 照樣轉換、原樣保留，不當成毀損存檔', () => {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ ...legacyV4Day1, batches: { [BATCH_DAY01]: { archived: { B102: { ...archivedAll['B102'], archiveCode: '102' } }, drafts: {} } } }),
      );
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(4);
      expect(loaded.save!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
      expect(loaded.save!.batches[BATCH_DAY01]!.archived['B102']!.source.code).toBe('0102');
    });

    it('v4 目前批次的編號型別不合法（數字 102、空白）→ 讀取失敗且不覆蓋', () => {
      for (const archiveCode of [102, '', '   ', null]) {
        const raw = JSON.stringify({
          ...legacyV4Day1,
          batches: { [BATCH_DAY01]: { archived: { B102: { ...archivedAll['B102'], archiveCode } }, drafts: {} } },
        });
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(JSON.stringify(archiveCode)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });
  });

  /* ---------- v3 → v11 ---------- */

  describe('v3 舊檔遷移', () => {
    it('合法 v3（overnight）→ migratedFrom 3、v11 day.01／wrap（補入批次免補），批次與已讀原樣保留', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV3Overnight));
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(3);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(save.chatReplies).toEqual({});
      expect(save.caseReviews).toEqual({});
      expect(save.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      expect(save.dayId).toBe(DAY_01);
      expect(save.stage).toBe('wrap');
      expect(save.taskId).toBe(TASK_DAY1);
      expect(save.seed).toBe(9);
      expect(save.taskProgress).toEqual({});
      expect(save.batches).toEqual(legacyV3Overnight.batches);
      expect(save.readMessages).toEqual(['msg.a', 'msg.b']);
      expect(save.events).toEqual(legacyV3Overnight.events);
      expect(save.night).toBeUndefined();
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      const morning = advanceDay(save, DAY_DIRECTORY);
      expect([morning.dayId, morning.stage, morning.taskId]).toEqual([DAY_02, 'morning', TASK_DAY2]);
    });

    it('合法 v3（end）→ v11 day.02／wrap（Day 2 已有下一日），night 保留、reply 進 taskProgress', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV3End));
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(3);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(save.chatReplies).toEqual({});
      expect(save.caseReviews).toEqual({});
      expect(save.waivedTasks).toEqual(WAIVED_THROUGH_DAY2);
      expect(save.dayId).toBe(DAY_02);
      expect(save.stage).toBe('wrap');
      expect(save.taskId).toBe(TASK_DAY2);
      expect(save.night).toEqual(legacyV3End.night!);
      expect(save.taskProgress).toEqual({
        [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false, reply: 'ack' },
      });
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
    });

    it('load() 不寫檔；寫回後再載入 → migratedFrom 11', () => {
      const raw = JSON.stringify(legacyV3End);
      localStorage.setItem(SAVE_KEY, raw);
      const first = repo.load();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      repo.persist(first.save!);
      expect(repo.load().migratedFrom).toBe(12);
      expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).version).toBe(12);
    });

    for (const [name, legacy] of [
      ['Day 1 overnight', legacyV3Overnight],
      ['Day 2 end（核對所看的來源批次）', legacyV3End],
    ] as const) {
      it(`R10：v3（${name}）B102 為 "102" → 照樣轉換、原樣保留；型別不合法（數字、空白）→ 讀取失敗且不覆蓋`, () => {
        const withCode = (archiveCode: unknown) =>
          JSON.stringify({ ...legacy, batches: { [BATCH_DAY01]: { archived: { ...archivedAll, B102: { ...archivedAll['B102'], archiveCode } }, drafts: {} } } });
        localStorage.setItem(SAVE_KEY, withCode('102'));
        const loaded = repo.load();
        expect(loaded.issue).toBe('');
        expect(loaded.migratedFrom).toBe(3);
        expect(loaded.save!.version).toBe(12);
        expect(loaded.save!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
        for (const bad of [102, ' ']) {
          const raw = withCode(bad);
          localStorage.setItem(SAVE_KEY, raw);
          expect(repo.load()).withContext(raw.slice(0, 60)).toEqual(READ_FAIL);
          expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
        }
      });
    }

    it('v3 Day 1 未完成卻已 end → 讀取失敗（前一日第一件工作必須真的完成）', () => {
      const raw = JSON.stringify({
        ...legacyV3End,
        batches: { [BATCH_DAY01]: { archived: { H17: archivedAll['H17'] }, drafts: {} } },
      });
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });
  });

  /* ---------- v2 → v11 ---------- */

  describe('v2 舊檔遷移', () => {
    it('合法 v2 → migratedFrom 2、v11 day.02／work／核對工作，內容進到 Day 1 批次、evidence 進 taskProgress', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day2));
      const loaded = repo.load();

      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(2);
      expect(loaded.save).not.toBeNull();
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(save.chatReplies).toEqual({});
      expect(save.caseReviews).toEqual({});
      expect(save.waivedTasks).toEqual([TASK_DAY1_FOLLOWUP]);
      expect(save.dayId).toBe(DAY_02);
      expect(save.stage).toBe('work');
      expect(save.taskId).toBe(TASK_DAY2);
      const raw = save as unknown as Record<string, unknown>;
      expect(raw['phase']).toBeUndefined();
      expect(raw['evidence']).toBeUndefined();
      expect(save.seed).toBe(42);
      expect(save.readMessages).toEqual([]);
      expect(save.night).toEqual(legacyV2Day2.night!);
      expect(save.taskProgress).toEqual({ [TASK_DAY2]: { kind: 'reconcile', reportOpened: true, receiptOpened: false } });
      expect(save.events).toEqual(legacyV2Day2.events);

      const batch = save.batches[BATCH_DAY01]!;
      expect(Object.keys(batch.archived).sort()).toEqual(['B102', 'B607', 'H17']);
      expect(batch.archived['B102']!.archiveCode).toBe('0102');
      expect(typeof batch.archived['B102']!.archiveCode).toBe('string');
      expect(batch.archived['B102']!.source).toEqual({ name: null, code: '0102', refusal: null, refusalApplies: true });
      expect(batch.drafts).toEqual({ B102: { value: '0102', policy: 'default_false' } });
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();

      // 逐筆審查、回覆後接 Day 2 新件歸檔，不會卡住（舊檔沒有處置，不補造放行）
      expect(submitReply(save, DAY_DIRECTORY, 'ack')).toBe(save);
      const reviewed = setRecordReview(setRecordReview(save, DAY_DIRECTORY, 'B102', 'release'), DAY_DIRECTORY, 'B607', 'release');
      const replied = submitReply(reviewed, DAY_DIRECTORY, 'ack');
      expect([replied.stage, replied.taskId]).toEqual(['work', TASK_DAY2_ARCHIVE]);
      expect(isValidSave(replied, DAY_DIRECTORY)).toBeTrue();
    });

    it('day1 的 v2 舊檔也會轉換：day.01／work／歸檔工作，不免補', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day1));
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(2);
      expect(loaded.save!.version).toBe(12);
      expect(loaded.save!.chatReplies).toEqual({});
      expect(loaded.save!.caseReviews).toEqual({});
      expect(loaded.save!.waivedTasks).toEqual([]);
      expect(loaded.save!.dayId).toBe(DAY_01);
      expect(loaded.save!.stage).toBe('work');
      expect(loaded.save!.taskId).toBe(TASK_DAY1);
      expect(loaded.save!.taskProgress).toEqual({});
      expect(loaded.save!.batches[BATCH_DAY01]!.drafts).toEqual({ H17: { value: 'H-1' } });
      expect(loaded.save!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0102');
    });

    it('load() 本身不寫檔：localStorage 仍是原本的 v2 字串（由呼叫端決定何時寫回）', () => {
      const raw = JSON.stringify(legacyV2Day2);
      localStorage.setItem(SAVE_KEY, raw);
      repo.load();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });

    it('寫回轉換結果後再載入 → migratedFrom 11，不會再次遷移', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify(legacyV2Day2));
      const first = repo.load();
      expect(first.migratedFrom).toBe(2);
      expect(repo.persist(first.save!)).toBe('');

      const second = repo.load();
      expect(second.migratedFrom).toBe(12);
      expect(second.issue).toBe('');
      expect(second.save).toEqual(JSON.parse(JSON.stringify(first.save!)));
      expect(JSON.stringify(second.save)).toBe(JSON.stringify(first.save!));
    });

    it('R10：v2 的 B102 為 "102"（與來源不同但格式合法）→ 照樣轉換、原樣保留，來源快照仍是 0102', () => {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...legacyV2Day1, archived: { B102: { archiveCode: '102', refusal: false, origin: 'defaulted' } } }));
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(2);
      expect(loaded.save!.version).toBe(12);
      expect(loaded.save!.batches[BATCH_DAY01]!.archived['B102']).toEqual({
        archiveCode: '102',
        refusal: false,
        origin: 'defaulted',
        source: { name: null, code: '0102', refusal: null, refusalApplies: true },
      });
    });

    it('v2 編號型別不合法（數字 102、空白）→ 不轉換，讀取失敗且原字串不被覆蓋', () => {
      for (const archiveCode of [102, '  ']) {
        const broken = JSON.stringify({ ...legacyV2Day1, archived: { B102: { archiveCode, refusal: false, origin: 'defaulted' } } });
        localStorage.setItem(SAVE_KEY, broken);
        expect(repo.load()).withContext(broken).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(broken);
      }
    });
  });

  /* ---------- R10／R11：v8 → v11、文件問題案件（returns）、v9 → v11、編號只驗型別 ---------- */

  describe('v8 舊檔遷移（R10：補空 returns，不補造審查處置）', () => {
    function loadV8(v8: SaveV8): Save {
      expect(v8.version).toBe(8);
      expect('returns' in v8).toBeFalse();
      const raw = JSON.stringify(v8);
      localStorage.setItem(SAVE_KEY, raw);
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(8);
      const save = loaded.save!;
      expect(save).toEqual({ ...JSON.parse(raw), version: 12, returns: [], issueSchedule: {}, ...V11_MIGRATED_EMPTY });
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      // load() 不寫檔；寫回後再載入 → 11，不再遷移
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      expect(repo.persist(save)).toBe('');
      const again = repo.load();
      expect(again.migratedFrom).toBe(12);
      expect(JSON.stringify(again.save)).toBe(JSON.stringify(save));
      return save;
    }

    it('v8 Day 3 work（Day 2 已回覆、沒有審查處置）→ v11 returns []，其餘逐字保留；可接著完成並跨到 Day 4，Day 4 只剩原歸檔工作', () => {
      const v8 = toV8(playTo(DAY_03));
      expect((v8.taskProgress[TASK_DAY2] as unknown as Record<string, unknown>)['reviews']).toBeUndefined();
      let s = loadV8(v8);
      s = finishDay(s, DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      s = advanceDay(s, DAY_DIRECTORY);
      expect([s.dayId, s.stage, s.taskId]).toEqual([DAY_04, 'morning', TASK_DAY4]);
      expect(s.returns).toEqual([]);
      s = finishDay(s, DAY_DIRECTORY);
      expect(s.stage).toBe('wrap');
      expect(s.events.filter((e) => e.kind === 'task.complete').map((e) => (e.payload as { taskId: string }).taskId)).not.toContain(TASK_DAY4_RETURN);
      expect(isValidSave(s, DAY_DIRECTORY)).toBeTrue();
    });

    it('v8 已完成 Day 2、B102 為 "102" 但沒有審查處置 → 載入成功；跨到 Day 3 不補造退件', () => {
      const s = loadV8(toV8(day2WrapWith('102')));
      expect(s.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
      const day3 = advanceDay(s, DAY_DIRECTORY);
      expect(day3.dayId).toBe(DAY_03);
      expect(day3.returns).toEqual([]);
      expect(day3.events.some((e) => e.kind === 'return.notified')).toBeFalse();
      expect(isValidSave(day3, DAY_DIRECTORY)).toBeTrue();
    });

    it('v8 Day 2 work 核對中（目前批次 B102 為 "102"）→ 載入成功（格式合法的不同編號不是毀損存檔）', () => {
      const day2 = markReportOpened(playTo(DAY_02), DAY_DIRECTORY);
      const v8 = toV8({
        ...day2,
        batches: {
          ...day2.batches,
          [BATCH_DAY01]: { ...day2.batches[BATCH_DAY01]!, archived: { ...day2.batches[BATCH_DAY01]!.archived, B102: { ...archivedAll['B102'], archiveCode: '102' } } },
        },
      });
      const s = loadV8(v8);
      expect(s.taskId).toBe(TASK_DAY2);
      expect(s.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
    });

    it('v8 形狀但本體不合法（dayId／taskId 矛盾、帶了空白編號）→ 讀取失敗且不覆蓋', () => {
      const v8 = toV8(playTo(DAY_03));
      const blank = {
        ...v8,
        batches: { ...v8.batches, [BATCH_DAY01]: { ...v8.batches[BATCH_DAY01]!, archived: { ...v8.batches[BATCH_DAY01]!.archived, B102: { ...archivedAll['B102'], archiveCode: ' ' } } } },
      };
      for (const bad of [{ ...v8, taskId: TASK_DAY2 }, blank, { ...v8, caseReviews: null }]) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw.slice(0, 80)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('v2～v8 每一條遷移鏈都停在 v11（returns／issueSchedule／mailbox／readMail 空、入職已完成），且寫回後不再遷移', () => {
      const samples: [number, unknown][] = [
        [2, legacyV2Day2],
        [3, legacyV3End],
        [4, legacyV4Day2End],
        [5, toV5(legacyV6At(DAY_03))],
        [6, legacyV6Wrap(DAY_02)],
        [7, legacyV7At(DAY_04)],
        [8, toV8(playTo(DAY_04))],
      ];
      for (const [from, legacy] of samples) {
        localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));
        const loaded = repo.load();
        expect(loaded.issue).withContext(`v${from}`).toBe('');
        expect(loaded.migratedFrom).withContext(`v${from}`).toBe(from as never);
        expect(loaded.save!.version).withContext(`v${from}`).toBe(12);
        expect(loaded.save!.returns).withContext(`v${from}`).toEqual([]);
        expect(loaded.save!.issueSchedule).withContext(`v${from}`).toEqual({});
        expect(loaded.save!.mailbox).withContext(`v${from}`).toEqual([]);
        expect(loaded.save!.readMail).withContext(`v${from}`).toEqual([]);
        expect(loaded.save!.onboarding).withContext(`v${from}`).toEqual({ step: 0, complete: true });
        expect(loaded.save!.profile).withContext(`v${from}`).toEqual({ name: null });
        expect(isValidSave(loaded.save, DAY_DIRECTORY)).withContext(`v${from}`).toBeTrue();
        repo.persist(loaded.save!);
        expect(repo.load().migratedFrom).withContext(`v${from}`).toBe(12);
      }
    });
  });

  describe('v11 文件問題案件（day1-code-audit）', () => {
    /** 退件回條的郵件（不含 M1 延後回條）。 */
    const receiptMails = (save: Save) => save.mailbox.filter((m) => m.packId === 'mail.return-receipts');
    const RETURN_ID = 'return.day1-code-audit.B102';
    const TASK_DAY6_ISSUE = 'task.day6.return-review';
    const rid = (n: number) => `${RETURN_ID}#${n}`;
    const RECEIPT0: ReturnReceipt = { id: rid(0), kind: 'returned', dayId: DAY_03, versionIndex: null, code: '102', reason: 'code-mismatch' };

    /** Day 3 morning：B102 以 "102" 提交、Day 2 放行 → 通知日建立一個待修正案件。 */
    function day3WithReturn(): Save {
      const s = advanceDay(day2WrapWith('102'), DAY_DIRECTORY);
      expect(s.returns.map((r) => r.id)).toEqual([RETURN_ID]);
      return s;
    }

    /** Day 4 work，原歸檔工作已交付、目前是錯誤文件處理。 */
    function day4OnIssueTask(): Save {
      let s = startDay(advanceDay(finishDay(day3WithReturn(), DAY_DIRECTORY), DAY_DIRECTORY));
      expect(s.taskId).toBe(TASK_DAY4);
      s = completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
      expect(s.taskId).toBe(TASK_DAY4_RETURN);
      return s;
    }

    /** Day 4 錯誤文件處理重送指定編號 → 完成當日其餘工作（M1：附件關聯、批次轉換）→ 交接 → 進入 Day 5（morning，下游已核對一次）。 */
    function day5After(code: string): Save {
      const wrap = finishDay(completeWork(resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, code, rid(0)), DAY_DIRECTORY), DAY_DIRECTORY);
      expect(wrap.stage).toBe('wrap');
      return advanceDay(wrap, DAY_DIRECTORY);
    }

    function roundTrip(save: Save): void {
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      expect(repo.persist(save)).toBe('');
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(12);
      expect(loaded.save).toEqual(save);
    }

    it('Day 3（通知日）、Day 4 錯誤文件處理中、重送／送窗口後、Day 4 wrap → 都原樣讀回；原提交保留、版本只附加', () => {
      const day3 = day3WithReturn();
      roundTrip(day3);
      expect(day3.returns[0]).toEqual(
        jasmine.objectContaining({ sourceCode: '0102', submittedCode: '102', reviewedCode: '102', status: 'pending', dueDayId: DAY_04, versions: [] }),
      );
      expect(day3.returns[0].receipts).toEqual([RECEIPT0]);
      expect(day3.issueSchedule).toEqual({});
      expect(day3.mailbox.map((m) => m.id)).toEqual([`mail.${rid(0)}`]);
      expect(day3.readMail).toEqual([]);
      const onIssue = day4OnIssueTask();
      expect(onIssue.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
      roundTrip(onIssue);
      const resubmitted = resubmitReturn(onIssue, DAY_DIRECTORY, RETURN_ID, '103', rid(0));
      expect(resubmitted.returns[0].status).toBe('awaiting-check');
      expect(resubmitted.returns[0].versions).toEqual([{ index: 0, action: 'resubmit', code: '103', dayId: DAY_04, checkDayId: DAY_05 }]);
      expect(resubmitted.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('102');
      roundTrip(resubmitted);
      const windowed = sendReturnToWindow(onIssue, DAY_DIRECTORY, RETURN_ID, rid(0));
      expect(windowed.returns[0].status).toBe('awaiting-window');
      expect(windowed.returns[0].versions).toEqual([{ index: 0, action: 'window', code: '102', dayId: DAY_04, checkDayId: null }]);
      roundTrip(windowed);
      const wrap = finishDay(completeWork(resubmitted, DAY_DIRECTORY), DAY_DIRECTORY);
      expect(wrap.stage).toBe('wrap');
      roundTrip(wrap);
      roundTrip(finishDay(completeWork(windowed, DAY_DIRECTORY), DAY_DIRECTORY));
    });

    it('排定日之後才再次退回：Day 5 再次退回（前一天的錯誤文件處理仍算已交付）、Day 5 從文件問題頁重送、Day 6 第三次退回、Day 6 end → 都合法且原樣讀回', () => {
      const day5 = day5After('103');
      expect(day5.returns[0]).toEqual(jasmine.objectContaining({ status: 'pending', dueDayId: DAY_06 }));
      expect(day5.returns[0].receipts.map((r) => [r.kind, r.dayId, r.versionIndex])).toEqual([
        ['returned', DAY_03, null],
        ['returned', DAY_05, 0],
      ]);
      expect(day5.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
      roundTrip(day5);
      const day5Work = startDay(day5);
      roundTrip(day5Work);
      // 目前工作是 Day 5 歸檔（不是錯誤文件處理）也能從文件問題頁重送
      const day5Again = resubmitReturn(day5Work, DAY_DIRECTORY, RETURN_ID, '0103', rid(1));
      expect(day5Again.taskId).toBe(TASK_DAY5);
      expect(day5Again.returns[0].versions[1]).toEqual({ index: 1, action: 'resubmit', code: '0103', dayId: DAY_05, checkDayId: DAY_06 });
      roundTrip(day5Again);
      const day5Wrap = finishDay(day5Again, DAY_DIRECTORY);
      expect(day5Wrap.stage).toBe('wrap');
      roundTrip(day5Wrap);
      const day6 = advanceDay(day5Wrap, DAY_DIRECTORY);
      expect(day6.returns[0]).toEqual(jasmine.objectContaining({ status: 'pending', dueDayId: null }));
      expect(day6.returns[0].receipts.map((r) => [r.kind, r.dayId, r.versionIndex])).toEqual([
        ['returned', DAY_03, null],
        ['returned', DAY_05, 0],
        ['returned', DAY_06, 1],
      ]);
      expect(day6.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
      roundTrip(day6);
      const end = finishDay(day6, DAY_DIRECTORY);
      expect(end.stage).toBe('end');
      expect(end.returns[0].status).toBe('pending');
      roundTrip(end);
    });

    it('Day 5 再次退回、Day 5 未處理 → Day 6 排入虛擬 task.day6.return-review；最後一天重送 checkDayId null，結束仍待核對；都原樣讀回', () => {
      const day5Wrap = finishDay(day5After('103'), DAY_DIRECTORY);
      expect(day5Wrap.returns[0].status).toBe('pending');
      roundTrip(day5Wrap);
      const day6 = advanceDay(day5Wrap, DAY_DIRECTORY);
      expect(day6.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID], [DAY_06]: [RETURN_ID] });
      expect([day6.stage, day6.taskId]).toEqual(['morning', TASK_DAY6]);
      roundTrip(day6);
      let s = finishTask(startDay(day6), DAY_DIRECTORY);
      expect([s.stage, s.taskId]).toEqual(['work', TASK_DAY6_ISSUE]);
      roundTrip(s);
      s = resubmitReturn(s, DAY_DIRECTORY, RETURN_ID, '0102', rid(1));
      expect(s.returns[0].versions[1]).toEqual({ index: 1, action: 'resubmit', code: '0102', dayId: DAY_06, checkDayId: null });
      roundTrip(s);
      // M1：Day 6 還有交付報告；完成後才結束
      s = finishDay(completeWork(s, DAY_DIRECTORY), DAY_DIRECTORY);
      expect(s.stage).toBe('end');
      expect(s.returns[0].status).toBe('awaiting-check');
      roundTrip(s);
    });

    it('正確修訂 0102 → Day 5 下游核對一致才結案（收件回條＋收件郵件）；已讀郵件保存後原樣讀回', () => {
      const day5 = day5After('0102');
      expect(day5.returns[0].status).toBe('resolved');
      expect(day5.returns[0].receipts[1]).toEqual({ id: rid(1), kind: 'resolved', dayId: DAY_05, versionIndex: 0, code: '0102', reason: null });
      // 退件回條的郵件（M1 延後回條另寄，不影響這兩封）
      expect(receiptMails(day5).map((m) => [m.id, m.templateId, m.dayId])).toEqual([
        [`mail.${rid(0)}`, 'returned', DAY_03],
        [`mail.${rid(1)}`, 'resolved', DAY_05],
      ]);
      roundTrip(day5);
      const read = markMailRead(day5, [`mail.${rid(0)}`, `mail.${rid(1)}`]);
      roundTrip(read);
      expect(repo.load().save!.readMail).toEqual([`mail.${rid(0)}`, `mail.${rid(1)}`]);
    });

    it('R12 欄位（修訂草稿、提問、簽名與入職）保存後原樣讀回', () => {
      const onIssue = day4OnIssueTask();
      const withDraft: Save = { ...onIssue, issueDrafts: { [rid(0)]: '01 02' } };
      roundTrip(withDraft);
      const asked = requestHelp(onIssue, 'request.refusal-record', 1_700_000_000_000, [
        { messageId: 'msg.help.refusal.meaning', at: 1_700_000_003_000 },
        { messageId: 'msg.help.refusal.paths', at: 1_700_000_007_000 },
      ]);
      expect(asked).not.toBe(onIssue);
      roundTrip(asked);
      expect(repo.load().save!.helpRequests['request.refusal-record']).toEqual({
        dayId: DAY_04,
        askedAt: 1_700_000_000_000,
        deliveries: [
          { messageId: 'msg.help.refusal.meaning', at: 1_700_000_003_000 },
          { messageId: 'msg.help.refusal.paths', at: 1_700_000_007_000 },
        ],
      });
      roundTrip({ ...onIssue, profile: { name: '陳 小安' }, onboarding: { step: 7, complete: true } });
    });

    /* ---------- R12：v10 → v11 ---------- */

    it('v10 舊檔（Day 5、兩張退件回條、第一張已讀）→ migratedFrom 10、v11：每份回條一封郵件（依回條日、固定 ID）、readIssueReceipts → readMail、案件／版本／排程原樣；角色 null、入職已完成；load() 不寫檔，寫回後 11', () => {
      const native = startDay(day5After('103'));
      const read = markMailRead(native, [`mail.${rid(0)}`]);
      const v10 = toV10(read);
      expect(v10.version).toBe(10);
      expect(v10.readIssueReceipts).toEqual([rid(0)]);
      expect('mailbox' in v10).toBeFalse();
      const raw = JSON.stringify(v10);
      localStorage.setItem(SAVE_KEY, raw);
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(10);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      // v10 沒有 M1 延後回條：遷移只由退件回條重建郵件
      expect(save).toEqual({ ...read, mailbox: receiptMails(read), onboarding: { step: 0, complete: true } });
      expect(save.mailbox).toEqual(receiptMails(native));
      expect(save.mailbox).toEqual([
        {
          id: `mail.${rid(0)}`,
          packId: 'mail.return-receipts',
          templateId: 'returned',
          dayId: DAY_03,
          attachments: [{ kind: 'return-receipt', caseId: RETURN_ID, receiptId: rid(0), versionIndex: null }],
        },
        {
          id: `mail.${rid(1)}`,
          packId: 'mail.return-receipts',
          templateId: 'returned',
          dayId: DAY_05,
          attachments: [{ kind: 'return-receipt', caseId: RETURN_ID, receiptId: rid(1), versionIndex: 0 }],
        },
      ]);
      expect(save.readMail).toEqual([`mail.${rid(0)}`]);
      expect(save.returns).toEqual(v10.returns);
      expect(save.issueSchedule).toEqual(v10.issueSchedule);
      expect(save.events).toEqual(v10.events);
      expect(save.profile).toEqual({ name: null });
      expect(save.onboarding).toEqual({ step: 0, complete: true });
      expect(save.helpRequests).toEqual({});
      expect(save.issueDrafts).toEqual({});
      expect('readIssueReceipts' in save).toBeFalse();
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      expect(repo.persist(save)).toBe('');
      const again = repo.load();
      expect(again.migratedFrom).toBe(12);
      expect(JSON.stringify(again.save)).toBe(JSON.stringify(save));
    });

    it('v10 舊檔的回覆快照（沒有送達時間）→ 回應 ID 併入已讀歷史（已讀過的不重複），快照原樣保留', () => {
      let s = playTo(DAY_03);
      s = answerChat(s, 'prompt.day3.lunch-plan', {
        id: 'join',
        text: '好啊',
        responses: [
          { id: 'msg.x.a', actorId: 'actor.wu-wan-ting', time: '12:01', lines: ['一起'] },
          { id: 'msg.x.b', actorId: 'actor.wu-wan-ting', time: '12:02', lines: ['走'] },
        ],
      });
      s = markMessagesRead(s, ['msg.x.b']);
      const v10 = toV10(s);
      localStorage.setItem(SAVE_KEY, JSON.stringify(v10));
      const loaded = repo.load();
      expect(loaded.migratedFrom).toBe(10);
      expect(loaded.save!.readMessages).toEqual([...s.readMessages, 'msg.x.a']);
      expect(loaded.save!.readMessages).toEqual(legacyReadMessages(s.readMessages, s.chatReplies));
      expect(loaded.save!.chatReplies).toEqual(s.chatReplies);
      expect(loaded.save!.mailbox).toEqual([]);
    });

    it('v10 舊檔的 readIssueReceipts 不合法（未知回條、重複、缺少）→ 讀取失敗且不覆蓋', () => {
      const v10 = toV10(day4OnIssueTask());
      const { readIssueReceipts: _r, ...noRead } = v10;
      const bads: [string, unknown][] = [
        ['未知回條', { ...v10, readIssueReceipts: ['return.x#0'] }],
        ['重複', { ...v10, readIssueReceipts: [rid(0), rid(0)] }],
        ['缺少', noRead],
      ];
      for (const [name, bad] of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(name).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).withContext(name).toBe(raw);
      }
    });

    it('returns 結構、追蹤引用、狀態轉移或回條不合法 → 讀取失敗且不覆蓋', () => {
      const day3 = day3WithReturn();
      const ret = day3.returns[0];
      const withReturns = (returns: unknown) => ({ ...day3, returns });
      const withEntry = (patch: Record<string, unknown>) => withReturns([{ ...ret, ...patch }]);
      const { returns: _drop, ...missing } = day3;
      const day4 = resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, '103', rid(0));
      const r4 = day4.returns[0];
      const withDay4Entry = (patch: Record<string, unknown>) => ({ ...day4, returns: [{ ...r4, ...patch }] });
      const day5 = day5After('103');
      const r5 = day5.returns[0];
      const withDay5Entry = (patch: Record<string, unknown>) => ({ ...day5, returns: [{ ...r5, ...patch }] });
      const heldReview = {
        ...day3,
        taskProgress: {
          ...day3.taskProgress,
          [TASK_DAY2]: {
            ...(day3.taskProgress[TASK_DAY2] as object),
            reviews: {
              ...(day3.taskProgress[TASK_DAY2] as unknown as { reviews: object }).reviews,
              B102: { ...(day3.taskProgress[TASK_DAY2] as unknown as { reviews: Record<string, object> }).reviews['B102'], disposition: 'hold' },
            },
          },
        },
      };
      const unchecked = { index: 0, action: 'resubmit', code: '103', dayId: DAY_03, checkDayId: DAY_04 };
      const bads: [string, unknown][] = [
        ['returns 缺少', missing],
        ['returns null', withReturns(null)],
        ['returns 物件', withReturns({})],
        ['entry null', withReturns([null])],
        ['id 不穩定', withEntry({ id: 'return.x' })],
        ['未知稽核', withEntry({ auditId: 'nope-audit', id: 'return.nope-audit.B102' })],
        ['紀錄不在稽核範圍（H17）', withEntry({ recordKey: 'H17', id: 'return.day1-code-audit.H17' })],
        ['同一案複製成兩件', withReturns([ret, ret])],
        ['通知日不符', withEntry({ notifyDayId: DAY_04 })],
        ['核對工作不符', withEntry({ reviewTaskId: TASK_DAY2_ARCHIVE })],
        ['批次不符', withEntry({ batchId: BATCH_DAY02 })],
        ['archiveTaskId 非字串', withEntry({ archiveTaskId: 1 })],
        ['submittedCode 空白', withEntry({ submittedCode: '  ' })],
        ['reviewedCode 非字串', withEntry({ reviewedCode: 102 })],
        ['所看版本與來源相同', withEntry({ reviewedCode: '0102' })],
        ['處置不是放行', withEntry({ disposition: 'hold' })],
        ['退件依據未知', withEntry({ reason: 'other' })],
        ['狀態未知', withEntry({ status: 'lost' })],
        ['v9 的狀態名稱 resubmitted', withEntry({ status: 'resubmitted' })],
        ['dueDayId 未知日', withEntry({ dueDayId: 'day.99' })],
        ['待核對卻沒有版本', withEntry({ status: 'awaiting-check', dueDayId: null })],
        ['已解決卻沒有下游核對', withEntry({ status: 'resolved', dueDayId: null })],
        ['送出就算結案（resolved＋未核對版本）', withEntry({ status: 'resolved', dueDayId: null, versions: [unchecked] })],
        ['待修正卻有未核對的版本', withEntry({ versions: [unchecked] })],
        ['版本缺序號', withEntry({ status: 'awaiting-check', dueDayId: null, versions: [{ action: 'resubmit', code: '103', dayId: DAY_03, checkDayId: DAY_04 }] })],
        ['版本動作未知', withEntry({ status: 'awaiting-check', dueDayId: null, versions: [{ ...unchecked, action: 'fix' }] })],
        ['版本編號空白', withEntry({ status: 'awaiting-check', dueDayId: null, versions: [{ ...unchecked, code: ' ' }] })],
        ['版本日未知', withEntry({ status: 'awaiting-check', dueDayId: null, versions: [{ ...unchecked, dayId: 'day.99' }] })],
        ['版本日在未來', withEntry({ status: 'awaiting-check', dueDayId: null, versions: [{ ...unchecked, dayId: DAY_05, checkDayId: DAY_06 }] })],
        ['回條缺少', withEntry({ receipts: [] })],
        ['回條 ID 不穩定', withEntry({ receipts: [{ ...RECEIPT0, id: 'x' }] })],
        ['第一張回條不是對原提交的退件', withEntry({ receipts: [{ ...RECEIPT0, kind: 'resolved', reason: null }] })],
        ['退件回條沒有原因', withEntry({ receipts: [{ ...RECEIPT0, reason: null }] })],
        ['回條日在未來', withEntry({ receipts: [{ ...RECEIPT0, dayId: DAY_05 }] })],
        ['沒有核對卻多一張回條', withEntry({ receipts: [RECEIPT0, { ...RECEIPT0, id: rid(1), dayId: DAY_03, versionIndex: 0 }] })],
        ['待核對卻仍排入待辦日', withDay4Entry({ dueDayId: DAY_05 })],
        ['待核對的預定核對日已到', withDay4Entry({ versions: [{ ...r4.versions[0], checkDayId: DAY_04 }] })],
        ['送窗口版本帶核對日', withDay4Entry({ status: 'awaiting-window', versions: [{ ...r4.versions[0], action: 'window' }] })],
        ['核對結果沒有對應回條', withDay5Entry({ receipts: [r5.receipts[0]] })],
        ['回條種類與核對結果不符', withDay5Entry({ receipts: [r5.receipts[0], { ...r5.receipts[1], kind: 'resolved', reason: null }] })],
        ['回條編號與核對版本不符', withDay5Entry({ receipts: [r5.receipts[0], { ...r5.receipts[1], code: '0102' }] })],
        ['checkedDayId 與 checkDayId 不符', withDay5Entry({ versions: [{ ...r5.versions[0], checkedDayId: DAY_04 }] })],
        ['再次退回卻標成已解決', withDay5Entry({ status: 'resolved', dueDayId: null })],
        ['對應的第二輪審查其實是保留待查', heldReview],
        ['還沒到通知日（Day 2 wrap）就有退件', { ...day2WrapWith('102'), returns: [ret] }],
      ];
      for (const [name, bad] of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(name).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).withContext(name).toBe(raw);
      }
    });

    it('issueSchedule／mailbox／readMail／issueDrafts 不合法 → 讀取失敗且不覆蓋', () => {
      const day3 = day3WithReturn();
      const day4 = day4OnIssueTask();
      const { issueSchedule: _s, ...noSchedule } = day4;
      const { readMail: _r, ...noRead } = day4;
      const { mailbox: _m, ...noMailbox } = day4;
      const mail0 = day4.mailbox[0];
      const bads: [string, unknown][] = [
        ['issueSchedule 缺少', noSchedule],
        ['issueSchedule null', { ...day4, issueSchedule: null }],
        ['issueSchedule 陣列', { ...day4, issueSchedule: [] }],
        ['排程到未來的日子', { ...day3, issueSchedule: { [DAY_04]: [RETURN_ID] } }],
        ['排程未知日', { ...day4, issueSchedule: { ...day4.issueSchedule, 'day.99': [RETURN_ID] } }],
        ['排程引用不存在的案件', { ...day4, issueSchedule: { [DAY_04]: [RETURN_ID, 'return.day1-code-audit.B607'] } }],
        ['排程空清單', { ...day4, issueSchedule: { [DAY_04]: [] } }],
        ['排程重複', { ...day4, issueSchedule: { [DAY_04]: [RETURN_ID, RETURN_ID] } }],
        ['readMail 缺少', noRead],
        ['readMail null', { ...day4, readMail: null }],
        ['readMail 非字串', { ...day4, readMail: [1] }],
        ['readMail 重複', { ...day4, readMail: [mail0.id, mail0.id] }],
        ['readMail 未知郵件', { ...day4, readMail: ['mail.return.x#0'] }],
        ['readMail 用回條 ID（R11 寫法）', { ...day4, readMail: [rid(0)] }],
        ['mailbox 缺少', noMailbox],
        ['回條沒有郵件', { ...day4, mailbox: [] }],
        ['郵件重複', { ...day4, mailbox: [mail0, mail0] }],
        ['郵件模板與回條種類不符', { ...day4, mailbox: [{ ...mail0, templateId: 'resolved' }] }],
        ['郵件日與回條日不符', { ...day4, mailbox: [{ ...mail0, dayId: DAY_04 }] }],
        ['附件版本與回條不符', { ...day4, mailbox: [{ ...mail0, attachments: [{ ...mail0.attachments[0], versionIndex: 0 }] }] }],
        ['修訂草稿引用不存在的回條', { ...day4, issueDrafts: { 'return.x#0': '0102' } }],
      ];
      for (const [name, bad] of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(name).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).withContext(name).toBe(raw);
      }
    });

    it('目前工作是不適用的錯誤文件處理（當天沒有排程）、或排入的案件仍待修正卻已 wrap → 讀取失敗', () => {
      const onIssue = day4OnIssueTask();
      for (const bad of [{ ...onIssue, issueSchedule: {} }, { ...onIssue, stage: 'wrap' }]) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });

    it('逐筆審查的結構不合法（處置未知、recordKey 與鍵不符、所看編號空白）→ 讀取失敗', () => {
      const day3 = day3WithReturn();
      const p = day3.taskProgress[TASK_DAY2] as unknown as { reviews: Record<string, Record<string, unknown>> };
      const withReview = (patch: Record<string, unknown>) => ({
        ...day3,
        returns: [],
        taskProgress: { ...day3.taskProgress, [TASK_DAY2]: { ...p, reviews: { ...p.reviews, B607: { ...p.reviews['B607'], ...patch } } } },
      });
      for (const bad of [withReview({ disposition: 'maybe' }), withReview({ recordKey: 'B102' }), withReview({ reviewedCode: '' })]) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(raw.slice(-200)).toEqual(READ_FAIL);
      }
    });
  });

  describe('v9 舊檔遷移（R11：pending／resubmitted／window → 持續的文件問題）', () => {
    const RETURN_ID = 'return.day1-code-audit.B102';
    const rid = (n: number) => `${RETURN_ID}#${n}`;
    const RECEIPT0: ReturnReceipt = { id: rid(0), kind: 'returned', dayId: DAY_03, versionIndex: null, code: '102', reason: 'code-mismatch' };
    /** 案件不變的部分（第一次提交與第二輪放行的快照）。 */
    const BASE = {
      id: RETURN_ID,
      auditId: 'day1-code-audit',
      batchId: BATCH_DAY01,
      recordKey: 'B102',
      archiveTaskId: TASK_DAY1,
      reviewTaskId: TASK_DAY2,
      sourceCode: '0102',
      submittedCode: '102',
      reviewedCode: '102',
      disposition: 'release' as const,
      reason: 'code-mismatch' as const,
      notifyDayId: DAY_03,
    };

    /** 把現行存檔退回 R10 的 v9 形狀：退件只有 pending／resubmitted／window、複審日 returnDayId、沒有回條與排程（也沒有 R12 欄位）。 */
    function toV9(save: Save): SaveV9 {
      const { issueSchedule: _s, readIssueReceipts: _r, returns, version: _v, ...rest } = toV10(save);
      const legacy: LegacyReturnCaseV9[] = returns.map((r) => {
        const last = r.versions[r.versions.length - 1];
        return {
          id: r.id,
          auditId: r.auditId,
          batchId: r.batchId,
          recordKey: r.recordKey,
          archiveTaskId: r.archiveTaskId,
          reviewTaskId: r.reviewTaskId,
          sourceCode: r.sourceCode,
          submittedCode: r.submittedCode,
          reviewedCode: r.reviewedCode,
          disposition: r.disposition,
          reason: r.reason,
          notifyDayId: r.notifyDayId,
          returnDayId: DAY_04,
          status: !last ? 'pending' : last.action === 'resubmit' ? 'resubmitted' : 'window',
          versions: r.versions.map((v) => ({ action: v.action, code: v.code, dayId: v.dayId })),
        };
      });
      // v9 沒有下游核對，也沒有版本序號
      const events = rest.events
        .filter((e) => e.kind !== 'return.checked')
        .map((e) => {
          if (e.kind !== 'return.resubmit' && e.kind !== 'return.window') return e;
          const p = e.payload as { dayId: string; returnId: string };
          return { ...e, payload: { dayId: p.dayId, returnId: p.returnId } };
        });
      return { ...rest, version: 9, returns: legacy, events };
    }

    /** v9 → load()：經 v10 轉成 v11、通過現行驗證；load() 不寫檔，寫回後再載入是 v11、不再遷移。 */
    function loadV9(v9: SaveV9): Save {
      const raw = JSON.stringify(v9);
      localStorage.setItem(SAVE_KEY, raw);
      const loaded = repo.load();
      expect(loaded.issue).toBe('');
      expect(loaded.migratedFrom).toBe(9);
      const save = loaded.save!;
      expect(save.version).toBe(12);
      expect(isValidSave(save, DAY_DIRECTORY)).toBeTrue();
      // 舊事件與進度逐字保留；只有第一張退件回條（已讀），不偽造之後的回條或放行
      expect(save.events).toEqual(v9.events);
      expect(save.batches).toEqual(v9.batches);
      expect(save.taskProgress).toEqual(v9.taskProgress);
      expect([save.dayId, save.stage, save.taskId]).toEqual([v9.dayId, v9.stage, v9.taskId]);
      expect(save.returns.map((r) => r.receipts)).toEqual(v9.returns.map(() => [RECEIPT0]));
      // v9→v10 把第一張退件回條視為已讀；v10→v11 由回條寄出郵件並把已讀轉成郵件已讀
      expect(save.mailbox.map((m) => m.id)).toEqual(v9.returns.map((r) => `mail.${r.id}#0`));
      expect(save.readMail).toEqual(v9.returns.map((r) => `mail.${r.id}#0`));
      expect(save.onboarding).toEqual({ step: 0, complete: true });
      expect(save.profile).toEqual({ name: null });
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      expect(repo.persist(save)).toBe('');
      const again = repo.load();
      expect(again.migratedFrom).toBe(12);
      expect(JSON.stringify(again.save)).toBe(JSON.stringify(save));
      return save;
    }

    function day3WithReturn(): Save {
      return advanceDay(day2WrapWith('102'), DAY_DIRECTORY);
    }

    function day4OnIssueTask(): Save {
      const s = startDay(advanceDay(finishDay(day3WithReturn(), DAY_DIRECTORY), DAY_DIRECTORY));
      return completeWork(archiveCurrent(s, DAY_DIRECTORY, 'default_false'), DAY_DIRECTORY);
    }

    it('Day 3（複審日還沒到）pending → dueDayId day.04、還不排程；跨到 Day 4 才排入，不新增回條', () => {
      const s = loadV9(toV9(day3WithReturn()));
      expect(s.returns).toEqual([{ ...BASE, status: 'pending', dueDayId: DAY_04, versions: [], receipts: [RECEIPT0] }]);
      expect(s.issueSchedule).toEqual({});
      const day4 = advanceDay(finishDay(s, DAY_DIRECTORY), DAY_DIRECTORY);
      expect(day4.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
      expect(day4.returns[0].receipts).toEqual([RECEIPT0]);
      expect(isValidSave(day4, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 4 work、目前是複審且待處理 → pending（dueDayId day.04），當天排程引用它；可重送並在 Day 5 核對', () => {
      const s = loadV9(toV9(day4OnIssueTask()));
      expect(s.returns).toEqual([{ ...BASE, status: 'pending', dueDayId: DAY_04, versions: [], receipts: [RECEIPT0] }]);
      expect(s.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
      expect(s.taskId).toBe(TASK_DAY4_RETURN);
      const day5 = advanceDay(finishDay(completeWork(resubmitReturn(s, DAY_DIRECTORY, RETURN_ID, '0102', rid(0)), DAY_DIRECTORY), DAY_DIRECTORY), DAY_DIRECTORY);
      expect(day5.returns[0].status).toBe('resolved');
      expect(isValidSave(day5, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 4 wrap、resubmitted（103）→ awaiting-check，採最後保存版本、checkDayId day.05，不視為已解決；Day 5 核對 → 再次退回', () => {
      const wrap = finishDay(completeWork(resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, '103', rid(0)), DAY_DIRECTORY), DAY_DIRECTORY);
      const s = loadV9(toV9(wrap));
      expect(s.returns).toEqual([
        {
          ...BASE,
          status: 'awaiting-check',
          dueDayId: null,
          versions: [{ index: 0, action: 'resubmit', code: '103', dayId: DAY_04, checkDayId: DAY_05 }],
          receipts: [RECEIPT0],
        },
      ]);
      expect(s.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
      const day5 = advanceDay(s, DAY_DIRECTORY);
      expect(day5.returns[0]).toEqual(jasmine.objectContaining({ status: 'pending', dueDayId: DAY_06 }));
      expect(day5.returns[0].receipts.length).toBe(2);
      expect(isValidSave(day5, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 4 wrap、window → awaiting-window（未解決、沒有核對日）', () => {
      const wrap = finishDay(completeWork(sendReturnToWindow(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, rid(0)), DAY_DIRECTORY), DAY_DIRECTORY);
      const s = loadV9(toV9(wrap));
      expect(s.returns).toEqual([
        {
          ...BASE,
          status: 'awaiting-window',
          dueDayId: null,
          versions: [{ index: 0, action: 'window', code: '102', dayId: DAY_04, checkDayId: null }],
          receipts: [RECEIPT0],
        },
      ]);
      expect(s.issueSchedule).toEqual({ [DAY_04]: [RETURN_ID] });
    });

    it('Day 5（原核對日已過）resubmitted 0102 → awaiting-check、checkDayId 順延為 day.06（不因內容正確就結案）；Day 6 核對才結案', () => {
      const day5 = advanceDay(finishDay(completeWork(resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, '0102', rid(0)), DAY_DIRECTORY), DAY_DIRECTORY), DAY_DIRECTORY);
      const v9 = toV9(day5);
      expect([v9.dayId, v9.returns[0].status]).toEqual([DAY_05, 'resubmitted']);
      const s = loadV9(v9);
      expect(s.returns).toEqual([
        {
          ...BASE,
          status: 'awaiting-check',
          dueDayId: null,
          versions: [{ index: 0, action: 'resubmit', code: '0102', dayId: DAY_04, checkDayId: DAY_06 }],
          receipts: [RECEIPT0],
        },
      ]);
      const day6 = advanceDay(finishDay(s, DAY_DIRECTORY), DAY_DIRECTORY);
      expect(day6.returns[0].status).toBe('resolved');
      expect(day6.returns[0].receipts[1]).toEqual({ id: rid(1), kind: 'resolved', dayId: DAY_06, versionIndex: 0, code: '0102', reason: null });
      expect(isValidSave(day6, DAY_DIRECTORY)).toBeTrue();
    });

    it('Day 6 end（最後一天）resubmitted → awaiting-check、checkDayId null（不為結束畫面自動結案）', () => {
      const day5 = advanceDay(finishDay(completeWork(resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, '0102', rid(0)), DAY_DIRECTORY), DAY_DIRECTORY), DAY_DIRECTORY);
      const end = finishDay(startDay(advanceDay(finishDay(day5, DAY_DIRECTORY), DAY_DIRECTORY)), DAY_DIRECTORY);
      expect([end.dayId, end.stage]).toEqual([DAY_06, 'end']);
      const s = loadV9(toV9(end));
      expect(s.returns[0]).toEqual(
        jasmine.objectContaining({
          status: 'awaiting-check',
          dueDayId: null,
          versions: [{ index: 0, action: 'resubmit', code: '0102', dayId: DAY_04, checkDayId: null }],
        }),
      );
      expect(advanceDay(s, DAY_DIRECTORY)).toBe(s);
    });

    it('異常 v9：複審日已過卻仍 pending（Day 5）→ 不塞進過去的日子，dueDayId 改為 day.06；Day 6 才排入', () => {
      const day5 = advanceDay(finishDay(completeWork(resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, '0102', rid(0)), DAY_DIRECTORY), DAY_DIRECTORY), DAY_DIRECTORY);
      const v9 = toV9(day5);
      const abnormal: SaveV9 = { ...v9, returns: [{ ...v9.returns[0], status: 'pending', versions: [] }] };
      const s = loadV9(abnormal);
      expect(s.returns).toEqual([{ ...BASE, status: 'pending', dueDayId: DAY_06, versions: [], receipts: [RECEIPT0] }]);
      expect(s.issueSchedule).toEqual({});
      const day6 = advanceDay(finishDay(s, DAY_DIRECTORY), DAY_DIRECTORY);
      expect(day6.issueSchedule).toEqual({ [DAY_06]: [RETURN_ID] });
      expect(isValidSave(day6, DAY_DIRECTORY)).toBeTrue();
    });

    it('v9 退件結構不合法（未知狀態、缺 returnDayId、版本動作／日未知、returns 非陣列）→ 讀取失敗且不覆蓋', () => {
      const v9 = toV9(finishDay(completeWork(resubmitReturn(day4OnIssueTask(), DAY_DIRECTORY, RETURN_ID, '103', rid(0)), DAY_DIRECTORY), DAY_DIRECTORY));
      const r = v9.returns[0];
      const { returnDayId: _d, ...noReturnDay } = r;
      const bads: [string, unknown][] = [
        ['v10 狀態名稱', { ...v9, returns: [{ ...r, status: 'awaiting-check' }] }],
        ['缺 returnDayId', { ...v9, returns: [noReturnDay] }],
        ['版本動作未知', { ...v9, returns: [{ ...r, versions: [{ ...r.versions[0], action: 'fix' }] }] }],
        ['版本日未知', { ...v9, returns: [{ ...r, versions: [{ ...r.versions[0], dayId: 'day.99' }] }] }],
        ['版本編號空白', { ...v9, returns: [{ ...r, versions: [{ ...r.versions[0], code: ' ' }] }] }],
        ['returns 非陣列', { ...v9, returns: {} }],
      ];
      for (const [name, bad] of bads) {
        const raw = JSON.stringify(bad);
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(name).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).withContext(name).toBe(raw);
      }
    });
  });

  describe('v11 人員編號只驗型別（文字、非空白）', () => {
    function day2WithB102(archiveCode: unknown): unknown {
      const day2 = markReportOpened(playTo(DAY_02), DAY_DIRECTORY);
      return {
        ...day2,
        batches: { ...day2.batches, [BATCH_DAY01]: { ...day2.batches[BATCH_DAY01]!, archived: { ...day2.batches[BATCH_DAY01]!.archived, B102: { ...archivedAll['B102'], archiveCode } } } },
      };
    }

    for (const code of ['102', '0103', ' 0102', 'b102']) {
      it(`目前批次（Day 2 核對所看）B102 為 ${JSON.stringify(code)} → 原樣讀回`, () => {
        localStorage.setItem(SAVE_KEY, JSON.stringify(day2WithB102(code)));
        const loaded = repo.load();
        expect(loaded.issue).toBe('');
        expect(loaded.migratedFrom).toBe(12);
        expect(loaded.save!.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe(code);
      });
    }

    it('兩筆同編號各自保存並讀回', () => {
      const s = day2WithB102('0607') as Save;
      repo.persist(s);
      const loaded = repo.load().save!;
      expect(loaded.batches[BATCH_DAY01]!.archived['B102']!.archiveCode).toBe('0607');
      expect(loaded.batches[BATCH_DAY01]!.archived['B607']!.archiveCode).toBe('0607');
    });

    it('JSON number、null、物件、空字串、純空白 → 讀取失敗且不覆蓋', () => {
      for (const code of [102, null, { v: '0102' }, '', '   ']) {
        const raw = JSON.stringify(day2WithB102(code));
        localStorage.setItem(SAVE_KEY, raw);
        expect(repo.load()).withContext(JSON.stringify(code)).toEqual(READ_FAIL);
        expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
      }
    });
  });

  /* ---------- 讀取失敗 ---------- */

  it('壞 JSON "{" → save null、issue 為讀取失敗提示、migratedFrom null，且不會被覆蓋', () => {
    localStorage.setItem(SAVE_KEY, '{');
    const loaded = repo.load();
    expect(loaded).toEqual(READ_FAIL);
    expect(loaded.issue).toBe(STORAGE.readIssue);
    expect(loaded.issue.length).toBeGreaterThan(0);
    expect(loaded.issue).not.toBe(STORAGE.writeIssue);
    expect(localStorage.getItem(SAVE_KEY)).toBe('{');
  });

  for (const raw of ['{"version":7}', '{"version":6}', '{"version":5}', '{"version":4}', '{"version":3}', '{"version":2}', '{"version":1}', '{"version":8}', '{"version":9}', '{"version":10}', '{"version":11}']) {
    it(`合法 JSON 但只有 version 的殘骸 ${raw} → 讀取失敗且不會被覆蓋`, () => {
      localStorage.setItem(SAVE_KEY, raw);
      expect(repo.load()).toEqual(READ_FAIL);
      expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    });
  }

  it('未來版本（v13）即使其餘欄位合法也不猜測 → 讀取失敗且不覆蓋', () => {
    const raw = JSON.stringify({ ...createSave(1, DAY_DIRECTORY), version: 13 });
    localStorage.setItem(SAVE_KEY, raw);
    expect(repo.load()).toEqual(READ_FAIL);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
  });

  it('v1 舊存檔（version 1＋archiveName）→ 讀取失敗，且原字串不被覆蓋', () => {
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
    expect(repo.load()).toEqual(READ_FAIL);
    expect(localStorage.getItem(SAVE_KEY)).toBe(v1);
  });

  it('v11 但 dayId／taskId 矛盾 → 讀取失敗且不覆蓋', () => {
    const raw = JSON.stringify({ ...createSave(1, DAY_DIRECTORY), taskId: TASK_DAY2 });
    localStorage.setItem(SAVE_KEY, raw);
    expect(repo.load()).toEqual(READ_FAIL);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
  });

  it('合法 JSON 但為 null／陣列 → 讀取失敗', () => {
    localStorage.setItem(SAVE_KEY, 'null');
    expect(repo.load()).toEqual(READ_FAIL);
    localStorage.setItem(SAVE_KEY, '[]');
    expect(repo.load()).toEqual(READ_FAIL);
  });

  it('setItem 拋錯 → persist 回傳 writeIssue，不拋例外', () => {
    spyOn(Storage.prototype, 'setItem').and.throwError('quota');
    expect(repo.persist(createSave(1, DAY_DIRECTORY))).toBe(STORAGE.writeIssue);
  });

  it('getItem 拋錯 → load 回 issue readIssue，不拋例外', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    expect(repo.load()).toEqual(READ_FAIL);
  });

  it('clear() 移除 key', () => {
    repo.persist(createSave(1, DAY_DIRECTORY));
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    repo.clear();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(repo.load()).toEqual(NO_SAVE);
  });

  it('clear() 只移除自己的 key', () => {
    localStorage.setItem('other', 'x');
    repo.persist(createSave(1, DAY_DIRECTORY));
    repo.clear();
    expect(localStorage.getItem('other')).toBe('x');
  });

  it('removeItem 拋錯 → clear() 不拋例外', () => {
    spyOn(Storage.prototype, 'removeItem').and.throwError('blocked');
    expect(() => repo.clear()).not.toThrow();
  });
});
