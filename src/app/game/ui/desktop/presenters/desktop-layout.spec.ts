import {
  APP_CASCADE,
  DESKTOP_ICON_COLUMN,
  DESKTOP_MARGIN,
  DesktopRect,
  SIDE_MIN_WIDTH,
  WORK_MAX_WIDTH,
  WORK_MIN_WIDTH,
  desktopLayout,
  desktopSideArea,
} from './desktop-layout';

/** R12 §5：桌面預設版面（純函式）——工作平台大、通訊／郵件錯開、紀錄窗右下不遮操作、文件放工作平台右側。 */

function inside(r: DesktopRect, width: number, height: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height;
}

function overlaps(a: DesktopRect, b: DesktopRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('desktopLayout（桌面預設版面）', () => {
  const SIZES: readonly [number, number][] = [
    [1920, 1030],
    [1440, 848],
    [1366, 716],
    [1280, 668],
    [1000, 700],
    [720, 560],
  ];

  for (const [width, height] of SIZES) {
    it(`${width}×${height}：每個預設視窗都在桌面內`, () => {
      const l = desktopLayout({ width, height });
      for (const [name, rect] of Object.entries({ work: l.work, messages: l.messages, mail: l.mail, log: l.log })) {
        expect(inside(rect, width, height)).withContext(name).toBeTrue();
      }
      if (l.side) expect(inside(l.side, width, height)).withContext('side').toBeTrue();
    });
  }

  it('1440 寬：工作平台從圖示欄右側開始（不蓋入口），右側留空白區；紀錄窗在右下、不蓋工作平台', () => {
    const l = desktopLayout({ width: 1440, height: 848 });
    expect(l.work.x).toBe(DESKTOP_ICON_COLUMN);
    expect(l.work.width).toBeGreaterThanOrEqual(WORK_MIN_WIDTH);
    expect(l.work.height).toBe(848 - DESKTOP_MARGIN * 2);
    expect(l.side).not.toBeNull();
    expect(l.side!.width).toBeGreaterThanOrEqual(SIDE_MIN_WIDTH);
    expect(overlaps(l.side!, l.work)).toBeFalse();
    expect(l.log.mode).toBe('normal');
    expect(overlaps(l.log, l.work)).toBeFalse();
    expect(l.log.x + l.log.width).toBe(1440 - DESKTOP_MARGIN);
    expect(l.log.y + l.log.height).toBe(848 - DESKTOP_MARGIN);
  });

  it('1280 寬：放不下圖示欄時工作平台從左邊距開始，仍保留右側空白區', () => {
    const l = desktopLayout({ width: 1280, height: 668 });
    expect(l.work.x).toBe(DESKTOP_MARGIN);
    expect(l.side).not.toBeNull();
    expect(overlaps(l.side!, l.work)).toBeFalse();
  });

  it('1920 寬：工作平台不超過上限，右側夠放兩份文件並排', () => {
    const l = desktopLayout({ width: 1920, height: 1030 });
    expect(l.work.width).toBeLessThanOrEqual(WORK_MAX_WIDTH);
    expect(l.side!.width).toBeGreaterThanOrEqual(SIDE_MIN_WIDTH * 2);
  });

  it('窄桌面：沒有右側空白區，工作平台幾乎填滿；紀錄窗預設最小化（不遮工作平台的操作）', () => {
    const l = desktopLayout({ width: 1000, height: 700 });
    expect(l.side).toBeNull();
    expect(desktopSideArea({ width: 1000, height: 700 })).toBeNull();
    expect(l.work).toEqual({ x: DESKTOP_MARGIN, y: DESKTOP_MARGIN, width: 1000 - DESKTOP_MARGIN * 2, height: 700 - DESKTOP_MARGIN * 2 });
    expect(l.log.mode).toBe('minimized');
  });

  it('通訊與郵件從工作平台左上角依序錯開', () => {
    const l = desktopLayout({ width: 1440, height: 848 });
    expect(l.messages.x).toBe(l.work.x + APP_CASCADE);
    expect(l.messages.y).toBe(l.work.y + APP_CASCADE);
    expect(l.mail.x).toBe(l.work.x + APP_CASCADE * 2);
    expect(l.mail.y).toBe(l.work.y + APP_CASCADE * 2);
  });

  it('尺寸為 0 時不產生負值', () => {
    const l = desktopLayout({ width: 0, height: 0 });
    for (const rect of [l.work, l.messages, l.mail, l.log]) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
    }
  });
});
