import { Injectable } from '@angular/core';
import { RECORDS } from '../content/records';
import { STORAGE } from '../content/text';
import { isValidSave } from '../core/save-schema';
import { SaveV2 } from '../core/types';

export const SAVE_KEY = 'kodebart-save-v2';

export interface LoadResult {
  save: SaveV2 | null;
  /** 空字串代表沒有問題；否則為要顯示給玩家的提示。 */
  issue: string;
}

/**
 * 本機存檔（localStorage、versioned JSON）。
 * v2 起人員編號以字串保存；v1 舊檔的結構不相容，會被 schema 判為不合法並提示玩家。
 * 讀取或寫入失敗以 try/catch 攔下並回傳提示，不靜默吞錯、不默默覆蓋格式不符的資料。
 * 只屬於當前瀏覽器；不是跨裝置雲端存檔。
 */
@Injectable({ providedIn: 'root' })
export class SaveRepository {
  load(): LoadResult {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw === null) return { save: null, issue: '' };
      const parsed: unknown = JSON.parse(raw);
      if (!isValidSave(parsed, RECORDS)) return { save: null, issue: STORAGE.readIssue };
      return { save: parsed, issue: '' };
    } catch {
      return { save: null, issue: STORAGE.readIssue };
    }
  }

  /** 回傳空字串代表成功；否則為儲存失敗提示。 */
  persist(save: SaveV2): string {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      return '';
    } catch {
      return STORAGE.writeIssue;
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* 無法清除時忽略 */
    }
  }
}
