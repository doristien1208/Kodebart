import { ConditionContext, isUnlocked } from '../../content/conditions';
import { ChannelKind, ContentChannel, ContentMessage } from '../../content/schema';

/**
 * 訊息未讀的推導（KB-R4-04 第 6 點）。
 *
 * 未讀一律是「目前已解鎖的訊息 − 已讀 message ID」，不另外保存總數，
 * 因此晚到或非時間順序解鎖的訊息也會正確出現紅點。
 * 這裡是純函式，不依賴 Angular、存檔或正式內容檔，方便單獨測試。
 */

/** 某頻道目前已解鎖的訊息；與已讀狀態無關。 */
export interface ChannelMessages {
  id: string;
  kind: ChannelKind;
  /** 顯示標題；群組用自己的名稱，私訊用對方稱呼。 */
  title: string;
  /** 目前已解鎖的訊息，依內容檔順序。 */
  unlocked: readonly ContentMessage[];
}

/** 加上已讀比對後的頻道狀態。 */
export interface ChannelUnread extends ChannelMessages {
  /** 已解鎖但尚未讀取的訊息 ID。 */
  unreadIds: readonly string[];
}

export interface ChannelMessagesInput {
  channels: readonly ContentChannel[];
  messagesOf: (channelId: string) => readonly ContentMessage[];
  titleOf: (channelId: string) => string;
  /** 目前狀態；null＝尚無存檔，視為沒有任何已解鎖訊息。 */
  ctx: ConditionContext | null;
}

/** 依目前狀態算出每個頻道已解鎖的訊息；不看已讀，也不擲骰。 */
export function deriveChannelMessages(input: ChannelMessagesInput): readonly ChannelMessages[] {
  const { ctx } = input;
  return input.channels.map((c) => ({
    id: c.id,
    kind: c.kind,
    title: input.titleOf(c.id),
    unlocked: ctx === null ? [] : input.messagesOf(c.id).filter((m) => isUnlocked(m.unlock, ctx)),
  }));
}

/** 套用已讀狀態；紅點只看這裡算出來的 unreadIds。 */
export function withUnread(
  channels: readonly ChannelMessages[],
  isRead: (messageId: string) => boolean,
): readonly ChannelUnread[] {
  return channels.map((c) => ({
    ...c,
    unreadIds: c.unlocked.filter((m) => !isRead(m.id)).map((m) => m.id),
  }));
}

/** 主導航的彙總未讀：全部頻道的未讀數相加。 */
export function totalUnread(channels: readonly ChannelUnread[]): number {
  return channels.reduce((sum, c) => sum + c.unreadIds.length, 0);
}

export function channelOf<T extends ChannelMessages>(
  channels: readonly T[],
  channelId: string | null,
): T | null {
  if (channelId === null) return null;
  return channels.find((c) => c.id === channelId) ?? null;
}

/**
 * 玩家打開某頻道時，該頻道「進入可讀狀態」的訊息 ID。
 * 只含這一個頻道目前已解鎖的訊息，因此開一個頻道不會影響其他頻道的紅點。
 */
export function readableIdsOf(
  channels: readonly ChannelMessages[],
  channelId: string | null,
): readonly string[] {
  return channelOf(channels, channelId)?.unlocked.map((m) => m.id) ?? [];
}
