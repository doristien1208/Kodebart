import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WINDOWS_UI } from '../../../content/text';
import { WindowManagerService } from '../services/window-manager.service';
import { WindowTaskbarComponent } from './window-taskbar.component';

/**
 * R10 §2／R12 §5：視窗列列出掛載中、未關閉的視窗（含最小化）；最小化的按一下還原、最上層的按一下最小化、
 * 其他的置前。「重設視窗位置」移到桌面主選單，視窗列不再有重設鈕。
 */
describe('WindowTaskbarComponent', () => {
  let fixture: ComponentFixture<WindowTaskbarComponent>;
  let wm: WindowManagerService;

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function item(id: string): HTMLButtonElement | null {
    return el().querySelector<HTMLButtonElement>(`[data-taskbar-window="${id}"]`);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    wm.register('a', { title: '文件甲', x: 10, y: 10, width: 300, height: 200 });
    wm.register('b', { title: '文件乙', x: 320, y: 10, width: 300, height: 200 });
    wm.register('gone', { title: '已卸載', x: 0, y: 0, width: 300, height: 200 });
    wm.attach('a');
    wm.attach('b');
    fixture = TestBed.createComponent(WindowTaskbarComponent);
    fixture.autoDetectChanges(true);
    fixture.detectChanges();
  });

  it('有無障礙名稱；列出掛載中且未關閉的視窗（標題），並標示是否顯示中', () => {
    expect(el().querySelector('[data-window-taskbar]')?.getAttribute('aria-label')).toBe(WINDOWS_UI.taskbarLabel);
    expect(Array.from(el().querySelectorAll('[data-taskbar-window]')).map((b) => b.textContent?.trim())).toEqual([
      '文件甲',
      '文件乙',
    ]);
    expect(item('a')?.getAttribute('aria-pressed')).toBe('true');
    wm.close('b');
    fixture.detectChanges();
    expect(item('b')).toBeNull();
  });

  it('最小化的視窗按一下還原並置前；最上層的按一下最小化', () => {
    wm.move('a', 111, 99);
    wm.minimize('a');
    fixture.detectChanges();
    expect(item('a')?.getAttribute('aria-pressed')).toBe('false');
    item('a')?.click();
    fixture.detectChanges();
    expect(wm.state('a')()).toEqual(jasmine.objectContaining({ mode: 'normal', x: 111, y: 99 }));
    expect(wm.isTop('a')).toBeTrue();
    item('a')?.click();
    fixture.detectChanges();
    expect(wm.state('a')()?.mode).toBe('minimized');
  });

  it('被其他視窗蓋住的按一下置前（不最小化）；預設關閉的視窗不列出，開啟後才出現', () => {
    wm.focus('b');
    fixture.detectChanges();
    expect(wm.isTop('b')).toBeTrue();
    item('a')?.click();
    fixture.detectChanges();
    expect(wm.isTop('a')).toBeTrue();
    expect(wm.state('a')()?.mode).toBe('normal');
    wm.register('mail', { title: '郵件', x: 40, y: 40, width: 300, height: 200, mode: 'closed' });
    wm.attach('mail');
    fixture.detectChanges();
    expect(item('mail')).toBeNull();
    wm.open('mail');
    fixture.detectChanges();
    expect(item('mail')?.textContent?.trim()).toBe('郵件');
  });

  it('R12 視窗列只列視窗：沒有重設鈕；沒有掛載中的視窗時清單為空', () => {
    expect(el().querySelector('[data-window-reset]')).toBeNull();
    wm.detach('a');
    wm.detach('b');
    fixture.detectChanges();
    expect(el().querySelectorAll('[data-taskbar-window]').length).toBe(0);
  });
});
