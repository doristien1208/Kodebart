import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ARCHIVE_UI } from '../../../content/text';
import { RecordKey } from '../../../core/types';

/** 佇列一列所需的呈現資料；由容器從遊戲狀態推導後傳入。 */
export interface ArchiveQueueItem {
  key: RecordKey;
  /** 可辨識識別：有姓名顯示姓名，否則顯示人員編號（由容器以 recordLabel 產生）。 */
  label: string;
  /** 已提交至本日批次。 */
  done: boolean;
}

/**
 * 歸檔工作佇列（R6-01；Day 1、3、4、5 共用）：只呈現送進來的清單並回報選取，
 * 不注入 GameStateService、不讀寫 localStorage、不知道紀錄從哪來、也不知道是第幾天。
 * 桌機分欄、窄螢幕單欄，超過高度時自己垂直捲動；狀態一律有文字或符號，
 * 不只靠顏色，目前選取以 aria-current 表示。
 */
@Component({
  selector: 'app-archive-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './archive-queue.component.html',
})
export class ArchiveQueueComponent {
  readonly items = input.required<readonly ArchiveQueueItem[]>();
  readonly selectedKey = input.required<RecordKey>();
  /** 玩家點選某一列；容器負責切換目前選取並清除回饋。 */
  readonly select = output<RecordKey>();

  /** 跨日共用的佇列字串（ui.archive）。 */
  protected readonly t = ARCHIVE_UI;
}
