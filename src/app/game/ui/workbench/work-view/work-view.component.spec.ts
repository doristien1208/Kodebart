import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { archiveTask, reconcileTask, recordsOfTask } from '../../../content/bundle';
import { recordLabel } from '../../../content/records';
import { ARCHIVE_UI, DOCUMENT_ISSUES_UI, SOURCE_CARD, TASKS_UI, stepLabel, taskKindLabel } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { archiveAll, archiveOne, finishDay, instantOperations, playTo, reviewAll, settle } from '../../testing/play';
import { WorkViewComponent } from './work-view.component';

/**
 * R8 §1.6：工作頁的當日步驟、交付按鈕文字、同日換工作不離開 /work，
 * 以及換到下一件歸檔工作時本地畫面狀態（選取、預覽、錯誤）重設為新批次第一筆。
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

function stepText(fixture: ComponentFixture<WorkViewComponent>): string {
  return root(fixture).querySelector('[data-step]')?.textContent?.trim() ?? '';
}

function statuses(fixture: ComponentFixture<WorkViewComponent>): string[] {
  return Array.from(root(fixture).querySelectorAll('app-task-stepper li')).map(
    (li) => li.getAttribute('data-task-status') ?? '',
  );
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

  it('Day 1 第一件：「第 1 / 2 項」、進行中／待處理、按鈕為「交付此項工作」', () => {
    fixture = render();
    expect(stepText(fixture)).toBe(stepLabel(1, 2));
    expect(stepText(fixture)).toBe('第 1 / 2 項');
    expect(statuses(fixture)).toEqual(['active', 'pending']);
    const labels = root(fixture).querySelector('app-task-stepper ol')?.textContent ?? '';
    expect(labels).toContain(TASKS_UI.statusActive);
    expect(labels).toContain(TASKS_UI.statusPending);
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
    expect(stepText(fixture)).toBe(stepLabel(2, 2));
    expect(statuses(fixture)).toEqual(['done', 'active']);
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

    // 最後一件：按鈕改為「完成今日交接」，交付後才到本日交接
    expect(buttonByText(fixture, TASKS_UI.finishDay)?.disabled).toBeTrue();
    archiveAll(game);
    fixture.detectChanges();
    expect(buttonByText(fixture, TASKS_UI.finishDay)?.disabled).toBeFalse();
    buttonByText(fixture, TASKS_UI.finishDay)?.click();
    await fixture.whenStable();
    expect(game.stage()).toBe('wrap');
    expect(h.navigated[h.navigated.length - 1]).toBe('/overnight');
  });

  it('Day 2 核對：回覆對話框的確認鍵為「交付此項工作」，送出後留在 /work 換成當日歸檔，四格結果不變', async () => {
    const { game } = h;
    finishDay(game);
    expect(game.dayId()).toBe('day.02');
    fixture = render();
    expect(stepText(fixture)).toBe(stepLabel(1, 2));

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
    expect(stepText(fixture)).toBe(stepLabel(2, 2));
    expect(statuses(fixture)).toEqual(['done', 'active']);
    expect(root(fixture).querySelector('app-day2-reconcile')).toBeNull();
    expect(selectedLabel(fixture)).toBe(recordLabel(recordsOfTask('task.day2.archive')[0]!));
    expect(buttonByText(fixture, TASKS_UI.finishDay)).toBeDefined();
  });

  it('單一工作的日子（Day 3）：「第 1 / 1 項」，按鈕直接是「完成今日交接」', () => {
    finishDay(h.game);
    finishDay(h.game);
    expect(h.game.dayId()).toBe('day.03');
    fixture = render();
    expect(stepText(fixture)).toBe(stepLabel(1, 1));
    expect(buttonByText(fixture, TASKS_UI.finishDay)).toBeDefined();
    expect(buttonByText(fixture, TASKS_UI.deliver)).toBeUndefined();
  });

  /* ---------- R10：退件複審只在有退件時出現在當日步驟 ---------- */

  it('Day 1 填「102」且 Day 2 放行 → Day 4 步驟多一項「複審／錯誤文件處理」', () => {
    const { game } = h;
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    playTo(game, 'day.04');
    fixture = render();
    expect(stepText(fixture)).toBe(stepLabel(1, 2));
    const items = Array.from(root(fixture).querySelectorAll('app-task-stepper li'));
    expect(items.length).toBe(2);
    expect(items[1]?.textContent).toContain(taskKindLabel('return-review'));
    expect(items[1]?.textContent).toContain(DOCUMENT_ISSUES_UI.taskHeading);
    expect(statuses(fixture)).toEqual(['active', 'pending']);
  });

  it('照來源填寫並放行（沒有退件）→ Day 4 不出現空的複審工作', () => {
    playTo(h.game, 'day.04');
    fixture = render();
    expect(stepText(fixture)).toBe(stepLabel(1, 1));
    expect(root(fixture).querySelectorAll('app-task-stepper li').length).toBe(1);
    expect(root(fixture).querySelector('app-task-stepper')?.textContent).not.toContain(DOCUMENT_ISSUES_UI.taskHeading);
  });
});
