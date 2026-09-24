import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GameStateService } from '../../state/game-state.service';
import { routeForSave } from '../../state/stage-route';

/**
 * 沒有存檔 → 回開始頁；存檔應在的畫面與路徑不符 → 導向該畫面。
 * 入職前情未完成時一律是 /onboarding（R12）；之後依通用階段：/work（含子路由）、/overnight、/morning、/end。
 * 日別不影響路徑；同日換工作仍是 work，不會離開 /work。
 */
export const stageGuard: CanActivateFn = (_route, state) => {
  const game = inject(GameStateService);
  const router = inject(Router);
  const save = game.save();
  if (!save) return router.createUrlTree(['/']);
  const expected = routeForSave(save);
  return state.url === expected || state.url.startsWith(expected + '/') || state.url.startsWith(expected + '?')
    ? true
    : router.createUrlTree([expected]);
};
