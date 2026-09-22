import { BATCH_DAY01_ARCHIVE, dayIdForPhase } from './day-map';
import { snapshotOf } from './rules';
import { BatchState, SAVE_VERSION, SaveV2, SaveV3, SourceRecord } from './types';

/**
 * v2 → v3 遷移（KB-R4-04 第 8 點、KB-R4-05）。
 *
 * v2 的 archived／drafts 是全域的，遷入 Day 1 的歸檔批次；
 * v2 沒有來源快照，因此以遷移當下的資料表補上，並記錄該筆原本的編號。
 * 舊檔不會被判定損壞或清空，只會被轉換。
 */
export function migrateSave(legacy: SaveV2, records: readonly SourceRecord[]): SaveV3 {
  const batch: BatchState = { archived: {}, drafts: {} };

  for (const [key, entry] of Object.entries(legacy.archived)) {
    if (!entry) continue;
    const record = records.find((r) => r.key === key);
    batch.archived[key] = {
      archiveCode: entry.archiveCode,
      refusal: entry.refusal,
      origin: entry.origin,
      // 舊檔沒有快照；用目前資料表補，找不到時至少保住已提交的編號
      source: record
        ? snapshotOf(record)
        : { name: null, code: entry.archiveCode, refusal: entry.refusal, refusalApplies: false },
    };
  }
  for (const [key, draft] of Object.entries(legacy.drafts)) {
    if (draft) batch.drafts[key] = { ...draft };
  }

  const migrated: SaveV3 = {
    version: SAVE_VERSION,
    seed: legacy.seed,
    phase: legacy.phase,
    dayId: dayIdForPhase(legacy.phase),
    batches: { [BATCH_DAY01_ARCHIVE]: batch },
    evidence: { ...legacy.evidence },
    events: [...legacy.events],
    readMessages: [],
  };
  // 只在真的有值時才加上，避免留下序列化後會消失的 undefined 自有屬性
  if (legacy.night) migrated.night = legacy.night;
  if (legacy.reply) migrated.reply = legacy.reply;
  return migrated;
}
