import { Injectable } from '@angular/core';
import { STORAGE } from '../content/text';
import { archiveBatchForDay, dayIdForPhase } from '../core/day-map';
import { migrateSave } from '../core/save-migrate';
import { isValidLegacySave, isValidSave } from '../core/save-schema';
import { SaveV3 } from '../core/types';
import { recordsForBatch } from './batch-records';

export const SAVE_KEY = 'kodebart-save-v2';

export interface LoadResult {
  save: SaveV3 | null;
  /** 空字串代表沒有問題；否則為要顯示給玩家的提示。 */
  issue: string;
  /** 本次載入是否由 v2 舊檔轉換而來。 */
  migrated: boolean;
}

/**
 * 本機存檔（localStorage、versioned JSON）。
 *
 * 目前格式為 v3；v2 舊檔會被讀入並轉換（不捨棄、不清空進度）。
 * 讀取或寫入失敗以 try/catch 攔下並回傳提示，不靜默吞錯、不默默覆蓋格式不符的資料。
 * 只屬於當前瀏覽器；不是跨裝置雲端存檔。
 *
 * 存檔 key 沿用 `kodebart-save-v2`：版本號寫在內容裡，換 key 只會讓舊進度憑空消失。
 */
@Injectable({ providedIn: 'root' })
export class SaveRepository {
  load(): LoadResult {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw === null) return { save: null, issue: '', migrated: false };
      const parsed: unknown = JSON.parse(raw);

      const phase = (parsed as { phase?: unknown })?.phase;
      const batchId = archiveBatchForDay(dayIdForPhase(typeof phase === 'string' ? (phase as never) : 'day1'));

      const records = recordsForBatch(batchId);
      if (isValidSave(parsed, records, batchId)) return { save: parsed, issue: '', migrated: false };
      if (isValidLegacySave(parsed, records)) {
        return { save: migrateSave(parsed, records), issue: '', migrated: true };
      }
      return { save: null, issue: STORAGE.readIssue, migrated: false };
    } catch {
      return { save: null, issue: STORAGE.readIssue, migrated: false };
    }
  }

  /** 回傳空字串代表成功；否則為儲存失敗提示。 */
  persist(save: SaveV3): string {
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
