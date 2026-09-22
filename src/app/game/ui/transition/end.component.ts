import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { END, pageTitle } from '../../content/text';
import { GameStateService } from '../../state/game-state.service';

/**
 * Demo 結束畫面（原型 end()）。
 * 日常結語＋依 reply 顯示文書回應；不揭露真相、不標示勝敗、不顯示善惡評分。
 */
@Component({
  selector: 'app-end',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="transition-screen">
      <div class="w-[38rem] max-w-full">
        <div class="eyebrow mb-8">{{ END.eyebrow }}</div>
        <h1 class="text-[2rem] md:text-[2.5rem] tracking-[.1em]">{{ END.heading }}</h1>
        <p class="text-muted">{{ END.body }}</p>
        <div class="panel">
          <p>{{ outcome() }}</p>
          <p class="text-sm text-muted mb-0">{{ END.thanks }}</p>
        </div>
        <p class="text-sm text-muted">{{ END.outro }}</p>
        <button type="button" class="btn-primary mt-8" (click)="router.navigateByUrl('/')">{{ END.backToCover }}</button>
      </div>
    </section>
  `,
})
export class EndComponent {
  private readonly game = inject(GameStateService);
  protected readonly router = inject(Router);
  private readonly title = inject(Title);
  protected readonly END = END;

  /** reply 為 null 時防呆顯示 ack 版本。 */
  protected readonly outcome = computed(() => END.outcome[this.game.reply() ?? 'ack']);

  constructor() {
    this.title.setTitle(pageTitle(END.docTitle));
  }
}
