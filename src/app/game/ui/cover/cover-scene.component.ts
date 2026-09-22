import { DOCUMENT } from '@angular/common';
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
import { COVER } from '../../content/text';
import { ART_NATURAL, CoverAmbience, GLASS_BOUNDS } from '../../platform/cover-ambience';
import { SettingsService } from '../../platform/settings.service';

/** 背景圖的 object-position（與樣式的 object-[65%_center] 一致）。 */
const ART_POSITION_X = 0.65;
const ART_POSITION_Y = 0.5;

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

/**
 * 開始頁的場景層（KB-R4-02）：背景圖與環境動態。
 *
 * 這個元件獨佔繪圖迴圈與尺寸量測的生命週期，父元件只負責頁面協調。
 * 雨層對齊背景圖的實際渲染範圍，再由 CoverAmbience 依玻璃多邊形裁切，
 * 因此窗框與室內前景不會被雨線蓋過（KB-R4-01）。
 */
@Component({
  selector: 'app-cover-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <img
      #art
      class="cover-art absolute inset-0 h-full w-full object-cover object-[65%_center] [image-rendering:pixelated]"
      [src]="text.artSrc"
      [alt]="text.artAlt"
      (load)="onArtLoad()"
    />

    <div class="ambience-clip" aria-hidden="true">
      <div #ambience class="ambience">
        <canvas
          #rainCanvas
          class="rain-layer"
          [style.left]="rainRect().left"
          [style.top]="rainRect().top"
          [style.width]="rainRect().width"
          [style.height]="rainRect().height"
        ></canvas>
        <div #corridorLight class="corridor-light"></div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: absolute;
      inset: 0;
      overflow: hidden;
      /* 自成堆疊環境，讓動態層能與背景圖做 screen 混合 */
      isolation: isolate;
    }
    .cover-art { z-index: 0; }
    .ambience-clip {
      position: absolute;
      inset: 0;
      overflow: hidden;
      z-index: 1;
      mix-blend-mode: screen;
      pointer-events: none;
    }
    /* 由 TS 依 object-fit: cover 的實際結果設定 left/top/width/height */
    .ambience { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
    /* 位置與大小＝玻璃區外接矩形，實際形狀再由 canvas 裁切 */
    .rain-layer {
      position: absolute;
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
    :host-context(body.no-motion) .ambience-clip { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .ambience-clip { display: none; }
    }
    @media (forced-colors: active) {
      .cover-art,
      .ambience-clip { display: none; }
    }
  `,
})
export class CoverSceneComponent implements AfterViewInit {
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  protected readonly text = COVER;

  private readonly art = viewChild.required<ElementRef<HTMLImageElement>>('art');
  private readonly ambience = viewChild.required<ElementRef<HTMLDivElement>>('ambience');
  private readonly rainCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('rainCanvas');
  private readonly corridorLight = viewChild.required<ElementRef<HTMLDivElement>>('corridorLight');

  /** 雨層畫布在背景圖中的位置，直接由玻璃區外接矩形換算，避免兩處數字走鐘。 */
  protected readonly rainRect = computed(() => ({
    left: pct(GLASS_BOUNDS.x, ART_NATURAL.width),
    top: pct(GLASS_BOUNDS.y, ART_NATURAL.height),
    width: pct(GLASS_BOUNDS.width, ART_NATURAL.width),
    height: pct(GLASS_BOUNDS.height, ART_NATURAL.height),
  }));

  private readonly ready = signal(false);
  private readonly pageHidden = signal(false);
  private engine: CoverAmbience | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private wanted = false;

  constructor() {
    effect(() => {
      this.wanted = this.settings.animationsEnabled() && this.ready() && !this.pageHidden();
      this.applyRunState();
    });

    const onVisibility = () => this.pageHidden.set(this.document.visibilityState === 'hidden');
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => this.document.removeEventListener('visibilitychange', onVisibility));
  }

  ngAfterViewInit(): void {
    this.engine = new CoverAmbience(this.rainCanvas().nativeElement, this.corridorLight().nativeElement);

    const view = this.document.defaultView;
    if (view && 'ResizeObserver' in view) {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this.host.nativeElement);
    }

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.engine?.destroy();
      this.engine = null;
    });

    if (this.art().nativeElement.complete) this.onArtLoad();
  }

  protected onArtLoad(): void {
    this.layout();
    this.ready.set(true);
  }

  /** 依 object-fit: cover 的結果把動態層對齊背景圖。 */
  private layout(): void {
    const engine = this.engine;
    if (!engine) return;
    const el = this.host.nativeElement;
    const hostWidth = el.clientWidth;
    const hostHeight = el.clientHeight;
    const art = this.art().nativeElement;
    if (!hostWidth || !hostHeight || !art.naturalWidth || !art.naturalHeight) return;

    const scale = Math.max(hostWidth / art.naturalWidth, hostHeight / art.naturalHeight);
    const width = art.naturalWidth * scale;
    const height = art.naturalHeight * scale;
    const layer = this.ambience().nativeElement;
    layer.style.left = `${(hostWidth - width) * ART_POSITION_X}px`;
    layer.style.top = `${(hostHeight - height) * ART_POSITION_Y}px`;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;

    const canvas = this.rainCanvas().nativeElement;
    const view = this.document.defaultView;
    engine.setColor(view ? view.getComputedStyle(canvas).color : '');
    engine.resize(canvas.clientWidth, canvas.clientHeight, view?.devicePixelRatio ?? 1);
    // 面板一開始可能是 0 寬（引擎不會啟動），取得實際尺寸後補啟動
    this.applyRunState();
  }

  private applyRunState(): void {
    const engine = this.engine;
    if (!engine) return;
    if (this.wanted) engine.start();
    else engine.stop();
  }
}
