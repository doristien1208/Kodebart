import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DAY1 } from '../../content/text';
import { RecordKey } from '../../core/types';

/** 佇列一列所需的呈現資料；由容器從遊戲狀態推導後傳入。 */
export interface Day1QueueItem {
  key: RecordKey;
  /** 可辨識識別：有姓名顯示姓名，否則顯示人員編號（由容器以 recordLabel 產生）。 */
  label: string;
  /** 已提交至本日批次。 */
  done: boolean;
}

/**
 * Day 1 工作佇列（KB-R4-02）：只呈現送進來的清單並回報選取，
 * 不注入 GameStateService、不讀寫 localStorage、不知道紀錄從哪來。
 * 桌機分欄、窄螢幕單欄，超過高度時自己垂直捲動；狀態一律有文字或符號，
 * 不只靠顏色，目前選取以 aria-current 表示。
 */
@Component({
  selector: 'app-day1-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="mb-[1.4rem]">
      <span class="eyebrow">{{ t.queueEyebrow }}</span>
      <ul
        role="list"
        [attr.aria-label]="t.queueLabel"
        class="grid gap-2 p-2 mt-1.5 border border-border bg-background max-h-[17rem] overflow-y-auto md:grid-cols-2 xl:grid-cols-3"
      >
        @for (item of items(); track item.key) {
          <li class="min-w-0">
            <button
              type="button"
              class="w-full flex items-center gap-2 py-2 px-2.5"
              [class.border-primary]="item.key === selectedKey()"
              [class.bg-elevated]="item.key === selectedKey()"
              [attr.aria-current]="item.key === selectedKey() ? 'true' : null"
              (click)="select.emit(item.key)"
            >
              <span class="font-mono text-primary w-[.9em] shrink-0" aria-hidden="true">{{
                item.key === selectedKey() ? t.queueSelectedMark : ''
              }}</span>
              <span class="flex-1 min-w-0 truncate">{{ item.label }}</span>
              @if (item.done) {
                <span class="tag shrink-0 text-primary border-primary"
                  ><span aria-hidden="true">{{ t.queueDoneMark }}</span> {{ t.queueDone }}</span
                >
              } @else {
                <span class="tag shrink-0">{{ t.queuePending }}</span>
              }
            </button>
          </li>
        }
      </ul>
    </section>
  `,
})
export class Day1QueueComponent {
  readonly items = input.required<readonly Day1QueueItem[]>();
  readonly selectedKey = input.required<RecordKey>();
  /** 玩家點選某一列；容器負責切換目前選取並清除回饋。 */
  readonly select = output<RecordKey>();

  protected readonly t = DAY1;
}
