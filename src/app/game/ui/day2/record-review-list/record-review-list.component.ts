import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NAME_UNREGISTERED } from '../../../content/records';
import { ARCHIVE_UI, CASE_REVIEW_UI, RECORD_REVIEW_UI, RETURNED_REVIEW_UI } from '../../../content/text';
import { RecordKey, ReviewDisposition } from '../../../core/types';

/** 逐筆審查清單的一列（容器從前一階段保存的提交推導）。 */
export interface RecordReviewItem {
  key: RecordKey;
  /** 姓名；來源未登記時為 null。 */
  name: string | null;
  /** 前一階段保存的送件編號（照玩家當時提交的原字串）。 */
  code: string;
  /** 原始來源的人員編號（提交快照中的來源），只在標為「原始來源」的欄位顯示。 */
  sourceCode: string;
  /** 目前的審查處置；null＝尚未審查。 */
  disposition: ReviewDisposition | null;
}

/** 某一筆改選了哪個處置。 */
export interface RecordReviewChange {
  key: RecordKey;
  disposition: ReviewDisposition;
}

/**
 * 核對的逐筆審查（R10）：每一筆顯示送件編號與標明的原始來源，並提供「核對後放行／保留待查」。
 *
 * 差異讓玩家自行比對：這裡不標示哪一筆「錯了」、不預選、兩種處置樣式相同；
 * 確認收到摘要不等於放行，因此回覆前每一筆都要有明確處置（由容器與狀態層把關）。
 * 回覆送出後鎖定，只顯示當時的處置。純呈現元件：不注入狀態服務、不讀寫 localStorage、不顯示內部 ID。
 */
@Component({
  selector: 'app-record-review-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './record-review-list.component.html',
})
export class RecordReviewListComponent {
  readonly items = input.required<readonly RecordReviewItem[]>();
  /** 已送出回覆：處置鎖定。 */
  readonly locked = input(false);
  /** 有提交處理中：暫停改動處置。 */
  readonly busy = input(false);

  readonly review = output<RecordReviewChange>();

  protected readonly t = RECORD_REVIEW_UI;
  protected readonly nameLabel = ARCHIVE_UI.nameLabel;
  protected readonly codeLabel = CASE_REVIEW_UI.codeLabel;
  protected readonly sourceLabel = RETURNED_REVIEW_UI.source;
  protected readonly unregistered = NAME_UNREGISTERED;

  protected statusText(disposition: ReviewDisposition | null): string {
    if (disposition === 'release') return RECORD_REVIEW_UI.statusReleased;
    if (disposition === 'hold') return RECORD_REVIEW_UI.statusHeld;
    return RECORD_REVIEW_UI.statusPending;
  }

  protected choose(key: RecordKey, disposition: ReviewDisposition): void {
    this.review.emit({ key, disposition });
  }
}
