import { Injectable, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../../state/game-state.service';
import { DesktopService } from '../../desktop/services/desktop.service';
import { MailFilter, latestMailOfCase } from '../presenters/mail-view';
import { MailAttachmentService } from './mail-attachment.service';

/**
 * 郵件應用的選取狀態（R12 §3）：root 服務，郵件視窗最小化／關閉、切換應用後仍記得選了哪封信與篩選。
 *
 * - 只有 open()（玩家選取一封信、或從當日工作開啟最新郵件）會標已讀；開收件匣、切篩選都不會。
 * - 選取綁在目前這一局（存檔 seed）：回到開始頁另開新局時不沿用上一局的選取，
 *   避免同一個回條 ID 的新郵件未經開啟就顯示在閱讀區。
 */
@Injectable({ providedIn: 'root' })
export class MailNavigationService {
  private readonly game = inject(GameStateService);
  private readonly desktop = inject(DesktopService);
  private readonly attachments = inject(MailAttachmentService);

  private readonly selection = signal<{ id: string; seed: number } | null>(null);
  private readonly _filter = signal<MailFilter>('all');

  /** 目前選取（閱讀中）的郵件 ID；沒有選取或不是這一局的選取時為 null。 */
  readonly selectedId = computed<string | null>(() => {
    const s = this.selection();
    const save = this.game.save();
    if (!s || !save || s.seed !== save.seed || !save.mailbox.some((m) => m.id === s.id)) return null;
    return s.id;
  });
  /** 收件清單的篩選。 */
  readonly filter = this._filter.asReadonly();

  /** 開啟（選取）一封郵件：這時才標已讀。回傳是否有這封信。 */
  open(mailId: string): boolean {
    const save = this.game.save();
    if (!save || !save.mailbox.some((m) => m.id === mailId)) return false;
    this.selection.set({ id: mailId, seed: save.seed });
    if (!this.game.isMailRead(mailId)) this.game.markMailRead([mailId]);
    return true;
  }

  /** 回到清單（窄視窗的返回）；不改已讀。 */
  close(): void {
    this.selection.set(null);
  }

  setFilter(filter: MailFilter): void {
    this._filter.set(filter);
  }

  /**
   * 當日工作「開啟最新郵件」：打開郵件應用、選取該案件最新回條的郵件（標已讀）並開啟它的附件文件。
   * 找不到郵件時回傳 false，不開其他版本。
   */
  openLatestOfCase(caseId: string): boolean {
    const found = latestMailOfCase(this.game.mailbox(), this.game.returns(), caseId);
    if (!found) return false;
    this.desktop.openApp('mail');
    this.open(found.mail.id);
    this.attachments.open(found.ref);
    return true;
  }
}
