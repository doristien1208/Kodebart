import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * 未讀紅點（KB-R4-04 第 4、7 點）。
 *
 * 只表示「目前已解鎖且尚未讀取」的數量，不預告未解鎖內容，也不依重要性變色。
 * 數字本身可見，另附螢幕閱讀器可讀的說明（由呼叫端從內容檔取得），
 * 因此不只靠顏色傳達；不閃爍、不發聲、不做警報式強調。
 * count 為 0 時整個元件不輸出任何節點（host 是 display:contents）。
 */
@Component({
  selector: 'app-unread-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (count() > 0) {
      <span
        aria-hidden="true"
        class="inline-flex items-center justify-center shrink-0 min-w-5 h-5 px-1 bg-error text-background font-mono text-xs leading-none"
        >{{ count() }}</span
      >
      <span class="sr-only">{{ label() }}</span>
    }
  `,
})
export class UnreadBadgeComponent {
  readonly count = input.required<number>();
  /** 螢幕閱讀器文字，例如「林予安：2 則未讀訊息」。 */
  readonly label = input.required<string>();
}
