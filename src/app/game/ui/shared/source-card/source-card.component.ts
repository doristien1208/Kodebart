import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SOURCE_CARD } from '../../../content/text';
import { SourceRecord } from '../../../core/types';
import { sourceRefusalStatus } from '../presenters/record-status';

let sourceCardSeq = 0;

/**
 * 來源資料卡（原型 sourceInfo()）：只呈現送來的資料，不做任何判斷。
 * 適用拒絕紀錄的紀錄在拒絕紀錄前多一列安排項目（R12），說明這個欄位記的是哪一項安排；不適用者不顯示。
 * 適用但來源未附（值為「未提供」）時，清單後接一行 muted 說明，並以 aria-describedby 連到拒絕紀錄的值（R12）；
 * 值本身不改，已拒絕／未拒絕／不適用不顯示說明。
 * 樣式全部來自 styles.css 的 .source／.eyebrow 與 Tailwind utility。
 */
@Component({
  selector: 'app-source-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './source-card.component.html',
})
export class SourceCardComponent {
  readonly record = input.required<SourceRecord>();

  protected readonly t = SOURCE_CARD;

  /** 缺漏說明的 id（同一頁可能不只一張來源卡）。 */
  protected readonly missingNoteId = `source-missing-note-${++sourceCardSeq}`;

  /** 來源未登記姓名時顯示「未登記」，不代表這個人沒有名字。 */
  protected readonly nameText = computed(() => this.record().name ?? SOURCE_CARD.nameUnregistered);

  /** 不適用／已拒絕／未拒絕／未提供，一律用 recordStatus 文字（R7 §6.2），不顯示 true／false／null。 */
  protected readonly refusalText = computed(() => sourceRefusalStatus(this.record()));

  /** 適用拒絕紀錄但來源未附（未提供）：拒絕紀錄的值後接缺漏說明（R12）。 */
  protected readonly refusalMissing = computed(() => {
    const r = this.record();
    return r.refusalApplies && r.refusal === null;
  });
}
