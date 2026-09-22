import { BatchId, DayId, Phase } from './types';

/**
 * 每日與批次的穩定識別（KB-R4-05）。
 *
 * 目前只有兩天，這裡是相容層：十天內容接上後，dayId 與 batchId 由每日資料提供，
 * 規則不再從 phase 推導。core 不 import content，因此常數放在這裡。
 */
export const DAY_01: DayId = 'day.01';
export const DAY_02: DayId = 'day.02';

/** Day 1 的人員歸檔批次；Day 2 檢視的是同一批的送件副本。 */
export const BATCH_DAY01_ARCHIVE: BatchId = 'batch.day01.archive';

export const KNOWN_DAYS: readonly DayId[] = [DAY_01, DAY_02];

/** 相容層：由 phase 推得當日識別。新增日數後改由每日資料提供。 */
export function dayIdForPhase(phase: Phase): DayId {
  return phase === 'day2' || phase === 'end' ? DAY_02 : DAY_01;
}

/** 某一天要操作（或檢視）的歸檔批次。 */
export function archiveBatchForDay(dayId: DayId): BatchId {
  switch (dayId) {
    case DAY_02:
      return BATCH_DAY01_ARCHIVE;
    case DAY_01:
    default:
      return BATCH_DAY01_ARCHIVE;
  }
}
