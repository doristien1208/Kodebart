import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { CanActivateFn, Routes } from '@angular/router';
import { stageGuard } from './game/ui/guards/stage.guard';

/** 桌面舊網址的守衛（見 openAppFromRoute）；延後載入，桌面相關程式不進初始 bundle。 */
const openAppGuard: CanActivateFn = (route) => {
  const injector = inject(EnvironmentInjector);
  return import('./game/ui/desktop/guards/open-app.guard').then((m) =>
    runInInjectionContext(injector, () => m.openAppFromRoute(route)),
  );
};

/**
 * 畫面結構（doc/KodeBart-Demo-Spec.md §2／R12）：
 *  /            開始頁（封面：開始／繼續／設定）
 *  /onboarding  入職前情與簽名（入職未完成的存檔）
 *  /work        電腦桌面（工作平台、通訊、郵件三個應用視窗＋底部工作列；依目前日的工作種類顯示歸檔、核對或欄位映射）
 *  /work/messages、/work/mail、/work/issues、/work/news
 *               舊網址：開啟對應應用（issues → 郵件；news → 工作平台的公告）後導回 /work，不另開頁面
 *  /overnight   本日交接（Stage wrap；當日全部工作完成、且有下一日時）
 *  /morning     次日收件（Stage morning；跨日後、開始新一日工作前；新遊戲的第一日不經過）
 *  /end         Demo 結束（Stage end；最後一日結束後）
 *  除封面外都掛 stageGuard：目前畫面一律由存檔決定（routeForSave；重載、返回、深連結一致）。
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./game/ui/cover/cover/cover.component').then((m) => m.CoverComponent),
  },
  {
    // 入職前情與簽名（R12 §6）：只有入職未完成的存檔停在這裡（routeForSave）
    path: 'onboarding',
    canActivate: [stageGuard],
    loadComponent: () =>
      import('./game/ui/onboarding/onboarding/onboarding.component').then((m) => m.OnboardingComponent),
  },
  {
    path: 'work',
    canActivate: [stageGuard],
    loadComponent: () => import('./game/ui/desktop/desktop/desktop.component').then((m) => m.DesktopComponent),
    // 子路由不渲染頁面（沒有 router-outlet）：'' 就是桌面；其餘由 openAppGuard 開應用後導回 /work
    children: [
      { path: '', pathMatch: 'full', children: [] },
      { path: 'messages', canActivate: [openAppGuard], data: { app: 'messages' }, children: [] },
      { path: 'mail', canActivate: [openAppGuard], data: { app: 'mail' }, children: [] },
      { path: 'issues', canActivate: [openAppGuard], data: { app: 'mail' }, children: [] },
      { path: 'news', canActivate: [openAppGuard], data: { app: 'work', workView: 'news' }, children: [] },
    ],
  },
  {
    path: 'overnight',
    canActivate: [stageGuard],
    loadComponent: () => import('./game/ui/transition/overnight/overnight.component').then((m) => m.OvernightComponent),
  },
  {
    path: 'morning',
    canActivate: [stageGuard],
    loadComponent: () => import('./game/ui/transition/morning/morning.component').then((m) => m.MorningComponent),
  },
  {
    path: 'end',
    canActivate: [stageGuard],
    loadComponent: () => import('./game/ui/transition/end/end.component').then((m) => m.EndComponent),
  },
  { path: '**', redirectTo: '' },
];
