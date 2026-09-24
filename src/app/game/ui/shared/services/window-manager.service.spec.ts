import { TestBed } from '@angular/core/testing';
import * as manager from './window-manager.service';
import {
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_VISIBLE,
  WINDOW_MIN_WIDTH,
  WINDOW_TITLE_BAR,
  WindowManagerService,
  WindowState,
} from './window-manager.service';

/**
 * R10 §2／R12 §5：視窗管理服務掌管穩定 ID、位置、尺寸、層級與顯示狀態；只存在本次工作階段。
 * R12：作用於整個桌面，沒有保留的停靠欄；應用主視窗可預設關閉。
 */
describe('WindowManagerService', () => {
  let wm: WindowManagerService;

  const DOC_A = { title: '文件甲', x: 40, y: 30, width: 420, height: 360 };
  const DOC_B = { title: '文件乙', x: 480, y: 30, width: 420, height: 360 };

  function st(id: string): WindowState {
    const s = wm.state(id)();
    if (!s) throw new Error(`沒有視窗 ${id}`);
    return s;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    localStorage.clear();
  });

  it('register：初始為一般模式、預設位置與尺寸；重複註冊不重設狀態（只同步標題）', () => {
    wm.register('a', DOC_A);
    expect(st('a')).toEqual(jasmine.objectContaining({ id: 'a', title: '文件甲', x: 40, y: 30, width: 420, height: 360, mode: 'normal' }));
    wm.move('a', 100, 120);
    wm.minimize('a');
    wm.register('a', { ...DOC_A, title: '文件甲（新）' });
    expect(st('a')).toEqual(jasmine.objectContaining({ x: 100, y: 120, mode: 'minimized', title: '文件甲（新）' }));
    expect(wm.windows().length).toBe(1);
  });

  it('預設顯示狀態可為最小化；之後的預設值只影響「重設視窗位置」，不移動視窗', () => {
    wm.register('log', { ...DOC_A, mode: 'minimized' });
    expect(st('log').mode).toBe('minimized');
    wm.restore('log');
    expect(st('log')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 40, y: 30 }));
    wm.register('log', { ...DOC_A, x: 300, y: 200, mode: 'normal' });
    expect(st('log')).toEqual(jasmine.objectContaining({ x: 40, y: 30 }));
    wm.minimize('log');
    wm.resetLayout();
    expect(st('log')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 300, y: 200 }));
  });

  it('state(id) 是同一個 signal，未註冊時為 undefined', () => {
    expect(wm.state('nope')()).toBeUndefined();
    expect(wm.state('a')).toBe(wm.state('a'));
    wm.register('a', DOC_A);
    expect(wm.state('a')()?.id).toBe('a');
  });

  it('focus：置前（z 最大）；已在最上層時不變', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    expect(st('b').z).toBeGreaterThan(st('a').z);
    wm.focus('a');
    expect(st('a').z).toBeGreaterThan(st('b').z);
    const z = st('a').z;
    wm.focus('a');
    expect(st('a').z).toBe(z);
    expect(wm.isTop('a')).toBeTrue();
    expect(wm.isTop('b')).toBeFalse();
  });

  it('minimize → restore：回到原位置與尺寸，並置前', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    wm.move('a', 222, 111);
    wm.resize('a', 500, 300);
    wm.minimize('a');
    expect(st('a').mode).toBe('minimized');
    expect(wm.isShown('a')).toBeFalse();
    wm.restore('a');
    expect(st('a')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 222, y: 111, width: 500, height: 300 }));
    expect(wm.isTop('a')).toBeTrue();
  });

  it('maximize ↔ restore：位置與尺寸保留；最大化時最小化，還原回最大化', () => {
    wm.register('a', DOC_A);
    wm.toggleMaximize('a');
    expect(st('a').mode).toBe('maximized');
    expect(st('a')).toEqual(jasmine.objectContaining({ x: 40, y: 30, width: 420, height: 360 }));
    wm.minimize('a');
    wm.restore('a');
    expect(st('a').mode).toBe('maximized');
    wm.restore('a');
    expect(st('a')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 40, y: 30, width: 420, height: 360 }));
    wm.toggleMaximize('a');
    wm.toggleMaximize('a');
    expect(st('a').mode).toBe('normal');
  });

  it('close → open：從原入口重開回到原位置；已開啟時 open 只聚焦', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    wm.move('a', 70, 80);
    wm.close('a');
    expect(st('a').mode).toBe('closed');
    // 關閉後再註冊（例如元件重建）仍維持關閉
    wm.register('a', DOC_A);
    expect(st('a').mode).toBe('closed');
    wm.open('a');
    expect(st('a')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 70, y: 80 }));
    expect(wm.isTop('a')).toBeTrue();
    wm.focus('b');
    wm.open('a');
    expect(st('a').mode).toBe('normal');
    expect(wm.isTop('a')).toBeTrue();
    // 最小化的也由 open 還原
    wm.minimize('a');
    wm.open('a');
    expect(st('a').mode).toBe('normal');
  });

  it('setBounds：縮小工作區時重新限制（放得下就整個收進來）；拖曳可部分移出但標題列找得回來', () => {
    wm.setBounds(1200, 800);
    wm.register('a', { ...DOC_A, x: 700, y: 400 });
    expect(st('a')).toEqual(jasmine.objectContaining({ x: 700, y: 400 }));
    wm.setBounds(600, 400);
    const a = st('a');
    expect(a.width).toBeLessThanOrEqual(600);
    expect(a.height).toBeLessThanOrEqual(400);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(600);
    expect(a.y + a.height).toBeLessThanOrEqual(400);
    // 比工作區大的視窗縮到工作區大小
    wm.register('big', { title: '大', x: 0, y: 0, width: 2000, height: 2000 });
    expect(st('big')).toEqual(jasmine.objectContaining({ x: 0, y: 0, width: 600, height: 400 }));
    // 拖出左上：y 不小於 0，左側至少留 WINDOW_MIN_VISIBLE 可抓
    wm.move('a', -5000, -5000);
    expect(st('a').y).toBe(0);
    expect(st('a').x + st('a').width).toBeGreaterThanOrEqual(WINDOW_MIN_VISIBLE);
    // 拖出右下
    wm.move('a', 5000, 5000);
    expect(st('a').x).toBe(600 - WINDOW_MIN_VISIBLE);
    expect(st('a').y).toBe(400 - WINDOW_TITLE_BAR);
  });

  it('resize：不小於最小尺寸、不大於工作區', () => {
    wm.setBounds(900, 700);
    wm.register('a', DOC_A);
    wm.resize('a', 10, 10);
    expect(st('a')).toEqual(jasmine.objectContaining({ width: WINDOW_MIN_WIDTH, height: WINDOW_MIN_HEIGHT }));
    wm.resize('a', 5000, 5000);
    expect(st('a')).toEqual(jasmine.objectContaining({ width: 900, height: 700 }));
  });

  it('resetLayout：回到預設位置與尺寸、依註冊順序排層級；最小化／最大化回到一般，關閉的維持關閉', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    wm.register('c', { ...DOC_B, title: '丙', x: 10 });
    wm.move('a', 300, 300);
    wm.minimize('a');
    wm.toggleMaximize('b');
    wm.focus('b');
    wm.close('c');
    wm.resetLayout();
    expect(st('a')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 40, y: 30, width: 420, height: 360 }));
    expect(st('b').mode).toBe('normal');
    expect(st('c').mode).toBe('closed');
    expect(st('a').z).toBeLessThan(st('b').z);
    // 還原後再最小化／還原不會回到重設前的最大化
    wm.minimize('b');
    wm.restore('b');
    expect(st('b').mode).toBe('normal');
  });

  it('視窗列按鈕：最小化的還原、最上層的最小化、其他的置前', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    wm.toggleFromTaskbar('a');
    expect(wm.isTop('a')).toBeTrue();
    wm.toggleFromTaskbar('a');
    expect(st('a').mode).toBe('minimized');
    wm.toggleFromTaskbar('a');
    expect(st('a').mode).toBe('normal');
    expect(wm.isTop('a')).toBeTrue();
  });

  it('視窗列只列出掛載中、未關閉的視窗；卸載後狀態保留、重新掛載沿用', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    wm.attach('a');
    wm.attach('b');
    expect(wm.taskbarWindows().map((w) => w.id)).toEqual(['a', 'b']);
    wm.close('b');
    expect(wm.taskbarWindows().map((w) => w.id)).toEqual(['a']);
    wm.move('a', 123, 45);
    wm.detach('a');
    expect(wm.taskbarWindows()).toEqual([]);
    wm.register('a', DOC_A);
    wm.attach('a');
    expect(st('a')).toEqual(jasmine.objectContaining({ x: 123, y: 45 }));
  });

  it('小螢幕：單窗顯示（預設顯示工作內容），聚焦／還原切換顯示的視窗，桌面狀態不變', () => {
    wm.register('a', DOC_A);
    wm.register('b', DOC_B);
    wm.setCompact(true);
    expect(wm.isShown('a')).toBeFalse();
    expect(wm.isShown('b')).toBeFalse();
    wm.toggleFromTaskbar('a');
    expect(wm.compactActive()).toBe('a');
    expect(wm.isShown('a')).toBeTrue();
    expect(wm.isShown('b')).toBeFalse();
    wm.focus('b');
    expect(wm.isShown('a')).toBeFalse();
    expect(wm.isShown('b')).toBeTrue();
    wm.minimize('b');
    expect(wm.compactActive()).toBeNull();
    wm.setCompact(false);
    expect(st('a').mode).toBe('normal');
    expect(st('a')).toEqual(jasmine.objectContaining({ x: 40, y: 30 }));
    expect(wm.isShown('a')).toBeTrue();
    expect(st('b').mode).toBe('minimized');
  });

  it('R12 沒有停靠欄：不再匯出停靠區常數與 dock 訊號；視窗可用整個桌面', () => {
    const exported = Object.keys(manager);
    expect(exported.filter((k) => /dock/i.test(k))).toEqual([]);
    expect('dock' in wm).toBeFalse();
    wm.setBounds(1400, 850);
    wm.register('wide', { title: '寬', x: 0, y: 0, width: 1400, height: 850 });
    expect(st('wide')).toEqual(jasmine.objectContaining({ x: 0, y: 0, width: 1400, height: 850 }));
  });

  it('R12 預設關閉：註冊後不顯示、不在視窗列；open 後以預設位置顯示並置前', () => {
    wm.register('work', DOC_A);
    wm.register('mail', { ...DOC_B, title: '郵件', mode: 'closed' });
    wm.attach('work');
    wm.attach('mail');
    expect(st('mail').mode).toBe('closed');
    expect(wm.isShown('mail')).toBeFalse();
    expect(wm.taskbarWindows().map((w) => w.id)).toEqual(['work']);
    wm.open('mail');
    expect(st('mail')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 480, y: 30 }));
    expect(wm.isTop('mail')).toBeTrue();
    expect(wm.taskbarWindows().map((w) => w.id)).toEqual(['work', 'mail']);
  });

  it('R12 預設關閉的視窗不觸發讓位（還沒出現在畫面上），也不算蓋到之後註冊的讓位視窗', () => {
    const LOG = { title: '紀錄', x: 480, y: 30, width: 300, height: 200, yields: true };
    wm.register('log', LOG);
    wm.attach('messages');
    wm.register('messages', { ...DOC_B, title: '通訊', mode: 'closed' });
    expect(st('log').mode).toBe('normal');

    TestBed.resetTestingModule();
    wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    wm.attach('mail');
    wm.register('mail', { ...DOC_B, title: '郵件', mode: 'closed' });
    wm.register('log', LOG);
    expect(st('log').mode).toBe('normal');
  });

  it('R12 重設視窗位置：預設關閉但開著的主視窗回到一般（不被關掉），關閉中的維持關閉', () => {
    wm.register('messages', { ...DOC_A, title: '通訊', mode: 'closed' });
    wm.register('mail', { ...DOC_B, title: '郵件', mode: 'closed' });
    wm.open('messages');
    wm.move('messages', 300, 200);
    wm.toggleMaximize('messages');
    wm.resetLayout();
    expect(st('messages')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 40, y: 30 }));
    expect(st('mail').mode).toBe('closed');
  });

  it('R12 切換應用：各主視窗的位置、尺寸與顯示狀態互不影響；卸載（離開桌面）再掛載沿用', () => {
    wm.setBounds(1400, 850);
    wm.register('app.work', { title: '工作平台', x: 104, y: 16, width: 860, height: 818 });
    wm.register('app.messages', { title: '通訊', x: 136, y: 48, width: 920, height: 660, mode: 'closed' });
    wm.register('app.mail', { title: '郵件', x: 168, y: 80, width: 980, height: 680, mode: 'closed' });
    for (const id of ['app.work', 'app.messages', 'app.mail']) wm.attach(id);
    wm.move('app.work', 120, 20);
    wm.open('app.mail');
    wm.open('app.messages');
    expect(wm.isTop('app.messages')).toBeTrue();
    wm.minimize('app.messages');
    expect(wm.isTop('app.mail')).toBeTrue();
    wm.focus('app.work');
    expect(wm.isTop('app.work')).toBeTrue();
    expect(st('app.work')).toEqual(jasmine.objectContaining({ x: 120, y: 20, mode: 'normal' }));
    expect(st('app.mail').mode).toBe('normal');
    expect(st('app.messages').mode).toBe('minimized');
    // 離開桌面（全部卸載）再回來：重複註冊不重設
    for (const id of ['app.work', 'app.messages', 'app.mail']) wm.detach(id);
    expect(wm.taskbarWindows()).toEqual([]);
    wm.register('app.work', { title: '工作平台', x: 104, y: 16, width: 860, height: 818 });
    wm.register('app.messages', { title: '通訊', x: 136, y: 48, width: 920, height: 660, mode: 'closed' });
    for (const id of ['app.work', 'app.messages', 'app.mail']) wm.attach(id);
    expect(st('app.work')).toEqual(jasmine.objectContaining({ x: 120, y: 20, mode: 'normal' }));
    expect(st('app.messages').mode).toBe('minimized');
    expect(wm.taskbarWindows().map((w) => w.id)).toEqual(['app.work', 'app.messages', 'app.mail']);
  });

  it('R12 限制範圍：桌面縮小時整個收進來；比桌面大的預設縮到桌面大小', () => {
    wm.setBounds(1400, 850);
    wm.register('app.mail', { title: '郵件', x: 400, y: 150, width: 980, height: 680 });
    wm.setBounds(1000, 600);
    const m = st('app.mail');
    expect(m.x + m.width).toBeLessThanOrEqual(1000);
    expect(m.y + m.height).toBeLessThanOrEqual(600);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
  });

  describe('讓位視窗（yields，例如系統作業紀錄）', () => {
    const LOG = { title: '紀錄', x: 800, y: 300, width: 360, height: 360, yields: true };
    const DOC_SIDE = { title: '文件', x: 800, y: 16, width: 360, height: 300 };
    const ELSEWHERE = { title: '別處', x: 16, y: 16, width: 300, height: 200 };

    beforeEach(() => wm.setBounds(1200, 700));

    it('第一次開啟的視窗蓋到沒動過的讓位視窗：讓位視窗最小化（還原回原位）；沒蓋到就不動', () => {
      wm.register('log', LOG);
      wm.register('other', ELSEWHERE);
      expect(st('log').mode).toBe('normal');
      wm.register('doc', DOC_SIDE);
      expect(st('log').mode).toBe('minimized');
      expect(st('doc').mode).toBe('normal');
      wm.restore('log');
      expect(st('log')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 800, y: 300, width: 360, height: 360 }));
      // 已註冊的視窗重新掛載（冪等）不會再讓位；玩家還原後維持顯示
      wm.register('doc', DOC_SIDE);
      expect(st('log').mode).toBe('normal');
    });

    it('玩家移動或調整過、或不是一般模式時不讓位', () => {
      wm.register('log', LOG);
      wm.move('log', 780, 300);
      wm.register('doc', DOC_SIDE);
      expect(st('log').mode).toBe('normal');

      TestBed.resetTestingModule();
      wm = TestBed.inject(WindowManagerService);
      wm.setCompact(false);
      wm.setBounds(1200, 700);
      wm.register('log', LOG);
      wm.resize('log', 360, 380);
      wm.register('doc', DOC_SIDE);
      expect(st('log').mode).toBe('normal');

      TestBed.resetTestingModule();
      wm = TestBed.inject(WindowManagerService);
      wm.setCompact(false);
      wm.setBounds(1200, 700);
      wm.register('log', LOG);
      wm.toggleMaximize('log');
      wm.register('doc', DOC_SIDE);
      expect(st('log').mode).toBe('maximized');
    });

    it('預設最小化的視窗第一次註冊不觸發讓位', () => {
      wm.register('log', LOG);
      wm.register('receipt', { ...DOC_SIDE, y: 400, mode: 'minimized' });
      expect(st('log').mode).toBe('normal');
    });

    it('讓位視窗較晚註冊：已被掛載中的一般視窗蓋到時以最小化開始；未掛載的舊視窗不算', () => {
      wm.register('stale', DOC_SIDE);
      wm.register('log', LOG);
      expect(st('log').mode).toBe('normal');

      TestBed.resetTestingModule();
      wm = TestBed.inject(WindowManagerService);
      wm.setCompact(false);
      wm.setBounds(1200, 700);
      wm.attach('doc');
      wm.register('doc', DOC_SIDE);
      wm.register('log', LOG);
      expect(st('log').mode).toBe('minimized');
      wm.restore('log');
      expect(st('log')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 800, y: 300 }));
    });

    it('重設視窗位置：蓋到讓位視窗的視窗掛載中時，讓位視窗回到最小化（與初次開啟一致）；卸載後重設則回到一般', () => {
      wm.register('log', LOG);
      wm.attach('log');
      wm.attach('doc');
      wm.register('doc', DOC_SIDE);
      wm.restore('log');
      wm.move('log', 100, 100);
      wm.resetLayout();
      expect(st('log')).toEqual(jasmine.objectContaining({ mode: 'minimized', x: 800, y: 300 }));
      expect(st('doc')).toEqual(jasmine.objectContaining({ mode: 'normal', x: 800, y: 16 }));
      wm.detach('doc');
      wm.resetLayout();
      expect(st('log').mode).toBe('normal');
      // 重設清掉「玩家動過」的紀錄：之後第一次開啟的新視窗又會讓紀錄窗讓位
      wm.register('doc2', { ...DOC_SIDE, title: '文件二' });
      expect(st('log').mode).toBe('minimized');
    });
  });

  it('只存在記憶體：不寫入 localStorage（不進遊戲存檔）', () => {
    wm.register('a', DOC_A);
    wm.move('a', 5, 5);
    wm.minimize('a');
    expect(localStorage.length).toBe(0);
  });
});
