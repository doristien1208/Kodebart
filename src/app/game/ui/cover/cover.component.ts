import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { COVER, NEW_GAME_DIALOG, PHASE_LABEL, SETTINGS_DIALOG, pageTitle } from '../../content/text';
import { SettingsService } from '../../platform/settings.service';
import { GameStateService } from '../../state/game-state.service';
import { routeForPhase } from '../../state/phase-route';
import { ModalDialogComponent } from '../shared/modal-dialog.component';
import { CoverSceneComponent } from './cover-scene.component';
import { CoverTitleComponent } from './cover-title.component';

/**
 * 開始頁（KB-R4-02 後）：只負責頁面協調——導航、新遊戲流程與設定。
 * 場景動畫（背景圖、雨、走廊燈光）屬 CoverSceneComponent，
 * 標題 glitch 屬 CoverTitleComponent，對話框焦點屬 ModalDialogComponent。
 */
@Component({
  selector: 'app-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CoverSceneComponent, CoverTitleComponent, ModalDialogComponent],
  template: `
    <section class="cover relative isolate flex min-h-svh items-center px-[7vw] pt-12 pb-28 md:pt-20 md:pb-24">
      <app-cover-scene class="-z-30" />
      <div class="cover-shade absolute inset-0 -z-20" aria-hidden="true"></div>

      <div class="cover-content w-full max-w-[36rem]">
        <div class="cover-rule mb-4 h-[3px] w-12 bg-primary" aria-hidden="true"></div>
        <div class="eyebrow">{{ text.eyebrow }}</div>
        <app-cover-title [text]="text.title" />
        <p class="subtitle font-mono text-muted">{{ text.subtitle }}</p>

        <div class="cover-menu mt-8 grid w-72 max-w-full gap-[.55rem] md:mt-14">
          <button type="button" #startBtn (click)="onStart()">{{ text.start }}</button>
          <button type="button" [disabled]="!game.hasSave()" (click)="onContinue()">{{ text.continue }}</button>
          <button type="button" #settingsBtn (click)="openSettings()">{{ text.settings }}</button>
        </div>
        <p class="menu-help mt-3 text-[.8rem] text-muted">{{ saveHelp() }}</p>
        @if (game.storageIssue(); as issue) {
          <p role="status" class="text-sm">{{ issue }}</p>
        }
      </div>

      <footer
        class="cover-bottom absolute right-[4vw] bottom-6 left-[7vw] flex flex-col justify-between gap-4 text-[.8rem] text-muted md:flex-row"
      >
        <span>{{ text.footerLeft }}</span>
        <span class="font-mono">{{ text.footerRight }}</span>
      </footer>
    </section>

    <app-modal-dialog #newGameDialog [heading]="newGameText.heading">
      <p dialogBody>{{ newGameText.body }}</p>
      <button dialogActions type="button" data-initial-focus (click)="newGameDialog.close()">
        {{ newGameText.keep }}
      </button>
      <button dialogActions type="button" class="btn-primary" (click)="confirmNewGame()">
        {{ newGameText.start }}
      </button>
    </app-modal-dialog>

    <app-modal-dialog #settingsDialog [heading]="settingsText.heading">
      <div dialogBody>
        <label class="flex gap-3 py-4">
          <input type="checkbox" class="accent-primary" [checked]="settings.motion()" (change)="onMotionChange($event)" />
          <span>{{ settingsText.motionLabel }}</span>
        </label>
        <p class="text-sm text-muted">{{ settingsText.note }}</p>
      </div>
      <button dialogActions type="button" class="btn-primary" data-initial-focus (click)="settingsDialog.close()">
        {{ settingsText.back }}
      </button>
    </app-modal-dialog>
  `,
  styles: `
    /* 對應原型 .cover-shade：左→右暗色漸層；手機改整片半透明 */
    .cover-shade {
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--color-shade) 84%, transparent),
        color-mix(in srgb, var(--color-shade) 30%, transparent) 46%,
        transparent 75%
      );
    }
    .subtitle {
      font-size: clamp(.8rem, 1.25vw, 1rem);
      line-height: 1.8;
      letter-spacing: .27em;
    }
    .cover-menu button {
      padding: .7rem 1rem;
      letter-spacing: .12em;
      border-color: transparent;
      background: color-mix(in srgb, var(--color-background) 67%, transparent);
    }
    .cover-menu button:first-child {
      border-color: var(--color-primary);
      background: color-mix(in srgb, var(--color-elevated) 85%, transparent);
    }
    /* 元件樣式不在 @layer 內，會壓過全域 base 的 hover，故在此重申 */
    .cover-menu button:hover:not(:disabled) {
      border-color: var(--color-primary);
      background: var(--color-elevated);
    }
    /* 未停用按鈕前有「›」游標（低強度脈動）；停用按鈕以同寬空白佔位 */
    .cover-menu button::before {
      content: ' ';
      display: inline-block;
      width: 2rem;
    }
    .cover-menu button:not(:disabled)::before {
      content: '›';
      color: var(--color-primary);
      animation: kb-pulse 3s steps(2, end) infinite;
    }
    :host-context(body.no-motion) .cover-menu button::before { animation: none; }
    @media (max-width: 699.98px) {
      .cover-shade {
        background: color-mix(in srgb, var(--color-shade) 65%, transparent);
      }
    }
    @media (forced-colors: active) {
      .cover-shade { background: Canvas; }
    }
  `,
})
export class CoverComponent {
  protected readonly game = inject(GameStateService);
  protected readonly settings = inject(SettingsService);
  private readonly router = inject(Router);

  protected readonly text = COVER;
  protected readonly newGameText = NEW_GAME_DIALOG;
  protected readonly settingsText = SETTINGS_DIALOG;

  private readonly newGameDialog = viewChild.required<ModalDialogComponent>('newGameDialog');
  private readonly settingsDialog = viewChild.required<ModalDialogComponent>('settingsDialog');
  private readonly startBtn = viewChild.required<ElementRef<HTMLButtonElement>>('startBtn');
  private readonly settingsBtn = viewChild.required<ElementRef<HTMLButtonElement>>('settingsBtn');

  /** 選單下方提示：有存檔顯示 phase 標籤，否則「尚無本機紀錄」。 */
  protected readonly saveHelp = computed(() => {
    const phase = this.game.phase();
    return phase ? COVER.savePrefix + PHASE_LABEL[phase] : COVER.noSave;
  });

  constructor() {
    inject(Title).setTitle(pageTitle(COVER.docTitle));
  }

  /** 開始遊戲：已有紀錄（或讀取失敗）時先確認覆蓋，預設焦點放「保留目前紀錄」。 */
  protected onStart(): void {
    if (this.game.needsOverwriteConfirm()) {
      this.newGameDialog().open(this.startBtn().nativeElement);
      return;
    }
    this.startNewGame();
  }

  protected onContinue(): void {
    const save = this.game.save();
    if (!save) return;
    void this.router.navigateByUrl(routeForPhase(save.phase));
  }

  protected openSettings(): void {
    this.settingsDialog().open(this.settingsBtn().nativeElement);
  }

  protected confirmNewGame(): void {
    this.newGameDialog().close();
    this.startNewGame();
  }

  protected onMotionChange(event: Event): void {
    this.settings.setMotion((event.target as HTMLInputElement).checked);
  }

  private startNewGame(): void {
    this.game.newGame();
    void this.router.navigateByUrl('/work');
  }
}
