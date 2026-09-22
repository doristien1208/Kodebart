import { BATCH_DAY01_ARCHIVE, DAY_01, archiveBatchForDay, dayIdForPhase } from './day-map';
import { rand } from './rand';
import {
  BatchId,
  BatchState,
  Draft,
  NightResult,
  RecordKey,
  Reply,
  SAVE_VERSION,
  SaveV3,
  SourceRecord,
  SourceSnapshot,
  ValidationOk,
} from './types';

/** 夜間介入門檻：rand(seed,'night.intervention') < 0.45 → 介入。Demo 測試用設計，非正史。 */
export const INTERVENTION_THRESHOLD = 0.45;

/** 固定 eventId：避免玩家多開一次新聞就改變關鍵事件。 */
export const EVENT_IDS = {
  nightIntervention: 'night.intervention',
  nightSmallTalk: 'night.smalltalk',
} as const;

/** Day 2 摘要與副本所看的對象；以具名常數表示，不在元件裡散落字串。 */
export const ARRANGEMENT_SUBJECT_KEY: RecordKey = 'B102';

const EMPTY_BATCH: BatchState = { archived: {}, drafts: {} };

export function createSave(seed: number): SaveV3 {
  return {
    version: SAVE_VERSION,
    seed,
    phase: 'day1',
    dayId: DAY_01,
    batches: {},
    events: [],
    evidence: { reportOpened: false, receiptOpened: false },
    readMessages: [],
  };
}

export function withEvent(save: SaveV3, kind: string, payload: unknown): SaveV3 {
  return { ...save, events: [...save.events, { id: `${kind}:${save.events.length}`, kind, payload }] };
}

/* ---------- 批次存取 ---------- */

/** 目前這一天要操作的歸檔批次。 */
export function currentBatchId(save: SaveV3): BatchId {
  return archiveBatchForDay(save.dayId);
}

export function batchOf(save: SaveV3, batchId: BatchId = currentBatchId(save)): BatchState {
  return save.batches[batchId] ?? EMPTY_BATCH;
}

function withBatch(save: SaveV3, batchId: BatchId, patch: Partial<BatchState>): SaveV3 {
  const current = batchOf(save, batchId);
  return { ...save, batches: { ...save.batches, [batchId]: { ...current, ...patch } } };
}

/* ---------- 夜間判定 ---------- */

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
export function isArranged(subjectRefusal: boolean | null, nightIntervention: boolean): boolean {
  return subjectRefusal === false || nightIntervention;
}

export function isArrangedInSave(save: SaveV3): boolean {
  const subject = batchOf(save, BATCH_DAY01_ARCHIVE).archived[ARRANGEMENT_SUBJECT_KEY];
  return isArranged(subject ? subject.refusal : null, save.night?.intervention ?? false);
}

/* ---------- 批次進度（以批次為範圍，不是全域） ---------- */

export function archivedCount(save: SaveV3, batchId: BatchId = currentBatchId(save)): number {
  return Object.keys(batchOf(save, batchId).archived).length;
}

export function allArchived(
  save: SaveV3,
  records: readonly SourceRecord[],
  batchId: BatchId = currentBatchId(save),
): boolean {
  const { archived } = batchOf(save, batchId);
  return records.every((r) => archived[r.key] !== undefined);
}

/* ---------- 狀態轉移（純函式，回傳新物件） ---------- */

export function setDraft(
  save: SaveV3,
  key: RecordKey,
  draft: Draft,
  batchId: BatchId = currentBatchId(save),
): SaveV3 {
  const batch = batchOf(save, batchId);
  return withBatch(save, batchId, { drafts: { ...batch.drafts, [key]: draft } });
}

export function snapshotOf(record: SourceRecord): SourceSnapshot {
  return {
    name: record.name,
    code: record.code,
    refusal: record.refusal,
    refusalApplies: record.refusalApplies,
  };
}

/** 提交以固定 record key 防重；已提交者不再改變，並連同來源快照保存。 */
export function commitArchive(
  save: SaveV3,
  record: SourceRecord,
  ok: ValidationOk,
  batchId: BatchId = currentBatchId(save),
): SaveV3 {
  const batch = batchOf(save, batchId);
  if (save.phase !== 'day1' || batch.archived[record.key]) return save;
  const next = withBatch(save, batchId, {
    archived: {
      ...batch.archived,
      [record.key]: {
        archiveCode: ok.code,
        refusal: ok.refusal,
        origin: ok.origin,
        source: snapshotOf(record),
      },
    },
  });
  return withEvent(next, 'archive', { key: record.key, origin: ok.origin, batchId });
}

export function completeDay1(save: SaveV3, records: readonly SourceRecord[]): SaveV3 {
  if (save.phase !== 'day1' || !allArchived(save, records)) return save;
  return withEvent({ ...save, phase: 'overnight' }, 'day1.complete', {});
}

/** 進入第二天；一旦 night 已存在不再擲骰。 */
export function advanceToDay2(save: SaveV3): SaveV3 {
  if (save.phase !== 'overnight') return save;
  let next: SaveV3 = save;
  if (!next.night) {
    const night = resolveNight(next.seed);
    next = withEvent({ ...next, night }, 'night.resolved', { ...night });
  }
  return { ...next, phase: 'day2', dayId: dayIdForPhase('day2') };
}

export function markReportOpened(save: SaveV3): SaveV3 {
  if (save.evidence.reportOpened) return save;
  return { ...save, evidence: { ...save.evidence, reportOpened: true } };
}

export function markReceiptOpened(save: SaveV3): SaveV3 {
  if (save.evidence.receiptOpened) return save;
  return { ...save, evidence: { ...save.evidence, receiptOpened: true } };
}

/** 必須先開摘要；請求覆核還需先開昨日副本。 */
export function canReply(save: SaveV3, reply: Reply): boolean {
  if (save.phase !== 'day2' || save.reply) return false;
  if (!save.evidence.reportOpened) return false;
  if (reply === 'review' && !save.evidence.receiptOpened) return false;
  return true;
}

export function submitReply(save: SaveV3, reply: Reply): SaveV3 {
  if (!canReply(save, reply)) return save;
  return withEvent({ ...save, reply, phase: 'end' }, 'day2.reply', { choice: reply });
}

/* ---------- 訊息已讀（KB-R4-04 使用） ---------- */

export function isMessageRead(save: SaveV3, messageId: string): boolean {
  return save.readMessages.includes(messageId);
}

/**
 * 標記為已讀。已讀過的不重複加入，傳入清單自身的重複也會去除；
 * 沒有新增時回傳同一物件，避免多餘寫檔。
 */
export function markMessagesRead(save: SaveV3, messageIds: readonly string[]): SaveV3 {
  const seen = new Set(save.readMessages);
  const added: string[] = [];
  for (const id of messageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }
  if (added.length === 0) return save;
  return { ...save, readMessages: [...save.readMessages, ...added] };
}
