import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ARCHIVE_UI } from '../../../content/text';
import { ValidationOk } from '../../../core/types';
import { archivedRefusalStatus } from '../../shared/presenters/record-status';

/** 預覽的三列摘要：全部是玩家可讀的文字。 */
export interface ArchiveSummary {
  code: string;
  status: string;
  destination: string;
}

/** 通過驗證的結果 → 三列摘要（R7 §6.2）；不輸出 JSON、不顯示 true／false／null。 */
export function archiveSummary(result: ValidationOk): ArchiveSummary {
  return {
    code: result.code,
    status: archivedRefusalStatus(result),
    destination: result.origin === 'review' ? ARCHIVE_UI.destinationReview : ARCHIVE_UI.destinationArchive,
  };
}

/**
 * 歸檔驗證結果預覽與確認歸檔（R6-01；各歸檔日共用）。
 * 只把已通過驗證的結果轉成三列摘要（人員編號、拒絕狀態、資料去向），不做道德判斷、不自行提交；
 * 真正的歸檔（存檔副作用）留在容器經由 GameStateService 執行。
 */
@Component({
  selector: 'app-archive-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './archive-preview.component.html',
})
export class ArchivePreviewComponent {
  readonly preview = input.required<ValidationOk>();
  /** 有提交處理中：停用確認（連點只送出一次）。 */
  readonly busy = input(false);
  /** 玩家按下「確認歸檔」。 */
  readonly confirm = output<void>();

  protected readonly t = ARCHIVE_UI;

  protected readonly summary = computed(() => archiveSummary(this.preview()));
}
