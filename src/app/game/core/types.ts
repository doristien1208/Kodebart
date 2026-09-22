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

/** 已提交至本日批次的紀錄（鎖定，不可再改）。 */
export interface ArchivedRecord {
  /** 歸檔的人員編號，與來源逐字相同（例如 '0102'）。 */
  archiveCode: string;
  refusal: boolean | null;
  origin: Origin;
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
 * 存檔格式 v2。
 * v1 的 archiveName 會把巴特族編號存成整數（0102 → 102），v2 改存字串以保留前導零；
 * 兩者不相容，因此提高版本號，讓舊存檔被明確拒絕而不是默默誤讀。
 */
export interface SaveV2 {
  version: 2;
  seed: number;
  phase: Phase;
  archived: Partial<Record<RecordKey, ArchivedRecord>>;
  drafts: Partial<Record<RecordKey, Draft>>;
  night?: NightResult;
  evidence: Evidence;
  reply?: Reply;
  events: GameEvent[];
}

export const SAVE_VERSION = 2;

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
