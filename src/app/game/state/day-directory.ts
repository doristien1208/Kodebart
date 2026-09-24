import { CONTENT } from '../content/bundle';
import { ContentRecord, ContentTask, DayContent } from '../content/schema';
import { DayDirectory, DayPlan, TaskPlan, createDayDirectory } from '../core/day-plan';
import { BatchId, SourceRecord } from '../core/types';

/**
 * 由內容資料建立 core 的日程目錄（KB-R5-03）。
 *
 * 這是 content → core 的唯一橋接：core 只認 DayDirectory 介面，
 * 新增日別時只要加內容檔與 nextDayId 關係；只有新增 task kind 才需要在這裡加一個分支。
 */
function toSourceRecord(r: ContentRecord): SourceRecord {
  return { key: r.key, name: r.name, code: r.code, refusal: r.refusal, refusalApplies: r.refusalApplies };
}

type RecordIndex = ReadonlyMap<string, ContentRecord>;

function indexRecords(days: readonly DayContent[]): RecordIndex {
  return new Map(days.flatMap((d) => d.records).map((r) => [r.id, r] as const));
}

function lookupRecord(index: RecordIndex, id: string): ContentRecord {
  const r = index.get(id);
  if (!r) throw new Error(`Unknown record ${id}`);
  return r;
}

function toTaskPlan(task: ContentTask, index: RecordIndex, dayId: string): TaskPlan {
  switch (task.kind) {
    case 'archive':
      return {
        id: task.id,
        kind: 'archive',
        batchId: task.batchId,
        recordKeys: task.recordIds.map((id) => lookupRecord(index, id).key),
        caseReviews: task.caseReview
          ? [
              {
                id: task.caseReview.id,
                recordKey: lookupRecord(index, task.caseReview.recordId).key,
                variantIds: task.caseReview.receiptVariants.map((v) => v.id),
                decisions: task.caseReview.decisions.map((d) => ({
                  id: d.id,
                  archiveCode: d.archiveCode,
                  destination: d.destination,
                  basisDocumentId: d.basisDocumentId,
                  note: d.note,
                })),
              },
            ]
          : [],
      };
    case 'reconcile':
      return {
        id: task.id,
        kind: 'reconcile',
        sourceBatchId: task.sourceBatchId,
        subjectKey: lookupRecord(index, task.subjectRecordId).key,
        recordKeys: task.recordIds.map((id) => lookupRecord(index, id).key),
        ...(task.returnAudit
          ? {
              returnAudit: {
                id: task.returnAudit.id,
                notifyDayId: task.returnAudit.notifyDayId,
              },
            }
          : {}),
      };
    case 'return-review':
      return { id: task.id, kind: 'return-review', dayId };
    case 'field-map':
      return {
        id: task.id,
        kind: 'field-map',
        sourceFieldIds: task.sourceFields.map((f) => f.id),
        targets: task.targetFields.map((t) =>
          t.convert === 'boolean'
            ? { id: t.id, sourceId: t.sourceId, convert: 'boolean', trueValue: t.trueValue, falseValue: t.falseValue }
            : { id: t.id, sourceId: t.sourceId, convert: 'text' },
        ),
        rows: task.rows.map((r) => ({ id: r.id, values: { ...r.values } })),
      };
  }
}

/**
 * 每天一個「錯誤文件處理」位置（R11）：內容檔有定義 return-review 任務就用它（位置由內容決定）；
 * 沒有就在當日第一件工作之後插入一個虛擬任務 `task.day<N>.return-review`。
 * 它只在當天排入到期案件時才適用，其他時候不出現、也不佔序號，因此不必把退件日寫死在內容裡。
 */
export function issueTaskIdOf(day: DayContent): string {
  return `task.day${day.day}.return-review`;
}

function withIssueSlot(day: DayContent, tasks: TaskPlan[]): TaskPlan[] {
  if (tasks.some((t) => t.kind === 'return-review')) return tasks;
  const slot: TaskPlan = { id: issueTaskIdOf(day), kind: 'return-review', dayId: day.id };
  return [...tasks.slice(0, 1), slot, ...tasks.slice(1)];
}

function toDayPlan(day: DayContent, index: RecordIndex): DayPlan {
  if (day.tasks.length === 0) throw new Error(`Day ${day.id} has no task`);
  return {
    dayId: day.id,
    dayNumber: day.day,
    nextDayId: day.nextDayId,
    tasks: withIssueSlot(day, day.tasks.map((t) => toTaskPlan(t, index, day.id))),
  };
}

/**
 * 紀錄一律從傳入的 days 解析，不查全域 bundle：
 * 這樣測試可以用合成的日別驗證「新增 Day 3 不污染 Day 1」，正式資料也不會誤讀到別日。
 */
export function buildDayDirectory(days: readonly DayContent[] = CONTENT.days): DayDirectory {
  const index = indexRecords(days);
  const plans = days.map((d) => toDayPlan(d, index));
  const batchRecords: Record<BatchId, readonly SourceRecord[]> = {};
  for (const day of days) {
    for (const task of day.tasks) {
      if (task.kind !== 'archive') continue;
      batchRecords[task.batchId] = task.recordIds.map((id) => toSourceRecord(lookupRecord(index, id)));
    }
  }
  return createDayDirectory(plans, batchRecords);
}

/** 正式內容的日程目錄；載入時建立一次。 */
export const DAY_DIRECTORY: DayDirectory = buildDayDirectory();
