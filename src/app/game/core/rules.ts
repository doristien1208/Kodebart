import { rand } from './rand';
import {
  Draft,
  NightResult,
  RecordKey,
  Reply,
  SAVE_VERSION,
  SaveV2,
  SourceRecord,
  ValidationOk,
} from './types';

/** 夜間介入門檻：rand(seed,'night.intervention') < 0.45 → 介入。Demo 測試用設計，非正史。 */
export const INTERVENTION_THRESHOLD = 0.45;

/** 固定 eventId：避免玩家多開一次新聞就改變關鍵事件。 */
export const EVENT_IDS = {
  nightIntervention: 'night.intervention',
  nightSmallTalk: 'night.smalltalk',
} as const;

export function createSave(seed: number): SaveV2 {
  return {
    version: SAVE_VERSION,
    seed,
    phase: 'day1',
    archived: {},
    drafts: {},
    events: [],
    evidence: { reportOpened: false, receiptOpened: false },
  };
}

export function withEvent(save: SaveV2, kind: string, payload: unknown): SaveV2 {
  return { ...save, events: [...save.events, { id: `${kind}:${save.events.length}`, kind, payload }] };
}

/** 夜間判定：只由 seed 決定，可重現；呼叫端保證只在 night 不存在時呼叫。 */
export function resolveNight(seed: number): NightResult {
  const intervention = rand(seed, EVENT_IDS.nightIntervention) < INTERVENTION_THRESHOLD;
  return {
    intervention,
    smallTalkVariant: Math.floor(rand(seed, EVENT_IDS.nightSmallTalk) * 2),
    reportRevision: intervention ? 2 : 1,
  };
}

/**
 * 四格結果矩陣（開發用）：
 * Day1 寫 false → 已列入安排；null 覆核＋無介入 → 待資料覆核；null 覆核＋介入 → 已列入安排。
 */
export function isArranged(b102Refusal: boolean | null, nightIntervention: boolean): boolean {
  return b102Refusal === false || nightIntervention;
}

/**
 * 四格矩陣目前綁定的那一筆（Day 2 劇情本來就綁這批舊紀錄）。
 * core 不反向依賴 content，因此鍵名在此以字面值保留；對外的具名常數見 content/records.ts。
 * RecordKey 放寬為 string 後 archived 帶索引簽章，一律用索引存取。
 */
export const ARRANGEMENT_SUBJECT_KEY = 'B102';

export function isArrangedInSave(save: SaveV2): boolean {
  const b102 = save.archived[ARRANGEMENT_SUBJECT_KEY];
  return isArranged(b102 ? b102.refusal : null, save.night?.intervention ?? false);
}

export function archivedCount(save: SaveV2): number {
  return Object.keys(save.archived).length;
}

export function allArchived(save: SaveV2, records: readonly SourceRecord[]): boolean {
  return records.every((r) => save.archived[r.key] !== undefined);
}

/* ---------- 狀態轉移（純函式，回傳新物件） ---------- */

export function setDraft(save: SaveV2, key: RecordKey, draft: Draft): SaveV2 {
  return { ...save, drafts: { ...save.drafts, [key]: draft } };
}

/** 提交以固定 record key 防重；已提交者不再改變。 */
export function commitArchive(save: SaveV2, key: RecordKey, ok: ValidationOk): SaveV2 {
  if (save.phase !== 'day1' || save.archived[key]) return save;
  const next: SaveV2 = {
    ...save,
    archived: { ...save.archived, [key]: { archiveCode: ok.code, refusal: ok.refusal, origin: ok.origin } },
  };
  return withEvent(next, 'archive', { key, origin: ok.origin });
}

export function completeDay1(save: SaveV2, records: readonly SourceRecord[]): SaveV2 {
  if (save.phase !== 'day1' || !allArchived(save, records)) return save;
  return withEvent({ ...save, phase: 'overnight' }, 'day1.complete', {});
}

/** 進入第二天；一旦 night 已存在不再擲骰。 */
export function advanceToDay2(save: SaveV2): SaveV2 {
  if (save.phase !== 'overnight') return save;
  let next: SaveV2 = save;
  if (!next.night) {
    const night = resolveNight(next.seed);
    next = withEvent({ ...next, night }, 'night.resolved', { ...night });
  }
  return { ...next, phase: 'day2' };
}

export function markReportOpened(save: SaveV2): SaveV2 {
  if (save.evidence.reportOpened) return save;
  return { ...save, evidence: { ...save.evidence, reportOpened: true } };
}

export function markReceiptOpened(save: SaveV2): SaveV2 {
  if (save.evidence.receiptOpened) return save;
  return { ...save, evidence: { ...save.evidence, receiptOpened: true } };
}

/** 必須先開摘要；請求覆核還需先開昨日副本。 */
export function canReply(save: SaveV2, reply: Reply): boolean {
  if (save.phase !== 'day2' || save.reply) return false;
  if (!save.evidence.reportOpened) return false;
  if (reply === 'review' && !save.evidence.receiptOpened) return false;
  return true;
}

export function submitReply(save: SaveV2, reply: Reply): SaveV2 {
  if (!canReply(save, reply)) return save;
  return withEvent({ ...save, reply, phase: 'end' }, 'day2.reply', { choice: reply });
}
