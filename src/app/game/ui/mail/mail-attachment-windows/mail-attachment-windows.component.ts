import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameStateService } from '../../../state/game-state.service';
import { WindowShellComponent } from '../../shared/window-shell/window-shell.component';
import { AttachmentDocumentComponent } from '../attachment-document/attachment-document.component';
import { attachmentWindowTitle } from '../presenters/mail-view';
import { MailAttachmentService } from '../services/mail-attachment.service';

/**
 * 郵件附件視窗群（R12 §1／§3）：桌面層常駐，渲染目前開啟的附件文件視窗（每份回條版本一個視窗）。
 * 郵件主視窗最小化或關閉時附件仍保留；視窗關閉只隱藏（內容與草稿不受影響），從郵件再開啟時置前。
 * 標題為附件名（案號｜版本｜核對結果），同一案件不同版本的視窗可以並排比對。
 */
@Component({
  selector: 'app-mail-attachment-windows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [WindowShellComponent, AttachmentDocumentComponent],
  templateUrl: './mail-attachment-windows.component.html',
})
export class MailAttachmentWindowsComponent {
  private readonly game = inject(GameStateService);
  private readonly attachments = inject(MailAttachmentService);

  protected readonly windows = computed(() => {
    const returns = this.game.returns();
    return this.attachments.openWindows().map((o) => ({ ...o, title: attachmentWindowTitle(returns, o.ref) }));
  });
}
