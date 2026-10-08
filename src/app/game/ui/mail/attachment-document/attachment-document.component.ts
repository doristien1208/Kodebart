import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { NAME_UNREGISTERED } from '../../../content/records';
import { ARCHIVE_UI, DOCUMENT_ISSUES_UI, MAIL_UI, RECORD_REVIEW_UI, RETURNED_REVIEW_UI } from '../../../content/text';
import { ReturnReceiptAttachment } from '../../../core/types';
import { VALIDATION_MESSAGES, isValidCodeString } from '../../../core/validate';
import { GameStateService } from '../../../state/game-state.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { AttachmentDocumentView, attachmentDocument } from '../presenters/attachment-view';
import { ReturnRevisionService } from '../services/return-revision.service';

let documentSeq = 0;

/**
 * 郵件附件文件（R12 §1）：一份回條（版本）的固定快照，放在桌面層的附件視窗內。
 *
 * - 顯示這份回條當時核對的編號、結果（退件＋原因／收件回條的結案說明）與日期；原件（隨附原表、第一次送件）、
 *   第二輪審查紀錄與只到本版本的歷次修改。內容全部由存檔推導，不會換成最新資料。
 * - 只有 `game.editableReceiptId(caseId) === receiptId`（案件最新退件、待修正）時可修訂：編號預填
 *   這份回條的草稿，沒有草稿時是最後一次實際送出的值（回條核對的編號，不是來源值）；輸入即存入草稿。
 *   「重新送審／註記並送窗口待查」經 ReturnRevisionService 帶回條 ID 送出；處理中停用。
 * - 送出成功後案件狀態改變，同案所有已開啟的文件（含本視窗）依狀態自動變唯讀；過期的操作由狀態層拒絕。
 * - 唯讀的回條若留有草稿，顯示「此版本已不是目前待處理版本」與草稿原值（只供查看，不套用到新版本）。
 * - 找不到案件／回條／版本時只顯示找不到附件的說明，不退回最新版本。
 */
@Component({
  selector: 'app-attachment-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [OperationStatusComponent],
  templateUrl: './attachment-document.component.html',
  styleUrl: './attachment-document.component.css',
})
export class AttachmentDocumentComponent {
  /** 郵件附件的引用（案件＋回條＋版本）。 */
  readonly ref = input.required<ReturnReceiptAttachment>();

  private readonly game = inject(GameStateService);
  private readonly revision = inject(ReturnRevisionService);

  protected readonly t = MAIL_UI;
  protected readonly rt = RETURNED_REVIEW_UI;
  protected readonly issues = DOCUMENT_ISSUES_UI;
  protected readonly nameLabel = ARCHIVE_UI.nameLabel;
  protected readonly codeLabel = ARCHIVE_UI.fieldLabel;
  protected readonly checkedLabel = DOCUMENT_ISSUES_UI.receipts.codeLabel;
  protected readonly released = RECORD_REVIEW_UI.release;
  protected readonly unregistered = NAME_UNREGISTERED;

  private readonly seq = ++documentSeq;
  protected readonly inputId = `attachment-code-${this.seq}`;
  protected readonly errorId = `attachment-error-${this.seq}`;
  protected readonly headingId = `attachment-case-${this.seq}`;

  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  /** 存檔的批次：紀錄姓名取自原批次的提交快照；批次沒變時不重算文件。 */
  private readonly batches = computed(() => this.game.save()?.batches ?? {});

  protected readonly view = computed<AttachmentDocumentView | null>(() =>
    attachmentDocument(this.game.returns(), this.batches(), this.ref()),
  );

  /** 這份回條目前可以建立新修訂（與狀態層的版本鎖定同一判斷）。 */
  protected readonly editable = computed(
    () => this.view() !== null && this.game.editableReceiptId(this.ref().caseId) === this.ref().receiptId,
  );

  /** 這份回條的草稿（過期回條的草稿仍可讀出供查看）。 */
  protected readonly draft = computed(() => this.game.issueDraft(this.ref().receiptId));
  /** 唯讀但留有草稿：顯示過期提示與草稿原值。 */
  protected readonly staleDraft = computed(() => (!this.editable() && this.view() ? (this.draft() ?? null) : null));

  /** 修訂欄位的值：草稿優先，否則為回條核對的編號（最後一次實際送出的值）；換回條或可修訂狀態改變時重設。 */
  protected readonly code = linkedSignal<string, string>({
    source: computed(() => `${this.ref().receiptId}#${this.editable()}`),
    computation: () => this.draft() ?? this.view()?.checkedCode ?? '',
  });

  /** 欄位提示（未填編號）；換回條或狀態改變時清除。 */
  protected readonly error = linkedSignal<string, string>({
    source: computed(() => `${this.ref().receiptId}#${this.editable()}`),
    computation: () => '',
  });

  protected readonly busy = this.revision.busy;
  protected readonly operation = computed(() => this.revision.operationFor(this.ref().caseId, this.ref().receiptId));

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.code.set(value);
    if (this.error()) this.error.set('');
    if (this.editable()) this.game.setIssueDraft(this.ref().receiptId, value);
  }

  /** 重新送審：只驗型別與必填，照填寫的字串原樣送出。 */
  protected async onResubmit(): Promise<void> {
    if (this.busy() || !this.editable()) return;
    const code = this.code();
    if (!isValidCodeString(code)) {
      this.error.set(VALIDATION_MESSAGES.codeRequired);
      this.codeInput()?.nativeElement.focus();
      return;
    }
    this.error.set('');
    const { caseId, receiptId } = this.ref();
    await this.revision.resubmit(caseId, receiptId, code);
  }

  /** 註記並送窗口待查（仍屬未解決）。 */
  protected async onSendToWindow(): Promise<void> {
    if (this.busy() || !this.editable()) return;
    this.error.set('');
    const { caseId, receiptId } = this.ref();
    await this.revision.sendToWindow(caseId, receiptId);
  }

  protected onRetry(): void {
    const { caseId, receiptId } = this.ref();
    void this.revision.retry(caseId, receiptId);
  }
}
