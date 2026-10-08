import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { taskHeading } from '../../../content/bundle';
import { ReportTask } from '../../../content/schema';
import { WORKDAY_UI, deliverLabel } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { DocumentRef, refusalText } from '../../shared/presenters/work-document';
import { WorkDeliveryService } from '../../workbench/services/work-delivery.service';

/**
 * 交付結果核對（task kind `report`，M1 Day 6）。
 *
 * - 前日的批次副本可從這裡開啟（依保存的輸出，唯讀），對照今天匯入的結果。
 * - 「建立交接報告」依欄位映射的實際輸出與批次的附件依據逐列列出，送件、本人回覆、窗口收件、待補分開計數：
 *   窗口收件不算本人回覆；流程送出不等於本人已回覆。數量全部取保存的資料。
 * - 「執行並交付」保存報告快照；建立報告時記下 generated（同事的私訊依此送達）。
 */
@Component({
  selector: 'app-report-work',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OperationStatusComponent],
  templateUrl: './report-work.component.html',
  styleUrl: './report-work.component.css',
})
export class ReportWorkComponent {
  protected readonly game = inject(GameStateService);
  private readonly ops = inject(WorkOperationsService);
  private readonly docs = inject(MailAttachmentService);
  private readonly delivery = inject(WorkDeliveryService);

  protected readonly ui = WORKDAY_UI;

  protected readonly plan = computed(() => {
    const t = this.game.task();
    return t?.kind === 'report' ? t : null;
  });
  protected readonly text = computed(() => {
    const t = this.game.taskContent();
    return t?.kind === 'report' ? (t as ReportTask).text : null;
  });
  protected readonly generated = computed(() => {
    const p = this.plan();
    return p ? this.game.reportGenerated(p.id) : false;
  });
  protected readonly report = computed(() => {
    const p = this.plan();
    return p && this.generated() ? this.game.report(p.id) : null;
  });
  protected readonly done = computed(() => this.game.taskDone());

  /** 前日的批次副本（已交付的才列出）。 */
  protected readonly previous = computed(() => {
    const p = this.plan();
    if (!p) return [];
    return p.transformTaskIds
      .filter((id) => this.game.transformProgress(id).submitted !== undefined)
      .map((id) => ({ id, label: `${taskHeading(id)}｜${this.ui.batchCopyLabel}`, ref: { kind: 'batch-output', taskId: id } as DocumentRef }));
  });

  protected readonly rows = computed(() =>
    (this.report()?.rows ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      value: refusalText(r.value),
      evidence: this.ui.evidence[r.evidence],
      status: this.ui.rowStatus[r.status],
      pending: r.status === 'pending',
    })),
  );

  protected readonly busy = this.ops.busy;
  protected readonly operation = computed(() => {
    const op = this.ops.current();
    return op && op.kind === 'report' && op.taskId === this.game.taskId() ? op : null;
  });
  protected readonly deliverText = computed(() => deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()));

  constructor() {
    effect(() => {
      const p = this.plan();
      if (p && this.game.stage() === 'work') untracked(() => this.game.markTaskOpened());
    });
  }

  protected open(ref: DocumentRef): void {
    this.docs.open(ref);
  }

  protected onGenerate(): void {
    this.game.generateReport();
  }

  protected async onExecute(): Promise<void> {
    if (this.busy() || this.done() || !this.generated()) return;
    await this.ops.submitReport();
  }

  protected onRetry(): void {
    void this.ops.retry();
  }

  protected onDeliver(): void {
    if (!this.busy()) this.delivery.deliver();
  }
}
