import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { documentsOfTask, recordsOfTask } from '../../../content/bundle';
import { ReceiptDocumentText, ReconcileTaskText, ReportDocumentText } from '../../../content/schema';
import { RECORD_REVIEW_UI, RECORD_STATUS, deliverLabel, formatText } from '../../../content/text';
import { RecordKey, Reply } from '../../../core/types';
import { GameStateService } from '../../../state/game-state.service';
import { routeForStage } from '../../../state/stage-route';
import { OperationView, WorkOperationsService } from '../../../state/work-operations.service';
import { ModalDialogComponent } from '../../shared/modal-dialog/modal-dialog.component';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { archivedRefusalStatus, sourceRefusalStatus } from '../../shared/presenters/record-status';
import { Day2DocumentCell, Day2DocumentComponent } from '../day2-document/day2-document.component';
import { RecordReviewChange, RecordReviewItem, RecordReviewListComponent } from '../record-review-list/record-review-list.component';

/** 目前核對工作的全部顯示文字：任務本身與其掛的摘要／副本文件。 */
interface ReconcileContent {
  task: ReconcileTaskText;
  report: ReportDocumentText;
  receipt: ReceiptDocumentText;
}

/**
 * 核對工作（task kind `reconcile`；目前為 Day 2）的容器（KB-R4-02／R6-01）。
 *
 * 文字、文件與來源紀錄一律從目前 reconcile task 取得：任務文字＝`taskContent().text`，
 * 摘要／副本＝`documentsOfTask(taskId)` 依 kind 取出，核對對象＝`subjectKey()`，
 * 其餘格子＝任務 recordIds 中的其他紀錄（鍵值在來源批次 `records()` 內解析）。
 * 只讀取 GameStateService 的結果（arranged／night／evidence），不在此重算矩陣、不擲骰。
 * 兩份文件的呈現交給 Day2DocumentComponent（今日摘要與昨日副本共用同一個元件，
 * 可並列逐格比較），對話框的開啟焦點與關閉還原焦點交給共用的 ModalDialogComponent。
 *
 * R10：摘要與副本上的人員編號一律取前一階段保存的送件編號（archiveCode，照玩家當時輸入），
 * 原始來源只在逐筆審查清單中標明「原始來源」時顯示；不在換頁、跨日或產生報表時修回。
 * 每一筆都要先有明確的審查處置（核對後放行／保留待查）才能送出回覆；確認收到摘要不等於放行。
 * 回覆經 WorkOperationsService（處理中停用、顯示階段），保存成功才導向下一步。
 */
@Component({
  selector: 'app-day2-reconcile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Day2DocumentComponent, ModalDialogComponent, OperationStatusComponent, RecordReviewListComponent],
  templateUrl: './day2-reconcile.component.html',
})
export class Day2ReconcileComponent {
  protected readonly game = inject(GameStateService);
  private readonly ops = inject(WorkOperationsService);
  private readonly router = inject(Router);

  protected readonly reviewUi = RECORD_REVIEW_UI;
  /** 處理中：停用回覆與審查處置。 */
  protected readonly busy = this.ops.busy;
  /** 目前核對工作的回覆提交階段（狀態在服務裡，換頁回來仍看得到）。 */
  protected readonly operation = computed<OperationView | null>(() => {
    const op = this.ops.current();
    return op && op.kind === 'reply' && op.taskId === this.game.taskId() ? op : null;
  });

  private readonly replyDialog = viewChild.required<ModalDialogComponent>('replyDialog');

  protected readonly evidence = this.game.evidence;
  protected readonly night = this.game.night;
  protected readonly arranged = this.game.arranged;

  /** 目前的 reconcile task 內容；不是核對日時為 null（work view 不會掛上本元件）。 */
  private readonly task = computed(() => {
    const t = this.game.taskContent();
    return t?.kind === 'reconcile' ? t : null;
  });

  /** 任務文字＋依 kind 取出的摘要與副本；缺任一份文件時為 null（內容驗證已保證存在）。 */
  protected readonly content = computed<ReconcileContent | null>(() => {
    const t = this.task();
    if (!t) return null;
    const docs = documentsOfTask(t.id);
    const report = docs.find((d) => d.kind === 'report');
    const receipt = docs.find((d) => d.kind === 'receipt');
    return report && receipt ? { task: t.text, report: report.text, receipt: receipt.text } : null;
  });

  /** 核對對象（來源批次中的一筆），其餘為同一份文件上的對照紀錄；依任務 recordIds 順序。 */
  private readonly subjectKey = this.game.subjectKey;
  private readonly otherKeys = computed<readonly RecordKey[]>(() => {
    const t = this.task();
    const subject = this.subjectKey();
    return t ? recordsOfTask(t.id).map((r) => r.key).filter((k) => k !== subject) : [];
  });

  /** 核對工作引用的全部紀錄（依任務 recordIds 順序）。 */
  private readonly taskKeys = computed<readonly RecordKey[]>(() => {
    const t = this.task();
    return t ? recordsOfTask(t.id).map((r) => r.key) : [];
  });

  /** 逐筆審查清單：送件編號＝前一階段保存的 archiveCode，原始來源＝提交快照中的來源編號。 */
  protected readonly reviewItems = computed<readonly RecordReviewItem[]>(() =>
    this.taskKeys().flatMap((key) => {
      const a = this.game.archived(key);
      if (!a) return [];
      return [
        {
          key,
          name: a.source.name,
          code: a.archiveCode,
          sourceCode: a.source.code,
          disposition: this.game.recordReview(key)?.disposition ?? null,
        },
      ];
    }),
  );
  /** 每一筆都有審查處置（放行或保留待查）。 */
  protected readonly allReviewed = computed(() => this.taskKeys().every((key) => this.game.recordReview(key) !== undefined));
  /** 已送出回覆：審查處置鎖定。 */
  protected readonly replied = computed(() => this.game.reply() !== null);

  /** 核對對象的昨日提交結果。 */
  protected readonly subjectArchived = computed(() => {
    const key = this.subjectKey();
    return key ? this.game.archived(key) : undefined;
  });

  protected readonly hint = computed(() => {
    const t = this.content()?.task;
    if (!t) return '';
    const e = this.evidence();
    return !e.reportOpened ? t.hintNeedReport : !e.receiptOpened ? t.hintNeedReceipt : t.hintReady;
  });

  /**
   * 摘要可開啟：已有跨日夜間結果，或來源批次已交付（R9 §0：同日 archive → reconcile）。
   * 只讀已保存的狀態，不為了開摘要而提早擲骰。
   */
  protected readonly reportReady = computed(() => this.night() !== null || this.game.allArchived());

  /** 版本行：有夜間結果時用版本號；沒有時用內容的中性版本行（versionNeutral），不寫任何判定。 */
  protected readonly reportTag = computed(() => {
    const c = this.content();
    if (!c) return '';
    const n = this.night();
    return n ? formatText(c.report.versionTemplate, { revision: n.reportRevision }) : c.report.versionNeutral;
  });

  /** 來源行：夜間校驗只在真的有跨日介入時出現；沒有夜間結果＝規則彙整（與四格的 intervention=false 一致）。 */
  protected readonly reportSub = computed(() => {
    const c = this.content();
    if (!c) return '';
    const origin = this.night()?.intervention ? c.report.sourceOrigin.intervention : c.report.sourceOrigin.rules;
    return formatText(c.report.sourceTemplate, { origin });
  });

  /**
   * 今日批次摘要：核對對象依四格矩陣結果（已列入安排／待資料覆核），
   * 其餘紀錄未列入安排、拒絕紀錄照來源值。摘要由昨日提交產生，顯示碼一律取前一階段保存的送件編號（R10）。
   * `{value}` 一律傳 recordStatus 的人類文字（R7 §6.2）：已列入安排＝未拒絕、待覆核＝未確認，
   * 其他紀錄依來源值（已拒絕／未拒絕／未提供／不適用）；不再傳 String(true/false/null)。
   */
  protected readonly reportCells = computed<readonly Day2DocumentCell[]>(() => {
    const c = this.content();
    const subject = this.subjectKey();
    if (!c || !subject) return [];
    const refusal = (value: string) => formatText(c.report.refusalTemplate, { value });
    const arranged = this.arranged();
    return [
      {
        key: subject,
        code: this.submittedCode(subject),
        line: arranged ? c.report.arranged : c.report.pendingReview,
        note: refusal(arranged ? RECORD_STATUS.notRefused : RECORD_STATUS.unconfirmed),
      },
      ...this.otherKeys().map((key) => {
        const r = this.game.record(key);
        return { key, code: this.submittedCode(key), line: c.report.notArranged, note: refusal(sourceRefusalStatus(r)) };
      }),
    ];
  });

  /**
   * 昨日送件副本：每一筆用玩家當時提交的編號（archiveCode）、結果與去向；拒絕紀錄依 origin 顯示人類文字
   * （依規則補登／未確認／來源資料的已拒絕或未拒絕），不顯示 true／false／null。
   * 尚無提交紀錄時退回來源值與正式歸檔（正常流程不會發生：Day 1 必須全部完成才能交接）。
   */
  protected readonly receiptCells = computed<readonly Day2DocumentCell[]>(() => {
    const c = this.content();
    const subject = this.subjectKey();
    if (!c || !subject) return [];
    return [subject, ...this.otherKeys()].map((key) => {
      const r = this.game.record(key);
      const a = this.game.archived(key);
      return {
        key,
        code: this.submittedCode(key),
        line: formatText(c.report.refusalTemplate, {
          value: a ? archivedRefusalStatus(a) : sourceRefusalStatus(r),
        }),
        note: a?.origin === 'review' ? c.receipt.destReview : c.receipt.destArchive,
      };
    });
  });

  /** 對話框中待確認的回覆；null＝對話框已關閉。同日換到另一件核對工作時重設（linkedSignal）。 */
  protected readonly pending = linkedSignal<string | null, Reply | null>({
    source: this.game.taskId,
    computation: () => null,
  });

  /** 回覆對話框的文字（目前 reconcile task 的 dialog）。 */
  protected readonly dialog = computed(() => this.content()?.task.dialog ?? null);
  protected readonly dialogHeading = computed(() => {
    const d = this.dialog();
    if (!d) return '';
    return this.pending() === 'ask' ? d.headingAsk : d.headingDefault;
  });
  protected readonly dialogBody = computed(() => {
    const c = this.pending();
    const d = this.dialog();
    return c && d ? d.response[c] : '';
  });

  /**
   * 對話框的確認按鈕＝交付核對工作：當日還有其他工作 →「交付此項工作」；最後一項 →「完成今日交接」。
   * 送出後 stage 若已離開 work，維持「完成今日交接」不閃動。
   */
  protected readonly deliverText = computed(() =>
    deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()),
  );

  /** 送件編號：前一階段保存的 archiveCode（照玩家當時輸入）；尚無提交時才退回來源值（正常流程不會發生）。 */
  private submittedCode(key: RecordKey): string {
    return this.game.archived(key)?.archiveCode ?? this.game.record(key).code;
  }

  /** 逐筆審查處置（回覆前可改）。 */
  protected onReview(change: RecordReviewChange): void {
    if (this.busy() || this.replied()) return;
    this.game.setRecordReview(change.key, change.disposition);
  }

  protected openReply(choice: Reply, event: Event): void {
    if (this.busy() || !this.game.canReply(choice)) return;
    this.pending.set(choice);
    // 焦點（開啟時放到「返回核對」、關閉時還給觸發按鈕）由 ModalDialogComponent 處理。
    this.replyDialog().open(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  }

  /**
   * 送出回覆＝交付核對工作 → 依新 stage 導向：當日還有工作仍在 /work（WorkView 換成下一件）；
   * 全部完成才到日結 /overnight（或最後一日 /end）。
   */
  protected async confirmReply(): Promise<void> {
    const c = this.pending();
    if (!c || this.busy()) return;
    if (await this.ops.submitReply(c)) this.afterReplied();
  }

  /** 寫入失敗後重試（服務保證不重複事件）。 */
  protected async onRetry(): Promise<void> {
    if (await this.ops.retry()) this.afterReplied();
  }

  private afterReplied(): void {
    this.replyDialog().close();
    const stage = this.game.stage();
    void this.router.navigateByUrl(stage ? routeForStage(stage) : '/');
  }

  /** 對話框關閉（含 Escape）：清除待確認選項。 */
  protected onDialogClosed(): void {
    this.pending.set(null);
  }
}
