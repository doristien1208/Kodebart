import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { GameStateService } from '../../../state/game-state.service';
import { ArchiveWorkComponent } from '../../archive/archive-work/archive-work.component';
import { Day2ReconcileComponent } from '../../day2/day2-reconcile/day2-reconcile.component';
import { FieldMappingComponent } from '../../field-map/field-mapping/field-mapping.component';
import { ReturnReviewComponent } from '../../return-review/return-review/return-review.component';
import { TaskStepperComponent } from '../task-stepper/task-stepper.component';

/**
 * /work 子路由：當日工作步驟＋依目前 task 的 kind 選擇工作元件（KB-R5-03 第 4 點／R6-03／R8）。
 * archive＝歸檔、reconcile＝核對、field-map＝欄位映射。不以日數選元件，也不做通用渲染；
 * 新增玩法才需要在這裡加一個 case。
 *
 * R8：同一天可以有多件工作。換成不同 kind 時 @switch 會換元件；相同 kind 連續
 * （例如 archive → archive）時元件沿用，但各元件的本地畫面狀態（歸檔的目前選取／預覽／錯誤、
 * 映射的錯誤、核對的待確認選項）都以 `linkedSignal` 綁在 `taskId` 上，taskId 一變就回到
 * 新工作的初始值，不會拿前一批的 key 讀資料。（不用 `@for track` 強制重建：
 * 那會觸發 NG0956 的開發警告。）同日換工作後把焦點移到步驟標示，因為交付按鈕在新工作中是停用的。
 */
@Component({
  selector: 'app-work-view',
  imports: [ArchiveWorkComponent, Day2ReconcileComponent, FieldMappingComponent, ReturnReviewComponent, TaskStepperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work-view.component.html',
})
export class WorkViewComponent {
  protected readonly game = inject(GameStateService);
  private readonly injector = inject(Injector);
  private readonly stepper = viewChild(TaskStepperComponent);

  constructor() {
    let previous: string | null | undefined;
    effect(() => {
      const id = this.game.taskId();
      untracked(() => {
        const switched = previous !== undefined && previous !== id && this.game.stage() === 'work';
        previous = id;
        if (switched) afterNextRender(() => this.stepper()?.focusCurrent(), { injector: this.injector });
      });
    });
  }
}
