import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LEGACY_PLAYER_NAME, ONBOARDING } from '../../../content/bundle';
import { DESKTOP_UI, MESSAGES, NEWS, WINDOWS_UI, WORKBENCH, mailUnreadCount } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { SAVE_KEY } from '../../../state/save-repository';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { DesktopService } from '../../desktop/services/desktop.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { archiveOne, instantOperations, playTo } from '../../testing/play';
import { EXECUTION_LOG_WINDOW_ID } from '../execution-log/execution-log.component';
import { WorkbenchViewService } from '../services/workbench-view.service';
import { WorkbenchComponent } from './workbench.component';

/**
 * R12 §5：工作平台（桌面上的公司應用）。左側只有一組功能導航（工作、公告、通訊、郵件），
 * 通訊／郵件開啟桌面上的應用（不在這裡嵌頁面）；右上身分區顯示玩家姓名與「資料作業組」；
 * 沒有返回開始頁（在桌面主選單）；工具列開啟系統作業紀錄。
 */

function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  TestBed.inject(WindowManagerService).setCompact(false);
  return TestBed.inject(GameStateService);
}

/** 照正常流程完成入職（簽名 name）。 */
function onboard(game: GameStateService, name: string): void {
  for (let guard = 0; guard < 50 && !game.onboarding()?.complete; guard++) {
    const step = game.onboarding()?.step ?? 0;
    if (ONBOARDING.steps[step]?.kind === 'contract') {
      expect(game.signContractStrict(name)).toBe('ok');
    } else if (step >= ONBOARDING.steps.length - 1) {
      expect(game.completeOnboarding()).toBeTrue();
    } else {
      expect(game.advanceOnboarding(step + 1)).toBeTrue();
    }
  }
  expect(game.onboarding()?.complete).toBeTrue();
}

function render(): ComponentFixture<WorkbenchComponent> {
  const fixture = TestBed.createComponent(WorkbenchComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.autoDetectChanges(true);
  fixture.detectChanges();
  return fixture;
}

function root(f: ComponentFixture<WorkbenchComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function navButtons(f: ComponentFixture<WorkbenchComponent>): HTMLButtonElement[] {
  return Array.from(root(f).querySelectorAll<HTMLButtonElement>('nav[data-workbench-nav] button'));
}

describe('WorkbenchComponent（R12 工作平台）', () => {
  let game: GameStateService;
  let fixture: ComponentFixture<WorkbenchComponent> | null = null;

  beforeEach(() => {
    localStorage.clear();
    game = boot();
    game.newGame();
  });

  afterEach(() => {
    fixture?.destroy();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
    fixture = null;
    localStorage.clear();
  });

  it('只有一組功能導航：工作、公告（M1：通訊、郵件只從桌面入口與視窗列開啟）；沒有雙 group 標題、沒有文件問題、沒有返回開始頁', () => {
    fixture = render();
    const nav = root(fixture).querySelector('nav[data-workbench-nav]');
    expect(nav?.getAttribute('aria-label')).toBe(WORKBENCH.navLabel);
    expect(nav?.querySelectorAll('ul').length).toBe(1);
    expect(navButtons(fixture).map((b) => b.querySelector('.truncate')?.textContent?.trim())).toEqual([
      WORKBENCH.nav.work,
      WORKBENCH.nav.news,
    ]);
    const text = root(fixture).textContent ?? '';
    expect(text).not.toContain('個人工作區');
    expect(text).not.toContain('文件問題');
    expect(text).not.toContain(DESKTOP_UI.menu.backToCover);
    expect(root(fixture).querySelector('a[href]')).toBeNull();
  });

  it('右上身分區：玩家姓名（主）＋「資料作業組」（次），標籤為「目前登入」', () => {
    onboard(game, '王小明');
    fixture = render();
    const identity = root(fixture).querySelector('[data-identity]');
    expect(identity?.getAttribute('aria-label')).toBe(WORKBENCH.identityLabel);
    expect(identity?.querySelector('[data-identity-name]')?.textContent?.trim()).toBe('王小明');
    expect(identity?.querySelector('[data-identity-team]')?.textContent?.trim()).toBe(WORKBENCH.team);
  });

  it('姓名只以文字呈現（不當 HTML）', () => {
    onboard(game, '<b>x</b>');
    fixture = render();
    const name = root(fixture).querySelector('[data-identity-name]');
    expect(name?.textContent?.trim()).toBe('<b>x</b>');
    expect(name?.querySelector('b')).toBeNull();
  });

  it('舊存檔沒有姓名：顯示「員工」', () => {
    const save = game.save()!;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...save, profile: { name: null }, onboarding: { step: 0, complete: true } }));
    game = boot();
    expect(game.profileName()).toBeNull();
    fixture = render();
    expect(root(fixture).querySelector('[data-identity-name]')?.textContent?.trim()).toBe(LEGACY_PLAYER_NAME);
    expect(LEGACY_PLAYER_NAME).toBe('員工');
  });

  it('M1：工作平台不重複通訊／郵件的導航（也不嵌第二份頁面）；導航按鈕只切換本應用的視圖', () => {
    fixture = render();
    const desktop = TestBed.inject(DesktopService);
    const opened: string[] = [];
    spyOn(desktop, 'openApp').and.callFake((app) => opened.push(app));
    expect(root(fixture).querySelector('[data-nav-app]')).toBeNull();
    expect(root(fixture).querySelector('[data-window-open="app.messages"], [data-window-open="app.mail"]')).toBeNull();
    for (const b of navButtons(fixture)) b.click();
    expect(opened).toEqual([]);
    expect(root(fixture).querySelector('app-messages')).toBeNull();
    expect(root(fixture).querySelector('app-mail')).toBeNull();
  });

  it('工作 ↔ 公告：切換本應用的視圖（aria-current）；公告時工作內容隱藏但不銷毀，「返回工作」回到工作', () => {
    fixture = render();
    const views = TestBed.inject(WorkbenchViewService);
    const [work, news] = navButtons(fixture);
    expect(work?.getAttribute('aria-current')).toBe('page');
    const workView = root(fixture).querySelector<HTMLElement>('app-work-view');
    expect(workView?.hidden).toBeFalse();
    news?.click();
    fixture.detectChanges();
    expect(views.view()).toBe('news');
    expect(news?.getAttribute('aria-current')).toBe('page');
    expect(work?.getAttribute('aria-current')).toBeNull();
    expect(root(fixture).querySelector('h2')?.textContent?.trim()).toBe(WORKBENCH.heading.news);
    expect(root(fixture).querySelector('app-news')?.textContent).toContain(NEWS.title);
    expect(root(fixture).querySelector('app-work-view')).toBe(workView);
    expect(workView?.hidden).toBeTrue();
    const back = Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('app-news button')).find(
      (b) => b.textContent?.trim() === NEWS.back,
    );
    back?.click();
    fixture.detectChanges();
    expect(views.view()).toBe('work');
    expect(root(fixture).querySelector('app-news')).toBeNull();
    expect(workView?.hidden).toBeFalse();
  });

  it('標題區：當日工作標題、greeting 與日期標籤', () => {
    fixture = render();
    const day = game.dayContent();
    expect(root(fixture).querySelector('h2')?.textContent?.trim()).toBe(day?.workbench.workHeading ?? 'x');
    expect(root(fixture).querySelector('[data-day-tag]')?.textContent?.trim()).toBe(WORKBENCH.dayTag(day?.day ?? 0));
  });

  it('工具列「開啟系統作業紀錄」開啟（或還原、置前）紀錄窗', () => {
    const wm = TestBed.inject(WindowManagerService);
    wm.register(EXECUTION_LOG_WINDOW_ID, { title: '紀錄', x: 0, y: 0, width: 300, height: 200, mode: 'minimized' });
    fixture = render();
    const button = root(fixture).querySelector<HTMLButtonElement>('[data-open-log]');
    expect(button?.textContent?.trim()).toBe(WINDOWS_UI.openLog);
    expect(button?.getAttribute('data-window-open')).toBe(EXECUTION_LOG_WINDOW_ID);
    button?.click();
    expect(wm.state(EXECUTION_LOG_WINDOW_ID)()?.mode).toBe('normal');
  });

  it('M1：通訊／郵件的未讀紅點不在工作平台（在桌面入口與視窗列）；有未讀郵件時工作平台也不顯示', () => {
    archiveOne(game, 'B102', 'default_false', undefined, '102');
    playTo(game, 'day.03');
    fixture = render();
    expect(game.unreadMailCount()).toBeGreaterThan(0);
    expect(root(fixture).querySelector('nav[data-workbench-nav] app-unread-badge')).toBeNull();
    expect(root(fixture).querySelector('nav[data-workbench-nav]')?.textContent).not.toContain(mailUnreadCount(game.unreadMailCount()));
  });
});
