import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NAME_UNREGISTERED } from '../../../content/records';
import { ARCHIVE_UI } from '../../../content/text';
import {
  ArchivedRecord,
  Draft,
  MissingPolicy,
  SourceRecord,
  ValidationOk,
} from '../../../core/types';
import { OperationView } from '../../../state/work-operations.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { SourceCardComponent } from '../../shared/source-card/source-card.component';
import { ArchivePreviewComponent } from '../archive-preview/archive-preview.component';

/**
 * 歸檔來源／核對表單（R6-01；各歸檔日共用）：來源卡、姓名顯示、人員編號輸入與缺值處理選項。
 * 這裡只呈現容器傳入的資料並回報玩家意圖，不注入 GameStateService、不讀寫 localStorage、
 * 不呼叫驗證規則；已提交的紀錄改顯示鎖定後的結果（提交鎖定由容器與狀態層負責）。
 * 姓名只作顯示，不提供輸入框。
 *
 * R10：人員編號是文字輸入，任何非空白字串都照玩家輸入保存（不比對來源、不補零、不改大小寫）。
 * R11：沒有任何來源編號帶入；欄位只顯示草稿（新紀錄為空白），由玩家自己輸入或貼上。提交階段由容器傳入並顯示在表單旁。
 * R12 §4：缺值處理欄的標題旁有次要按鈕，可向同事詢問這個欄位（只回報意圖，不改草稿、不開對話框）。
 */
@Component({
  selector: 'app-archive-check-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [SourceCardComponent, ArchivePreviewComponent, OperationStatusComponent],
  templateUrl: './archive-check-form.component.html',
})
export class ArchiveCheckFormComponent {
  readonly record = input.required<SourceRecord>();
  readonly draft = input.required<Draft>();
  /** 已提交至本日批次的結果；undefined＝尚未提交，顯示表單。 */
  readonly archived = input.required<ArchivedRecord | undefined>();
  /** 欄位錯誤訊息；空字串＝無錯誤（訊息由容器向規則層取得）。 */
  readonly fieldError = input.required<string>();
  /** 驗證通過待確認的結果；null＝尚未驗證或已清除。 */
  readonly preview = input.required<ValidationOk | null>();
  /** 有提交處理中：停用驗證與確認。 */
  readonly busy = input(false);
  /** 這一筆的提交階段；null＝不顯示。 */
  readonly operation = input<OperationView | null>(null);
  /**
   * 拒絕紀錄欄旁「向同事詢問」入口的文字（R12 §4；問過前後由容器決定）；null＝不顯示。
   */
  readonly helpLabel = input<string | null>(null);

  readonly codeInput = output<string>();
  readonly policySelect = output<MissingPolicy>();
  readonly validate = output<void>();
  readonly confirm = output<void>();
  /** 寫入失敗後重試。 */
  readonly retry = output<void>();
  /** 玩家按「這個欄位是什麼？」；由容器送出提問並打開通訊（草稿不變）。 */
  readonly askHelp = output<void>();

  protected readonly t = ARCHIVE_UI;

  /** 輸入框只在未提交的表單中存在，因此不用 required。 */
  private readonly archiveInput = viewChild<ElementRef<HTMLInputElement>>('archiveInput');

  /** 姓名只顯示，不可編輯；來源未登記時顯示「未登記」。 */
  protected readonly nameText = computed(() => this.record().name ?? NAME_UNREGISTERED);

  /** 適用拒絕紀錄但來源未附時，才需要選擇處理方式。 */
  protected readonly needsPolicy = computed(() => {
    const r = this.record();
    return r.refusalApplies && r.refusal === null;
  });

  /** 容器在驗證失敗後把焦點還給輸入框。 */
  focusCode(): void {
    this.archiveInput()?.nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.codeInput.emit((event.target as HTMLInputElement).value);
  }
}
