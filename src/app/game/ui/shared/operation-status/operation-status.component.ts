import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { OPERATION_UI } from '../../../content/text';
import { OperationStage, OperationView } from '../../../state/work-operations.service';

/** 一個已經過的階段（畫面用）。 */
interface StageStep {
  stage: OperationStage;
  label: string;
  current: boolean;
}

/**
 * 提交的執行階段（R10 §3）：在表單旁顯示實際經過的階段（已接收提交、格式檢查通過 … 已保存／保存失敗）。
 *
 * 純呈現元件：階段來自容器傳入的 `WorkOperationsService.current()`，這裡不注入服務、不計時、不假裝完成。
 * 「格式檢查通過」只代表結構合法；「已保存」只在持久化成功後出現。寫入失敗時提供「重試」（由容器呼叫
 * `ops.retry()`，失敗時存檔沒有前進，所以不會重複事件）。狀態區一直存在（role=status），
 * 階段變化會被螢幕閱讀器讀出；沒有動畫，關閉動態時文字階段照常顯示。
 */
@Component({
  selector: 'app-operation-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './operation-status.component.html',
})
export class OperationStatusComponent {
  /** 要顯示的提交；null＝目前沒有（狀態區保留、內容為空）。 */
  readonly operation = input.required<OperationView | null>();
  /** 玩家按下「重試」（只在寫入失敗時出現）。 */
  readonly retry = output<void>();

  protected readonly t = OPERATION_UI;

  protected readonly steps = computed<readonly StageStep[]>(() => {
    const op = this.operation();
    if (!op) return [];
    return op.trail.map((stage, i) => ({ stage, label: OPERATION_UI[stage], current: i === op.trail.length - 1 }));
  });

  protected readonly failed = computed(() => this.operation()?.stage === 'failed');
  /** 規則不允許（例如附件已不是目前可修訂的版本）：沒有套用，說明不同、也不提供重試。 */
  protected readonly rejected = computed(() => this.operation()?.failure === 'rejected');
  /** 只有寫入失敗可以原樣重試；結構不符或規則不允許時重試也不會成功。 */
  protected readonly canRetry = computed(() => this.operation()?.failure === 'storage');
}
