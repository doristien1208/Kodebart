import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../../app.routes';
import { ONBOARDING } from '../../../content/bundle';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { instantOperations } from '../../testing/play';
import { WorkbenchViewService } from '../../workbench/services/workbench-view.service';
import { DesktopComponent } from '../desktop/desktop.component';
import { APP_WINDOW_IDS } from '../services/desktop.service';

/**
 * R12 §5 路由：/work 是桌面；舊網址 /work/messages、/work/mail、/work/issues（→ 郵件）、/work/news（→ 工作平台公告）
 * 開啟對應應用後導回 /work，不另開頁面；stageGuard 仍先決定目前應在哪個畫面。
 */

function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  instantOperations(TestBed.inject(WorkOperationsService));
  TestBed.inject(WindowManagerService).setCompact(false);
  return TestBed.inject(GameStateService);
}

function onboard(game: GameStateService): void {
  for (let guard = 0; guard < 50 && !game.onboarding()?.complete; guard++) {
    const step = game.onboarding()?.step ?? 0;
    if (ONBOARDING.steps[step]?.kind === 'contract') game.signContractStrict('王小明');
    else if (step >= ONBOARDING.steps.length - 1) game.completeOnboarding();
    else game.advanceOnboarding(step + 1);
  }
}

async function go(url: string): Promise<{ harness: RouterTestingHarness; path: string }> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  harness.detectChanges();
  await harness.fixture.whenStable();
  harness.detectChanges();
  return { harness, path: TestBed.inject(Router).url };
}

describe('桌面路由與舊網址（R12）', () => {
  let game: GameStateService;
  let harness: RouterTestingHarness | null = null;

  beforeEach(() => {
    localStorage.clear();
    game = boot();
    game.newGame();
    onboard(game);
  });

  afterEach(() => {
    harness?.fixture.destroy();
    harness = null;
    TestBed.inject(WindowManagerService).setLayer(null);
    localStorage.clear();
  });

  it('/work 顯示桌面（DesktopComponent）', async () => {
    const r = await go('/work');
    harness = r.harness;
    expect(r.path).toBe('/work');
    expect(harness.routeNativeElement?.querySelector('main[data-desktop]')).not.toBeNull();
    expect(harness.fixture.debugElement.query((d) => d.componentInstance instanceof DesktopComponent)).not.toBeNull();
  });

  for (const [url, app] of [
    ['/work/messages', 'messages'],
    ['/work/mail', 'mail'],
    ['/work/issues', 'mail'],
  ] as const) {
    it(`${url} → 開啟${app === 'messages' ? '通訊' : '郵件'}並導回 /work`, async () => {
      const r = await go(url);
      harness = r.harness;
      const wm = TestBed.inject(WindowManagerService);
      expect(r.path).toBe('/work');
      expect(wm.state(APP_WINDOW_IDS[app])()?.mode).toBe('normal');
      expect(wm.isTop(APP_WINDOW_IDS[app])).toBeTrue();
    });
  }

  it('/work/news → 工作平台切到公告並導回 /work', async () => {
    const r = await go('/work/news');
    harness = r.harness;
    expect(r.path).toBe('/work');
    expect(TestBed.inject(WorkbenchViewService).view()).toBe('news');
    expect(TestBed.inject(WindowManagerService).isTop(APP_WINDOW_IDS.work)).toBeTrue();
  });

  it('桌面已開著時再走舊網址：直接置前該應用，桌面不重建', async () => {
    const r = await go('/work');
    harness = r.harness;
    const desktopEl = harness.routeNativeElement?.querySelector('main[data-desktop]');
    await harness.navigateByUrl('/work/mail');
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/work');
    expect(TestBed.inject(WindowManagerService).isTop(APP_WINDOW_IDS.mail)).toBeTrue();
    expect(harness.routeNativeElement?.querySelector('main[data-desktop]')).toBe(desktopEl);
  });

  it('入職未完成的存檔：/work 與舊網址都先由 stageGuard 導向 /onboarding，不開應用', async () => {
    game.newGame();
    const r = await go('/work/messages');
    harness = r.harness;
    expect(r.path).toBe('/onboarding');
    expect(TestBed.inject(WindowManagerService).state(APP_WINDOW_IDS.messages)()).toBeUndefined();
  });

  it('沒有存檔：回開始頁', async () => {
    localStorage.clear();
    game = boot();
    const r = await go('/work/mail');
    harness = r.harness;
    expect(r.path).toBe('/');
  });
});
