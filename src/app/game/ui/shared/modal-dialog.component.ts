import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';

let dialogSeq = 0;

/**
 * 原生 <dialog> 的共用外殼，集中處理焦點責任（KB-R4-02）。
 *
 * - 開啟時把焦點放到標了 `data-initial-focus` 的元素，否則第一顆按鈕。
 * - 關閉（含 Escape 的原生 cancel → close）時把焦點還給開啟它的元素。
 * 內容以投影傳入：`[dialogBody]` 為內文，`[dialogActions]` 為按鈕列。
 */
@Component({
  selector: 'app-modal-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog [attr.aria-labelledby]="headingId()" (close)="onClose()">
      <h2 [id]="headingId()">{{ heading() }}</h2>
      <ng-content select="[dialogBody]" />
      <div class="actions mt-5 flex flex-wrap items-center gap-2.5">
        <ng-content select="[dialogActions]" />
      </div>
    </dialog>
  `,
})
export class ModalDialogComponent {
  readonly heading = input.required<string>();
  /** 對話框關閉後發出，讓呼叫端清理暫存狀態。 */
  readonly closed = output<void>();

  protected readonly headingId = computed(() => `modal-heading-${this.seq}`);
  private readonly seq = ++dialogSeq;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private opener: HTMLElement | null = null;

  /** 開啟對話框；傳入觸發元素以便關閉後還原焦點。 */
  open(opener?: HTMLElement | null): void {
    this.opener = opener ?? null;
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal();
    const target =
      el.querySelector<HTMLElement>('[data-initial-focus]') ?? el.querySelector<HTMLElement>('button');
    target?.focus();
  }

  close(): void {
    const el = this.dialog().nativeElement;
    if (el.open) el.close();
  }

  protected onClose(): void {
    this.opener?.focus();
    this.opener = null;
    this.closed.emit();
  }
}
