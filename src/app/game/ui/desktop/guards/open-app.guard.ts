import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { WorkbenchView, WorkbenchViewService } from '../../workbench/services/workbench-view.service';
import { DesktopAppId, DesktopService } from '../services/desktop.service';

/** 舊網址（/work/messages、/work/mail、/work/issues、/work/news）的路由資料：要開的應用與工作平台視圖。 */
export interface OpenAppRouteData {
  app: DesktopAppId;
  workView?: WorkbenchView;
}

/**
 * 桌面子路由守衛的本體（R12 §5；需在注入環境中呼叫，app.routes 延後載入後以 runInInjectionContext 執行）：
 * 不渲染任何頁面，只開啟（或置前）對應的應用主視窗，再導回 /work。
 * 桌面尚未掛載時 openApp 會先記下，主視窗註冊後開啟；父路由的 stageGuard 已先確認目前應在桌面。
 * /work/issues 導向郵件（「文件問題」頁由郵件取代），/work/news 開工作平台並切到公告。
 */
export function openAppFromRoute(route: ActivatedRouteSnapshot): UrlTree {
  const data = route.data as Partial<OpenAppRouteData>;
  if (data.workView) inject(WorkbenchViewService).show(data.workView);
  if (data.app) inject(DesktopService).openApp(data.app);
  return inject(Router).createUrlTree(['/work']);
}
