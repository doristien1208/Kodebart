import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { WindowManagerService } from '../../shared/services/window-manager.service';

/** 桌面上的應用（R12 §5）：每個應用一個主視窗。 */
export type DesktopAppId = 'work' | 'messages' | 'mail';
export const DESKTOP_APPS: readonly DesktopAppId[] = ['work', 'messages', 'mail'];

/** 各應用主視窗的穩定 window ID。 */
export const APP_WINDOW_IDS: Readonly<Record<DesktopAppId, string>> = {
  work: 'app.work',
  messages: 'app.messages',
  mail: 'app.mail',
};

/**
 * 桌面層的應用協調（R12 §5）：開啟／置前應用主視窗，並回答「某應用目前是否作用中」。
 *
 * - 只存在本次工作階段；視窗位置等狀態在 WindowManagerService。
 * - openApp 可在主視窗註冊前呼叫（例如從深連結或別的應用跳轉）：先記下，註冊後立即開啟。
 * - 作用中＝該應用主視窗顯示中且在最上層，而且瀏覽器頁籤可見、視窗有焦點。
 *   訊息已讀、紅點等依此判斷，不看路由進出。
 */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  private readonly windows = inject(WindowManagerService);
  private readonly document = inject(DOCUMENT);
  private readonly pending = new Set<DesktopAppId>();
  /** 本次工作階段最後一次打開桌面時的存檔 seed（判斷「這份存檔第一次進桌面」）。 */
  private sessionSeed: number | null = null;

  private readonly _pageVisible = signal(true);
  private readonly _pageFocused = signal(true);

  /** 瀏覽器頁籤可見且視窗有焦點。 */
  readonly pageActive: Signal<boolean> = computed(() => this._pageVisible() && this._pageFocused());

  constructor() {
    const doc = this.document;
    const view = doc.defaultView;
    const sync = () => {
      this._pageVisible.set(doc.visibilityState !== 'hidden');
      this._pageFocused.set(typeof doc.hasFocus === 'function' ? doc.hasFocus() : true);
    };
    sync();
    doc.addEventListener('visibilitychange', sync);
    view?.addEventListener('focus', sync);
    view?.addEventListener('blur', sync);
    inject(DestroyRef).onDestroy(() => {
      doc.removeEventListener('visibilitychange', sync);
      view?.removeEventListener('focus', sync);
      view?.removeEventListener('blur', sync);
    });
  }

  /**
   * 桌面掛載時呼叫：本次工作階段第一次為這份存檔（seed）打開桌面時回傳 true——
   * 入職完成後進桌面、重新整理、同一分頁開新遊戲都算；離開桌面再回來（例如返回開始頁後繼續）則為 false。
   * 桌面據此決定是否自動打開工作平台（「首次入職完成自動打開工作平台」）。
   */
  beginSession(seed: number): boolean {
    if (this.sessionSeed === seed) return false;
    this.sessionSeed = seed;
    return true;
  }

  /** 開啟（或還原、置前）應用主視窗；尚未註冊時記下，註冊後由 flushPending 開啟。 */
  openApp(app: DesktopAppId): void {
    const id = APP_WINDOW_IDS[app];
    if (this.windows.state(id)() === undefined) {
      this.pending.add(app);
      return;
    }
    this.windows.open(id);
  }

  /** 主視窗註冊後呼叫：開啟註冊前被要求開啟的應用。 */
  flushPending(app: DesktopAppId): void {
    if (!this.pending.delete(app)) return;
    this.windows.open(APP_WINDOW_IDS[app]);
  }

  /** 應用主視窗顯示中（未最小化／關閉；小螢幕時為單窗顯示中的那一個）。 */
  isAppShown(app: DesktopAppId): boolean {
    return this.windows.isShown(APP_WINDOW_IDS[app]);
  }

  /** 應用作用中：顯示中、最上層，且頁籤可見、視窗有焦點。在 computed 中呼叫會隨狀態更新。 */
  isAppActive(app: DesktopAppId): boolean {
    this.windows.windows();
    this.windows.compactActive();
    return this.pageActive() && this.windows.isTop(APP_WINDOW_IDS[app]);
  }
}
