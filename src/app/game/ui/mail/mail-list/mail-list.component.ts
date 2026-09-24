import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { MAIL_UI } from '../../../content/text';
import { MAIL_FILTERS, MailFilter, MailView } from '../presenters/mail-view';

let listSeq = 0;

/**
 * 郵件收件清單（R12 §3）：收件匣標題、三個篩選（全部郵件／未讀／待處理＋件數）與信件列（新的在前）。
 *
 * 純呈現元件：只吃 input、吐 output，不注入狀態服務。每列顯示寄件者、收到時間、主旨，
 * 未讀與待處理各有文字標籤（不只靠顏色）。選取的那列 aria-current；選取改變時捲到看得見（不搶焦點）。
 */
@Component({
  selector: 'app-mail-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './mail-list.component.html',
  styleUrl: './mail-list.component.css',
})
export class MailListComponent {
  /** 目前篩選下要列出的信件（已排序）。 */
  readonly rows = input.required<readonly MailView[]>();
  readonly counts = input.required<Readonly<Record<MailFilter, number>>>();
  readonly filter = input.required<MailFilter>();
  readonly selectedId = input<string | null>(null);

  readonly select = output<string>();
  readonly filterChange = output<MailFilter>();

  protected readonly t = MAIL_UI;
  protected readonly filters = MAIL_FILTERS;
  protected readonly headingId = `mail-inbox-${++listSeq}`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  constructor() {
    // 選取改變（例如從當日工作開啟最新郵件）時把該列捲進清單可見範圍；不移動焦點
    effect(() => {
      const id = this.selectedId();
      if (!id) return;
      untracked(() =>
        afterNextRender(
          () => {
            const row = this.rowButton(id);
            if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
          },
          { injector: this.injector },
        ),
      );
    });
  }

  protected filterLabel(filter: MailFilter): string {
    return this.t[filter];
  }

  protected emptyText(filter: MailFilter): string {
    switch (filter) {
      case 'all':
        return this.t.empty;
      case 'unread':
        return this.t.emptyUnread;
      case 'pending':
        return this.t.emptyPending;
    }
  }

  /** 容器在窄視窗返回清單時把焦點放回原本那列（不在清單中時放到收件匣標題）。 */
  focusRow(id: string | null): void {
    const target = (id ? this.rowButton(id) : null) ?? this.host.querySelector<HTMLElement>(`#${this.headingId}`);
    target?.focus();
  }

  private rowButton(id: string): HTMLElement | null {
    return Array.from(this.host.querySelectorAll<HTMLElement>('[data-mail-row]')).find((el) => el.dataset['mailRow'] === id) ?? null;
  }
}
