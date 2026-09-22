import { dayContentById } from '../content/bundle';
import { BATCH_DAY01_ARCHIVE, BatchId, DAY_01, DayId } from '../core';
import { SourceRecord } from '../core/types';

/**
 * 批次 → 資料集合的相容層（KB-R4-05）。
 *
 * 完成條件與存檔驗證必須以「該批次自己的資料集合」為範圍，否則日後在 Day 3
 * 新增紀錄時，已完成的 Day 1／Day 2 存檔會因為缺少新紀錄而被判定損壞。
 *
 * 這一層放在 state（adapter）而不是 core 或 content：core 不 import content，
 * content 也不該知道批次概念。Day 3–10 接上後，這裡改由每日資料查表即可。
 */
export function recordsOfDay(dayId: DayId): readonly SourceRecord[] {
  return dayContentById(dayId).records.map((r) => ({
    key: r.key,
    name: r.name,
    code: r.code,
    refusal: r.refusal,
    refusalApplies: r.refusalApplies,
  }));
}

export function recordsForBatch(batchId: BatchId): readonly SourceRecord[] {
  switch (batchId) {
    case BATCH_DAY01_ARCHIVE:
      return recordsOfDay(DAY_01);
    default:
      return [];
  }
}
