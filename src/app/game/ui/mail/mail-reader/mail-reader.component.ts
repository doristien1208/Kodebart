import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { DOCUMENT_ISSUES_UI, MAIL_UI } from '../../../content/text';
import { MailAttachment } from '../../../core/types';
import { MailView } from '../presenters/mail-view';

let readerSeq = 0;

/**
 * 郵件閱讀區（R12 §3，DESIGN「郵件」）：主旨、寄件者、收到時間、正文、附件，層級依序。
 *
 * 純呈現元件：只吃 input、吐 output。附件列出附件名與版本狀態文字，「開啟文件」交給容器開啟附件視窗；
 * 找不到的附件只顯示說明、不提供開啟（不誤開最新版本）。郵件包或模板讀不到時顯示讀取失敗與重新讀取。
 * 窄視窗（showBack）時上方有返回清單。正文以文字插值呈現，不解析 HTML。
 */
@Component({
  selector: 'app-mail-reader',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  templateUrl: './mail-reader.component.html',
  styleUrl: './mail-reader.component.css',
})
export class MailReaderComponent {
  readonly mail = input.required<MailView>();
  /** 窄視窗：顯示返回清單。 */
  readonly showBack = input(false);

  readonly back = output<void>();
  readonly openAttachment = output<MailAttachment>();
  /** 讀取失敗後重新讀取。 */
  readonly retry = output<void>();

  protected readonly t = MAIL_UI;
  protected readonly backLabel = DOCUMENT_ISSUES_UI.close;
  private readonly seq = ++readerSeq;
  protected readonly headingId = `mail-subject-${this.seq}`;
  protected readonly attachmentsId = `mail-attachments-${this.seq}`;

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** 容器在窄視窗選取郵件後把焦點移到主旨。 */
  focusHeading(): void {
    this.heading()?.nativeElement.focus();
  }
}
