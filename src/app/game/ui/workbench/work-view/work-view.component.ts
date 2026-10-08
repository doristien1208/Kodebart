import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { WORKDAY_UI } from '../../../content/text';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { ArchiveWorkComponent } from '../../archive/archive-work/archive-work.component';
import { AttachmentWorkComponent } from '../../attachment/attachment-work/attachment-work.component';
import { Day2ReconcileComponent } from '../../day2/day2-reconcile/day2-reconcile.component';
import { FieldMappingComponent } from '../../field-map/field-mapping/field-mapping.component';
import { ReportWorkComponent } from '../../report/report-work/report-work.component';
import { ReturnReviewComponent } from '../../return-review/return-review/return-review.component';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { TransformWorkComponent } from '../../transform/transform-work/transform-work.component';
import { HandoffPanelComponent } from '../handoff-panel/handoff-panel.component';
import { handoffView } from '../presenters/handoff';
import { WorkDeliveryService } from '../services/work-delivery.service';
import { WorkQueueComponent } from '../work-queue/work-queue.component';

/**
 * 工作平台的工作視圖（M1 §1）：左側工作佇列、右側目前文件（依目前 task 的 kind 選擇工作元件），
 * 各工作元件的底部處理列固定在捲動區底部（.work-bar）。
 *
 * - 佇列：種類、待辦／進行中／已送件／待補、等待前一批交付；沒有依賴的工作可以點選切換（草稿保留在原工作）。
 * - 目前文件：archive＝歸檔、reconcile＝核對、field-map＝欄位映射、return-review＝錯誤文件處理、
 *   attachment＝附件關聯、transform＝批次轉換、report＝交付結果核對。完整文件、JSON 與紀錄在桌面視窗開啟，不堆在正文。
 * - 當日最後一件按交付時，目前文件換成「本日交接」（交付清單＋留待下一工作日），確認後才離開桌面。
 * - 「還原視窗位置」讓文件、紀錄與應用視窗回到預設版面。
 * - 同日換工作後把焦點移到佇列標題（R8）；相同 kind 連續時元件沿用，本地狀態以 linkedSignal 綁在 taskId 上。
 */
@Component({
  selector: 'app-work-view',
  imports: [
    ArchiveWorkComponent,
    AttachmentWorkComponent,
    Day2ReconcileComponent,
    FieldMappingComponent,
    HandoffPanelComponent,
    ReportWorkComponent,
    ReturnReviewComponent,
    TransformWorkComponent,
    WorkQueueComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work-view.component.html',
  styleUrl: './work-view.component.css',
})
export class WorkViewComponent {
  protected readonly game = inject(GameStateService);
  private readonly delivery = inject(WorkDeliveryService);
  private readonly windows = inject(WindowManagerService);
  private readonly injector = inject(Injector);
  private readonly queue = viewChild(WorkQueueComponent);

  protected readonly ui = WORKDAY_UI;

  /** 本日交接（只有交付最後一件時打開）。 */
  protected readonly handoff = computed(() => {
    const save = this.game.save();
    return save && this.delivery.handoffOpen() ? handoffView(save, this.game.dayTasks(), DAY_DIRECTORY) : null;
  });

  constructor() {
    let previous: string | null | undefined;
    effect(() => {
      const id = this.game.taskId();
      untracked(() => {
        const switched = previous !== undefined && previous !== id && this.game.stage() === 'work';
        previous = id;
        if (switched) afterNextRender(() => this.queue()?.focusCurrent(), { injector: this.injector });
      });
    });
  }

  protected onSelect(taskId: string): void {
    this.delivery.cancelHandoff();
    this.game.selectTask(taskId);
  }

  protected onConfirmHandoff(): void {
    this.delivery.confirmHandoff();
  }

  protected onCancelHandoff(): void {
    this.delivery.cancelHandoff();
  }

  protected resetWindows(): void {
    this.windows.resetLayout();
  }
}
