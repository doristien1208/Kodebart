import { ALL_TASKS, dayDateLabel, dayOrder, recordsOfTask } from '../../../content/bundle';
import {
  DOCUMENT_ISSUES_UI,
  RETURNED_REVIEW_UI,
  caseNumber,
  issueSourceTaskLabel,
  issueSubmissionLabel,
  mailReasonText,
  mailVersionLabel,
  receiptLabel,
} from '../../../content/text';
import { MailAttachment, ReturnCase, ReturnVersion } from '../../../core/types';
import { AttachmentState, attachmentState, attachmentStateText, resolveReceipt } from './mail-view';

/**
 * 郵件附件文件（R12 §1）的純函式 presenter：固定呈現「這份回條」當時的快照。
 *
 * - 核對的編號、結果與日期取自回條本身；原件（原始來源、第一次送件）與第二輪審查紀錄是案件的不可變欄位。
 * - 歷次修改只列到回條引用的版本為止（原始送件的回條沒有修改紀錄），之後的送件不會出現在舊附件裡。
 * - 狀態（目前待處理／已送出／歷史／已結案）由 mail-view 的同一規則推導；找不到案件或回條為 null，不改開最新版本。
 * - 不輸出內部 ID、日別代碼或布林字樣。
 */

/** 歷次修改的一列（快照範圍內）。 */
export interface AttachmentVersionRow {
  index: number;
  /** 「第 N 次送件」（原始送件為第 1 次）。 */
  submission: string;
  /** 受理日＋處理方式，例如「第四日 · 重新送審」。 */
  action: string;
  code: string;
  /** 下游結果：核對一致／再次退回；送窗口為等待窗口回覆。 */
  result: string;
  outcome: 'resolved' | 'returned' | null;
}

export interface AttachmentDocumentView {
  state: Exclude<AttachmentState, 'missing'>;
  /** 版本狀態橫幅文字。 */
  banner: string;
  caseNumber: string;
  /** 「原始送件」／「修訂 N」。 */
  versionLabel: string;
  kind: 'returned' | 'resolved';
  /** 回條標題，例如「退件回條：RT-B102」／「收件回條：RT-B102」。 */
  title: string;
  /** 這次核對的送件編號（原字串）。 */
  checkedCode: string;
  /** 退件原因；收件回條為空字串。 */
  reason: string;
  /** 收件回條的結案說明；退件回條為空字串。 */
  resolvedNote: string;
  /** 回條日期（收到時間）。 */
  received: string;
  /** 紀錄姓名；原工作已不在內容中為 null。 */
  name: string | null;
  sourceCode: string;
  submittedCode: string;
  reviewedCode: string;
  versions: readonly AttachmentVersionRow[];
}

function dayNumberOf(dayId: string): number {
  return dayOrder(dayId);
}

function safeDate(dayId: string): string {
  try {
    return dayDateLabel(dayId);
  } catch {
    return '';
  }
}

/** 紀錄姓名（取自原歸檔工作引用的來源紀錄）；內容已移除該工作時為 null。 */
export function recordNameOf(item: ReturnCase): string | null {
  if (!ALL_TASKS.some((t) => t.id === item.archiveTaskId)) return null;
  return recordsOfTask(item.archiveTaskId).find((r) => r.key === item.recordKey)?.name ?? null;
}

function versionResult(v: ReturnVersion): string {
  if (v.outcome) return DOCUMENT_ISSUES_UI.outcome[v.outcome];
  return v.action === 'window' ? DOCUMENT_ISSUES_UI.next.windowWaiting : '';
}

/** 快照範圍內的歷次修改：只到回條引用的版本（null＝原始送件，沒有修改）。 */
export function snapshotVersionRows(item: ReturnCase, upTo: number | null): AttachmentVersionRow[] {
  if (upTo === null) return [];
  return item.versions
    .filter((v) => v.index <= upTo)
    .map((v) => ({
      index: v.index,
      submission: issueSubmissionLabel(v.index + 2),
      action: issueSourceTaskLabel(
        dayNumberOf(v.dayId),
        v.action === 'resubmit' ? RETURNED_REVIEW_UI.resubmit : RETURNED_REVIEW_UI.sendToWindow,
      ),
      code: v.code,
      result: versionResult(v),
      outcome: v.outcome ?? null,
    }));
}

/** 附件文件的畫面資料；找不到案件、回條或版本時為 null。 */
export function attachmentDocument(returns: readonly ReturnCase[], ref: MailAttachment): AttachmentDocumentView | null {
  const found = resolveReceipt(returns, ref);
  if (!found) return null;
  const { item, receipt } = found;
  const state = attachmentState(returns, ref) as Exclude<AttachmentState, 'missing'>;
  const number = caseNumber(item.auditId, item.recordKey);
  return {
    state,
    banner: attachmentStateText(state, item),
    caseNumber: number,
    versionLabel: mailVersionLabel(receipt.versionIndex),
    kind: receipt.kind,
    title: receiptLabel(receipt.kind, number),
    checkedCode: receipt.code,
    reason: receipt.kind === 'returned' ? mailReasonText(receipt.reason) : '',
    resolvedNote: receipt.kind === 'resolved' ? DOCUMENT_ISSUES_UI.receipts.resolvedNote : '',
    received: safeDate(receipt.dayId),
    name: recordNameOf(item),
    sourceCode: item.sourceCode,
    submittedCode: item.submittedCode,
    reviewedCode: item.reviewedCode,
    versions: snapshotVersionRows(item, receipt.versionIndex),
  };
}
