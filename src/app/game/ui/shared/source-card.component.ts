import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SOURCE_CARD } from '../../content/text';
import { SourceRecord } from '../../core/types';

/**
 * 來源資料卡（原型 sourceInfo()）：只呈現送來的資料，不做任何判斷。
 * 樣式全部來自 styles.css 的 .source／.eyebrow 與 Tailwind utility。
 */
@Component({
  selector: 'app-source-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="source">
      <div class="eyebrow">{{ t.eyebrow(record().key) }}</div>
      <dl>
        <dt>{{ t.name }}</dt>
        <dd>{{ nameText() }}</dd>
        <dt>{{ t.code }}</dt>
        <dd class="font-mono">{{ record().code }}</dd>
        <dt>{{ t.refusal }}</dt>
        <dd>{{ refusalText() }}</dd>
      </dl>
    </div>
  `,
})
export class SourceCardComponent {
  readonly record = input.required<SourceRecord>();

  protected readonly t = SOURCE_CARD;

  /** 來源未登記姓名時顯示「未登記」，不代表這個人沒有名字。 */
  protected readonly nameText = computed(() => this.record().name ?? SOURCE_CARD.nameUnregistered);

  protected readonly refusalText = computed(() => {
    const r = this.record();
    if (!r.refusalApplies) return SOURCE_CARD.refusalNA;
    return r.refusal === null ? SOURCE_CARD.refusalNull : SOURCE_CARD.refusalTrue;
  });
}
