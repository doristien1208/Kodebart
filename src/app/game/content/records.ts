import { SourceRecord } from '../core/types';
import { ALL_RECORDS, CONTENT, contentRecord } from './bundle';

/**
 * game/content/records：來源紀錄的載入與查詢。
 *
 * 資料在 data/days/day-NN.json，這裡只做轉換與查詢。
 * 每筆紀錄有兩種識別：內容 ID（`record.b102`，資料檔互相引用用）與
 * 存檔 key（`B102`，SaveV2.archived／drafts 用，不得隨內容改名）。
 */

/** 來源未登記姓名時顯示的文字；不代表這個人沒有名字。 */
export const NAME_UNREGISTERED: string = CONTENT.ui.records.nameUnregistered;

export function hasName(record: SourceRecord): boolean {
  return record.name !== null;
}

/**
 * Day 2 劇情固定引用的兩筆舊紀錄（批次摘要與昨日副本）。
 * 具名匯出，避免元件裡散落字串；其餘畫面一律走資料集合，不指名任何一筆。
 */
export const RECORD_H17: string = contentRecord('record.h17').key;
export const RECORD_B102: string = contentRecord('record.b102').key;
export const RECORD_B607: string = contentRecord('record.b607').key;

/**
 * 目前全部日別的來源資料（見 data/days/）。
 * 編號一律為字串，0102 的前導零不會在任何環節消失。
 * 筆數由資料檔決定：畫面與規則都從這裡算總數，不得再寫死 3。
 */
export const RECORDS: readonly SourceRecord[] = ALL_RECORDS.map((r) => ({
  key: r.key,
  name: r.name,
  code: r.code,
  refusal: r.refusal,
  refusalApplies: r.refusalApplies,
}));

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
