import { ConditionContext, isUnlocked } from '../../../content/conditions';
import { ChannelKind, ContentChannel, ContentMessage } from '../../../content/schema';
import { ChatReply } from '../../../core/types';

/**
 * 訊息未讀的推導（KB-R4-04 第 6 點；R12 §2 改為「實際送達的他人訊息」）。
 *
 * 未讀一律是「目前已送達的他人訊息 − 已讀 message ID」，不另外保存總數，
 * 因此晚到或非時間順序解鎖的訊息也會正確出現紅點。已送達的他人訊息有三種，都有穩定 ID：
 * - 已解鎖的內容訊息（content/conditions 的 isUnlocked()：已到 visibleFrom 且 unlock 全部成立；
 *   前幾日的訊息留在頻道歷史，已讀過的不會再算未讀）——不含錨定在提問上的說明訊息；
 * - 錨定在提問上的說明訊息：保存的送達時間已到才算；
 * - 固定回覆（answered）的 responses：保存的 deliverAt 已到才算（沒有 deliverAt＝舊存檔，視為已送達；
 *   遷移時已把這些 ID 記為已讀歷史）。
 * 玩家自己的列（固定回覆與提問）永遠不算未讀。
 * 這裡是純函式，不依賴 Angular、存檔或正式內容檔，方便單獨測試。
 */

/** 某頻道目前已解鎖的訊息與已送達的他人訊息；與已讀狀態無關。 */
export interface ChannelMessages {
  id: string;
  kind: ChannelKind;
  /** 顯示標題；群組用自己的名稱，私訊用對方稱呼。 */
  title: string;
  /**
   * 目前已解鎖的內容訊息（含前幾日歷史與已提問的說明訊息，不論是否已送達），
   * 沿用 messagesOf 的順序：日序，再依內容檔順序。對話串由它與存檔合成。
   */
  unlocked: readonly ContentMessage[];
  /** 已送達的他人訊息 ID（內容訊息、說明訊息、回覆 responses）；未讀只從這裡算。 */
  deliveredIds: readonly string[];
}

/** 加上已讀比對後的頻道狀態。 */
export interface ChannelUnread extends ChannelMessages {
  /** 已送達但尚未讀取的訊息 ID。 */
  unreadIds: readonly string[];
}

export interface ChannelMessagesInput {
  channels: readonly ContentChannel[];
  messagesOf: (channelId: string) => readonly ContentMessage[];
  titleOf: (channelId: string) => string;
  /** 目前狀態；null＝尚無存檔，視為沒有任何已解鎖訊息。 */
  ctx: ConditionContext | null;
  /** 存檔中某 prompt 的回覆；未提供＝沒有任何回覆。 */
  replyOf?: (promptId: string) => ChatReply | undefined;
  /** 錨定在提問上的說明訊息所屬的提問 ID；一般訊息回傳 undefined。未提供＝沒有說明訊息。 */
  requestOfMessage?: (messageId: string) => string | undefined;
  /** 說明訊息保存的送達時間；尚未提問或沒有排定回傳 undefined（不算送達）。 */
  helpDeliveryAt?: (messageId: string) => number | undefined;
  /** 目前時間（epoch ms）；未提供＝全部已送達。 */
  now?: number;
}

/** 依目前狀態算出每個頻道已解鎖的內容與已送達的他人訊息；不看已讀、不擲骰，也不另外過濾 variant。 */
export function deriveChannelMessages(input: ChannelMessagesInput): readonly ChannelMessages[] {
  const { ctx } = input;
  return input.channels.map((c) => {
    const unlocked = ctx === null ? [] : input.messagesOf(c.id).filter((m) => isUnlocked(m, ctx));
    return { id: c.id, kind: c.kind, title: input.titleOf(c.id), unlocked, deliveredIds: deliveredIdsOf(unlocked, input) };
  });
}

/** 已解鎖內容中實際送達的他人訊息 ID（依內容順序，回覆的 responses 緊接 anchor）。 */
function deliveredIdsOf(unlocked: readonly ContentMessage[], input: ChannelMessagesInput): string[] {
  const now = input.now ?? Number.POSITIVE_INFINITY;
  const out: string[] = [];
  for (const m of unlocked) {
    if (input.requestOfMessage?.(m.id) !== undefined) {
      // 說明訊息：要有保存的送達時間且已到；未送達的之後的回覆也不可能存在
      const at = input.helpDeliveryAt?.(m.id);
      if (at === undefined || at > now) continue;
    }
    out.push(m.id);
    const promptId = m.replyPrompt?.id;
    const reply = promptId === undefined ? undefined : input.replyOf?.(promptId);
    if (reply?.kind !== 'answered') continue;
    for (const r of reply.responses) {
      if (r.deliverAt !== undefined && r.deliverAt > now) break;
      out.push(r.id);
    }
  }
  return out;
}

/** 套用已讀狀態；紅點只看這裡算出來的 unreadIds。 */
export function withUnread(
  channels: readonly ChannelMessages[],
  isRead: (messageId: string) => boolean,
): readonly ChannelUnread[] {
  return channels.map((c) => ({
    ...c,
    unreadIds: c.deliveredIds.filter((id) => !isRead(id)),
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
 * 某頻道目前「可以被讀到」的訊息 ID（已送達的他人訊息）。
 * 只含這一個頻道，因此標記某頻道看到的列不會影響其他頻道的紅點。
 */
export function readableIdsOf(
  channels: readonly ChannelMessages[],
  channelId: string | null,
): readonly string[] {
  return channelOf(channels, channelId)?.deliveredIds ?? [];
}
