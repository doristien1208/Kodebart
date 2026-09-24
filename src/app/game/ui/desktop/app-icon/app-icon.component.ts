import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { pixelPath } from '../../shared/window-shell/pixel-path';

/** 桌面上有圖示的項目：三個應用與主選單。 */
export type AppIconName = 'work' | 'messages' | 'mail' | 'menu';

/**
 * 像素圖示（10×10 格；以 20px 顯示時每格 2px、16px 時為縮小版）。全部以 code 繪製，不載入圖檔。
 * 工作平台＝螢幕、通訊＝對話框、郵件＝信封、主選單＝三條橫線。
 */
const ICONS: Readonly<Record<AppIconName, string>> = {
  work: pixelPath([
    'xxxxxxxxxx',
    'x........x',
    'x.xxxxx..x',
    'x........x',
    'x.xxx....x',
    'x........x',
    'xxxxxxxxxx',
    '....xx',
    '..xxxxxx',
  ]),
  messages: pixelPath([
    '',
    '.xxxxxxx',
    'x.......x',
    'x.x.x.x.x',
    'x.......x',
    '.xxxxxxx',
    '.xx',
    '.x',
  ]),
  mail: pixelPath([
    '',
    'xxxxxxxxxx',
    'xx......xx',
    'x.x....x.x',
    'x..x..x..x',
    'x...xx...x',
    'x........x',
    'x........x',
    'xxxxxxxxxx',
  ]),
  menu: pixelPath(['', '', '.xxxxxxxx', '', '', '.xxxxxxxx', '', '', '.xxxxxxxx']),
};

/** 像素圖示；純裝飾（aria-hidden），名稱由外層按鈕的 aria-label 提供。 */
@Component({
  selector: 'app-app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  templateUrl: './app-icon.component.html',
})
export class AppIconComponent {
  readonly name = input.required<AppIconName>();
  /** 顯示尺寸（px）：20（預設）或 16。 */
  readonly size = input<16 | 20>(20);

  protected readonly path = computed(() => ICONS[this.name()]);
}
