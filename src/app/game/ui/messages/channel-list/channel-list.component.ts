import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ChannelKind } from '../../../content/schema';
import { MESSAGES } from '../../../content/text';
import { UnreadBadgeComponent } from '../unread-badge/unread-badge.component';

/** 列表一列所需的呈現資料；由容器從 timeline 與未讀推導後傳入。 */
export interface ChannelListItem {
  id: string;
  kind: ChannelKind;
  title: string;
  /** direct 的方形頭像首字；department／group 顯示 # 而不用頭像。 */
  initial: string;
  /** 最後一則可見訊息（含玩家回覆與回應）的摘要文字。 */
  preview: string;
  /** 最後一則可見訊息的時間。 */
  time: string;
  /** 目前已解鎖且未讀的則數；0 代表不顯示紅點。 */
  unread: number;
  /** 紅點的螢幕閱讀器文字（含頻道名稱與則數）。 */
  unreadLabel: string;
}

/** 一個分類區段；沒有可見頻道時顯示中性空狀態文字。 */
export interface ChannelSection {
  kind: ChannelKind;
  title: string;
  items: readonly ChannelListItem[];
}

/**
 * 頻道欄（R7 §2.2）：最上方是通訊軟體名稱，下方依部門頻道／群組／私訊分區。
 * department／group 前加 #，direct 用姓名首字的方形頭像；每列顯示名稱、最後一則摘要、時間與未讀。
 * 選中列用 2px 主色左側指示線＋較深背景。
 *
 * 只呈現傳入的分類與列，並回報選取；不注入遊戲狀態、不讀寫存檔，
 * 也不知道未讀是怎麼算出來的。追蹤一律用穩定 ID。
 */
@Component({
  selector: 'app-channel-list',
  imports: [UnreadBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0 min-h-0 overflow-y-auto bg-background' },
  templateUrl: './channel-list.component.html',
})
export class ChannelListComponent {
  readonly sections = input.required<readonly ChannelSection[]>();
  /** 目前開啟的頻道；null＝尚未選擇。 */
  readonly selectedId = input.required<string | null>();
  /** 玩家點選某個頻道；由容器決定開啟與標記已讀。 */
  readonly select = output<string>();

  protected readonly t = MESSAGES;
}
