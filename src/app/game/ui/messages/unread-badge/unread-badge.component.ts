import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * 未讀紅點（KB-R4-04 第 4、7 點；KB-R5-01 第 5 點改為圓形）。
 *
 * 只表示「目前已解鎖且尚未讀取」的數量，不預告未解鎖內容，也不依重要性變色。
 * 數字本身可見，另附螢幕閱讀器可讀的說明（由呼叫端從內容檔取得），
 * 因此不只靠顏色傳達；不閃爍、不發聲、不做警報式強調。
 * count 為 0 時整個元件不輸出任何節點（host 是 display:contents）。
 * 外觀是 Web 常見的圓形紅點：設計 token 沒有 rounded-*，這裡用 Tailwind 任意值 rounded-[9999px]；
 * 單位數時 min-w-5／h-5 讓它是正圓，兩位數以上自然延展成膠囊。
 */
@Component({
  selector: 'app-unread-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  templateUrl: './unread-badge.component.html',
})
export class UnreadBadgeComponent {
  readonly count = input.required<number>();
  /** 螢幕閱讀器文字，例如「林予安：2 則未讀訊息」。 */
  readonly label = input.required<string>();
}
