import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DAY1 } from '../../content/text';
import { ValidationOk } from '../../core/types';
import { toPreview } from '../../core/validate';

/**
 * Day 1 驗證結果預覽與確認歸檔（KB-R4-02）。
 * 只把已通過驗證的結果轉成技術性 JSON 呈現，不做道德判斷、不自行提交；
 * 真正的歸檔（存檔副作用）留在容器經由 GameStateService 執行。
 */
@Component({
  selector: 'app-day1-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="preview">
      <p class="text-sm">{{ t.previewOk }}</p>
      <pre>{{ json() }}</pre>
      <div class="flex gap-2.5 items-center flex-wrap mt-5">
        <button type="button" class="btn-primary" (click)="confirm.emit()">{{ t.confirm }}</button>
      </div>
    </div>
  `,
})
export class Day1PreviewComponent {
  readonly preview = input.required<ValidationOk>();
  /** 玩家按下「確認歸檔」。 */
  readonly confirm = output<void>();

  protected readonly t = DAY1;

  protected readonly json = computed(() => JSON.stringify(toPreview(this.preview()), null, 2));
}
