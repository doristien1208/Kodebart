import { Injectable, Signal, computed, inject, untracked } from '@angular/core';
import { CONTENT, channelTitle, messagesOfChannel } from '../../content/bundle';
import { ConditionContext } from '../../content/conditions';
import { GameStateService } from '../../state/game-state.service';
import {
  ChannelMessages,
  ChannelUnread,
  channelOf,
  deriveChannelMessages,
  readableIdsOf,
  totalUnread,
  withUnread,
} from './unread';

/**
 * 訊息未讀狀態（KB-R4-04）。
 *
 * 把內容層的頻道／解鎖條件與存檔的已讀 ID 接起來，讓工作台外殼與訊息頁
 * 看到同一份推導結果。未讀永遠是「已解鎖 − 已讀」，不保存總數。
 * 寫入只透過 GameStateService.markMessagesRead()，因此不會重抽夜間亂數、
 * 不改 phase，也不產生工作事件。
 */
@Injectable({ providedIn: 'root' })
export class MessageUnreadService {
  private readonly game = inject(GameStateService);

  /** 條件判斷用的狀態；沒有存檔時為 null（封面等頁面不會有紅點）。 */
  private readonly ctx = computed<ConditionContext | null>(() => {
    const phase = this.game.phase();
    return phase === null ? null : { day: this.game.day(), phase, night: this.game.night() };
  });

  /** 目前已解鎖的頻道內容；只依 day／phase／night，不依已讀狀態。 */
  readonly channels: Signal<readonly ChannelMessages[]> = computed(() =>
    deriveChannelMessages({
      channels: CONTENT.channels,
      messagesOf: messagesOfChannel,
      titleOf: channelTitle,
      ctx: this.ctx(),
    }),
  );

  /** 頻道內容加上未讀 ID。 */
  readonly unread: Signal<readonly ChannelUnread[]> = computed(() =>
    withUnread(this.channels(), (id) => this.game.isMessageRead(id)),
  );

  /** 主導航的彙總未讀數。 */
  readonly total: Signal<number> = computed(() => totalUnread(this.unread()));

  channel(channelId: string | null): ChannelUnread | null {
    return channelOf(this.unread(), channelId);
  }

  /**
   * 玩家打開某頻道後呼叫：把「這個頻道目前已解鎖」的訊息記為已讀。
   * 以 untracked 讀取，讓呼叫端的 effect 不會因為已讀改變而重跑。
   */
  markChannelRead(channelId: string): void {
    const ids = untracked(() => readableIdsOf(this.channels(), channelId));
    this.game.markMessagesRead(ids);
  }
}
