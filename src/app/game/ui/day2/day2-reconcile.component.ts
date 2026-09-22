import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { RECORD_B102, RECORD_B607 } from '../../content/records';
import { DAY2 } from '../../content/text';
import { Reply } from '../../core/types';
import { GameStateService } from '../../state/game-state.service';

/**
 * Day 2 工作：核對昨日批次摘要（原型 day2()／reply()）。
 * 只讀取 GameStateService 的結果（arranged／night），不在此重算矩陣、不擲骰。
 * 摘要與昨日副本可並列比較；回覆用原生 <dialog> 確認後才提交。
 */
@Component({
  selector: 'app-day2-reconcile',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <article class="panel">
        <div class="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
          <h3>{{ DAY2.report.heading }}</h3>
          <span class="tag">{{ DAY2.report.version(n.reportRevision) }}</span>
        </div>
        <p class="text-sm text-muted">{{ DAY2.report.source(n.intervention) }}</p>
        <div class="grid gap-3 md:grid-cols-2">
          <div class="receipt-cell">
            <code>{{ b102Code }}</code>
            <p>{{ arranged() ? DAY2.report.arranged : DAY2.report.pendingReview }}</p>
            <span class="text-sm text-muted">{{ DAY2.report.refusal(arranged() ? 'false' : 'null') }}</span>
          </div>
          <div class="receipt-cell">
            <code>{{ b607Code }}</code>
            <p>{{ DAY2.report.notArranged }}</p>
            <span class="text-sm text-muted">{{ DAY2.report.refusal('true') }}</span>
          </div>
        </div>
        <p class="text-sm text-muted mt-4">{{ DAY2.report.footer }}</p>
      </article>
    }

    @if (evidence().receiptOpened && b102(); as a) {
      <article class="panel">
        <h3>{{ DAY2.receipt.heading }}</h3>
        <p class="text-sm text-muted">{{ DAY2.receipt.sub }}</p>
        <div class="grid gap-3 md:grid-cols-2">
          <div class="receipt-cell">
            <code>{{ b102Code }}</code>
            <p>{{ DAY2.report.refusal(refusalText()) }}</p>
            <span class="text-sm text-muted">
              {{ a.origin === 'review' ? DAY2.receipt.destReview : DAY2.receipt.destArchive }}
            </span>
          </div>
          <div class="receipt-cell">
            <code>{{ b607Code }}</code>
            <p>{{ DAY2.report.refusal('true') }}</p>
            <span class="text-sm text-muted">{{ DAY2.receipt.destArchive }}</span>
          </div>
        </div>
      </article>
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

    <dialog #replyDialog aria-labelledby="reply-title" (close)="onDialogClosed()">
      @if (pending(); as c) {
        <h2 id="reply-title">{{ c === 'ask' ? DAY2.dialog.headingAsk : DAY2.dialog.headingDefault }}</h2>
        <p>{{ DAY2.dialog.response[c] }}</p>
        <div class="flex gap-2.5 items-center flex-wrap mt-5">
          <button type="button" #replyBack (click)="closeReply()">{{ DAY2.dialog.back }}</button>
          <button type="button" class="btn-primary" (click)="confirmReply()">{{ DAY2.dialog.finish }}</button>
        </div>
      }
    </dialog>
  `,
})
export class Day2ReconcileComponent {
  protected readonly game = inject(GameStateService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly DAY2 = DAY2;

  private readonly replyDialog = viewChild.required<ElementRef<HTMLDialogElement>>('replyDialog');
  private readonly replyBack = viewChild<ElementRef<HTMLButtonElement>>('replyBack');

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

  /** 對話框中待確認的回覆；null＝對話框關閉、不渲染內文。 */
  protected readonly pending = signal<Reply | null>(null);
  /** 開啟對話框的按鈕；關閉後把焦點還回去。 */
  private trigger: HTMLElement | null = null;

  protected openReply(choice: Reply, event: Event): void {
    if (!this.game.canReply(choice)) return;
    this.trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.pending.set(choice);
    // 先同步刷新，讓 @if 內容進入 DOM，再開啟對話框並把焦點放到「返回核對」。
    this.cdr.detectChanges();
    const dialog = this.replyDialog().nativeElement;
    if (!dialog.open) dialog.showModal();
    this.replyBack()?.nativeElement.focus();
  }

  protected closeReply(): void {
    this.replyDialog().nativeElement.close();
  }

  protected confirmReply(): void {
    const c = this.pending();
    if (c && this.game.submitReply(c)) {
      this.trigger = null;
      this.replyDialog().nativeElement.close();
      this.router.navigateByUrl('/end');
    }
  }

  /** 原生 close 事件（含 Escape）：清除待確認選項，並把焦點還給觸發按鈕。 */
  protected onDialogClosed(): void {
    this.pending.set(null);
    this.trigger?.focus();
    this.trigger = null;
  }
}
