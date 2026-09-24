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
import { COVER } from '../../../content/text';
import { ART_NATURAL, CoverAmbience, GLASS_BOUNDS } from '../../../platform/cover-ambience';
import { SettingsService } from '../../../platform/settings.service';

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
  templateUrl: './cover-scene.component.html',
  styleUrl: './cover-scene.component.css',
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
