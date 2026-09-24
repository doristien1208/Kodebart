import { Injectable, Signal, computed, inject, untracked } from '@angular/core';
import { CONTENT, channelTitle, helpRequestOfMessage, messagesOfChannel } from '../../../content/bundle';
import { GameStateService } from '../../../state/game-state.service';
import {
  ChannelMessages,
  ChannelUnread,
  channelOf,
  deriveChannelMessages,
  readableIdsOf,
  totalUnread,
  withUnread,
} from '../presenters/unread';
import { ChatPacingService } from './chat-pacing.service';

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 兩次推導的頻道、已解鎖訊息與已送達訊息（ID 與順序）完全相同。 */
function sameChannels(a: readonly ChannelMessages[], b: readonly ChannelMessages[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => {
      const d = b[i];
      return (
        d !== undefined &&
        c.id === d.id &&
        sameStrings(
          c.unlocked.map((m) => m.id),
          d.unlocked.map((m) => m.id),
        ) &&
        sameStrings(c.deliveredIds, d.deliveredIds)
      );
    })
  );
}

/**
 * 訊息未讀狀態（KB-R4-04；R12 §2）。
 *
 * 把內容層的頻道／解鎖條件、存檔的回覆與提問送達時間、送達時鐘與已讀 ID 接起來，
 * 讓桌面紅點與通訊視窗看到同一份推導結果。未讀永遠是「已送達的他人訊息 − 已讀」，不保存總數。
 * 「已解鎖」是跨日累積的歷史（KB-R5-01）：已讀過的不會重新算成未讀；只有新送達的才會。
 * 回覆與說明依保存的送達時間（ChatPacingService）才算送達，未送達的不算未讀；玩家自己的列永遠不算。
 * root 服務：桌面紅點讓它一直存在，送達不依附任何頁面元件。
 * 寫入只透過 GameStateService.markMessagesRead()，因此不會重抽夜間亂數、不改 dayId／stage，也不產生工作事件。
 */
@Injectable({ providedIn: 'root' })
export class MessageUnreadService {
  private readonly game = inject(GameStateService);
  private readonly pacing = inject(ChatPacingService);

  /**
   * 條件判斷用的狀態：GameStateService.conditionContext()（R7），與固定回覆的 isPromptOpen 共用；
   * 沒有存檔時為 null（封面等頁面不會有紅點）。
   */
  private readonly ctx = this.game.conditionContext;

  /**
   * 目前已解鎖的頻道內容（含前幾日歷史）與已送達的他人訊息；依存檔與送達時鐘，不依已讀狀態。
   * 存檔任何寫入（含已讀）都會重算，因此以「ID 與順序是否相同」判斷相等，
   * 內容沒變就不通知下游（通訊視窗的已讀 effect 不會因為自己寫入已讀而重跑）。
   */
  readonly channels: Signal<readonly ChannelMessages[]> = computed(
    () => {
      const now = this.pacing.now();
      return deriveChannelMessages({
        channels: CONTENT.channels,
        messagesOf: messagesOfChannel,
        titleOf: channelTitle,
        ctx: this.ctx(),
        replyOf: (id) => this.game.chatReply(id),
        requestOfMessage: helpRequestOfMessage,
        helpDeliveryAt: (messageId) => {
          const requestId = helpRequestOfMessage(messageId);
          if (requestId === undefined) return undefined;
          return this.game.helpRequest(requestId)?.deliveries.find((d) => d.messageId === messageId)?.at;
        },
        now,
      });
    },
    { equal: sameChannels },
  );

  /** 頻道內容加上未讀 ID。 */
  readonly unread: Signal<readonly ChannelUnread[]> = computed(() =>
    withUnread(this.channels(), (id) => this.game.isMessageRead(id)),
  );

  /** 桌面／導航的彙總未讀數。 */
  readonly total: Signal<number> = computed(() => totalUnread(this.unread()));

  channel(channelId: string | null): ChannelUnread | null {
    return channelOf(this.unread(), channelId);
  }

  /**
   * 通訊視窗回報「玩家實際看到」的列後呼叫：只把其中已送達的他人訊息記為已讀（一次寫入）。
   * 玩家列、正在輸入或尚未送達的 ID 一律略過。以 untracked 讀取，呼叫端的 effect 不會因此重跑。
   */
  markRead(channelId: string, seenIds: Iterable<string>): void {
    const readable = new Set(untracked(() => readableIdsOf(this.channels(), channelId)));
    const ids = [...seenIds].filter((id) => readable.has(id) && !untracked(() => this.game.isMessageRead(id)));
    if (ids.length > 0) this.game.markMessagesRead(ids);
  }
}
