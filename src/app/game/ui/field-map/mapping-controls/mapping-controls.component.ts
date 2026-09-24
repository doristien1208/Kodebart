import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { FieldMapSourceField, FieldMapTargetField } from '../../../content/schema';
import { FIELD_MAP_UI } from '../../../content/text';
import { MissingPolicy } from '../../../core/types';

/** 某個目標欄位改選了哪個來源；sourceId 空字串＝清除。 */
export interface FieldAssignmentChange {
  targetId: string;
  sourceId: string;
}

/** 空白值處理選項的文字（來自目前 field-map task 的 text）。 */
export interface BlankPolicyText {
  policyDefault: string;
  policyReview: string;
}

/**
 * 欄位映射的對應控制（R6 Day 6 右側）：每個目標欄位一個有標籤的 `<select>`，
 * 選項＝全部來源欄位（依來源表順序，不做推薦或預選）；有受空值影響的列時才顯示空白值處理。
 * 兩種處理方式都合法，樣式完全相同，不標推薦或善惡。
 * 只呈現傳入的狀態並回報玩家意圖；錯誤文字由容器傳入（一般欄位錯誤，不指出哪一欄）。
 * 不注入狀態服務、不讀寫 localStorage、不做驗證。
 */
@Component({
  selector: 'app-mapping-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  templateUrl: './mapping-controls.component.html',
})
export class MappingControlsComponent {
  readonly sources = input.required<readonly FieldMapSourceField[]>();
  readonly targets = input.required<readonly FieldMapTargetField[]>();
  /** target id → source id。 */
  readonly assignments = input.required<Readonly<Record<string, string>>>();
  readonly blankPolicy = input.required<MissingPolicy | undefined>();
  /** 受空值影響的列數；0 時不顯示空白值處理。 */
  readonly affectedCount = input.required<number>();
  readonly policyText = input.required<BlankPolicyText>();
  /** 一般錯誤訊息；空字串＝無錯誤。 */
  readonly error = input.required<string>();
  /** 已通過驗證並預覽，可以確認匯入。 */
  readonly previewed = input.required<boolean>();
  /** 已確認匯入：所有控制鎖定。 */
  readonly locked = input.required<boolean>();
  /** 匯入處理中：停用驗證與確認（連點只送出一次）。 */
  readonly busy = input(false);

  readonly assign = output<FieldAssignmentChange>();
  readonly policySelect = output<MissingPolicy>();
  readonly validate = output<void>();
  readonly confirm = output<void>();

  protected readonly t = FIELD_MAP_UI;

  private readonly selects = viewChildren<ElementRef<HTMLSelectElement>>('targetSelect');
  private readonly policyInputs = viewChildren<ElementRef<HTMLInputElement>>('policyInput');

  /** 容器在對應錯誤後把焦點放回第一個目標欄位。 */
  focusFirstSelect(): void {
    this.selects()[0]?.nativeElement.focus();
  }

  /** 容器在缺少空白值處理時把焦點放到第一個選項。 */
  focusPolicy(): void {
    this.policyInputs()[0]?.nativeElement.focus();
  }

  protected onSelect(targetId: string, event: Event): void {
    this.assign.emit({ targetId, sourceId: (event.target as HTMLSelectElement).value });
  }
}
