import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { RECORD_B102, RECORD_B607 } from '../../content/records';
import { DAY2 } from '../../content/text';
import { Reply } from '../../core/types';
import { GameStateService } from '../../state/game-state.service';
import { ModalDialogComponent } from '../shared/modal-dialog.component';
import { Day2DocumentCell, Day2DocumentComponent } from './day2-document.component';

/**
 * Day 2 工作：核對昨日批次摘要（原型 day2()／reply()）的容器（KB-R4-02）。
 * 只讀取 GameStateService 的結果（arranged／night），不在此重算矩陣、不擲骰。
 * 兩份文件的呈現交給 Day2DocumentComponent（今日摘要與昨日副本共用同一個元件，
 * 可並列逐格比較），對話框的開啟焦點與關閉還原焦點交給共用的 ModalDialogComponent。
 */
@Component({
  selector: 'app-day2-reconcile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Day2DocumentComponent, ModalDialogComponent],
  template: `
    <div class="panel">
      <span class="eyebrow">{{ DAY2.eyebrow }}</span>
      <h3>{{ DAY2.heading }}</h3>
      <p class="text-muted">{{ DAY2.body }}</p>
      <div class="flex gap-2.5 items-center flex-wrap mt-5">
        <button type="button" class="btn-primary" (click)="game.openReport()">
          {{ evidence().reportOpened ? DAY2.reportOpened : DAY2.openReport }}
        </button>
        <button type="button" (click)="game.openReceipt()">
          {{ evidence().receiptOpened ? DAY2.receiptOpened : DAY2.openReceipt }}
        </button>
      </div>
    </div>

    @if (evidence().reportOpened && night(); as n) {
      <app-day2-document
        [heading]="DAY2.report.heading"
        [tag]="DAY2.report.version(n.reportRevision)"
        [sub]="DAY2.report.source(n.intervention)"
        [cells]="reportCells()"
        [footer]="DAY2.report.footer"
      />
    }

    @if (evidence().receiptOpened && b102()) {
      <app-day2-document
        [heading]="DAY2.receipt.heading"
        [sub]="DAY2.receipt.sub"
        [cells]="receiptCells()"
      />
    }

    <div class="panel">
      <h3>{{ DAY2.replyHeading }}</h3>
      <div class="grid gap-2.5">
        <button type="button" class="w-full" [disabled]="!game.canReply('ack')" (click)="openReply('ack', $event)">
          {{ DAY2.choices.ack }}
        </button>
        <button type="button" class="w-full" [disabled]="!game.canReply('ask')" (click)="openReply('ask', $event)">
          {{ DAY2.choices.ask }}
        </button>
        <button type="button" class="w-full" [disabled]="!game.canReply('review')" (click)="openReply('review', $event)">
          {{ DAY2.choices.review }}
        </button>
      </div>
      <p class="text-sm text-muted mt-4 mb-0">{{ hint() }}</p>
    </div>

    <app-modal-dialog #replyDialog [heading]="dialogHeading()" (closed)="onDialogClosed()">
      <p dialogBody>{{ dialogBody() }}</p>
      <button dialogActions type="button" data-initial-focus (click)="replyDialog.close()">
        {{ DAY2.dialog.back }}
      </button>
      <button dialogActions type="button" class="btn-primary" (click)="confirmReply()">
        {{ DAY2.dialog.finish }}
      </button>
    </app-modal-dialog>
  `,
})
export class Day2ReconcileComponent {
  protected readonly game = inject(GameStateService);
  private readonly router = inject(Router);
  protected readonly DAY2 = DAY2;

  private readonly replyDialog = viewChild.required<ModalDialogComponent>('replyDialog');

  protected readonly evidence = this.game.evidence;
  protected readonly night = this.game.night;
  protected readonly arranged = this.game.arranged;
  /** Day 2 劇情固定綁這兩筆舊紀錄；鍵名用 content/records.ts 的具名常數，不在元件裡寫字串。 */
  protected readonly b102 = computed(() => this.game.archived(RECORD_B102));
  /** 副本上的拒絕紀錄原值；`String(null)` 顯示為 null，與原型一致。 */
  protected readonly refusalText = computed(() => String(this.b102()?.refusal));
  protected readonly hint = computed(() => {
    const e = this.evidence();
    return !e.reportOpened ? DAY2.hintNeedReport : !e.receiptOpened ? DAY2.hintNeedReceipt : DAY2.hintReady;
  });

  /** 顯示碼取自來源資料，不硬寫。 */
  protected readonly b102Code = this.game.record(RECORD_B102).code;
  protected readonly b607Code = this.game.record(RECORD_B607).code;

  /** 今日批次摘要的兩格：0102 依四格矩陣結果，B607 固定未列入。 */
  protected readonly reportCells = computed<readonly Day2DocumentCell[]>(() => {
    const arranged = this.arranged();
    return [
      {
        code: this.b102Code,
        line: arranged ? DAY2.report.arranged : DAY2.report.pendingReview,
        note: DAY2.report.refusal(arranged ? 'false' : 'null'),
      },
      {
        code: this.b607Code,
        line: DAY2.report.notArranged,
        note: DAY2.report.refusal('true'),
      },
    ];
  });

  /** 昨日歸檔副本的兩格：0102 用玩家當時提交的原值與去向。 */
  protected readonly receiptCells = computed<readonly Day2DocumentCell[]>(() => [
    {
      code: this.b102Code,
      line: DAY2.report.refusal(this.refusalText()),
      note: this.b102()?.origin === 'review' ? DAY2.receipt.destReview : DAY2.receipt.destArchive,
    },
    {
      code: this.b607Code,
      line: DAY2.report.refusal('true'),
      note: DAY2.receipt.destArchive,
    },
  ]);

  /** 對話框中待確認的回覆；null＝對話框已關閉。 */
  protected readonly pending = signal<Reply | null>(null);

  protected readonly dialogHeading = computed(() =>
    this.pending() === 'ask' ? DAY2.dialog.headingAsk : DAY2.dialog.headingDefault,
  );
  protected readonly dialogBody = computed(() => {
    const c = this.pending();
    return c ? DAY2.dialog.response[c] : '';
  });

  protected openReply(choice: Reply, event: Event): void {
    if (!this.game.canReply(choice)) return;
    this.pending.set(choice);
    // 焦點（開啟時放到「返回核對」、關閉時還給觸發按鈕）由 ModalDialogComponent 處理。
    this.replyDialog().open(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  }

  protected confirmReply(): void {
    const c = this.pending();
    if (c && this.game.submitReply(c)) {
      this.replyDialog().close();
      void this.router.navigateByUrl('/end');
    }
  }

  /** 對話框關閉（含 Escape）：清除待確認選項。 */
  protected onDialogClosed(): void {
    this.pending.set(null);
  }
}
