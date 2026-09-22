import { SourceRecord } from '../core/types';

/** 來源未登記姓名時顯示的文字；不代表這個人沒有名字。 */
export const NAME_UNREGISTERED = '未登記';

export function hasName(record: SourceRecord): boolean {
  return record.name !== null;
}

/**
 * Day 2 劇情固定引用的兩筆舊紀錄（批次摘要與昨日副本）。
 * 具名匯出，避免元件裡散落字串；其餘畫面一律走資料集合，不指名任何一筆。
 */
export const RECORD_H17 = 'H17';
export const RECORD_B102 = 'B102';
export const RECORD_B607 = 'B607';

/**
 * Day 1 測試資料（doc/KodeBart-Demo-Spec.md §4）。
 * 0607 借用舊案編號，只作背景；不新增其性別、外觀或經歷。
 * 這批是舊紀錄整理，不暗示 0102 是新抓入機構的人。
 * 編號一律為字串，0102 的前導零不會在任何環節消失。
 * 筆數由本陣列決定：畫面與規則都從這裡算總數，不得再寫死 3。
 */
export const RECORDS: readonly SourceRecord[] = [
  { key: RECORD_H17, name: '林予安', code: 'H-17', refusal: null, refusalApplies: false },
  { key: RECORD_B102, name: null, code: '0102', refusal: null, refusalApplies: true },
  { key: RECORD_B607, name: null, code: '0607', refusal: true, refusalApplies: true },
];

export const RECORD_KEYS = RECORDS.map((r) => r.key);

/** 目前資料集合的總筆數；所有「N 筆」文案一律由此推導。 */
export const TOTAL_RECORDS = RECORDS.length;

/** 佇列與來源卡共用的顯示識別：有姓名顯示姓名，否則顯示人員編號。 */
export function recordLabel(record: SourceRecord): string {
  return record.name ?? record.code;
}

export function findRecord(key: string): SourceRecord | undefined {
  return RECORDS.find((r) => r.key === key);
}
