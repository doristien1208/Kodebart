import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, map, scan, startWith } from 'rxjs';
import { ASIDE, WORKBENCH, pageTitle } from '../../content/text';
import { SettingsService } from '../../platform/settings.service';
import { GameStateService } from '../../state/game-state.service';

type WorkView = 'work' | 'messages' | 'news';

interface NavItem {
  path: string;
  label: string;
  exact: boolean;
}

/**
 * /work 的父路由：頂列、左側導航、主要作業區（子路由）、右側摘要欄、狀態列。
 * 對應原型 render() 外殼與 aside()。
 */
@Component({
  selector: 'app-workbench',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    nav .active { background: var(--color-elevated); border-left: 3px solid var(--color-primary); }
  `,
  template: `
    <header class="flex items-center justify-between gap-4 px-4 py-3 md:px-8 md:py-4 border-b border-border bg-surface">
      <div class="font-mono font-bold text-[1.3rem] leading-tight tracking-[.08em]">
        <span class="text-primary">{{ WORKBENCH.brandLead }}</span>{{ WORKBENCH.brandRest }}<span class="text-sm text-primary">{{ WORKBENCH.brandSuffix }}</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-sm text-muted hidden md:inline">{{ WORKBENCH.role }}</span>
        <button type="button" class="btn-ghost" (click)="backToCover()">{{ WORKBENCH.backToCover }}</button>
      </div>
    </header>

    <div class="max-w-[1600px] mx-auto min-h-[calc(100svh_-_85px)] md:grid md:grid-cols-[165px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_260px]">
      <nav
        [attr.aria-label]="WORKBENCH.navLabel"
        class="flex gap-1 p-2.5 border-b border-border md:block md:gap-0 md:px-4 md:py-6 md:border-b-0 md:border-r"
      >
        <div class="hidden md:block p-[.7rem] text-sm text-muted">{{ WORKBENCH.navGroupPersonal }}</div>
        @for (item of navItems; track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: item.exact }"
            class="block w-full min-h-11 border border-transparent bg-transparent text-text no-underline text-center p-2 md:text-left md:px-4 md:py-2.5 md:mb-2 hover:bg-elevated hover:border-primary"
          >{{ item.label }}</a>
        }
        <div class="hidden md:block p-[.7rem] text-sm text-muted">{{ WORKBENCH.navGroupTeam }}</div>
      </nav>

      <section class="p-4 md:p-6 xl:p-8 min-w-0">
        <!-- 只有這層（標題區＋子路由內容）在切換視圖時過渡；外殼各區塊維持不動 -->
        <div #viewPane>
          <div class="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-6">
            <div>
              <h2 class="mb-1">{{ headingText() }}</h2>
              <p class="text-sm text-muted">{{ WORKBENCH.greeting[day()] }}</p>
            </div>
            <span class="font-mono leading-tight text-primary whitespace-nowrap">{{ WORKBENCH.dayTag(day()) }}</span>
          </div>
          <router-outlet />
        </div>
      </section>

      <aside class="hidden xl:block py-8 px-5 border-l border-border">
        <div class="eyebrow">{{ ASIDE.eyebrow }}</div>
        <h3>{{ ASIDE.heading[day()] }}</h3>
        <p class="text-sm text-muted">{{ ASIDE.body[day()] }}</p>
        <div class="h-px bg-border my-[1.4rem]"></div>
        <p class="text-sm">{{ ASIDE.colleague }}</p>
        <p class="text-sm text-muted">{{ ASIDE.quote }}</p>
        <div class="h-px bg-border my-[1.4rem]"></div>
        <p class="text-sm text-muted">{{ ASIDE.slogan }}</p>
      </aside>
    </div>

    <div class="status-bar px-4 md:px-8" role="status" aria-live="polite">{{ game.statusText() }}</div>
  `,
})
export class WorkbenchComponent {
  protected readonly game = inject(GameStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly settings = inject(SettingsService);

  /** 內容區過渡的容器（標題區＋<router-outlet>）。 */
  private readonly viewPane = viewChild<ElementRef<HTMLElement>>('viewPane');
  private viewAnimation: Animation | null = null;

  protected readonly WORKBENCH = WORKBENCH;
  protected readonly ASIDE = ASIDE;

  protected readonly navItems: readonly NavItem[] = [
    { path: '/work', label: WORKBENCH.nav.work, exact: true },
    { path: '/work/messages', label: WORKBENCH.nav.messages, exact: false },
    { path: '/work/news', label: WORKBENCH.nav.news, exact: false },
  ];

  /** 第一日＝1、第二日＝2（由存檔 phase 推得）。 */
  protected readonly day = this.game.day;

  /** 目前視圖：由子路由 data.view 取得；子路由是 lazy，所以以 NavigationEnd 更新。 */
  protected readonly view = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.readView()),
      startWith(this.readView()),
    ),
    { initialValue: 'work' as WorkView },
  );

  /**
   * 本元件存活期間完成的導航次數。第 1 次就是「建立本元件的那次導航」
   * （深連結時 view 會從預設值補正成實際視圖，effect 會多跑一次），
   * 此時畫面層級的 host 進場動畫正在播，內容區不再疊一層。
   */
  private readonly navSeq = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      scan((count) => count + 1, 0),
    ),
    { initialValue: 0 },
  );

  protected readonly headingText = computed(() => {
    const view = this.view();
    if (view === 'work') return WORKBENCH.heading.work[this.day()];
    return view === 'messages' ? WORKBENCH.heading.messages : WORKBENCH.heading.news;
  });

  constructor() {
    effect(() => {
      this.title.setTitle(pageTitle(WORKBENCH.docTitle(this.day(), this.view())));
    });

    // 只追蹤 view()：設定或導航次數變動本身不該重播動畫，故在 untracked 內讀取。
    effect(() => {
      this.view();
      untracked(() => {
        if (this.navSeq() <= 1) return;
        this.playViewTransition();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.viewAnimation?.cancel();
      this.viewAnimation = null;
    });
  }

  /**
   * 內容區換頁感：180ms 淡入＋6px 上移，只動 opacity／transform，不影響版面。
   * 用 Web Animations API 重播（原生，不需新增套件，也不必強制 reflow）；
   * fill: 'none' 讓動畫結束後不留下 transform。
   * 動態關閉（遊戲設定或系統 prefers-reduced-motion）時直接不播放，
   * 不排任何待執行的 callback。
   */
  private playViewTransition(): void {
    if (!this.settings.animationsEnabled()) return;

    const pane = this.viewPane()?.nativeElement;
    if (!pane || typeof pane.animate !== 'function') return;

    this.viewAnimation?.cancel();
    this.viewAnimation = pane.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 180, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'none' },
    );
  }

  protected backToCover(): void {
    this.router.navigateByUrl('/');
  }

  /**
   * 父元件建構當下，子路由可能尚未 advance（snapshot 仍為 undefined），
   * 因此一律安全讀取；正確值會在同一次導航的 NavigationEnd 補上。
   */
  private readView(): WorkView {
    const snapshot = this.route.firstChild?.snapshot as ActivatedRouteSnapshot | undefined;
    const view = snapshot?.data?.['view'] as WorkView | undefined;
    return view ?? 'work';
  }
}
