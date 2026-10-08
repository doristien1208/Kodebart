import { ComponentFixture, TestBed } from '@angular/core/testing';
import { dayDateLabel } from '../../../content/bundle';
import {
  DOCUMENT_ISSUES_UI,
  MAIL_UI,
  OPERATION_UI,
  RECORD_REVIEW_UI,
  issueStatusLabel,
  receiptLabel,
} from '../../../content/text';
import { EVENT_KINDS } from '../../../core/rules';
import { MailAttachment, ReturnReceiptAttachment } from '../../../core/types';
import { VALIDATION_MESSAGES } from '../../../core/validate';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { settle } from '../../testing/play';
import { MailAttachmentService, attachmentWindowId } from '../services/mail-attachment.service';
import { bootGame, onlyCase, receiptRef, resubmitNow, rewriteSave, toFirstReturn, toNextDay } from '../testing/mail-play';
import { MailAttachmentWindowsComponent } from './mail-attachment-windows.component';

/**
 * R12 §1 版本鎖定的郵件附件：每份回條一個視窗、固定呈現該回條的快照；
 * 只有案件最新退件（待修正）可修訂，舊附件、已送出、待窗口、已結案都唯讀；
 * 兩個視窗不會重複送出或回寫舊版本；過期草稿只供查看；找不到附件不改開最新版本。
 */

function render(): ComponentFixture<MailAttachmentWindowsComponent> {
  const f = TestBed.createComponent(MailAttachmentWindowsComponent);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<unknown>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function open(ref: MailAttachment): void {
  TestBed.inject(MailAttachmentService).open(ref);
}

/** 某份回條的附件視窗。 */
function win(f: ComponentFixture<unknown>, ref: ReturnReceiptAttachment): HTMLElement {
  const w = el(f).querySelector<HTMLElement>(`[data-window-id="${attachmentWindowId(ref)}"]`);
  if (!w) throw new Error(`沒有 ${ref.receiptId} 的視窗`);
  return w;
}

function field(w: Element, name: string): string {
  return text(w.querySelector(`[data-doc-field="${name}"]`));
}

function typeCode(f: ComponentFixture<unknown>, w: Element, value: string): void {
  const input = w.querySelector<HTMLInputElement>('[data-doc-code]');
  if (!input) throw new Error('沒有修訂欄位');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
}

async function act(f: ComponentFixture<unknown>, w: Element, action: 'resubmit' | 'window'): Promise<void> {
  w.querySelector<HTMLButtonElement>(`[data-doc-action="${action}"]`)?.click();
  f.detectChanges();
  await settle();
  f.detectChanges();
}

const INTERNAL = /return\.|mail\.|task\.|batch\.|day\.0|#\d|\b(true|false|null|undefined)\b/;

describe('MailAttachmentWindowsComponent（R12 版本鎖定附件）', () => {
  afterEach(() => localStorage.clear());

  it('Day 3 原始送件附件：視窗標題為附件名；快照、原件與第二輪審查；目前版本可修訂，預填回條核對的編號', () => {
    const game = toFirstReturn();
    const ref = receiptRef(game, 0);
    open(ref);
    const f = render();
    const w = win(f, ref);
    expect(text(w.querySelector('[data-window-bar] [role="heading"]'))).toBe(`RT-B102｜${MAIL_UI.initialVersion}｜核對結果`);
    expect(text(w.querySelector('[data-doc-banner]'))).toBe(MAIL_UI.current);
    expect(text(w.querySelector('[data-doc-case]'))).toBe('RT-B102');
    expect(text(w.querySelector('[data-doc-version]'))).toBe(MAIL_UI.initialVersion);
    expect(text(w.querySelector('[data-doc-title]'))).toBe(receiptLabel('returned', 'RT-B102'));
    expect(field(w, 'checked')).toBe('102');
    expect(field(w, 'reason')).toBe(MAIL_UI.codeMismatch);
    expect(field(w, 'received')).toBe(dayDateLabel('day.03'));
    expect(field(w, 'source')).toBe('0102');
    expect(field(w, 'first')).toBe('102');
    expect(field(w, 'review')).toBe(`${RECORD_REVIEW_UI.release} 102`);
    expect(w.querySelector('[data-doc-section="versions"]')).toBeNull();
    expect(w.querySelector<HTMLInputElement>('[data-doc-code]')?.value).toBe('102');
    expect(w.querySelector('[data-doc-stale]')).toBeNull();
    expect(text(w)).not.toMatch(INTERNAL);
    // 重複開啟只置前，不多開視窗
    open(ref);
    f.detectChanges();
    expect(el(f).querySelectorAll('[data-mail-attachment-window]').length).toBe(1);
  });

  it('草稿即存入存檔：關閉視窗、重新整理後再開仍是草稿；空白只提示必填、不送出', async () => {
    let game = toFirstReturn();
    const ref = receiptRef(game, 0);
    open(ref);
    let f = render();
    typeCode(f, win(f, ref), '01');
    expect(game.issueDraft(ref.receiptId)).toBe('01');

    TestBed.inject(WindowManagerService).close(attachmentWindowId(ref));
    f.detectChanges();
    open(ref);
    f.detectChanges();
    expect(win(f, ref).querySelector<HTMLInputElement>('[data-doc-code]')?.value).toBe('01');
    f.destroy();

    game = bootGame();
    open(ref);
    f = render();
    const w = win(f, ref);
    expect(w.querySelector<HTMLInputElement>('[data-doc-code]')?.value).toBe('01');
    typeCode(f, w, '   ');
    await act(f, w, 'resubmit');
    expect(text(w.querySelector('.field-error'))).toBe(VALIDATION_MESSAGES.codeRequired);
    expect(w.querySelector('[data-doc-code]')?.getAttribute('aria-invalid')).toBe('true');
    expect(game.returns()[0]?.versions).toEqual([]);
  });

  it('連續三次退件：三封退件郵件各自一份附件；舊附件保留各自的核對編號且唯讀，只有最新可修訂', async () => {
    const game = toFirstReturn();
    const first = receiptRef(game, 0);
    toNextDay(game); // Day 4
    open(first);
    const f = render();
    typeCode(f, win(f, first), '1020');
    await act(f, win(f, first), 'resubmit');
    expect(onlyCase(game).status).toBe('awaiting-check');
    // 送出成功：同一視窗變唯讀，顯示已送出
    expect(win(f, first).querySelector('[data-doc-code]')).toBeNull();
    expect(text(win(f, first).querySelector('[data-doc-banner]'))).toBe(MAIL_UI.awaiting);
    expect(text(win(f, first).querySelector('[data-operation-stage]'))).toContain(OPERATION_UI.done);

    toNextDay(game); // Day 5：1020 ≠ 0102 → 再次退回
    const second = receiptRef(game, 1);
    open(second);
    f.detectChanges();
    expect(win(f, second).querySelector<HTMLInputElement>('[data-doc-code]')?.value).toBe('1020');
    typeCode(f, win(f, second), '0103');
    await act(f, win(f, second), 'resubmit');

    toNextDay(game); // Day 6：0103 ≠ 0102 → 第三封退件
    expect(game.dayId()).toBe('day.06');
    expect(game.mailbox().map((m) => m.templateId)).toEqual(['returned', 'returned', 'returned']);
    const third = receiptRef(game, 2);
    open(third);
    f.detectChanges();

    const windows = [first, second, third].map((r) => win(f, r));
    expect(windows.map((w) => field(w, 'checked'))).toEqual(['102', '1020', '0103']);
    expect(windows.map((w) => text(w.querySelector('[data-doc-version]')))).toEqual([MAIL_UI.initialVersion, '修訂 1', '修訂 2']);
    expect(windows.map((w) => text(w.querySelector('[data-doc-banner]')))).toEqual([
      MAIL_UI.historical,
      MAIL_UI.historical,
      MAIL_UI.current,
    ]);
    expect(windows.map((w) => w.querySelector('[data-doc-code]') !== null)).toEqual([false, false, true]);
    expect(windows.map((w) => w.querySelectorAll('[data-doc-version-row]').length)).toEqual([0, 1, 2]);
    // 最新附件預填最後一次實際送出的值（不是來源值）
    expect(windows[2]?.querySelector<HTMLInputElement>('[data-doc-code]')?.value).toBe('0103');
    // 舊附件沒有修訂按鈕、狀態層也拒絕舊回條送出
    const ops = TestBed.inject(WorkOperationsService);
    expect(await ops.resubmitReturn(onlyCase(game).id, first.receiptId, '0102')).toBeFalse();
    expect(await ops.sendReturnToWindow(onlyCase(game).id, second.receiptId)).toBeFalse();
    expect(onlyCase(game).versions.length).toBe(2);
    expect(onlyCase(game).status).toBe('pending');
  });

  it('兩個視窗：處理中另一個入口先送出時，本次提交以失敗結束、不覆寫新版本；同案所有視窗改為唯讀', async () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '1020');
    toNextDay(game); // Day 5：兩份回條
    const first = receiptRef(game, 0);
    const second = receiptRef(game, 1);
    open(first);
    open(second);
    const f = render();
    expect(win(f, first).querySelector('[data-doc-form]')).toBeNull();
    expect(win(f, second).querySelector('[data-doc-form]')).not.toBeNull();

    // 讓提交停在「資料處理中」：期間另一個入口先送窗口待查
    TestBed.inject(SettingsService).motion.set(true);
    TestBed.inject(SettingsService).reducedMotion.set(false);
    const ops = TestBed.inject(WorkOperationsService);
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    ops.wait = () => (++calls === 2 ? hold : Promise.resolve());

    typeCode(f, win(f, second), '0102');
    win(f, second).querySelector<HTMLButtonElement>('[data-doc-action="resubmit"]')?.click();
    await settle();
    f.detectChanges();
    expect(ops.busy()).toBeTrue();
    expect(win(f, second).querySelector<HTMLButtonElement>('[data-doc-action="resubmit"]')?.disabled).toBeTrue();
    expect(game.sendReturnToWindowStrict(onlyCase(game).id, second.receiptId)).toBe('ok');
    release();
    await settle();
    f.detectChanges();

    const item = onlyCase(game);
    expect(item.status).toBe('awaiting-window');
    expect(item.versions.map((v) => [v.action, v.code])).toEqual([
      ['resubmit', '1020'],
      ['window', '1020'],
    ]);
    expect(ops.current()?.failure).toBe('rejected');
    expect((game.save()?.events ?? []).filter((e) => e.kind === EVENT_KINDS.returnResubmit).length).toBe(1);
    expect(win(f, first).querySelector('[data-doc-form]')).toBeNull();
    expect(win(f, second).querySelector('[data-doc-form]')).toBeNull();
    expect(text(win(f, second).querySelector('[data-doc-banner]'))).toBe(issueStatusLabel('awaiting-window'));
    expect(text(win(f, second).querySelector('[data-operation-stage]'))).toContain(OPERATION_UI.failed);
  });

  it('連點重新送審只保存一次', async () => {
    const game = toFirstReturn();
    const ref = receiptRef(game, 0);
    open(ref);
    const f = render();
    const button = win(f, ref).querySelector<HTMLButtonElement>('[data-doc-action="resubmit"]');
    button?.click();
    button?.click();
    f.detectChanges();
    await settle();
    expect(onlyCase(game).versions.length).toBe(1);
    expect((game.save()?.events ?? []).filter((e) => e.kind === EVENT_KINDS.returnResubmit).length).toBe(1);
  });

  it('送窗口待查：附件唯讀、顯示「待窗口回覆」；之後不再寄出新郵件', async () => {
    const game = toFirstReturn();
    const ref = receiptRef(game, 0);
    open(ref);
    const f = render();
    await act(f, win(f, ref), 'window');
    expect(onlyCase(game).status).toBe('awaiting-window');
    expect(text(win(f, ref).querySelector('[data-doc-banner]'))).toBe(issueStatusLabel('awaiting-window'));
    expect(win(f, ref).querySelector('[data-doc-form]')).toBeNull();
    toNextDay(game);
    toNextDay(game);
    expect(game.mailbox().length).toBe(1);
    expect(text(win(f, ref).querySelector('[data-doc-banner]'))).toBe(issueStatusLabel('awaiting-window'));
  });

  it('正確修訂：隔日的收件回條附件為已結案（結案說明、核對一致），原始送件附件為歷史版本', () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '0102');
    toNextDay(game);
    const first = receiptRef(game, 0);
    const resolved = receiptRef(game, 1);
    open(first);
    open(resolved);
    const f = render();
    const w = win(f, resolved);
    expect(text(w.querySelector('[data-doc-banner]'))).toBe(MAIL_UI.resolved);
    expect(text(w.querySelector('[data-doc-title]'))).toBe(receiptLabel('resolved', 'RT-B102'));
    expect(field(w, 'checked')).toBe('0102');
    expect(field(w, 'resolved')).toBe(DOCUMENT_ISSUES_UI.receipts.resolvedNote);
    expect(w.querySelector('[data-doc-field="reason"]')).toBeNull();
    expect(text(w.querySelector('[data-doc-version-result]'))).toBe(DOCUMENT_ISSUES_UI.outcome.resolved);
    expect(w.querySelector('[data-doc-form]')).toBeNull();
    expect(text(win(f, first).querySelector('[data-doc-banner]'))).toBe(MAIL_UI.historical);
  });

  it('過期草稿：顯示「此版本已不是目前待處理版本」與草稿原值（唯讀），不套用到最新附件', () => {
    let game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '1020');
    toNextDay(game);
    const first = receiptRef(game, 0);
    const second = receiptRef(game, 1);
    game = rewriteSave(game, (s) => {
      s['issueDrafts'] = { [first.receiptId]: '9999' };
    });
    expect(game.issueDraft(first.receiptId)).toBe('9999');
    open(first);
    open(second);
    const f = render();
    const old = win(f, first);
    expect(text(old.querySelector('[data-doc-stale]'))).toContain(MAIL_UI.stale);
    expect(text(old.querySelector('[data-doc-stale-value]'))).toBe('9999');
    expect(old.querySelector('[data-doc-code]')).toBeNull();
    const current = win(f, second);
    expect(current.querySelector('[data-doc-stale]')).toBeNull();
    expect(current.querySelector<HTMLInputElement>('[data-doc-code]')?.value).toBe('1020');
    // 舊回條的草稿不能再寫入
    game.setIssueDraft(first.receiptId, '0000');
    expect(game.issueDraft(first.receiptId)).toBe('9999');
  });

  it('找不到附件（回條不存在或版本對不上）：只顯示找不到的說明，不改開最新版本', () => {
    const game = toFirstReturn();
    const ref = receiptRef(game, 0);
    const lost: ReturnReceiptAttachment = { ...ref, receiptId: `${ref.caseId}#9` };
    const wrongVersion: ReturnReceiptAttachment = { ...ref, versionIndex: 0 };
    open(lost);
    const f = render();
    const w = win(f, lost);
    expect(text(w.querySelector('[data-doc-missing]'))).toBe(MAIL_UI.missingAttachment);
    expect(w.querySelector('[data-doc-form]')).toBeNull();
    expect(text(w.querySelector('[data-window-bar] [role="heading"]'))).toBe(MAIL_UI.attachments);

    // 回條存在但版本對不上：同樣只顯示找不到，不顯示該回條或最新版本的內容
    open(wrongVersion);
    f.detectChanges();
    const w2 = win(f, wrongVersion);
    expect(text(w2.querySelector('[data-doc-missing]'))).toBe(MAIL_UI.missingAttachment);
    expect(w2.querySelector('[data-doc-case]')).toBeNull();
    expect(w2.querySelector('[data-doc-form]')).toBeNull();
    expect(game.returns()[0]?.versions).toEqual([]);
  });
});
