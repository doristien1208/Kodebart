import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { SettingsService } from '../../../platform/settings.service';

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
  templateUrl: './cover-title.component.html',
  styleUrl: './cover-title.component.css',
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
