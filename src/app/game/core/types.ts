/**
 * game/core：純型別與規則，不依賴 Angular、DOM 或 localStorage。
 * 對應 doc/KodeBart-Demo-Spec.md §6「核心模型與規則」。
 */

export type Phase = 'day1' | 'overnight' | 'day2' | 'end';
export type MissingPolicy = 'default_false' | 'request_review';
export type Reply = 'ack' | 'ask' | 'review';
export type Origin = 'source' | 'defaulted' | 'review';
/**
 * 來源資料的識別鍵。
 * 刻意放寬為 string：資料筆數與鍵名由 content/records.ts 的資料集合決定，
 * 核心規則不預設任何一組固定編號（Day 2 仍綁定特定兩筆，見 content/records.ts 的具名常數）。
 * 因此 SaveV2.archived／drafts 帶索引簽章，取值一律用 save.archived['B102'] 而非點存取
 * （tsconfig 的 noPropertyAccessFromIndexSignature）。
 */
export type RecordKey = string;
/** 每日識別，例如 'day.01'。 */
export type DayId = string;
/** 工作批次識別，例如 'batch.day01.archive'。 */
export type BatchId = string;

export const PHASES: readonly Phase[] = ['day1', 'overnight', 'day2', 'end'];
export const MISSING_POLICIES: readonly MissingPolicy[] = ['default_false', 'request_review'];
export const REPLIES: readonly Reply[] = ['ack', 'ask', 'review'];
export const ORIGINS: readonly Origin[] = ['source', 'defaulted', 'review'];

/** 送來歸檔的來源資料（一筆）。 */
export interface SourceRecord {
  key: RecordKey;
  /** 姓名；null 代表來源未登記姓名（以純文字顯示，不提供輸入框）。 */
  name: string | null;
  /**
   * 人員編號：玩家需核對填寫的欄位。
   * 一律以字串保存，因此 0102 的前導零在提交、存檔與重新載入後都不會消失。
   */
  code: string;
  /** 拒絕紀錄：不適用者為 null 且 refusalApplies 為 false；null＝未附欄位、true＝已附。 */
  refusal: boolean | null;
  /** 這筆資料是否適用拒絕紀錄欄位。 */
  refusalApplies: boolean;
}

/**
 * 提交當下的來源資料快照（KB-R4-05）。
 * 同一個人員在後續日重新出現時，歷史結果不會被目前內容檔覆寫。
 */
export interface SourceSnapshot {
  name: string | null;
  code: string;
  refusal: boolean | null;
  refusalApplies: boolean;
}

/** 已提交至某個批次的紀錄（鎖定，不可再改）。 */
export interface ArchivedRecord {
  /** 歸檔的人員編號，與來源逐字相同（例如 '0102'）。 */
  archiveCode: string;
  refusal: boolean | null;
  origin: Origin;
  /** 提交當下的來源快照。 */
  source: SourceSnapshot;
}

/** 單一工作批次的狀態；完成條件與草稿都以批次為範圍，不是全域。 */
export interface BatchState {
  archived: Partial<Record<RecordKey, ArchivedRecord>>;
  drafts: Partial<Record<RecordKey, Draft>>;
}

/** 尚未提交的草稿；切換導航仍保留。 */
export interface Draft {
  value: string;
  policy?: MissingPolicy;
}

/** 夜間只判定一次，寫入存檔後刷新不重算。 */
export interface NightResult {
  intervention: boolean;
  /** 0 或 1：Day2 同事閒聊版本（無陰謀的普通亂數）。 */
  smallTalkVariant: number;
  /** 1＝規則彙整；2＝夜間校驗。 */
  reportRevision: number;
}

export interface Evidence {
  reportOpened: boolean;
  receiptOpened: boolean;
}

export interface GameEvent {
  id: string;
  kind: string;
  payload: unknown;
}

/**
 * 存檔格式 v3（KB-R4-05）。
 *
 * 與 v2 的差別：歸檔與草稿改以「批次」為範圍（`batches`），並記錄當日識別，
 * 因此日後新增 Day 3–10 的紀錄不會讓已完成的舊批次被判定未完成。
 * 每筆歸檔另存提交當下的來源快照。v2 舊檔可由 `migrateSave()` 轉換，不會被捨棄。
 */
export interface SaveV3 {
  version: 3;
  seed: number;
  phase: Phase;
  /** 目前所在的日；由每日資料決定，不從 phase 硬推。 */
  dayId: DayId;
  batches: Partial<Record<BatchId, BatchState>>;
  night?: NightResult;
  evidence: Evidence;
  reply?: Reply;
  events: GameEvent[];
  /** 已讀訊息的穩定 ID；舊檔遷移時預設為空陣列。 */
  readMessages: string[];
}

export const SAVE_VERSION = 3;

/** v2 存檔的形狀，只用於載入舊檔後遷移。 */
export interface SaveV2 {
  version: 2;
  seed: number;
  phase: Phase;
  archived: Partial<Record<RecordKey, { archiveCode: string; refusal: boolean | null; origin: Origin }>>;
  drafts: Partial<Record<RecordKey, Draft>>;
  night?: NightResult;
  evidence: Evidence;
  reply?: Reply;
  events: GameEvent[];
}

export const LEGACY_SAVE_VERSION = 2;

export interface ValidationOk {
  ok: true;
  /** 通過驗證的人員編號（來源原字串）。 */
  code: string;
  refusal: boolean | null;
  origin: Origin;
}

export interface ValidationError {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationError;

/** 「驗證並預覽」顯示給玩家的技術結果（不含道德判斷）。 */
export interface ArchivePreview {
  personnel_code: string;
  refusal_record: boolean | null;
  destination: 'archive' | 'review_queue';
}
