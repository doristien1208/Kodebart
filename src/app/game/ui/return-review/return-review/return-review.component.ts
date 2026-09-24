import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { issueTaskText } from '../../../content/bundle';
import { DOCUMENT_ISSUES_UI, MAIL_UI, archiveProgress, deliverLabel } from '../../../content/text';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { routeForStage } from '../../../state/stage-route';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailNavigationService } from '../../mail/services/mail-navigation.service';
import { ReturnTaskRow, returnTaskRows } from '../presenters/return-task-view';

let reviewSeq = 0;

/**
 * 每日「錯誤文件處理」工作（task kind `return-review`，R10／R11／R12）：今天的工作佇列這一端。
 *
 * - 列出進入今天時排定的案件（game.activeReturns()）：案號、目前狀態、最新回條與是否已處理。
 * - 「開啟最新郵件」打開郵件應用、選取該案件最新回條的郵件並開啟附件文件——附件是唯一的修訂入口，
 *   這裡不再內嵌編輯；從郵件提前處理的案件，這裡依存檔直接顯示為已處理。
 * - 標題／eyebrow／說明取自 issueTaskText（內容定義的任務與狀態層插入的虛擬任務都適用）。
 * - 「本日處理已交付」≠「案件已解決」：排定的案件都已重送或轉待查就能交付，
 *   交付沿用「交付此項工作／完成今日交接」與 game.completeWork()；是否結案等下一工作日的下游回條。
 */
@Component({
  selector: 'app-return-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './return-review.component.html',
})
export class ReturnReviewComponent {
  protected readonly game = inject(GameStateService);
  private readonly router = inject(Router);
  private readonly mail = inject(MailNavigationService);

  protected readonly busy = inject(WorkOperationsService).busy;
  protected readonly ui = DOCUMENT_ISSUES_UI.task;
  protected readonly latestLabel = MAIL_UI.attachments;
  protected readonly receivedLabel = MAIL_UI.received;
  protected readonly idPrefix = `return-task-${++reviewSeq}`;

  /** 目前工作的畫面文字；不是錯誤文件處理時為 null（work view 不會掛上本元件）。 */
  protected readonly text = computed(() => {
    const t = this.game.task();
    return t?.kind === 'return-review' ? issueTaskText(t.id) : null;
  });

  protected readonly rows = computed<readonly ReturnTaskRow[]>(() => {
    const t = this.game.task();
    return t?.kind === 'return-review' ? returnTaskRows(this.game.activeReturns(), t.dayId, DAY_DIRECTORY) : [];
  });

  /** 已處理＝今天（或之後）已有處理版本（重送或轉待查），與交付條件相同；不等於已解決。 */
  protected readonly progressText = computed(() => {
    const rows = this.rows();
    return archiveProgress(rows.filter((r) => r.handled).length, rows.length);
  });

  /** 交付按鈕文字：當日還有其他工作 →「交付此項工作」；最後一項（或已離開 work）→「完成今日交接」。 */
  protected readonly deliverText = computed(() =>
    deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()),
  );

  /** 開啟該案件最新回條的郵件與附件（郵件應用＋附件視窗）。 */
  protected openLatest(caseId: string): void {
    this.mail.openLatestOfCase(caseId);
  }

  /** 交付：排定的案件都已處理（重送或轉待查）才可交付；依新 stage 導向。 */
  protected onDeliver(): void {
    if (this.busy() || !this.game.completeWork()) return;
    const stage = this.game.stage();
    void this.router.navigateByUrl(stage ? routeForStage(stage) : '/');
  }
}
