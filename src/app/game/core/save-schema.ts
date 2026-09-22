import { isValidSeed } from './rand';
import { MISSING_POLICIES, ORIGINS, PHASES, REPLIES, SAVE_VERSION, SaveV2, SourceRecord } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 嚴格檢查存檔結構；格式不符時回傳 false，呼叫端不得默默覆蓋。
 * 版本不符（例如 v1 把編號存成整數的舊檔）一律視為不合法。
 */
export function isValidSave(s: unknown, records: readonly SourceRecord[]): s is SaveV2 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== SAVE_VERSION) return false;
  if (!isValidSeed(s['seed'])) return false;
  if (!PHASES.includes(s['phase'] as never)) return false;

  const archived = s['archived'];
  const drafts = s['drafts'];
  const evidence = s['evidence'];
  if (!isPlainObject(archived) || !isPlainObject(drafts) || !Array.isArray(s['events'])) return false;
  if (!isPlainObject(evidence)) return false;
  if (typeof evidence['reportOpened'] !== 'boolean' || typeof evidence['receiptOpened'] !== 'boolean') return false;

  for (const key of Object.keys(archived)) {
    if (!records.some((r) => r.key === key)) return false;
  }

  for (const r of records) {
    const a = archived[r.key];
    if (a !== undefined) {
      if (!isPlainObject(a)) return false;
      if (!ORIGINS.includes(a['origin'] as never)) return false;
      if (!(a['refusal'] === null || typeof a['refusal'] === 'boolean')) return false;
      // 逐字比對，'0102' 才算合法；102 或 '102' 都會被拒絕。
      if (a['archiveCode'] !== r.code) return false;
    }
    const d = drafts[r.key];
    if (d !== undefined) {
      if (!isPlainObject(d)) return false;
      if (typeof d['value'] !== 'string') return false;
      if (d['policy'] !== undefined && !MISSING_POLICIES.includes(d['policy'] as never)) return false;
    }
  }

  const phase = s['phase'];
  if (phase !== 'day1' && records.some((r) => archived[r.key] === undefined)) return false;

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
