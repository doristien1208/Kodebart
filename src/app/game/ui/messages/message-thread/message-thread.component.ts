import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ChannelKind } from '../../../content/schema';
import { MESSAGES } from '../../../content/text';
import { TimelineEntry } from '../presenters/timeline';

/** 對話 header 的呈現資料；由容器從頻道內容組好後傳入。 */
export interface ThreadHeader {
  channelId: string;
  kind: ChannelKind;
  title: string;
  /** direct 的首字頭像。 */
  initial: string;
  /** department／group 的 topic；direct 為空字串。 */
  topic: string;
  /** department／group 的成員數文字；direct 為空字串。 */
  members: string;
  /** direct 的狀態文字（在線）；department／group 為空字串。 */
  status: string;
}

/** 捲到某一列的要求（seq 讓重複要求同一列也會執行）。 */
export interface ThreadReveal {
  entryId: string;
  seq: number;
}

/** 距離底部多少 px 內算「在最新處」。 */
export const NEAR_BOTTOM_PX = 48;
/** 一列至少多少比例在捲動區內才算「看到」（R12 §2）。 */
export const SEEN_RATIO = 0.6;
/** 捲到某一列時上方保留的距離（px）。 */
const ROW_MARGIN_PX = 8;

/** 待執行的捲動：捲動區還沒有尺寸（視窗關閉／最小化）時先記下，顯示後才執行。 */
type PendingScroll =
  | { kind: 'open' }
  | { kind: 'reveal'; entryId: string; seq: number }
  | { kind: 'new'; firstId: string }
  | { kind: 'bottom' };

/**
 * 選中的對話（R7 §2.3；R12 §2）：固定在頂部的 header、日期分隔與 Slack／Teams 式訊息列。
 *
 * 只呈現傳入的 timeline（由 timeline.ts 合成），不判斷解鎖、不寫已讀、不知道 prompt；
 * 追蹤用穩定 id，不用索引或文字。每列是 32px 方形首字頭像＋姓名＋時間＋內文，
 * continued 列只顯示內文；玩家列以較深底色與細框區分。
 *
 * 捲動（只改 scrollTop，不呼叫 focus()）：
 * - 開啟對話：捲到第一則未讀（沒有就到底）。
 * - 新列出現：原本就在底部附近、且新列接在最後才跟著捲；停在歷史上方時不動，
 *   新訊息在可視範圍下方時顯示「有新訊息」提示，點了才捲到錯過的第一則。玩家自己剛送出的列一律捲到它。
 * - 定位要求（reveal）：捲到指定列。
 * - 捲動區沒有尺寸（視窗關閉／最小化）時先記下，重新顯示後才執行。
 * 已讀依據：以 IntersectionObserver（root＝捲動區）回報至少 60% 在捲動區內的訊息列 ID（visibleChange）；
 * 是否記為已讀由容器依視窗是否作用中決定。
 * 「返回頻道列表」只在窄版面出現（容器寬度決定，不看整個瀏覽器）。
 */
@Component({
  selector: 'app-message-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './message-thread.component.css',
  templateUrl: './message-thread.component.html',
})
export class MessageThreadComponent {
  readonly header = input.required<ThreadHeader>();
  readonly entries = input.required<readonly TimelineEntry[]>();
  /** 目前未讀的列 ID：開啟對話時捲到第一則。 */
  readonly unreadIds = input<ReadonlySet<string>>(new Set());
  /** 定位要求（只捲動，不移動焦點、不標已讀）。 */
  readonly reveal = input<ThreadReveal | null>(null);
  /** 窄版面返回頻道列表。 */
  readonly back = output<void>();
  /** 目前至少 60% 在捲動區內的訊息列 ID（每次變化都回報完整集合）。 */
  readonly visibleChange = output<ReadonlySet<string>>();
  /** 定位要求已執行（回報 seq；容器據此不再重送同一個要求）。 */
  readonly revealed = output<number>();

  protected readonly t = MESSAGES;
  /** 停在歷史上方時，下方出現新訊息。 */
  protected readonly newBelow = signal(false);

  private readonly injector = inject(Injector);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  private pending: PendingScroll | null = null;
  /** 最近一次捲動狀態：是否在底部附近（視窗隱藏時保留隱藏前的值）。 */
  private atBottom = true;
  private lastScrollTop = 0;
  private hadSize = false;
  private channelId: string | null = null;
  private knownIds = new Set<string>();
  /** 停在上方時新出現、待繪製後判斷位置的第一則訊息。 */
  private checkNewId: string | null = null;
  /** 「有新訊息」要捲到的那一則（停在上方時錯過的第一則）。 */
  private chipTarget: string | null = null;
  private revealSeq = 0;
  private readonly visible = new Set<string>();
  private readonly observed = new Map<Element, string>();
  private intersection: IntersectionObserver | null = null;
  private resize: ResizeObserver | null = null;

  constructor() {
    // 對話或列改變：決定要不要捲動（開啟→第一則未讀；新列→視是否在底部），下一次繪製後執行
    effect(() => {
      const channelId = this.header().channelId;
      const entries = this.entries();
      untracked(() => this.onEntries(channelId, entries));
      untracked(() => afterNextRender(() => this.afterRender(), { injector: this.injector }));
    });
    effect(() => {
      const r = this.reveal();
      if (r === null || r.seq === this.revealSeq) return;
      this.revealSeq = r.seq;
      this.pending = { kind: 'reveal', entryId: r.entryId, seq: r.seq };
      untracked(() => afterNextRender(() => this.afterRender(), { injector: this.injector }));
    });
    afterNextRender(() => this.setupObservers());
    inject(DestroyRef).onDestroy(() => {
      this.intersection?.disconnect();
      this.resize?.disconnect();
    });
  }

  /** 回覆區按鈕消失後，容器把焦點放回對話捲動區（只在焦點已遺失時呼叫）。 */
  focusLog(): void {
    this.scroller().nativeElement.focus({ preventScroll: true });
  }

  /** 「有新訊息」：捲到停在上方時錯過的第一則新訊息（捲到底為止），焦點留在對話區（提示本身會消失）。 */
  protected jumpToLatest(): void {
    const target = this.chipTarget;
    this.pending = target === null ? { kind: 'bottom' } : { kind: 'new', firstId: target };
    this.flush();
    this.newBelow.set(false);
    this.chipTarget = null;
    this.focusLog();
  }

  protected onScroll(): void {
    const el = this.scroller().nativeElement;
    if (el.clientHeight === 0) return;
    this.lastScrollTop = el.scrollTop;
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    // 到底、或錯過的那則已捲進畫面：提示消失
    if (this.newBelow() && (this.atBottom || (this.chipTarget !== null && !this.isBelowView(this.chipTarget)))) {
      this.newBelow.set(false);
      this.chipTarget = null;
    }
  }

  private onEntries(channelId: string, entries: readonly TimelineEntry[]): void {
    const ids = entries.filter((e) => e.kind !== 'date').map((e) => e.id);
    if (channelId !== this.channelId) {
      // 換對話：捲到第一則未讀（定位要求優先，已排入的不覆蓋）
      this.channelId = channelId;
      this.knownIds = new Set(ids);
      this.newBelow.set(false);
      this.chipTarget = null;
      this.checkNewId = null;
      if (this.pending?.kind !== 'reveal') this.pending = { kind: 'open' };
      return;
    }
    const known = this.knownIds;
    this.knownIds = new Set(ids);
    const added = entries.filter((e) => e.kind !== 'date' && !known.has(e.id));
    if (added.length === 0 || this.pending?.kind === 'reveal' || this.pending?.kind === 'open') return;
    const own = added.find((e) => e.kind === 'message' && e.player);
    if (own) {
      // 玩家自己剛送出：捲到那一列（通常就是最新；說明的追問可能插在較早的日期段落）
      this.pending = { kind: 'new', firstId: own.id };
      return;
    }
    const first = added[0];
    const firstMessage = added.find((e) => e.kind === 'message');
    if (this.atBottom) {
      // 在底部：只跟著「接在最後」的新列捲動；插在歷史中間的列不把畫面拉走
      const lastKnown = entries.reduce((at, e, i) => (known.has(e.id) ? i : at), -1);
      if (first && entries.indexOf(first) > lastKnown) this.pending = { kind: 'new', firstId: first.id };
    } else if (firstMessage) {
      // 停在上方：繪製後確認新訊息是否在可視範圍下方，是才顯示提示
      this.checkNewId ??= firstMessage.id;
    }
  }

  /** 停在上方時出現的新訊息：在可視範圍下方（或對話區隱藏中）才顯示「有新訊息」，並記住第一則。 */
  private evaluateNew(): void {
    const id = this.checkNewId;
    this.checkNewId = null;
    if (id === null) return;
    const hidden = this.scroller().nativeElement.clientHeight === 0;
    if (!hidden && !this.isBelowView(id)) return;
    this.chipTarget ??= id;
    this.newBelow.set(true);
  }

  /** 某一列是否在捲動區可視範圍的下方（找不到時視為否）。 */
  private isBelowView(entryId: string): boolean {
    const el = this.scroller().nativeElement;
    const row = el.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`);
    if (!row) return false;
    return row.getBoundingClientRect().top >= el.getBoundingClientRect().bottom - ROW_MARGIN_PX;
  }

  private afterRender(): void {
    this.syncObserved();
    this.flush();
    this.evaluateNew();
  }

  /** 執行待處理的捲動；捲動區沒有尺寸時保留到重新顯示（ResizeObserver）。 */
  private flush(): void {
    const el = this.scroller().nativeElement;
    if (el.clientHeight === 0 || this.pending === null) return;
    const p = this.pending;
    this.pending = null;
    const bottom = el.scrollHeight - el.clientHeight;
    switch (p.kind) {
      case 'open': {
        const unread = this.unreadIds();
        const first = this.entries().findIndex((e) => e.kind === 'message' && unread.has(e.id));
        const prev = this.entries()[first - 1];
        // 第一則未讀若緊接日期分隔，連分隔一起露出
        const target = first < 0 ? null : prev?.kind === 'date' ? prev.id : this.entries()[first]?.id;
        el.scrollTop = target ? Math.min(bottom, this.offsetOf(target)) : bottom;
        break;
      }
      case 'reveal':
        el.scrollTop = Math.min(bottom, this.offsetOf(p.entryId));
        this.revealed.emit(p.seq);
        break;
      case 'new':
        // 捲到底，但第一則新列不能被捲出上緣
        el.scrollTop = Math.min(bottom, this.offsetOf(p.firstId));
        break;
      case 'bottom':
        el.scrollTop = bottom;
        break;
    }
    this.onScroll();
  }

  /** 某一列相對捲動區內容頂端的位置（扣掉上方保留距離）；找不到時回傳底部。 */
  private offsetOf(entryId: string): number {
    const el = this.scroller().nativeElement;
    const row = el.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`);
    if (!row) return el.scrollHeight;
    return Math.max(0, row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - ROW_MARGIN_PX);
  }

  private setupObservers(): void {
    const el = this.scroller().nativeElement;
    const view = el.ownerDocument.defaultView;
    if (view && 'ResizeObserver' in view) {
      this.resize = new ResizeObserver(() => this.onResize());
      this.resize.observe(el);
    }
    if (view && 'IntersectionObserver' in view) {
      const thresholds = Array.from({ length: 11 }, (_, i) => i / 10);
      this.intersection = new IntersectionObserver((records) => this.onIntersect(records), { root: el, threshold: thresholds });
      this.syncObserved();
    }
  }

  /** 捲動區尺寸改變：從隱藏恢復時還原位置或執行待處理的捲動；原本在底部就維持在底部。 */
  private onResize(): void {
    const el = this.scroller().nativeElement;
    const hasSize = el.clientHeight > 0;
    const shown = hasSize && !this.hadSize;
    this.hadSize = hasSize;
    if (!hasSize) return;
    if (this.pending === null && (shown || this.atBottom)) {
      if (this.atBottom) this.pending = { kind: 'bottom' };
      else el.scrollTop = this.lastScrollTop;
    }
    this.flush();
  }

  /** 觀察目前的訊息列（新列加入、移除的列清掉）。 */
  private syncObserved(): void {
    const io = this.intersection;
    if (!io) return;
    const rows = this.scroller().nativeElement.querySelectorAll<HTMLElement>('[data-message-id]');
    const current = new Set<Element>();
    for (const row of rows) {
      current.add(row);
      if (!this.observed.has(row)) {
        this.observed.set(row, row.getAttribute('data-message-id') ?? '');
        io.observe(row);
      }
    }
    let changed = false;
    for (const [row, id] of this.observed) {
      if (current.has(row)) continue;
      io.unobserve(row);
      this.observed.delete(row);
      changed = this.visible.delete(id) || changed;
    }
    if (changed) this.visibleChange.emit(new Set(this.visible));
  }

  private onIntersect(records: readonly IntersectionObserverEntry[]): void {
    let changed = false;
    for (const r of records) {
      const id = this.observed.get(r.target);
      if (id === undefined) continue;
      const rootHeight = r.rootBounds?.height ?? 0;
      // 比捲動區還高的列：佔滿捲動區 60% 也算看到
      const seen =
        r.isIntersecting &&
        (r.intersectionRatio >= SEEN_RATIO || (rootHeight > 0 && r.intersectionRect.height >= rootHeight * SEEN_RATIO));
      if (seen && !this.visible.has(id)) {
        this.visible.add(id);
        changed = true;
      } else if (!seen && this.visible.delete(id)) {
        changed = true;
      }
    }
    if (changed) this.visibleChange.emit(new Set(this.visible));
  }
}
