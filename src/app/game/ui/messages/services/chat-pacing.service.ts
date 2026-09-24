import { DestroyRef, Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { Save } from '../../../core/types';
import { GameClock } from '../../../state/game-clock';
import { GameStateService } from '../../../state/game-state.service';

/** 預定送達時間是否已到；undefined＝舊存檔沒有送達時間，視為已送達。 */
export function isDeliveredAt(at: number | undefined, now: number): boolean {
  return at === undefined || at <= now;
}

/**
 * 存檔中全部預定送達時間（遞增、不重複）：固定回覆的 responses[].deliverAt，
 * 以及向同事詢問的 helpRequests[*].deliveries[].at。沒有存檔時為空。
 */
export function deliveryTimesOf(save: Save | null): readonly number[] {
  if (!save) return [];
  const times = new Set<number>();
  for (const reply of Object.values(save.chatReplies)) {
    if (reply?.kind !== 'answered') continue;
    for (const r of reply.responses) if (r.deliverAt !== undefined) times.add(r.deliverAt);
  }
  for (const request of Object.values(save.helpRequests)) {
    for (const d of request?.deliveries ?? []) times.add(d.at);
  }
  return [...times].sort((a, b) => a - b);
}

function sameTimes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * 訊息送達時鐘（R12 §2）：依「存檔中的送達時間」判斷同事的回覆／說明是否已送達。
 *
 * - 送達時間在回答／提問當下由狀態層擲一次並保存（state/game-clock.ts 的 3–4 秒節奏），
 *   這裡不排程、不重抽，也不在記憶體另存節奏；重新整理或讀檔後照保存值繼續，已過時間的直接視為送達。
 * - 只用一個計時器，設在「下一個未來的送達時間」；存檔的送達時間有變時重設。
 *   計時器到點時更新 `now`，讀 `now()`／`isDelivered()` 的 computed（未讀、對話串、回覆區）隨之重算。
 * - root 服務、不依附任何頁面元件：MessageUnreadService 注入它，桌面紅點讓它一直存在，
 *   因此通訊視窗關閉或最小化時回覆照樣送達、照樣亮紅點。
 * - 停頓是閱讀節奏而不是動態效果，關閉動態時仍保留；只有「正在輸入」的點點動畫會停。
 */
@Injectable({ providedIn: 'root' })
export class ChatPacingService {
  private readonly game = inject(GameStateService);
  private readonly clock = inject(GameClock);

  private readonly _now = signal(this.clock.now());
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 目前時間（epoch ms）；只在送達時間點與存檔送達排程改變時更新。 */
  readonly now: Signal<number> = this._now.asReadonly();

  /** 存檔中的全部送達時間；內容相同就不通知（已讀等其他寫入不會重設計時器）。 */
  private readonly times = computed(() => deliveryTimesOf(this.game.save()), { equal: sameTimes });

  constructor() {
    effect(() => {
      this.times();
      // 新的排程（回答、提問、讀檔）：先以實際時間更新 now，再設下一個計時器
      untracked(() => this.refresh());
    });
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /** 送達時間已到（undefined＝舊存檔，視為已送達）。在 computed 中呼叫會隨送達時間點更新。 */
  isDelivered(at: number | undefined): boolean {
    return isDeliveredAt(at, this._now());
  }

  /**
   * 以實際時間更新 now，並把計時器設在下一個未來的送達時間。
   * 計時器若比預定時間早回呼，下一個送達時間仍在未來，會再設一次短計時器（與狀態層 isPromptOpen 的實際時間一致）。
   */
  private refresh(): void {
    this.clearTimer();
    const now = this.clock.now();
    if (now !== this._now()) this._now.set(now);
    const next = this.times().find((t) => t > now);
    if (next === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, next - now);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
