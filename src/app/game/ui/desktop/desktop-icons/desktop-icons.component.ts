import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DESKTOP_UI, MESSAGES, desktopOpenApp, mailUnreadCount } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { MessageUnreadService } from '../../messages/services/message-unread.service';
import { AppIconComponent } from '../app-icon/app-icon.component';
import { APP_WINDOW_IDS, DESKTOP_APPS, DesktopAppId, DesktopService } from '../services/desktop.service';

/** 一個桌面入口的畫面資料。 */
interface DesktopIconView {
  app: DesktopAppId;
  windowId: string;
  label: string;
  /** 按鈕的無障礙名稱，例如「開啟郵件」。 */
  aria: string;
  /** 未讀數（0＝不顯示紅點）與其螢幕閱讀器說明。 */
  unread: number;
  unreadText: string;
}

/**
 * 桌面左上的應用入口（R12 §5）：工作平台、通訊、郵件三個，全部可操作，沒有裝飾用圖示。
 *
 * - 點一下開啟（或還原、置前）該應用主視窗；關閉的視窗關閉後焦點回到這裡（data-window-open）。
 * - 紅點：通訊＝MessageUnreadService.total（實際送達且未讀），郵件＝未讀郵件數；數字旁另有文字說明
 *   （aria-describedby），不只靠顏色。郵件未讀與案件待處理無關。
 * - 圖示 20px，按鈕點擊範圍至少 44px；文字標籤可見。
 */
@Component({
  selector: 'app-desktop-icons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppIconComponent],
  host: { class: 'block' },
  templateUrl: './desktop-icons.component.html',
  styleUrl: './desktop-icons.component.css',
})
export class DesktopIconsComponent {
  private readonly desktop = inject(DesktopService);
  private readonly game = inject(GameStateService);
  private readonly messagesUnread = inject(MessageUnreadService).total;

  protected readonly ui = DESKTOP_UI;

  protected readonly icons = computed<readonly DesktopIconView[]>(() => {
    const unread: Record<DesktopAppId, number> = {
      work: 0,
      messages: this.messagesUnread(),
      mail: this.game.unreadMailCount(),
    };
    return DESKTOP_APPS.map((app) => {
      const label = DESKTOP_UI.apps[app];
      const count = unread[app];
      return {
        app,
        windowId: APP_WINDOW_IDS[app],
        label,
        aria: desktopOpenApp(label),
        unread: count,
        unreadText: app === 'messages' ? MESSAGES.unread(count) : app === 'mail' ? mailUnreadCount(count) : '',
      };
    });
  });

  protected open(app: DesktopAppId): void {
    this.desktop.openApp(app);
  }
}
