import { RECORD_STATUS } from '../../../content/text';
import { Origin } from '../../../core/types';

/**
 * 玩家可見的拒絕紀錄狀態（R7 §6.2）。
 *
 * 底層仍是 boolean／null 與 origin；畫面一律經過這裡換成 ui.recordStatus 的文字，
 * 不直接顯示 true／false／null，也不用 String(value)。純函式，不依賴 Angular。
 */

/** 來源資料本身的拒絕紀錄（SourceCard、Day 2 摘要的對照紀錄）。 */
export function sourceRefusalStatus(record: { refusal: boolean | null; refusalApplies: boolean }): string {
  if (!record.refusalApplies) return RECORD_STATUS.notApplicable;
  if (record.refusal === true) return RECORD_STATUS.refused;
  if (record.refusal === false) return RECORD_STATUS.notRefused;
  return RECORD_STATUS.missing;
}

/**
 * 通過驗證（或已提交）的歸檔結果（ArchivePreview、Day 2 昨日副本）：
 * defaulted → 依規則補登的未拒絕；review → 未確認；source → 來源資料的已拒絕／未拒絕；
 * source 且值為 null 只會發生在不適用拒絕紀錄的資料 → 不適用。
 */
export function archivedRefusalStatus(result: { refusal: boolean | null; origin: Origin }): string {
  switch (result.origin) {
    case 'defaulted':
      return RECORD_STATUS.defaultedNotRefused;
    case 'review':
      return RECORD_STATUS.unconfirmed;
    case 'source':
      if (result.refusal === true) return RECORD_STATUS.sourceRefused;
      if (result.refusal === false) return RECORD_STATUS.sourceNotRefused;
      return RECORD_STATUS.notApplicable;
  }
}
