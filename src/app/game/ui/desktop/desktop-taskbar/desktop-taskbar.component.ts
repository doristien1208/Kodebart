import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DESKTOP_UI } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WindowTaskbarComponent } from '../../shared/window-taskbar/window-taskbar.component';
import { MainMenuComponent } from '../main-menu/main-menu.component';

/**
 * 桌面底部工作列（R12 §5）：常駐（不再只在有紀錄窗時出現）。
 * 左：主選單圖示按鈕；中：視窗列（開啟／最小化中的視窗）；右：存檔狀態（role=status、aria-live=polite）。
 */
@Component({
  selector: 'app-desktop-taskbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MainMenuComponent, WindowTaskbarComponent],
  host: { class: 'block' },
  templateUrl: './desktop-taskbar.component.html',
  styleUrl: './desktop-taskbar.component.css',
})
export class DesktopTaskbarComponent {
  protected readonly game = inject(GameStateService);
  protected readonly ui = DESKTOP_UI;
}
