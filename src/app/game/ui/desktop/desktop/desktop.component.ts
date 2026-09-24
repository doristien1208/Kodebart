import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { DESKTOP_UI, WORKBENCH, pageTitle } from '../../../content/text';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { MailAttachmentWindowsComponent } from '../../mail/mail-attachment-windows/mail-attachment-windows.component';
import { MailComponent } from '../../mail/mail/mail.component';
import { MessagesComponent } from '../../messages/messages/messages.component';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { WindowShellComponent, WindowShellDefaults } from '../../shared/window-shell/window-shell.component';
import { ExecutionLogComponent } from '../../workbench/execution-log/execution-log.component';
import { buildExecutionLog, withOperation } from '../../workbench/presenters/execution-log';
import { WorkbenchViewService } from '../../workbench/services/workbench-view.service';
import { WorkbenchComponent } from '../../workbench/workbench/workbench.component';
import { DesktopIconsComponent } from '../desktop-icons/desktop-icons.component';
import { DesktopTaskbarComponent } from '../desktop-taskbar/desktop-taskbar.component';
import { desktopLayout } from '../presenters/desktop-layout';
import { APP_WINDOW_IDS, DESKTOP_APPS, DesktopAppId, DesktopService } from '../services/desktop.service';

/** 三個應用主視窗的預設版面（WindowShell 的 defaults）。 */
type AppDefaults = Readonly<Record<DesktopAppId, WindowShellDefaults>>;

/**
 * /work 電腦桌面（R12 §5）：整個 viewport、頁面本身不捲動；桌面區＋底部常駐工作列。
 *
 * - 桌面區（position: relative、低對比點陣）左上是應用入口；視窗圖層蓋在上面，所有 WindowShell
 *   （應用主視窗、案件文件、郵件附件、紀錄窗）都移到這一層、以桌面座標浮動。桌面區尺寸以
 *   ResizeObserver 回報給 WindowManagerService（setBounds）。
 * - 應用主視窗：工作平台（app.work）、通訊（app.messages）、郵件（app.mail）桌面存在期間一直掛載，
 *   關閉只隱藏、狀態與草稿保留；每個應用只有一個主視窗，不在主視窗裡另嵌頁面。
 *   這份存檔第一次進桌面時打開工作平台（DesktopService.beginSession）；通訊與郵件預設關閉，
 *   從入口、捷徑、舊網址或視窗列開啟。註冊前被要求開啟的應用在註冊後開啟（flushPending）。
 * - 輔助視窗在桌面層：系統作業紀錄（當日保存的事件＋目前這件提交的逐階段輸出）與郵件附件。
 * - 預設版面由 desktopLayout(bounds) 計算：工作平台大、通訊／郵件錯開；紀錄窗在右下，不遮工作平台的操作。
 * - 分頁標題依最上層的應用：工作平台（工作／公告）、通訊、郵件；都沒有顯示時為「桌面」。
 */
@Component({
  selector: 'app-desktop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DesktopIconsComponent,
    DesktopTaskbarComponent,
    ExecutionLogComponent,
    MailAttachmentWindowsComponent,
    MailComponent,
    MessagesComponent,
    WindowShellComponent,
    WorkbenchComponent,
  ],
  templateUrl: './desktop.component.html',
  styleUrl: './desktop.component.css',
})
export class DesktopComponent {
  private readonly game = inject(GameStateService);
  private readonly ops = inject(WorkOperationsService);
  private readonly windows = inject(WindowManagerService);
  private readonly desktop = inject(DesktopService);
  private readonly workbenchView = inject(WorkbenchViewService);
  private readonly title = inject(Title);

  private readonly area = viewChild.required<ElementRef<HTMLElement>>('area');
  private readonly layer = viewChild.required<ElementRef<HTMLElement>>('layer');

  protected readonly ui = DESKTOP_UI;
  protected readonly ids = APP_WINDOW_IDS;

  /** 視窗圖層已設定、桌面尺寸已量到：此後才掛上視窗（預設位置依實際桌面大小）。 */
  protected readonly ready = signal(false);

  private readonly layout = computed(() => {
    const bounds = this.windows.bounds();
    return bounds ? desktopLayout(bounds) : null;
  });

  protected readonly appDefaults = computed<AppDefaults | null>(() => {
    const l = this.layout();
    if (!l) return null;
    return {
      work: { ...l.work },
      messages: { ...l.messages, mode: 'closed' },
      mail: { ...l.mail, mode: 'closed' },
    };
  });

  /** 紀錄窗預設：右下角、會讓位（被第一次開啟的文件蓋到時自動最小化）；桌面太窄時預設最小化。 */
  protected readonly logDefaults = computed<WindowShellDefaults | null>(() => {
    const l = this.layout();
    return l ? { ...l.log, yields: true } : null;
  });

  /**
   * 系統作業紀錄：由當日保存的事件、批次快照與工作清單推導（純函式 presenter），
   * 再接上目前這件提交的逐階段輸出；換日後只剩新一天的事件，不序列化存檔。
   */
  protected readonly logEntries = computed(() => {
    const save = this.game.save();
    if (!save) return [];
    const tasks = this.game.dayTasks();
    return withOperation(buildExecutionLog({ events: this.game.dayEvents(), save, tasks }), this.ops.current(), tasks);
  });

  /** 最上層、顯示中的應用（決定分頁標題）；都沒有顯示時為 null。 */
  private readonly topApp = computed<DesktopAppId | null>(() => {
    const list = this.windows.windows();
    this.windows.mounted();
    this.windows.compactActive();
    let top: { app: DesktopAppId; z: number } | null = null;
    for (const app of DESKTOP_APPS) {
      const w = list.find((x) => x.id === APP_WINDOW_IDS[app]);
      if (!w || !this.windows.isShown(w.id)) continue;
      if (!top || w.z > top.z) top = { app, z: w.z };
    }
    return top?.app ?? null;
  });

  constructor() {
    const save = this.game.save();
    if (save && this.desktop.beginSession(save.seed)) this.desktop.openApp('work');

    // 主視窗註冊後，開啟註冊前被要求開啟的應用（入口、捷徑、舊網址、首次進桌面）
    effect(() => {
      for (const app of DESKTOP_APPS) {
        if (this.windows.state(APP_WINDOW_IDS[app])() !== undefined) untracked(() => this.desktop.flushPending(app));
      }
    });

    effect(() => {
      const app = this.topApp();
      const day = this.game.dayContent()?.day ?? 0;
      const view = app === 'work' ? this.workbenchView.view() : app;
      this.title.setTitle(pageTitle(view === null ? DESKTOP_UI.docTitle : WORKBENCH.docTitle(day, view)));
    });

    // 視窗圖層與桌面尺寸：第一次繪製後量一次，之後由 ResizeObserver 追蹤（縮小時重新限制視窗座標）
    let observer: ResizeObserver | null = null;
    afterNextRender(() => {
      const area = this.area().nativeElement;
      this.windows.setLayer(this.layer().nativeElement);
      this.measure(area);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => this.measure(area));
        observer.observe(area);
      }
      this.ready.set(true);
    });

    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      if (this.windows.layer() === this.layer().nativeElement) this.windows.setLayer(null);
    });
  }

  protected retryOperation(): void {
    void this.ops.retry();
  }

  private measure(el: HTMLElement): void {
    if (el.clientWidth > 0 && el.clientHeight > 0) this.windows.setBounds(el.clientWidth, el.clientHeight);
  }
}
