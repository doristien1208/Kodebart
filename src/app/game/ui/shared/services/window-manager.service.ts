import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';

/** 視窗顯示狀態：一般（浮動）、最小化（只在視窗列）、最大化（填滿工作區）、關閉（從原入口重開）。 */
export type WindowMode = 'normal' | 'minimized' | 'maximized' | 'closed';

/** 一個視窗目前的位置、尺寸、層級與顯示狀態（座標相對於工作區左上角，單位 px）。 */
export interface WindowState {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  mode: WindowMode;
}

/** 視窗第一次註冊時的預設位置與尺寸（也是「重設視窗位置」回到的值）。 */
export interface WindowDefaults {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * 預設顯示狀態（省略＝一般）：例如桌面太窄時紀錄窗預設最小化，不遮住工作內容；
   * 應用主視窗（通訊、郵件）預設關閉，從桌面入口／捷徑開啟（R12）。
   */
  mode?: 'normal' | 'minimized' | 'closed';
  /**
   * 輔助視窗（例如系統作業紀錄）會讓位：它是一般模式、玩家還沒移動／調整過它時，
   * 第一次開啟的其他視窗若蓋到它，它就自動最小化（隨時可從視窗列還原）；
   * 「重設視窗位置」時也依掛載中的視窗同樣判斷，所以重設後的版面與初次開啟一致。
   */
  yields?: boolean;
}

/** 視窗最小寬／高（px）。 */
export const WINDOW_MIN_WIDTH = 240;
export const WINDOW_MIN_HEIGHT = 140;
/** 標題列高度；限制 y 讓標題列一定留在工作區內。 */
export const WINDOW_TITLE_BAR = 44;
/** 視窗往左右拖出工作區時，至少保留這麼寬的標題列可以抓回來。 */
export const WINDOW_MIN_VISIBLE = 120;
/** 小螢幕（< md 700px）：單窗最大化，視窗列當切換器。 */
export const WINDOW_COMPACT_QUERY = '(max-width: 699.98px)';

/** 桌面（視窗可用範圍）尺寸（px）。 */
export interface WorkspaceBounds {
  width: number;
  height: number;
}

type Rect = Pick<WindowState, 'x' | 'y' | 'width' | 'height'>;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 浮動視窗管理（R10 §2／R12 §5）：穩定 window ID → 位置、尺寸、層級、顯示狀態。作用於整個桌面。
 *
 * - 只存在本次工作階段（不寫進遊戲存檔、不碰亂數）；切換應用、離開再回到桌面時狀態保留，
 *   視窗元件被銷毀再建立時沿用原狀態（register 是冪等的）。
 * - 關閉／最小化只改顯示狀態：視窗內容（草稿、案件變體、進行中的提交）完全不受影響。
 * - setBounds 給工作區尺寸；座標會限制在「標題列一定找得回來」的範圍，縮小瀏覽器時重新限制。
 * - 小螢幕（compact）不改各視窗的桌面狀態，只另外記「目前單窗顯示哪一個」（compactActive）。
 * - 沒有保留的停靠欄：視窗可用整個桌面；預設版面（應用主視窗、文件、紀錄窗）由各呼叫端依 bounds 計算。
 * - 會讓位的輔助視窗（defaults.yields）：玩家沒動過時，被第一次開啟的視窗蓋到就自動最小化（見 WindowDefaults）。
 * - WindowShell 只呈現並呼叫這裡的操作；WindowTaskbar 列出掛載中且未關閉的視窗。
 */
@Injectable({ providedIn: 'root' })
export class WindowManagerService {
  private readonly _windows = signal<readonly WindowState[]>([]);
  private readonly defaults = new Map<string, WindowDefaults>();
  /** 最小化前的模式（還原時回到一般或最大化）。 */
  private readonly beforeMinimize = new Map<string, 'normal' | 'maximized'>();
  private readonly stateCache = new Map<string, Signal<WindowState | undefined>>();
  private readonly mountCount = new Map<string, number>();
  private readonly _mounted = signal<ReadonlySet<string>>(new Set());
  private readonly _bounds = signal<WorkspaceBounds | null>(null);
  private readonly _compact = signal(false);
  private readonly _compactActive = signal<string | null>(null);
  private readonly _layer = signal<HTMLElement | null>(null);
  /** 玩家移動或調整過尺寸的視窗（「重設視窗位置」時清空）；會讓位的視窗動過就不再自動讓位。 */
  private readonly touched = new Set<string>();
  private topZ = 0;

  /** 所有已註冊的視窗（依註冊順序）。 */
  readonly windows: Signal<readonly WindowState[]> = this._windows.asReadonly();
  /** 目前畫面上有 WindowShell 掛載的視窗 ID。 */
  readonly mounted: Signal<ReadonlySet<string>> = this._mounted.asReadonly();
  /** 工作區尺寸（尚未量到時為 null）。 */
  readonly bounds: Signal<WorkspaceBounds | null> = this._bounds.asReadonly();
  /** 小螢幕：單窗最大化＋視窗列切換。 */
  readonly compact: Signal<boolean> = this._compact.asReadonly();
  /** 小螢幕時目前顯示的視窗（null＝顯示工作區內容）。 */
  readonly compactActive: Signal<string | null> = this._compactActive.asReadonly();
  /** 視窗浮動所在的圖層（工作區內）；沒有圖層時視窗留在原位、依文件流呈現。 */
  readonly layer: Signal<HTMLElement | null> = this._layer.asReadonly();

  /** 視窗列要列出的視窗：掛載中且未關閉。 */
  readonly taskbarWindows = computed(() => {
    const mounted = this._mounted();
    return this._windows().filter((w) => mounted.has(w.id) && w.mode !== 'closed');
  });

  constructor() {
    const view = inject(DOCUMENT).defaultView;
    if (view && typeof view.matchMedia === 'function') {
      const query = view.matchMedia(WINDOW_COMPACT_QUERY);
      this.setCompact(query.matches);
      const onChange = (event: MediaQueryListEvent) => this.setCompact(event.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
  }

  /* ---------- 註冊與查詢 ---------- */

  /**
   * 冪等：已註冊就保留原位置／尺寸／狀態（只同步標題）。之後傳入的預設值只更新
   * 「重設視窗位置」要回到的位置（例如工作區大小改變後重新計算的預設值），不移動視窗。
   *
   * 第一次註冊時處理讓位（不論註冊先後）：一般模式的新視窗會讓被它蓋到、玩家沒動過的讓位視窗最小化；
   * 讓位視窗本身註冊時若已被掛載中的視窗蓋到，就以最小化開始。
   */
  register(id: string, defaults: WindowDefaults): void {
    this.defaults.set(id, { ...defaults });
    const existing = this.find(id);
    if (existing) {
      if (existing.title !== defaults.title) this.patch(id, { title: defaults.title });
      return;
    }
    const geometry = this.fit(defaults.x, defaults.y, defaults.width, defaults.height);
    let mode: WindowMode = defaults.mode ?? 'normal';
    if (mode === 'normal') {
      if (defaults.yields) {
        if (this.coveredByMounted(id, geometry, this._windows())) mode = 'minimized';
      } else {
        this.yieldTo(geometry);
      }
    }
    if (mode === 'minimized') this.beforeMinimize.set(id, 'normal');
    this._windows.update((list) => [...list, { id, title: defaults.title, ...geometry, z: ++this.topZ, mode }]);
  }

  state(id: string): Signal<WindowState | undefined> {
    let cached = this.stateCache.get(id);
    if (!cached) {
      cached = computed(() => this._windows().find((w) => w.id === id));
      this.stateCache.set(id, cached);
    }
    return cached;
  }

  /** 視窗是否正顯示在畫面上（小螢幕時只有單窗顯示中的那一個）。 */
  isShown(id: string): boolean {
    const w = this.find(id);
    if (!w || w.mode === 'minimized' || w.mode === 'closed') return false;
    return this._compact() ? this._compactActive() === id : true;
  }

  /** 是否為最上層的顯示中視窗。 */
  isTop(id: string): boolean {
    if (!this.isShown(id)) return false;
    if (this._compact()) return true;
    const mounted = this._mounted();
    const z = this.find(id)?.z ?? 0;
    return this._windows().every(
      (w) => w.id === id || (mounted.size > 0 && !mounted.has(w.id)) || !this.isShown(w.id) || w.z < z,
    );
  }

  /* ---------- 顯示狀態 ---------- */

  /** 從原入口重開：關閉／最小化的恢復顯示；已開啟的只聚焦。 */
  open(id: string): void {
    const w = this.find(id);
    if (!w) return;
    if (w.mode === 'closed') this.patch(id, { mode: 'normal' });
    else if (w.mode === 'minimized') this.patch(id, { mode: this.beforeMinimize.get(id) ?? 'normal' });
    this.focus(id);
  }

  /** 置前（小螢幕時改成單窗顯示這一個）。 */
  focus(id: string): void {
    const w = this.find(id);
    if (!w) return;
    if (w.z !== this.topZ) this.patch(id, { z: ++this.topZ });
    if (this._compact() && (w.mode === 'normal' || w.mode === 'maximized')) this._compactActive.set(id);
  }

  minimize(id: string): void {
    const w = this.find(id);
    if (!w || w.mode === 'minimized' || w.mode === 'closed') return;
    this.beforeMinimize.set(id, w.mode === 'maximized' ? 'maximized' : 'normal');
    this.patch(id, { mode: 'minimized' });
    if (this._compactActive() === id) this._compactActive.set(null);
  }

  /** 一般 ↔ 最大化；位置與尺寸不變，還原時回到原處。 */
  toggleMaximize(id: string): void {
    const w = this.find(id);
    if (!w || w.mode === 'closed' || w.mode === 'minimized') return;
    this.patch(id, { mode: w.mode === 'maximized' ? 'normal' : 'maximized' });
    this.focus(id);
  }

  /** 最小化 → 回到最小化前的模式；最大化 → 一般。位置與尺寸保留。 */
  restore(id: string): void {
    const w = this.find(id);
    if (!w || w.mode === 'closed') return;
    if (w.mode === 'minimized') this.patch(id, { mode: this.beforeMinimize.get(id) ?? 'normal' });
    else if (w.mode === 'maximized') this.patch(id, { mode: 'normal' });
    this.focus(id);
  }

  close(id: string): void {
    const w = this.find(id);
    if (!w || w.mode === 'closed') return;
    this.beforeMinimize.delete(id);
    this.patch(id, { mode: 'closed' });
    if (this._compactActive() === id) this._compactActive.set(null);
  }

  /** 視窗列按鈕：最小化的還原；顯示中且在最上層的最小化；其餘置前。 */
  toggleFromTaskbar(id: string): void {
    const w = this.find(id);
    if (!w || w.mode === 'closed') return;
    if (w.mode === 'minimized') this.restore(id);
    else if (this.isTop(id)) this.minimize(id);
    else this.focus(id);
  }

  /* ---------- 幾何 ---------- */

  move(id: string, x: number, y: number): void {
    const w = this.find(id);
    if (!w) return;
    const g = this.clamp(x, y, w.width, w.height);
    if (g.x === w.x && g.y === w.y) return;
    this.touched.add(id);
    this.patch(id, { x: g.x, y: g.y });
  }

  resize(id: string, width: number, height: number): void {
    const w = this.find(id);
    if (!w) return;
    const g = this.clamp(w.x, w.y, width, height);
    if (g.x === w.x && g.y === w.y && g.width === w.width && g.height === w.height) return;
    this.touched.add(id);
    this.patch(id, g);
  }

  /**
   * 工作區尺寸；重新限制所有視窗：放得下的整個收進工作區（標題列按鈕也看得到），
   * 放不下的至少讓標題列留在找得回來的範圍。
   */
  setBounds(width: number, height: number): void {
    const prev = this._bounds();
    const next = { width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) };
    if (prev && prev.width === next.width && prev.height === next.height) return;
    this._bounds.set(next);
    this._windows.update((list) => {
      let changed = false;
      const out = list.map((w) => {
        const g = this.fit(w.x, w.y, w.width, w.height);
        if (g.x === w.x && g.y === w.y && g.width === w.width && g.height === w.height) return w;
        changed = true;
        return { ...w, ...g };
      });
      return changed ? out : list;
    });
  }

  /**
   * 全部回到預設位置與尺寸、依註冊順序排層級；最小化／最大化的回到預設顯示狀態（通常是一般；
   * 預設關閉的應用主視窗若開著則回到一般），關閉的維持關閉（從原入口重開）。
   * 讓位視窗若被掛載中、重設後為一般的視窗蓋到，同樣以最小化收起，與第一次開啟時的版面一致。
   */
  resetLayout(): void {
    this.topZ = 0;
    this.beforeMinimize.clear();
    this.touched.clear();
    const reset = this._windows().map((w) => {
      const d = this.defaults.get(w.id);
      const g = d ? this.fit(d.x, d.y, d.width, d.height) : { x: w.x, y: w.y, width: w.width, height: w.height };
      const mode: WindowMode = w.mode === 'closed' ? 'closed' : d?.mode === 'minimized' ? 'minimized' : 'normal';
      return { ...w, ...g, z: ++this.topZ, mode };
    });
    this._windows.set(
      reset.map((w) => {
        if (w.mode === 'minimized') this.beforeMinimize.set(w.id, 'normal');
        if (w.mode !== 'normal' || !this.defaults.get(w.id)?.yields || !this.coveredByMounted(w.id, w, reset)) return w;
        this.beforeMinimize.set(w.id, 'normal');
        return { ...w, mode: 'minimized' as const };
      }),
    );
    this._compactActive.set(null);
  }

  /* ---------- 平台接線（WindowShell／工作區用） ---------- */

  /** WindowShell 掛載時呼叫；視窗列只列出掛載中的視窗。 */
  attach(id: string): void {
    const n = (this.mountCount.get(id) ?? 0) + 1;
    this.mountCount.set(id, n);
    if (n === 1) this._mounted.update((s) => new Set(s).add(id));
  }

  /** WindowShell 銷毀時呼叫；狀態保留，下次掛載沿用。 */
  detach(id: string): void {
    const n = (this.mountCount.get(id) ?? 0) - 1;
    if (n > 0) {
      this.mountCount.set(id, n);
      return;
    }
    this.mountCount.delete(id);
    this._mounted.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (this._compactActive() === id) this._compactActive.set(null);
  }

  /** 桌面提供視窗圖層（浮動視窗會移到這裡定位）。 */
  setLayer(el: HTMLElement | null): void {
    this._layer.set(el);
  }

  /** 小螢幕切換；切換時回到顯示工作區內容，不改各視窗的桌面狀態。 */
  setCompact(on: boolean): void {
    if (this._compact() === on) return;
    this._compact.set(on);
    this._compactActive.set(null);
  }

  /* ---------- 內部 ---------- */

  private find(id: string): WindowState | undefined {
    return this._windows().find((w) => w.id === id);
  }

  /** 會讓位、一般模式、玩家沒動過、且被 rect 蓋到的視窗 → 最小化（還原時回到一般）。 */
  private yieldTo(rect: Rect): void {
    for (const w of this._windows()) {
      if (w.mode !== 'normal' || this.touched.has(w.id) || !this.defaults.get(w.id)?.yields || !overlaps(w, rect)) continue;
      this.beforeMinimize.set(w.id, 'normal');
      this.patch(w.id, { mode: 'minimized' });
      if (this._compactActive() === w.id) this._compactActive.set(null);
    }
  }

  /** list 中是否有其他掛載中、顯示中（一般且重疊，或最大化）的非讓位視窗蓋到 rect。 */
  private coveredByMounted(id: string, rect: Rect, list: readonly WindowState[]): boolean {
    const mounted = this._mounted();
    return list.some(
      (o) =>
        o.id !== id &&
        mounted.has(o.id) &&
        !this.defaults.get(o.id)?.yields &&
        (o.mode === 'maximized' || (o.mode === 'normal' && overlaps(o, rect))),
    );
  }

  private patch(id: string, change: Partial<WindowState>): void {
    this._windows.update((list) => list.map((w) => (w.id === id ? { ...w, ...change } : w)));
  }

  /** 註冊、重設與工作區改變時：整個視窗收進工作區（尺寸不超過工作區）。 */
  private fit(x: number, y: number, width: number, height: number): Rect {
    const g = this.clamp(x, y, width, height);
    const b = this._bounds();
    if (!b || b.width <= 0 || b.height <= 0) return g;
    return {
      ...g,
      x: Math.min(Math.max(g.x, 0), Math.max(0, b.width - g.width)),
      y: Math.min(Math.max(g.y, 0), Math.max(0, b.height - g.height)),
    };
  }

  /** 拖曳／鍵盤移動／調整尺寸時：可以部分移出工作區，但標題列一定找得回來。 */
  private clamp(x: number, y: number, width: number, height: number): Rect {
    const b = this._bounds();
    let w = Math.round(Math.max(WINDOW_MIN_WIDTH, width));
    let h = Math.round(Math.max(WINDOW_MIN_HEIGHT, height));
    let nx = Math.round(x);
    let ny = Math.round(y);
    if (b && b.width > 0 && b.height > 0) {
      w = Math.min(w, b.width);
      h = Math.min(h, b.height);
      const visible = Math.min(WINDOW_MIN_VISIBLE, w);
      nx = Math.min(Math.max(nx, visible - w), b.width - visible);
      ny = Math.min(Math.max(ny, 0), Math.max(0, b.height - WINDOW_TITLE_BAR));
    } else {
      ny = Math.max(ny, 0);
    }
    return { x: nx, y: ny, width: w, height: h };
  }
}
