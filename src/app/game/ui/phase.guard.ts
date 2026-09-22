import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GameStateService } from '../state/game-state.service';
import { routeForPhase } from '../state/phase-route';

/**
 * 沒有存檔 → 回開始頁；phase 與路徑不符 → 導向該 phase 的畫面。
 * 掛在 /work（含子路由）、/overnight、/end。
 */
export const phaseGuard: CanActivateFn = (_route, state) => {
  const game = inject(GameStateService);
  const router = inject(Router);
  const save = game.save();
  if (!save) return router.createUrlTree(['/']);
  const expected = routeForPhase(save.phase);
  return state.url === expected || state.url.startsWith(expected + '/') || state.url.startsWith(expected + '?')
    ? true
    : router.createUrlTree([expected]);
};
