import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { taskHeading } from '../../../content/bundle';
import { TASKS_UI, WORKDAY_UI } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { WorkDeliveryService } from '../../workbench/services/work-delivery.service';
import { M1_SAVE_A, M1_SAVE_B, M1Choices, instantOperations, playM1To, playM1UntilKind, settle } from '../../testing/play';
import { ReportWorkComponent } from './report-work.component';

/**
 * 交付報告（M1 Day 6）：先建立報告（欄位映射已匯入），再執行並交付；
 * 送件、本人回覆、窗口收件、待補分開計數；可開啟前日的批次副本回查；最後一件交付前先打開本日交接。
 */

const REPORT_D6 = 'task.day6.m1-report';
const INTERNAL = /task\.|record\.|doc\.|batch\.|day\.0|mail\.|\b(true|false|null|undefined)\b/;

function boot(): GameStateService {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  const game = TestBed.inject(GameStateService);
  game.newGame();
  return game;
}

function toReport(c: M1Choices): GameStateService {
  const game = boot();
  playM1To(game, 'day.06', c);
  playM1UntilKind(game, 'report', c);
  return game;
}

function render(): ComponentFixture<ReportWorkComponent> {
  const f = TestBed.createComponent(ReportWorkComponent);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<ReportWorkComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function count(f: ComponentFixture<ReportWorkComponent>, key: string): string {
  return text(el(f).querySelector(`[data-report-count="${key}"]`));
}

describe('ReportWorkComponent（M1 交付報告）', () => {
  afterEach(() => localStorage.clear());

  it('建立前只有前日批次副本可回查；建立後四種數量分開、逐列顯示保存的編號；不含內部 ID', () => {
    const game = toReport(M1_SAVE_A);
    const f = render();
    expect(text(el(f).querySelector('h3'))).toBe(taskHeading(REPORT_D6));
    expect(el(f).querySelector('[data-report-counts]')).toBeNull();
    const previous = Array.from(el(f).querySelectorAll('[data-report-previous] button'));
    expect(previous.length).toBe(2);
    (previous[0] as HTMLButtonElement).click();
    expect(TestBed.inject(MailAttachmentService).openRefs()).toEqual([{ kind: 'batch-output', taskId: 'task.day4.m1-transform' }]);

    el(f).querySelector<HTMLButtonElement>('[data-report-generate]')?.click();
    f.detectChanges();
    expect(game.reportGenerated(REPORT_D6)).toBeTrue();
    expect([count(f, 'submission'), count(f, 'reply'), count(f, 'receipt'), count(f, 'pending')]).toEqual(['8', '1', '0', '0']);
    expect(el(f).querySelector('[data-report-row="0341"]')).not.toBeNull();
    expect(text(el(f).querySelector('[data-report-row="0341"]'))).toContain(WORKDAY_UI.evidence.mismatch);
    expect(el(f).textContent ?? '').not.toMatch(INTERNAL);
  });

  it('另一份存檔（保留缺漏）的報告數量不同', () => {
    toReport(M1_SAVE_B);
    const f = render();
    el(f).querySelector<HTMLButtonElement>('[data-report-generate]')?.click();
    f.detectChanges();
    expect([count(f, 'submission'), count(f, 'reply'), count(f, 'receipt'), count(f, 'pending')]).toEqual(['1', '1', '1', '7']);
    expect(el(f).querySelectorAll('tr.rw-pending').length).toBe(7);
  });

  it('執行並交付後：交付按鈕為「完成今日交接」，按下先打開本日交接（不離開桌面）', async () => {
    const game = toReport(M1_SAVE_A);
    const f = render();
    el(f).querySelector<HTMLButtonElement>('[data-report-generate]')?.click();
    f.detectChanges();
    el(f).querySelector<HTMLButtonElement>('[data-report-execute]')?.click();
    await settle();
    f.detectChanges();
    expect(game.taskDone()).toBeTrue();
    expect(el(f).querySelector('[data-report-execute]')).toBeNull();
    const deliver = el(f).querySelector<HTMLButtonElement>('[data-deliver]');
    expect(text(deliver)).toBe(TASKS_UI.finishDay);
    deliver?.click();
    expect(TestBed.inject(WorkDeliveryService).handoffOpen()).toBeTrue();
    expect(game.stage()).toBe('work');
  });
});
