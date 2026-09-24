/**
 * game/core：純型別與規則，不依賴 Angular、DOM 或 localStorage。
 * 對應 doc/KodeBart-Demo-Spec.md §6「核心模型與規則」。
 */

/** 舊存檔（v2／v3）的階段；只用於遷移。現行流程改用 dayId + Stage。 */
export type Phase = 'day1' | 'overnight' | 'day2' | 'end';

/**
 * 通用畫面階段（KB-R5-03／R8）：與「第幾天」分開。
 * work＝當日工作台；wrap＝本日交接（日結）；morning＝次日收件；end＝Demo 結束。
 * 新遊戲的第一天直接從 work 開始，不經過 morning。
 */
export type Stage = 'work' | 'wrap' | 'morning' | 'end';
export const STAGES: readonly Stage[] = ['work', 'wrap', 'morning', 'end'];
/** v2–v6 只有這三種階段。 */
export const LEGACY_STAGES: readonly Stage[] = ['work', 'wrap', 'end'];
/** 任務識別，例如 'task.day1.archive'。 */
export type TaskId = string;
export type MissingPolicy = 'default_false' | 'request_review';
export type Reply = 'ack' | 'ask' | 'review';
export type Origin = 'source' | 'defaulted' | 'review';
/**
 * 來源資料的識別鍵。
 * 刻意放寬為 string：資料筆數與鍵名由 state adapter 傳入的 DayDirectory（來自內容資料）決定，
 * 核心規則不預設任何一組固定編號，也不知道有哪幾天。
 * 因此批次的 archived／drafts 帶索引簽章，取值一律用 save.archived['B102'] 而非點存取
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
  /**
   * 多來源比對案件的決定快照（R9）；一般紀錄沒有。
   * 人員編號的依據放在這裡，不混入 origin（origin 仍只描述拒絕紀錄的來源／缺值處理）。
   */
  caseDecision?: CaseDecisionSnapshot;
}

/** 案件處理去向：正式歸檔或送窗口待查。 */
export type CaseDestination = 'archive' | 'review';
export const CASE_DESTINATIONS: readonly CaseDestination[] = ['archive', 'review'];

/** 提交當下保存的案件決定；內容檔日後修改也不覆寫。 */
export interface CaseDecisionSnapshot {
  caseId: string;
  decisionId: string;
  destination: CaseDestination;
  basisDocumentId: string;
  note: string;
}

/** 案件的閱讀狀態：補件收件狀態的變體（第一次開案時決定並保存）與玩家標記的差異欄位。 */
export interface CaseReviewState {
  variantId: string;
  /** 玩家標記為「有差異」的欄位名稱。 */
  marks: string[];
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
  /** 案件紀錄選定的處理方式（依據／去向／註記）；選方式不會覆寫 value（R10）。 */
  decisionId?: string;
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

/* ---------- 每個工作的進度（R6-02） ---------- */

/** 核對工作的進度：開過哪些文件、回覆了什麼。以 taskId 為鍵，不再是存檔的全域欄位。 */
export interface ReconcileProgress {
  kind: 'reconcile';
  reportOpened: boolean;
  receiptOpened: boolean;
  /** 逐筆審查處置（R10）；以 recordKey 為鍵。確認收件（reply）不等於放行。 */
  reviews?: Partial<Record<RecordKey, RecordReview>>;
  reply?: Reply;
  /** 回覆當下看到的摘要版本；沒有夜間結果時為 null（中性版本）。 */
  reportRevision?: number | null;
}

/** 第二輪逐筆審查處置：放行或保留待查。 */
export type ReviewDisposition = 'release' | 'hold';
export const REVIEW_DISPOSITIONS: readonly ReviewDisposition[] = ['release', 'hold'];

/** 一筆審查紀錄：保存處置與所看的版本，並附上來源批次／工作／紀錄的內部追蹤引用。 */
export interface RecordReview {
  disposition: ReviewDisposition;
  batchId: BatchId;
  archiveTaskId: TaskId;
  recordKey: RecordKey;
  /** 原始來源的人員編號（提交快照中的 source.code）。 */
  sourceCode: string;
  /** 審查時看到的送件編號（前一階段保存的 archiveCode）。 */
  reviewedCode: string;
}

/* ---------- 文件問題（退件案件，R10／R11） ---------- */

/**
 * 案件狀態（R11）：
 * pending＝待修正 → 重送 → awaiting-check＝已重送／待核對 → 下游在下一工作日核對：
 * resolved＝一致、已解決；不一致就回到 pending（再次退回）。
 * awaiting-window＝送窗口待回覆，仍未解決。只有下游核對能結案；送出、轉交或跨日都不會。
 */
export type ReturnStatus = 'pending' | 'awaiting-check' | 'awaiting-window' | 'resolved';
export const RETURN_STATUSES: readonly ReturnStatus[] = ['pending', 'awaiting-check', 'awaiting-window', 'resolved'];

/** 案件的一次處理版本（只附加，不覆寫原提交）。 */
export interface ReturnVersion {
  /** 0 起算的版本序號。 */
  index: number;
  action: 'resubmit' | 'window';
  /** 本次送出的人員編號（只驗型別）。 */
  code: string;
  /** 受理日。 */
  dayId: DayId;
  /** 預定核對日（重送＝下一工作日；最後一天或送窗口為 null）。 */
  checkDayId: DayId | null;
  /** 下游核對結果；尚未核對時沒有這個欄位。每個版本只評估一次。 */
  outcome?: 'resolved' | 'returned';
  checkedDayId?: DayId;
}

/** 下游回條（退件或收件確認）；已讀、結案都不刪除。 */
export interface ReturnReceipt {
  /** 穩定 ID：`<caseId>#<序號>`。 */
  id: string;
  kind: 'returned' | 'resolved';
  dayId: DayId;
  /** 對應的處理版本；第一次退件（針對原提交）為 null。 */
  versionIndex: number | null;
  /** 回條所核對的人員編號。 */
  code: string;
  reason: 'code-mismatch' | null;
}

/**
 * 文件問題案件（延後退件）：第一輪提交的編號與保存的原始來源不一致，且第二輪對該版本明確放行。
 * 通知日建立；同一案重錯只增加版本與回條，不會複製成新案件。
 */
export interface ReturnCase {
  /** 穩定 ID：`return.<auditId>.<recordKey>`。 */
  id: string;
  auditId: string;
  batchId: BatchId;
  recordKey: RecordKey;
  /** 原提交所在的歸檔工作。 */
  archiveTaskId: TaskId;
  /** 第二輪放行的核對工作。 */
  reviewTaskId: TaskId;
  /** 原始來源編號（下游核對的依據）。 */
  sourceCode: string;
  /** 第一次提交的編號。 */
  submittedCode: string;
  /** 第二輪審查時看到的編號與處置。 */
  reviewedCode: string;
  disposition: 'release';
  reason: 'code-mismatch';
  notifyDayId: DayId;
  status: ReturnStatus;
  /** 待修正時，下一次排入待辦的工作日；最後一天之後為 null（仍留在文件問題清單）。 */
  dueDayId: DayId | null;
  versions: ReturnVersion[];
  receipts: ReturnReceipt[];
}

/** 欄位映射一列提交後的目標值；空值依 blankPolicy 轉為 false 或保留 null。 */
export type MappedValue = string | boolean | null;

/** 確認匯入時鎖定的快照；之後內容檔變動也不覆寫。 */
export interface FieldMapSubmission {
  rowCount: number;
  /** 受空值影響（需要政策處理）的列數。 */
  affectedCount: number;
  /** 沒有受影響列時為 null。 */
  blankPolicy: MissingPolicy | null;
  rows: { id: string; values: Record<string, MappedValue> }[];
}

/** 欄位映射工作的進度。 */
export interface FieldMapProgress {
  kind: 'field-map';
  /** target field id → source field id（玩家的對應）。 */
  assignments: Record<string, string>;
  blankPolicy?: MissingPolicy;
  /** 目前的對應是否已通過「驗證並預覽」；改動對應或政策會清除。 */
  previewed: boolean;
  submitted?: FieldMapSubmission;
}

/** 依工作種類分型的進度；歸檔工作仍用 batches，不在這裡。 */
export type TaskProgress = ReconcileProgress | FieldMapProgress;

/* ---------- 訊息回覆（R7） ---------- */

/** 回答當下保存的回應快照；內容檔日後修改也不改寫已出現的對話。 */
export interface ChatResponseSnapshot {
  id: string;
  actorId: string;
  time: string;
  lines: string[];
  /**
   * 預定送達時間（epoch ms，R12）：回答當下擲一次（逐則累加 3–4 秒）並保存，重整／讀檔不重抽、不重播。
   * 沒有這個欄位＝舊存檔的回應，視為已送達。
   */
  deliverAt?: number;
}

export type ChatReply =
  | { kind: 'skipped' }
  | {
      kind: 'answered';
      choiceId: string;
      playerText: string;
      responses: ChatResponseSnapshot[];
      /** 回答的實際時間（epoch ms，R12）；舊存檔沒有。 */
      answeredAt?: number;
      /** 回答當下的遊戲日（R12）；舊存檔沒有。 */
      dayId?: DayId;
    };

/* ---------- 向同事詢問（R12） ---------- */

/** 一則說明訊息的預定送達時間（epoch ms）。 */
export interface HelpDelivery {
  messageId: string;
  at: number;
}

/**
 * 玩家主動提問的保存狀態：提問當下的遊戲日與實際時間，以及說明訊息逐則的預定送達時間。
 * 每份存檔同一提問只送一次；說明永久留存，可重看。
 */
export interface HelpRequestState {
  dayId: DayId;
  askedAt: number;
  deliveries: HelpDelivery[];
}

/* ---------- 郵件（R12） ---------- */

/** 附件：退件／收件回條所引用的案件與送件版本（null＝原始送件）。 */
export interface ReturnReceiptAttachment {
  kind: 'return-receipt';
  caseId: string;
  receiptId: string;
  versionIndex: number | null;
}

/** 郵件附件（可辨識種類的資料引用）；本輪只有退件回條。 */
export type MailAttachment = ReturnReceiptAttachment;
export const MAIL_ATTACHMENT_KINDS: readonly MailAttachment['kind'][] = ['return-receipt'];

/**
 * 一封郵件：固定 ID；寄件者與主旨／內文由內容郵件包（packId＋templateId）提供，附件是資料引用。
 * 收到時間＝dayId（遊戲日）；已讀狀態在 readMail，與案件是否解決無關。
 */
export interface MailRecord {
  id: string;
  packId: string;
  templateId: string;
  dayId: DayId;
  attachments: MailAttachment[];
}

/* ---------- 玩家角色與入職（R12） ---------- */

/** 角色資料：姓名是入職簽名的角色名（不讀帳戶或系統名稱）；null＝舊存檔未簽名。 */
export interface PlayerProfile {
  name: string | null;
}

/** 入職前情進度：step＝目前停在內容 steps 的第幾段（0 起算）；complete＝已進桌面。 */
export interface OnboardingProgress {
  step: number;
  complete: boolean;
}

/** 固定選項回覆 prompt 的識別，例如 'prompt.day3.lunch-plan'。 */
export type PromptId = string;

/**
 * 存檔格式 v11（R12）＝ v10 ＋ 角色資料與入職進度（`profile`、`onboarding`）、郵件（`mailbox`、`readMail`，
 * 取代 `readIssueReceipts`）、向同事詢問（`helpRequests`）、退件修訂草稿（`issueDrafts`），
 * 以及訊息回覆的送達時間（ChatReply／ChatResponseSnapshot 的可選欄位）。
 *
 * v10（R11）＝ v9 ＋ 持續的文件問題：案件狀態／回條、`issueSchedule`、`readIssueReceipts`。
 *
 * v9（R10）＝ v8 ＋ `returns`（延後退件）；逐筆審查與案件處理方式在既有欄位內（皆為可選欄位）。
 *
 * v8（R9）＝ v7 ＋ `caseReviews`（多來源比對案件的變體與差異標記）。
 * 案件決定本身保存在歸檔紀錄的 caseDecision 快照。
 *
 * v7（R8）說明：
 *
 * 與 v6 的差別：一天可以有多件工作，`taskId` 是當日有序佇列中目前進行的那一件；
 * 階段新增 `morning`（次日收件）；`waivedTasks` 記錄「舊檔免補」的工作——
 * 舊存檔已經跨過的日子裡，本輪才新增的工作不要求補做，但也不假裝已提交、不產生事件。
 */
export interface SaveV11 {
  version: 11;
  seed: number;
  /** 目前內容日，由內容目錄解析；不從階段硬推。 */
  dayId: DayId;
  /** 通用畫面階段：work／wrap／morning／end。 */
  stage: Stage;
  /** 當日佇列中目前進行的工作。 */
  taskId: TaskId;
  batches: Partial<Record<BatchId, BatchState>>;
  /** 非歸檔工作的進度，以 taskId 為鍵；歷史工作保留。 */
  taskProgress: Partial<Record<TaskId, TaskProgress>>;
  /** 訊息回覆；不放進 taskProgress。 */
  chatReplies: Partial<Record<PromptId, ChatReply>>;
  /** 舊檔免補的工作（只由遷移寫入）。 */
  waivedTasks: TaskId[];
  /** 多來源比對案件的閱讀狀態，以 case ID 為鍵。 */
  caseReviews: Partial<Record<string, CaseReviewState>>;
  /** 文件問題案件（R10／R11）；依建立順序。 */
  returns: ReturnCase[];
  /** 每日「錯誤文件處理」工作引用的案件（在進入該日時決定，之後不重算）。 */
  issueSchedule: Partial<Record<DayId, string[]>>;
  /** 退件修訂草稿，以回條 ID 為鍵；只有目前可修訂的回條能寫入，過期草稿保留供查看。 */
  issueDrafts: Partial<Record<string, string>>;
  /** 郵件（依收到順序）。 */
  mailbox: MailRecord[];
  /** 已開啟過的郵件 ID；與案件是否解決無關。 */
  readMail: string[];
  /** 向同事詢問的提問與說明送達排程，以提問 ID 為鍵。 */
  helpRequests: Partial<Record<string, HelpRequestState>>;
  /** 角色資料（入職簽名）。 */
  profile: PlayerProfile;
  /** 入職前情進度。 */
  onboarding: OnboardingProgress;
  night?: NightResult;
  events: GameEvent[];
  /** 已讀訊息的穩定 ID（內容訊息、回應、說明訊息）。 */
  readMessages: string[];
}

/** 現行存檔。 */
export type Save = SaveV11;

export const SAVE_VERSION = 11;

/** v10：沒有角色資料、入職、郵件、詢問與修訂草稿；下游回條的已讀記在 readIssueReceipts。 */
export type SaveV10 = Omit<
  SaveV11,
  'version' | 'issueDrafts' | 'mailbox' | 'readMail' | 'helpRequests' | 'profile' | 'onboarding'
> & {
  version: 10;
  readIssueReceipts: string[];
};

/* ---------- 舊格式：只用於載入後遷移 ---------- */

/** v9 的退件格式（R10）：狀態只有 pending／resubmitted／window，沒有回條與排程。 */
export interface LegacyReturnCaseV9 {
  id: string;
  auditId: string;
  batchId: BatchId;
  recordKey: RecordKey;
  archiveTaskId: TaskId;
  reviewTaskId: TaskId;
  sourceCode: string;
  submittedCode: string;
  reviewedCode: string;
  disposition: 'release';
  reason: 'code-mismatch';
  notifyDayId: DayId;
  returnDayId: DayId;
  status: 'pending' | 'resubmitted' | 'window';
  versions: { action: 'resubmit' | 'window'; code: string; dayId: DayId }[];
}

/** v9：returns 為舊格式，沒有 issueSchedule／readIssueReceipts。 */
export type SaveV9 = Omit<SaveV10, 'version' | 'returns' | 'issueSchedule' | 'readIssueReceipts'> & {
  version: 9;
  returns: LegacyReturnCaseV9[];
};

/** v8：v9 少了 returns。 */
export type SaveV8 = Omit<SaveV9, 'version' | 'returns'> & { version: 8 };

/** v7：v8 少了 caseReviews。 */
export type SaveV7 = Omit<SaveV8, 'version' | 'caseReviews'> & { version: 7 };

/** v6：v7 少了 waivedTasks，且階段沒有 morning。 */
export type SaveV6 = Omit<SaveV7, 'version' | 'waivedTasks'> & { version: 6 };

/** v5：v6 少了 chatReplies。 */
export type SaveV5 = Omit<SaveV6, 'version' | 'chatReplies'> & { version: 5 };

/** v4：dayId＋stage＋taskId，但 evidence／reply 仍是全域欄位。 */
export interface SaveV4 {
  version: 4;
  seed: number;
  dayId: DayId;
  stage: Stage;
  taskId: TaskId;
  batches: Partial<Record<BatchId, BatchState>>;
  night?: NightResult;
  evidence: Evidence;
  reply?: Reply;
  events: GameEvent[];
  readMessages: string[];
}

/** v3：批次化但仍以 phase 表示流程。 */
export interface SaveV3 {
  version: 3;
  seed: number;
  phase: Phase;
  dayId: DayId;
  batches: Partial<Record<BatchId, BatchState>>;
  night?: NightResult;
  evidence: Evidence;
  reply?: Reply;
  events: GameEvent[];
  readMessages: string[];
}

/** v2：全域 archived／drafts，編號已是字串。 */
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

export const LEGACY_SAVE_VERSIONS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10];

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
