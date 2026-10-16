import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { WORKDAY_UI } from '../../../content/text';
import { findTask } from '../../../core/day-plan';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { AttachmentCandidateView, AttachmentFormComponent } from '../../attachment/attachment-form/attachment-form.component';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { BatchViewComponent } from '../batch-view/batch-view.component';
import { CONTENT_LABELS, DocumentRef, WorkDocumentView, workDocumentView } from '../presenters/work-document';

/**
 * 文件視窗的內容（M1）：來源文件、送件副本、附件關聯版本、批次副本／預覽。郵件附件與工作中開啟的文件共用。
 *
 * - 內容全部由存檔與內容推導（work-document presenter）；舊版本與副本唯讀。
 * - 附件關聯只有「最新版本被退回」時可修訂：選附件或保留缺漏後送出，經 WorkOperationsService
 *   帶版本序號送出（版本鎖定）；過期的視窗操作由狀態層拒絕，不覆寫新版本。
 * - 找不到資料時只顯示找不到附件的說明，不改開最新版本。
 */
@Component({
  selector: 'app-work-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [AttachmentFormComponent, BatchViewComponent],
  templateUrl: './work-document.component.html',
  styleUrl: './work-document.component.css',
})
export class WorkDocumentComponent {
  readonly ref = input.required<DocumentRef>();

  private readonly game = inject(GameStateService);
  private readonly ops = inject(WorkOperationsService);
  private readonly attachments = inject(MailAttachmentService);

  protected readonly ui = WORKDAY_UI;

  protected readonly view = computed<WorkDocumentView | null>(() => {
    const save = this.game.save();
    return save ? workDocumentView(this.ref(), save, DAY_DIRECTORY, CONTENT_LABELS) : null;
  });

  /** 可修訂的附件關聯：候選附件、兩種處理文字與目前選取（草稿）。 */
  protected readonly revision = computed(() => {
    const v = this.view();
    if (v?.kind !== 'link' || !v.editable) return null;
    const task = findTask(DAY_DIRECTORY, v.taskId);
    if (task?.kind !== 'attachment') return null;
    const candidates: AttachmentCandidateView[] = task.candidates.map((c) => ({
      documentId: c.documentId,
      heading: c.document.heading,
      fields: c.document.fields,
    }));
    return {
      taskId: v.taskId,
      versionIndex: v.versionIndex,
      candidates,
      labels: { reference: CONTENT_LABELS.choice(v.taskId, 'reference'), review: CONTENT_LABELS.choice(v.taskId, 'review') },
      selected: this.game.attachmentProgress(v.taskId).draft?.documentId,
    };
  });

  protected readonly error = linkedSignal<string, string>({
    source: computed(() => `${JSON.stringify(this.ref())}#${this.revision() !== null}`),
    computation: () => '',
  });

  protected readonly busy = this.ops.busy;
  protected readonly operation = computed(() => {
    const op = this.ops.current();
    const r = this.revision();
    return op && r && op.kind === 'attachment-revise' && op.taskId === r.taskId ? op : null;
  });

  protected onPick(documentId: string): void {
    const r = this.revision();
    if (r) this.game.setAttachmentDraft(r.taskId, { documentId });
    this.error.set('');
  }

  protected onOpen(documentId: string): void {
    this.attachments.open({ kind: 'case-source', documentId });
  }

  protected onCompare(): void {
    const r = this.revision();
    if (r) this.attachments.tile([this.ref(), ...r.candidates.map((c): DocumentRef => ({ kind: 'case-source', documentId: c.documentId }))]);
  }

  protected async onSubmit(choiceId: 'reference' | 'review'): Promise<void> {
    const r = this.revision();
    if (!r || this.busy()) return;
    const documentId = choiceId === 'reference' ? r.selected : undefined;
    if (choiceId === 'reference' && !documentId) {
      this.error.set(this.ui.chooseAttachment);
      return;
    }
    this.error.set('');
    const heading = r.candidates.find((c) => c.documentId === documentId)?.heading ?? '';
    await this.ops.reviseAttachment(r.taskId, r.versionIndex, { choiceId, documentId }, heading);
  }

  protected onRetry(): void {
    void this.ops.retry();
  }
}
