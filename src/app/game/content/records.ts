import { SourceRecord } from '../core/types';
import { CONTENT } from './bundle';

/**
 * game/content/records：來源紀錄的顯示輔助。
 *
 * 資料在 data/days/day-NN.json；每日的紀錄一律由目前任務取得（bundle.ts 的 recordsOfTask，
 * 或狀態層的批次），這裡不再提供跨日的全域清單或指名某一筆的常數（R6-01）。
 * 每筆紀錄有兩種識別：內容 ID（`record.b102`，資料檔互相引用用）與
 * 存檔 key（`B102`，存檔的 batches 用，不得隨內容改名）。
 */

/** 來源未登記姓名時顯示的文字；不代表這個人沒有名字。 */
export const NAME_UNREGISTERED: string = CONTENT.ui.records.nameUnregistered;

export function hasName(record: SourceRecord): boolean {
  return record.name !== null;
}

/** 佇列與來源卡共用的顯示識別：有姓名顯示姓名，否則顯示人員編號。 */
export function recordLabel(record: SourceRecord): string {
  return record.name ?? record.code;
}
