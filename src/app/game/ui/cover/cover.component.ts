import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { COVER, NEW_GAME_DIALOG, PHASE_LABEL, SETTINGS_DIALOG, pageTitle } from '../../content/text';
import { CoverAmbience } from '../../platform/cover-ambience';
import { SettingsService } from '../../platform/settings.service';
import { GameStateService } from '../../state/game-state.service';
import { routeForPhase } from '../../state/phase-route';

/** 背景圖的 object-position X（與樣式的 object-[65%_center] 一致）。 */
const ART_POSITION_X = 0.65;
const ART_POSITION_Y = 0.5;

/** 標題 glitch 的節奏：每隔 5–10 秒播放一次，單次 200–350ms。 */
const GLITCH_INTERVAL_MIN_MS = 5000;
const GLITCH_INTERVAL_MAX_MS = 10000;
const GLITCH_MIN_MS = 200;
const GLITCH_MAX_MS = 350;

/**
 * 開始頁（封面）：開始／繼續／設定。
 * 對應原型 cover()、newGame()、settings()、dialog()；文案全部來自 content/text.ts。
 */
@Component({
  selector: 'app-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #scene
      class="cover relative isolate flex min-h-svh items-center px-[7vw] pt-12 pb-28 md:pt-20 md:pb-24"
    >
      <img
        #art
        class="cover-art absolute inset-0 -z-30 h-full w-full object-cover object-[65%_center] [image-rendering:pixelated]"
        [src]="text.artSrc"
        [alt]="text.artAlt"
        (load)="onArtLoad()"
      />

      <!-- 環境動態：整組對齊背景圖的實際渲染範圍，clip 層負責不讓它溢出畫面 -->
      <div class="ambience-clip" aria-hidden="true">
        <div #ambience class="ambience">
          <canvas #rainCanvas class="rain-layer"></canvas>
          <div #corridorLight class="corridor-light"></div>
        </div>
      </div>

      <div class="cover-shade absolute inset-0 -z-20" aria-hidden="true"></div>

      <div class="cover-content w-full max-w-[36rem]">
        <div class="cover-rule mb-4 h-[3px] w-12 bg-primary" aria-hidden="true"></div>
        <div class="eyebrow">{{ text.eyebrow }}</div>
        <h1
          class="cover-title"
          [class.is-glitching]="glitchActive()"
          [style.--kb-glitch-duration]="glitchDuration()"
          [attr.data-text]="text.title"
        >{{ text.title }}</h1>
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

    <dialog #newGameDialog aria-labelledby="cover-new-game-heading" (close)="restoreFocus()">
      <h2 id="cover-new-game-heading">{{ newGameText.heading }}</h2>
      <p>{{ newGameText.body }}</p>
      <div class="actions mt-5 flex flex-wrap items-center gap-2.5">
        <button type="button" #keepBtn (click)="closeNewGame()">{{ newGameText.keep }}</button>
        <button type="button" class="btn-primary" (click)="confirmNewGame()">{{ newGameText.start }}</button>
      </div>
    </dialog>

    <dialog #settingsDialog aria-labelledby="cover-settings-heading" (close)="restoreFocus()">
      <h2 id="cover-settings-heading">{{ settingsText.heading }}</h2>
      <label class="flex gap-3 py-4">
        <input type="checkbox" class="accent-primary" [checked]="settings.motion()" (change)="onMotionChange($event)" />
        <span>{{ settingsText.motionLabel }}</span>
      </label>
      <p class="text-sm text-muted">{{ settingsText.note }}</p>
      <div class="actions mt-5 flex flex-wrap items-center gap-2.5">
        <button type="button" #backBtn class="btn-primary" (click)="closeSettings()">{{ settingsText.back }}</button>
      </div>
    </dialog>
  `,
  styles: `
    /*
     * 環境動態層。整組以 mix-blend-mode: screen 疊加，因此 clip 層本身不能再被
     * 子層建立的堆疊環境隔開——blend 對象是下方的背景圖（z-index -30）。
     */
    .ambience-clip {
      position: absolute;
      inset: 0;
      overflow: hidden;
      z-index: -25;
      mix-blend-mode: screen;
      pointer-events: none;
    }
    /* 由 TS 依 object-fit: cover 的實際結果設定 left/top/width/height */
    .ambience {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
    }
    /* 落雨只在右側窗外：背景圖座標的 x 80–100%、y 0–55% */
    .rain-layer {
      position: absolute;
      left: 80%;
      top: 0;
      width: 20%;
      height: 55%;
      /* 供 TS 以 getComputedStyle(canvas).color 取得已解析的色票 */
      color: color-mix(in srgb, var(--color-primary) 45%, var(--color-text));
    }
    /* 燈光只在走廊亮框：背景圖座標的 x 62–74%、y 28–55% */
    .corridor-light {
      position: absolute;
      left: 62%;
      top: 28%;
      width: 12%;
      height: 27%;
      opacity: 0;
      filter: blur(10px);
      background: radial-gradient(
        ellipse at 50% 45%,
        color-mix(in srgb, var(--color-primary) 55%, transparent),
        color-mix(in srgb, var(--color-primary) 18%, transparent) 45%,
        transparent 72%
      );
    }
    /* 關閉動態時排程已停止，這裡再收掉殘影 */
    :host-context(body.no-motion) .ambience-clip {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .ambience-clip {
        display: none;
      }
    }

    /* 對應原型 .cover-shade：左→右暗色漸層；手機改整片半透明 */
    .cover-shade {
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--color-shade) 84%, transparent),
        color-mix(in srgb, var(--color-shade) 30%, transparent) 46%,
        transparent 75%
      );
    }
    h1 {
      font-size: clamp(3rem, 6.6vw, 6rem);
      line-height: 1.18;
      letter-spacing: .16em;
      text-shadow: 3px 3px 0 var(--color-elevated);
      margin: 1.1rem 0;
    }

    /* 標題 glitch：字體、位置與大小不變，只在播放期間疊上兩層帶狀複本。 */
    .cover-title {
      position: relative;
      display: inline-block;
    }
    .cover-title::before,
    .cover-title::after {
      content: attr(data-text);
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      pointer-events: none;
      text-shadow: none;
      opacity: 0;
    }
    /* 青色色差層 */
    .cover-title.is-glitching::before {
      opacity: .85;
      color: var(--color-primary);
      animation: kb-glitch-cyan var(--kb-glitch-duration, 280ms) steps(3, end) both;
    }
    /* 同色錯位層 */
    .cover-title.is-glitching::after {
      opacity: .7;
      color: var(--color-text);
      animation: kb-glitch-shift var(--kb-glitch-duration, 280ms) steps(3, end) both;
    }
    /* 頭尾以 inset(0 0 100% 0) 完全裁掉，播放前後都看不見 */
    @keyframes kb-glitch-cyan {
      0%, 100% { clip-path: inset(0 0 100% 0); transform: translateX(0); }
      20% { clip-path: inset(14% 0 62% 0); transform: translateX(-3px); }
      45% { clip-path: inset(46% 0 34% 0); transform: translateX(2px); }
      70% { clip-path: inset(70% 0 12% 0); transform: translateX(-2px); }
      90% { clip-path: inset(30% 0 54% 0); transform: translateX(1px); }
    }
    @keyframes kb-glitch-shift {
      0%, 100% { clip-path: inset(0 0 100% 0); transform: translateX(0); }
      25% { clip-path: inset(56% 0 26% 0); transform: translateX(3px); }
      55% { clip-path: inset(22% 0 60% 0); transform: translateX(-1px); }
      80% { clip-path: inset(64% 0 18% 0); transform: translateX(2px); }
    }
    /* 關閉動態或系統要求減少動態時完全停用（排程本身也會停止） */
    :host-context(body.no-motion) .cover-title::before,
    :host-context(body.no-motion) .cover-title::after {
      animation: none;
      opacity: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .cover-title::before,
      .cover-title::after {
        animation: none !important;
        opacity: 0 !important;
      }
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
    :host-context(body.no-motion) .cover-menu button::before {
      animation: none;
    }
    @media (max-width: 699.98px) {
      .cover-shade {
        background: color-mix(in srgb, var(--color-shade) 65%, transparent);
      }
      h1 {
        letter-spacing: .1em;
      }
    }
    @media (forced-colors: active) {
      .cover-art,
      .ambience-clip {
        display: none;
      }
      .cover-shade {
        background: Canvas;
      }
    }
  `,
})
export class CoverComponent implements AfterViewInit {
  protected readonly game = inject(GameStateService);
  protected readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly text = COVER;
  protected readonly newGameText = NEW_GAME_DIALOG;
  protected readonly settingsText = SETTINGS_DIALOG;

  private readonly newGameDialog = viewChild.required<ElementRef<HTMLDialogElement>>('newGameDialog');
  private readonly settingsDialog = viewChild.required<ElementRef<HTMLDialogElement>>('settingsDialog');
  private readonly startBtn = viewChild.required<ElementRef<HTMLButtonElement>>('startBtn');
  private readonly settingsBtn = viewChild.required<ElementRef<HTMLButtonElement>>('settingsBtn');
  private readonly keepBtn = viewChild.required<ElementRef<HTMLButtonElement>>('keepBtn');
  private readonly backBtn = viewChild.required<ElementRef<HTMLButtonElement>>('backBtn');

  private readonly scene = viewChild.required<ElementRef<HTMLElement>>('scene');
  private readonly art = viewChild.required<ElementRef<HTMLImageElement>>('art');
  private readonly ambience = viewChild.required<ElementRef<HTMLDivElement>>('ambience');
  private readonly rainCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('rainCanvas');
  private readonly corridorLight = viewChild.required<ElementRef<HTMLDivElement>>('corridorLight');

  /** 開啟目前對話框的選單按鈕；對話框關閉後把焦點還給它。 */
  private opener: HTMLElement | null = null;

  /** 選單下方提示：有存檔顯示 phase 標籤，否則「尚無本機紀錄」。 */
  protected readonly saveHelp = computed(() => {
    const phase = this.game.phase();
    return phase ? COVER.savePrefix + PHASE_LABEL[phase] : COVER.noSave;
  });

  /** 標題 glitch 是否正在播放；只影響 h1，不影響其他 UI 或按鈕操作。 */
  protected readonly glitchActive = signal(false);
  /** 本次播放長度，透過 CSS 變數餵給動畫。 */
  protected readonly glitchDuration = signal(`${GLITCH_MIN_MS}ms`);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 背景圖尺寸已知且 view 已就緒後才開始環境動態。 */
  private readonly ambienceReady = signal(false);
  /** 分頁隱藏時暫停繪圖迴圈，不在背景耗電。 */
  private readonly pageHidden = signal(false);
  private engine: CoverAmbience | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** 目前「應該」播放與否；實際啟動還需要引擎已取得非零尺寸。 */
  private ambienceWanted = false;

  constructor() {
    inject(Title).setTitle(pageTitle(COVER.docTitle));

    this.destroyRef.onDestroy(() => this.clearTimer());

    // 設定關閉動態或系統要求減少動態時，停止排程並立即收起效果。
    effect(() => {
      const enabled = this.settings.animationsEnabled();
      this.clearTimer();
      if (!enabled) {
        this.glitchActive.set(false);
        return;
      }
      this.scheduleGlitch();
    });

    // 環境動態（雨／燈光）：停用時真的取消 rAF，不是只隱藏畫面。
    effect(() => {
      this.ambienceWanted =
        this.settings.animationsEnabled() && this.ambienceReady() && !this.pageHidden();
      this.applyAmbienceRunState();
    });

    const view = this.document.defaultView;
    if (view) {
      const onVisibility = () => this.pageHidden.set(this.document.visibilityState === 'hidden');
      this.document.addEventListener('visibilitychange', onVisibility);
      this.destroyRef.onDestroy(() => this.document.removeEventListener('visibilitychange', onVisibility));
    }
  }

  ngAfterViewInit(): void {
    const canvas = this.rainCanvas().nativeElement;
    this.engine = new CoverAmbience(canvas, this.corridorLight().nativeElement);

    const view = this.document.defaultView;
    if (view && 'ResizeObserver' in view) {
      this.resizeObserver = new ResizeObserver(() => this.layoutAmbience());
      this.resizeObserver.observe(this.scene().nativeElement);
    }

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.engine?.destroy();
      this.engine = null;
    });

    // 圖片可能在 view 就緒前就載入完成，(load) 不會再觸發
    if (this.art().nativeElement.complete) this.onArtLoad();
  }

  /** 背景圖尺寸確定後才能推算窗戶與走廊的實際位置。 */
  protected onArtLoad(): void {
    this.layoutAmbience();
    this.ambienceReady.set(true);
  }

  /**
   * 依 object-fit: cover 的結果把動態層對齊背景圖，讓窗戶與走廊的百分比座標
   * 在任何視窗比例下都落在正確位置。
   */
  private layoutAmbience(): void {
    const engine = this.engine;
    if (!engine) return;
    const scene = this.scene().nativeElement;
    const art = this.art().nativeElement;
    const cw = scene.clientWidth;
    const ch = scene.clientHeight;
    const nw = art.naturalWidth;
    const nh = art.naturalHeight;
    if (!cw || !ch || !nw || !nh) return;

    const scale = Math.max(cw / nw, ch / nh);
    const width = nw * scale;
    const height = nh * scale;
    const layer = this.ambience().nativeElement;
    layer.style.left = `${(cw - width) * ART_POSITION_X}px`;
    layer.style.top = `${(ch - height) * ART_POSITION_Y}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;

    const canvas = this.rainCanvas().nativeElement;
    const view = this.document.defaultView;
    engine.setColor(view ? view.getComputedStyle(canvas).color : '');
    engine.resize(canvas.clientWidth, canvas.clientHeight, view?.devicePixelRatio ?? 1);
    // 面板一開始可能是 0 寬（引擎不會啟動），取得實際尺寸後要補啟動
    this.applyAmbienceRunState();
  }

  private applyAmbienceRunState(): void {
    const engine = this.engine;
    if (!engine) return;
    if (this.ambienceWanted) engine.start();
    else engine.stop();
  }

  /** 每隔隨機 5–10 秒播放一次。 */
  private scheduleGlitch(): void {
    const delay = GLITCH_INTERVAL_MIN_MS + Math.random() * (GLITCH_INTERVAL_MAX_MS - GLITCH_INTERVAL_MIN_MS);
    this.timer = setTimeout(() => this.playGlitch(), delay);
  }

  /** 單次播放約 200–350ms，結束後排下一次。 */
  private playGlitch(): void {
    const duration = Math.round(GLITCH_MIN_MS + Math.random() * (GLITCH_MAX_MS - GLITCH_MIN_MS));
    this.glitchDuration.set(`${duration}ms`);
    this.glitchActive.set(true);
    this.timer = setTimeout(() => {
      this.glitchActive.set(false);
      this.scheduleGlitch();
    }, duration);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 開始遊戲：已有紀錄（或讀取失敗）時先確認覆蓋，預設焦點放「保留目前紀錄」。 */
  protected onStart(): void {
    if (this.game.needsOverwriteConfirm()) {
      this.openDialog(this.newGameDialog(), this.keepBtn(), this.startBtn());
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
    this.openDialog(this.settingsDialog(), this.backBtn(), this.settingsBtn());
  }

  protected closeNewGame(): void {
    this.newGameDialog().nativeElement.close();
  }

  protected confirmNewGame(): void {
    this.newGameDialog().nativeElement.close();
    this.startNewGame();
  }

  protected closeSettings(): void {
    this.settingsDialog().nativeElement.close();
  }

  protected onMotionChange(event: Event): void {
    this.settings.setMotion((event.target as HTMLInputElement).checked);
  }

  /** 原生 dialog 的 close 事件（含 Escape）：焦點還給觸發按鈕。 */
  protected restoreFocus(): void {
    this.opener?.focus();
    this.opener = null;
  }

  private openDialog(
    dialog: ElementRef<HTMLDialogElement>,
    focusTarget: ElementRef<HTMLButtonElement>,
    opener: ElementRef<HTMLButtonElement>,
  ): void {
    this.opener = opener.nativeElement;
    dialog.nativeElement.showModal();
    focusTarget.nativeElement.focus();
  }

  private startNewGame(): void {
    this.game.newGame();
    void this.router.navigateByUrl('/work');
  }
}
