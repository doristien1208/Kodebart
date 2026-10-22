import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { WORKDAY_UI } from '../../../content/text';
import { BatchJsonView, BatchRowView, DocumentField } from '../presenters/work-document';

/**
 * 批次的 input／rule／output（M1 §1）：逐列差異表、三段 JSON 與領域意義對照（true／false 照拒絕紀錄；
 * null 依 sourceRefusal／adoptedRefusal／輸出 refusal 分開解釋，不適用另列）。
 *
 * 純呈現元件：資料由 work-document presenter 推導（已交付＝保存的快照；預覽＝依目前設定）。
 * 差異只標示「來源與採用不同」「本次規則改寫了值」，不判斷對錯。表格與 JSON 在內部橫向捲動，頁面不溢出。
 */
@Component({
  selector: 'app-batch-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './batch-view.component.html',
  styleUrl: './batch-view.component.css',
})
export class BatchViewComponent {
  readonly rows = input.required<readonly BatchRowView[]>();
  readonly json = input.required<BatchJsonView>();
  readonly legend = input.required<readonly string[]>();
  readonly counts = input.required<readonly DocumentField[]>();

  protected readonly ui = WORKDAY_UI;
}
