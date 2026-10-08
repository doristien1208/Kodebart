import { ContentReplyPrompt } from '../../../content/schema';
import { ChatReply } from '../../../core/types';

/**
 * 已回答回覆的顯示文字（R12 #7）。
 *
 * 存檔的 `chatReplies` 在回答當下保存玩家文字與回應快照；內容日後改寫時，快照仍是舊字句。
 * 只有這裡列出的 prompt 會在**顯示層**改用目前核准的內容文字：拒絕紀錄說明的追問
 * （`prompt.help.refusal`，Human 已核准新說明，舊存檔不應再看到「原表」「未確認」等舊說法）。
 * 其他 prompt、skipped、未回答都沿用原本的快照，不全域更新聊天歷史。
 */
export const CURRENT_TEXT_PROMPT_IDS: ReadonlySet<string> = new Set(['prompt.help.refusal']);

/**
 * 依穩定 ID 把已回答回覆的文字換成目前內容（純函式，不改輸入、不寫存檔）：
 * - 只處理 CURRENT_TEXT_PROMPT_IDS 中、kind 為 answered 的回覆；其餘原樣回傳（同一個物件）。
 * - choiceId 在目前 prompt 找得到：玩家文字換成該選項目前的文字；找不到（選項已移除）：整份沿用快照。
 * - 同一選項下 response ID 仍存在：只換該列 lines；找不到的回應沿用快照的 lines，不刪列、不換成別列。
 * - kind、choiceId、response ID、actorId、time、deliverAt、answeredAt、dayId 與順序一律取自保存的快照，
 *   因此送達時間、「正在輸入」、未讀與已讀判斷都不受影響。
 *
 * @param currentPrompt 取得目前內容的 prompt；只在需要解析時才呼叫。
 */
export function displayReply(
  promptId: string,
  reply: ChatReply | undefined,
  currentPrompt: (promptId: string) => ContentReplyPrompt | undefined,
): ChatReply | undefined {
  if (reply?.kind !== 'answered' || !CURRENT_TEXT_PROMPT_IDS.has(promptId)) return reply;
  const choice = currentPrompt(promptId)?.choices.find((c) => c.id === reply.choiceId);
  if (!choice) return reply;
  return {
    ...reply,
    playerText: choice.text,
    responses: reply.responses.map((saved) => {
      const current = choice.responses.find((r) => r.id === saved.id);
      return current ? { ...saved, lines: [...current.lines] } : saved;
    }),
  };
}
