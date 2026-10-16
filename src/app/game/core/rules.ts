import {
  DayDirectory,
  DayPlan,
  FieldMapTaskPlan,
  TaskPlan,
  batchIdOfTask,
  casePlanOf,
  dayOfBatch,
  findAudit,
  findCase,
  firstDay,
  firstTaskOf,
  taskPlanOf,
} from './day-plan';
import { isValidCodeString, normalizePlayerName, validateRecord } from './validate';
import { FieldMapCheck, checkFieldMap } from './field-map';
import { rand } from './rand';
import { receiptMail } from './mail';
import { WORKDAY_EVENT_KINDS, processWorkdayOnDayStart, resolvedFieldMapTask, workdayTaskDone } from './workday';
import {
  BatchId,
  BatchState,
  Draft,
  FieldMapProgress,
  MissingPolicy,
  NightResult,
  RecordKey,
  ReconcileProgress,
  Reply,
  SAVE_VERSION,
  Save,
  SourceRecord,
  SourceSnapshot,
  TaskId,
  TaskProgress,
  ValidationOk,
  CaseReviewState,
  RecordReview,
  REVIEW_DISPOSITIONS,
  ReturnCase,
  ReturnReceipt,
  ReviewDisposition,
  ChatReply,
  ChatResponseSnapshot,
  PromptId,
  HelpDelivery,
  MailRecord,
} from './types';

/** 夜間介入門檻：rand(seed,'night.intervention') < 0.45 → 介入。Demo 測試用設計，非正史。 */
export const INTERVENTION_THRESHOLD = 0.45;

/** 固定 eventId：避免玩家多開一次新聞就改變關鍵事件。 */
export const EVENT_IDS = {
  nightIntervention: 'night.intervention',
  nightSmallTalk: 'night.smalltalk',
} as const;

/** 事件種類（KB-R5-03 起為通用名稱；v2／v3 舊檔內的舊事件字串原樣保留）。 */
export const EVENT_KINDS = {
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
  ...WORKDAY_EVENT_KINDS,
} as const;


const EMPTY_BATCH: BatchState = { archived: {}, drafts: {} };

/* ---------- 建立與查詢 ---------- */

export function planOf(save: Save, dir: DayDirectory): DayPlan {
  const plan = dir.plan(save.dayId);
  if (!plan) throw new Error(`Unknown day ${save.dayId}`);
  return plan;
}

/** 目前進行的工作：由存檔的 taskId 在當日佇列中精確取得，不讀 tasks[0]。 */
export function activeTaskOf(save: Save, dir: DayDirectory): TaskPlan {
  const task = taskPlanOf(planOf(save, dir), save.taskId);
  if (!task) throw new Error(`Task ${save.taskId} is not on ${save.dayId}`);
  return task;
}

export function createSave(seed: number, dir: DayDirectory): Save {
  const dayId = firstDay(dir);
  const plan = dir.plan(dayId);
  if (!plan) throw new Error(`No plan for first day ${dayId}`);
  return {
    version: SAVE_VERSION,
    seed,
    dayId,
    stage: 'work',
    taskId: firstTaskOf(plan).id,
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
  };
}

export function withEvent(save: Save, kind: string, payload: unknown): Save {
  return { ...save, events: [...save.events, { id: `${kind}:${save.events.length}`, kind, payload }] };
}

/** 目前工作所讀寫（或檢視）的批次。 */
export function currentBatchId(save: Save, dir: DayDirectory): BatchId | null {
  return batchIdOfTask(activeTaskOf(save, dir));
}

export function batchOf(save: Save, batchId: BatchId): BatchState {
  return save.batches[batchId] ?? EMPTY_BATCH;
}

function withBatch(save: Save, batchId: BatchId, patch: Partial<BatchState>): Save {
  const current = batchOf(save, batchId);
  return { ...save, batches: { ...save.batches, [batchId]: { ...current, ...patch } } };
}

/* ---------- 夜間判定 ---------- */

export function resolveNight(seed: number): NightResult {
  const intervention = rand(seed, EVENT_IDS.nightIntervention) < INTERVENTION_THRESHOLD;
  return {
    intervention,
    smallTalkVariant: Math.floor(rand(seed, EVENT_IDS.nightSmallTalk) * 2),
    reportRevision: intervention ? 2 : 1,
  };
}

/**
 * 四格結果矩陣（開發用）：
 * Day1 寫 false → 已列入安排；null 覆核＋無介入 → 待資料覆核；null 覆核＋介入 → 已列入安排。
 */
export function isArranged(subjectRefusal: boolean | null, nightIntervention: boolean): boolean {
  return subjectRefusal === false || nightIntervention;
}

/**
 * 依當日核對工作指定的來源批次判定（四格矩陣）。
 * 當日沒有核對工作時回傳 false；同日其他新批次不影響結果。
 */
export function isArrangedInSave(save: Save, dir: DayDirectory): boolean {
  const plan = planOf(save, dir);
  const active = taskPlanOf(plan, save.taskId);
  const task = active?.kind === 'reconcile' ? active : plan.tasks.find((t) => t.kind === 'reconcile');
  if (task?.kind !== 'reconcile') return false;
  const subject = batchOf(save, task.sourceBatchId).archived[task.subjectKey];
  return isArranged(subject ? subject.refusal : null, save.night?.intervention ?? false);
}

/* ---------- 批次進度（以批次為範圍，不是全域） ---------- */

export function archivedCount(save: Save, batchId: BatchId): number {
  return Object.keys(batchOf(save, batchId).archived).length;
}

export function allArchived(save: Save, batchId: BatchId, records: readonly SourceRecord[]): boolean {
  const { archived } = batchOf(save, batchId);
  return records.every((r) => archived[r.key] !== undefined);
}

/* ---------- 狀態轉移（純函式，回傳新物件） ---------- */

export function setDraft(save: Save, batchId: BatchId, key: RecordKey, draft: Draft): Save {
  const batch = batchOf(save, batchId);
  return withBatch(save, batchId, { drafts: { ...batch.drafts, [key]: draft } });
}

export function snapshotOf(record: SourceRecord): SourceSnapshot {
  return {
    name: record.name,
    code: record.code,
    refusal: record.refusal,
    refusalApplies: record.refusalApplies,
  };
}

/** 提交以固定 record key 防重；已提交者不再改變，並連同來源快照保存。只在工作階段可提交。 */
export function commitArchive(save: Save, batchId: BatchId, record: SourceRecord, ok: ValidationOk): Save {
  const batch = batchOf(save, batchId);
  if (save.stage !== 'work' || batch.archived[record.key] || !isValidCodeString(ok.code)) return save;
  const next = withBatch(save, batchId, {
    archived: {
      ...batch.archived,
      [record.key]: {
        archiveCode: ok.code,
        refusal: ok.refusal,
        origin: ok.origin,
        source: snapshotOf(record),
      },
    },
  });
  return withEvent(next, EVENT_KINDS.archive, { key: record.key, origin: ok.origin, batchId });
}

/* ---------- 多來源比對案件（R9） ---------- */

/** 案件的閱讀狀態；尚未開案為 undefined。 */
export function caseStateOf(save: Save, caseId: string): CaseReviewState | undefined {
  return save.caseReviews[caseId];
}

/**
 * 開案：第一次開啟時依 seed＋穩定 case ID 選一個補件收件狀態變體並保存；之後不重抽。
 * 只在 work 階段、案件屬於目前歸檔工作時生效。
 */
export function openCase(save: Save, dir: DayDirectory, caseId: string): Save {
  if (save.caseReviews[caseId] || save.stage !== 'work') return save;
  const found = findCase(dir, caseId);
  if (!found || found.task.id !== save.taskId || found.casePlan.variantIds.length === 0) return save;
  // 已歸檔（含本輪前、沒有案件決定的舊檔）就不再開案，不補造閱讀狀態
  if (batchOf(save, found.task.batchId).archived[found.casePlan.recordKey]) return save;
  const ids = found.casePlan.variantIds;
  const variantId = ids[Math.min(ids.length - 1, Math.floor(rand(save.seed, caseId) * ids.length))] ?? ids[0] ?? '';
  return { ...save, caseReviews: { ...save.caseReviews, [caseId]: { variantId, marks: [] } } };
}

/** 標記／取消某欄位為「有差異」；提交後鎖定。 */
export function toggleCaseMark(save: Save, dir: DayDirectory, caseId: string, label: string): Save {
  const state = save.caseReviews[caseId];
  if (!state || save.stage !== 'work' || caseDecisionOf(save, dir, caseId) !== null) return save;
  const found = findCase(dir, caseId);
  if (!found || found.task.id !== save.taskId) return save;
  const marks = state.marks.includes(label) ? state.marks.filter((m) => m !== label) : [...state.marks, label];
  return { ...save, caseReviews: { ...save.caseReviews, [caseId]: { ...state, marks } } };
}

/** 已保存的案件決定 ID（從歸檔快照推導）；未決定或舊檔沒有決定時為 null。 */
export function caseDecisionOf(save: Save, dir: DayDirectory, caseId: string): string | null {
  const found = findCase(dir, caseId);
  if (!found) return null;
  const archived = batchOf(save, found.task.batchId).archived[found.casePlan.recordKey];
  return archived?.caseDecision?.caseId === caseId ? archived.caseDecision.decisionId : null;
}

/**
 * 提交案件決定：三種決定都合法，沒有正解。決定只代表依據／去向／註記；人員編號是玩家填寫的值（R10），
 * 拒絕紀錄仍照既有規則（origin 不混入人員編號的依據）。已提交者不再改變。
 */
export function commitCase(
  save: Save,
  dir: DayDirectory,
  record: SourceRecord,
  decisionId: string,
  code: string,
  policy?: Draft['policy'],
): Save {
  if (save.stage !== 'work' || !isValidCodeString(code)) return save;
  const task = taskPlanOf(planOf(save, dir), save.taskId);
  if (task?.kind !== 'archive') return save;
  const casePlan = casePlanOf(task, record.key);
  const decision = casePlan?.decisions.find((d) => d.id === decisionId);
  if (!casePlan || !decision || !save.caseReviews[casePlan.id]) return save;
  const batch = batchOf(save, task.batchId);
  if (batch.archived[record.key]) return save;
  // 拒絕紀錄照既有規則；人員編號是玩家實際填寫的值（只驗型別），不取自決定或來源
  const refusal = validateRecord(record, { value: code, policy });
  if (!refusal.ok) return save;
  const next = withBatch(save, task.batchId, {
    archived: {
      ...batch.archived,
      [record.key]: {
        archiveCode: code,
        refusal: refusal.refusal,
        origin: refusal.origin,
        source: snapshotOf(record),
        caseDecision: {
          caseId: casePlan.id,
          decisionId: decision.id,
          destination: decision.destination,
          basisDocumentId: decision.basisDocumentId,
          note: decision.note,
        },
      },
    },
  });
  return withEvent(next, EVENT_KINDS.archive, {
    key: record.key,
    origin: refusal.origin,
    batchId: task.batchId,
    caseId: casePlan.id,
    decisionId: decision.id,
  });
}

/* ---------- 工作完成與跨日 ---------- */

/** 某個工作是否已完成（不看 stage、不含免補）。歸檔＝批次全完成；核對＝已回覆；欄位映射＝已確認匯入。 */
export function isTaskDone(save: Save, dir: DayDirectory, task: TaskPlan): boolean {
  switch (task.kind) {
    case 'archive':
      return allArchived(save, task.batchId, dir.records(task.batchId));
    case 'reconcile':
      return reconcileProgressOf(save, task.id).reply !== undefined;
    case 'field-map':
      return fieldMapProgressOf(save, task.id).submitted !== undefined;
    case 'return-review': {
      // 本日處理已交付＝當天排入的案件在當天（或之後）都有處理版本（重送或轉待查）。
      // 不等於案件已解決：之後再次退回、回到待修正，也不會讓那天的工作變回未完成。
      const items = scheduledIssues(save, task.dayId);
      return items.length > 0 && items.every((r) => handledOnOrAfter(r, task.dayId, dir));
    }
    case 'attachment':
    case 'transform':
    case 'report':
      return workdayTaskDone(save, task) === true;
  }
}

/**
 * 工作是否適用：錯誤文件處理只有當天排入到期案件時才適用；其他工作永遠適用。
 * 不適用的工作視為已結清、不出現在當日清單，不會變成空工作。
 */
export function isTaskApplicable(save: Save, task: TaskPlan): boolean {
  return task.kind !== 'return-review' || (save.issueSchedule[task.dayId]?.length ?? 0) > 0;
}

/** 舊檔免補：只由遷移寫入；不代表已提交。 */
export function isTaskWaived(save: Save, taskId: TaskId): boolean {
  return save.waivedTasks.includes(taskId);
}

/** 已完成或免補：日程可以越過它。 */
export function isTaskSettled(save: Save, dir: DayDirectory, task: TaskPlan): boolean {
  return isTaskWaived(save, task.id) || !isTaskApplicable(save, task) || isTaskDone(save, dir, task);
}

/** 依賴的工作（同一天）都已完成或免補；沒有依賴＝成立。找不到的依賴視為已結清（內容驗證會擋下）。 */
export function dependenciesSettled(save: Save, dir: DayDirectory, task: TaskPlan): boolean {
  const plan = dir.planOfTask(task.id);
  return (task.dependsOn ?? []).every((id) => {
    const dep = plan ? taskPlanOf(plan, id) : undefined;
    return !dep || isTaskSettled(save, dir, dep);
  });
}

/** 工作可以開始處理：尚未結清，且依賴的工作都已結清。 */
export function isTaskOpen(save: Save, dir: DayDirectory, task: TaskPlan): boolean {
  return !isTaskSettled(save, dir, task) && dependenciesSettled(save, dir, task);
}

/** 尚未結清的依賴工作（畫面說明「等待前一批交付」用）；可開始時為空陣列。 */
export function pendingDependencies(save: Save, dir: DayDirectory, task: TaskPlan): readonly TaskPlan[] {
  const plan = dir.planOfTask(task.id);
  return (task.dependsOn ?? [])
    .map((id) => (plan ? taskPlanOf(plan, id) : undefined))
    .filter((dep): dep is TaskPlan => dep !== undefined && !isTaskSettled(save, dir, dep));
}

/**
 * 當日下一件可開始的工作（M1：沒有依賴的工作可以自選順序）：先找排在 afterTaskId 之後的，
 * 再從頭找（玩家先跳去做後面的工作時，前面的仍在佇列）；都沒有則 null。
 */
export function nextOpenTask(save: Save, dir: DayDirectory, afterTaskId: TaskId): TaskPlan | null {
  const tasks = planOf(save, dir).tasks;
  const at = tasks.findIndex((t) => t.id === afterTaskId);
  const ordered = [...tasks.slice(at + 1), ...tasks.slice(0, Math.max(at, 0))];
  return ordered.find((t) => t.id !== afterTaskId && isTaskOpen(save, dir, t)) ?? null;
}

/**
 * 切換目前工作（M1 工作佇列）：只在 work 階段、目標是當日可開始的工作時生效。
 * 不寫事件、不改任何進度；草稿與畫面狀態都留在原工作。
 */
export function selectTask(save: Save, dir: DayDirectory, taskId: TaskId): Save {
  if (save.stage !== 'work' || save.taskId === taskId) return save;
  const task = taskPlanOf(planOf(save, dir), taskId);
  if (!task || !isTaskOpen(save, dir, task)) return save;
  return { ...save, taskId };
}

/** 完成當日後的階段：有下一天 → 本日交接；沒有 → Demo 結束。 */
function stageAfterDay(plan: DayPlan): 'wrap' | 'end' {
  return plan.nextDayId ? 'wrap' : 'end';
}

/**
 * 交付目前工作（共用步驟）：寫一次 task.complete；
 * 當日還有未完成工作 → 停在 work、taskId 換成下一件；全部完成 → 寫一次 day.complete 並進 wrap／end。
 * 呼叫端須先確認工作已完成且仍在 work。
 */
function deliverActive(save: Save, dir: DayDirectory): Save {
  const plan = planOf(save, dir);
  const taskId = save.taskId;
  const next = withEvent(save, EVENT_KINDS.taskComplete, { dayId: save.dayId, taskId });
  const following = nextOpenTask(next, dir, taskId);
  if (following) return { ...next, taskId: following.id };
  return withEvent({ ...next, stage: stageAfterDay(plan) }, EVENT_KINDS.dayComplete, { dayId: save.dayId });
}

/**
 * 交付此項工作／完成今日交接（歸檔、欄位映射）。
 * 只在 work 階段、目前工作已完成時生效；核對工作由 submitReply 交付，不走這裡。
 * 交付後 taskId 已換到下一件或階段已離開 work，因此重複點擊與刷新重放都不會再次交付。
 */
export function completeWork(save: Save, dir: DayDirectory): Save {
  if (save.stage !== 'work') return save;
  const task = taskPlanOf(planOf(save, dir), save.taskId);
  if (!task || task.kind === 'reconcile') return save;
  if (!isTaskApplicable(save, task) || !isTaskDone(save, dir, task)) return save;
  return deliverActive(save, dir);
}

/**
 * 本日交接 → 次日收件（morning）；沒有下一天則 Demo 結束。
 * 夜間判定只在第一次實際跨日時擲一次；同日切換工作不會觸發。
 */
export function advanceDay(save: Save, dir: DayDirectory): Save {
  if (save.stage !== 'wrap') return save;
  let next: Save = save;
  if (!next.night) {
    const night = resolveNight(next.seed);
    next = withEvent({ ...next, night }, EVENT_KINDS.nightResolved, { ...night });
  }
  const nextDayId = planOf(next, dir).nextDayId;
  if (!nextDayId) return { ...next, stage: 'end' };
  const nextPlan = dir.plan(nextDayId);
  if (!nextPlan) throw new Error(`Unknown next day ${nextDayId}`);
  // 進入新的一天：建立新退件、核對到期的重送版本、排定當天的錯誤文件處理（皆只一次）
  next = processIssuesOnDayStart(next, dir, nextDayId);
  // M1：附件關聯核對與延後回條（依保存的資料，只一次）
  next = processWorkdayOnDayStart(next, dir, nextDayId);
  const first = nextPlan.tasks.find((t) => isTaskOpen(next, dir, t)) ?? firstTaskOf(nextPlan);
  return { ...next, dayId: nextDayId, stage: 'morning', taskId: first.id };
}

/** 次日收件 → 開始今日工作。 */
export function startDay(save: Save): Save {
  return save.stage === 'morning' ? { ...save, stage: 'work' } : save;
}

/* ---------- 事件歸屬（系統作業紀錄用） ---------- */

function payloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : undefined;
}

/** 事件屬於哪一天：依 payload 的 dayId／taskId／batchId 解析；無法歸屬回傳 undefined。 */
export function eventDayId(event: { payload: unknown }, dir: DayDirectory): string | undefined {
  const dayId = payloadString(event.payload, 'dayId');
  if (dayId && dir.plan(dayId)) return dayId;
  const taskId = payloadString(event.payload, 'taskId');
  if (taskId) {
    const plan = dir.planOfTask(taskId);
    if (plan) return plan.dayId;
  }
  const batchId = payloadString(event.payload, 'batchId');
  return batchId ? dayOfBatch(dir, batchId) : undefined;
}

/* ---------- 工作進度（以 taskId 為鍵） ---------- */

function withProgress(save: Save, taskId: TaskId, progress: TaskProgress): Save {
  return { ...save, taskProgress: { ...save.taskProgress, [taskId]: progress } };
}

export function reconcileProgressOf(save: Save, taskId: TaskId): ReconcileProgress {
  const p = save.taskProgress[taskId];
  return p?.kind === 'reconcile' ? p : { kind: 'reconcile', reportOpened: false, receiptOpened: false };
}

export function fieldMapProgressOf(save: Save, taskId: TaskId): FieldMapProgress {
  const p = save.taskProgress[taskId];
  return p?.kind === 'field-map' ? p : { kind: 'field-map', assignments: {}, previewed: false };
}

/** 目前工作是核對工作且在工作階段時回傳它的 id，否則 null。 */
function activeTaskOfKind<K extends TaskPlan['kind']>(
  save: Save,
  dir: DayDirectory,
  kind: K,
): Extract<TaskPlan, { kind: K }> | null {
  if (save.stage !== 'work') return null;
  const task = taskPlanOf(planOf(save, dir), save.taskId);
  return task?.kind === kind ? (task as Extract<TaskPlan, { kind: K }>) : null;
}

/* ---------- 核對工作（Day 2） ---------- */

export function markReportOpened(save: Save, dir: DayDirectory): Save {
  const task = activeTaskOfKind(save, dir, 'reconcile');
  if (!task) return save;
  const p = reconcileProgressOf(save, task.id);
  return p.reportOpened ? save : withProgress(save, task.id, { ...p, reportOpened: true });
}

export function markReceiptOpened(save: Save, dir: DayDirectory): Save {
  const task = activeTaskOfKind(save, dir, 'reconcile');
  if (!task) return save;
  const p = reconcileProgressOf(save, task.id);
  return p.receiptOpened ? save : withProgress(save, task.id, { ...p, receiptOpened: true });
}

/** 必須是核對工作、在工作階段、先開摘要；請求覆核還需先開昨日副本。 */
export function canReply(save: Save, dir: DayDirectory, reply: Reply): boolean {
  const task = activeTaskOfKind(save, dir, 'reconcile');
  if (!task) return false;
  const p = reconcileProgressOf(save, task.id);
  if (p.reply || !p.reportOpened) return false;
  if (reply === 'review' && !p.receiptOpened) return false;
  // 逐筆審查處置都要先做（放行或保留待查）；確認收件本身不等於放行
  return task.recordKeys.every((key) => p.reviews?.[key] !== undefined);
}

/** 提交回覆＝交付核對工作：當日還有工作 → 換到下一件；否則進本日交接／結束。 */
export function submitReply(save: Save, dir: DayDirectory, reply: Reply): Save {
  if (!canReply(save, dir, reply)) return save;
  const taskId = save.taskId;
  const p = reconcileProgressOf(save, taskId);
  const reportRevision = save.night?.reportRevision ?? null;
  const next = withEvent(withProgress(save, taskId, { ...p, reply, reportRevision }), EVENT_KINDS.replySubmit, {
    taskId,
    choice: reply,
  });
  return deliverActive(next, dir);
}

/**
 * 第二輪逐筆審查：放行或保留待查。保存所看的版本（前一階段保存的 archiveCode）與原始來源，
 * 並附上來源批次／工作／紀錄的內部追蹤引用。回覆（交付）前可以改變處置。
 */
export function setRecordReview(save: Save, dir: DayDirectory, key: RecordKey, disposition: ReviewDisposition): Save {
  const task = activeTaskOfKind(save, dir, 'reconcile');
  if (!task || !task.recordKeys.includes(key) || !REVIEW_DISPOSITIONS.includes(disposition)) return save;
  const p = reconcileProgressOf(save, task.id);
  if (p.reply) return save;
  const archived = batchOf(save, task.sourceBatchId).archived[key];
  const archiveTask = dir.plan(dayOfBatch(dir, task.sourceBatchId) ?? '')?.tasks.find(
    (t) => t.kind === 'archive' && t.batchId === task.sourceBatchId,
  );
  if (!archived || !archiveTask) return save;
  if (p.reviews?.[key]?.disposition === disposition) return save;
  const review: RecordReview = {
    disposition,
    batchId: task.sourceBatchId,
    archiveTaskId: archiveTask.id,
    recordKey: key,
    sourceCode: archived.source.code,
    reviewedCode: archived.archiveCode,
  };
  const next = withProgress(save, task.id, { ...p, reviews: { ...p.reviews, [key]: review } });
  return withEvent(next, EVENT_KINDS.recordReview, { taskId: task.id, key, disposition });
}

/* ---------- 文件問題（延後退件，R10／R11） ---------- */

export function returnsOfAudit(save: Save, auditId: string): readonly ReturnCase[] {
  return save.returns.filter((r) => r.auditId === auditId);
}

/** 案件在某天或之後是否有處理版本（該天的錯誤文件處理算已交付）。 */
export function handledOnOrAfter(item: ReturnCase, dayId: string, dir: DayDirectory): boolean {
  const at = dir.days.indexOf(dayId);
  return item.versions.some((v) => dir.days.indexOf(v.dayId) >= at);
}

/** 某天「錯誤文件處理」引用的案件（進入該日時排定）。 */
export function scheduledIssues(save: Save, dayId: string): readonly ReturnCase[] {
  const ids = save.issueSchedule[dayId] ?? [];
  return save.returns.filter((r) => ids.includes(r.id));
}

/** 訊息條件用：該稽核的退件已建立且今天已到通知日（與是否仍待辦無關）。 */
export function returnNotified(save: Save, dir: DayDirectory, auditId: string): boolean {
  const found = findAudit(dir, auditId);
  if (!found || returnsOfAudit(save, auditId).length === 0) return false;
  return dir.days.indexOf(save.dayId) >= dir.days.indexOf(found.audit.notifyDayId);
}

/** 下一個工作日；最後一天回傳 null。 */
function nextWorkingDay(dir: DayDirectory, dayId: string): string | null {
  return dir.plan(dayId)?.nextDayId ?? null;
}

/** 附加新回條並同時寄出對應郵件（兩者一起寫入，刷新不重寄）。 */
function withReceiptMail(save: Save, item: ReturnCase, receipt: ReturnReceipt): Save {
  return { ...save, mailbox: [...save.mailbox, receiptMail(item, receipt)] };
}

function receiptOf(item: ReturnCase, kind: ReturnReceipt['kind'], dayId: string, versionIndex: number | null, code: string): ReturnReceipt {
  return {
    id: `${item.id}#${item.receipts.length}`,
    kind,
    dayId,
    versionIndex,
    code,
    reason: kind === 'returned' ? 'code-mismatch' : null,
  };
}

/**
 * 進入某一天時的文件問題處理（只在 advanceDay 執行，刷新／切頁不會觸發）：
 * 1. 通知日：依已保存的第二輪「放行」審查建立新案件（送件編號與保存的原始來源不一致者）。
 *    保留待查、只確認收件、舊檔沒有審查處置都不會產生。穩定 ID，已存在就不再建立。
 * 2. 核對：預定今天核對、尚未評估的重送版本，與保存的來源依據比對一次——
 *    一致才結案；仍不一致就再次退回（待修正）。沒有自動通過門檻。
 * 3. 排程：今天到期的待修正案件排入當天的錯誤文件處理（已排過就不重排）。
 * 每份回條（退件或再次退回）都把案件排到下一個工作日；最後一天之後仍留在清單。
 */
function processIssuesOnDayStart(save: Save, dir: DayDirectory, dayId: string): Save {
  let next = save;
  const due = nextWorkingDay(dir, dayId);

  // 1. 建立新案件
  for (const d of dir.days) {
    for (const task of dir.plan(d)?.tasks ?? []) {
      if (task.kind !== 'reconcile' || task.returnAudit?.notifyDayId !== dayId) continue;
      const audit = task.returnAudit;
      const reviews = reconcileProgressOf(next, task.id).reviews ?? {};
      const created: ReturnCase[] = [];
      for (const key of task.recordKeys) {
        const r = reviews[key];
        if (!r || r.disposition !== 'release' || r.reviewedCode === r.sourceCode) continue;
        const id = `return.${audit.id}.${key}`;
        if (next.returns.some((x) => x.id === id)) continue;
        const submittedCode = batchOf(next, r.batchId).archived[key]?.archiveCode ?? r.reviewedCode;
        const item: ReturnCase = {
          id,
          auditId: audit.id,
          batchId: r.batchId,
          recordKey: key,
          archiveTaskId: r.archiveTaskId,
          reviewTaskId: task.id,
          sourceCode: r.sourceCode,
          submittedCode,
          reviewedCode: r.reviewedCode,
          disposition: 'release',
          reason: 'code-mismatch',
          notifyDayId: dayId,
          status: 'pending',
          dueDayId: due,
          versions: [],
          receipts: [],
        };
        created.push({ ...item, receipts: [receiptOf(item, 'returned', dayId, null, r.reviewedCode)] });
      }
      if (created.length === 0) continue;
      next = { ...next, returns: [...next.returns, ...created] };
      for (const item of created) next = withReceiptMail(next, item, item.receipts[0] as ReturnReceipt);
      next = withEvent(next, EVENT_KINDS.returnNotified, {
        dayId,
        auditId: audit.id,
        count: created.length,
      });
    }
  }

  // 2. 核對到期的重送版本（每個版本只評估一次）
  for (const item of next.returns) {
    if (item.status !== 'awaiting-check') continue;
    const last = item.versions[item.versions.length - 1];
    if (!last || last.action !== 'resubmit' || last.checkDayId !== dayId || last.outcome !== undefined) continue;
    const resolved = last.code === item.sourceCode;
    const outcome: 'resolved' | 'returned' = resolved ? 'resolved' : 'returned';
    const versions = item.versions.map((v) => (v.index === last.index ? { ...v, outcome, checkedDayId: dayId } : v));
    const receipt = receiptOf(item, outcome, dayId, last.index, last.code);
    const updated: ReturnCase = {
      ...item,
      status: resolved ? 'resolved' : 'pending',
      dueDayId: resolved ? null : due,
      versions,
      receipts: [...item.receipts, receipt],
    };
    next = withEvent(withReceiptMail(withReturn(next, updated), updated, receipt), EVENT_KINDS.returnChecked, {
      dayId,
      returnId: item.id,
      versionIndex: last.index,
      outcome,
    });
  }

  // 3. 排定今天的錯誤文件處理
  if (next.issueSchedule[dayId] === undefined) {
    const ids = next.returns.filter((r) => r.status === 'pending' && r.dueDayId === dayId).map((r) => r.id);
    if (ids.length > 0) next = { ...next, issueSchedule: { ...next.issueSchedule, [dayId]: ids } };
  }
  return next;
}

function withReturn(save: Save, updated: ReturnCase): Save {
  return { ...save, returns: save.returns.map((r) => (r.id === updated.id ? updated : r)) };
}

/**
 * 目前可以建立新修訂的回條（R12）：案件最新一份回條，且它是退件、案件目前待修正。
 * 較早的回條、已送出待核對、待窗口回覆與已結案都只能檢閱。
 */
export function editableReceiptOf(item: ReturnCase): ReturnReceipt | null {
  const last = item.receipts[item.receipts.length - 1];
  return last && last.kind === 'returned' && item.status === 'pending' ? last : null;
}

/**
 * 可以處理的案件：工作階段、狀態為待修正，而且呼叫端開啟的正是目前可修訂的回條（版本鎖定）。
 * 不限定目前工作（從郵件附件也能處理）；過期的附件或操作一律拒絕，不會覆寫新版本。
 */
function openIssue(save: Save, returnId: string, expectedReceiptId: string): ReturnCase | null {
  if (save.stage !== 'work') return null;
  const item = save.returns.find((r) => r.id === returnId);
  if (!item) return null;
  return editableReceiptOf(item)?.id === expectedReceiptId ? item : null;
}

/** 修訂完成：該回條的草稿已成為版本，移除草稿。 */
function withoutIssueDraft(save: Save, receiptId: string): Save {
  if (save.issueDrafts[receiptId] === undefined) return save;
  const issueDrafts = { ...save.issueDrafts };
  delete issueDrafts[receiptId];
  return { ...save, issueDrafts };
}

/** 最後一次實際送出的編號（修訂表單預填用）：最新版本，沒有版本時是第一次提交。 */
export function latestIssueCode(item: ReturnCase): string {
  return item.versions[item.versions.length - 1]?.code ?? item.submittedCode;
}

/**
 * 重送（只驗型別；任何非空文字都可送出）：新增處理版本，狀態改為已重送／待核對，
 * 預定下一工作日由下游核對。不覆寫原提交，也不會因為按了送出就結案。
 */
export function resubmitReturn(
  save: Save,
  dir: DayDirectory,
  returnId: string,
  code: string,
  expectedReceiptId: string,
): Save {
  const item = openIssue(save, returnId, expectedReceiptId);
  if (!item || !isValidCodeString(code)) return save;
  const index = item.versions.length;
  const updated: ReturnCase = {
    ...item,
    status: 'awaiting-check',
    dueDayId: null,
    versions: [
      ...item.versions,
      { index, action: 'resubmit', code, dayId: save.dayId, checkDayId: nextWorkingDay(dir, save.dayId) },
    ],
  };
  const next = withoutIssueDraft(withReturn(save, updated), expectedReceiptId);
  return withEvent(next, EVENT_KINDS.returnResubmit, { dayId: save.dayId, returnId, versionIndex: index });
}

/** 註記並送窗口待查：待窗口回覆，仍屬未解決。 */
export function sendReturnToWindow(save: Save, dir: DayDirectory, returnId: string, expectedReceiptId: string): Save {
  const item = openIssue(save, returnId, expectedReceiptId);
  if (!item) return save;
  const index = item.versions.length;
  const updated: ReturnCase = {
    ...item,
    status: 'awaiting-window',
    dueDayId: null,
    versions: [...item.versions, { index, action: 'window', code: latestIssueCode(item), dayId: save.dayId, checkDayId: null }],
  };
  void dir;
  const next = withoutIssueDraft(withReturn(save, updated), expectedReceiptId);
  return withEvent(next, EVENT_KINDS.returnWindow, { dayId: save.dayId, returnId, versionIndex: index });
}

/** 修訂草稿（R12）：只有目前可修訂的回條能寫入；過期回條的草稿保留原值供查看，不再更新。 */
export function setIssueDraft(save: Save, receiptId: string, value: string): Save {
  if (save.stage !== 'work' || typeof value !== 'string') return save;
  const item = save.returns.find((r) => r.receipts.some((rc) => rc.id === receiptId));
  if (!item || editableReceiptOf(item)?.id !== receiptId || save.issueDrafts[receiptId] === value) return save;
  return { ...save, issueDrafts: { ...save.issueDrafts, [receiptId]: value } };
}

/* ---------- 郵件（R12） ---------- */

export function isMailRead(save: Save, mailId: string): boolean {
  return save.readMail.includes(mailId);
}

/** 算「當日第一次交付或提交」的事件種類（M1 一般回條的送達時機）。 */
const FIRST_TASK_EVENT_KINDS: readonly string[] = [
  EVENT_KINDS.archive,
  EVENT_KINDS.taskComplete,
  EVENT_KINDS.replySubmit,
  EVENT_KINDS.fieldMapSubmit,
  EVENT_KINDS.returnResubmit,
  EVENT_KINDS.returnWindow,
  EVENT_KINDS.attachmentSubmit,
  EVENT_KINDS.attachmentRevise,
  EVENT_KINDS.transformSubmit,
  EVENT_KINDS.reportSubmit,
];

/**
 * 郵件是否已送達（M1）：沒有 deliverAfter 的郵件寄出即送達；'first-task' 的一般回條在寄出那天
 * 第一次交付或提交之後才送達（之後的日子一律已送達）。只讀保存的事件，不重擲。
 */
export function isMailDelivered(save: Save, dir: DayDirectory, mail: MailRecord): boolean {
  if (mail.deliverAfter !== 'first-task') return true;
  const today = dir.days.indexOf(save.dayId);
  const sent = dir.days.indexOf(mail.dayId);
  if (today > sent) return true;
  if (today < sent || save.stage === 'morning') return false;
  return save.events.some((e) => FIRST_TASK_EVENT_KINDS.includes(e.kind) && eventDayId(e, dir) === mail.dayId);
}

/** 已送達的郵件（依收到順序）；收件匣、未讀數與附件都只看這些。 */
export function deliveredMail(save: Save, dir: DayDirectory): readonly MailRecord[] {
  return save.mailbox.filter((m) => isMailDelivered(save, dir, m));
}

/** 開啟郵件才標已讀（開收件匣不算）；只記錄既有郵件，重複與已讀去除；沒有新增回傳同一物件。 */
export function markMailRead(save: Save, mailIds: readonly string[]): Save {
  const known = new Set(save.mailbox.map((m) => m.id));
  const seen = new Set(save.readMail);
  const added: string[] = [];
  for (const id of mailIds) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }
  return added.length === 0 ? save : { ...save, readMail: [...save.readMail, ...added] };
}

/* ---------- 欄位映射工作（Day 6） ---------- */

/** 目前的欄位映射工作（資料列已依保存資料解析，M1）與進度；已匯入時為 null。 */
function activeFieldMap(save: Save, dir: DayDirectory): { task: FieldMapTaskPlan; progress: FieldMapProgress } | null {
  const task = activeTaskOfKind(save, dir, 'field-map');
  if (!task) return null;
  const progress = fieldMapProgressOf(save, task.id);
  return progress.submitted ? null : { task: resolvedFieldMapTask(save, task), progress };
}

/** 設定某個目標欄位的來源；空字串＝清除。任何改動都會清除預覽。提交後鎖定。 */
export function setFieldAssignment(save: Save, dir: DayDirectory, targetId: string, sourceId: string): Save {
  const active = activeFieldMap(save, dir);
  if (!active) return save;
  const { task, progress } = active;
  if (!task.targets.some((t) => t.id === targetId)) return save;
  if (sourceId !== '' && !task.sourceFieldIds.includes(sourceId)) return save;
  const assignments = { ...progress.assignments };
  if (sourceId === '') delete assignments[targetId];
  else assignments[targetId] = sourceId;
  return withProgress(save, task.id, { ...progress, assignments, previewed: false });
}

export function setFieldBlankPolicy(save: Save, dir: DayDirectory, policy: MissingPolicy): Save {
  const active = activeFieldMap(save, dir);
  if (!active || active.progress.blankPolicy === policy) return save;
  return withProgress(save, active.task.id, { ...active.progress, blankPolicy: policy, previewed: false });
}

/** 目前對應與政策的檢查結果（唯讀，不寫存檔）。已提交時回傳提交快照。 */
export function fieldMapCheck(save: Save, dir: DayDirectory): FieldMapCheck | null {
  const task = taskPlanOf(planOf(save, dir), save.taskId);
  if (task?.kind !== 'field-map') return null;
  const progress = fieldMapProgressOf(save, task.id);
  if (progress.submitted) return { ok: true, result: progress.submitted };
  return checkFieldMap(resolvedFieldMapTask(save, task), progress.assignments, progress.blankPolicy);
}

/** 驗證並預覽：通過才標記 previewed。錯誤不改存檔。 */
export function previewFieldMap(save: Save, dir: DayDirectory): Save {
  const active = activeFieldMap(save, dir);
  if (!active) return save;
  const check = checkFieldMap(active.task, active.progress.assignments, active.progress.blankPolicy);
  if (!check.ok || active.progress.previewed) return save;
  return withProgress(save, active.task.id, { ...active.progress, previewed: true });
}

/** 確認匯入：必須已預覽且仍通過；鎖定快照並寫事件。 */
export function submitFieldMap(save: Save, dir: DayDirectory): Save {
  const active = activeFieldMap(save, dir);
  if (!active || !active.progress.previewed) return save;
  const check = checkFieldMap(active.task, active.progress.assignments, active.progress.blankPolicy);
  if (!check.ok) return save;
  const next = withProgress(save, active.task.id, { ...active.progress, submitted: check.result });
  return withEvent(next, EVENT_KINDS.fieldMapSubmit, {
    taskId: active.task.id,
    blankPolicy: check.result.blankPolicy,
    rowCount: check.result.rowCount,
    affectedCount: check.result.affectedCount,
  });
}

/* ---------- 訊息條件用的唯讀推導 ---------- */

/** 某批次是否至少有一筆 origin=review；從保存結果推導，不擲骰、不另存分支。 */
export function batchHasReview(save: Save, batchId: BatchId): boolean {
  return Object.values(batchOf(save, batchId).archived).some((a) => a?.origin === 'review');
}

/* ---------- 訊息固定回覆（R7） ---------- */

/** 回答時需要的選項內容；由 state 從內容資料取出並確認 prompt 目前可回答後傳入。 */
export interface ChatChoiceInput {
  id: string;
  text: string;
  responses: readonly ChatResponseSnapshot[];
}

export function chatReplyOf(save: Save, promptId: PromptId): ChatReply | undefined {
  return save.chatReplies[promptId];
}

/** 已回答的選項 id；skipped 或未回答為 null（訊息條件只認已回答）。 */
export function chatChoiceOf(save: Save, promptId: PromptId): string | null {
  const r = save.chatReplies[promptId];
  return r?.kind === 'answered' ? r.choiceId : null;
}

/** 回答的實際時間與每則回應的預定送達時間（epoch ms）；由 state 以時鐘與一般亂數算好後傳入。 */
export interface ChatTiming {
  answeredAt: number;
  /** 與 responses 等長、遞增。 */
  deliverAt: readonly number[];
}

/**
 * 回答：保存玩家文字與回應快照。同一 prompt 一旦 answered／skipped 就不可改選。
 * 有 timing 時一併保存回答時間、遊戲日與逐則送達時間（R12），重整／讀檔不重抽等待時間。
 */
export function answerChat(save: Save, promptId: PromptId, choice: ChatChoiceInput, timing?: ChatTiming): Save {
  if (save.chatReplies[promptId]) return save;
  if (timing && !isValidTiming(timing.answeredAt, timing.deliverAt, choice.responses.length)) return save;
  const reply: ChatReply = {
    kind: 'answered',
    choiceId: choice.id,
    playerText: choice.text,
    responses: choice.responses.map((r, i) => ({
      id: r.id,
      actorId: r.actorId,
      time: r.time,
      lines: [...r.lines],
      ...(timing ? { deliverAt: timing.deliverAt[i] as number } : {}),
    })),
    ...(timing ? { answeredAt: timing.answeredAt, dayId: save.dayId } : {}),
  };
  const next = { ...save, chatReplies: { ...save.chatReplies, [promptId]: reply } };
  return withEvent(next, EVENT_KINDS.chatReply, { promptId, choiceId: choice.id });
}

/** 送達排程：起點與每個時間點都是有限非負數，逐則不早於前一則（也不早於起點）。 */
function isValidTiming(start: number, times: readonly number[], count: number): boolean {
  if (!Number.isFinite(start) || start < 0 || times.length !== count) return false;
  let prev = start;
  for (const t of times) {
    if (!Number.isFinite(t) || t < prev) return false;
    prev = t;
  }
  return true;
}

/* ---------- 向同事詢問（R12） ---------- */

/**
 * 保存玩家的提問與說明送達排程（每份存檔只一次）：提問當下的遊戲日與實際時間，
 * 說明訊息逐則的預定送達時間。已問過就不再寫入（再次點擊只定位既有說明）。
 */
export function requestHelp(save: Save, requestId: string, askedAt: number, deliveries: readonly HelpDelivery[]): Save {
  if (requestId === '' || save.helpRequests[requestId] || deliveries.length === 0) return save;
  const ids = deliveries.map((d) => d.messageId);
  if (ids.some((id) => id === '') || new Set(ids).size !== ids.length) return save;
  if (!isValidTiming(askedAt, deliveries.map((d) => d.at), deliveries.length)) return save;
  const state = { dayId: save.dayId, askedAt, deliveries: deliveries.map((d) => ({ messageId: d.messageId, at: d.at })) };
  const next = { ...save, helpRequests: { ...save.helpRequests, [requestId]: state } };
  return withEvent(next, EVENT_KINDS.helpRequest, { dayId: save.dayId, requestId });
}

/* ---------- 入職前情與簽名（R12） ---------- */

/** 前進到下一段（只能逐段前進、未完成時）；是否可越過合約段由 state 依內容判斷。 */
export function advanceOnboarding(save: Save, step: number): Save {
  const o = save.onboarding;
  if (o.complete || step !== o.step + 1) return save;
  return { ...save, onboarding: { ...o, step } };
}

/** 簽名：保存正規化後的角色名並前進一段（同一次寫入）；已簽名、已完成或名字不合法時不做事。 */
export function signContract(save: Save, rawName: string): Save {
  const name = normalizePlayerName(rawName);
  if (name === null || save.profile.name !== null || save.onboarding.complete) return save;
  return { ...save, profile: { name }, onboarding: { ...save.onboarding, step: save.onboarding.step + 1 } };
}

/** 入職完成（已簽名）：之後進登入與桌面。 */
export function completeOnboarding(save: Save): Save {
  if (save.onboarding.complete || save.profile.name === null) return save;
  return { ...save, onboarding: { ...save.onboarding, complete: true } };
}

/** 不回覆：只保存 skipped，不在訊息串顯示任何東西。 */
export function skipChat(save: Save, promptId: PromptId): Save {
  if (save.chatReplies[promptId]) return save;
  const next = { ...save, chatReplies: { ...save.chatReplies, [promptId]: { kind: 'skipped' as const } } };
  return withEvent(next, EVENT_KINDS.chatSkip, { promptId });
}

/* ---------- 訊息已讀（KB-R4-04） ---------- */

export function isMessageRead(save: Save, messageId: string): boolean {
  return save.readMessages.includes(messageId);
}

/** 標記為已讀；已讀過與清單內重複都去除；沒有新增時回傳同一物件避免多餘寫檔。 */
export function markMessagesRead(save: Save, messageIds: readonly string[]): Save {
  const seen = new Set(save.readMessages);
  const added: string[] = [];
  for (const id of messageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }
  if (added.length === 0) return save;
  return { ...save, readMessages: [...save.readMessages, ...added] };
}
