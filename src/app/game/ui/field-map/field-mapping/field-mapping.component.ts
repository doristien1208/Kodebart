import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { FieldMapTask } from '../../../content/schema';
import { taskHeading } from '../../../content/bundle';
import { FIELD_MAP_UI, WORKDAY_UI, deliverLabel } from '../../../content/text';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { FieldMapError, MissingPolicy, affectedRowIds } from '../../../core';
import { GameStateService } from '../../../state/game-state.service';
import { WorkDeliveryService } from '../../workbench/services/work-delivery.service';
import { OperationView, WorkOperationsService } from '../../../state/work-operations.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { FieldAssignmentChange, MappingControlsComponent } from '../mapping-controls/mapping-controls.component';
import { MappingPreviewComponent } from '../mapping-preview/mapping-preview.component';
import { MappingSourceTableComponent } from '../mapping-source-table/mapping-source-table.component';

/**
 * 欄位映射工作（task kind `field-map`；目前為 Day 6）的容器（R6 §6）。
 *
 * 只有這一層注入 GameStateService：從目前 field-map task 取得欄位、資料列與當日文字，
 * 把對應／政策／預覽結果以 input 傳給子元件，並把子元件回報的事件轉成狀態服務呼叫。
 * 對應、政策、是否已預覽與提交快照都在存檔裡，重新整理後原樣保留；
 * 這裡只保留畫面本地的錯誤代碼（錯誤不寫存檔、不改提交結果）。
 * 錯誤只顯示一般欄位錯誤，不指出哪一欄；兩種空白值處理都合法，不標推薦。
 * 規則全部在 core/field-map.ts 與 state service。
 *
 * R10：預覽、空白筆數與政策是否需要，一律依**玩家的對應**計算（core 的 checkFieldMap／affectedRowIds）；
 * 文字欄位之間配錯仍可預覽與匯入，輸出就是依該對應轉出的結果。布林欄位遇到無法轉換的值時
 * 顯示轉換錯誤（fieldMap.convertError）並阻擋。確認匯入經 WorkOperationsService（處理中停用、顯示階段）。
 */
@Component({
  selector: 'app-field-mapping',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MappingSourceTableComponent, MappingControlsComponent, MappingPreviewComponent, OperationStatusComponent],
  templateUrl: './field-mapping.component.html',
})
export class FieldMappingComponent {
  protected readonly game = inject(GameStateService);
  private readonly delivery = inject(WorkDeliveryService);
  private readonly ops = inject(WorkOperationsService);
  private readonly docs = inject(MailAttachmentService);

  /** 處理中：停用驗證與確認匯入。 */
  protected readonly busy = this.ops.busy;
  /** 目前映射工作的匯入階段（狀態在服務裡，換頁回來仍看得到）。 */
  protected readonly operation = computed<OperationView | null>(() => {
    const op = this.ops.current();
    return op && op.kind === 'field-map' && op.taskId === this.game.taskId() ? op : null;
  });
  private readonly injector = inject(Injector);

  protected readonly ui = FIELD_MAP_UI;

  private readonly controls = viewChild(MappingControlsComponent);
  private readonly doneHeading = viewChild<ElementRef<HTMLElement>>('doneHeading');

  /** 目前的 field-map task 內容；不是映射日時為 null（work view 不會掛上本元件）。 */
  protected readonly task = computed<FieldMapTask | null>(() => {
    const t = this.game.taskContent();
    return t?.kind === 'field-map' ? t : null;
  });

  /**
   * 來源資料列（M1）：有 dynamic 設定時，編號與回覆欄取自前幾天保存的歸檔與批次輸出（core 解析）；
   * 沒有保存資料的列退回內容檔的原值。
   */
  protected readonly rows = computed(() => this.game.fieldMapPlan()?.rows ?? this.task()?.rows ?? []);

  /** 前日的批次副本（M1「查看前日輸出」）：這批資料列引用、已交付的批次。 */
  protected readonly previous = computed(() => {
    const ids = [...new Set(this.task()?.dynamic?.rows.flatMap((r) => r.transformTaskIds) ?? [])];
    return ids
      .filter((id) => this.game.transformProgress(id).submitted !== undefined)
      .map((id) => ({ id, label: `${taskHeading(id)}｜${WORKDAY_UI.batchCopyLabel}` }));
  });

  protected openPrevious(taskId: string): void {
    this.docs.open({ kind: 'batch-output', taskId });
  }

  protected readonly progress = this.game.fieldMap;
  protected readonly assignments = computed(() => this.progress()?.assignments ?? {});
  protected readonly blankPolicy = computed(() => this.progress()?.blankPolicy);
  protected readonly submitted = computed(() => this.progress()?.submitted ?? null);
  protected readonly previewed = computed(() => this.progress()?.previewed ?? false);

  /** 受空值影響的列數：依玩家目前的對應，直接用 core 的規則推導（不在 UI 重寫判斷）。 */
  protected readonly affectedCount = computed(() => {
    const plan = this.game.fieldMapPlan();
    return plan ? affectedRowIds(plan, this.assignments()).length : 0;
  });

  /** 顯示中的預覽：已預覽（仍通過）或已提交時才有；提交後為鎖定的快照。 */
  protected readonly result = computed(() => {
    const check = this.game.fieldMapCheck();
    if (!check?.ok) return null;
    return this.submitted() || this.previewed() ? check.result : null;
  });

  /** 已提交時使用的處理方式文字；沒有受影響列時為空字串。 */
  protected readonly submittedPolicyText = computed(() => {
    const s = this.submitted();
    const t = this.task();
    if (!s || !t || s.blankPolicy === null) return '';
    return s.blankPolicy === 'default_false' ? t.text.policyDefault : t.text.policyReview;
  });

  /** 畫面本地的錯誤代碼；改動對應或政策即清除，同日換到另一件映射工作時也重設（linkedSignal）。 */
  private readonly errorCode = linkedSignal<string | null, FieldMapError | null>({
    source: this.game.taskId,
    computation: () => null,
  });
  protected readonly errorText = computed(() => {
    const code = this.errorCode();
    if (code === null) return '';
    if (code === 'policyRequired') return FIELD_MAP_UI.policyRequired;
    return code === 'unconvertible' ? FIELD_MAP_UI.convertError : FIELD_MAP_UI.mappingError;
  });

  protected onAssign(change: FieldAssignmentChange): void {
    this.errorCode.set(null);
    this.game.setFieldAssignment(change.targetId, change.sourceId);
  }

  protected onPolicy(policy: MissingPolicy): void {
    this.errorCode.set(null);
    this.game.setFieldBlankPolicy(policy);
  }

  /** 驗證並預覽：錯誤只顯示一般訊息並把焦點放回對應處；不寫存檔。 */
  protected onValidate(): void {
    const check = this.game.previewFieldMap();
    if (!check) return;
    if (check.ok) {
      this.errorCode.set(null);
      return;
    }
    this.errorCode.set(check.error);
    if (check.error === 'policyRequired') this.controls()?.focusPolicy();
    else this.controls()?.focusFirstSelect();
  }

  /** 確認匯入：經提交流程鎖定快照；控制項隨之消失，焦點移到完成標題。處理中不重送。 */
  protected async onConfirm(): Promise<void> {
    if (this.busy() || this.submitted()) return;
    if (!(await this.ops.submitFieldMap())) return;
    this.afterImported();
  }

  /** 寫入失敗後重試（服務保證不重複事件）。 */
  protected async onRetry(): Promise<void> {
    if (await this.ops.retry()) this.afterImported();
  }

  private afterImported(): void {
    afterNextRender(() => this.doneHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  /** 交付按鈕文字：當日還有其他工作 →「交付此項工作」；最後一項（或已離開 work）→「完成今日交接」。 */
  protected readonly deliverText = computed(() =>
    deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()),
  );

  /** 交付此項工作／完成今日交接 → 依新 stage 導向（同日還有工作仍在 /work；最後一日為結束畫面）。 */
  protected onDeliver(): void {
    // M1：當日最後一件先打開「本日交接」，確認後才離開桌面（WorkDeliveryService）
    this.delivery.deliver();
  }
}
