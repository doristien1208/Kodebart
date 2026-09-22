import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MESSAGES } from '../../content/text';
import { GameStateService } from '../../state/game-state.service';

/** 同事訊息（對應原型 messages()）。Day2 閒聊句依 night.smallTalkVariant 選擇。 */
@Component({
  selector: 'app-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="panel">
      <div class="eyebrow">{{ MESSAGES.eyebrow }}</div>
      <h3>{{ MESSAGES.author }}</h3>
      @for (line of lines(); track $index) {
        <div class="message">
          <div class="message-author">{{ MESSAGES.author }} · {{ MESSAGES.time[game.day()] }}</div>
          <p>{{ line }}</p>
        </div>
      }
      <button type="button" (click)="back()">{{ MESSAGES.back }}</button>
    </article>
  `,
})
export class MessagesComponent {
  protected readonly game = inject(GameStateService);
  private readonly router = inject(Router);

  protected readonly MESSAGES = MESSAGES;

  protected readonly lines = computed<readonly string[]>(() => {
    if (this.game.day() === 1) return MESSAGES.day1;
    const night = this.game.night();
    return night ? [MESSAGES.day2Lead, MESSAGES.day2SmallTalk[night.smallTalkVariant]] : [MESSAGES.day2Lead];
  });

  protected back(): void {
    this.router.navigateByUrl('/work');
  }
}
