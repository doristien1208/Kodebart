import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CASE_REVIEW_UI, WORKDAY_UI } from '../../../content/text';
import { OperationView } from '../../../state/work-operations.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { DocumentField } from '../../shared/presenters/work-document';

/** 候選附件（畫面用）：文件標題與欄位；內容 ID 只用於追蹤與開啟，不顯示。 */
export interface AttachmentCandidateView {
  documentId: string;
  heading: string;
  fields: readonly DocumentField[];
}

let formSeq = 0;

/**
 * 附件關聯的選擇與送出（M1 §2B）：附件任務與回條修訂共用的純呈現元件。
 *
 * - 列出候選附件（單選）；選取的附件下方顯示「這份附件能證明什麼？」與文件欄位，「開啟來源」在桌面開啟原件。
 * - 兩個送出動作樣式相同、沒有正解提示：「引用附件並送件」（需先選附件）與「保留缺漏並送覆核」。
 * - 只驗必要欄位（引用時要選附件），不判斷附件是否屬於這個人；處理中停用送出（連點只送一次）。
 */
@Component({
  selector: 'app-attachment-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [OperationStatusComponent],
  templateUrl: './attachment-form.component.html',
  styleUrl: './attachment-form.component.css',
})
export class AttachmentFormComponent {
  readonly candidates = input.required<readonly AttachmentCandidateView[]>();
  /** 兩種處理方式的文字（任務內容）。 */
  readonly labels = input.required<{ reference: string; review: string }>();
  /** 目前選取的附件（草稿）；沒有為 undefined。 */
  readonly selected = input<string | undefined>(undefined);
  readonly error = input('');
  readonly busy = input(false);
  readonly operation = input<OperationView | null>(null);

  readonly pick = output<string>();
  readonly open = output<string>();
  readonly compare = output<void>();
  readonly submit = output<'reference' | 'review'>();
  readonly retry = output<void>();

  protected readonly ui = WORKDAY_UI;
  protected readonly methodLabel = CASE_REVIEW_UI.decisionsHeading;
  private readonly seq = ++formSeq;
  protected readonly groupName = `attachment-${this.seq}`;
  protected readonly errorId = `attachment-error-${this.seq}`;

  protected readonly current = computed(() => this.candidates().find((c) => c.documentId === this.selected()) ?? null);
}
