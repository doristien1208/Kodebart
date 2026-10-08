import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, untracked } from '@angular/core';
import { TransformTask } from '../../../content/schema';
import { FIELD_MAP_UI, WORKDAY_UI, deliverLabel } from '../../../content/text';
import { TransformPolicy } from '../../../core/day-plan';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentService } from '../../mail/services/mail-attachment.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { DocumentRef, refusalText } from '../../shared/presenters/work-document';
import { WorkDeliveryService } from '../../workbench/services/work-delivery.service';

/**
 * 批次轉換工作（task kind `transform`，M1 §2C）。
 *
 * - 目前文件：這批的輸入列（玩家採用的人員編號、來源回覆欄、附件）——全部取自前階段實際保存的資料。
 * - 缺漏策略二擇一（套用部門預設並交付／保留缺漏並送覆核），沒有正解提示；說明兩者都不補造本人回覆。
 * - 「建立批次預覽」在文件視窗開啟 input／rule／output（逐列差異與 JSON），正文只放摘要數量；
 *   「執行並交付」經 WorkOperationsService：驗證處理設定 → 建立批次輸出 → 保存送件副本 → 加入後續佇列。
 * - 第一次開啟記下 opened；第一次預覽記下 previewedOnce（同事的私訊依此送達）。
 */
@Component({
  selector: 'app-transform-work',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OperationStatusComponent],
  templateUrl: './transform-work.component.html',
  styleUrl: './transform-work.component.css',
})
export class TransformWorkComponent {
  protected readonly game = inject(GameStateService);
  private readonly ops = inject(WorkOperationsService);
  private readonly docs = inject(MailAttachmentService);
  private readonly delivery = inject(WorkDeliveryService);

  protected readonly ui = WORKDAY_UI;
  protected readonly policies: readonly TransformPolicy[] = ['departmentDefault', 'review'];

  protected readonly taskId = computed(() => (this.game.task()?.kind === 'transform' ? (this.game.taskId() ?? '') : ''));
  protected readonly text = computed(() => {
    const t = this.game.taskContent();
    return t?.kind === 'transform' ? (t as TransformTask).text : null;
  });
  protected readonly progress = computed(() => this.game.transformProgress(this.taskId()));
  protected readonly display = computed(() => (this.taskId() ? this.game.transformDisplay(this.taskId()) : null));
  protected readonly missing = computed(() => this.game.transformMissing(this.taskId()));
  protected readonly submitted = computed(() => this.progress().submitted ?? null);

  /** 輸入列（摘要表）：人員編號（採用）、來源回覆欄、附件。 */
  protected readonly rows = computed(() =>
    (this.display()?.rows ?? []).map((r) => ({
      id: r.id,
      code: r.adoptedCode ?? '',
      source: refusalText(r.sourceRefusal),
      attachment: r.heldForReview
        ? this.ui.preserveMissing
        : r.attachment
          ? `${r.attachment.heading}（${r.attachment.attachedKey !== r.recordKey ? this.ui.evidence.mismatch : this.ui.evidence[r.attachment.evidence]}）`
          : this.ui.evidence.none,
      missing: r.valueOrigin === 'held' || r.valueOrigin === 'policy',
    })),
  );

  /** 已預覽（或已交付）時的數量摘要。 */
  protected readonly counts = computed(() => {
    const p = this.progress();
    const out = this.submitted() ?? (p.previewed ? this.display() : null);
    return out ? { delivered: out.deliveredCount, reply: out.replyCount, pending: out.pendingCount } : null;
  });

  protected readonly error = linkedSignal<string | null, string>({ source: this.game.taskId, computation: () => '' });
  protected readonly busy = this.ops.busy;
  protected readonly operation = computed(() => {
    const op = this.ops.current();
    return op && op.kind === 'transform' && op.taskId === this.taskId() ? op : null;
  });
  protected readonly deliverText = computed(() => deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()));

  constructor() {
    effect(() => {
      if (this.taskId() && this.game.stage() === 'work' && !this.progress().opened) untracked(() => this.game.markTaskOpened());
    });
  }

  protected policyLabel(policy: TransformPolicy): string {
    return this.text()?.[policy] ?? '';
  }

  protected onPolicy(policy: TransformPolicy): void {
    this.game.setTransformPolicy(policy);
    this.error.set('');
  }

  /** 建立批次預覽並在文件視窗開啟 input／rule／output；缺漏需要策略卻沒選時提示。 */
  protected onPreview(): void {
    if (!this.game.previewTransform()) {
      this.error.set(FIELD_MAP_UI.policyRequired);
      return;
    }
    this.error.set('');
    this.docs.open({ kind: 'batch-preview', taskId: this.taskId() });
  }

  protected openPreview(): void {
    const ref: DocumentRef = this.submitted() ? { kind: 'batch-output', taskId: this.taskId() } : { kind: 'batch-preview', taskId: this.taskId() };
    this.docs.open(ref);
  }

  protected async onExecute(): Promise<void> {
    if (this.busy() || this.submitted() || !this.progress().previewed) return;
    await this.ops.submitTransform();
  }

  protected onRetry(): void {
    void this.ops.retry();
  }

  protected onDeliver(): void {
    if (!this.busy()) this.delivery.deliver();
  }
}
