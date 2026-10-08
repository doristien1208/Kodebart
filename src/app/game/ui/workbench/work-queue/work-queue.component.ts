import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import { TASKS_UI, WORKDAY_UI, taskKindLabel, taskUnit } from '../../../content/text';
import type { DayTaskItem } from '../../../state/game-state.service';

/** 佇列一項的狀態文字：進行中、已送件、待補（送出但仍有缺漏）、等待前一批交付、待辦、不適用（舊檔免補）。 */
export function queueStatusLabel(t: DayTaskItem): string {
  if (t.status === 'active') return TASKS_UI.statusActive;
  if (t.status === 'waived') return TASKS_UI.statusWaived;
  if (t.status === 'done') return t.awaiting ? WORKDAY_UI.statusPending : WORKDAY_UI.statusSent;
  return t.locked ? WORKDAY_UI.pendingDependency : WORKDAY_UI.statusTodo;
}

/**
 * 工作佇列（M1 §1）：當日工作一列一項——種類、名稱、數量與狀態（待辦／進行中／已送件／待補／等待前一批交付）。
 *
 * - 沒有資料依賴的工作可以自選順序：點選可開始的項目就切換目前工作（草稿與畫面狀態留在原工作）；
 *   有依賴的工作鎖住，列出等待哪一件交付。已送件的項目不能再切回（結果在送件副本、郵件與紀錄裡）。
 * - 只有 input／output；資料由 WorkView 從 `game.dayTasks()` 傳入。同日換工作後 WorkView 把焦點移到佇列標題。
 */
@Component({
  selector: 'app-work-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './work-queue.component.html',
  styleUrl: './work-queue.component.css',
})
export class WorkQueueComponent {
  readonly tasks = input.required<readonly DayTaskItem[]>();
  readonly select = output<string>();

  protected readonly ui = WORKDAY_UI;
  protected readonly listLabel = TASKS_UI.listLabel;
  protected readonly kindLabel = taskKindLabel;
  protected readonly unit = taskUnit;
  protected readonly statusLabel = queueStatusLabel;

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** 目前工作的名稱（螢幕閱讀器在切換後聽到）。 */
  protected readonly current = computed(() => this.tasks().find((t) => t.status === 'active') ?? null);

  focusCurrent(): void {
    this.heading()?.nativeElement.focus();
  }
}
