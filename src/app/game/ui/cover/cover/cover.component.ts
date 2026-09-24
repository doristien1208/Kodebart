import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { COVER, NEW_GAME_DIALOG, SETTINGS_DIALOG, pageTitle } from '../../../content/text';
import { SettingsService } from '../../../platform/settings.service';
import { GameStateService } from '../../../state/game-state.service';
import { routeForSave } from '../../../state/stage-route';
import { ModalDialogComponent } from '../../shared/modal-dialog/modal-dialog.component';
import { CoverSceneComponent } from '../cover-scene/cover-scene.component';
import { CoverTitleComponent } from '../cover-title/cover-title.component';

/**
 * 開始頁（KB-R4-02 後）：只負責頁面協調——導航、新遊戲流程與設定。
 * 場景動畫（背景圖、雨、走廊燈光）屬 CoverSceneComponent，
 * 標題 glitch 屬 CoverTitleComponent，對話框焦點屬 ModalDialogComponent。
 * 開始／繼續都導向 routeForSave（R12）：入職未完成 → /onboarding，否則依存檔 stage。
 */
@Component({
  selector: 'app-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CoverSceneComponent, CoverTitleComponent, ModalDialogComponent],
  templateUrl: './cover.component.html',
  styleUrl: './cover.component.css',
})
export class CoverComponent {
  protected readonly game = inject(GameStateService);
  protected readonly settings = inject(SettingsService);
  private readonly router = inject(Router);

  protected readonly text = COVER;
  protected readonly newGameText = NEW_GAME_DIALOG;
  protected readonly settingsText = SETTINGS_DIALOG;

  private readonly newGameDialog = viewChild.required<ModalDialogComponent>('newGameDialog');
  private readonly settingsDialog = viewChild.required<ModalDialogComponent>('settingsDialog');
  private readonly startBtn = viewChild.required<ElementRef<HTMLButtonElement>>('startBtn');
  private readonly settingsBtn = viewChild.required<ElementRef<HTMLButtonElement>>('settingsBtn');

  /**
   * 選單下方提示：有存檔顯示進度標籤（由目前日序＋stage 經 JSON 樣板產生，例如「第三日」），
   * 否則「尚無本機紀錄」。流程判斷一律走 stage()。
   */
  protected readonly saveHelp = computed(() =>
    this.game.hasSave() ? COVER.savePrefix + this.game.progressText() : COVER.noSave,
  );

  constructor() {
    inject(Title).setTitle(pageTitle(COVER.docTitle));
  }

  /** 開始遊戲：已有紀錄（或讀取失敗）時先確認覆蓋，預設焦點放「保留目前紀錄」。 */
  protected onStart(): void {
    if (this.game.needsOverwriteConfirm()) {
      this.newGameDialog().open(this.startBtn().nativeElement);
      return;
    }
    this.startNewGame();
  }

  /** 繼續：入職未完成回到原段落，舊存檔（無姓名、入職視為完成）直接回工作階段。 */
  protected onContinue(): void {
    const save = this.game.save();
    if (!save) return;
    void this.router.navigateByUrl(routeForSave(save));
  }

  protected openSettings(): void {
    this.settingsDialog().open(this.settingsBtn().nativeElement);
  }

  protected confirmNewGame(): void {
    this.newGameDialog().close();
    this.startNewGame();
  }

  protected onMotionChange(event: Event): void {
    this.settings.setMotion((event.target as HTMLInputElement).checked);
  }

  /** 確認（或不需確認）之後才建立新存檔，再進入職前情。 */
  private startNewGame(): void {
    this.game.newGame();
    const save = this.game.save();
    void this.router.navigateByUrl(save ? routeForSave(save) : '/');
  }
}
