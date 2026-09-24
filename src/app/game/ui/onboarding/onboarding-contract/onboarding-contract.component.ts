import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { OnboardingContractStep } from '../../../content/schema';
import { ONBOARDING_UI } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { signatureError } from '../presenters/onboarding-text';

let contractSeq = 0;

/**
 * 入職合約與簽名（R12 §6）：標題、條款、頁尾與署名欄一次一起顯示，不逐字。
 *
 * - 只有「同意並簽名」按鈕會送出；背景點擊與欄位內按鍵都不推進。不用 <form>，
 *   欄位內 Enter（含中文輸入法組字確認）不會觸發隱式送出。
 * - 名字規則同 core：去除首尾空白後必填、最多 maxGraphemes 個使用者可見字元（以字素計，不以 maxlength 硬切）；
 *   錯誤以文字＋aria-invalid 呈現。名字只以插值呈現，不當 HTML。
 * - 送出 → 顯示「正在保存簽名…」→ game.signContractStrict：ok＝存檔前進到下一段（父元件換成旁白）；
 *   failed＝保留輸入、顯示保存失敗與重試；noop＝顯示檢查訊息。
 */
@Component({
  selector: 'app-onboarding-contract',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './onboarding-contract.component.html',
  styleUrl: './onboarding-contract.component.css',
})
export class OnboardingContractComponent {
  private readonly game = inject(GameStateService);

  readonly step = input.required<OnboardingContractStep>();

  protected readonly ui = ONBOARDING_UI;
  protected readonly ids = (() => {
    const n = ++contractSeq;
    return { heading: `onboarding-contract-${n}`, input: `onboarding-signature-${n}`, error: `onboarding-signature-error-${n}` };
  })();

  protected readonly name = signal('');
  /** 按過送出之後才持續顯示「必填」；超過字數則輸入當下就提示。 */
  private readonly attempted = signal(false);
  /** 核心拒絕了本地檢查通過的名字（例如含控制字元）。 */
  private readonly rejected = signal(false);
  protected readonly state = signal<'idle' | 'signing' | 'failed'>('idle');

  private readonly validation = computed(() => signatureError(this.name(), this.step().signature));
  protected readonly errorText = computed(() => {
    const error = this.validation();
    const sig = this.step().signature;
    if (error === sig.tooLong) return error;
    if (this.attempted() && error !== null) return error;
    return this.rejected() ? sig.required : '';
  });

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // 合約出現時焦點放在標題，讀屏從合約開頭讀起；不直接聚焦欄位，避免手機鍵盤先遮住條款
    afterNextRender(() => this.heading().nativeElement.focus({ preventScroll: true }));
    inject(DestroyRef).onDestroy(() => {
      if (this.pending !== null) clearTimeout(this.pending);
    });
  }

  protected onInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.rejected.set(false);
    if (this.state() === 'failed') this.state.set('idle');
  }

  /** 「同意並簽名」與「重試」：檢查 → 顯示保存中 → 交易式簽名。 */
  protected submit(): void {
    if (this.state() === 'signing') return;
    this.attempted.set(true);
    if (this.validation() !== null) {
      this.field().nativeElement.focus();
      return;
    }
    this.state.set('signing');
    // 讓「正在保存簽名…」先呈現一次再寫入（本機儲存是同步的，不另加等待）
    this.pending = setTimeout(() => {
      this.pending = null;
      this.sign();
    });
  }

  private sign(): void {
    switch (this.game.signContractStrict(this.name())) {
      case 'ok':
        // 存檔已前進到簽名後的旁白；父元件依存檔換段，這個元件隨之銷毀
        this.state.set('idle');
        return;
      case 'failed':
        this.state.set('failed');
        return;
      case 'noop':
        this.state.set('idle');
        this.rejected.set(true);
        this.field().nativeElement.focus();
        return;
    }
  }
}
