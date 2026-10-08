import { ALL_DOCUMENTS, ALL_TASKS, taskHeading } from '../../../content/bundle';
import { attachmentWindowTitle } from '../../mail/presenters/mail-view';
import { recordLabel } from '../../../content/records';
import { CASE_REVIEW_UI, MAIL_UI, RECORD_STATUS, WORKDAY_UI, attachmentVersionLabel, legendText } from '../../../content/text';
import { DayDirectory, findTask } from '../../../core/day-plan';
import {
  attachmentProgressOf,
  checkOfVersion,
  editableLinkIndex,
  latestLink,
  transformCheckOf,
  transformProgressOf,
} from '../../../core/workday';
import {
  AttachmentLinkVersion,
  MailAttachment,
  Save,
  TransformOutput,
  TransformRowSnapshot,
} from '../../../core/types';
import { archivedRefusalStatus } from './record-status';

/**
 * 文件視窗（M1）的純函式 presenter：郵件附件與工作中開啟的文件共用。
 *
 * - case-source：內容文件原件（標題與欄位）。
 * - archive-copy：玩家保存的歸檔送件副本（採用編號、來源編號、拒絕紀錄、案件依據）。
 * - attachment-link：附件關聯的某個送件版本（不可變副本）；只有最新版本被退回時可修訂。
 * - batch-output／batch-preview：批次的 input／rule／output 與逐列差異（已交付＝快照；預覽＝依目前設定即時建立）。
 *
 * 輸出都是玩家看得懂的文字：不含任務／紀錄／文件 ID、seed 或條件 ID；JSON 視窗的 true／false／null
 * 另附領域意義對照。
 */

/** 文件視窗的引用：郵件附件，或工作中開啟的批次預覽（不保存）。 */
export type DocumentRef = MailAttachment | { kind: 'batch-preview'; taskId: string };

export interface DocumentField {
  label: string;
  value: string;
}

/** 批次的一列（逐列差異表）。 */
export interface BatchRowView {
  id: string;
  code: string;
  /** 來源值與採用值不同時標示（只指出不同，不判斷對錯）。 */
  codeDiffers: boolean;
  sourceCode: string;
  source: string;
  adopted: string;
  output: string;
  /** 輸出值與採用值不同（本次規則改寫了它）。 */
  changed: boolean;
  origin: string;
  attachment: string;
  status: string;
  pending: boolean;
}

export interface BatchJsonView {
  input: string;
  rule: string;
  output: string;
}

export type WorkDocumentView =
  | { kind: 'source'; heading: string; fields: readonly DocumentField[] }
  | { kind: 'copy'; heading: string; fields: readonly DocumentField[] }
  | {
      kind: 'link';
      heading: string;
      versionLabel: string;
      stateText: string;
      fields: readonly DocumentField[];
      document: { heading: string; fields: readonly DocumentField[] } | null;
      /** 可以從這個版本建立修訂。 */
      editable: boolean;
      taskId: string;
      versionIndex: number;
    }
  | {
      kind: 'batch';
      heading: string;
      preview: boolean;
      rows: readonly BatchRowView[];
      json: BatchJsonView;
      legend: readonly string[];
      counts: readonly DocumentField[];
    }
  | { kind: 'missing'; heading: string };

function documentOf(id: string) {
  const doc = ALL_DOCUMENTS.find((d) => d.id === id);
  return doc?.kind === 'case-source' ? doc : undefined;
}

/** 拒絕紀錄值的顯示：true＝已拒絕、false＝未拒絕、null＝未確認。 */
export function refusalText(value: boolean | null): string {
  return value === true ? RECORD_STATUS.refused : value === false ? RECORD_STATUS.notRefused : RECORD_STATUS.unconfirmed;
}

/** JSON 視窗的領域意義對照（主操作不叫 true／false／null）。 */
export function refusalLegend(): readonly string[] {
  return [
    legendText('true', RECORD_STATUS.refused),
    legendText('false', RECORD_STATUS.notRefused),
    legendText('null', RECORD_STATUS.unconfirmed),
  ];
}

function evidenceText(evidence: 'reply' | 'receipt' | 'pending' | null): string {
  return evidence === null ? WORKDAY_UI.evidence.none : WORKDAY_UI.evidence[evidence];
}

/** 附件關聯版本的欄位（處理方式、對象、引用附件與證明範圍）。 */
function linkFields(v: AttachmentLinkVersion, choiceLabel: string): DocumentField[] {
  const fields: DocumentField[] = [
    { label: CASE_REVIEW_UI.decisionsHeading, value: choiceLabel },
    { label: WORKDAY_UI.adopted, value: v.subjectCode },
    { label: WORKDAY_UI.source, value: v.sourceCode },
  ];
  if (v.document) {
    fields.push({ label: WORKDAY_UI.chooseAttachment, value: v.document.heading });
    fields.push({ label: WORKDAY_UI.referencedEvidence, value: evidenceText(v.evidence) });
  }
  return fields;
}

/** 附件關聯版本的狀態文字（與郵件附件同一套字）。 */
function linkStateText(save: Save, taskId: string, v: AttachmentLinkVersion): string {
  const p = attachmentProgressOf(save, taskId);
  if (editableLinkIndex(p) === v.index) return MAIL_UI.current;
  if (latestLink(p)?.index !== v.index) return MAIL_UI.historical;
  const check = checkOfVersion(p, v.index);
  if (check?.outcome === 'resolved') return MAIL_UI.resolved;
  return v.checkDayId !== null && !check ? MAIL_UI.awaiting : '';
}

function originText(row: TransformRowSnapshot): string {
  return WORKDAY_UI.valueOrigin[row.valueOrigin];
}

function attachmentText(row: TransformRowSnapshot): string {
  if (row.heldForReview) return WORKDAY_UI.preserveMissing;
  if (!row.attachment) return WORKDAY_UI.evidence.none;
  const mismatch = row.attachment.attachedKey !== row.recordKey;
  return `${row.attachment.heading}（${mismatch ? WORKDAY_UI.evidence.mismatch : evidenceText(row.attachment.evidence)}）`;
}

/** 批次的 JSON：輸入（來源＋採用＋附件）、規則（缺漏策略）、輸出（逐列）。鍵為技術名稱，值保留型別。 */
function batchJson(out: TransformOutput, policyLabel: string): BatchJsonView {
  const input = out.rows.map((r) => ({
    row: r.id.replace(/^row\./, ''),
    personnelCode: r.adoptedCode,
    sourceCode: r.sourceCode,
    refusal: r.sourceRefusal,
    attachment: r.attachment ? { document: r.attachment.heading, evidence: evidenceText(r.attachment.evidence), subject: r.attachment.attachedCode } : null,
  }));
  const rule = { missingReply: policyLabel, keepSourceValue: true };
  const output = out.rows.map((r) => ({
    row: r.id.replace(/^row\./, ''),
    personnelCode: r.adoptedCode,
    refusal: r.value,
    status: WORKDAY_UI.rowStatus[r.status],
  }));
  return { input: JSON.stringify(input, null, 2), rule: JSON.stringify(rule, null, 2), output: JSON.stringify(output, null, 2) };
}

function batchRows(out: TransformOutput): BatchRowView[] {
  return out.rows.map((r) => ({
    id: r.id,
    code: r.adoptedCode ?? '',
    codeDiffers: r.adoptedCode !== null && r.sourceCode !== null && r.adoptedCode !== r.sourceCode,
    sourceCode: r.sourceCode ?? '',
    source: refusalText(r.sourceRefusal),
    adopted: r.adoptedOrigin === null ? '' : archivedRefusalStatus({ refusal: r.adoptedRefusal, origin: r.adoptedOrigin }),
    output: refusalText(r.value),
    changed: r.value !== r.sourceRefusal,
    origin: originText(r),
    attachment: attachmentText(r),
    status: WORKDAY_UI.rowStatus[r.status],
    pending: r.status === 'pending',
  }));
}

function batchCounts(out: TransformOutput): DocumentField[] {
  return [
    { label: WORKDAY_UI.submissionCount, value: String(out.deliveredCount) },
    { label: WORKDAY_UI.replyCount, value: String(out.replyCount) },
    { label: WORKDAY_UI.pendingCount, value: String(out.pendingCount) },
  ];
}

/** 批次的策略文字（任務內容的選項文字）；沒有缺漏、未選策略時為空字串。 */
export type PolicyLabels = Readonly<Record<'departmentDefault' | 'review', string>>;

/**
 * 解讀文件引用。policyLabels 為批次任務的兩個策略文字（由容器從內容取得）。
 * 找不到資料（舊存檔、內容已移除、尚未保存）一律回傳 missing，不改開最新版本。
 */
export function workDocumentView(
  ref: DocumentRef,
  save: Save,
  dir: DayDirectory,
  labels: { policy: (taskId: string) => PolicyLabels | null; choice: (taskId: string, choiceId: 'reference' | 'review') => string },
): WorkDocumentView {
  switch (ref.kind) {
    case 'case-source': {
      const doc = documentOf(ref.documentId);
      return doc
        ? { kind: 'source', heading: doc.text.heading, fields: doc.text.fields.map((f) => ({ label: f.label, value: f.value })) }
        : { kind: 'missing', heading: MAIL_UI.missingAttachment };
    }
    case 'archive-copy': {
      const a = save.batches[ref.batchId]?.archived[ref.recordKey];
      if (!a) return { kind: 'missing', heading: MAIL_UI.missingAttachment };
      const fields: DocumentField[] = [
        { label: WORKDAY_UI.adopted, value: a.archiveCode },
        { label: WORKDAY_UI.source, value: a.source.code },
      ];
      if (a.source.refusalApplies) fields.push({ label: WORKDAY_UI.columns.value, value: archivedRefusalStatus(a) });
      if (a.caseDecision) {
        const basis = documentOf(a.caseDecision.basisDocumentId);
        fields.push({ label: CASE_REVIEW_UI.basisLabel, value: basis?.text.heading ?? '' });
        fields.push({ label: CASE_REVIEW_UI.destinationLabel, value: CASE_REVIEW_UI.destination[a.caseDecision.destination] });
        fields.push({ label: CASE_REVIEW_UI.noteLabel, value: a.caseDecision.note });
      }
      return { kind: 'copy', heading: `${WORKDAY_UI.snapshotLabel}｜${recordLabel({ key: ref.recordKey, ...a.source })}`, fields };
    }
    case 'attachment-link': {
      const p = attachmentProgressOf(save, ref.taskId);
      const v = p.versions.find((x) => x.index === ref.versionIndex);
      if (!v) return { kind: 'missing', heading: MAIL_UI.missingAttachment };
      return {
        kind: 'link',
        heading: taskHeadingSafe(ref.taskId),
        versionLabel: attachmentVersionLabel(v.index),
        stateText: linkStateText(save, ref.taskId, v),
        fields: linkFields(v, labels.choice(ref.taskId, v.choiceId)),
        document: v.document ? { heading: v.document.heading, fields: v.document.fields.map((f) => ({ ...f })) } : null,
        editable: editableLinkIndex(p) === v.index,
        taskId: ref.taskId,
        versionIndex: v.index,
      };
    }
    case 'batch-output':
    case 'batch-preview': {
      const task = findTask(dir, ref.taskId);
      if (task?.kind !== 'transform') return { kind: 'missing', heading: MAIL_UI.missingAttachment };
      const p = transformProgressOf(save, ref.taskId);
      const out = ref.kind === 'batch-output' ? p.submitted : (() => {
        const check = transformCheckOf(save, dir, ref.taskId);
        return check?.ok ? check.output : undefined;
      })();
      if (!out) return { kind: 'missing', heading: MAIL_UI.missingAttachment };
      const policies = labels.policy(ref.taskId);
      const policyLabel = out.policy && policies ? policies[out.policy] : '';
      return {
        kind: 'batch',
        heading: taskHeadingSafe(ref.taskId),
        preview: ref.kind === 'batch-preview' && !p.submitted,
        rows: batchRows(out),
        json: batchJson(out, policyLabel),
        legend: refusalLegend(),
        counts: batchCounts(out),
      };
    }
    case 'return-receipt':
      return { kind: 'missing', heading: MAIL_UI.missingAttachment };
  }
}

function taskHeadingSafe(taskId: string): string {
  try {
    return taskHeading(taskId);
  } catch {
    return '';
  }
}

/** 文件視窗的標題（附件名）：來源文件標題、送件副本、附件關聯版本、批次副本或預覽輸出。 */
export function workDocumentTitle(view: WorkDocumentView, ref: DocumentRef): string {
  switch (view.kind) {
    case 'source':
    case 'copy':
    case 'missing':
      return view.heading;
    case 'link':
      return `${view.heading}｜${view.versionLabel}`;
    case 'batch':
      return `${view.heading}｜${ref.kind === 'batch-preview' && view.preview ? WORKDAY_UI.output : WORKDAY_UI.batchCopyLabel}`;
  }
}

/* ---------- 內容文字（任務的選項與策略文字）與完整標題 ---------- */

/** 任務內容的選項／策略文字（附件任務的兩種處理、批次任務的兩種策略）；不是對應任務時為 null。 */
export const CONTENT_LABELS = {
  policy(taskId: string): PolicyLabels | null {
    const task = ALL_TASKS.find((t) => t.id === taskId);
    return task?.kind === 'transform' ? { departmentDefault: task.text.departmentDefault, review: task.text.review } : null;
  },
  choice(taskId: string, choiceId: 'reference' | 'review'): string {
    const task = ALL_TASKS.find((t) => t.id === taskId);
    return task?.kind === 'attachment' ? task.text[choiceId] : '';
  },
};

/** 文件引用的完整視窗標題：退件回條沿用郵件附件名，其他依文件內容。 */
export function documentTitle(ref: DocumentRef, save: Save | null, dir: DayDirectory): string {
  if (ref.kind === 'return-receipt') return attachmentWindowTitle(save?.returns ?? [], ref);
  if (!save) return '';
  return workDocumentTitle(workDocumentView(ref, save, dir, CONTENT_LABELS), ref);
}
