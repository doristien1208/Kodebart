import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** 文件上的一格資料列：編號＋主要欄位＋次要說明。 */
export interface Day2DocumentCell {
  /** 人員編號（來源原字串，含前導零）。 */
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
  template: `
    <article class="panel">
      @if (tag()) {
        <div class="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
          <h3>{{ heading() }}</h3>
          <span class="tag">{{ tag() }}</span>
        </div>
      } @else {
        <h3>{{ heading() }}</h3>
      }
      <p class="text-sm text-muted">{{ sub() }}</p>
      <div class="grid gap-3 md:grid-cols-2">
        @for (cell of cells(); track cell.code) {
          <div class="receipt-cell">
            <code>{{ cell.code }}</code>
            <p>{{ cell.line }}</p>
            <span class="text-sm text-muted">{{ cell.note }}</span>
          </div>
        }
      </div>
      @if (footer()) {
        <p class="text-sm text-muted mt-4">{{ footer() }}</p>
      }
    </article>
  `,
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
