import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ONBOARDING_UI } from '../../../content/text';
import { splitGraphemes } from '../presenters/onboarding-text';

/** 事件目標是可輸入的欄位時，按鍵屬於該欄位，不推進前情。 */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * 入職前情的一段旁白（R12 §6）：逐字呈現（每個使用者可見字元 intervalMs）。
 *
 * - 點擊畫面／Enter／Space：打字中 → 立即顯示整段；已完整 → 發出 advance（由父元件前進到下一段）。
 * - animate 為 false（關閉動態或系統減少動態）時整段直接顯示，仍由玩家逐段前進。
 * - 每段由父元件以新的實例呈現；timer 隨元件銷毀停止。長按按鍵（repeat）與輸入法組字不推進。
 * - 尚未出現的字以 visibility:hidden 佔位，版面不隨打字跳動；逐字的畫面文字對輔助技術隱藏，
 *   完整文字由父元件常駐的 live region 播報一次。
 */
@Component({
  selector: 'app-onboarding-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding-line.component.html',
  styleUrl: './onboarding-line.component.css',
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(document:keyup)': 'onKeyup($event)',
  },
})
export class OnboardingLineComponent {
  readonly text = input.required<string>();
  readonly intervalMs = input.required<number>();
  readonly animate = input.required<boolean>();
  /** 已完整顯示後再次點擊／按鍵：前進到下一段。 */
  readonly advance = output<void>();

  protected readonly ui = ONBOARDING_UI;

  private readonly graphemes = computed(() => splitGraphemes(this.text()));
  private readonly shown = signal(0);
  protected readonly typed = computed(() => this.graphemes().slice(0, this.shown()).join(''));
  protected readonly rest = computed(() => this.graphemes().slice(this.shown()).join(''));
  protected readonly revealed = computed(() => this.shown() >= this.graphemes().length);

  private readonly hint = viewChild.required<ElementRef<HTMLButtonElement>>('hint');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 動態允許才逐字；途中關閉動態就直接補完（已完整的段落不會因重新開啟而重打）
    effect(() => {
      const total = this.graphemes().length;
      const animate = this.animate();
      untracked(() => {
        if (!animate) this.reveal();
        else if (this.shown() < total) this.start(total);
      });
    });
    // 每段開始時把焦點放在繼續提示（鍵盤與讀屏使用者有明確的操作目標）
    afterNextRender(() => this.hint().nativeElement.focus({ preventScroll: true }));
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** 點擊畫面或繼續提示：打字中先補完，已完整才前進。 */
  protected activate(): void {
    if (!this.revealed()) this.reveal();
    else this.advance.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.isAdvanceKey(event)) return;
    // 取消預設動作：焦點在繼續提示上時不再由原生按鈕觸發第二次，Space 也不捲動畫面
    event.preventDefault();
    if (event.repeat || event.isComposing) return;
    this.activate();
  }

  /** Space 的原生按鈕觸發在 keyup；一併取消，確保一次按鍵只推進一次。 */
  protected onKeyup(event: KeyboardEvent): void {
    if (event.key === ' ' && this.isAdvanceKey(event)) event.preventDefault();
  }

  private isAdvanceKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter' && event.key !== ' ') return false;
    if (event.altKey || event.ctrlKey || event.metaKey || event.keyCode === 229) return false;
    return !isEditable(event.target);
  }

  private start(total: number): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const next = this.shown() + 1;
      this.shown.set(next);
      if (next >= total) this.stop();
    }, this.intervalMs());
  }

  private reveal(): void {
    this.stop();
    this.shown.set(this.graphemes().length);
  }

  private stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
