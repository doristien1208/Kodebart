import { dayDateLabel } from '../../../content/bundle';
import { DOCUMENT_ISSUES_UI, MAIL_UI, RECORD_REVIEW_UI, issueStatusLabel, receiptLabel } from '../../../content/text';
import { RETURN_RECEIPT_MAIL_PACK } from '../../../core/mail';
import { MailAttachment, MailRecord } from '../../../core/types';
import { GameStateService } from '../../../state/game-state.service';
import { onlyCase, receiptRef, resubmitNow, toFirstReturn, toNextDay } from '../testing/mail-play';
import { AttachmentDocumentView, attachmentDocument } from './attachment-view';
import { MailView, attachmentState, buildMailViews, latestMailOfCase, mailCounts, mailMatches, mailView } from './mail-view';

/**
 * 郵件 presenter（R12 §1／§3）：主旨／內文／附件名來自郵件包模板；附件狀態只由案件目前狀態推導；
 * 找不到案件或回條一律「找不到」，不改開最新版本；沒有附件的郵件照樣呈現；不輸出內部 ID。
 */

function views(game: GameStateService): MailView[] {
  return buildMailViews(game.mailbox(), game.returns(), (id) => game.isMailRead(id));
}

/** 附件文件（姓名取自存檔批次的提交快照）。 */
function documentOf(game: GameStateService, ref: MailAttachment): AttachmentDocumentView | null {
  return attachmentDocument(game.returns(), game.save()?.batches ?? {}, ref);
}

/** 畫面文字（主旨、內文、附件名、狀態）。 */
function visibleText(v: MailView): string {
  return [v.sender, v.subject, ...v.lines, v.received, ...v.attachments.flatMap((a) => [a.label, a.stateText])].join('\n');
}

const INTERNAL = /return\.|mail\.|task\.|batch\.|day\.0|#\d|\b(true|false|null|undefined)\b/;

describe('mail-view presenter（R12 郵件）', () => {
  afterEach(() => localStorage.clear());

  it('Day 3 退件郵件：寄件者、主旨、內文代入案號／原始送件／退件原因、收到時間；未讀、待處理、附件為目前版本', () => {
    const game = toFirstReturn();
    const [mail] = views(game);
    expect(views(game).length).toBe(1);
    expect(mail?.sender).toBe('資料作業窗口');
    expect(mail?.subject).toBe('文件退回｜RT-B102');
    expect(mail?.lines).toContain('案件：RT-B102');
    expect(mail?.lines).toContain(`核對版本：${MAIL_UI.initialVersion}`);
    expect(mail?.lines).toContain(`退回原因：${MAIL_UI.codeMismatch}`);
    expect(mail?.received).toBe(dayDateLabel('day.03'));
    expect(mail?.read).toBeFalse();
    expect(mail?.pending).toBeTrue();
    expect(mail?.failed).toBeFalse();
    expect(mail?.attachments.map((a) => [a.label, a.state, a.stateText])).toEqual([
      [`RT-B102｜${MAIL_UI.initialVersion}｜核對結果`, 'current', MAIL_UI.current],
    ]);
    expect(visibleText(mail as MailView)).not.toMatch(INTERNAL);
  });

  it('已讀只看 readMail；重新送審後附件變「已送出・等待核對」、不再待處理；送窗口顯示「待窗口回覆」', () => {
    let game = toFirstReturn();
    game.markMailRead([game.mailbox()[0]?.id ?? '']);
    expect(views(game)[0]?.read).toBeTrue();
    resubmitNow(game, '102');
    expect(views(game)[0]?.attachments[0]?.state).toBe('awaiting');
    expect(views(game)[0]?.attachments[0]?.stateText).toBe(MAIL_UI.awaiting);
    expect(views(game)[0]?.pending).toBeFalse();

    game = toFirstReturn();
    const item = onlyCase(game);
    expect(game.sendReturnToWindowStrict(item.id, game.editableReceiptId(item.id) ?? '')).toBe('ok');
    expect(views(game)[0]?.attachments[0]?.state).toBe('awaiting');
    expect(views(game)[0]?.attachments[0]?.stateText).toBe(issueStatusLabel('awaiting-window'));
  });

  it('再次退回：新郵件在前（修訂 1、目前版本），舊郵件的附件變歷史版本；各自保留當時核對的編號', () => {
    const game = toFirstReturn();
    toNextDay(game); // Day 4
    resubmitNow(game, '1020');
    toNextDay(game); // Day 5：下游核對 1020 ≠ 0102 → 再次退回
    const list = views(game);
    expect(list.map((v) => v.subject)).toEqual(['文件退回｜RT-B102', '文件退回｜RT-B102']);
    expect(list.map((v) => v.received)).toEqual([dayDateLabel('day.05'), dayDateLabel('day.03')]);
    expect(list.map((v) => v.attachments[0]?.label)).toEqual([
      'RT-B102｜修訂 1｜核對結果',
      `RT-B102｜${MAIL_UI.initialVersion}｜核對結果`,
    ]);
    expect(list.map((v) => v.attachments[0]?.state)).toEqual(['current', 'historical']);
    expect(list.map((v) => v.pending)).toEqual([true, false]);
    expect(list[0]?.lines).toContain('核對版本：修訂 1');

    const older = documentOf(game, receiptRef(game, 0));
    const newer = documentOf(game, receiptRef(game, 1));
    expect(older?.checkedCode).toBe('102');
    expect(older?.versions).toEqual([]);
    expect(older?.banner).toBe(MAIL_UI.historical);
    expect(newer?.checkedCode).toBe('1020');
    expect(newer?.versions.map((v) => [v.code, v.result])).toEqual([['1020', DOCUMENT_ISSUES_UI.outcome.returned]]);
    expect(latestMailOfCase(game.mailbox(), game.returns(), onlyCase(game).id)?.ref).toEqual(receiptRef(game, 1));
  });

  it('正確修訂：隔日「文件核對完成」郵件，附件為已結案；舊附件為歷史版本', () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '0102');
    toNextDay(game);
    const [resolved, first] = views(game);
    expect(resolved?.subject).toBe('文件核對完成｜RT-B102');
    expect(resolved?.lines).toContain('核對版本：修訂 1');
    expect(resolved?.attachments[0]?.state).toBe('resolved');
    expect(resolved?.attachments[0]?.stateText).toBe(MAIL_UI.resolved);
    expect(resolved?.pending).toBeFalse();
    expect(first?.attachments[0]?.state).toBe('historical');

    const doc = documentOf(game, receiptRef(game, 1));
    expect(doc?.kind).toBe('resolved');
    expect(doc?.title).toBe(receiptLabel('resolved', 'RT-B102'));
    expect(doc?.checkedCode).toBe('0102');
    expect(doc?.reason).toBe('');
    expect(doc?.resolvedNote).toBe(DOCUMENT_ISSUES_UI.receipts.resolvedNote);
    expect(doc?.sourceCode).toBe('0102');
    expect(doc?.submittedCode).toBe('102');
    expect(doc?.reviewedCode).toBe('102');
    expect(RECORD_REVIEW_UI.release).toBe('核對後放行');
  });

  it('沒有附件的通用郵件照樣呈現；郵件包或模板不存在時標為讀取失敗', () => {
    const game = toFirstReturn();
    const plain: MailRecord = { id: 'mail.plain', packId: RETURN_RECEIPT_MAIL_PACK, templateId: 'resolved', dayId: 'day.03', attachments: [] };
    const v = mailView(plain, game.returns(), false);
    expect(v.failed).toBeFalse();
    expect(v.attachments).toEqual([]);
    expect(v.pending).toBeFalse();
    expect(v.subject).toBe('文件核對完成｜');
    expect(v.lines.length).toBeGreaterThan(0);

    expect(mailView({ ...plain, packId: 'mail.removed' }, game.returns(), false).failed).toBeTrue();
    expect(mailView({ ...plain, templateId: 'removed' }, game.returns(), false).failed).toBeTrue();
    // 未知日：收到時間為空字串，不丟例外
    expect(mailView({ ...plain, dayId: 'day.99' }, game.returns(), false).received).toBe('');
  });

  it('找不到案件、回條或版本對不上：附件為「找不到」，文件為 null（不改開最新版本）', () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '1020');
    toNextDay(game);
    const ref = receiptRef(game, 0);
    expect(attachmentState(game.returns(), { ...ref, receiptId: 'return.x#9' })).toBe('missing');
    expect(attachmentState(game.returns(), { ...ref, caseId: 'return.none' })).toBe('missing');
    expect(attachmentState(game.returns(), { ...ref, versionIndex: 0 })).toBe('missing');
    expect(documentOf(game, { ...ref, versionIndex: 0 })).toBeNull();
    const mail: MailRecord = {
      id: 'mail.lost',
      packId: RETURN_RECEIPT_MAIL_PACK,
      templateId: 'returned',
      dayId: 'day.05',
      attachments: [{ ...ref, receiptId: 'return.x#9' }],
    };
    const v = mailView(mail, game.returns(), true);
    expect(v.attachments[0]?.state).toBe('missing');
    expect(v.attachments[0]?.stateText).toBe(MAIL_UI.missingAttachment);
    expect(v.pending).toBeFalse();
    expect(visibleText(v)).not.toMatch(INTERNAL);
  });

  it('篩選與件數：全部／未讀／待處理各自計算', () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '1020');
    toNextDay(game);
    game.markMailRead([game.mailbox()[0]?.id ?? '']);
    const list = views(game);
    expect(mailCounts(list)).toEqual({ all: 2, unread: 1, pending: 1 });
    expect(list.filter((v) => mailMatches(v, 'unread')).map((v) => v.received)).toEqual([dayDateLabel('day.05')]);
    expect(list.filter((v) => mailMatches(v, 'pending')).map((v) => v.received)).toEqual([dayDateLabel('day.05')]);
  });
});
