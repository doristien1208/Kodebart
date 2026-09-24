import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldMapRow, FieldMapSourceField } from '../../../content/schema';
import { FIELD_MAP_UI } from '../../../content/text';

/**
 * 欄位映射的來源資料表（R6 Day 6 左側）：表頭＝來源欄位的舊名稱，每列＝一筆來源資料。
 * 值原樣顯示（字串，含前導零）；空字串顯示為共用的「空白」字樣，不猜測意義。
 * 只呈現傳入的資料，不注入狀態、不判斷對應。窄螢幕時表格自己水平捲動，不撐開頁面。
 */
@Component({
  selector: 'app-mapping-source-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  templateUrl: './mapping-source-table.component.html',
})
export class MappingSourceTableComponent {
  readonly fields = input.required<readonly FieldMapSourceField[]>();
  readonly rows = input.required<readonly FieldMapRow[]>();

  protected readonly t = FIELD_MAP_UI;
}
