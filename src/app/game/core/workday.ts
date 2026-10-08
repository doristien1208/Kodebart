import {
  AttachmentCandidatePlan,
  AttachmentChoice,
  AttachmentTaskPlan,
  ATTACHMENT_CHOICES,
  DayDirectory,
  FieldMapTaskPlan,
  MappingRow,
  ReportTaskPlan,
  TaskPlan,
  TransformPolicy,
  TransformTaskPlan,
  TRANSFORM_POLICIES,
  WorkdayMailPlan,
  findCase,
  findTask,
  taskPlanOf,
} from './day-plan';
import { rand } from './rand';
import {
  AttachmentCheck,
  AttachmentLinkVersion,
  AttachmentProgress,
  DayId,
  MailAttachment,
  MailRecord,
  ReportProgress,
  ReportRowSnapshot,
  ReportSnapshot,
  Save,
  TaskId,
  TaskProgress,
  TransformOutput,
  TransformProgress,
  TransformRowSnapshot,
} from './types';

/**
 * M1 工作日（附件關聯 B、批次轉換 C、交付報告、延後回條）的純規則。
 *
 * - 下游一律讀玩家**實際保存**的資料：歸檔的採用編號與來源快照、附件關聯的送件版本、批次的輸出快照。
 *   不以內容檔的標準答案重建，也不以「適用性」擋下合法送件（選到別人的附件也能送出，隔日回條才指出）。
 * - 送件版本、批次輸出與報告在提交當下保存為不可變快照；之後內容檔變動或再修訂都不覆寫。
 * - 不依賴 Angular、DOM、localStorage 或 content；內容（附件文件、郵件計畫）由 DayDirectory 傳入。
 * - 本檔不 import rules.ts（避免循環）；工作是否完成、依賴與日程推進在 rules.ts。
 */

export const WORKDAY_EVENT_KINDS = {
  attachmentSubmit: 'attachment.submit',
  attachmentRevise: 'attachment.revise',
  attachmentChecked: 'attachment.checked',
  transformSubmit: 'transform.submit',
  reportSubmit: 'report.submit',
} as const;

/** 一般回條的兩個送達變體門檻：rand(seed, mailId) 低於此值＝到班即到，否則當日第一次交付後送達。 */
export const ORDINARY_MAIL_EARLY_THRESHOLD = 0.5;

function appendEvent(save: Save, kind: string, payload: unknown): Save {
  return { ...save, events: [...save.events, { id: `${kind}:${save.events.length}`, kind, payload }] };
}

function withProgress(save: Save, taskId: TaskId, progress: TaskProgress): Save {
  return { ...save, taskProgress: { ...save.taskProgress, [taskId]: progress } };
}

function nextWorkingDay(dir: DayDirectory, dayId: DayId): DayId | null {
  return dir.plan(dayId)?.nextDayId ?? null;
}

/** work 階段、目前工作是指定種類時回傳它。 */
function activeOfKind<K extends TaskPlan['kind']>(save: Save, dir: DayDirectory, kind: K): Extract<TaskPlan, { kind: K }> | null {
  if (save.stage !== 'work') return null;
  const plan = dir.plan(save.dayId);
  const task = plan ? taskPlanOf(plan, save.taskId) : undefined;
  return task?.kind === kind ? (task as Extract<TaskPlan, { kind: K }>) : null;
}

/* ---------- 進度 ---------- */

export function attachmentProgressOf(save: Save, taskId: TaskId): AttachmentProgress {
  const p = save.taskProgress[taskId];
  return p?.kind === 'attachment' ? p : { kind: 'attachment', opened: false, versions: [], checks: [] };
}

export function transformProgressOf(save: Save, taskId: TaskId): TransformProgress {
  const p = save.taskProgress[taskId];
  return p?.kind === 'transform' ? p : { kind: 'transform', opened: false, previewed: false, previewedOnce: false };
}

export function reportProgressOf(save: Save, taskId: TaskId): ReportProgress {
  const p = save.taskProgress[taskId];
  return p?.kind === 'report' ? p : { kind: 'report', opened: false, generated: false };
}

/** M1 工作是否已完成：附件已送件、批次已交付、報告已交付。其他種類回傳 null（由 rules.ts 判斷）。 */
export function workdayTaskDone(save: Save, task: TaskPlan): boolean | null {
  switch (task.kind) {
    case 'attachment':
      return attachmentProgressOf(save, task.id).versions.length > 0;
    case 'transform':
      return transformProgressOf(save, task.id).submitted !== undefined;
    case 'report':
      return reportProgressOf(save, task.id).submitted !== undefined;
    default:
      return null;
  }
}

/**
 * 第一次開啟 M1 工作（附件、批次、報告）：記下 opened，訊息依此解鎖（「開啟 0314 附件工作後」）。
 * 只在 work 階段、對目前工作生效；已開過回傳同一物件。
 */
export function markTaskOpened(save: Save, dir: DayDirectory): Save {
  if (save.stage !== 'work') return save;
  const plan = dir.plan(save.dayId);
  const task = plan ? taskPlanOf(plan, save.taskId) : undefined;
  if (!task) return save;
  switch (task.kind) {
    case 'attachment': {
      const p = attachmentProgressOf(save, task.id);
      return p.opened ? save : withProgress(save, task.id, { ...p, opened: true });
    }
    case 'transform': {
      const p = transformProgressOf(save, task.id);
      return p.opened ? save : withProgress(save, task.id, { ...p, opened: true });
    }
    case 'report': {
      const p = reportProgressOf(save, task.id);
      return p.opened ? save : withProgress(save, task.id, { ...p, opened: true });
    }
    default:
      return save;
  }
}

/** 訊息條件用：工作是否開啟過。 */
export function isTaskOpened(save: Save, taskId: TaskId): boolean {
  const p = save.taskProgress[taskId];
  return p !== undefined && 'opened' in p && p.opened === true;
}

/** 訊息條件用：批次是否開啟過預覽、報告是否已建立（不會被之後的設定變更清除）。 */
export function isTaskPreviewed(save: Save, taskId: TaskId): boolean {
  const p = save.taskProgress[taskId];
  if (p?.kind === 'transform') return p.previewedOnce || p.submitted !== undefined;
  if (p?.kind === 'report') return p.generated || p.submitted !== undefined;
  return false;
}

/* ---------- 附件關聯（B） ---------- */

/** 附件關聯的狀態：todo＝未送件；submitted＝已送件（不需核對或保留缺漏）；awaiting＝等待下游核對；returned＝對象不符、待修正；resolved＝核對相符。 */
export type AttachmentStatus = 'todo' | 'submitted' | 'awaiting' | 'returned' | 'resolved';

export function latestLink(p: AttachmentProgress): AttachmentLinkVersion | undefined {
  return p.versions[p.versions.length - 1];
}

export function checkOfVersion(p: AttachmentProgress, versionIndex: number): AttachmentCheck | undefined {
  return p.checks.find((c) => c.versionIndex === versionIndex);
}

export function attachmentStatus(p: AttachmentProgress): AttachmentStatus {
  const latest = latestLink(p);
  if (!latest) return 'todo';
  const check = checkOfVersion(p, latest.index);
  if (check) return check.outcome;
  return latest.checkDayId === null ? 'submitted' : 'awaiting';
}

/** 目前可以建立新修訂的版本序號：最新版本核對為對象不符時才有；其他（含舊版本）一律唯讀。 */
export function editableLinkIndex(p: AttachmentProgress): number | null {
  const latest = latestLink(p);
  return latest && attachmentStatus(p) === 'returned' ? latest.index : null;
}

/** 某個版本是否引用了別的對象的附件（只看保存的版本，不看目前內容）。 */
export function isLinkMismatch(v: AttachmentLinkVersion): boolean {
  return v.attachedKey !== null && v.attachedKey !== v.subjectKey;
}

export interface AttachmentInput {
  choiceId?: string;
  documentId?: string;
}

/** 送件的必要欄位：處理方式合法；引用時附件必須是這件工作的候選附件。不判斷附件是否適用。 */
export type AttachmentInputError = 'choiceRequired' | 'attachmentRequired';

export function attachmentInputError(task: AttachmentTaskPlan, input: AttachmentInput): AttachmentInputError | null {
  if (!ATTACHMENT_CHOICES.includes(input.choiceId as AttachmentChoice)) return 'choiceRequired';
  if (input.choiceId === 'reference' && !task.candidates.some((c) => c.documentId === input.documentId)) return 'attachmentRequired';
  return null;
}

/** 由輸入建立一個送件版本；對象尚未歸檔（沒有採用編號）時為 null。 */
function linkVersion(
  save: Save,
  dir: DayDirectory,
  task: AttachmentTaskPlan,
  input: AttachmentInput,
  index: number,
): AttachmentLinkVersion | null {
  if (attachmentInputError(task, input) !== null) return null;
  const archived = save.batches[task.subjectBatchId]?.archived[task.subjectKey];
  if (!archived) return null;
  const choiceId = input.choiceId as AttachmentChoice;
  const candidate: AttachmentCandidatePlan | undefined =
    choiceId === 'reference' ? task.candidates.find((c) => c.documentId === input.documentId) : undefined;
  return {
    index,
    choiceId,
    destination: choiceId === 'reference' ? 'archive' : 'review',
    document: candidate
      ? { id: candidate.document.id, heading: candidate.document.heading, fields: candidate.document.fields.map((f) => ({ ...f })) }
      : null,
    evidence: candidate?.evidence ?? null,
    attachedKey: candidate?.subjectKey ?? null,
    attachedCode: candidate?.subjectCode ?? null,
    objection: candidate?.objection ?? null,
    subjectKey: task.subjectKey,
    subjectCode: archived.archiveCode,
    sourceCode: archived.source.code,
    dayId: save.dayId,
    // 只有引用附件需要下游核對對象；保留缺漏沒有可比對的附件
    checkDayId: candidate ? nextWorkingDay(dir, save.dayId) : null,
  };
}

/** 附件草稿：目前工作尚未送件，或從回條開啟的可修訂版本；其他時候不寫入。 */
export function setAttachmentDraft(save: Save, dir: DayDirectory, taskId: TaskId, draft: AttachmentInput): Save {
  if (save.stage !== 'work') return save;
  const task = findTask(dir, taskId);
  if (task?.kind !== 'attachment') return save;
  const p = attachmentProgressOf(save, taskId);
  const initial = p.versions.length === 0 && save.taskId === taskId;
  if (!initial && editableLinkIndex(p) === null) return save;
  const next: AttachmentProgress['draft'] = {};
  if (draft.choiceId && ATTACHMENT_CHOICES.includes(draft.choiceId as AttachmentChoice)) next.choiceId = draft.choiceId as AttachmentChoice;
  if (draft.documentId && task.candidates.some((c) => c.documentId === draft.documentId)) next.documentId = draft.documentId;
  if (JSON.stringify(p.draft ?? {}) === JSON.stringify(next)) return save;
  return withProgress(save, taskId, { ...p, draft: next });
}

/** 送件（原版本）：目前工作、尚未送件、輸入合法、對象已歸檔。送出後草稿清除。 */
export function submitAttachment(save: Save, dir: DayDirectory, input: AttachmentInput): Save {
  const task = activeOfKind(save, dir, 'attachment');
  if (!task) return save;
  const p = attachmentProgressOf(save, task.id);
  if (p.versions.length > 0) return save;
  const version = linkVersion(save, dir, task, input, 0);
  if (!version) return save;
  const { draft: _draft, ...rest } = p;
  const next = withProgress(save, task.id, { ...rest, opened: true, versions: [version] });
  return appendEvent(next, WORKDAY_EVENT_KINDS.attachmentSubmit, {
    taskId: task.id,
    choiceId: version.choiceId,
    documentId: version.document?.id ?? null,
  });
}

/**
 * 修訂（從回條附件開啟）：只有最新版本核對為對象不符、且呼叫端開的正是那個版本時才能送出；
 * 新增一個版本（原送件與舊版本留存），預定下一工作日再核對。仍然選錯就再次退回，不會自動變正確。
 */
export function reviseAttachment(save: Save, dir: DayDirectory, taskId: TaskId, expectedIndex: number, input: AttachmentInput): Save {
  if (save.stage !== 'work') return save;
  const task = findTask(dir, taskId);
  if (task?.kind !== 'attachment') return save;
  const p = attachmentProgressOf(save, taskId);
  if (editableLinkIndex(p) !== expectedIndex) return save;
  const version = linkVersion(save, dir, task, input, p.versions.length);
  if (!version) return save;
  const { draft: _draft, ...rest } = p;
  const next = withProgress(save, taskId, { ...rest, versions: [...p.versions, version] });
  return appendEvent(next, WORKDAY_EVENT_KINDS.attachmentRevise, {
    dayId: save.dayId,
    taskId,
    versionIndex: version.index,
    choiceId: version.choiceId,
    documentId: version.document?.id ?? null,
  });
}

/* ---------- 批次轉換（C） ---------- */

/** 一列的輸入（來源、採用、附件）；不含策略。 */
function transformRowInput(save: Save, dir: DayDirectory, row: TransformTaskPlan['rows'][number]): Omit<TransformRowSnapshot, 'value' | 'valueOrigin' | 'status'> {
  const archived = save.batches[row.batchId]?.archived[row.recordKey];
  const content = dir.records(row.batchId).find((r) => r.key === row.recordKey);
  let attachment: TransformRowSnapshot['attachment'] = null;
  let heldForReview = false;
  if (row.attachmentTaskId) {
    const latest = latestLink(attachmentProgressOf(save, row.attachmentTaskId));
    if (latest?.choiceId === 'review') heldForReview = true;
    else if (latest?.document && latest.evidence && latest.attachedKey !== null && latest.attachedCode !== null) {
      attachment = {
        taskId: row.attachmentTaskId,
        versionIndex: latest.index,
        documentId: latest.document.id,
        heading: latest.document.heading,
        evidence: latest.evidence,
        attachedKey: latest.attachedKey,
        attachedCode: latest.attachedCode,
      };
    }
  } else if (row.attachment) {
    attachment = {
      taskId: null,
      versionIndex: null,
      documentId: row.attachment.documentId,
      heading: row.attachment.document.heading,
      evidence: row.attachment.evidence,
      attachedKey: row.attachment.subjectKey,
      attachedCode: row.attachment.subjectCode,
    };
  }
  return {
    id: row.id,
    recordKey: row.recordKey,
    batchId: row.batchId,
    sourceCode: archived?.source.code ?? content?.code ?? null,
    sourceRefusal: archived ? archived.source.refusal : (content?.refusal ?? null),
    adoptedCode: archived?.archiveCode ?? null,
    adoptedRefusal: archived ? archived.refusal : null,
    adoptedOrigin: archived?.origin ?? null,
    attachment,
    heldForReview,
  };
}

/** 本人回覆附件的異議回覆（只有引用的是回覆附件才有值）。 */
function replyValueOf(save: Save, dir: DayDirectory, row: TransformTaskPlan['rows'][number]): boolean | null {
  if (row.attachmentTaskId) {
    const latest = latestLink(attachmentProgressOf(save, row.attachmentTaskId));
    return latest?.choiceId === 'reference' && latest.evidence === 'reply' ? latest.objection : null;
  }
  void dir;
  return row.attachment?.evidence === 'reply' ? row.attachment.objection : null;
}

export type TransformError = 'policyRequired';
export type TransformCheck = { ok: true; output: TransformOutput } | { ok: false; error: TransformError };

/**
 * 依保存的資料與策略建立批次輸出：
 * 本人回覆附件的值優先（系統不判斷附件是否屬於這個人；隔日回條才指出）→ 來源紀錄已有的值 →
 * 都沒有＝缺漏：套用部門預設寫入預設值（交付），或保留缺漏（待補）。兩者都不補造本人回覆。
 * 有缺漏卻沒選策略時不能建立；沒有缺漏時策略可不選。
 */
export function checkTransform(save: Save, dir: DayDirectory, task: TransformTaskPlan, policy: TransformPolicy | undefined): TransformCheck {
  const rows: TransformRowSnapshot[] = [];
  let missing = 0;
  for (const row of task.rows) {
    const input = transformRowInput(save, dir, row);
    const reply = replyValueOf(save, dir, row);
    const archived = input.adoptedCode !== null;
    let value: boolean | null;
    let valueOrigin: TransformRowSnapshot['valueOrigin'];
    if (!archived) {
      value = null;
      valueOrigin = 'held';
    } else if (reply !== null) {
      value = reply;
      valueOrigin = 'reply';
    } else if (input.sourceRefusal !== null) {
      value = input.sourceRefusal;
      valueOrigin = 'source';
    } else {
      missing++;
      value = policy === 'departmentDefault' ? false : null;
      valueOrigin = policy === 'departmentDefault' ? 'policy' : 'held';
    }
    rows.push({ ...input, value, valueOrigin, status: value === null ? 'pending' : 'delivered' });
  }
  if (missing > 0 && !policy) return { ok: false, error: 'policyRequired' };
  const delivered = rows.filter((r) => r.status === 'delivered').length;
  return {
    ok: true,
    output: {
      policy: missing > 0 ? (policy ?? null) : null,
      rows,
      deliveredCount: delivered,
      pendingCount: rows.length - delivered,
      replyCount: rows.filter((r) => r.valueOrigin === 'reply').length,
      dayId: save.dayId,
    },
  };
}

/** 這批有沒有需要策略的缺漏列（決定策略是否必選）。 */
export function transformMissingCount(save: Save, dir: DayDirectory, task: TransformTaskPlan): number {
  const check = checkTransform(save, dir, task, 'review');
  return check.ok ? check.output.rows.filter((r) => r.valueOrigin === 'held' && r.adoptedCode !== null).length : 0;
}

function activeTransform(save: Save, dir: DayDirectory): { task: TransformTaskPlan; progress: TransformProgress } | null {
  const task = activeOfKind(save, dir, 'transform');
  if (!task) return null;
  const progress = transformProgressOf(save, task.id);
  return progress.submitted ? null : { task, progress };
}

/** 選缺漏策略；改變策略會清除預覽。交付後鎖定。 */
export function setTransformPolicy(save: Save, dir: DayDirectory, policy: TransformPolicy): Save {
  const active = activeTransform(save, dir);
  if (!active || !TRANSFORM_POLICIES.includes(policy) || active.progress.policy === policy) return save;
  return withProgress(save, active.task.id, { ...active.progress, opened: true, policy, previewed: false });
}

/** 目前批次的檢查結果（唯讀）；已交付時回傳交付快照。 */
export function transformCheckOf(save: Save, dir: DayDirectory, taskId: TaskId): TransformCheck | null {
  const task = findTask(dir, taskId);
  if (task?.kind !== 'transform') return null;
  const p = transformProgressOf(save, taskId);
  if (p.submitted) return { ok: true, output: p.submitted };
  return checkTransform(save, dir, task, p.policy);
}

/** 建立批次預覽：通過才標記 previewed（並記下曾預覽）。錯誤不改存檔。 */
export function previewTransform(save: Save, dir: DayDirectory): Save {
  const active = activeTransform(save, dir);
  if (!active) return save;
  if (!checkTransform(save, dir, active.task, active.progress.policy).ok) return save;
  if (active.progress.previewed && active.progress.previewedOnce) return save;
  return withProgress(save, active.task.id, { ...active.progress, opened: true, previewed: true, previewedOnce: true });
}

/** 執行並交付：必須已預覽且仍通過；保存輸出快照並寫事件。 */
export function submitTransform(save: Save, dir: DayDirectory): Save {
  const active = activeTransform(save, dir);
  if (!active || !active.progress.previewed) return save;
  const check = checkTransform(save, dir, active.task, active.progress.policy);
  if (!check.ok) return save;
  const next = withProgress(save, active.task.id, { ...active.progress, submitted: check.output });
  return appendEvent(next, WORKDAY_EVENT_KINDS.transformSubmit, {
    taskId: active.task.id,
    policy: check.output.policy,
    rowCount: check.output.rows.length,
    deliveredCount: check.output.deliveredCount,
    pendingCount: check.output.pendingCount,
  });
}

/** 某筆紀錄最近一次批次輸出的那一列（依 transformTaskIds 順序，後者優先）；沒有為 undefined。 */
export function latestTransformRow(
  save: Save,
  transformTaskIds: readonly TaskId[],
  batchId: string,
  recordKey: string,
): TransformRowSnapshot | undefined {
  let found: TransformRowSnapshot | undefined;
  for (const id of transformTaskIds) {
    const row = transformProgressOf(save, id).submitted?.rows.find((r) => r.batchId === batchId && r.recordKey === recordKey);
    if (row) found = row;
  }
  return found;
}

/* ---------- 欄位映射：資料列讀保存的資料（M1 Day 6） ---------- */

/**
 * 欄位映射的資料列：有 dynamic 設定時，編號欄代入玩家採用的人員編號（歸檔保存值），
 * 回覆欄代入最近一次批次輸出的值（有／無／空白）；沒有批次輸出時用歸檔保存的回覆欄。
 * 紀錄沒有保存資料時退回內容檔的原值。
 */
export function fieldMapRowsOf(save: Save, task: FieldMapTaskPlan): readonly MappingRow[] {
  const dyn = task.dynamic;
  if (!dyn) return task.rows;
  return task.rows.map((row) => {
    const ref = dyn.rows.find((r) => r.rowId === row.id);
    const archived = ref ? save.batches[ref.batchId]?.archived[ref.recordKey] : undefined;
    if (!ref || !archived) return row;
    const output = latestTransformRow(save, ref.transformTaskIds, ref.batchId, ref.recordKey);
    const value = output ? output.value : archived.refusal;
    const reply = value === true ? dyn.trueValue : value === false ? dyn.falseValue : '';
    return { id: row.id, values: { ...row.values, [dyn.codeFieldId]: archived.archiveCode, [dyn.replyFieldId]: reply } };
  });
}

/** 依保存資料解析資料列後的欄位映射工作（規則與畫面共用）。 */
export function resolvedFieldMapTask(save: Save, task: FieldMapTaskPlan): FieldMapTaskPlan {
  return task.dynamic ? { ...task, rows: fieldMapRowsOf(save, task) } : task;
}

/* ---------- 交付報告 ---------- */

/**
 * 交付報告：逐列取欄位映射的實際輸出（編號、回覆欄）與最近一次批次輸出的附件依據。
 * 送件＝回覆欄有值；待補＝保留缺漏；已附本人回覆只算對象相符的本人回覆附件，窗口收件另計、不能互相取代。
 * 欄位映射尚未匯入時為 null。
 */
export function buildReport(save: Save, dir: DayDirectory, task: ReportTaskPlan): ReportSnapshot | null {
  const fieldMap = findTask(dir, task.fieldMapTaskId);
  if (fieldMap?.kind !== 'field-map') return null;
  const p = save.taskProgress[fieldMap.id];
  const submitted = p?.kind === 'field-map' ? p.submitted : undefined;
  if (!submitted) return null;
  const dyn = fieldMap.dynamic;
  const codeTarget = fieldMap.targets.find((t) => t.sourceId === dyn?.codeFieldId)?.id;
  const replyTarget = fieldMap.targets.find((t) => t.sourceId === dyn?.replyFieldId && t.convert === 'boolean')?.id;
  const rows: ReportRowSnapshot[] = submitted.rows.map((row) => {
    const ref = dyn?.rows.find((r) => r.rowId === row.id);
    const raw = replyTarget ? row.values[replyTarget] : null;
    const value = typeof raw === 'boolean' ? raw : null;
    const codeRaw = codeTarget ? row.values[codeTarget] : '';
    const transform = ref ? latestTransformRow(save, task.transformTaskIds, ref.batchId, ref.recordKey) : undefined;
    const att = transform?.attachment;
    let evidence: ReportRowSnapshot['evidence'] = 'none';
    if (att && ref) {
      if (att.attachedKey !== ref.recordKey) evidence = 'mismatch';
      else if (att.evidence === 'reply') evidence = 'reply';
      else if (att.evidence === 'receipt') evidence = 'receipt';
    }
    return {
      id: row.id,
      recordKey: ref?.recordKey ?? null,
      code: typeof codeRaw === 'string' ? codeRaw : '',
      value,
      evidence,
      status: value === null ? 'pending' : 'delivered',
    };
  });
  return {
    rows,
    submissionCount: rows.filter((r) => r.status === 'delivered').length,
    replyCount: rows.filter((r) => r.evidence === 'reply').length,
    receiptCount: rows.filter((r) => r.evidence === 'receipt').length,
    pendingCount: rows.filter((r) => r.status === 'pending').length,
    dayId: save.dayId,
  };
}

/** 建立報告（核對前的預覽）：欄位映射已匯入才可建立。 */
export function generateReport(save: Save, dir: DayDirectory): Save {
  const task = activeOfKind(save, dir, 'report');
  if (!task) return save;
  const p = reportProgressOf(save, task.id);
  if (p.generated || p.submitted || !buildReport(save, dir, task)) return save;
  return withProgress(save, task.id, { ...p, opened: true, generated: true });
}

/** 交付報告：必須已建立；保存報告快照並寫事件。 */
export function submitReport(save: Save, dir: DayDirectory): Save {
  const task = activeOfKind(save, dir, 'report');
  if (!task) return save;
  const p = reportProgressOf(save, task.id);
  if (!p.generated || p.submitted) return save;
  const report = buildReport(save, dir, task);
  if (!report) return save;
  const next = withProgress(save, task.id, { ...p, submitted: report });
  return appendEvent(next, WORKDAY_EVENT_KINDS.reportSubmit, {
    taskId: task.id,
    submissionCount: report.submissionCount,
    replyCount: report.replyCount,
    pendingCount: report.pendingCount,
  });
}

/** 報告的目前內容（唯讀）：已交付回傳快照；未交付依保存資料即時建立。 */
export function reportOf(save: Save, dir: DayDirectory, taskId: TaskId): ReportSnapshot | null {
  const task = findTask(dir, taskId);
  if (task?.kind !== 'report') return null;
  return reportProgressOf(save, taskId).submitted ?? buildReport(save, dir, task);
}

/* ---------- 進入新的一天：附件核對與延後回條 ---------- */

/** 郵件 ID：第一封用計畫 ID，同一計畫再寄時加 `.r<n>`。 */
function mailIdFor(plan: WorkdayMailPlan, n: number): string {
  return n === 0 ? plan.id : `${plan.id}.r${n}`;
}

function mailOf(save: Save, plan: WorkdayMailPlan, id: string, dayId: DayId, attachments: MailAttachment[]): MailRecord {
  const mail: MailRecord = { id, packId: plan.packId, templateId: plan.templateId, dayId, attachments };
  if (plan.ordinary && rand(save.seed, id) >= ORDINARY_MAIL_EARLY_THRESHOLD) mail.deliverAfter = 'first-task';
  return mail;
}

/** 某個計畫在今天要寄的附件；條件不成立回傳 null。附件關聯退回另行處理。 */
function plannedAttachments(save: Save, dir: DayDirectory, plan: WorkdayMailPlan): MailAttachment[] | null {
  const t = plan.trigger;
  switch (t.kind) {
    case 'case-decided': {
      const found = findCase(dir, t.caseId);
      if (!found) return null;
      const archived = save.batches[found.task.batchId]?.archived[found.casePlan.recordKey];
      if (archived?.caseDecision?.caseId !== t.caseId) return null;
      const docs = [...new Set(found.casePlan.decisions.map((d) => d.basisDocumentId))];
      return [
        { kind: 'archive-copy', batchId: found.task.batchId, recordKey: found.casePlan.recordKey },
        ...docs.map((documentId): MailAttachment => ({ kind: 'case-source', documentId })),
      ];
    }
    case 'batch-delivered': {
      const out = transformProgressOf(save, t.taskId).submitted;
      if (!out || out.deliveredCount === 0) return null;
      const linked = t.attachmentTaskId ? out.rows.find((r) => r.attachment?.taskId === t.attachmentTaskId)?.attachment : undefined;
      const row = linked ? out.rows.find((r) => r.attachment === linked) : undefined;
      if (linked && row && linked.attachedKey !== row.recordKey) return null;
      const refs: MailAttachment[] = [{ kind: 'batch-output', taskId: t.taskId }];
      if (linked?.taskId && linked.versionIndex !== null) refs.push({ kind: 'attachment-link', taskId: linked.taskId, versionIndex: linked.versionIndex });
      return refs;
    }
    case 'batch-pending': {
      const out = transformProgressOf(save, t.taskId).submitted;
      return out && out.pendingCount > 0 ? [{ kind: 'batch-output', taskId: t.taskId }] : null;
    }
    case 'attachment-submitted': {
      const task = findTask(dir, t.taskId);
      const latest = latestLink(attachmentProgressOf(save, t.taskId));
      if (task?.kind !== 'attachment' || !latest) return null;
      return [
        { kind: 'attachment-link', taskId: t.taskId, versionIndex: latest.index },
        ...task.candidates.map((c): MailAttachment => ({ kind: 'case-source', documentId: c.documentId })),
      ];
    }
    case 'batch-result':
      return transformProgressOf(save, t.taskId).submitted ? [{ kind: 'batch-output', taskId: t.taskId }] : null;
    case 'attachment-mismatch':
      return null;
  }
}

/**
 * 進入某一天時（只在 advanceDay 執行一次，刷新／切頁不觸發）：
 * 1. 附件關聯：預定今天核對、尚未核對的版本，比對附件所屬對象與工作對象（只一次）；不符＝退回、可修訂。
 * 2. 延後回條：依保存的批次輸出、附件與案件決定寄出當天的郵件（固定 ID，已寄就不重寄）。
 *    附件對象不符的回條在每次退回時各寄一封。一般回條的送達時機擲一次並保存在郵件上。
 */
export function processWorkdayOnDayStart(save: Save, dir: DayDirectory, dayId: DayId): Save {
  let next = save;
  const plans = dir.mails ?? [];
  const sent = new Set(next.mailbox.map((m) => m.id));
  const send = (mail: MailRecord) => {
    if (sent.has(mail.id)) return;
    sent.add(mail.id);
    next = { ...next, mailbox: [...next.mailbox, mail] };
  };

  // 1. 附件關聯核對
  for (const d of dir.days) {
    for (const task of dir.plan(d)?.tasks ?? []) {
      if (task.kind !== 'attachment') continue;
      const p = attachmentProgressOf(next, task.id);
      const due = p.versions.filter((v) => v.checkDayId === dayId && !checkOfVersion(p, v.index));
      if (due.length === 0) continue;
      let checks = p.checks;
      for (const v of due) {
        const outcome: AttachmentCheck['outcome'] = isLinkMismatch(v) ? 'returned' : 'resolved';
        checks = [...checks, { versionIndex: v.index, dayId, outcome }];
        next = appendEvent(withProgress(next, task.id, { ...p, checks }), WORKDAY_EVENT_KINDS.attachmentChecked, {
          dayId,
          taskId: task.id,
          versionIndex: v.index,
          outcome,
        });
        if (outcome !== 'returned') continue;
        const returnedBefore = checks.filter((c) => c.outcome === 'returned').length - 1;
        for (const plan of plans) {
          if (plan.trigger.kind !== 'attachment-mismatch' || plan.trigger.taskId !== task.id) continue;
          const attachments: MailAttachment[] = [{ kind: 'attachment-link', taskId: task.id, versionIndex: v.index }];
          if (v.document) attachments.push({ kind: 'case-source', documentId: v.document.id });
          send(mailOf(next, plan, mailIdFor(plan, returnedBefore), dayId, attachments));
        }
      }
    }
  }

  // 2. 當天的其他回條
  for (const plan of plans) {
    if (plan.dayId !== dayId || plan.trigger.kind === 'attachment-mismatch' || sent.has(plan.id)) continue;
    const attachments = plannedAttachments(next, dir, plan);
    if (attachments) send(mailOf(next, plan, plan.id, dayId, attachments));
  }
  return next;
}
