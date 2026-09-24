import { MailRecord, ReturnCase, ReturnReceipt } from './types';

/** 退件／收件回條郵件的內容郵件包（R12）；模板 ID＝回條種類（returned／resolved）。 */
export const RETURN_RECEIPT_MAIL_PACK = 'mail.return-receipts';

/** 回條郵件的模板 ID（與回條種類相同）。 */
export const RETURN_RECEIPT_TEMPLATES: readonly ReturnReceipt['kind'][] = ['returned', 'resolved'];

/** 回條郵件的固定 ID：同一份回條只寄一次，刷新也不重寄。 */
export function mailIdOfReceipt(receiptId: string): string {
  return `mail.${receiptId}`;
}

/** 回條對應的郵件（寄件者與文字由內容郵件包提供；附件引用案件、回條與送件版本）。 */
export function receiptMail(item: ReturnCase, receipt: ReturnReceipt): MailRecord {
  return {
    id: mailIdOfReceipt(receipt.id),
    packId: RETURN_RECEIPT_MAIL_PACK,
    templateId: receipt.kind,
    dayId: receipt.dayId,
    attachments: [{ kind: 'return-receipt', caseId: item.id, receiptId: receipt.id, versionIndex: receipt.versionIndex }],
  };
}
