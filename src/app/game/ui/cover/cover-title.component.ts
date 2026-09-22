import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { SettingsService } from '../../platform/settings.service';

/**
 * 標題 glitch 的節奏。第四輪依使用者「要更常出現」把間隔由 5–10 秒縮短為試作值；
 * 單次長度與位移維持第三輪數值，避免同時改太多變因。
 */
export const GLITCH = {
  intervalMinMs: 3000,
  intervalMaxMs: 6000,
  durationMinMs: 200,
  durationMaxMs: 350,
} as const;

/**
 * 開始頁主標題（KB-R4-02）：自帶 glitch 的排程生命週期，
 * 父元件不需要知道計時器的存在。字體、位置與大小由樣式維持不變。
 */
@Component({
  selector: 'app-cover-title',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1
      class="cover-title"
      [class.is-glitching]="active()"
      [style.--kb-glitch-duration]="duration()"
      [attr.data-text]="text()"
    >{{ text() }}</h1>
  `,
  styles: `
    :host { display: block; }
    h1 {
      font-size: clamp(3rem, 6.6vw, 6rem);
      line-height: 1.18;
      letter-spacing: .16em;
      text-shadow: 3px 3px 0 var(--color-elevated);
      margin: 1.1rem 0;
    }
    /* 播放期間疊上兩層帶狀複本；位置與大小不變 */
    .cover-title { position: relative; display: inline-block; }
    .cover-title::before,
    .cover-title::after {
      content: attr(data-text);
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      pointer-events: none;
      text-shadow: none;
      opacity: 0;
    }
    .cover-title.is-glitching::before {
      opacity: .85;
      color: var(--color-primary);
      animation: kb-glitch-cyan var(--kb-glitch-duration, 280ms) steps(3, end) both;
    }
    .cover-title.is-glitching::after {
      opacity: .7;
      color: var(--color-text);
      animation: kb-glitch-shift var(--kb-glitch-duration, 280ms) steps(3, end) both;
    }
    /* 頭尾以 inset(0 0 100% 0) 完全裁掉，播放前後都看不見 */
    @keyframes kb-glitch-cyan {
      0%, 100% { clip-path: inset(0 0 100% 0); transform: translateX(0); }
      20% { clip-path: inset(14% 0 62% 0); transform: translateX(-3px); }
      45% { clip-path: inset(46% 0 34% 0); transform: translateX(2px); }
      70% { clip-path: inset(70% 0 12% 0); transform: translateX(-2px); }
      90% { clip-path: inset(30% 0 54% 0); transform: translateX(1px); }
    }
    @keyframes kb-glitch-shift {
      0%, 100% { clip-path: inset(0 0 100% 0); transform: translateX(0); }
      25% { clip-path: inset(56% 0 26% 0); transform: translateX(3px); }
      55% { clip-path: inset(22% 0 60% 0); transform: translateX(-1px); }
      80% { clip-path: inset(64% 0 18% 0); transform: translateX(2px); }
    }
    :host-context(body.no-motion) .cover-title::before,
    :host-context(body.no-motion) .cover-title::after { animation: none; opacity: 0; }
    @media (prefers-reduced-motion: reduce) {
      .cover-title::before,
      .cover-title::after { animation: none !important; opacity: 0 !important; }
    }
    @media (max-width: 699.98px) {
      h1 { letter-spacing: .1em; }
    }
  `,
})
export class CoverTitleComponent {
  readonly text = input.required<string>();

  private readonly settings = inject(SettingsService);
  protected readonly active = signal(false);
  protected readonly duration = signal(`${GLITCH.durationMinMs}ms`);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());

    // 關閉動態或系統要求減少動態時停止排程，不只是隱藏效果。
    effect(() => {
      const enabled = this.settings.animationsEnabled();
      this.clear();
      if (!enabled) {
        this.active.set(false);
        return;
      }
      this.schedule();
    });
  }

  private schedule(): void {
    const delay =
      GLITCH.intervalMinMs + Math.random() * (GLITCH.intervalMaxMs - GLITCH.intervalMinMs);
    this.timer = setTimeout(() => this.play(), delay);
  }

  private play(): void {
    const ms = Math.round(
      GLITCH.durationMinMs + Math.random() * (GLITCH.durationMaxMs - GLITCH.durationMinMs),
    );
    this.duration.set(`${ms}ms`);
    this.active.set(true);
    this.timer = setTimeout(() => {
      this.active.set(false);
      this.schedule();
    }, ms);
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
