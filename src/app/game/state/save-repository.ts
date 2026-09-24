import { Injectable } from '@angular/core';
import { STORAGE } from '../content/text';
import { DayDirectory } from '../core/day-plan';
import { migrateToCurrent } from '../core/save-migrate';
import { Save } from '../core/types';
import { DAY_DIRECTORY } from './day-directory';

/**
 * 沿用 v2 時代的 key：版本號寫在內容裡，換 key 只會讓既有進度憑空消失。
 */
export const SAVE_KEY = 'kodebart-save-v2';

export interface LoadResult {
  save: Save | null;
  /** 空字串代表沒有問題；否則為要顯示給玩家的提示。 */
  issue: string;
  /** 本次載入由哪個版本轉換而來；null＝沒有存檔或無法讀取，11＝本來就是現行格式。 */
  migratedFrom: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | null;
}

/**
 * 本機存檔（localStorage、versioned JSON）。
 * 現行格式 v11；v2～v10 舊檔會被讀入並轉換，不捨棄、不清空進度。
 * 讀取或寫入失敗以 try/catch 攔下並回傳提示，不靜默吞錯、不默默覆蓋格式不符的資料。
 */
@Injectable({ providedIn: 'root' })
export class SaveRepository {
  load(dir: DayDirectory = DAY_DIRECTORY): LoadResult {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw === null) return { save: null, issue: '', migratedFrom: null };
      const result = migrateToCurrent(JSON.parse(raw), dir);
      if (!result) return { save: null, issue: STORAGE.readIssue, migratedFrom: null };
      return { save: result.save, issue: '', migratedFrom: result.from };
    } catch {
      return { save: null, issue: STORAGE.readIssue, migratedFrom: null };
    }
  }

  /** 回傳空字串代表成功；否則為儲存失敗提示。 */
  persist(save: Save): string {
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
