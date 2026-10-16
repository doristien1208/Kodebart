import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameStateService } from '../../../state/game-state.service';
import { WindowShellComponent } from '../../shared/window-shell/window-shell.component';
import { WorkDocumentComponent } from '../../shared/work-document/work-document.component';
import { AttachmentDocumentComponent } from '../attachment-document/attachment-document.component';
import { MailAttachmentService } from '../services/mail-attachment.service';

/**
 * 郵件附件視窗群（R12 §1／§3）：桌面層常駐，渲染目前開啟的附件文件視窗（每份回條版本一個視窗）。
 * 郵件主視窗最小化或關閉時附件仍保留；視窗關閉只隱藏（內容與草稿不受影響），從郵件再開啟時置前。
 * 標題為附件名（案號｜版本｜核對結果），同一案件不同版本的視窗可以並排比對。
 * M1：同一個視窗群也呈現工作與郵件開啟的文件（來源、送件副本、附件關聯版本、批次副本／預覽）。
 */
@Component({
  selector: 'app-mail-attachment-windows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [WindowShellComponent, AttachmentDocumentComponent, WorkDocumentComponent],
  templateUrl: './mail-attachment-windows.component.html',
})
export class MailAttachmentWindowsComponent {
  private readonly game = inject(GameStateService);
  private readonly attachments = inject(MailAttachmentService);

  protected readonly windows = computed(() => {
    // 標題依存檔推導（退件回條取案件；M1 文件取保存的版本與內容）；存檔改變時重算
    this.game.save();
    return this.attachments.openWindows().map((o) => ({ ...o, title: this.attachments.titleOf(o.ref) }));
  });
}
