import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { MESSAGES, WINDOWS_UI, WORKBENCH, mailUnreadCount } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { DesktopAppId, DesktopService } from '../../desktop/services/desktop.service';
import { MessageUnreadService } from '../../messages/services/message-unread.service';
import { UnreadBadgeComponent } from '../../messages/unread-badge/unread-badge.component';
import { NewsComponent } from '../../news/news/news.component';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { EXECUTION_LOG_WINDOW_ID } from '../execution-log/execution-log.component';
import { WorkbenchView, WorkbenchViewService } from '../services/workbench-view.service';
import { WorkViewComponent } from '../work-view/work-view.component';

/** 左側單組功能導航的一項：切換工作平台內的視圖，或開啟桌面上的其他應用。 */
type NavItem =
  | { kind: 'view'; view: WorkbenchView; label: string }
  | { kind: 'app'; app: Exclude<DesktopAppId, 'work'>; label: string; windowId: string };

/**
 * 工作平台（R12 §5）：桌面上「工作平台」主視窗的內容（公司應用）。沒有子路由。
 *
 * - 上方應用列：品牌、工具列（開啟系統作業紀錄）與右上身分區（玩家姓名＋組別「資料作業組」；
 *   舊存檔沒有姓名時顯示「員工」）。
 * - 左側單組功能導航：工作、公告（切換本應用的視圖，WorkbenchViewService）。M1 起通訊與郵件只從桌面入口與
 *   視窗列開啟，這裡不再重複導航。沒有返回開始頁（在桌面主選單）。
 * - 內容區：標題、greeting、日期標籤＋目前工作（WorkViewComponent，切到公告時隱藏但不銷毀，
 *   本地狀態與案件文件視窗保留）或公告（NewsComponent）。只有內容區捲動。
 * - 視圖切換的淡入只在 SettingsService.animationsEnabled 時播放。
 */
@Component({
  selector: 'app-workbench',
  imports: [NewsComponent, UnreadBadgeComponent, WorkViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workbench.component.css',
  templateUrl: './workbench.component.html',
})
export class WorkbenchComponent {
  protected readonly game = inject(GameStateService);
  private readonly desktop = inject(DesktopService);
  private readonly windows = inject(WindowManagerService);
  private readonly settings = inject(SettingsService);
  private readonly views = inject(WorkbenchViewService);

  /** 內容區過渡的容器（標題區＋目前視圖）。 */
  private readonly viewPane = viewChild<ElementRef<HTMLElement>>('viewPane');
  private viewAnimation: Animation | null = null;

  protected readonly WORKBENCH = WORKBENCH;
  protected readonly MESSAGES = MESSAGES;
  protected readonly WINDOWS = WINDOWS_UI;
  protected readonly logWindowId = EXECUTION_LOG_WINDOW_ID;

  protected readonly view = this.views.view;

  /** 通訊的彙總未讀（實際送達且未讀）；頻道列表與對話內的紅點在通訊應用裡。 */
  protected readonly unreadTotal = inject(MessageUnreadService).total;
  /** 未讀郵件數（開啟信件才算已讀；與案件待處理無關）。 */
  protected readonly unreadMail = this.game.unreadMailCount;
  protected readonly unreadMailLabel = computed(() => mailUnreadCount(this.unreadMail()));

  /**
   * M1：工作平台只保留工作與公司公告；通訊與郵件從桌面入口或底部視窗列開啟，不在這裡重複導航。
   */
  protected readonly navItems: readonly NavItem[] = [
    { kind: 'view', view: 'work', label: WORKBENCH.nav.work },
    { kind: 'view', view: 'news', label: WORKBENCH.nav.news },
  ];

  /** 目前這一天的內容：greeting 與工作標題都從這裡讀，不再依日數查表。 */
  private readonly dayContent = this.game.dayContent;
  protected readonly greeting = computed(() => this.dayContent()?.workbench.greeting ?? '');
  /** 日序（1 起算）取自目前 DayContent，供日期標籤代入；不做日別分支。 */
  protected readonly dayNumber = computed(() => this.dayContent()?.day ?? 0);

  protected readonly headingText = computed(() =>
    this.view() === 'news' ? WORKBENCH.heading.news : (this.dayContent()?.workbench.workHeading ?? ''),
  );

  constructor() {
    // 只追蹤 view()：第一次（建立時）不播，之後每次切換播一次；設定本身變動不重播
    let first = true;
    effect(() => {
      this.view();
      untracked(() => {
        if (first) {
          first = false;
          return;
        }
        this.playViewTransition();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.viewAnimation?.cancel();
      this.viewAnimation = null;
    });
  }

  protected select(item: NavItem): void {
    if (item.kind === 'view') this.views.show(item.view);
    else this.desktop.openApp(item.app);
  }

  /** 工具列：開啟（或還原、聚焦）系統作業紀錄。 */
  protected openLog(): void {
    this.windows.open(this.logWindowId);
  }

  /**
   * 內容區換頁感：180ms 淡入＋6px 上移，只動 opacity／transform，不影響版面；
   * Web Animations API 重播，fill: 'none' 結束後不留 transform。動態關閉時直接不播放。
   */
  private playViewTransition(): void {
    if (!this.settings.animationsEnabled()) return;
    const pane = this.viewPane()?.nativeElement;
    if (!pane || typeof pane.animate !== 'function') return;
    this.viewAnimation?.cancel();
    this.viewAnimation = pane.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 180, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'none' },
    );
  }
}
