import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { WINDOWS_UI } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { WindowDefaults, WindowManagerService, WindowState } from '../services/window-manager.service';
import { pixelPath } from './pixel-path';

/** `[defaults]` 可以省略 title（標題由 `[title]` 提供）。 */
export type WindowShellDefaults = Omit<WindowDefaults, 'title'> & { title?: string };

/** 鍵盤移動的步距（px）；按住 Shift 時放大。 */
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

let windowSeq = 0;

/**
 * 標題列控制鈕的像素圖示（8×8 格，以 16px 顯示：每格 2px）：減號、方框、雙框、叉號。
 * 圖示只是視覺；按鈕的名稱來自 aria-label（WINDOWS_UI），並以 title 提供 tooltip。
 */
export const WINDOW_CONTROL_ICONS = {
  minimize: pixelPath(['', '', '', '', '', '', 'xxxxxxxx', 'xxxxxxxx']),
  maximize: pixelPath(['xxxxxxxx', 'xxxxxxxx', 'x......x', 'x......x', 'x......x', 'x......x', 'x......x', 'xxxxxxxx']),
  restore: pixelPath(['..xxxxxx', '..xxxxxx', '..x....x', 'xxxxxx.x', 'xxxxxx.x', 'x....xxx', 'x....x', 'xxxxxx']),
  close: pixelPath(['xx....xx', 'xxx..xxx', '.xxxxxx.', '..xxxx', '..xxxx', '.xxxxxx.', 'xxx..xxx', 'xx....xx']),
} as const;

/** 視窗內文的排版：document＝一般文件（內距、內部捲動）；app＝應用主視窗（無內距，內容自行分欄與捲動）。 */
export type WindowShellVariant = 'document' | 'app';

/**
 * 共用浮動視窗殼（R10 §2／R12 §5）：只做呈現與操作事件，位置／尺寸／層級／顯示狀態都在 WindowManagerService。
 *
 * - 以穩定 `windowId` 註冊（冪等）；元件銷毀再建立時沿用原狀態。投影的內容屬於呼叫端，
 *   最小化／關閉只隱藏視窗，不銷毀內容、不清草稿。
 * - 工作區提供視窗圖層時，host 移到圖層內以絕對座標浮動（祖先的捲動／transform 不影響定位）；
 *   沒有圖層（例如單元測試）時留在原位、依文件流呈現。
 * - 只能由標題列拖曳（pointer events；標題列按鈕、文字輸入不觸發）；點選任一處置前；
 *   標題列可取得焦點並以方向鍵移動；最小化／最大化・還原／關閉是像素圖示按鈕（aria-label＋title，
 *   點擊範圍至少 44px）；內文有限高度並在內部捲動。
 * - 外觀（DESIGN）：直角、2px 外框、標題列下 1px 內線、4px 4px 0 硬陰影；最上層視窗的標題列較亮。
 * - 不鎖焦點（不是對話框）；小螢幕由管理服務決定單窗最大化顯示。
 * - 不做位置動畫；開啟時的淡入只在 SettingsService.animationsEnabled 時加上。
 */
@Component({
  selector: 'app-window-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    '[class.is-floating]': 'floating()',
    '[class.is-fill]': 'floating() && fill()',
    '[class.is-resizable]': 'floating() && !fill()',
    '[attr.data-window-id]': 'windowId()',
    '[attr.data-window-mode]': 'win()?.mode ?? null',
    '[attr.data-window-shown]': 'shown()',
    '[class.is-top]': 'top()',
    '[hidden]': '!shown()',
    '[style.left.px]': 'floating() && !fill() ? win()?.x : null',
    '[style.top.px]': 'floating() && !fill() ? win()?.y : null',
    '[style.width.px]': 'floating() && !fill() ? win()?.width : null',
    '[style.height.px]': 'floating() && !fill() ? win()?.height : null',
    '[style.z-index]': 'floating() ? win()?.z : null',
    '(pointerdown)': 'bringToFront()',
    '(focusin)': 'bringToFront()',
  },
  templateUrl: './window-shell.component.html',
  styleUrl: './window-shell.component.css',
})
export class WindowShellComponent implements OnInit {
  /** 穩定的視窗 ID（例如 `case.h204.registry`）；位置等狀態以它保存。 */
  readonly windowId = input.required<string>();
  /** 標題列文字（也是視窗區域的無障礙名稱，除非另給 ariaLabel）。 */
  readonly title = input.required<string>();
  /** 第一次註冊時的位置與尺寸（相對工作區，px）。 */
  readonly defaults = input.required<WindowShellDefaults>();
  /** 視窗區域的無障礙名稱；空字串＝使用標題。 */
  readonly ariaLabel = input('');
  /** 標題的層級（aria-level）。 */
  readonly level = input(3);
  /** 是否提供關閉鈕（關閉後由原入口呼叫 `open(id)` 重開）。 */
  readonly closable = input(true);
  /** 內文排版（見 WindowShellVariant）。 */
  readonly variant = input<WindowShellVariant>('document');

  protected readonly ui = WINDOWS_UI;
  protected readonly icons = WINDOW_CONTROL_ICONS;
  protected readonly manager = inject(WindowManagerService);
  protected readonly motion = inject(SettingsService).animationsEnabled;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  private readonly seq = ++windowSeq;
  protected readonly titleId = `window-title-${this.seq}`;
  protected readonly hintId = `window-hint-${this.seq}`;
  protected readonly bodyId = `window-body-${this.seq}`;

  protected readonly win = computed<WindowState | undefined>(() => this.manager.state(this.windowId())());
  /** host 已移進工作區的視窗圖層。 */
  protected readonly floating = signal(false);
  /** 填滿工作區：最大化，或小螢幕單窗顯示。 */
  protected readonly fill = computed(() => this.win()?.mode === 'maximized' || this.manager.compact());
  protected readonly shown = computed(() => {
    const w = this.win();
    if (!w || w.mode === 'minimized' || w.mode === 'closed') return false;
    return this.manager.compact() ? this.manager.compactActive() === w.id : true;
  });
  protected readonly maximized = computed(() => this.win()?.mode === 'maximized');
  /** 最上層的顯示中視窗（標題列較亮）。 */
  protected readonly top = computed(() => {
    this.manager.windows();
    this.manager.mounted();
    this.manager.compactActive();
    return this.shown() && this.manager.isTop(this.windowId());
  });
  protected readonly dragging = signal(false);

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  private drag: { pointerId: number; startX: number; startY: number; x: number; y: number } | null = null;
  private attachedId: string | null = null;

  constructor() {
    // 註冊（冪等）：ID／標題／預設值改變時同步；只追蹤 input，不追蹤管理服務內部狀態。
    effect(() => {
      const id = this.windowId();
      const defaults = { ...this.defaults(), title: this.title() };
      untracked(() => this.manager.register(id, defaults));
    });

    // 工作區有視窗圖層時，把 host 移進圖層浮動。
    effect(() => {
      const layer = this.manager.layer();
      untracked(() => {
        if (layer && this.host.parentElement !== layer) layer.appendChild(this.host);
        this.floating.set(!!layer && this.host.parentElement === layer);
      });
    });

    this.observeNativeResize();

    inject(DestroyRef).onDestroy(() => {
      if (this.attachedId) this.manager.detach(this.attachedId);
      // 移到圖層的 host 不在原本的父節點下，需自行移除。
      if (this.floating()) this.host.remove();
    });
  }

  ngOnInit(): void {
    this.attachedId = this.windowId();
    this.manager.attach(this.attachedId);
  }

  /* ---------- 操作 ---------- */

  bringToFront(): void {
    const w = this.win();
    if (w && w.z !== Math.max(...this.manager.windows().map((o) => o.z))) this.manager.focus(w.id);
  }

  protected minimize(): void {
    const id = this.windowId();
    this.manager.minimize(id);
    this.focusLater(`[data-taskbar-window="${cssEscape(id)}"]`);
  }

  protected toggleMaximize(): void {
    this.manager.toggleMaximize(this.windowId());
  }

  protected close(): void {
    const id = this.windowId();
    this.manager.close(id);
    this.focusLater(`[data-window-open="${cssEscape(id)}"]`);
  }

  /** 把內文捲到最底（紀錄窗：最新一筆在最下面）。 */
  scrollToEnd(): void {
    const el = this.body()?.nativeElement;
    if (el && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
  }

  /* ---------- 標題列拖曳與鍵盤 ---------- */

  protected onBarPointerDown(event: PointerEvent): void {
    const w = this.win();
    if (!w || !this.floating() || this.fill() || event.button !== 0 || !event.isPrimary) return;
    const target = event.target as Element | null;
    if (target?.closest('button, input, textarea, select, a, [contenteditable]')) return;
    event.preventDefault();
    this.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: w.x, y: w.y };
    this.dragging.set(true);
    const bar = event.currentTarget as HTMLElement;
    try {
      bar.setPointerCapture(event.pointerId);
    } catch {
      /* 合成事件沒有可擷取的指標 */
    }
  }

  protected onBarPointerMove(event: PointerEvent): void {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    this.manager.move(this.windowId(), d.x + event.clientX - d.startX, d.y + event.clientY - d.startY);
  }

  protected onBarPointerUp(event: PointerEvent): void {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    this.drag = null;
    this.dragging.set(false);
    const bar = event.currentTarget as HTMLElement;
    try {
      if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
    } catch {
      /* 已釋放 */
    }
  }

  protected onBarKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    const w = this.win();
    if (!w || this.fill()) return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    this.manager.move(w.id, w.x + d[0], w.y + d[1]);
  }

  protected onBarDoubleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target?.closest('button') || this.manager.compact()) return;
    this.toggleMaximize();
  }

  /* ---------- 內部 ---------- */

  /** 浮動時可由右下角原生拉柄調整尺寸；把量到的尺寸回寫到管理服務（它會再限制範圍）。 */
  private observeNativeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = this.win();
      if (!w || !this.floating() || this.fill() || w.mode !== 'normal' || this.dragging()) return;
      const entry = entries[entries.length - 1];
      const box = entry.borderBoxSize?.[0];
      const width = Math.round(box ? box.inlineSize : this.host.offsetWidth);
      const height = Math.round(box ? box.blockSize : this.host.offsetHeight);
      if (width <= 0 || height <= 0) return;
      if (Math.abs(width - w.width) <= 1 && Math.abs(height - w.height) <= 1) return;
      this.manager.resize(w.id, width, height);
      // 管理服務限制後的尺寸若與拉柄留下的 inline 尺寸不同（例如已到上限、綁定值沒變），直接對齊回去
      const next = this.win();
      if (next && (Math.abs(next.width - width) > 1 || Math.abs(next.height - height) > 1)) {
        this.host.style.width = `${next.width}px`;
        this.host.style.height = `${next.height}px`;
      }
    });
    observer.observe(this.host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  private focusLater(selector: string): void {
    afterNextRender(
      () => {
        // 同一入口可能有寬／窄螢幕兩份，取畫面上看得到的那一個
        const el = Array.from(this.host.ownerDocument.querySelectorAll<HTMLElement>(selector)).find(
          (e) => e.getClientRects().length > 0 && !e.hasAttribute('disabled'),
        );
        el?.focus();
      },
      { injector: this.injector },
    );
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
