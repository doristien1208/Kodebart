import { Injectable, Signal, signal } from '@angular/core';

/** 工作平台內部的視圖：目前工作或公司公告（通訊與郵件是桌面上的其他應用，不在這裡）。 */
export type WorkbenchView = 'work' | 'news';

/**
 * 工作平台目前的視圖（R12 §5）：只存在本次工作階段，不寫進存檔、不用子路由。
 * 視窗關閉／最小化、切換其他應用或離開桌面再回來都保留；舊網址 /work/news 由路由守衛切到公告。
 */
@Injectable({ providedIn: 'root' })
export class WorkbenchViewService {
  private readonly _view = signal<WorkbenchView>('work');
  readonly view: Signal<WorkbenchView> = this._view.asReadonly();

  show(view: WorkbenchView): void {
    this._view.set(view);
  }
}
