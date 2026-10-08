import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, untracked } from '@angular/core';
import { AttachmentTask } from '../../../content/schema';
import { CASE_REVIEW_UI, MAIL_UI, WORKDAY_UI, deliverLabel } from '../../../content/text';
import { recordLabel } from '../../../content/records';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { DocumentRef } from '../../shared/presenters/work-document';
import { archivedRefusalStatus, sourceRefusalStatus } from '../../shared/presenters/record-status';
import { WorkDeliveryService } from '../../workbench/services/work-delivery.service';
import { AttachmentCandidateView, AttachmentFormComponent } from '../attachment-form/attachment-form.component';

/**
 * 附件關聯工作（task kind `attachment`，M1 §2B）。
 *
 * - 目前文件：對象的來源摘要與玩家採用值（取自歸檔保存值）＋開啟送件副本；候選附件在文件視窗查閱，可並排。
 * - 選一份附件「引用並送件」，或「保留缺漏並送覆核」。只驗必要欄位，不判斷附件是否適用；
 *   選到別人的附件也能送出，下一個工作日的回條才指出。送件保存附件的不可變副本與對象、去向。
 * - 第一次開啟這件工作時記下（同事的私訊依此送達）。送出後顯示保存的送件摘要，可開啟送件副本。
 */
@Component({
  selector: 'app-attachment-work',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AttachmentFormComponent],
  templateUrl: './attachment-work.component.html',
  styleUrl: './attachment-work.component.css',
})
export class AttachmentWorkComponent {
  protected readonly game = inject(GameStateService);
  private readonly ops = inject(WorkOperationsService);
  private readonly docs = inject(MailAttachmentService);
  private readonly delivery = inject(WorkDeliveryService);

  protected readonly ui = WORKDAY_UI;
  protected readonly methodLabel = CASE_REVIEW_UI.decisionsHeading;

  protected readonly plan = computed(() => {
    const t = this.game.task();
    return t?.kind === 'attachment' ? t : null;
  });
  protected readonly text = computed(() => {
    const t = this.game.taskContent();
    return t?.kind === 'attachment' ? (t as AttachmentTask).text : null;
  });
  protected readonly progress = computed(() => {
    const p = this.plan();
    return p ? this.game.attachmentProgress(p.id) : null;
  });

  /** 對象：來源快照與採用值（歸檔保存）。 */
  protected readonly subject = computed(() => {
    const p = this.plan();
    const a = p ? this.game.save()?.batches[p.subjectBatchId]?.archived[p.subjectKey] : undefined;
    if (!p || !a) return null;
    return {
      label: recordLabel({ key: p.subjectKey, ...a.source }),
      sourceCode: a.source.code,
      sourceStatus: sourceRefusalStatus(a.source),
      adoptedCode: a.archiveCode,
      adoptedStatus: archivedRefusalStatus(a),
      ref: { kind: 'archive-copy', batchId: p.subjectBatchId, recordKey: p.subjectKey } as DocumentRef,
    };
  });

  protected readonly candidates = computed<readonly AttachmentCandidateView[]>(() =>
    (this.plan()?.candidates ?? []).map((c) => ({ documentId: c.documentId, heading: c.document.heading, fields: c.document.fields })),
  );
  protected readonly labels = computed(() => ({ reference: this.text()?.reference ?? '', review: this.text()?.review ?? '' }));
  protected readonly selected = computed(() => this.progress()?.draft?.documentId);

  /** 已保存的送件（最新版本）摘要。 */
  protected readonly submitted = computed(() => {
    const p = this.progress();
    const v = p?.versions[p.versions.length - 1];
    const t = this.text();
    if (!p || !v || !t) return null;
    const status = this.game.attachmentStatus(this.plan()?.id ?? '');
    return {
      method: t[v.choiceId],
      document: v.document?.heading ?? null,
      evidence: v.evidence ? this.ui.evidence[v.evidence] : null,
      stateText: status === 'returned' ? MAIL_UI.current : status === 'awaiting' ? MAIL_UI.awaiting : '',
      ref: { kind: 'attachment-link', taskId: this.plan()?.id ?? '', versionIndex: v.index } as DocumentRef,
    };
  });

  protected readonly error = linkedSignal<string | null, string>({ source: this.game.taskId, computation: () => '' });
  protected readonly busy = this.ops.busy;
  protected readonly operation = computed(() => {
    const op = this.ops.current();
    return op && op.kind === 'attachment' && op.taskId === this.game.taskId() ? op : null;
  });

  protected readonly deliverText = computed(() => deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()));

  constructor() {
    // 第一次開啟這件工作：記下 opened（訊息依此送達）；只寫一次
    effect(() => {
      const p = this.plan();
      if (p && this.game.stage() === 'work' && !this.progress()?.opened) untracked(() => this.game.markTaskOpened());
    });
  }

  protected onPick(documentId: string): void {
    const p = this.plan();
    if (p) this.game.setAttachmentDraft(p.id, { documentId });
    this.error.set('');
  }

  protected open(ref: DocumentRef): void {
    this.docs.open(ref);
  }

  protected onOpenSource(documentId: string): void {
    this.docs.open({ kind: 'case-source', documentId });
  }

  /** 並排查閱：對象的送件副本與全部候選附件。 */
  protected onCompare(): void {
    const subject = this.subject();
    const refs: DocumentRef[] = this.candidates().map((c) => ({ kind: 'case-source', documentId: c.documentId }));
    this.docs.tile(subject ? [subject.ref, ...refs] : refs);
  }

  protected async onSubmit(choiceId: 'reference' | 'review'): Promise<void> {
    if (this.busy() || this.submitted()) return;
    const documentId = choiceId === 'reference' ? this.selected() : undefined;
    if (choiceId === 'reference' && !documentId) {
      this.error.set(this.ui.chooseAttachment);
      return;
    }
    this.error.set('');
    const heading = this.candidates().find((c) => c.documentId === documentId)?.heading ?? '';
    await this.ops.submitAttachment({ choiceId, documentId }, heading);
  }

  protected onRetry(): void {
    void this.ops.retry();
  }

  protected onDeliver(): void {
    if (!this.busy()) this.delivery.deliver();
  }
}
