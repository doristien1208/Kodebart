import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { DESKTOP_UI, MESSAGES, WINDOWS_UI, WORKBENCH, desktopOpenApp, mailUnreadCount, pageTitle } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { SAVE_KEY } from '../../../state/save-repository';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { archiveOne, instantOperations, playTo } from '../../testing/play';
import { MessageUnreadService } from '../../messages/services/message-unread.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { EXECUTION_LOG_WINDOW_ID } from '../../workbench/execution-log/execution-log.component';
import { desktopLayout } from '../presenters/desktop-layout';
import { APP_WINDOW_IDS, DesktopService } from '../services/desktop.service';
import { DesktopComponent } from './desktop.component';

/**
 * R12 §5：/work 電腦桌面。桌面區（入口＋視窗圖層）＋常駐工作列（主選單、視窗列、狀態）；
 * 三個應用主視窗一直掛載（關閉只隱藏），通訊／郵件預設關閉；紀錄窗與附件在桌面層。
 */

interface Harness {
  game: GameStateService;
  wm: WindowManagerService;
  navigated: string[];
}

function boot(): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const navigated: string[] = [];
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.callFake((url) => {
    navigated.push(String(url));
    return Promise.resolve(true);
  });
  instantOperations(TestBed.inject(WorkOperationsService));
  const wm = TestBed.inject(WindowManagerService);
  wm.setCompact(false);
  return { game: TestBed.inject(GameStateService), wm, navigated };
}

async function render(): Promise<ComponentFixture<DesktopComponent>> {
  const fixture = TestBed.createComponent(DesktopComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.autoDetectChanges(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

function dispose(fixture: ComponentFixture<DesktopComponent> | null): void {
  if (!fixture) return;
  fixture.destroy();
  (fixture.nativeElement as HTMLElement).remove();
}

function root(f: ComponentFixture<DesktopComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function shell(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`app-window-shell[data-window-id="${id}"]`);
  if (!found) throw new Error(`找不到視窗 ${id}`);
  return found;
}

function icon(f: ComponentFixture<DesktopComponent>, app: string): HTMLButtonElement {
  const b = root(f).querySelector<HTMLButtonElement>(`[data-desktop-app="${app}"]`);
  if (!b) throw new Error(`找不到入口 ${app}`);
  return b;
}

function menuButton(f: ComponentFixture<DesktopComponent>): HTMLButtonElement {
  return root(f).querySelector<HTMLButtonElement>('[data-main-menu-button]')!;
}

function menuPanel(f: ComponentFixture<DesktopComponent>): HTMLElement {
  return root(f).querySelector<HTMLElement>('[data-main-menu]')!;
}

function openMenu(f: ComponentFixture<DesktopComponent>): void {
  menuButton(f).click();
  f.detectChanges();
}

describe('DesktopComponent（R12 電腦桌面）', () => {
  let h: Harness;
  let fixture: ComponentFixture<DesktopComponent> | null = null;

  beforeEach(() => {
    localStorage.clear();
    h = boot();
    h.game.newGame();
  });

  afterEach(() => {
    dispose(fixture);
    fixture = null;
    h.wm.setLayer(null);
    TestBed.inject(SettingsService).setMotion(true);
    localStorage.clear();
  });

  it('整個 viewport、頁面不捲動：桌面區（有無障礙名稱）＋常駐工作列（主選單、視窗列、狀態）', async () => {
    fixture = await render();
    const host = root(fixture);
    expect(getComputedStyle(host).overflow).toBe('hidden');
    expect(host.querySelector('main[data-desktop]')?.getAttribute('aria-label')).toBe(DESKTOP_UI.label);
    expect(host.querySelector('[data-desktop] [data-window-layer]')).not.toBeNull();
    const taskbar = host.querySelector('[data-desktop-taskbar]');
    expect(taskbar?.querySelector('[data-main-menu-button]')).not.toBeNull();
    expect(taskbar?.querySelector('[data-window-taskbar]')).not.toBeNull();
    const status = taskbar?.querySelector('[data-desktop-status]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent?.trim()).toBe(h.game.statusText());
    // 所有視窗都關掉／最小化時，工作列仍在
    for (const id of Object.values(APP_WINDOW_IDS)) h.wm.close(id);
    h.wm.minimize(EXECUTION_LOG_WINDOW_ID);
    fixture.detectChanges();
    expect(host.querySelector('[data-desktop-taskbar] [data-main-menu-button]')).not.toBeNull();
  });

  it('第一次進桌面：工作平台打開在最上層；通訊與郵件預設關閉；三個主視窗都掛在視窗圖層、各只有一份', async () => {
    fixture = await render();
    const { wm } = h;
    expect(wm.state(APP_WINDOW_IDS.work)()?.mode).toBe('normal');
    expect(wm.isTop(APP_WINDOW_IDS.work)).toBeTrue();
    expect(wm.state(APP_WINDOW_IDS.messages)()?.mode).toBe('closed');
    expect(wm.state(APP_WINDOW_IDS.mail)()?.mode).toBe('closed');
    const layer = root(fixture).querySelector<HTMLElement>('[data-window-layer]');
    for (const id of Object.values(APP_WINDOW_IDS)) expect(shell(id).parentElement).withContext(id).toBe(layer);
    expect(shell(APP_WINDOW_IDS.work).querySelector('app-workbench')).not.toBeNull();
    expect(shell(APP_WINDOW_IDS.messages).querySelector('app-messages')).not.toBeNull();
    expect(shell(APP_WINDOW_IDS.mail).querySelector('app-mail')).not.toBeNull();
    // 每個應用一個主視窗：頁面只各有一份，不在工作平台裡另嵌
    expect(document.querySelectorAll('app-workbench').length).toBe(1);
    expect(document.querySelectorAll('app-messages').length).toBe(1);
    expect(document.querySelectorAll('app-mail').length).toBe(1);
    // 標題列文字取自 DESKTOP_UI.apps
    expect(shell(APP_WINDOW_IDS.work).querySelector('[role="heading"]')?.textContent?.trim()).toBe(DESKTOP_UI.apps.work);
    // 預設版面依桌面尺寸
    const bounds = wm.bounds();
    expect(bounds).not.toBeNull();
    const expected = desktopLayout(bounds!).work;
    expect(wm.state(APP_WINDOW_IDS.work)()).toEqual(jasmine.objectContaining({ x: expected.x, y: expected.y }));
  });

  it('桌面入口：三個（工作平台、通訊、郵件），名稱為「開啟…」、20px 像素圖示、點擊範圍至少 44px', async () => {
    fixture = await render();
    const buttons = Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('[data-desktop-icons] button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      desktopOpenApp(DESKTOP_UI.apps.work),
      desktopOpenApp(DESKTOP_UI.apps.messages),
      desktopOpenApp(DESKTOP_UI.apps.mail),
    ]);
    expect(buttons.map((b) => b.querySelector('.desktop-icon-label')?.textContent?.trim())).toEqual([
      DESKTOP_UI.apps.work,
      DESKTOP_UI.apps.messages,
      DESKTOP_UI.apps.mail,
    ]);
    expect(root(fixture).querySelector('[data-desktop-icons]')?.getAttribute('aria-label')).toBe(DESKTOP_UI.appsLabel);
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
      const svg = b.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('width')).toBe('20');
    }
  });

  it('入口開啟／置前應用：通訊打開在最上層、再點工作平台只置前；關閉後由入口重開回到原位置', async () => {
    fixture = await render();
    const { wm } = h;
    icon(fixture, 'messages').click();
    fixture.detectChanges();
    expect(wm.state(APP_WINDOW_IDS.messages)()?.mode).toBe('normal');
    expect(wm.isTop(APP_WINDOW_IDS.messages)).toBeTrue();
    icon(fixture, 'work').click();
    fixture.detectChanges();
    expect(wm.isTop(APP_WINDOW_IDS.work)).toBeTrue();
    expect(wm.state(APP_WINDOW_IDS.messages)()?.mode).toBe('normal');
    wm.move(APP_WINDOW_IDS.messages, 300, 120);
    shell(APP_WINDOW_IDS.messages).querySelector<HTMLButtonElement>('[data-window-close]')?.click();
    fixture.detectChanges();
    expect(wm.state(APP_WINDOW_IDS.messages)()?.mode).toBe('closed');
    icon(fixture, 'messages').click();
    fixture.detectChanges();
    expect(wm.state(APP_WINDOW_IDS.messages)()).toEqual(jasmine.objectContaining({ mode: 'normal', x: 300, y: 120 }));
  });

  it('郵件紅點：未讀郵件數（與案件待處理分開），附文字說明；開信後消失', async () => {
    archiveOne(h.game, 'B102', 'default_false', undefined, '102');
    playTo(h.game, 'day.03');
    const unread = h.game.unreadMailCount();
    expect(unread).toBeGreaterThan(0);
    fixture = await render();
    const mail = icon(fixture, 'mail');
    expect(root(fixture).querySelector('[data-desktop-badge="mail"]')?.textContent?.trim()).toBe(String(unread));
    const described = document.getElementById(mail.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent?.trim()).toBe(mailUnreadCount(unread));
    expect(root(fixture).querySelector('[data-desktop-badge="work"]')).toBeNull();
    h.game.markMailRead(h.game.mailbox().map((m) => m.id));
    fixture.detectChanges();
    expect(root(fixture).querySelector('[data-desktop-badge="mail"]')).toBeNull();
    expect(mail.getAttribute('aria-describedby')).toBeNull();
  });

  it('通訊紅點：MessageUnreadService.total（實際送達且未讀），附文字說明', async () => {
    fixture = await render();
    const total = TestBed.inject(MessageUnreadService).total();
    const badge = root(fixture).querySelector('[data-desktop-badge="messages"]');
    if (total === 0) {
      expect(badge).toBeNull();
      return;
    }
    expect(badge?.textContent?.trim()).toBe(String(total));
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    const described = document.getElementById(icon(fixture, 'messages').getAttribute('aria-describedby') ?? '');
    expect(described?.textContent?.trim()).toBe(MESSAGES.unread(total));
  });

  it('註冊前要求開啟的應用（舊網址、捷徑）在主視窗註冊後開啟', async () => {
    TestBed.inject(DesktopService).openApp('mail');
    fixture = await render();
    expect(h.wm.state(APP_WINDOW_IDS.mail)()?.mode).toBe('normal');
    expect(h.wm.isTop(APP_WINDOW_IDS.mail)).toBeTrue();
  });

  it('主選單：圖示按鈕有名稱、aria-expanded／aria-controls；選項有文字；Escape 關閉並把焦點還給選單按鈕', async () => {
    fixture = await render();
    const button = menuButton(fixture);
    expect(button.getAttribute('aria-label')).toBe(DESKTOP_UI.menu.button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(menuPanel(fixture).id);
    expect(menuPanel(fixture).hidden).toBeTrue();
    openMenu(fixture);
    await fixture.whenStable();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menuPanel(fixture).hidden).toBeFalse();
    expect(menuPanel(fixture).getAttribute('aria-label')).toBe(DESKTOP_UI.menu.label);
    expect(menuPanel(fixture).textContent).toContain(DESKTOP_UI.menu.backToCover);
    expect(menuPanel(fixture).textContent).toContain(DESKTOP_UI.menu.motion);
    expect(menuPanel(fixture).textContent).toContain(DESKTOP_UI.menu.resetLayout);
    expect(document.activeElement).toBe(menuPanel(fixture).querySelector('[data-menu-back]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(menuPanel(fixture).hidden).toBeTrue();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('主選單：點選單外關閉（焦點不搬動）；選單內點擊不關閉', async () => {
    fixture = await render();
    openMenu(fixture);
    menuPanel(fixture).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(menuPanel(fixture).hidden).toBeFalse();
    root(fixture).querySelector('[data-desktop]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(menuPanel(fixture).hidden).toBeTrue();
  });

  it('主選單：返回開始頁只導航，不清空存檔、不重開遊戲（草稿保留）', async () => {
    const key = h.game.records()[0]!.key;
    h.game.updateDraft(key, { value: '0999' });
    const before = localStorage.getItem(SAVE_KEY);
    fixture = await render();
    openMenu(fixture);
    menuPanel(fixture).querySelector<HTMLButtonElement>('[data-menu-back]')?.click();
    fixture.detectChanges();
    expect(h.navigated).toEqual(['/']);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(h.game.draft(key).value).toBe('0999');
    expect(menuPanel(fixture).hidden).toBeTrue();
  });

  it('主選單：動態效果勾選框綁定 SettingsService.motion', async () => {
    const settings = TestBed.inject(SettingsService);
    fixture = await render();
    openMenu(fixture);
    const box = menuPanel(fixture).querySelector<HTMLInputElement>('[data-menu-motion]')!;
    expect(box.checked).toBe(settings.motion());
    box.click();
    fixture.detectChanges();
    expect(settings.motion()).toBeFalse();
    expect(document.body.classList.contains('no-motion')).toBeTrue();
    box.click();
    fixture.detectChanges();
    expect(settings.motion()).toBeTrue();
    expect(document.body.classList.contains('no-motion')).toBeFalse();
  });

  it('主選單：重設視窗位置把主視窗放回預設位置（關閉的維持關閉）並關閉選單', async () => {
    fixture = await render();
    const { wm } = h;
    const before = wm.state(APP_WINDOW_IDS.work)()!;
    wm.move(APP_WINDOW_IDS.work, before.x + 200, before.y + 100);
    openMenu(fixture);
    menuPanel(fixture).querySelector<HTMLButtonElement>('[data-menu-reset]')?.click();
    fixture.detectChanges();
    expect(wm.state(APP_WINDOW_IDS.work)()).toEqual(jasmine.objectContaining({ x: before.x, y: before.y, mode: 'normal' }));
    expect(wm.state(APP_WINDOW_IDS.mail)()?.mode).toBe('closed');
    expect(menuPanel(fixture).hidden).toBeTrue();
    expect(document.activeElement).toBe(menuButton(fixture));
  });

  it('系統作業紀錄是桌面層的輔助視窗（不在工作平台裡）；工作平台工具列可開啟，視窗列列出', async () => {
    fixture = await render();
    const { wm } = h;
    const log = shell(EXECUTION_LOG_WINDOW_ID);
    expect(log.parentElement).toBe(root(fixture).querySelector<HTMLElement>('[data-window-layer]'));
    expect(shell(APP_WINDOW_IDS.work).contains(log)).toBeFalse();
    wm.minimize(EXECUTION_LOG_WINDOW_ID);
    fixture.detectChanges();
    expect(root(fixture).querySelector(`[data-taskbar-window="${EXECUTION_LOG_WINDOW_ID}"]`)).not.toBeNull();
    const open = shell(APP_WINDOW_IDS.work).querySelector<HTMLButtonElement>('[data-open-log]');
    expect(open?.textContent?.trim()).toBe(WINDOWS_UI.openLog);
    open?.click();
    fixture.detectChanges();
    expect(wm.state(EXECUTION_LOG_WINDOW_ID)()?.mode).toBe('normal');
    expect(wm.isTop(EXECUTION_LOG_WINDOW_ID)).toBeTrue();
  });

  it('切換工作 → 郵件 → 通訊 → 工作：各視窗與歸檔草稿都保留（輸入框是同一個元素）', async () => {
    fixture = await render();
    const { wm, game } = h;
    const input = shell(APP_WINDOW_IDS.work).querySelector<HTMLInputElement>('#archive-input');
    if (!input) throw new Error('沒有歸檔輸入框');
    input.value = '0102';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    icon(fixture, 'mail').click();
    fixture.detectChanges();
    icon(fixture, 'messages').click();
    fixture.detectChanges();
    expect(wm.isTop(APP_WINDOW_IDS.messages)).toBeTrue();
    wm.minimize(APP_WINDOW_IDS.messages);
    shell(APP_WINDOW_IDS.mail).querySelector<HTMLButtonElement>('[data-window-close]')?.click();
    fixture.detectChanges();
    icon(fixture, 'work').click();
    fixture.detectChanges();
    expect(wm.isTop(APP_WINDOW_IDS.work)).toBeTrue();
    expect(shell(APP_WINDOW_IDS.work).querySelector('#archive-input')).toBe(input);
    expect(input.value).toBe('0102');
    expect(game.draft(game.records()[0]!.key).value).toBe('0102');
    expect(wm.state(APP_WINDOW_IDS.messages)()?.mode).toBe('minimized');
    expect(wm.state(APP_WINDOW_IDS.mail)()?.mode).toBe('closed');
  });

  it('離開桌面再回來（同一份存檔）：視窗狀態沿用，不自動重開工作平台；開新遊戲後第一次進桌面才重開', async () => {
    fixture = await render();
    const { wm, game } = h;
    wm.close(APP_WINDOW_IDS.work);
    wm.open(APP_WINDOW_IDS.mail);
    dispose(fixture);
    fixture = await render();
    expect(wm.state(APP_WINDOW_IDS.work)()?.mode).toBe('closed');
    expect(wm.state(APP_WINDOW_IDS.mail)()?.mode).toBe('normal');
    dispose(fixture);
    game.newGame();
    fixture = await render();
    expect(wm.state(APP_WINDOW_IDS.work)()?.mode).toBe('normal');
    expect(wm.isTop(APP_WINDOW_IDS.work)).toBeTrue();
  });

  it('分頁標題依最上層的應用：工作平台 → 郵件 → 都沒有顯示時為「桌面」', async () => {
    fixture = await render();
    const title = TestBed.inject(Title);
    const day = h.game.dayContent()?.day ?? 0;
    expect(title.getTitle()).toBe(pageTitle(WORKBENCH.docTitle(day, 'work')));
    icon(fixture, 'mail').click();
    fixture.detectChanges();
    expect(title.getTitle()).toBe(pageTitle(WORKBENCH.docTitle(day, 'mail')));
    h.wm.minimize(APP_WINDOW_IDS.mail);
    h.wm.minimize(APP_WINDOW_IDS.work);
    fixture.detectChanges();
    expect(title.getTitle()).toBe(pageTitle(DESKTOP_UI.docTitle));
  });

  it('小螢幕：單一最大化視窗（工作平台），最小化後回到桌面入口，視窗列切換', async () => {
    h.wm.setCompact(true);
    fixture = await render();
    const { wm } = h;
    expect(wm.compactActive()).toBe(APP_WINDOW_IDS.work);
    expect(shell(APP_WINDOW_IDS.work).classList.contains('is-fill')).toBeTrue();
    expect(shell(APP_WINDOW_IDS.work).querySelector('[data-window-maximize]')).toBeNull();
    wm.minimize(APP_WINDOW_IDS.work);
    fixture.detectChanges();
    expect(shell(APP_WINDOW_IDS.work).hidden).toBeTrue();
    root(fixture).querySelector<HTMLButtonElement>(`[data-taskbar-window="${APP_WINDOW_IDS.work}"]`)?.click();
    fixture.detectChanges();
    expect(wm.compactActive()).toBe(APP_WINDOW_IDS.work);
    icon(fixture, 'messages').click();
    fixture.detectChanges();
    expect(wm.compactActive()).toBe(APP_WINDOW_IDS.messages);
    expect(shell(APP_WINDOW_IDS.work).hidden).toBeTrue();
  });
});
