import { dayDateLabel, dayOrder, mailPack } from '../../../content/bundle';
import { ContentMailTemplate } from '../../../content/schema';
import {
  MAIL_UI,
  MailTemplateParams,
  caseNumber,
  issueStatusLabel,
  mailReasonText,
  mailSenderName,
  mailVersionLabel,
  renderMailTemplate,
} from '../../../content/text';
import { RETURN_RECEIPT_MAIL_PACK } from '../../../core/mail';
import { editableReceiptOf } from '../../../core/rules';
import { MailAttachment, MailRecord, ReturnCase, ReturnReceipt } from '../../../core/types';

/**
 * 郵件（R12 §3）的純函式 presenter：由存檔的郵件（MailRecord）與退件案件（ReturnCase）組出畫面資料。
 *
 * - 寄件者、主旨、內文與附件名都來自內容郵件包（packId＋templateId），只代入案號、版本名稱與退件原因（純文字）。
 * - 附件依種類解讀（目前只有退件回條）；沒有附件的郵件照樣呈現，未來新增用途不必改退件規則。
 * - 附件狀態只由案件目前狀態推導：目前待處理／已送出等待／歷史版本／已結案／找不到。
 *   找不到案件或回條時一律是「找不到」，不改開最新版本。
 * - 不輸出案件、回條、郵件或日別 ID，也不輸出布林字樣。
 */

/** 附件狀態：current＝目前可修訂；awaiting＝已從這份送出、等待結果；historical＝舊版本；resolved＝結案回條；missing＝找不到。 */
export type AttachmentState = 'current' | 'awaiting' | 'historical' | 'resolved' | 'missing';

export interface MailAttachmentView {
  /** 附件引用（開啟文件用）；不顯示。 */
  ref: MailAttachment;
  /** 附件名，例如「RT-B102｜修訂 1｜核對結果」。 */
  label: string;
  state: AttachmentState;
  /** 狀態文字（目前待處理版本／已送出・等待核對／待窗口回覆／歷史版本・僅供檢閱／已結案／找不到附件）。 */
  stateText: string;
}

export interface MailView {
  /** 追蹤與選取用（郵件的保存 ID）；不顯示。 */
  id: string;
  sender: string;
  subject: string;
  lines: readonly string[];
  /** 收到時間（遊戲日的日期文字）。 */
  received: string;
  read: boolean;
  attachments: readonly MailAttachmentView[];
  /** 有目前可修訂的附件（「待處理」篩選）；與已讀無關。 */
  pending: boolean;
  /** 郵件包或模板已不存在（舊存檔、內容移除）：畫面顯示讀取失敗與重試。 */
  failed: boolean;
}

export type MailFilter = 'all' | 'unread' | 'pending';
export const MAIL_FILTERS: readonly MailFilter[] = ['all', 'unread', 'pending'];

/** 退件回條附件解讀後的案件與回條。 */
export interface ResolvedReceipt {
  item: ReturnCase;
  receipt: ReturnReceipt;
}

/**
 * 解讀退件回條附件：案件、回條都要存在，而且回條引用的版本與附件相同（null＝原始送件）、該版本確實保存過。
 * 任何一項對不上都回傳 null（找不到），不退回最新版本。
 */
export function resolveReceipt(returns: readonly ReturnCase[], ref: MailAttachment): ResolvedReceipt | null {
  if (ref.kind !== 'return-receipt') return null;
  const item = returns.find((r) => r.id === ref.caseId);
  const receipt = item?.receipts.find((r) => r.id === ref.receiptId);
  if (!item || !receipt || receipt.versionIndex !== ref.versionIndex) return null;
  if (receipt.versionIndex !== null && !item.versions.some((v) => v.index === receipt.versionIndex)) return null;
  return { item, receipt };
}

/** 附件狀態（只看案件目前狀態；可修訂與否與 core editableReceiptOf 同一規則）。 */
export function attachmentState(returns: readonly ReturnCase[], ref: MailAttachment): AttachmentState {
  const found = resolveReceipt(returns, ref);
  if (!found) return 'missing';
  const { item, receipt } = found;
  if (receipt.kind === 'resolved') return 'resolved';
  if (editableReceiptOf(item)?.id === receipt.id) return 'current';
  const latest = item.receipts[item.receipts.length - 1];
  if (latest?.id !== receipt.id) return 'historical';
  return item.status === 'awaiting-check' || item.status === 'awaiting-window' ? 'awaiting' : 'historical';
}

/** 狀態文字；已從這份送窗口待查時顯示「待窗口回覆」（不會再有核對結果），其餘用郵件介面字。 */
export function attachmentStateText(state: AttachmentState, item: ReturnCase | null): string {
  switch (state) {
    case 'current':
      return MAIL_UI.current;
    case 'awaiting':
      return item?.status === 'awaiting-window' ? issueStatusLabel('awaiting-window') : MAIL_UI.awaiting;
    case 'historical':
      return MAIL_UI.historical;
    case 'resolved':
      return MAIL_UI.resolved;
    case 'missing':
      return MAIL_UI.missingAttachment;
  }
}

/** 模板代入值：案號、版本名稱、退件原因；案件找不到時只代入附件上的版本名稱。 */
function paramsOf(returns: readonly ReturnCase[], ref: MailAttachment): MailTemplateParams {
  const found = resolveReceipt(returns, ref);
  if (!found) {
    const item = returns.find((r) => r.id === ref.caseId);
    return {
      caseNumber: item ? caseNumber(item.auditId, item.recordKey) : '',
      versionLabel: mailVersionLabel(ref.versionIndex),
    };
  }
  const { item, receipt } = found;
  return {
    caseNumber: caseNumber(item.auditId, item.recordKey),
    versionLabel: mailVersionLabel(receipt.versionIndex),
    reason: mailReasonText(receipt.reason),
  };
}

function templateOf(packId: string, templateId: string): ContentMailTemplate | undefined {
  const templates = mailPack(packId)?.templates as Readonly<Record<string, ContentMailTemplate | undefined>> | undefined;
  return templates?.[templateId];
}

/** 未知日（舊存檔的日已從內容移除）時為空字串，不讓整個收件匣失敗。 */
function receivedLabel(dayId: string): string {
  try {
    return dayDateLabel(dayId);
  } catch {
    return '';
  }
}

/** 附件文件視窗的標題（退件回條包的附件名）；找不到案件時退回「附件」。 */
export function attachmentWindowTitle(returns: readonly ReturnCase[], ref: MailAttachment): string {
  const found = resolveReceipt(returns, ref);
  const template = found ? templateOf(RETURN_RECEIPT_MAIL_PACK, found.receipt.kind) : undefined;
  return template ? renderMailTemplate(template.attachmentLabel, paramsOf(returns, ref)) : MAIL_UI.attachments;
}

/** 一封郵件的畫面資料。 */
export function mailView(mail: MailRecord, returns: readonly ReturnCase[], read: boolean): MailView {
  const sender = mailSenderName(mail.packId);
  const template = templateOf(mail.packId, mail.templateId);
  const received = receivedLabel(mail.dayId);
  if (sender === undefined || template === undefined) {
    return { id: mail.id, sender: '', subject: '', lines: [], received, read, attachments: [], pending: false, failed: true };
  }
  // 主旨與內文以第一份附件代入（沒有附件時 placeholder 代入空字串）
  const first = mail.attachments[0];
  const params = first ? paramsOf(returns, first) : {};
  const attachments = mail.attachments.map((ref) => {
    const state = attachmentState(returns, ref);
    return {
      ref,
      label: renderMailTemplate(template.attachmentLabel, paramsOf(returns, ref)),
      state,
      stateText: attachmentStateText(state, returns.find((r) => r.id === ref.caseId) ?? null),
    };
  });
  return {
    id: mail.id,
    sender,
    subject: renderMailTemplate(template.subject, params),
    lines: template.lines.map((line) => renderMailTemplate(line, params)),
    received,
    read,
    attachments,
    pending: attachments.some((a) => a.state === 'current'),
    failed: false,
  };
}

/**
 * 收件匣：新的在前（依收到日，同日後寄的在前；存檔順序即寄送順序）。
 * `isRead` 只查已讀，不寫入——開收件匣不會標任何郵件已讀。
 */
export function buildMailViews(
  mailbox: readonly MailRecord[],
  returns: readonly ReturnCase[],
  isRead: (mailId: string) => boolean,
): MailView[] {
  return mailbox
    .map((mail, i) => ({ mail, i, order: dayOrder(mail.dayId) || 0 }))
    .sort((a, b) => b.order - a.order || b.i - a.i)
    .map(({ mail }) => mailView(mail, returns, isRead(mail.id)));
}

export function mailMatches(view: MailView, filter: MailFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unread':
      return !view.read;
    case 'pending':
      return view.pending;
  }
}

/** 各篩選的件數。 */
export function mailCounts(views: readonly MailView[]): Readonly<Record<MailFilter, number>> {
  return {
    all: views.length,
    unread: views.filter((v) => mailMatches(v, 'unread')).length,
    pending: views.filter((v) => mailMatches(v, 'pending')).length,
  };
}

/** 案件最新回條所在的郵件與附件（當日工作「開啟最新郵件」用）；找不到為 null。 */
export function latestMailOfCase(
  mailbox: readonly MailRecord[],
  returns: readonly ReturnCase[],
  caseId: string,
): { mail: MailRecord; ref: MailAttachment } | null {
  const item = returns.find((r) => r.id === caseId);
  const latest = item?.receipts[item.receipts.length - 1];
  if (!latest) return null;
  for (let i = mailbox.length - 1; i >= 0; i--) {
    const mail = mailbox[i] as MailRecord;
    const ref = mail.attachments.find((a) => a.kind === 'return-receipt' && a.caseId === caseId && a.receiptId === latest.id);
    if (ref) return { mail, ref };
  }
  return null;
}
