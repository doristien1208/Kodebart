import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { EndTransitionText, isEndTransitionText } from '../../../content/schema';
import { pageTitle } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';

/**
 * Demo 結束畫面（Stage `end`；原型 end()）。
 * 文字讀目前 DayContent 的 transition（最後一日為 EndTransitionText）。
 * 與工作種類無關（R6-02）：只顯示日常結語與中性摘要，不讀任何工作的回覆或結果；
 * 不揭露真相、不標示勝敗、不顯示善惡評分。
 */
@Component({
  selector: 'app-end',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './end.component.html',
})
export class EndComponent {
  private readonly game = inject(GameStateService);
  protected readonly router = inject(Router);
  private readonly title = inject(Title);

  /** 目前日別的結束轉場文字；不是 end 形狀（或尚無存檔）時為 null，由 stage guard 導正。 */
  protected readonly text = computed<EndTransitionText | null>(() => {
    const t = this.game.dayContent()?.transition.text;
    return t !== undefined && isEndTransitionText(t) ? t : null;
  });

  constructor() {
    this.title.setTitle(pageTitle(this.text()?.docTitle ?? ''));
  }
}
