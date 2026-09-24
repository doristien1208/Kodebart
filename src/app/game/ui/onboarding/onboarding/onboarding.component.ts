import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ONBOARDING } from '../../../content/bundle';
import { OnboardingContractStep, OnboardingLineStep } from '../../../content/schema';
import { COVER, onboardingLoggingIn } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { routeForSave } from '../../../state/stage-route';
import { OnboardingContractComponent } from '../onboarding-contract/onboarding-contract.component';
import { OnboardingLineComponent } from '../onboarding-line/onboarding-line.component';

/**
 * 新遊戲入職前情與簽名（R12 §6）：/onboarding（stageGuard：只有入職未完成的存檔會停在這裡）。
 *
 * - 目前段落完全由存檔 onboarding.step 決定：刷新從同一段重新開始（該段重新逐字），不重建 seed、不重複簽名。
 * - 旁白段交給 OnboardingLineComponent（每段一個新實例，timer 隨之結束）；合約段交給 OnboardingContractComponent。
 * - 最後一段之後 completeOnboarding → 登入狀態（「正在登入，{名字}。」）→ 預先載入桌面畫面的程式碼，
 *   載入完成才導向 routeForSave（/work）。登入中刷新時，stage guard 直接送到 /work。
 * - 黑底白字等呈現設定來自入職包 presentation，以 CSS 自訂屬性綁定（元件不寫色碼）。
 */
@Component({
  selector: 'app-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnboardingLineComponent, OnboardingContractComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
  host: {
    '[style.--onboarding-bg]': 'presentation.background',
    '[style.--onboarding-fg]': 'presentation.foreground',
  },
})
export class OnboardingComponent {
  private readonly game = inject(GameStateService);
  private readonly router = inject(Router);

  protected readonly presentation = ONBOARDING.presentation;
  protected readonly animate = inject(SettingsService).animationsEnabled;

  private readonly loggingIn = signal(false);
  private destroyed = false;

  private readonly step = computed(() => {
    const o = this.game.onboarding();
    return o && !o.complete ? (ONBOARDING.steps[o.step] ?? null) : null;
  });
  /** 目前的旁白段（0 或 1 個；以段落 id 追蹤，換段時建立新的逐字元件）。 */
  protected readonly lineStep = computed<readonly OnboardingLineStep[]>(() => {
    const s = this.step();
    return !this.loggingIn() && s?.kind === 'line' ? [s] : [];
  });
  protected readonly contractStep = computed<OnboardingContractStep | null>(() => {
    const s = this.step();
    return !this.loggingIn() && s?.kind === 'contract' ? s : null;
  });
  protected readonly showLogin = computed(() => this.loggingIn() || this.game.onboarding()?.complete === true);
  /** 登入提示；名字只以插值呈現。 */
  protected readonly loginText = computed(() => onboardingLoggingIn(this.game.displayName()));
  /** 給輔助技術的完整文字：目前旁白段或登入提示（合約段由標題焦點帶出）。 */
  protected readonly announcement = computed(() =>
    this.showLogin() ? this.loginText() : (this.lineStep()[0]?.text ?? ''),
  );

  constructor() {
    // 入職沒有獨立頁名：分頁標題只顯示遊戲名稱
    inject(Title).setTitle(COVER.title);
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // 已完成入職（例如登入中被直接掛載）就接著進桌面
    if (this.game.onboarding()?.complete) void this.enterDesktop();
  }

  /** 旁白已完整後再次點擊／按鍵：下一段；最後一段之後完成入職並登入。 */
  protected onLineAdvance(): void {
    const o = this.game.onboarding();
    if (!o || o.complete || this.loggingIn()) return;
    if (o.step >= ONBOARDING.steps.length - 1) {
      if (this.game.completeOnboarding()) void this.enterDesktop();
      return;
    }
    this.game.advanceOnboarding(o.step + 1);
  }

  /** 登入狀態 → 預先載入目標畫面（桌面）的 lazy chunk → 導向；載入失敗仍導向，由路由重新載入。 */
  private async enterDesktop(): Promise<void> {
    if (this.loggingIn()) return;
    this.loggingIn.set(true);
    const save = this.game.save();
    const target = save ? routeForSave(save) : '/';
    const route = this.router.config.find((r) => '/' + r.path === target);
    try {
      await route?.loadComponent?.();
    } catch {
      /* 導向時路由會再載入一次並處理錯誤 */
    }
    if (!this.destroyed) void this.router.navigateByUrl(target);
  }
}
