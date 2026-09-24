import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WINDOWS_UI } from '../../../content/text';
import { WindowManagerService } from '../services/window-manager.service';

/**
 * 視窗列（R10 §2／R12 §5）：桌面工作列中列出畫面上掛載中、未關閉的視窗（含最小化）。
 *
 * - 最小化的按一下還原；顯示中且在最上層的按一下最小化；其餘按一下置前。
 * - 小螢幕（單窗最大化）時就是視窗切換器。
 * - 「重設視窗位置」移到桌面主選單（R12），這裡只列視窗。
 * - 只呼叫 WindowManagerService，不碰遊戲狀態。
 */
@Component({
  selector: 'app-window-taskbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './window-taskbar.component.html',
  styleUrl: './window-taskbar.component.css',
})
export class WindowTaskbarComponent {
  protected readonly ui = WINDOWS_UI;
  protected readonly manager = inject(WindowManagerService);

  protected readonly items = computed(() => {
    // 讀 compact／compactActive 讓顯示狀態隨切換更新
    this.manager.compact();
    this.manager.compactActive();
    return this.manager.taskbarWindows().map((w) => ({
      id: w.id,
      title: w.title,
      minimized: w.mode === 'minimized',
      shown: this.manager.isShown(w.id),
    }));
  });

  protected toggle(id: string): void {
    this.manager.toggleFromTaskbar(id);
  }
}
