import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DESKTOP_UI } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { AppIconComponent } from '../app-icon/app-icon.component';

let menuSeq = 0;

/**
 * 桌面主選單（R12 §5）：工作列最左的圖示按鈕＋有文字的選項，只放有功能的三項：
 * 返回開始頁（不清空、不重開遊戲；草稿都在存檔）、動態效果（SettingsService.motion）、重設視窗位置。
 *
 * - 展開／收合的揭示按鈕（aria-expanded、aria-controls）；展開時焦點移到第一個選項。
 * - Escape 關閉並把焦點還給選單按鈕；點選單外任一處關閉（焦點不搬動）。
 * - 選單浮在工作列上方、所有視窗之上；不是對話框，不鎖焦點。
 */
@Component({
  selector: 'app-main-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppIconComponent],
  host: {
    class: 'main-menu',
    '(document:keydown.escape)': 'onEscape()',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.css',
})
export class MainMenuComponent {
  private readonly router = inject(Router);
  private readonly windows = inject(WindowManagerService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly settings = inject(SettingsService);

  protected readonly ui = DESKTOP_UI.menu;
  protected readonly panelId = `main-menu-${++menuSeq}`;
  protected readonly open = signal(false);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly firstItem = viewChild.required<ElementRef<HTMLButtonElement>>('firstItem');

  protected toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    afterNextRender(() => this.firstItem().nativeElement.focus(), { injector: this.injector });
  }

  protected backToCover(): void {
    this.open.set(false);
    void this.router.navigateByUrl('/');
  }

  protected setMotion(event: Event): void {
    this.settings.setMotion((event.target as HTMLInputElement).checked);
  }

  protected resetLayout(): void {
    this.windows.resetLayout();
    this.close(true);
  }

  protected onEscape(): void {
    if (this.open()) this.close(true);
  }

  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.open()) return;
    const target = event.target as Node | null;
    if (target && this.host.contains(target)) return;
    this.close(false);
  }

  private close(returnFocus: boolean): void {
    this.open.set(false);
    if (returnFocus) this.trigger().nativeElement.focus();
  }
}
