import { KNOWN_DAYS } from './day-map';
import { isValidSeed } from './rand';
import {
  LEGACY_SAVE_VERSION,
  MISSING_POLICIES,
  ORIGINS,
  PHASES,
  REPLIES,
  SAVE_VERSION,
  SaveV2,
  SaveV3,
  SourceRecord,
} from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidDraft(d: unknown): boolean {
  if (!isPlainObject(d)) return false;
  if (typeof d['value'] !== 'string') return false;
  return d['policy'] === undefined || MISSING_POLICIES.includes(d['policy'] as never);
}

function isValidSnapshot(s: unknown): boolean {
  if (!isPlainObject(s)) return false;
  if (!(s['name'] === null || typeof s['name'] === 'string')) return false;
  if (typeof s['code'] !== 'string') return false;
  if (!(s['refusal'] === null || typeof s['refusal'] === 'boolean')) return false;
  return typeof s['refusalApplies'] === 'boolean';
}

/** 歸檔紀錄的共同欄位；v3 另外要求來源快照。 */
function isValidArchived(a: unknown, requireSnapshot: boolean): boolean {
  if (!isPlainObject(a)) return false;
  if (typeof a['archiveCode'] !== 'string' || a['archiveCode'] === '') return false;
  if (!ORIGINS.includes(a['origin'] as never)) return false;
  if (!(a['refusal'] === null || typeof a['refusal'] === 'boolean')) return false;
  if (requireSnapshot && !isValidSnapshot(a['source'])) return false;
  return true;
}

function isValidCommon(s: Record<string, unknown>): boolean {
  if (!isValidSeed(s['seed'])) return false;
  if (!PHASES.includes(s['phase'] as never)) return false;
  if (!Array.isArray(s['events'])) return false;
  const evidence = s['evidence'];
  if (!isPlainObject(evidence)) return false;
  if (typeof evidence['reportOpened'] !== 'boolean') return false;
  if (typeof evidence['receiptOpened'] !== 'boolean') return false;

  const phase = s['phase'];
  if (phase === 'day2' || phase === 'end') {
    const night = s['night'];
    if (!isPlainObject(night)) return false;
    if (typeof night['intervention'] !== 'boolean') return false;
    if (night['smallTalkVariant'] !== 0 && night['smallTalkVariant'] !== 1) return false;
    if (night['reportRevision'] !== (night['intervention'] ? 2 : 1)) return false;
  }
  if (phase === 'end' && !REPLIES.includes(s['reply'] as never)) return false;
  return true;
}

/**
 * v3 存檔檢查。格式不符時回傳 false，呼叫端不得默默覆蓋。
 * `records` 是「目前這一批工作」的資料集合，用來檢查歸檔內容是否對得上；
 * 其他批次只檢查結構，因此日後新增 Day 3–10 的紀錄不會讓舊批次被判定損壞。
 */
export function isValidSave(
  s: unknown,
  records: readonly SourceRecord[],
  currentBatchId: string,
): s is SaveV3 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== SAVE_VERSION) return false;
  if (!isValidCommon(s)) return false;
  if (typeof s['dayId'] !== 'string' || !KNOWN_DAYS.includes(s['dayId'])) return false;
  if (!Array.isArray(s['readMessages']) || s['readMessages'].some((m) => typeof m !== 'string')) return false;

  const batches = s['batches'];
  if (!isPlainObject(batches)) return false;

  for (const [batchId, batch] of Object.entries(batches)) {
    if (!isPlainObject(batch)) return false;
    const archived = batch['archived'];
    const drafts = batch['drafts'];
    if (!isPlainObject(archived) || !isPlainObject(drafts)) return false;
    for (const value of Object.values(archived)) {
      if (!isValidArchived(value, true)) return false;
    }
    for (const value of Object.values(drafts)) {
      if (!isValidDraft(value)) return false;
    }
    // 只有目前這一批才比對內容；歷史批次保留當時的快照，不與現行資料表比對
    if (batchId === currentBatchId) {
      for (const key of Object.keys(archived)) {
        if (!records.some((r) => r.key === key)) return false;
      }
      for (const r of records) {
        const a = archived[r.key];
        if (a !== undefined && (a as { archiveCode: string }).archiveCode !== r.code) return false;
      }
    }
  }

  // 離開 day1 之後，目前批次必須已全部完成
  if (s['phase'] !== 'day1') {
    const archived = (batches[currentBatchId] as { archived?: Record<string, unknown> } | undefined)?.archived ?? {};
    if (records.some((r) => archived[r.key] === undefined)) return false;
  }
  return true;
}

/** v2 舊檔檢查；僅用於載入後遷移，不作為現行格式。 */
export function isValidLegacySave(s: unknown, records: readonly SourceRecord[]): s is SaveV2 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== LEGACY_SAVE_VERSION) return false;
  if (!isValidCommon(s)) return false;

  const archived = s['archived'];
  const drafts = s['drafts'];
  if (!isPlainObject(archived) || !isPlainObject(drafts)) return false;

  for (const key of Object.keys(archived)) {
    if (!records.some((r) => r.key === key)) return false;
  }
  for (const r of records) {
    const a = archived[r.key];
    if (a !== undefined) {
      if (!isValidArchived(a, false)) return false;
      if ((a as { archiveCode: string }).archiveCode !== r.code) return false;
    }
    const d = drafts[r.key];
    if (d !== undefined && !isValidDraft(d)) return false;
  }
  if (s['phase'] !== 'day1' && records.some((r) => archived[r.key] === undefined)) return false;
  return true;
}
