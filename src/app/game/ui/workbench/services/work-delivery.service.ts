import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GameStateService } from '../../../state/game-state.service';
import { routeForStage } from '../../../state/stage-route';

/**
 * 交付與收班（M1 §3）：所有工作元件的「交付此項工作／完成今日交接」都經過這裡。
 *
 * - 當日還有其他工作：直接交付，留在桌面換下一件。
 * - 當日最後一件：先在工作平台打開「本日交接」（交付清單與留待下一工作日），玩家確認後才交付、離開桌面。
 *   交接面板只存在本次工作階段；重新整理後再按一次交付即可，不會重複交付（交付本身仍由核心規則防重）。
 */
@Injectable({ providedIn: 'root' })
export class WorkDeliveryService {
  private readonly game = inject(GameStateService);
  private readonly router = inject(Router);

  private readonly requested = signal<string | null>(null);

  /** 本日交接面板開著（只對要求時的那一件、仍是最後一件且已完成時成立）。 */
  readonly handoffOpen = computed(() => {
    const id = this.requested();
    return id !== null && id === this.game.taskId() && this.game.stage() === 'work' && this.game.isLastTask() && this.game.taskDone();
  });

  /** 交付目前工作；最後一件改為打開本日交接。回傳是否有動作。 */
  deliver(): boolean {
    if (this.game.stage() !== 'work' || !this.game.taskDone()) return false;
    if (this.game.isLastTask()) {
      this.requested.set(this.game.taskId());
      return true;
    }
    return this.game.completeWork();
  }

  /** 確認本日交接：交付最後一件，依新 stage 離開桌面（日結或結束）。 */
  confirmHandoff(): boolean {
    if (!this.handoffOpen() || !this.game.completeWork()) return false;
    this.requested.set(null);
    const stage = this.game.stage();
    void this.router.navigateByUrl(stage ? routeForStage(stage) : '/');
    return true;
  }

  cancelHandoff(): void {
    this.requested.set(null);
  }
}
