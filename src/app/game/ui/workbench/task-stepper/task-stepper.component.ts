import { ChangeDetectionStrategy, Component, ElementRef, computed, input, viewChild } from '@angular/core';
import { TASKS_UI, stepLabel, taskKindLabel } from '../../../content/text';
import type { DayTaskItem } from '../../../state/game-state.service';

/** 狀態 → 顯示文字（免補只顯示中性的「不適用」，不宣稱已提交）。 */
export function taskStatusLabel(status: DayTaskItem['status']): string {
  switch (status) {
    case 'done':
      return TASKS_UI.statusDone;
    case 'waived':
      return TASKS_UI.statusWaived;
    case 'active':
      return TASKS_UI.statusActive;
    case 'pending':
      return TASKS_UI.statusPending;
  }
}

/**
 * 工作頁上方的當日工作步驟（R8 §1.6）：「第 i / n 項」與每件工作的狀態。
 * 只有 input；資料由 WorkViewComponent 從 `game.dayTasks()` 傳入。
 * 同日換到下一件工作時，WorkView 會把焦點移到步驟標示（`focusCurrent()`），
 * 讓鍵盤與螢幕閱讀器使用者知道畫面已換成下一項。
 */
@Component({
  selector: 'app-task-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './task-stepper.component.html',
})
export class TaskStepperComponent {
  readonly tasks = input.required<readonly DayTaskItem[]>();

  protected readonly ui = TASKS_UI;
  protected readonly kindLabel = taskKindLabel;
  protected readonly statusLabel = taskStatusLabel;

  private readonly current = viewChild<ElementRef<HTMLElement>>('current');

  /** 進行中那一項的「第 i / n 項」；沒有進行中工作時為空字串。 */
  protected readonly step = computed(() => {
    const list = this.tasks();
    const active = list.find((t) => t.status === 'active');
    return active ? stepLabel(active.index, list.length) : '';
  });

  focusCurrent(): void {
    this.current()?.nativeElement.focus();
  }
}
