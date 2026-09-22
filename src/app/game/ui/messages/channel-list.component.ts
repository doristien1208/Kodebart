import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MESSAGES } from '../../content/text';
import { ChannelKind } from '../../content/schema';
import { UnreadBadgeComponent } from './unread-badge.component';

/** 列表一列所需的呈現資料；由容器從未讀推導後傳入。 */
export interface ChannelListItem {
  id: string;
  title: string;
  /** 目前已解鎖且未讀的則數；0 代表不顯示紅點。 */
  unread: number;
  /** 紅點的螢幕閱讀器文字（含頻道名稱與則數）。 */
  unreadLabel: string;
}

/** 一個分類區段；即使沒有頻道也會顯示，並給中性空狀態文字。 */
export interface ChannelSection {
  kind: ChannelKind;
  title: string;
  items: readonly ChannelListItem[];
}

/**
 * 頻道與私訊列表（KB-R4-04 第 1、4 點）。
 *
 * 只呈現傳入的分類與列，並回報選取；不注入遊戲狀態、不讀寫存檔，
 * 也不知道未讀是怎麼算出來的。追蹤一律用穩定 ID。
 */
@Component({
  selector: 'app-channel-list',
  imports: [UnreadBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <nav class="panel mb-0" [attr.aria-label]="t.listLabel">
      <span class="eyebrow">{{ t.eyebrow }}</span>
      @for (section of sections(); track section.kind) {
        <h3 class="text-base mt-4 mb-2">{{ section.title }}</h3>
        @if (section.items.length === 0) {
          <p class="text-sm text-muted m-0">{{ t.sectionEmpty }}</p>
        } @else {
          <ul role="list" class="list-none p-0 m-0 grid gap-1" [attr.aria-label]="section.title">
            @for (item of section.items; track item.id) {
              <li class="min-w-0">
                <button
                  type="button"
                  class="w-full flex items-center gap-2 py-2 px-2.5"
                  [attr.data-channel-id]="item.id"
                  [class.border-primary]="item.id === selectedId()"
                  [class.bg-elevated]="item.id === selectedId()"
                  [attr.aria-current]="item.id === selectedId() ? 'true' : null"
                  (click)="select.emit(item.id)"
                >
                  <span class="flex-1 min-w-0 truncate">{{ item.title }}</span>
                  <app-unread-badge [count]="item.unread" [label]="item.unreadLabel" />
                </button>
              </li>
            }
          </ul>
        }
      }
    </nav>
  `,
})
export class ChannelListComponent {
  readonly sections = input.required<readonly ChannelSection[]>();
  /** 目前開啟的頻道；null＝尚未選擇。 */
  readonly selectedId = input.required<string | null>();
  /** 玩家點選某個頻道；由容器決定開啟與標記已讀。 */
  readonly select = output<string>();

  protected readonly t = MESSAGES;
}
