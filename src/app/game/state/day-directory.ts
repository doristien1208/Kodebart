import { CONTENT } from '../content/bundle';
import { ContentAttachmentCandidate, ContentDocument, ContentRecord, ContentTask, ContentWorkday, DayContent } from '../content/schema';
import { AttachmentCandidatePlan, DayDirectory, DayPlan, TaskPlan, WorkdayMailPlan, createDayDirectory } from '../core/day-plan';
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

/** 跨日索引：紀錄、文件，以及紀錄由哪個 archive 批次歸檔（M1 的附件／批次列以此取得保存資料）。 */
interface ContentIndex {
  records: RecordIndex;
  documents: ReadonlyMap<string, ContentDocument>;
  batchOfRecord: ReadonlyMap<string, BatchId>;
}

function indexRecords(days: readonly DayContent[]): RecordIndex {
  return new Map(days.flatMap((d) => d.records).map((r) => [r.id, r] as const));
}

function indexContent(days: readonly DayContent[]): ContentIndex {
  const batchOfRecord = new Map<string, BatchId>();
  for (const day of days) {
    for (const task of day.tasks) {
      if (task.kind !== 'archive') continue;
      for (const id of task.recordIds) if (!batchOfRecord.has(id)) batchOfRecord.set(id, task.batchId);
    }
  }
  return {
    records: indexRecords(days),
    documents: new Map(days.flatMap((d) => d.documents).map((doc) => [doc.id, doc] as const)),
    batchOfRecord,
  };
}

function lookupRecord(index: RecordIndex, id: string): ContentRecord {
  const r = index.get(id);
  if (!r) throw new Error(`Unknown record ${id}`);
  return r;
}

function lookupBatch(index: ContentIndex, recordId: string): BatchId {
  const b = index.batchOfRecord.get(recordId);
  if (!b) throw new Error(`Record ${recordId} is not archived by any task`);
  return b;
}

/** 候選附件：文件內容與所屬對象（文件 recordIds 的第一筆）。 */
function toCandidate(c: ContentAttachmentCandidate, index: ContentIndex): AttachmentCandidatePlan {
  const doc = index.documents.get(c.documentId);
  if (doc?.kind !== 'case-source') throw new Error(`Attachment ${c.documentId} is not a case-source document`);
  const owner = lookupRecord(index.records, doc.recordIds[0] ?? '');
  return {
    documentId: doc.id,
    subjectKey: owner.key,
    subjectCode: owner.code,
    evidence: c.evidence,
    objection: c.evidence === 'reply' ? (c.objection ?? null) : null,
    document: { id: doc.id, heading: doc.text.heading, fields: doc.text.fields.map((f) => ({ label: f.label, value: f.value })) },
  };
}

function withDeps<T extends TaskPlan>(plan: T, task: ContentTask): T {
  return task.dependsOn && task.dependsOn.length > 0 ? { ...plan, dependsOn: [...task.dependsOn] } : plan;
}

function toTaskPlan(task: ContentTask, content: ContentIndex, dayId: string): TaskPlan {
  return withDeps(toBasePlan(task, content, dayId), task);
}

function toBasePlan(task: ContentTask, content: ContentIndex, dayId: string): TaskPlan {
  const index = content.records;
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
    case 'field-map': {
      const dyn = task.dynamic;
      const replyTarget = dyn ? task.targetFields.find((t) => t.convert === 'boolean' && t.sourceId === dyn.replyFieldId) : undefined;
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
        ...(dyn && replyTarget?.convert === 'boolean'
          ? {
              dynamic: {
                codeFieldId: dyn.codeFieldId,
                replyFieldId: dyn.replyFieldId,
                trueValue: replyTarget.trueValue,
                falseValue: replyTarget.falseValue,
                rows: dyn.rows.map((r) => ({
                  rowId: r.rowId,
                  batchId: lookupBatch(content, r.recordId),
                  recordKey: lookupRecord(index, r.recordId).key,
                  transformTaskIds: [...r.transformTaskIds],
                })),
              },
            }
          : {}),
      };
    }
    case 'attachment':
      return {
        id: task.id,
        kind: 'attachment',
        subjectBatchId: lookupBatch(content, task.subjectRecordId),
        subjectKey: lookupRecord(index, task.subjectRecordId).key,
        candidates: task.candidates.map((c) => toCandidate(c, content)),
      };
    case 'transform':
      return {
        id: task.id,
        kind: 'transform',
        rows: task.rows.map((r) => ({
          id: r.id,
          batchId: lookupBatch(content, r.recordId),
          recordKey: lookupRecord(index, r.recordId).key,
          ...(r.attachmentTaskId ? { attachmentTaskId: r.attachmentTaskId } : {}),
          ...(r.attachment ? { attachment: toCandidate(r.attachment, content) } : {}),
        })),
      };
    case 'report':
      return { id: task.id, kind: 'report', fieldMapTaskId: task.fieldMapTaskId, transformTaskIds: [...task.transformTaskIds] };
  }
}

/** M1 延後回條計畫（內容包 → core）。 */
function toMailPlans(workday: ContentWorkday | null): WorkdayMailPlan[] {
  if (!workday) return [];
  return workday.mail.outcomes.map((o) => ({
    id: o.id,
    packId: workday.mail.packId,
    templateId: o.templateId,
    dayId: o.dayId,
    ordinary: o.ordinary,
    trigger:
      o.trigger.kind === 'batch-delivered'
        ? { kind: 'batch-delivered', taskId: o.trigger.taskId, attachmentTaskId: o.trigger.attachmentTaskId ?? null }
        : { ...o.trigger },
  }));
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

function toDayPlan(day: DayContent, index: ContentIndex): DayPlan {
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
export function buildDayDirectory(
  days: readonly DayContent[] = CONTENT.days,
  workday: ContentWorkday | null = days === CONTENT.days ? CONTENT.workday : null,
): DayDirectory {
  const content = indexContent(days);
  const index = content.records;
  const plans = days.map((d) => toDayPlan(d, content));
  const batchRecords: Record<BatchId, readonly SourceRecord[]> = {};
  for (const day of days) {
    for (const task of day.tasks) {
      if (task.kind !== 'archive') continue;
      batchRecords[task.batchId] = task.recordIds.map((id) => toSourceRecord(lookupRecord(index, id)));
    }
  }
  return createDayDirectory(plans, batchRecords, toMailPlans(workday));
}

/** 正式內容的日程目錄；載入時建立一次。 */
export const DAY_DIRECTORY: DayDirectory = buildDayDirectory();
