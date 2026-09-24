import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SOURCE_CARD } from '../../../content/text';
import { SourceRecord } from '../../../core/types';
import { sourceRefusalStatus } from '../presenters/record-status';

/**
 * 來源資料卡（原型 sourceInfo()）：只呈現送來的資料，不做任何判斷。
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

  /** 來源未登記姓名時顯示「未登記」，不代表這個人沒有名字。 */
  protected readonly nameText = computed(() => this.record().name ?? SOURCE_CARD.nameUnregistered);

  /** 不適用／已拒絕／未拒絕／未提供，一律用 recordStatus 文字（R7 §6.2），不顯示 true／false／null。 */
  protected readonly refusalText = computed(() => sourceRefusalStatus(this.record()));
}
