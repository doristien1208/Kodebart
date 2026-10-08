import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { dayDateLabel } from '../../../content/bundle';
import { DOCUMENT_ISSUES_UI, MAIL_UI } from '../../../content/text';
import { RETURN_RECEIPT_MAIL_PACK } from '../../../core/mail';
import { MailRecord } from '../../../core/types';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { MailAttachmentService } from '../services/mail-attachment.service';
import { MailNavigationService } from '../services/mail-navigation.service';
import { bootGame, playToFirstReturn, receiptRef, resubmitNow, toFirstReturn, toNextDay } from '../testing/mail-play';
import { MailComponent } from './mail.component';

/**
 * R12 郵件應用：收件匣新的在前、三個篩選（件數＋空狀態）、未讀與待處理文字標籤；
 * 開收件匣不標已讀，只有選取一封信才標已讀；選取跨視窗關閉保留；窄視窗先清單後閱讀＋返回；
 * 附件「開啟文件」交給附件服務；讀取失敗顯示訊息與重新讀取。
 */

function render(): ComponentFixture<MailComponent> {
  const f = TestBed.createComponent(MailComponent);
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

function rows(f: ComponentFixture<unknown>): HTMLButtonElement[] {
  return Array.from(el(f).querySelectorAll<HTMLButtonElement>('[data-mail-row]'));
}

function counts(f: ComponentFixture<unknown>): string[] {
  return Array.from(el(f).querySelectorAll('[data-mail-count]')).map((c) => text(c));
}

function filterTo(f: ComponentFixture<unknown>, filter: 'all' | 'unread' | 'pending'): void {
  el(f).querySelector<HTMLButtonElement>(`[data-mail-filter="${filter}"]`)?.click();
  f.detectChanges();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

describe('MailComponent（R12 郵件應用）', () => {
  afterEach(() => localStorage.clear());

  it('新遊戲：空收件匣（件數 0、空狀態），閱讀區提示選擇郵件', () => {
    localStorage.clear();
    const game = bootGame();
    game.newGame();
    const f = render();
    expect(rows(f).length).toBe(0);
    expect(counts(f)).toEqual(['0', '0', '0']);
    expect(text(el(f).querySelector('[data-mail-empty]'))).toBe(MAIL_UI.empty);
    expect(text(el(f).querySelector('[data-mail-select]'))).toBe(MAIL_UI.selectMail);
    filterTo(f, 'unread');
    expect(text(el(f).querySelector('[data-mail-empty]'))).toBe(MAIL_UI.emptyUnread);
    filterTo(f, 'pending');
    expect(text(el(f).querySelector('[data-mail-empty]'))).toBe(MAIL_UI.emptyPending);
  });

  it('Day 3：開收件匣不標已讀；選取才標已讀，未讀標籤與件數更新；閱讀區有主旨／寄件者／收到時間／正文／附件', () => {
    const game = toFirstReturn();
    const f = render();
    expect(game.save()?.readMail).toEqual([]);
    expect(game.unreadMailCount()).toBe(1);
    expect(counts(f)).toEqual(['1', '1', '1']);
    const [row] = rows(f);
    expect(text(row?.querySelector('[data-mail-sender]'))).toBe('資料作業窗口');
    expect(text(row?.querySelector('[data-mail-subject]'))).toBe('文件退回｜RT-B102');
    expect(text(row?.querySelector('[data-mail-received]'))).toBe(dayDateLabel('day.03'));
    expect(text(row?.querySelector('[data-mail-unread]'))).toBe(MAIL_UI.unread);
    expect(text(row?.querySelector('[data-mail-pending]'))).toBe(MAIL_UI.pending);

    // 切篩選也不標已讀
    filterTo(f, 'unread');
    filterTo(f, 'pending');
    expect(game.unreadMailCount()).toBe(1);

    filterTo(f, 'unread');
    rows(f)[0]?.click();
    f.detectChanges();
    expect(game.unreadMailCount()).toBe(0);
    expect(game.save()?.readMail).toEqual([game.mailbox()[0]?.id ?? '']);
    expect(counts(f)).toEqual(['1', '0', '1']);
    // 未讀篩選中仍保留閱讀中的那封（焦點不遺失）；未讀標籤消失
    expect(rows(f).length).toBe(1);
    expect(rows(f)[0]?.getAttribute('aria-current')).toBe('true');
    expect(rows(f)[0]?.querySelector('[data-mail-unread]')).toBeNull();

    const reader = el(f).querySelector('[data-mail-reader]');
    expect(text(reader?.querySelector('[data-mail-reader-subject]'))).toBe('文件退回｜RT-B102');
    expect(text(reader?.querySelector('[data-mail-reader-sender]'))).toBe('資料作業窗口');
    expect(text(reader?.querySelector('[data-mail-reader-received]'))).toBe(dayDateLabel('day.03'));
    expect(text(reader?.querySelector('[data-mail-reader-body]'))).toContain('案件：RT-B102');
    expect(text(reader?.querySelector('[data-attachment-label]'))).toBe(`RT-B102｜${MAIL_UI.initialVersion}｜核對結果`);
    expect(text(reader?.querySelector('[data-attachment-state-text]'))).toBe(MAIL_UI.current);
    expect(reader?.querySelector('[data-mail-back]')).toBeNull();

    // 不顯示內部 ID、日別代碼或布林字樣
    expect(el(f).textContent ?? '').not.toMatch(/return\.|mail\.|day\.0|#\d|\b(true|false|null|undefined)\b/);
  });

  it('開啟文件交給附件服務（版本引用），郵件已讀與案件是否解決無關', () => {
    const game = toFirstReturn();
    const f = render();
    rows(f)[0]?.click();
    f.detectChanges();
    el(f).querySelector<HTMLButtonElement>('[data-attachment-open]')?.click();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toEqual([receiptRef(game, 0)]);
    expect(game.returns()[0]?.status).toBe('pending');
    expect(game.isMailRead(game.mailbox()[0]?.id ?? '')).toBeTrue();
  });

  it('新的在前；待處理篩選只列有目前可修訂附件的郵件', () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '1020');
    let f = render();
    filterTo(f, 'pending');
    expect(text(el(f).querySelector('[data-mail-empty]'))).toBe(MAIL_UI.emptyPending);
    f.destroy();

    toNextDay(game); // Day 5：再次退回
    f = render();
    filterTo(f, 'all');
    // M1 工作日郵件也在收件匣（Day 5 的回條依每局擲骰可能在第一件工作後才送達），退件回條仍新的在前
    const received = (list: HTMLButtonElement[]): string[] => list.map((r) => text(r.querySelector('[data-mail-received]')));
    const returned = (list: HTMLButtonElement[]): HTMLButtonElement[] => list.filter((r) => text(r).includes('文件退回'));
    const all = rows(f);
    expect(all.length).toBe(game.mailbox().length);
    expect(received(all)[0]).toBe(dayDateLabel('day.05'));
    expect(received(all)[all.length - 1]).toBe(dayDateLabel('day.03'));
    expect(received(returned(all))).toEqual([dayDateLabel('day.05'), dayDateLabel('day.03')]);
    expect(counts(f).slice(0, 2)).toEqual([String(all.length), String(all.length)]);
    filterTo(f, 'pending');
    expect(received(returned(rows(f)))).toEqual([dayDateLabel('day.05')]);
  });

  it('選取保存在導覽服務：郵件視窗關閉（元件銷毀）後再開仍是同一封；已讀不重複寫入', () => {
    const game = toFirstReturn();
    let f = render();
    rows(f)[0]?.click();
    f.detectChanges();
    const readMail = game.save()?.readMail;
    f.destroy();
    f = render();
    expect(text(el(f).querySelector('[data-mail-reader-subject]'))).toBe('文件退回｜RT-B102');
    expect(game.save()?.readMail).toBe(readMail);
  });

  it('窄視窗：先清單；選信後只顯示閱讀區（焦點到主旨）並有返回；返回後回到清單、焦點回到那封信', async () => {
    toFirstReturn();
    TestBed.inject(WindowManagerService).setCompact(true);
    const f = render();
    document.body.appendChild(el(f));
    const listPane = el(f).querySelector('.mail-pane-list');
    const readerPane = el(f).querySelector('.mail-pane-reader');
    expect(listPane?.classList.contains('is-hidden')).toBeFalse();
    expect(readerPane?.classList.contains('is-hidden')).toBeTrue();

    rows(f)[0]?.click();
    f.detectChanges();
    await nextFrame();
    expect(listPane?.classList.contains('is-hidden')).toBeTrue();
    expect(readerPane?.classList.contains('is-hidden')).toBeFalse();
    expect(document.activeElement?.hasAttribute('data-mail-reader-subject')).toBeTrue();
    const back = el(f).querySelector<HTMLButtonElement>('[data-mail-back]');
    expect(text(back)).toBe(DOCUMENT_ISSUES_UI.close);

    back?.click();
    f.detectChanges();
    await nextFrame();
    expect(listPane?.classList.contains('is-hidden')).toBeFalse();
    expect(TestBed.inject(MailNavigationService).selectedId()).toBeNull();
    expect(document.activeElement?.hasAttribute('data-mail-row')).toBeTrue();
    el(f).remove();
  });

  it('另開新局：不沿用上一局的選取（同一回條 ID 的新郵件不會未經開啟就顯示、也不會被標已讀）', () => {
    const game = toFirstReturn();
    const nav = TestBed.inject(MailNavigationService);
    const mailId = game.mailbox()[0]?.id ?? '';
    expect(nav.open(mailId)).toBeTrue();
    expect(nav.selectedId()).toBe(mailId);
    const seed = game.save()?.seed;
    // 同一個工作階段（root 服務不重建）另開新局並玩到同一份退件：郵件 ID 相同
    playToFirstReturn(game);
    expect(game.save()?.seed).not.toBe(seed);
    expect(game.mailbox()[0]?.id).toBe(mailId);
    expect(nav.selectedId()).toBeNull();
    expect(game.isMailRead(mailId)).toBeFalse();
    const f = render();
    expect(el(f).querySelector('[data-mail-reader]')).toBeNull();
    expect(text(el(f).querySelector('[data-mail-select]'))).toBe(MAIL_UI.selectMail);
  });

  it('單封郵件的郵件包讀不到：清單與閱讀區顯示讀取失敗，重新讀取重新計算；整個收件匣失敗時同樣可重試', () => {
    const game = toFirstReturn();
    const real = game.mailbox;
    const broken: MailRecord = { id: 'mail.broken', packId: 'mail.removed', templateId: 'returned', dayId: 'day.03', attachments: [] };
    const box = signal<readonly MailRecord[]>([broken]);
    let fail = false;
    const patched = game as unknown as { mailbox: () => readonly MailRecord[] };
    patched.mailbox = () => {
      if (fail) throw new Error('broken');
      return box();
    };
    const f = render();
    expect(text(rows(f)[0]?.querySelector('[data-mail-subject]'))).toBe(MAIL_UI.loadFailed);
    // 讀不到的郵件不在存檔，選取不寫入已讀
    rows(f)[0]?.click();
    f.detectChanges();
    expect(game.save()?.readMail).toEqual([]);

    // 整體失敗 → 讀取失敗＋重新讀取；恢復後重新讀取即正常
    fail = true;
    box.set([{ ...broken, packId: RETURN_RECEIPT_MAIL_PACK }]);
    f.detectChanges();
    expect(text(el(f).querySelector('[data-mail-load-failed]'))).toContain(MAIL_UI.loadFailed);
    fail = false;
    patched.mailbox = real;
    el(f).querySelector<HTMLButtonElement>('[data-mail-retry]')?.click();
    f.detectChanges();
    expect(el(f).querySelector('[data-mail-load-failed]')).toBeNull();
    expect(rows(f).length).toBe(1);
  });
});
