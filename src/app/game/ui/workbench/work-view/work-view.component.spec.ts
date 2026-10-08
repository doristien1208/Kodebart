import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { archiveTask, reconcileTask, recordsOfTask, taskHeading } from '../../../content/bundle';
import { recordLabel } from '../../../content/records';
import { ARCHIVE_UI, DOCUMENT_ISSUES_UI, SOURCE_CARD, TASKS_UI, WORKDAY_UI, taskKindLabel } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { M1_SAVE_A, M1_SAVE_B, archiveAll, archiveOne, finishDay, instantOperations, playM1Day, playM1To, playM1UntilKind, playTo, reviewAll, settle } from '../../testing/play';
import { MailAttachmentService, attachmentWindowId } from '../../mail/services/mail-attachment.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { WorkViewComponent } from './work-view.component';

/**
 * R8 §1.6／M1 §1：工作頁的工作佇列（種類、狀態、依賴）、交付按鈕文字、同日換工作不離開 /work，
 * 換到下一件歸檔工作時本地畫面狀態（選取、預覽、錯誤）重設為新批次第一筆；
 * 當日最後一件交付前先顯示本日交接，確認後才離開桌面。
 */

interface Harness {
  game: GameStateService;
  navigated: string[];
}

function boot(): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const navigated: string[] = [];
  const router = TestBed.inject(Router);
  spyOn(router, 'navigateByUrl').and.callFake((url) => {
    navigated.push(String(url));
    return Promise.resolve(true);
  });
  instantOperations(TestBed.inject(WorkOperationsService));
  return { game: TestBed.inject(GameStateService), navigated };
}

function render(): ComponentFixture<WorkViewComponent> {
  const fixture = TestBed.createComponent(WorkViewComponent);
  fixture.autoDetectChanges(true);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  return fixture;
}

function root(fixture: ComponentFixture<WorkViewComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** 工作佇列的各項（依當日順序）。 */
function queueItems(fixture: ComponentFixture<WorkViewComponent>): HTMLButtonElement[] {
  return Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('app-work-queue [data-queue-task]'));
}

function statuses(fixture: ComponentFixture<WorkViewComponent>): string[] {
  return queueItems(fixture).map((b) => b.getAttribute('data-task-status') ?? '');
}

function buttonByText(fixture: ComponentFixture<WorkViewComponent>, text: string): HTMLButtonElement | undefined {
  return Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
}

function queueButton(fixture: ComponentFixture<WorkViewComponent>, label: string): HTMLButtonElement {
  const b = Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('app-archive-queue button')).find(
    (x) => x.querySelector('.truncate')?.textContent?.trim() === label,
  );
  if (!b) throw new Error(`找不到佇列項目 ${label}`);
  return b;
}

function selectedLabel(fixture: ComponentFixture<WorkViewComponent>): string {
  return (
    root(fixture).querySelector('app-archive-queue button[aria-current="true"] .truncate')?.textContent?.trim() ?? ''
  );
}

describe('WorkViewComponent（R8 同日多工作）', () => {
  let h: Harness;
  let fixture: ComponentFixture<WorkViewComponent> | null = null;

  beforeEach(() => {
    localStorage.clear();
    h = boot();
    h.game.newGame();
  });

  afterEach(() => {
    fixture?.nativeElement.remove();
    fixture?.destroy();
    fixture = null;
    localStorage.clear();
  });

  it('Day 1 第一件：佇列兩項（進行中／等待前一批交付）、按鈕為「交付此項工作」', () => {
    fixture = render();
    expect(root(fixture).querySelector('[data-step]')?.textContent?.trim()).toBe(WORKDAY_UI.workQueue);
    expect(statuses(fixture)).toEqual(['active', 'pending']);
    const labels = root(fixture).querySelector('app-work-queue ol')?.textContent ?? '';
    expect(labels).toContain(TASKS_UI.statusActive);
    // Day 1 第二批依賴第一批（保留原本的先後）：鎖住並說明等待哪一件
    expect(labels).toContain(WORKDAY_UI.pendingDependency);
    expect(queueItems(fixture)[1]?.hasAttribute('data-queue-locked')).toBeTrue();
    expect(queueItems(fixture)[1]?.disabled).toBeTrue();
    expect(queueItems(fixture)[1]?.textContent).toContain(taskHeading('task.day1.archive'));
    expect(buttonByText(fixture, TASKS_UI.deliver)?.disabled).toBeTrue();
    expect(buttonByText(fixture, TASKS_UI.finishDay)).toBeUndefined();
  });

  it('交付第一件後留在 /work 顯示第二批：選取第一筆、沒有錯誤與預覽、焦點在步驟標示', async () => {
    const { game } = h;
    fixture = render();

    // 第一批：先製造本地錯誤，再改選第三筆，確認這些畫面狀態不會帶到下一批
    buttonByText(fixture, ARCHIVE_UI.validate)?.click();
    expect(root(fixture).querySelector('#field-error')?.textContent?.trim()).not.toBe('');
    archiveAll(game);
    fixture.detectChanges();
    const firstBatch = recordsOfTask('task.day1.archive');
    queueButton(fixture, recordLabel(firstBatch[2]!)).click();
    expect(selectedLabel(fixture)).toBe(recordLabel(firstBatch[2]!));

    const deliver = buttonByText(fixture, TASKS_UI.deliver);
    expect(deliver?.disabled).toBeFalse();
    deliver?.click();
    await fixture.whenStable();

    expect(game.stage()).toBe('work');
    expect(game.taskId()).toBe('task.day1.archive-followup');
    expect(h.navigated).not.toContain('/overnight');
    expect(h.navigated.every((u) => u === '/work')).toBeTrue();

    const second = archiveTask('task.day1.archive-followup');
    const secondBatch = recordsOfTask(second.id);
    expect(statuses(fixture)).toEqual(['done', 'active']);
    expect(queueItems(fixture)[0]?.textContent).toContain(WORKDAY_UI.statusSent);
    expect(root(fixture).querySelector('app-archive-work h3')?.textContent?.trim()).toBe(second.text.heading);
    expect(
      Array.from(root(fixture).querySelectorAll('app-archive-queue .truncate')).map((s) => s.textContent?.trim()),
    ).toEqual(secondBatch.map((r) => recordLabel(r)));
    expect(selectedLabel(fixture)).toBe(recordLabel(secondBatch[0]!));
    expect(root(fixture).querySelector('app-source-card')?.textContent).toContain(SOURCE_CARD.eyebrow(secondBatch[0]!.key));
    expect(root(fixture).querySelector('#field-error')?.textContent?.trim()).toBe('');
    expect(root(fixture).querySelector('#archive-input')?.getAttribute('aria-invalid')).toBe('false');
    expect(root(fixture).querySelector('app-archive-preview')).toBeNull();
    expect(document.activeElement).toBe(root(fixture).querySelector('[data-step]'));

    // 最後一件：按鈕改為「完成今日交接」；按下先顯示本日交接（交付清單），確認後才交付並離開桌面
    expect(buttonByText(fixture, TASKS_UI.finishDay)?.disabled).toBeTrue();
    archiveAll(game);
    fixture.detectChanges();
    expect(buttonByText(fixture, TASKS_UI.finishDay)?.disabled).toBeFalse();
    buttonByText(fixture, TASKS_UI.finishDay)?.click();
    await fixture.whenStable();
    expect(game.stage()).toBe('work');
    const panel = root(fixture).querySelector('[data-handoff-panel]');
    expect(panel?.textContent).toContain(WORKDAY_UI.handoff);
    expect(panel?.querySelectorAll('[data-handoff-item]').length).toBe(2);
    expect(document.activeElement).toBe(panel?.querySelector('h3') ?? null);
    root(fixture).querySelector<HTMLButtonElement>('[data-handoff-confirm]')?.click();
    await fixture.whenStable();
    expect(game.stage()).toBe('wrap');
    expect(h.navigated[h.navigated.length - 1]).toBe('/overnight');
  });

  it('Day 2 核對：回覆對話框的確認鍵為「交付此項工作」，送出後留在 /work 換成當日歸檔，四格結果不變', async () => {
    const { game } = h;
    finishDay(game);
    expect(game.dayId()).toBe('day.02');
    fixture = render();
    expect(statuses(fixture)).toEqual(['active', 'pending']);

    const text = reconcileTask('task.day2.reconcile').text;
    buttonByText(fixture, text.openReport)?.click();
    // R10：回覆前每筆都要有審查處置（逐筆審查的畫面由核對元件負責，這裡直接走狀態）
    reviewAll(game, 'release');
    fixture.detectChanges();
    const arrangedBefore = game.arranged();
    buttonByText(fixture, text.choices.ack)?.click();
    const dialog = root(fixture).querySelector('dialog');
    expect(dialog?.open).toBeTrue();
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === TASKS_UI.deliver,
    );
    expect(confirm).toBeDefined();
    confirm?.click();
    await settle();
    await fixture.whenStable();

    expect(game.stage()).toBe('work');
    expect(game.taskId()).toBe('task.day2.archive');
    expect(game.arranged()).toBe(arrangedBefore);
    expect(h.navigated).not.toContain('/overnight');
    expect(statuses(fixture)).toEqual(['done', 'active']);
    expect(root(fixture).querySelector('app-day2-reconcile')).toBeNull();
    expect(selectedLabel(fixture)).toBe(recordLabel(recordsOfTask('task.day2.archive')[0]!));
    expect(buttonByText(fixture, TASKS_UI.finishDay)).toBeDefined();
  });

  it('單一工作的日子（Day 3）：佇列一項，按鈕直接是「完成今日交接」', () => {
    finishDay(h.game);
    finishDay(h.game);
    expect(h.game.dayId()).toBe('day.03');
    fixture = render();
    expect(queueItems(fixture).length).toBe(1);
    expect(buttonByText(fixture, TASKS_UI.finishDay)).toBeDefined();
    expect(buttonByText(fixture, TASKS_UI.deliver)).toBeUndefined();
  });

  /* ---------- R10：退件複審只在有退件時出現在當日步驟 ---------- */

  it('Day 1 填「102」且 Day 2 放行 → Day 4 佇列多一項「複審／錯誤文件處理」', () => {
    const { game } = h;
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    playTo(game, 'day.04');
    fixture = render();
    const items = queueItems(fixture);
    // 歸檔、錯誤文件處理、M1 的附件關聯與批次轉換
    expect(items.length).toBe(4);
    expect(items[1]?.textContent).toContain(taskKindLabel('return-review'));
    expect(items[1]?.textContent).toContain(DOCUMENT_ISSUES_UI.taskHeading);
    expect(statuses(fixture)).toEqual(['active', 'pending', 'pending', 'pending']);
  });

  it('照來源填寫並放行（沒有退件）→ Day 4 不出現空的複審工作', () => {
    playTo(h.game, 'day.04');
    fixture = render();
    expect(queueItems(fixture).length).toBe(3);
    expect(root(fixture).querySelector('app-work-queue')?.textContent).not.toContain(DOCUMENT_ISSUES_UI.taskHeading);
  });

  /* ---------- M1：工作佇列自選順序與資料依賴 ---------- */

  it('M1 Day 4：附件關聯不依賴歸檔，可先切過去處理（歸檔的草稿保留）；批次轉換等前一批交付才開放', () => {
    const { game } = h;
    playTo(game, 'day.04');
    fixture = render();
    const [archive, attachment, transform] = queueItems(fixture);
    expect(archive?.getAttribute('data-task-status')).toBe('active');
    expect(attachment?.disabled).toBeFalse();
    expect(transform?.disabled).toBeTrue();
    expect(transform?.hasAttribute('data-queue-locked')).toBeTrue();
    expect(transform?.textContent).toContain(WORKDAY_UI.pendingDependency);
    expect(transform?.textContent).toContain(taskHeading('task.day4.archive'));
    expect(transform?.textContent).toContain(taskHeading('task.day4.m1-attachment'));
    game.updateDraft('H233', { value: 'H-23' });

    attachment?.click();
    fixture.detectChanges();
    expect(game.taskId()).toBe('task.day4.m1-attachment');
    expect(root(fixture).querySelector('app-attachment-work')).not.toBeNull();
    expect(root(fixture).querySelector('app-archive-work')).toBeNull();
    expect(game.draft('H233')).toEqual({ value: '' }); // 目前批次已不是 Day 4 歸檔
    expect(game.save()!.batches['batch.day04.archive']!.drafts['H233']).toEqual({ value: 'H-23' });

    // 回到歸檔：草稿仍在
    queueItems(fixture)[0]?.click();
    fixture.detectChanges();
    expect(game.taskId()).toBe('task.day4.archive');
    expect(game.draft('H233')).toEqual({ value: 'H-23' });
  });

  it('M1 佇列狀態：交付後依保存結果顯示已送件／待補（保留缺漏的批次、有送覆核紀錄的歸檔）；已交付的不能切回', () => {
    const { game } = h;
    playM1To(game, 'day.05', M1_SAVE_B);
    fixture = render();
    const status = (taskId: string) => root(fixture!).querySelector(`[data-queue-task="${taskId}"] [data-queue-status]`)?.textContent?.trim();
    expect(status('task.day5.m1-transform')).toBe(WORKDAY_UI.pendingDependency);
    archiveAll(game, 'request_review');
    expect(game.completeWork()).toBeTrue();
    fixture.detectChanges();
    expect(status('task.day5.archive')).toBe(WORKDAY_UI.statusPending);
    expect(status('task.day5.m1-attachment')).toBe(TASKS_UI.statusActive);
    expect(status('task.day5.m1-transform')).toBe(WORKDAY_UI.statusTodo);

    // 自選順序：先做批次（保留缺漏）
    queueItems(fixture).find((b) => b.getAttribute('data-queue-task') === 'task.day5.m1-transform')?.click();
    fixture.detectChanges();
    expect(game.taskId()).toBe('task.day5.m1-transform');
    game.setTransformPolicy('review');
    expect(game.previewTransform()).toBeTrue();
    expect(game.submitTransformStrict()).toBe('ok');
    expect(game.completeWork()).toBeTrue();
    fixture.detectChanges();
    expect(game.taskId()).toBe('task.day5.m1-attachment');
    expect(status('task.day5.m1-transform')).toBe(WORKDAY_UI.statusPending);
    expect(root(fixture).querySelector<HTMLButtonElement>('[data-queue-task="task.day5.archive"]')?.disabled).toBeTrue();
    expect(root(fixture).querySelector<HTMLButtonElement>('[data-queue-task="task.day5.m1-transform"]')?.disabled).toBeTrue();
  });

  it('並排查閱：少於兩個開著的文件視窗時停用；並排只排未關閉的視窗；還原視窗位置回到預設', () => {
    const { game } = h;
    playM1To(game, 'day.05', M1_SAVE_A);
    fixture = render();
    const docs = TestBed.inject(MailAttachmentService);
    const windows = TestBed.inject(WindowManagerService);
    windows.setCompact(false);
    windows.setBounds(1200, 700);
    const tile = () => root(fixture!).querySelector<HTMLButtonElement>('[data-tile-windows]');
    expect(tile()?.textContent?.trim()).toBe(WORKDAY_UI.compare);
    expect(tile()?.disabled).toBeTrue();

    const a = { kind: 'case-source', documentId: 'doc.day4.m1-0314-window' } as const;
    const b = { kind: 'case-source', documentId: 'doc.day4.m1-0521-reply' } as const;
    const c = { kind: 'batch-output', taskId: 'task.day4.m1-transform' } as const;
    docs.open(a);
    docs.open(b);
    docs.open(c);
    fixture.detectChanges();
    expect(tile()?.disabled).toBeFalse();
    const idOf = attachmentWindowId;
    const closedId = idOf(c);
    windows.close(closedId);
    fixture.detectChanges();
    expect(docs.shownRefs()).toEqual([a, b]);

    tile()?.click();
    fixture.detectChanges();
    const shown = [idOf(a), idOf(b)].map((id) => windows.state(id)());
    expect(shown.every((w) => w?.mode === 'normal')).toBeTrue();
    expect(shown[0]?.x).not.toBe(shown[1]?.x);
    expect(windows.state(closedId)()?.mode).toBe('closed');

    root(fixture).querySelector<HTMLButtonElement>('[data-reset-windows]')?.click();
    fixture.detectChanges();
    expect(windows.state(closedId)()?.mode).toBe('closed');
  });

  it('版面：375px 與 1366px 寬都沒有橫向溢出（表格在自己的捲動區內）；處理列固定在捲動區底部', () => {
    const { game } = h;
    playM1To(game, 'day.05', M1_SAVE_B);
    playM1UntilKind(game, 'transform', M1_SAVE_B);
    game.setTransformPolicy('review');
    game.previewTransform();
    for (const width of [375, 1366]) {
      fixture?.nativeElement.remove();
      fixture?.destroy();
      fixture = render();
      const host = root(fixture);
      host.style.display = 'block';
      host.style.width = `${width}px`;
      fixture.detectChanges();
      expect(host.scrollWidth).withContext(`${width}px`).toBeLessThanOrEqual(width);
      const bar = host.querySelector<HTMLElement>('.work-bar');
      expect(bar).withContext(`${width}px`).not.toBeNull();
      const style = getComputedStyle(bar as HTMLElement);
      expect(style.position).toBe('sticky');
      expect(style.bottom).toBe('0px');
      const barRect = (bar as HTMLElement).getBoundingClientRect();
      expect(barRect.right).withContext(`${width}px`).toBeLessThanOrEqual(host.getBoundingClientRect().right + 1);
    }
    playM1Day(game, M1_SAVE_B);
  });
});
