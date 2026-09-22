import { Routes } from '@angular/router';
import { phaseGuard } from './game/ui/phase.guard';

/**
 * 畫面結構（doc/KodeBart-Demo-Spec.md §2）：
 *  /            開始頁（封面：開始／繼續／設定）
 *  /work        工作台（Day1 歸檔或 Day2 核對，依 phase）
 *  /work/messages  同事訊息
 *  /work/news      公司公告
 *  /overnight   Day1 結束轉場
 *  /end         Demo 結束
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./game/ui/cover/cover.component').then((m) => m.CoverComponent),
  },
  {
    path: 'work',
    canActivate: [phaseGuard],
    loadComponent: () => import('./game/ui/workbench/workbench.component').then((m) => m.WorkbenchComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        data: { view: 'work' },
        loadComponent: () => import('./game/ui/workbench/work-view.component').then((m) => m.WorkViewComponent),
      },
      {
        path: 'messages',
        data: { view: 'messages' },
        loadComponent: () => import('./game/ui/messages/messages.component').then((m) => m.MessagesComponent),
      },
      {
        path: 'news',
        data: { view: 'news' },
        loadComponent: () => import('./game/ui/news/news.component').then((m) => m.NewsComponent),
      },
    ],
  },
  {
    path: 'overnight',
    canActivate: [phaseGuard],
    loadComponent: () => import('./game/ui/transition/overnight.component').then((m) => m.OvernightComponent),
  },
  {
    path: 'end',
    canActivate: [phaseGuard],
    loadComponent: () => import('./game/ui/transition/end.component').then((m) => m.EndComponent),
  },
  { path: '**', redirectTo: '' },
];
