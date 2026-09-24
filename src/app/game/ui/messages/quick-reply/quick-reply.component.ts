import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MESSAGES } from '../../../content/text';

/** 一個固定回覆選項（來自 prompt 的 choices）。 */
export interface QuickReplyChoice {
  id: string;
  text: string;
}

/**
 * 固定回覆區（R7 §2.4）：目前頻道有「當日尚未回答且未過期」的 prompt 時，由容器放在對話底部。
 *
 * 只顯示選項按鈕與次要的「不回覆」，並回報玩家的選擇；不注入 GameStateService、
 * 不判斷 prompt 是否開放、不保存任何東西。沒有文字輸入框、傳送鍵或搜尋框。
 * 全部是原生 button：Tab 依畫面順序（選項 → 不回覆）移動，Enter／Space 觸發；窄螢幕自動換行。
 */
@Component({
  selector: 'app-quick-reply',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block shrink-0 min-w-0 border-t border-border bg-surface px-4 py-3' },
  templateUrl: './quick-reply.component.html',
})
export class QuickReplyComponent {
  /** prompt ID；只用於 DOM 標記與無障礙關聯，不在這裡查內容。 */
  readonly promptId = input.required<string>();
  readonly choices = input.required<readonly QuickReplyChoice[]>();
  /** 玩家選了某個選項（choice ID）。 */
  readonly choose = output<string>();
  /** 玩家選「不回覆」。 */
  readonly skip = output<void>();

  protected readonly t = MESSAGES;
}
