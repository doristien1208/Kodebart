import type { WorkspaceBounds } from '../../shared/services/window-manager.service';

/** 桌面座標中的矩形（px，相對桌面左上角）。 */
export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 桌面邊距與視窗間距（DESIGN：主要內距 16px）。 */
export const DESKTOP_MARGIN = 16;
export const DESKTOP_GAP = 12;
/** 左上桌面圖示欄的寬度；桌面夠寬時工作平台從圖示欄右側開始，不蓋住入口。 */
export const DESKTOP_ICON_COLUMN = 104;
/** 工作平台的舒適寬度範圍（左側導航＋工作內容）。 */
export const WORK_MIN_WIDTH = 860;
export const WORK_MAX_WIDTH = 1120;
/** 右側文件區至少這麼寬才保留（放一份文件）；兩份並排時每份的理想寬度。 */
export const SIDE_MIN_WIDTH = 360;
export const SIDE_DOC_WIDTH = 380;
/** 通訊／郵件主視窗：從工作平台左上角依序錯開（cascade）。 */
export const APP_CASCADE = 32;
export const MESSAGES_SIZE = { width: 920, height: 660 } as const;
export const MAIL_SIZE = { width: 980, height: 680 } as const;
/** 系統作業紀錄的預設尺寸。 */
export const LOG_SIZE = { width: 420, height: 320 } as const;

/** 桌面各視窗的預設版面（第一次註冊與「重設視窗位置」用）。 */
export interface DesktopLayout {
  /** 工作平台主視窗（大）。 */
  work: DesktopRect;
  /** 工作平台右側的空白區（文件、紀錄窗）；桌面太窄時為 null（文件改為一次一份）。 */
  side: DesktopRect | null;
  messages: DesktopRect;
  mail: DesktopRect;
  /** 紀錄窗：右下角；沒有右側空白區時預設最小化，不遮住工作平台的操作。 */
  log: DesktopRect & { mode: 'normal' | 'minimized' };
}

/**
 * 依桌面尺寸計算預設版面（純函式）。
 *
 * - 夠寬時：工作平台放左側（先保留圖示欄；放不下再從左邊距開始），右側留給文件與紀錄窗，
 *   兩者不遮住工作平台的表單與提交；寬度有餘時右側可並排兩份文件（SIDE_DOC_WIDTH）。
 * - 較窄時：工作平台幾乎填滿桌面，文件一次一份，紀錄窗最小化在視窗列。
 * - 通訊與郵件從工作平台左上角錯開，尺寸不超過桌面。小螢幕（< 700px）由視窗管理服務單窗最大化。
 */
export function desktopLayout(bounds: WorkspaceBounds): DesktopLayout {
  const W = Math.max(0, bounds.width);
  const H = Math.max(0, bounds.height);
  const height = Math.max(0, H - DESKTOP_MARGIN * 2);
  const needed = WORK_MIN_WIDTH + DESKTOP_GAP + SIDE_MIN_WIDTH + DESKTOP_MARGIN;
  const left = W >= DESKTOP_ICON_COLUMN + needed ? DESKTOP_ICON_COLUMN : DESKTOP_MARGIN;
  const wide = W >= left + needed;

  let work: DesktopRect;
  let side: DesktopRect | null = null;
  if (wide) {
    const avail = W - left - DESKTOP_GAP - DESKTOP_MARGIN;
    const width = clamp(avail - (SIDE_DOC_WIDTH * 2 + DESKTOP_GAP), WORK_MIN_WIDTH, WORK_MAX_WIDTH);
    work = { x: left, y: DESKTOP_MARGIN, width, height };
    const sideX = left + width + DESKTOP_GAP;
    side = { x: sideX, y: DESKTOP_MARGIN, width: W - DESKTOP_MARGIN - sideX, height };
  } else {
    work = { x: DESKTOP_MARGIN, y: DESKTOP_MARGIN, width: Math.max(0, Math.min(WORK_MAX_WIDTH, W - DESKTOP_MARGIN * 2)), height };
  }

  const cascade = (step: number, size: { width: number; height: number }): DesktopRect => {
    const x = Math.min(work.x + APP_CASCADE * step, Math.max(0, W - DESKTOP_MARGIN - size.width));
    const y = DESKTOP_MARGIN + APP_CASCADE * step;
    return {
      x: Math.max(DESKTOP_MARGIN, x),
      y,
      width: Math.max(0, Math.min(size.width, W - DESKTOP_MARGIN * 2)),
      height: Math.max(0, Math.min(size.height, H - y - DESKTOP_MARGIN)),
    };
  };

  const logWidth = Math.max(0, Math.min(LOG_SIZE.width, side ? side.width : W - DESKTOP_MARGIN * 2));
  const logHeight = Math.max(0, Math.min(LOG_SIZE.height, height));
  const log = {
    x: Math.max(0, W - DESKTOP_MARGIN - logWidth),
    y: Math.max(0, H - DESKTOP_MARGIN - logHeight),
    width: logWidth,
    height: logHeight,
    mode: side ? ('normal' as const) : ('minimized' as const),
  };

  return { work, side, messages: cascade(1, MESSAGES_SIZE), mail: cascade(2, MAIL_SIZE), log };
}

/** 工作平台右側的空白區（文件預設位置用）；桌面太窄時為 null。 */
export function desktopSideArea(bounds: WorkspaceBounds): DesktopRect | null {
  return desktopLayout(bounds).side;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 並排查閱時每份文件至少這麼寬（px）。 */
export const TILE_MIN_WIDTH = 320;
/** 並排查閱時每份文件的理想寬度（px）。 */
export const TILE_DOC_WIDTH = 400;

/**
 * 並排查閱（M1）：n 份文件的位置（純函式）。從桌面右側往左排；右側空白區放得下時只用空白區，
 * 放不下時往左延伸蓋住工作平台的右半（玩家主動並排；「還原視窗位置」回到預設版面）。
 * 每份至少 TILE_MIN_WIDTH，桌面再窄就疊在同一欄。
 */
export function tileRects(bounds: WorkspaceBounds, n: number): DesktopRect[] {
  if (n <= 0) return [];
  const W = Math.max(0, bounds.width);
  const H = Math.max(0, bounds.height);
  const height = Math.max(0, H - DESKTOP_MARGIN * 2);
  const right = W - DESKTOP_MARGIN;
  const side = desktopLayout(bounds).side;
  const cols = Math.max(1, Math.min(n, Math.floor((W - DESKTOP_MARGIN * 2 + DESKTOP_GAP) / (TILE_MIN_WIDTH + DESKTOP_GAP))));
  const ideal = cols * TILE_DOC_WIDTH + (cols - 1) * DESKTOP_GAP;
  const fromSide = side && side.width >= cols * TILE_MIN_WIDTH + (cols - 1) * DESKTOP_GAP ? side.x : null;
  const x0 = fromSide ?? Math.max(DESKTOP_MARGIN, right - ideal);
  const width = Math.max(0, Math.floor((right - x0 - (cols - 1) * DESKTOP_GAP) / cols));
  return Array.from({ length: n }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { x: x0 + col * (width + DESKTOP_GAP), y: DESKTOP_MARGIN + row * 32, width, height: Math.max(0, height - row * 32) };
  });
}
