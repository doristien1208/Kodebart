import { Injectable, computed, inject, signal } from '@angular/core';
import { MailAttachment } from '../../../core/types';
import { GameStateService } from '../../../state/game-state.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { WindowShellDefaults } from '../../shared/window-shell/window-shell.component';
import { attachmentWindowTitle } from '../presenters/mail-view';

/** 附件文件視窗的 window ID：每份回條（版本）一個視窗。 */
export function attachmentWindowId(ref: MailAttachment): string {
  return `mail.attachment.${ref.receiptId}`;
}

/** 一個開啟過的附件視窗。 */
export interface OpenAttachment {
  windowId: string;
  ref: MailAttachment;
  /** 第一次開啟時的位置與尺寸（也是「重設視窗位置」回到的值）。 */
  defaults: WindowShellDefaults;
  /** 開啟時的存檔 seed：換了一局（新遊戲）就不再列出上一局的附件。 */
  seed: number;
}

/** 附件視窗的預設尺寸與疊放間距（px）。 */
const ATTACHMENT_WINDOW = { width: 560, height: 620, margin: 24, cascade: 28, cascadeSteps: 6 } as const;
/** 尚未量到桌面時（例如單元測試）假設的尺寸。 */
const FALLBACK_BOUNDS = { width: 1180, height: 640 } as const;

/**
 * 郵件附件視窗（R12 §1／§3）：本次工作階段開啟過的附件（root，關閉郵件應用、切換應用都保留）。
 *
 * - open(ref)：第一次開啟時直接向視窗管理服務註冊並置前（視窗元件掛上後沿用同一狀態）；
 *   已開啟過的只重新開啟／置前。視窗關閉只隱藏，再開啟時內容（草稿在存檔）照舊。
 * - 預設放在桌面右側、依開啟順序錯開，不遮住左側的工作平台；寬度與高度不超過桌面。
 * - 視窗 ID 以回條區分版本；同一案件的不同版本各自一個視窗。
 */
@Injectable({ providedIn: 'root' })
export class MailAttachmentService {
  private readonly windows = inject(WindowManagerService);
  private readonly game = inject(GameStateService);

  private readonly _open = signal<readonly OpenAttachment[]>([]);

  /** 目前這一局開啟過的附件視窗（依開啟順序）。 */
  readonly openWindows = computed<readonly OpenAttachment[]>(() => {
    const seed = this.game.save()?.seed;
    return this._open().filter((o) => o.seed === seed);
  });
  /** 目前這一局開啟過的附件引用。 */
  readonly openRefs = computed<readonly MailAttachment[]>(() => this.openWindows().map((o) => o.ref));

  /** 開啟（或重新開啟、置前）附件文件視窗。 */
  open(ref: MailAttachment): void {
    const seed = this.game.save()?.seed;
    if (seed === undefined) return;
    const windowId = attachmentWindowId(ref);
    if (!this.openWindows().some((o) => o.windowId === windowId)) {
      const defaults = this.defaultsFor(this.openWindows().length);
      this._open.update((list) => [...list.filter((o) => o.windowId !== windowId), { windowId, ref, defaults, seed }]);
      this.windows.register(windowId, { ...defaults, title: attachmentWindowTitle(this.game.returns(), ref) });
    }
    this.windows.open(windowId);
  }

  /** 第 n 個附件視窗的預設位置：桌面右側，依序往左下錯開。 */
  private defaultsFor(n: number): WindowShellDefaults {
    const b = this.windows.bounds() ?? FALLBACK_BOUNDS;
    const w = ATTACHMENT_WINDOW;
    const width = Math.min(w.width, Math.max(0, b.width - w.margin * 2));
    const height = Math.min(w.height, Math.max(0, b.height - w.margin * 2));
    const step = (n % w.cascadeSteps) * w.cascade;
    return {
      x: Math.max(0, b.width - width - w.margin - step),
      y: Math.min(w.margin + step, Math.max(0, b.height - height)),
      width,
      height,
    };
  }
}
