import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

export const SETTINGS_KEY = 'kodebart-settings-v1';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * 使用者設定與系統動態偏好的單一來源。
 *
 * - `motion`：遊戲內「啟用選單動態」設定。關閉時在 body 加上 no-motion，
 *   全域 CSS 會停用受控的動畫。
 * - `reducedMotion`：系統層級 prefers-reduced-motion，優先於遊戲設定。
 * - `animationsEnabled`：兩者皆允許時才為 true。**所有動畫排程與繪圖迴圈
 *   都應以此為準**，停用時要真的停止 timer／rAF，而不只是隱藏畫面。
 *
 * 本版沒有音訊，因此不提供音量設定。
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly document = inject(DOCUMENT);

  readonly motion = signal(true);
  readonly reducedMotion = signal(false);
  readonly animationsEnabled = computed(() => this.motion() && !this.reducedMotion());

  constructor() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { motion?: unknown }).motion === 'boolean'
        ) {
          this.motion.set((parsed as { motion: boolean }).motion);
        }
      }
    } catch {
      /* 設定讀取失敗就用預設值 */
    }

    const view = this.document.defaultView;
    if (view) {
      const query = view.matchMedia(REDUCED_MOTION_QUERY);
      this.reducedMotion.set(query.matches);
      const onChange = (event: MediaQueryListEvent) => this.reducedMotion.set(event.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }

    effect(() => {
      const on = this.motion();
      this.document.body.classList.toggle('no-motion', !on);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ motion: on }));
      } catch {
        /* 儲存失敗不影響本次設定 */
      }
    });
  }

  setMotion(on: boolean): void {
    this.motion.set(on);
  }
}
