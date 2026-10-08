import { ComponentFixture, TestBed } from '@angular/core/testing';
import { dayDateLabel, issueTaskText, unlockedMessages } from '../../../content/bundle';
import { DOCUMENT_ISSUES_UI, MAIL_UI, TASKS_UI, archiveProgress, issueStatusLabel } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { DesktopService } from '../../desktop/services/desktop.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { MailNavigationService } from '../../mail/services/mail-navigation.service';
import { onlyCase, receiptMails, receiptRef, resubmitNow, toFirstReturn, toNextDay } from '../../mail/testing/mail-play';
import { archiveWith, completeTask, finishDay } from '../../testing/play';
import { ReturnReviewComponent } from './return-review.component';

/**
 * R10–R12 每日「錯誤文件處理」：Day 1 B102 輸入 "102"（來源 0102）→ Day 2 明確放行 → Day 3 下游退件（郵件寄達）
 * → Day 4 在歸檔之後排入錯誤文件處理。R12 起這裡只列案號、狀態與最新回條，「開啟最新郵件」打開郵件應用並開啟附件；
 * 附件是唯一的修訂入口，從郵件提前處理的案件在這裡直接顯示為已處理，交付照舊。
 */

const DM_CHANNEL = 'channel.dm.lin-yuan';
const DM_ID = 'msg.day3.return-code-audit';

function dmCount(game: GameStateService): number {
  const ctx = game.conditionContext();
  return ctx ? unlockedMessages(DM_CHANNEL, ctx).filter((m) => m.id === DM_ID).length : -1;
}

/** 玩到 Day 4 的錯誤文件處理工作（Day 4 歸檔先交付）。 */
function toIssueTask(): GameStateService {
  const game = toFirstReturn();
  expect(dmCount(game)).toBe(1);
  toNextDay(game);
  expect(game.dayId()).toBe('day.04');
  expect(game.task()?.kind).toBe('archive');
  archiveWith(game, {});
  expect(game.completeWork()).toBeTrue();
  expect(game.task()?.kind).toBe('return-review');
  return game;
}

/** 交付當日排在錯誤文件處理之前的工作，停在錯誤文件處理（有上限，交付失敗即丟例外）。 */
function toReturnReviewTask(game: GameStateService): void {
  for (let i = 0; i < 6 && game.task()?.kind !== 'return-review'; i++) {
    if (!completeTask(game)) throw new Error(`交付 ${game.taskId()} 失敗`);
  }
  expect(game.task()?.kind).toBe('return-review');
}

function render(): ComponentFixture<ReturnReviewComponent> {
  const f = TestBed.createComponent(ReturnReviewComponent);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<ReturnReviewComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function deliverButton(f: ComponentFixture<ReturnReviewComponent>): HTMLButtonElement | undefined {
  return Array.from(el(f).querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    [TASKS_UI.deliver, TASKS_UI.finishDay].includes(b.textContent?.trim() ?? ''),
  );
}

describe('ReturnReviewComponent（R12 錯誤文件處理）', () => {
  afterEach(() => localStorage.clear());

  it('列出排定的案件：案號、狀態、最新回條（附件名＋收到時間）與「開啟最新郵件」；沒有內嵌編輯', () => {
    const game = toIssueTask();
    const f = render();
    const t = issueTaskText(game.taskId() ?? '');
    expect(text(el(f).querySelector('.eyebrow'))).toBe(t.eyebrow);
    expect(text(el(f).querySelector('h3'))).toBe(DOCUMENT_ISSUES_UI.taskHeading);
    expect(el(f).textContent).toContain(DOCUMENT_ISSUES_UI.taskInstruction);
    expect(text(el(f).querySelector('[data-return-progress]'))).toBe(archiveProgress(0, 1));
    expect(el(f).querySelectorAll('[data-return-item]').length).toBe(1);
    expect(text(el(f).querySelector('[data-return-case]'))).toBe('RT-B102');
    expect(text(el(f).querySelector('[data-return-state]'))).toBe(issueStatusLabel('pending'));
    expect(el(f).querySelector('[data-return-handled]')).toBeNull();
    expect(text(el(f).querySelector('[data-return-latest]'))).toBe(`RT-B102｜${MAIL_UI.initialVersion}｜核對結果`);
    expect(text(el(f).querySelector('[data-return-received]'))).toBe(dayDateLabel('day.03'));
    expect(text(el(f).querySelector('[data-return-open]'))).toBe(DOCUMENT_ISSUES_UI.task.openMail);
    expect(el(f).querySelector('input')).toBeNull();
    expect(el(f).querySelector('[data-issues-link]')).toBeNull();
    expect(deliverButton(f)?.disabled).toBeTrue();
    expect(el(f).textContent ?? '').not.toMatch(/return\.|mail\.|task\.|batch\.|day\.0|#\d|\b(true|false|null)\b/);
  });

  it('開啟最新郵件：打開郵件應用、選取該案件最新回條的郵件（標已讀）並開啟它的附件', () => {
    const game = toIssueTask();
    const desktop = TestBed.inject(DesktopService);
    const openApp = spyOn(desktop, 'openApp').and.callThrough();
    const f = render();
    const mailId = receiptMails(game)[0]?.id ?? '';
    expect(game.isMailRead(mailId)).toBeFalse();
    el(f).querySelector<HTMLButtonElement>('[data-return-open]')?.click();
    expect(openApp).toHaveBeenCalledWith('mail');
    expect(TestBed.inject(MailNavigationService).selectedId()).toBe(mailId);
    expect(game.isMailRead(mailId)).toBeTrue();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toEqual([receiptRef(game, 0)]);
    // 開啟郵件不等於處理案件
    expect(onlyCase(game).status).toBe('pending');
    expect(deliverButton(f)?.disabled).toBeTrue();
  });

  it('再次退回後，開啟的是最新一封郵件與最新版本附件（不是原始送件）', () => {
    const game = toFirstReturn();
    toNextDay(game);
    resubmitNow(game, '1020');
    toNextDay(game); // Day 5：再次退回（排入下一個有錯誤文件處理的工作日）
    expect(onlyCase(game).status).toBe('pending');
    toNextDay(game); // Day 6
    toReturnReviewTask(game);
    const f = render();
    expect(text(el(f).querySelector('[data-return-latest]'))).toBe('RT-B102｜修訂 1｜核對結果');
    expect(text(el(f).querySelector('[data-return-received]'))).toBe(dayDateLabel('day.05'));
    el(f).querySelector<HTMLButtonElement>('[data-return-open]')?.click();
    expect(TestBed.inject(MailNavigationService).selectedId()).toBe(receiptMails(game)[1]?.id ?? '');
    expect(TestBed.inject(MailAttachmentService).openRefs()).toEqual([receiptRef(game, 1)]);
  });

  it('在錯誤文件處理工作中從郵件附件送出：這裡同步顯示已處理、可交付；隔日下游核對照常', () => {
    const game = toIssueTask();
    const f = render();
    resubmitNow(game, '0102'); // 附件的重新送審（同一份案件狀態）
    f.detectChanges();
    expect(text(el(f).querySelector('[data-return-state]'))).toBe(issueStatusLabel('awaiting-check'));
    expect(text(el(f).querySelector('[data-return-handled]'))).toBe(DOCUMENT_ISSUES_UI.task.handled);
    expect(text(el(f).querySelector('[data-return-progress]'))).toBe(archiveProgress(1, 1));
    expect(deliverButton(f)?.disabled).toBeFalse();
    deliverButton(f)?.click();
    // M1 起同日還有附件／批次工作：交付後這件標為完成，其餘工作照排
    expect(game.dayTasks().find((t) => t.kind === 'return-review')?.status).toBe('done');
    finishDay(game);
    expect(onlyCase(game).status).toBe('resolved');
    expect(receiptMails(game).map((m) => m.templateId)).toEqual(['returned', 'resolved']);
  });

  it('工作出現前就從郵件處理：當日錯誤文件處理自動結清（不重複處理），清單顯示已完成', () => {
    const game = toFirstReturn();
    toNextDay(game);
    expect(game.task()?.kind).toBe('archive');
    resubmitNow(game, '1020');
    archiveWith(game, {});
    expect(game.completeWork()).toBeTrue();
    expect(game.task()?.kind).not.toBe('return-review');
    expect(game.dayTasks().find((t) => t.kind === 'return-review')?.status).toBe('done');
    expect(onlyCase(game).versions.length).toBe(1);
  });

  it('送窗口待查後也算已處理（待窗口回覆），可交付；之後不再寄信', () => {
    const game = toIssueTask();
    const item = onlyCase(game);
    expect(game.sendReturnToWindowStrict(item.id, game.editableReceiptId(item.id) ?? '')).toBe('ok');
    const f = render();
    expect(text(el(f).querySelector('[data-return-state]'))).toBe(issueStatusLabel('awaiting-window'));
    expect(text(el(f).querySelector('[data-return-handled]'))).toBe(DOCUMENT_ISSUES_UI.task.handled);
    expect(deliverButton(f)?.disabled).toBeFalse();
    deliverButton(f)?.click();
    finishDay(game);
    finishDay(game);
    expect(game.dayId()).toBe('day.06');
    expect(receiptMails(game).length).toBe(1);
  });
});
