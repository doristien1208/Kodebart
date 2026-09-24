import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** 文件上的一格資料列：編號＋主要欄位＋次要說明。 */
export interface Day2DocumentCell {
  /** 追蹤用的紀錄鍵（不顯示）；兩筆送件編號相同時仍各自一格。 */
  key: string;
  /** 人員編號：前一階段保存的送件編號（照玩家當時輸入，含前導零）。 */
  code: string;
  /** 主要欄位文字（例如「已列入安排」或拒絕紀錄值）。 */
  line: string;
  /** 次要說明（例如來源或去向）。 */
  note: string;
}

/**
 * Day 2 公司文件的共用呈現（KB-R4-02）：標題＋可選標籤、副標、兩格以上資料列與可選頁尾。
 * 今日批次摘要與昨日歸檔副本共用同一個元件，讓兩份文件可並列逐格比較。
 * 只呈現傳入的字串，不注入狀態、不判讀四格矩陣、不決定哪一份文件何時出現。
 */
@Component({
  selector: 'app-day2-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './day2-document.component.html',
})
export class Day2DocumentComponent {
  readonly heading = input.required<string>();
  /** 副標／來源說明。 */
  readonly sub = input.required<string>();
  readonly cells = input.required<readonly Day2DocumentCell[]>();
  /** 標題右側標籤（例如版本）；空字串＝不顯示，標題維持單獨一行。 */
  readonly tag = input('');
  /** 文件頁尾備註；空字串＝不顯示。 */
  readonly footer = input('');
}
