import { BatchId, CaseDestination, DayId, RecordKey, SourceRecord, TaskId } from './types';

/**
 * 日程目錄（KB-R5-03／R6-03）：core 需要知道的「每一天有哪個工作、屬於哪個批次、下一天是誰」。
 *
 * core 不 import content；這個介面由 state adapter 從內容資料建立後傳入規則與驗證。
 * 新增日別或同日工作只要增加內容檔；新增玩法才需要在 TaskPlan 加一個 kind。
 */
export type TaskKind = 'archive' | 'reconcile' | 'field-map' | 'return-review';

export interface ArchiveTaskPlan {
  id: TaskId;
  kind: 'archive';
  /** 這個工作寫入的批次。 */
  batchId: BatchId;
  /** 這個批次要處理的資料鍵，順序即佇列順序。 */
  recordKeys: readonly RecordKey[];
  /** 批次中的多來源比對案件（R9）；一般批次為空陣列。 */
  caseReviews: readonly CasePlan[];
}

/** 案件的一個合法決定。 */
export interface CaseDecisionPlan {
  id: string;
  archiveCode: string;
  destination: CaseDestination;
  basisDocumentId: string;
  note: string;
}

/** 多來源比對案件：同一筆紀錄有兩份來源，玩家選擇依據與去向。沒有唯一正解。 */
export interface CasePlan {
  id: string;
  recordKey: RecordKey;
  /** 補件收件狀態的變體 ID；第一次開案時依 seed＋case ID 選一個並保存。 */
  variantIds: readonly string[];
  decisions: readonly CaseDecisionPlan[];
}

export interface ReconcileTaskPlan {
  id: TaskId;
  kind: 'reconcile';
  /** 這個工作核對的是哪一批的送件。 */
  sourceBatchId: BatchId;
  /** 摘要與副本所看的對象（來源批次中的一筆）。 */
  subjectKey: RecordKey;
  /** 這件核對工作引用的紀錄（決定核對量，不是整個來源批次）。 */
  recordKeys: readonly RecordKey[];
  /** 下游稽核（R10）：放行後若與原始來源不一致，於 notifyDayId 通知、於 reviewTaskId 複審。 */
  returnAudit?: ReturnAuditPlan;
}

export interface ReturnAuditPlan {
  id: string;
  notifyDayId: DayId;
}

/**
 * 錯誤文件處理（R10／R11）：每天一個位置，只有當天排入到期案件（issueSchedule）時才適用；
 * 否則不佔佇列。處理的是跨日持續存在的文件問題案件，不綁定特定稽核或日子。
 */
export interface ReturnReviewTaskPlan {
  id: TaskId;
  kind: 'return-review';
  /** 這個位置所在的日子（排程以日為鍵）。 */
  dayId: DayId;
}

/** 欄位映射的目標欄位：正確來源、轉換方式。 */
export interface FieldTarget {
  id: string;
  /** 正確對應的來源欄位。 */
  sourceId: string;
  convert: 'text' | 'boolean';
  /** convert=boolean 時，代表 true／false 的來源字串；空字串是空值。 */
  trueValue?: string;
  falseValue?: string;
}

export interface MappingRow {
  id: string;
  /** source field id → 原字串（含前導零）。 */
  values: Readonly<Record<string, string>>;
}

export interface FieldMapTaskPlan {
  id: TaskId;
  kind: 'field-map';
  /** 依來源表順序。 */
  sourceFieldIds: readonly string[];
  /** 依目標格式順序。 */
  targets: readonly FieldTarget[];
  rows: readonly MappingRow[];
}

export type TaskPlan = ArchiveTaskPlan | ReconcileTaskPlan | FieldMapTaskPlan | ReturnReviewTaskPlan;

export interface DayPlan {
  dayId: DayId;
  /** 日序（1 起算），只用於排序與「從某日起可見」的比較。 */
  dayNumber: number;
  /** 下一天；null 代表這一天結束後 Demo 結束。 */
  nextDayId: DayId | null;
  /** 當日有序工作佇列（至少一件）；順序完全由內容資料決定。 */
  tasks: readonly TaskPlan[];
}

export interface DayDirectory {
  /** 依日序排列的全部日別。 */
  readonly days: readonly DayId[];
  plan(dayId: DayId): DayPlan | undefined;
  /** 由 taskId 反查所在日的日程；未知回傳 undefined。 */
  planOfTask(taskId: TaskId): DayPlan | undefined;
  /** 某個批次的資料集合；未知批次回傳空集合。 */
  records(batchId: BatchId): readonly SourceRecord[];
}

/** 目前工作所讀寫（或檢視）的歸檔批次；欄位映射沒有歸檔批次，回傳 null。 */
export function batchIdOfTask(task: TaskPlan): BatchId | null {
  switch (task.kind) {
    case 'archive':
      return task.batchId;
    case 'reconcile':
      return task.sourceBatchId;
    case 'field-map':
    case 'return-review':
      return null;
  }
}

export function firstDay(dir: DayDirectory): DayId {
  const first = dir.days[0];
  if (!first) throw new Error('DayDirectory has no days');
  return first;
}

/** 由 taskId 取得當日的工作；不屬於這一天回傳 undefined。 */
export function taskPlanOf(plan: DayPlan, taskId: TaskId): TaskPlan | undefined {
  return plan.tasks.find((t) => t.id === taskId);
}

/** 當日第一件工作。 */
export function firstTaskOf(plan: DayPlan): TaskPlan {
  const t = plan.tasks[0];
  if (!t) throw new Error(`Day ${plan.dayId} has no task`);
  return t;
}

/** 某個歸檔批次屬於哪一天；找不到回傳 undefined。 */
export function dayOfBatch(dir: DayDirectory, batchId: BatchId): DayId | undefined {
  for (const dayId of dir.days) {
    const plan = dir.plan(dayId);
    if (plan?.tasks.some((t) => t.kind === 'archive' && t.batchId === batchId)) return dayId;
  }
  return undefined;
}

/** 某筆紀錄是否為案件；回傳案件計畫（在目前歸檔工作內查）。 */
export function casePlanOf(task: TaskPlan, key: RecordKey): CasePlan | undefined {
  return task.kind === 'archive' ? task.caseReviews.find((c) => c.recordKey === key) : undefined;
}

/** 由 case ID 在全部日程中找案件與其所在工作。 */
export function findCase(dir: DayDirectory, caseId: string): { plan: DayPlan; task: ArchiveTaskPlan; casePlan: CasePlan } | undefined {
  for (const dayId of dir.days) {
    const plan = dir.plan(dayId);
    for (const task of plan?.tasks ?? []) {
      if (task.kind !== 'archive') continue;
      const casePlan = task.caseReviews.find((c) => c.id === caseId);
      if (plan && casePlan) return { plan, task, casePlan };
    }
  }
  return undefined;
}

/** 由稽核 ID 找到定義它的核對工作與所在日。 */
export function findAudit(dir: DayDirectory, auditId: string): { plan: DayPlan; task: ReconcileTaskPlan; audit: ReturnAuditPlan } | undefined {
  for (const dayId of dir.days) {
    const plan = dir.plan(dayId);
    for (const task of plan?.tasks ?? []) {
      if (task.kind === 'reconcile' && task.returnAudit?.id === auditId && plan) return { plan, task, audit: task.returnAudit };
    }
  }
  return undefined;
}

/** 最後一天的日序；給「N 日試玩完成」之類的標籤使用。 */
export function lastDayNumber(dir: DayDirectory): number {
  const last = dir.days[dir.days.length - 1];
  return last ? (dir.plan(last)?.dayNumber ?? 0) : 0;
}

/** 便於測試與 adapter 使用的簡單實作。 */
export function createDayDirectory(
  plans: readonly DayPlan[],
  batchRecords: Readonly<Record<BatchId, readonly SourceRecord[]>>,
): DayDirectory {
  const ordered = [...plans].sort((a, b) => a.dayNumber - b.dayNumber);
  const byId = new Map(ordered.map((p) => [p.dayId, p] as const));
  const byTask = new Map(ordered.flatMap((p) => p.tasks.map((t) => [t.id, p] as const)));
  return {
    days: ordered.map((p) => p.dayId),
    plan: (dayId) => byId.get(dayId),
    planOfTask: (taskId) => byTask.get(taskId),
    records: (batchId) => batchRecords[batchId] ?? [],
  };
}
