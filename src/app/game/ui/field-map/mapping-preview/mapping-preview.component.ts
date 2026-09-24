import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FieldMapTargetField } from '../../../content/schema';
import { FIELD_MAP_UI } from '../../../content/text';
import { FieldMapSubmission, MappedValue } from '../../../core/types';

/**
 * 轉換後的值 → 玩家可讀文字（R7 §6.2）：排除狀態 true＝排除、false＝未排除、null＝待確認；
 * 文字值原樣（含前導零）。底層仍保存 boolean／null。
 */
export function mappedValueText(value: MappedValue): string {
  if (value === null) return FIELD_MAP_UI.pendingReview;
  if (value === true) return FIELD_MAP_UI.excluded;
  if (value === false) return FIELD_MAP_UI.notExcluded;
  return value;
}

/** 預覽表的一列：目標欄位順序的顯示字串。 */
interface PreviewRow {
  id: string;
  cells: readonly { targetId: string; text: string }[];
}

/**
 * 欄位映射的匯入預覽（R6 Day 6）：總列數、受空值影響列數、依處理方式轉換的列數，
 * 人員編號樣本（原字串，看得出 0102 仍保留前導零）與全部轉換結果的表格。
 * 只呈現傳入的結果（預覽或已鎖定的提交快照），不做道德判斷、不自行提交。
 * 不輸出原始 JSON；true／false／null 一律用 mappedValueText() 的介面字顯示。窄螢幕時表格自己水平捲動。
 */
@Component({
  selector: 'app-mapping-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './mapping-preview.component.html',
})
export class MappingPreviewComponent {
  readonly result = input.required<FieldMapSubmission>();
  readonly targets = input.required<readonly FieldMapTargetField[]>();

  protected readonly t = FIELD_MAP_UI;

  /** 依處理方式轉換的列數：有選處理方式時＝受影響列數；沒有受影響列時為 0。 */
  protected readonly policyHandled = computed(() => {
    const r = this.result();
    return r.blankPolicy === null ? 0 : r.affectedCount;
  });

  /** 樣本＝第一列。 */
  private readonly sample = computed(() => this.result().rows[0] ?? null);

  /** 樣本的人員編號（第一個文字欄位）原字串；前導零不會被轉成數字。 */
  protected readonly sampleCode = computed(() => {
    const row = this.sample();
    const target = this.targets().find((t) => t.convert === 'text');
    const value = row && target ? row.values[target.id] : undefined;
    return typeof value === 'string' ? value : '';
  });

  protected readonly rows = computed<readonly PreviewRow[]>(() =>
    this.result().rows.map((row) => ({
      id: row.id,
      cells: this.targets().map((t) => ({ targetId: t.id, text: this.display(row.values[t.id] ?? null) })),
    })),
  );

  private display(value: MappedValue): string {
    return mappedValueText(value);
  }
}
