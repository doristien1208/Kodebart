import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WINDOWS_UI } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { WindowManagerService } from '../services/window-manager.service';
import { WindowShellComponent } from './window-shell.component';

/**
 * R10 §2：浮動視窗殼只做呈現與操作事件；位置／尺寸／層級／顯示狀態在 WindowManagerService。
 * 拖曳只從標題列（不從按鈕），鍵盤可移動，按鈕有最小化／最大化・還原／關閉，內文有限高度並在內部捲動。
 * R12：控制鈕是本地 SVG 像素圖示，名稱在 aria-label（繁中）並有 title tooltip；應用主視窗的內文不加內距。
 */

@Component({
  imports: [WindowShellComponent],
  template: `
    @if (show()) {
      <app-window-shell
        windowId="doc.a"
        [title]="title()"
        [closable]="closable()"
        [defaults]="{ x: 40, y: 30, width: 420, height: 300 }"
      >
        <p data-body-content>內文</p>
        <input data-draft />
        <div windowFooter data-footer>頁尾</div>
      </app-window-shell>
    }
    <app-window-shell windowId="doc.b" title="文件乙" variant="app" [defaults]="{ x: 480, y: 30, width: 400, height: 300 }">
      <p>乙</p>
    </app-window-shell>
    <div data-layer class="relative" style="width: 1000px; height: 700px"></div>
  `,
})
class HostComponent {
  readonly show = signal(true);
  readonly title = signal('文件甲');
  readonly closable = signal(true);
}

describe('WindowShellComponent（浮動視窗殼）', () => {
  let fixture: ComponentFixture<HostComponent>;
  let wm: WindowManagerService;

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function shell(id = 'doc.a'): HTMLElement {
    const found = document.querySelector<HTMLElement>(`app-window-shell[data-window-id="${id}"]`);
    if (!found) throw new Error(`找不到視窗 ${id}`);
    return found;
  }
  function inShell<T extends HTMLElement = HTMLElement>(selector: string, id = 'doc.a'): T | null {
    return shell(id).querySelector<T>(selector);
  }
  function click(selector: string, id = 'doc.a'): void {
    const b = inShell<HTMLButtonElement>(selector, id);
    if (!b) throw new Error(`找不到 ${selector}`);
    b.click();
    fixture.detectChanges();
  }
  function pointer(target: Element, type: string, x: number, y: number): void {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 7 }),
    );
    fixture.detectChanges();
  }
  function useLayer(): HTMLElement {
    const layer = el().querySelector<HTMLElement>('[data-layer]')!;
    wm.setLayer(layer);
    fixture.detectChanges();
    return layer;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges(true);
    fixture.detectChanges();
  });

  afterEach(() => {
    wm.setLayer(null);
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
    localStorage.clear();
  });

  it('以穩定 ID 註冊預設位置；標題列＋投影內文與頁尾；區域名稱為標題', () => {
    expect(wm.state('doc.a')()).toEqual(
      jasmine.objectContaining({ title: '文件甲', x: 40, y: 30, width: 420, height: 300, mode: 'normal' }),
    );
    expect(inShell('[role="heading"]')?.textContent?.trim()).toBe('文件甲');
    expect(inShell('section')?.getAttribute('aria-labelledby')).toBe(inShell('[role="heading"]')?.id ?? 'x');
    expect(inShell('[data-window-body] [data-body-content]')).not.toBeNull();
    expect(inShell('[data-footer]')).not.toBeNull();
    expect(shell().getAttribute('data-window-mode')).toBe('normal');
    const buttons = Array.from(shell().querySelectorAll('[data-window-bar] button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([WINDOWS_UI.minimize, WINDOWS_UI.maximize, WINDOWS_UI.close]);
    // 標題列可取得焦點並說明方向鍵移動
    const bar = inShell('[data-window-bar]');
    expect(bar?.getAttribute('tabindex')).toBe('0');
    expect(document.getElementById(bar?.getAttribute('aria-describedby') ?? '')?.textContent?.trim()).toBe(WINDOWS_UI.moveHint);
  });

  it('沒有視窗圖層時留在原位（依文件流）：內文有上限高度並在內部捲動', () => {
    expect(shell().classList.contains('is-floating')).toBeFalse();
    const body = inShell('[data-window-body]');
    expect(body?.style.maxHeight).toBe('300px');
    expect(body ? getComputedStyle(body).overflowY : '').toBe('auto');
    expect(body?.getAttribute('tabindex')).toBe('0');
  });

  it('最小化只隱藏（草稿不清）；還原回到原位置與尺寸', () => {
    const draft = inShell<HTMLInputElement>('[data-draft]')!;
    draft.value = '102';
    click('[data-window-minimize]');
    expect(wm.state('doc.a')()?.mode).toBe('minimized');
    expect(shell().hidden).toBeTrue();
    wm.restore('doc.a');
    fixture.detectChanges();
    expect(shell().hidden).toBeFalse();
    expect(inShell<HTMLInputElement>('[data-draft]')).toBe(draft);
    expect(draft.value).toBe('102');
    expect(wm.state('doc.a')()).toEqual(jasmine.objectContaining({ x: 40, y: 30, width: 420, height: 300, mode: 'normal' }));
  });

  it('R12 控制鈕是像素圖示：繁中 aria-label＋title tooltip、圖示不進無障礙樹、沒有可見文字', () => {
    for (const [selector, label] of [
      ['[data-window-minimize]', WINDOWS_UI.minimize],
      ['[data-window-maximize]', WINDOWS_UI.maximize],
      ['[data-window-close]', WINDOWS_UI.close],
    ] as const) {
      const b = inShell<HTMLButtonElement>(selector)!;
      expect(b.getAttribute('aria-label')).withContext(selector).toBe(label);
      expect(b.title).withContext(selector).toBe(label);
      expect(b.textContent?.trim()).withContext(selector).toBe('');
      const svg = b.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).withContext(selector).toBe('true');
      expect(svg?.querySelector('path')?.getAttribute('d')).withContext(selector).toMatch(/^M\d/);
    }
  });

  it('R12 控制鈕的點擊範圍至少 44px、圖示 16px', () => {
    for (const selector of ['[data-window-minimize]', '[data-window-maximize]', '[data-window-close]']) {
      const b = inShell<HTMLButtonElement>(selector)!;
      const r = b.getBoundingClientRect();
      expect(r.width).withContext(selector).toBeGreaterThanOrEqual(44);
      expect(r.height).withContext(selector).toBeGreaterThanOrEqual(44);
      const svg = b.querySelector('svg')!.getBoundingClientRect();
      expect([svg.width, svg.height]).withContext(selector).toEqual([16, 16]);
    }
  });

  it('最大化 ↔ 還原：按鈕名稱、tooltip 與圖示（方框／雙框）同步', () => {
    const maxPath = inShell('[data-window-maximize] path')?.getAttribute('d');
    click('[data-window-maximize]');
    expect(wm.state('doc.a')()?.mode).toBe('maximized');
    expect(inShell('[data-window-maximize]')?.getAttribute('aria-label')).toBe(WINDOWS_UI.restore);
    expect(inShell<HTMLButtonElement>('[data-window-maximize]')?.title).toBe(WINDOWS_UI.restore);
    expect(inShell('[data-window-maximize] path')?.getAttribute('d')).not.toBe(maxPath);
    click('[data-window-maximize]');
    expect(wm.state('doc.a')()?.mode).toBe('normal');
    expect(inShell('[data-window-maximize]')?.getAttribute('aria-label')).toBe(WINDOWS_UI.maximize);
    expect(inShell('[data-window-maximize] path')?.getAttribute('d')).toBe(maxPath);
  });

  it('R12 控制鈕上按下不拖曳（最大化、關閉鈕同樣）；最上層視窗有 is-top', () => {
    useLayer();
    wm.setBounds(1000, 700);
    const bar = inShell('[data-window-bar]')!;
    for (const selector of ['[data-window-maximize] svg', '[data-window-close] path']) {
      pointer(inShell(selector)!, 'pointerdown', 150, 130);
      pointer(bar, 'pointermove', 400, 400);
      pointer(bar, 'pointerup', 400, 400);
      expect(wm.state('doc.a')()).withContext(selector).toEqual(jasmine.objectContaining({ x: 40, y: 30 }));
    }
    wm.focus('doc.a');
    fixture.detectChanges();
    expect(shell('doc.a').classList.contains('is-top')).toBeTrue();
    expect(shell('doc.b').classList.contains('is-top')).toBeFalse();
    wm.focus('doc.b');
    fixture.detectChanges();
    expect(shell('doc.a').classList.contains('is-top')).toBeFalse();
    expect(shell('doc.b').classList.contains('is-top')).toBeTrue();
  });

  it('R12 應用主視窗（variant="app"）：內文沒有內距、以 flex 欄讓內容填滿；一般文件維持內距', () => {
    const appBody = inShell('[data-window-body]', 'doc.b')!;
    expect(appBody.classList.contains('is-app')).toBeTrue();
    expect(getComputedStyle(appBody).paddingTop).toBe('0px');
    expect(getComputedStyle(appBody).display).toBe('flex');
    const docBody = inShell('[data-window-body]')!;
    expect(docBody.classList.contains('is-app')).toBeFalse();
    expect(getComputedStyle(docBody).paddingTop).not.toBe('0px');
  });

  it('關閉後隱藏，由原入口 open(id) 重開；closable=false 時沒有關閉鈕', () => {
    click('[data-window-close]');
    expect(wm.state('doc.a')()?.mode).toBe('closed');
    expect(shell().hidden).toBeTrue();
    wm.open('doc.a');
    fixture.detectChanges();
    expect(shell().hidden).toBeFalse();
    fixture.componentInstance.closable.set(false);
    fixture.detectChanges();
    expect(inShell('[data-window-close]')).toBeNull();
    expect(inShell('[data-window-minimize]')).not.toBeNull();
  });

  it('有視窗圖層時移進圖層浮動：座標、尺寸、層級來自管理服務', () => {
    const layer = useLayer();
    expect(shell().parentElement).toBe(layer);
    expect(shell().classList.contains('is-floating')).toBeTrue();
    expect(shell().style.left).toBe('40px');
    expect(shell().style.top).toBe('30px');
    expect(shell().style.width).toBe('420px');
    expect(shell().style.height).toBe('300px');
    expect(getComputedStyle(shell()).position).toBe('absolute');
    wm.move('doc.a', 90, 60);
    fixture.detectChanges();
    expect(shell().style.left).toBe('90px');
    expect(shell().style.top).toBe('60px');
    // 最大化時填滿工作區
    wm.toggleMaximize('doc.a');
    fixture.detectChanges();
    expect(shell().classList.contains('is-fill')).toBeTrue();
    expect(shell().style.left).toBe('');
  });

  it('由標題列拖曳移動；從標題列按鈕或內文按下不拖曳', () => {
    useLayer();
    wm.setBounds(1000, 700);
    const bar = inShell('[data-window-bar]')!;
    const title = inShell('[role="heading"]')!;
    pointer(title, 'pointerdown', 100, 100);
    pointer(bar, 'pointermove', 150, 130);
    pointer(bar, 'pointerup', 150, 130);
    expect(wm.state('doc.a')()).toEqual(jasmine.objectContaining({ x: 90, y: 60 }));
    // 標題列按鈕
    const minimize = inShell('[data-window-minimize]')!;
    pointer(minimize, 'pointerdown', 150, 130);
    pointer(bar, 'pointermove', 400, 400);
    pointer(bar, 'pointerup', 400, 400);
    expect(wm.state('doc.a')()).toEqual(jasmine.objectContaining({ x: 90, y: 60 }));
    // 內文（文字、輸入框）
    const body = inShell('[data-body-content]')!;
    pointer(body, 'pointerdown', 150, 200);
    pointer(body, 'pointermove', 400, 400);
    pointer(body, 'pointerup', 400, 400);
    expect(wm.state('doc.a')()).toEqual(jasmine.objectContaining({ x: 90, y: 60 }));
  });

  it('點選任一處置前；標題列方向鍵移動（Shift 放大步距）', () => {
    useLayer();
    wm.setBounds(1000, 700);
    wm.focus('doc.b');
    fixture.detectChanges();
    expect(wm.isTop('doc.b')).toBeTrue();
    pointer(inShell('[data-body-content]')!, 'pointerdown', 50, 50);
    expect(wm.isTop('doc.a')).toBeTrue();
    expect(Number(shell('doc.a').style.zIndex)).toBeGreaterThan(Number(shell('doc.b').style.zIndex));
    const bar = inShell('[data-window-bar]')!;
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    fixture.detectChanges();
    expect(wm.state('doc.a')()).toEqual(jasmine.objectContaining({ x: 56, y: 94 }));
  });

  it('元件銷毀：從圖層移除、視窗列不再列出，但位置保留；重建後沿用', () => {
    const layer = useLayer();
    wm.move('doc.a', 200, 150);
    fixture.detectChanges();
    expect(wm.taskbarWindows().map((w) => w.id)).toContain('doc.a');
    fixture.componentInstance.show.set(false);
    fixture.detectChanges();
    expect(layer.querySelector('[data-window-id="doc.a"]')).toBeNull();
    expect(wm.taskbarWindows().map((w) => w.id)).not.toContain('doc.a');
    fixture.componentInstance.show.set(true);
    fixture.detectChanges();
    expect(shell().parentElement).toBe(layer);
    expect(shell().style.left).toBe('200px');
    expect(shell().style.top).toBe('150px');
  });

  it('小螢幕：只顯示目前單窗（填滿工作區），沒有最大化鈕', () => {
    useLayer();
    wm.setCompact(true);
    fixture.detectChanges();
    expect(shell('doc.a').hidden).toBeTrue();
    expect(shell('doc.b').hidden).toBeTrue();
    wm.focus('doc.a');
    fixture.detectChanges();
    expect(shell('doc.a').hidden).toBeFalse();
    expect(shell('doc.b').hidden).toBeTrue();
    expect(shell('doc.a').classList.contains('is-fill')).toBeTrue();
    expect(inShell('[data-window-maximize]')).toBeNull();
  });

  it('標題改變時同步到管理服務；動態關閉時不加 kb-motion', () => {
    fixture.componentInstance.title.set('文件甲（更新）');
    fixture.detectChanges();
    expect(wm.state('doc.a')()?.title).toBe('文件甲（更新）');
    const settings = TestBed.inject(SettingsService);
    settings.setMotion(false);
    fixture.detectChanges();
    expect(inShell('section')?.classList.contains('kb-motion')).toBeFalse();
    settings.setMotion(true);
    fixture.detectChanges();
    expect(inShell('section')?.classList.contains('kb-motion')).toBe(settings.animationsEnabled());
  });
});
