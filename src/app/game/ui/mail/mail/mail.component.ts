import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MAIL_UI } from '../../../content/text';
import { MailAttachment } from '../../../core/types';
import { GameStateService } from '../../../state/game-state.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { MailListComponent } from '../mail-list/mail-list.component';
import { MailReaderComponent } from '../mail-reader/mail-reader.component';
import { MailView, buildMailViews, mailCounts, mailMatches } from '../presenters/mail-view';
import { MailAttachmentService } from '../services/mail-attachment.service';
import { MailNavigationService } from '../services/mail-navigation.service';

/** 容器寬度小於這個值（px）時改成先清單、後閱讀的單欄。 */
const NARROW_WIDTH = 640;

/**
 * 郵件應用（R12 §3）：收件清單＋閱讀區。桌面把它放在「郵件」主視窗內。
 *
 * - 收件匣新的在前；篩選全部郵件／未讀／待處理（件數＋各自的空狀態）。開收件匣、切篩選都不標已讀；
 *   只有選取一封信（MailNavigationService.open）才標已讀。郵件已讀與案件是否解決無關。
 * - 篩選中仍保留目前閱讀的那封（例如在「未讀」讀完後不會從清單消失、焦點不遺失）；件數照實際狀態。
 * - 窄視窗（小螢幕單窗，或郵件視窗寬度不足）先顯示清單，選信後顯示閱讀區並提供返回清單；焦點隨之移動。
 * - 選取與篩選在 root 的 MailNavigationService：最小化、關閉郵件視窗後再開仍在。
 * - 附件「開啟文件」交給 MailAttachmentService，在桌面層開啟獨立的文件視窗。
 * - 內容讀不到（郵件包或模板不存在）顯示讀取失敗與重新讀取（重新計算，不假裝載入）。
 */
@Component({
  selector: 'app-mail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mail-app', '[class.is-narrow]': 'narrow()' },
  imports: [MailListComponent, MailReaderComponent],
  templateUrl: './mail.component.html',
  styleUrl: './mail.component.css',
})
export class MailComponent {
  private readonly game = inject(GameStateService);
  protected readonly nav = inject(MailNavigationService);
  private readonly attachments = inject(MailAttachmentService);
  private readonly windows = inject(WindowManagerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly t = MAIL_UI;

  private readonly listRef = viewChild(MailListComponent);
  private readonly readerRef = viewChild(MailReaderComponent);

  /** 重新讀取：遞增後重新計算整個收件匣（內容是靜態資料，不另做載入等待）。 */
  private readonly reload = signal(0);
  private readonly width = signal<number | null>(null);

  /** 收件匣（新的在前）；整體組不出來時為 null（顯示讀取失敗）。 */
  protected readonly views = computed<readonly MailView[] | null>(() => {
    this.reload();
    try {
      // M1 回條：附件名取文件視窗標題，表格與附件狀態取保存的批次輸出與附件版本
      return buildMailViews(this.game.mailbox(), this.game.returns(), (id) => this.game.isMailRead(id), this.game.save(), (ref) =>
        this.attachments.titleOf(ref),
      );
    } catch {
      return null;
    }
  });

  protected readonly counts = computed(() => mailCounts(this.views() ?? []));

  protected readonly selected = computed<MailView | null>(() => {
    const id = this.nav.selectedId();
    return (id && this.views()?.find((v) => v.id === id)) || null;
  });

  /** 目前篩選要列出的信件；閱讀中的那封一律保留。 */
  protected readonly rows = computed<readonly MailView[]>(() => {
    const filter = this.nav.filter();
    const selectedId = this.nav.selectedId();
    return (this.views() ?? []).filter((v) => mailMatches(v, filter) || v.id === selectedId);
  });

  /** 單欄：小螢幕單窗顯示，或郵件視窗本身寬度不足。 */
  protected readonly narrow = computed(() => {
    const w = this.width();
    return this.windows.compact() || (w !== null && w > 0 && w < NARROW_WIDTH);
  });

  constructor() {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        const w = Math.round(entry?.contentRect.width ?? this.host.clientWidth);
        if (w !== this.width()) this.width.set(w);
      });
      observer.observe(this.host);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }

  /** 選取一封信（這時才標已讀）；窄視窗改顯示閱讀區，焦點移到主旨。 */
  protected onSelect(id: string): void {
    if (!this.nav.open(id)) return;
    if (this.narrow()) this.afterRender(() => this.readerRef()?.focusHeading());
  }

  /** 窄視窗返回清單：焦點回到原本那封信。 */
  protected onBack(): void {
    const id = this.nav.selectedId();
    this.nav.close();
    this.afterRender(() => this.listRef()?.focusRow(id));
  }

  protected onOpenAttachment(ref: MailAttachment): void {
    this.attachments.open(ref);
  }

  protected onRetry(): void {
    this.reload.update((n) => n + 1);
  }

  private afterRender(fn: () => void): void {
    afterNextRender(fn, { injector: this.injector });
  }
}
