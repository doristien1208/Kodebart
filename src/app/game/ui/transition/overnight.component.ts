import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { OVERNIGHT, pageTitle } from '../../content/text';
import { GameStateService } from '../../state/game-state.service';

/**
 * Day 1 結束轉場（原型 overnight()）。
 * 只有工作層面的結語；夜間判定在 core（advanceToDay2）且只判定一次，這裡不擲骰。
 */
@Component({
  selector: 'app-overnight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="transition-screen">
      <div class="w-[38rem] max-w-full">
        <div class="eyebrow mb-8">{{ OVERNIGHT.eyebrow }}</div>
        <h1 class="text-[2rem] md:text-[2.5rem] tracking-[.1em]">{{ OVERNIGHT.heading }}</h1>
        <p class="text-muted">{{ OVERNIGHT.body }}</p>
        <div class="panel">
          <span class="count">{{ countText() }}</span>
          <span>{{ OVERNIGHT.countLabel }}</span>
        </div>
        <button type="button" class="btn-primary mt-8" (click)="onNext()">{{ OVERNIGHT.next }}</button>
        <div class="flex gap-2.5 items-center flex-wrap mt-5">
          <button type="button" class="btn-ghost" (click)="router.navigateByUrl('/')">{{ OVERNIGHT.backToCover }}</button>
        </div>
      </div>
    </section>
  `,
})
export class OvernightComponent {
  private readonly game = inject(GameStateService);
  protected readonly router = inject(Router);
  private readonly title = inject(Title);
  protected readonly OVERNIGHT = OVERNIGHT;

  /** 已處理筆數取自存檔，不寫死；補零到兩位數。 */
  protected readonly countText = computed(() => OVERNIGHT.count(this.game.archivedCount()));

  constructor() {
    this.title.setTitle(pageTitle(OVERNIGHT.docTitle));
  }

  protected onNext(): void {
    this.game.advanceToDay2();
    this.router.navigateByUrl('/work');
  }
}
