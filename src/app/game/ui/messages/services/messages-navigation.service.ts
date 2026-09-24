import { Injectable, Signal, signal } from '@angular/core';

/** 要求對話串捲到某一列（例如向同事詢問後定位到自己的提問）。seq 讓重複要求同一列也會觸發。 */
export interface RevealTarget {
  channelId: string;
  /** timeline 列 ID（內容訊息 ID、回應 ID 或 `<requestId>:you`）。 */
  entryId: string;
  seq: number;
}

/**
 * 通訊應用的畫面狀態（R12 §2／§4）：目前開啟的對話與定位要求。
 *
 * root 服務：通訊主視窗最小化、關閉或切換應用都保留選取；其他應用（歸檔表單的「這個欄位是什麼？」）
 * 可以要求開啟某個對話並定位到某一列。只在畫面層，不寫存檔；選取本身不代表已讀。
 */
@Injectable({ providedIn: 'root' })
export class MessagesNavigationService {
  private readonly _selectedId = signal<string | null>(null);
  private readonly _reveal = signal<RevealTarget | null>(null);
  private seq = 0;

  /** 目前開啟的對話；null＝只顯示列表。 */
  readonly selectedId: Signal<string | null> = this._selectedId.asReadonly();
  /** 最近一次定位要求；對話串處理後不必清除（以 seq 判斷是否已處理）。 */
  readonly reveal: Signal<RevealTarget | null> = this._reveal.asReadonly();

  select(channelId: string | null): void {
    this._selectedId.set(channelId);
  }

  /** 開啟對話並要求捲到指定列（不移動鍵盤焦點、不直接標已讀）。 */
  revealEntry(channelId: string, entryId: string): void {
    this._selectedId.set(channelId);
    this._reveal.set({ channelId, entryId, seq: ++this.seq });
  }
}
