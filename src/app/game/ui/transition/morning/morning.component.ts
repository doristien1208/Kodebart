import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MORNING_UI, WORKBENCH, morningDocTitle, morningPending, pageTitle, taskKindLabel } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { routeForStage } from '../../../state/stage-route';

/** 次日收件清單的一列（畫面用）。 */
interface MorningRow {
  taskId: string;
  index: number;
  kind: string;
  heading: string;
  pending: string;
}

/**
 * 次日收件（Stage `morning`，路徑 /morning；R8 §2）。
 *
 * 是否在「早晨」完全由存檔的 stage 決定（stage guard 導正重載、返回與深連結），
 * 元件本地不保存任何流程狀態。顯示新工作日的一般問候（DayContent.workbench.greeting）、
 * 當日有序工作清單（種類、名稱、待處理數），按「開始今日工作」才進 /work。
 * 沒有假的等待：按鈕立即可用；動態開啟時只有短淡入與一次掃描線（CSS），
 * 遊戲設定關閉動態或系統 prefers-reduced-motion 時直接顯示。
 */
@Component({
  selector: 'app-morning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './morning.component.css',
  templateUrl: './morning.component.html',
  host: { '[class.kb-motion]': 'animate()' },
})
export class MorningComponent {
  private readonly game = inject(GameStateService);
  protected readonly router = inject(Router);
  private readonly title = inject(Title);

  protected readonly ui = MORNING_UI;
  protected readonly animate = inject(SettingsService).animationsEnabled;

  protected readonly greeting = computed(() => this.game.dayContent()?.workbench.greeting ?? '');
  protected readonly dayTag = computed(() => WORKBENCH.dayTag(this.game.dayNumber()));

  protected readonly rows = computed<readonly MorningRow[]>(() =>
    this.game.dayTasks().map((t) => ({
      taskId: t.taskId,
      index: t.index,
      kind: taskKindLabel(t.kind),
      heading: t.heading,
      pending: morningPending(t.kind, t.total),
    })),
  );

  constructor() {
    this.title.setTitle(pageTitle(morningDocTitle(this.game.dayNumber())));
  }

  /** 開始今日工作：morning → work，依新 stage 導向。 */
  protected onStart(): void {
    this.game.startDay();
    const stage = this.game.stage();
    void this.router.navigateByUrl(stage ? routeForStage(stage) : '/');
  }
}
