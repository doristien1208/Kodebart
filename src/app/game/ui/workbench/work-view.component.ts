import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameStateService } from '../../state/game-state.service';
import { Day1ArchiveComponent } from '../day1/day1-archive.component';
import { Day2ReconcileComponent } from '../day2/day2-reconcile.component';

/** /work 子路由：依存檔 day 切換第一日歸檔或第二日核對。 */
@Component({
  selector: 'app-work-view',
  imports: [Day1ArchiveComponent, Day2ReconcileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (game.day() === 1) {
      <app-day1-archive />
    } @else {
      <app-day2-reconcile />
    }
  `,
})
export class WorkViewComponent {
  protected readonly game = inject(GameStateService);
}
