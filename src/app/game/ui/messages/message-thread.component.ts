import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MESSAGES } from '../../content/text';

/** 訊息中的一段；id 由 message.id 加上段落序號組成，避免以文字或索引追蹤。 */
export interface ThreadLine {
  id: string;
  text: string;
}

/** 對話中的一則訊息；由容器從內容層組好後傳入。 */
export interface ThreadMessage {
  /** 穩定 message ID，同時是模板的 track 依據。 */
  id: string;
  author: string;
  time: string;
  lines: readonly ThreadLine[];
}

/**
 * 選中的對話（KB-R4-04 第 1、3 點）。
 *
 * 只呈現傳入的訊息，不判斷解鎖、不改已讀；追蹤用 message.id，不用索引或文字。
 * 「返回列表」只在窄螢幕出現，桌機兩欄並列時不需要。
 */
@Component({
  selector: 'app-message-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <article class="panel mb-0">
      <button type="button" class="btn-ghost md:hidden mb-2 px-0" (click)="back.emit()">
        {{ t.backToList }}
      </button>
      <h3 class="mb-4">{{ title() }}</h3>
      @if (messages().length === 0) {
        <p class="text-muted m-0">{{ t.emptyChannel }}</p>
      }
      @for (message of messages(); track message.id) {
        <div class="message">
          <div class="message-author">{{ message.author }} · {{ message.time }}</div>
          @for (line of message.lines; track line.id) {
            <p>{{ line.text }}</p>
          }
        </div>
      }
    </article>
  `,
})
export class MessageThreadComponent {
  readonly title = input.required<string>();
  readonly messages = input.required<readonly ThreadMessage[]>();
  /** 窄螢幕返回頻道列表。 */
  readonly back = output<void>();

  protected readonly t = MESSAGES;
}
