import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';
import { CASE_REVIEW_UI, WORKDAY_UI } from '../../../content/text';
import { HandoffView } from '../presenters/handoff';

/**
 * 本日交接面板（M1 §3）：交付清單與留待下一工作日的項目；按「完成本日交接」才交付最後一件並離開桌面。
 * 純呈現元件；打開時把焦點移到標題。
 */
@Component({
  selector: 'app-handoff-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './handoff-panel.component.html',
  styleUrl: './handoff-panel.component.css',
})
export class HandoffPanelComponent {
  readonly view = input.required<HandoffView>();
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  protected readonly ui = WORKDAY_UI;
  protected readonly back = CASE_REVIEW_UI.closeLabel;

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    afterNextRender(() => this.heading()?.nativeElement.focus());
  }
}
