import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { WrapTransitionText, isWrapTransitionText } from '../../../content/schema';
import { HANDOFF_UI, TASKS_UI, handoffItem, pageTitle, taskKindLabel, totalTasks } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { routeForStage } from '../../../state/stage-route';

/** 本日交接清單的一列（畫面用）。 */
interface HandoffRow {
  taskId: string;
  index: number;
  heading: string;
  /** 已交付：「歸檔 3 筆」；免補：只有種類（數量不顯示，不宣稱已提交）。 */
  summary: string;
  done: boolean;
}

/**
 * 本日交接（Stage `wrap`，路徑沿用 /overnight；R8 §2）。
 *
 * 當日文字（eyebrow／heading／body／docTitle）讀目前 DayContent 的 wrap transition；
 * 逐項工作清單讀 `game.dayTasks()`：名稱、種類的業務動詞、該項實際筆數／列數與完成標記。
 * 總數是「項工作」的項數，不把核對來源筆數與歸檔筆數加總。舊檔免補的工作以中性的
 * 「不適用」顯示。不顯示夜間結果、未到日的內容或任何「安排」結論。
 * 按「結束今日，查看明日收件」才跨日；夜間判定在 core（advanceDay）且只判定一次。
 */
@Component({
  selector: 'app-overnight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overnight.component.html',
})
export class OvernightComponent {
  private readonly game = inject(GameStateService);
  protected readonly router = inject(Router);
  private readonly title = inject(Title);

  protected readonly ui = HANDOFF_UI;

  /** 目前日別的日結文字；不是 wrap 形狀（或尚無存檔）時為 null，由 stage guard 導正。 */
  protected readonly text = computed<WrapTransitionText | null>(() => {
    const t = this.game.dayContent()?.transition.text;
    return t !== undefined && isWrapTransitionText(t) ? t : null;
  });

  protected readonly rows = computed<readonly HandoffRow[]>(() =>
    this.game.dayTasks().map((t) => {
      const done = t.status === 'done';
      return {
        taskId: t.taskId,
        index: t.index,
        heading: t.heading,
        summary: done ? handoffItem(t.kind, t.processed) : taskKindLabel(t.kind),
        done,
      };
    }),
  );

  protected readonly waivedLabel = TASKS_UI.statusWaived;
  protected readonly doneLabel = TASKS_UI.statusDone;
  protected readonly totalText = computed(() => totalTasks(this.rows().length));

  constructor() {
    this.title.setTitle(pageTitle(this.text()?.docTitle ?? ''));
  }

  /** 結束今日：前往次日收件（或最後一日的結束畫面），依新 stage 導向。 */
  protected onNext(): void {
    this.game.advanceDay();
    const stage = this.game.stage();
    void this.router.navigateByUrl(stage ? routeForStage(stage) : '/');
  }
}
