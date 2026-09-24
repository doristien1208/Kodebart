import { dayDateLabel } from '../../../content/bundle';
import { caseNumber, issueStatusLabel } from '../../../content/text';
import { DayDirectory } from '../../../core/day-plan';
import { handledOnOrAfter } from '../../../core/rules';
import { MailAttachment, ReturnCase, ReturnStatus } from '../../../core/types';
import { attachmentWindowTitle } from '../../mail/presenters/mail-view';

/**
 * 每日「錯誤文件處理」工作（R12）的純函式 presenter：今天排定的案件一列一件。
 * 只呈現案號、目前狀態、最新回條（附件名＋收到時間）與今天是否已處理；
 * 修訂一律從郵件附件進行，這裡不帶可編輯欄位。不輸出內部 ID 或布林字樣。
 */

export interface ReturnTaskRow {
  /** 案件的保存 ID（開啟最新郵件用）；不顯示。 */
  id: string;
  caseNumber: string;
  status: ReturnStatus;
  statusText: string;
  /** 最新回條的附件名，例如「RT-B102｜修訂 1｜核對結果」；沒有回條為空字串。 */
  latestLabel: string;
  /** 最新回條的收到時間。 */
  latestReceived: string;
  /** 今天（或之後）已有處理版本（重送或轉待查）＝本日已處理；不等於已解決。 */
  handled: boolean;
}

/** 案件最新回條的附件引用；沒有回條時為 null。 */
export function latestReceiptRef(item: ReturnCase): MailAttachment | null {
  const latest = item.receipts[item.receipts.length - 1];
  return latest ? { kind: 'return-receipt', caseId: item.id, receiptId: latest.id, versionIndex: latest.versionIndex } : null;
}

function safeDate(dayId: string): string {
  try {
    return dayDateLabel(dayId);
  } catch {
    return '';
  }
}

export function returnTaskRows(
  items: readonly ReturnCase[],
  taskDayId: string,
  dir: DayDirectory,
): ReturnTaskRow[] {
  return items.map((item) => {
    const ref = latestReceiptRef(item);
    const latest = item.receipts[item.receipts.length - 1];
    return {
      id: item.id,
      caseNumber: caseNumber(item.auditId, item.recordKey),
      status: item.status,
      statusText: issueStatusLabel(item.status),
      latestLabel: ref ? attachmentWindowTitle(items, ref) : '',
      latestReceived: latest ? safeDate(latest.dayId) : '',
      handled: handledOnOrAfter(item, taskDayId, dir),
    };
  });
}
