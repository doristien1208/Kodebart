import { RETURN_RECEIPT_MAIL_PACK } from '../core/mail';
import { CaseDestination, DayId, Reply } from '../core/types';

/**
 * game/content/schema：內容資料檔（data/**.json）的型別與白名單。
 *
 * 這裡只放結構、允許值與 ID 規則，不放任何玩家可見文本；文本一律在 data/ 的 JSON。
 * 資料檔不得包含可執行 JavaScript、函式字串或運算式；需要代入數值的地方
 * 一律使用 `{placeholder}` 樣板，由 content/format.ts 以純字串取代處理。
 *
 * 各種 `text` 區塊的必要欄位以 *_SHAPE 常數描述（KB-R5-02）：TypeScript 型別由 shape 推導，
 * validate-content.ts 也依同一份 shape 逐欄檢查，因此型別與驗證不會各自為政。
 */

/* ---------- ID 命名空間 ---------- */

/** 每一種內容的 ID 前綴；validate-content.ts 依此檢查。 */
export const ID_PREFIX = {
  actor: 'actor.',
  channel: 'channel.',
  message: 'msg.',
  record: 'record.',
  document: 'doc.',
  day: 'day.',
  task: 'task.',
  /** 工作批次（KB-R5-03）；archive 任務定義，reconcile 任務以 sourceBatchId 引用。 */
  batch: 'batch.',
  bulletin: 'bulletin.',
  transition: 'transition.',
  /** field-map 任務的資料列（R6-03）；只需在同一任務內唯一。 */
  row: 'row.',
  /** 訊息的固定回覆 prompt（R7）；全域唯一，條件 `cond.chat.*` 以去掉前綴的部分引用。 */
  prompt: 'prompt.',
  /** 多來源比對案件（R9）；掛在 archive 任務的 caseReview，全域唯一，條件 `cond.case.*` 以去掉前綴的部分引用。 */
  case: 'case.',
  /** 郵件內容包（R12，data/mail/）；郵件紀錄以 packId 引用。 */
  mail: 'mail.',
  /** 郵件寄件者（R12）；只在郵件包內，不是人物、也不是真實 email 地址。 */
  sender: 'sender.',
  /** 入職前情包（R12，data/onboarding/）。 */
  onboarding: 'onboarding.',
  /** 向同事詢問的說明包（R12，data/help/）。 */
  help: 'help.',
  /** 詢問說明包的提問（R12）；全域唯一，條件 `cond.help.<去前綴>.requested` 引用，存檔 helpRequests 以此為鍵。 */
  request: 'request.',
} as const;

/**
 * 固定回覆的 choice ID（R7）：只在同一 prompt 內唯一，且**不得含 `.`**——
 * `cond.chat.<prompt 去前綴>.<choiceId>` 以最後一個 `.` 切開。
 */
export const CHOICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 退件稽核 ID（R10，reconcile 任務的 `returnAudit.id`）：全域唯一、不含 `.`，
 * 與 choice ID 同一套字元規則；`cond.return.notified.<auditId>` 與（可省略的）return-review 任務 `auditId` 引用。
 * 不帶前綴、也不要求所屬日識別（例如 `day1-code-audit` 指的是被稽核的 Day 1 批次）。
 */
export const AUDIT_ID_PATTERN = CHOICE_ID_PATTERN;

/** 訊息與回覆的顯示時間：24 小時制 `HH:MM`（R7）。 */
export const MESSAGE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** ID 只允許小寫英數、`-` 與作為命名空間分隔的 `.`。 */
export const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * 每日 ID 的格式：`day.` 後接至少兩位數字（前導零保留），數字必須等於 `day` 欄位。
 * 例如 `day.01` ↔ `day: 1`、`day.10` ↔ `day: 10`。
 */
export const DAY_ID_PATTERN = /^day\.(\d{2,})$/;

/** 由 day ID 解析日序；格式不符回傳 NaN。 */
export function parseDayId(dayId: string): number {
  const m = DAY_ID_PATTERN.exec(dayId);
  return m === null ? Number.NaN : Number(m[1]);
}

/**
 * 該日檔內的 task／transition／document／message ID 必須包含的日識別片段，
 * 例如 `day.02` 的內容 ID 為 `task.day2.*`、`msg.day2.*`。避免複製檔案後只改其中一處。
 */
export function dayToken(dayNumber: number): string {
  return `day${dayNumber}`;
}

/**
 * 每日「錯誤文件處理」位置的任務 ID（R11）：`task.day<N>.return-review`。
 * 當日內容若已定義 return-review 任務就用內容的；否則狀態層以這個 ID 插入虛擬任務。
 * 因此這個 ID 保留給 return-review：其他 kind 的任務不得使用（validate-content.ts 檢查）。
 */
export function issueTaskId(dayNumber: number): string {
  return `task.${dayToken(dayNumber)}.return-review`;
}

const ISSUE_TASK_ID_PATTERN = /^task\.day(\d+)\.return-review$/;

/** 由 `task.day<N>.return-review` 解析日序；不是這個格式回傳 NaN。 */
export function parseIssueTaskId(taskId: string): number {
  const m = ISSUE_TASK_ID_PATTERN.exec(taskId);
  return m === null ? Number.NaN : Number(m[1]);
}

/* ---------- 允許值白名單 ---------- */

/** 訊息頻道分類：部門大群、同事小圈圈、個人訊息（KB-R4-04）。 */
export const CHANNEL_KINDS = ['department', 'group', 'direct'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * 每日任務種類；新增玩法時在這裡加，並由規則層決定如何執行。
 * `return-review`（R10／R11）：錯誤文件處理；每天一個位置，只有當天排入到期的文件問題案件時才進入佇列，否則不佔工作。
 */
export const TASK_KINDS = ['archive', 'reconcile', 'field-map', 'return-review'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** field-map 目標欄位的轉換方式（R6-03）：text 原樣帶入；boolean 依 trueValue／falseValue 轉換，空字串交給 blankPolicy。 */
export const FIELD_CONVERSIONS = ['text', 'boolean'] as const;
export type FieldConversion = (typeof FIELD_CONVERSIONS)[number];

/** 文件種類（工作中可開啟的資料）。`case-source` 是比對案件的來源文件（R9）。 */
export const DOCUMENT_KINDS = ['report', 'receipt', 'case-source'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * 比對案件決定的資料去向（R9）：`archive` 正式歸檔、`review` 送窗口待查。
 * 與 core 的 CaseDestination 同一組值；與拒絕紀錄的 origin=review（資料覆核佇列）無關。
 */
export const CASE_DECISION_DESTINATIONS = ['archive', 'review'] as const satisfies readonly CaseDestination[];

/**
 * 文件問題案件的狀態（R11）；與 core 的 ReturnStatus 同一組值。
 * 介面文字在 ui.documentIssues.status（鍵為 camelCase，text.ts 的 issueStatusLabel 對應）。
 */
export const ISSUE_STATUSES = ['pending', 'awaiting-check', 'awaiting-window', 'resolved'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** 下游回條的種類（R11）：退件回條、收件回條。 */
export const ISSUE_RECEIPT_KINDS = ['returned', 'resolved'] as const;
export type IssueReceiptKind = (typeof ISSUE_RECEIPT_KINDS)[number];

/** 退件原因（R11）：目前只有下游核對發現的編號差異；文字沿用 ui.returnedReview.codeMismatch。 */
export const ISSUE_REASONS = ['code-mismatch'] as const;
export type IssueReason = (typeof ISSUE_REASONS)[number];

/* ---------- 郵件、入職與詢問內容包（R12） ---------- */

/** R12 三種內容包（郵件、入職、詢問說明）目前的 schemaVersion。 */
export const CONTENT_PACK_SCHEMA_VERSION = 1;

/**
 * 退件回條郵件包的 ID（R12）＝ core 的 RETURN_RECEIPT_MAIL_PACK（唯一來源在 core/mail.ts）。
 * 模板 ID＝回條種類（ISSUE_RECEIPT_KINDS：returned／resolved）。驗證要求內容一定有這個包。
 */
export const RETURN_RECEIPT_MAIL_PACK_ID: typeof RETURN_RECEIPT_MAIL_PACK = RETURN_RECEIPT_MAIL_PACK;

/** 郵件模板（主旨、內文、附件名）可用的 placeholder；只做純字串代入，不執行 HTML（text.ts 的 renderMailTemplate）。 */
export const MAIL_TEMPLATE_PLACEHOLDERS = ['caseNumber', 'versionLabel', 'reason'] as const;
export type MailTemplatePlaceholder = (typeof MAIL_TEMPLATE_PLACEHOLDERS)[number];

/** 入職前情的段落種類：旁白一段（line）、合約與簽名（contract，整段一次顯示）。 */
export const ONBOARDING_STEP_KINDS = ['line', 'contract'] as const;
export type OnboardingStepKind = (typeof ONBOARDING_STEP_KINDS)[number];

/** 前情的推進方式：打字中先完整顯示當段，下一次才換段。 */
export const ONBOARDING_ADVANCE_MODES = ['reveal-current-then-next'] as const;
/** 減少動態時：當段直接完整顯示，仍由玩家逐段前進。 */
export const ONBOARDING_REDUCED_MOTION_MODES = ['show-current-step'] as const;

/** 入職前情的底色與字色：`#rrggbb`。 */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** onboarding ui.loggingIn 必須且只能使用的 placeholder（角色名）。 */
export const ONBOARDING_LOGGING_IN_PLACEHOLDERS = ['playerName'] as const;

/**
 * 訊息變體來源：同一時間點只會出現其中一則。
 * 目前只有夜間閒聊版本（無陰謀的普通亂數，由存檔的 night 決定）。
 */
export const VARIANT_KEYS = ['night.smallTalkVariant'] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

/* ---------- 文字區塊的 shape ---------- */

/**
 * 文字區塊的結構描述：葉節點 `'string'` 代表必要且非空的字串，物件代表巢狀區塊。
 * 欄位名以 `Template` 結尾者另受 TEMPLATE_FIELDS 的 placeholder 檢查。
 */
export interface Shape {
  readonly [key: string]: 'string' | Shape;
}

/** 由 shape 推導 TypeScript 型別。 */
export type FromShape<S extends Shape> = {
  readonly [K in keyof S]: S[K] extends Shape ? FromShape<S[K]> : string;
};

/** 三種回覆各一句；鍵與 core 的 Reply 一致。 */
const REPLY_SHAPE = { ack: 'string', ask: 'string', review: 'string' } as const satisfies Record<Reply, 'string'>;

/**
 * `kind: "archive"` 任務的日別文字（R6-01）：只剩標題與說明。
 * 欄位標籤、驗證、確認、佇列等共同字串在 ui.zh-Hant.json 的 `archive`（ARCHIVE_UI_SHAPE），
 * Day 1／3／4／5 共用一份；每日檔帶入共同欄位會被驗證擋下。
 */
export const ARCHIVE_TASK_TEXT_SHAPE = {
  eyebrow: 'string',
  heading: 'string',
  instruction: 'string',
} as const satisfies Shape;
export type ArchiveTaskText = FromShape<typeof ARCHIVE_TASK_TEXT_SHAPE>;

/** 所有 archive 任務共用的介面字串（ui.zh-Hant.json 的 `archive`）。 */
export const ARCHIVE_UI_SHAPE = {
  progressTemplate: 'string',
  doneHeading: 'string',
  doneBody: 'string',
  doneCode: 'string',
  doneMethod: 'string',
  methodReview: 'string',
  methodArchive: 'string',
  nameLabel: 'string',
  fieldLabel: 'string',
  missingLegend: 'string',
  policyDefault: 'string',
  policyDefaultHint: 'string',
  policyReview: 'string',
  policyReviewHint: 'string',
  validate: 'string',
  previewOk: 'string',
  /** 歸檔預覽三列摘要（R7 §6.2）：人員編號、拒絕狀態（recordStatus）、資料去向。 */
  previewHeading: 'string',
  previewCode: 'string',
  previewStatus: 'string',
  previewDestination: 'string',
  destinationArchive: 'string',
  destinationReview: 'string',
  confirm: 'string',
  footerDone: 'string',
  footerPendingTemplate: 'string',
  statusArchived: 'string',
  queueEyebrow: 'string',
  queueLabel: 'string',
  queuePending: 'string',
  queueDone: 'string',
  queueDoneMark: 'string',
  queueSelectedMark: 'string',
} as const satisfies Shape;
export type ArchiveUi = FromShape<typeof ARCHIVE_UI_SHAPE>;

/** `kind: "field-map"` 任務的日別文字（R6-03）：標題、說明與兩種空白值處理方式的選項文字。 */
export const FIELD_MAP_TASK_TEXT_SHAPE = {
  eyebrow: 'string',
  heading: 'string',
  instruction: 'string',
  policyDefault: 'string',
  policyReview: 'string',
} as const satisfies Shape;
export type FieldMapTaskText = FromShape<typeof FIELD_MAP_TASK_TEXT_SHAPE>;

/** 所有 field-map 任務共用的介面字串（ui.zh-Hant.json 的 `fieldMap`）；純功能性文字。 */
export const FIELD_MAP_UI_SHAPE = {
  sourceEyebrow: 'string',
  sourceLabel: 'string',
  targetHeading: 'string',
  selectPlaceholder: 'string',
  mappingError: 'string',
  /**
   * 依玩家實際配對無法轉換的值（R10，例如 boolean 目標配到值不是 trueValue／falseValue／空字串的來源）。
   * 中性功能文字：只說無法轉換，不說哪個配對才對。
   */
  convertError: 'string',
  policyRequired: 'string',
  blankLegend: 'string',
  blankValue: 'string',
  validate: 'string',
  previewHeading: 'string',
  rowCountLabel: 'string',
  affectedLabel: 'string',
  policyHandledLabel: 'string',
  codeSampleLabel: 'string',
  /** 預覽表格的 boolean／空值顯示（R7 §6.2）：true、false、null 不直接顯示給玩家。 */
  excluded: 'string',
  notExcluded: 'string',
  pendingReview: 'string',
  confirm: 'string',
  doneHeading: 'string',
  doneBody: 'string',
  footerDone: 'string',
  footerPending: 'string',
  statusImported: 'string',
} as const satisfies Shape;
export type FieldMapUi = FromShape<typeof FIELD_MAP_UI_SHAPE>;

/**
 * 玩家可見的紀錄狀態（ui.zh-Hant.json 的 `recordStatus`，R7 §6.1）。
 * 底層仍是 boolean／null 與 origin；介面一律顯示這些文字，不顯示 true／false／null。
 */
export const RECORD_STATUS_SHAPE = {
  notApplicable: 'string',
  missing: 'string',
  refused: 'string',
  notRefused: 'string',
  unconfirmed: 'string',
  defaultedNotRefused: 'string',
  sourceNotRefused: 'string',
  sourceRefused: 'string',
} as const satisfies Shape;
export type RecordStatusText = FromShape<typeof RECORD_STATUS_SHAPE>;

/** 來源卡的標籤（ui.zh-Hant.json 的 `sourceCard`）；拒絕紀錄的值改由 recordStatus 顯示（R7）。 */
export const SOURCE_CARD_UI_SHAPE = {
  eyebrowTemplate: 'string',
  name: 'string',
  code: 'string',
  refusal: 'string',
} as const satisfies Shape;
export type SourceCardUi = FromShape<typeof SOURCE_CARD_UI_SHAPE>;

/** 訊息頁三種頻道分類的區段標題；鍵與 CHANNEL_KINDS 一致。 */
const SECTION_TITLE_SHAPE = { department: 'string', group: 'string', direct: 'string' } as const satisfies Record<
  ChannelKind,
  'string'
>;

/**
 * 訊息頁（ui.zh-Hant.json 的 `messages`，KB-R4-04／R7 §2）：通訊軟體外殼、頻道列表、對話 header、
 * 固定回覆區與未讀的可見字串。未讀文字是螢幕閱讀器用的說明，紅點本身不帶語意。
 */
export const MESSAGES_UI_SHAPE = {
  workspace: 'string',
  /** 頻道列表的無障礙名稱。 */
  listLabel: 'string',
  /** 窄螢幕從對話返回列表。 */
  backToList: 'string',
  /** 三種頻道分類的區段標題；鍵與 CHANNEL_KINDS 一致。 */
  sectionTitle: SECTION_TITLE_SHAPE,
  /** 某一分類目前沒有頻道時的中性文字。 */
  sectionEmpty: 'string',
  selectHeading: 'string',
  selectPrompt: 'string',
  /** 頻道已開啟但目前沒有已解鎖訊息。 */
  emptyChannel: 'string',
  /** direct 對話 header 的狀態。 */
  online: 'string',
  /** department／group 對話 header 的成員數；`{count}`。 */
  memberCountTemplate: 'string',
  /** 玩家回覆的作者名。 */
  you: 'string',
  quickReplyHeading: 'string',
  skipReply: 'string',
  /** 回覆送出後、對方回應出現前的輸入中提示；`{name}`。 */
  typingTemplate: 'string',
  unreadTemplate: 'string',
  unreadChannelTemplate: 'string',
  /** 停在歷史訊息上方時、下方有新訊息的「跳到最新」提示（R12）。 */
  newBelow: 'string',
  /** 同一提示按鈕的無障礙名稱。 */
  newBelowAria: 'string',
} as const satisfies Shape;
export type UiMessages = FromShape<typeof MESSAGES_UI_SHAPE>;

/**
 * 封面「本機紀錄」的進度樣板（ui.zh-Hant.json 的 `progressLabel`）；`{dayName}` 取自 workbench.dayName。
 * 鍵對應 core 的 Stage（R8 加入 `morning`＝次日收件）。
 */
export const PROGRESS_LABEL_SHAPE = {
  workTemplate: 'string',
  wrapTemplate: 'string',
  morningTemplate: 'string',
  endTemplate: 'string',
} as const satisfies Shape;
export type ProgressLabelText = FromShape<typeof PROGRESS_LABEL_SHAPE>;

/** 以任務種類為鍵的一組字串；鍵與 TASK_KINDS 一致（`field-map`／`return-review` 含連字號）。 */
const TASK_KIND_SHAPE = {
  archive: 'string',
  reconcile: 'string',
  'field-map': 'string',
  'return-review': 'string',
} as const satisfies Record<TaskKind, 'string'>;

/**
 * 同日多工作的共用字串（ui.zh-Hant.json 的 `tasks`，R8 §1）：步驟、狀態、交付按鈕、種類與單位。
 * 取代原本 archive／fieldMap 各自的 `finishDay`，reconcile 對話框的 `dialog.finish` 也改用這裡。
 * `statusWaived` 只給舊存檔免補的工作用，不得寫成「已完成／已提交」。
 */
export const TASKS_UI_SHAPE = {
  listLabel: 'string',
  /** `{index}` 為 1 起算的第幾項、`{total}` 為當日工作數。 */
  stepTemplate: 'string',
  statusDone: 'string',
  statusActive: 'string',
  statusPending: 'string',
  statusWaived: 'string',
  /** 當日尚有其他工作時的交付按鈕。 */
  deliver: 'string',
  /** 當日最後一項工作的交付按鈕。 */
  finishDay: 'string',
  /** 種類對應的業務動詞（歸檔／核對／匯入／複審）。 */
  kind: TASK_KIND_SHAPE,
  /** 種類對應的數量單位（筆／列）。 */
  unit: TASK_KIND_SHAPE,
} as const satisfies Shape;
export type TasksUi = FromShape<typeof TASKS_UI_SHAPE>;

/**
 * 日結頁「本日交接」的共用字串（ui.zh-Hant.json 的 `handoff`，R8 §2）。
 * 每日的 docTitle／eyebrow／heading／body 仍在該日 transition.text（WRAP_TRANSITION_TEXT_SHAPE）。
 */
export const HANDOFF_UI_SHAPE = {
  eyebrow: 'string',
  heading: 'string',
  /** `{count}`＝當日工作項數（不是筆數）。 */
  totalTemplate: 'string',
  /** `{kind}`＝業務動詞、`{count}`＝實際筆數／列數、`{unit}`＝單位。 */
  itemTemplate: 'string',
  doneMark: 'string',
  next: 'string',
  backToCover: 'string',
} as const satisfies Shape;
export type HandoffUi = FromShape<typeof HANDOFF_UI_SHAPE>;

/** 次日收件（Stage `morning`）的共用字串（ui.zh-Hant.json 的 `morning`，R8 §2）；問候沿用該日 workbench.greeting。 */
export const MORNING_UI_SHAPE = {
  eyebrow: 'string',
  heading: 'string',
  listHeading: 'string',
  /** `{count}`＝待處理數量、`{unit}`＝單位。 */
  pendingTemplate: 'string',
  start: 'string',
  backToCover: 'string',
  /** `{dayName}`；此路徑的 placeholder 另登記在 TEMPLATE_FIELDS（與 workbench.docTitleTemplate 不同）。 */
  docTitleTemplate: 'string',
} as const satisfies Shape;
export type MorningUi = FromShape<typeof MORNING_UI_SHAPE>;

/**
 * 工作頁右欄「系統作業紀錄」（ui.zh-Hant.json 的 `executionLog`，R8 §3）。唯讀、只轉寫已保存的流程結果。
 * `command` 是每種紀錄的指令名、`key` 是精簡 JSON 輸出的鍵名；兩者都是資料，presenter 不寫死。
 * 資料去向與空白處理的值沿用 ui.archive.destination*／ui.fieldMap.notExcluded／pendingReview（text.ts 組合），不另存一份。
 */
export const EXECUTION_LOG_UI_SHAPE = {
  heading: 'string',
  ariaLabel: 'string',
  empty: 'string',
  /** 指令列前的提示符號。 */
  prompt: 'string',
  command: {
    archive: 'string',
    reply: 'string',
    fieldMap: 'string',
    handoff: 'string',
    /** 退件複審的送出（R10）。 */
    returnReview: 'string',
    /** 第二輪逐筆審查的處置（R10）。 */
    recordReview: 'string',
    /** 下游核對回條（R11）：`$ receipt.check <案號>`。 */
    receiptCheck: 'string',
  },
  key: {
    check: 'string',
    personnelId: 'string',
    /** 逐筆審查：已保存審查紀錄中的原始來源編號（R10）。 */
    source: 'string',
    status: 'string',
    destination: 'string',
    reply: 'string',
    rows: 'string',
    blank: 'string',
    blankPolicy: 'string',
    result: 'string',
    items: 'string',
    /** 比對案件（R9）：提交快照中的依據文件與差異註記。 */
    basis: 'string',
    note: 'string',
  },
  check: { pass: 'string' },
  result: { delivered: 'string', sentReview: 'string', sent: 'string' },
} as const satisfies Shape;
export type ExecutionLogUiText = FromShape<typeof EXECUTION_LOG_UI_SHAPE>;

/**
 * 多來源比對案件的共用介面字（ui.zh-Hant.json 的 `caseReview`，R9）。純功能性文字：
 * 不寫誰對誰錯、不標推薦選項；決定的 label／note 與文件內容在每日檔。
 * `destination` 是案件決定的去向（窗口待查 ≠ 拒絕紀錄的資料覆核佇列）。
 */
export const CASE_REVIEW_UI_SHAPE = {
  eyebrow: 'string',
  heading: 'string',
  instruction: 'string',
  /** 從歸檔表單開啟案件的按鈕。 */
  open: 'string',
  sourcesHeading: 'string',
  /** 抽中的補件收件狀態等佐證文件的區段標題。 */
  supportingHeading: 'string',
  fieldHeader: 'string',
  valueHeader: 'string',
  markDiff: 'string',
  unmarkDiff: 'string',
  markedLabel: 'string',
  /** `{count}`＝已標記的欄位數。 */
  markedCountTemplate: 'string',
  decisionsHeading: 'string',
  decisionRequired: 'string',
  codeLabel: 'string',
  /**
   * 可編輯的歸檔人員編號輸入框（R10）；處理方式只決定依據／去向／註記，不寫入或改動編號（R11：沒有來源帶入按鈕，
   * 編號一律由玩家輸入）。
   */
  codeInputLabel: 'string',
  basisLabel: 'string',
  noteLabel: 'string',
  destinationLabel: 'string',
  destination: { archive: 'string', review: 'string' },
  confirm: 'string',
  doneHeading: 'string',
  receiptHeading: 'string',
  closeLabel: 'string',
} as const satisfies Shape;
export type CaseReviewUi = FromShape<typeof CASE_REVIEW_UI_SHAPE>;

/**
 * 共用視窗殼（ui.zh-Hant.json 的 `windowShell`，R9 §3）：系統作業紀錄窗的歷史切換。
 * R12 移除停靠／展開／收合／關閉／重新開啟與切換列（視窗按鈕改用 `windows`）。
 */
export const WINDOW_SHELL_UI_SHAPE = {
  history: { show: 'string', hide: 'string' },
} as const satisfies Shape;
export type WindowShellUi = FromShape<typeof WINDOW_SHELL_UI_SHAPE>;

/**
 * 提交的執行階段（ui.zh-Hant.json 的 `operation`，R10 §3）：接收 → 檢查格式 → 處理 → 保存 → 完成／失敗。
 * `validated`（格式檢查通過）只代表結構與型別合法，不代表內容正確；`done` 只在持久化成功後顯示。
 */
export const OPERATION_UI_SHAPE = {
  /** 階段列的無障礙名稱。 */
  ariaLabel: 'string',
  received: 'string',
  validating: 'string',
  validated: 'string',
  processing: 'string',
  saving: 'string',
  done: 'string',
  failed: 'string',
  /** 失敗後的說明：尚未保存、可重試。 */
  failedHint: 'string',
  /** 規則不允許（例如案件已換新版本、已由另一個視窗送出）時的說明：沒有套用，不提供重試。 */
  rejectedHint: 'string',
  retry: 'string',
  /** 同一工作提交中（禁止重送）的按鈕／提示文字。 */
  busy: 'string',
} as const satisfies Shape;
export type OperationUi = FromShape<typeof OPERATION_UI_SHAPE>;

/**
 * 浮動視窗與視窗列（ui.zh-Hant.json 的 `windows`，R10 §2）；純功能性文字。
 * R12 移除 reopen 與 resetLayout（「重設視窗位置」改在桌面主選單 desktop.menu.resetLayout）。
 */
export const WINDOWS_UI_SHAPE = {
  minimize: 'string',
  maximize: 'string',
  restore: 'string',
  close: 'string',
  /** 視窗列（最小化後還原處）的無障礙名稱。 */
  taskbarLabel: 'string',
  openLog: 'string',
  /** 文件視窗群組的標籤。 */
  documentsLabel: 'string',
  /** 標題列的鍵盤操作說明。 */
  moveHint: 'string',
} as const satisfies Shape;
export type WindowsUi = FromShape<typeof WINDOWS_UI_SHAPE>;

/**
 * 核對的逐筆審查（ui.zh-Hant.json 的 `recordReview`，R10 §5）。
 * heading／release／hold 逐字來自 doc/content/R10-return-review.json；其餘是狀態與送出回覆前的提示。
 * 「確認收到摘要」不是放行；放行／保留待查是另外保存的處置。
 */
export const RECORD_REVIEW_UI_SHAPE = {
  heading: 'string',
  release: 'string',
  hold: 'string',
  /** 審查清單的無障礙名稱。 */
  listLabel: 'string',
  statusPending: 'string',
  statusReleased: 'string',
  statusHeld: 'string',
  /** 尚有紀錄未選處置時，送出回覆前的提示。 */
  requiredNotice: 'string',
} as const satisfies Shape;
export type RecordReviewUi = FromShape<typeof RECORD_REVIEW_UI_SHAPE>;

/**
 * 退件複審（ui.zh-Hant.json 的 `returnedReview`，R10 §5）：逐字來自 doc/content/R10-return-review.json，不改寫。
 * R11 起工作清單上的標題改用 documentIssues.taskHeading（bundle.ts 的 taskHeading）；這裡仍是單一案件的處理字串，
 * `codeMismatch` 也是退件原因文字（text.ts 的 issueReasonText）。
 */
export const RETURNED_REVIEW_UI_SHAPE = {
  heading: 'string',
  instruction: 'string',
  source: 'string',
  firstSubmission: 'string',
  reviewRecord: 'string',
  reason: 'string',
  /** 退件原因（下游核對發現的差異）；不是輸入驗證錯誤。 */
  codeMismatch: 'string',
  resubmit: 'string',
  sendToWindow: 'string',
  resubmitted: 'string',
  pendingWindow: 'string',
} as const satisfies Shape;
export type ReturnedReviewUi = FromShape<typeof RETURNED_REVIEW_UI_SHAPE>;

/**
 * 文件問題案件與每日「錯誤文件處理」工作（ui.zh-Hant.json 的 `documentIssues`，R11）。中性功能文字：
 * 只描述案件狀態，不寫誰對誰錯；重送 ≠ 已解決，只有下游收件回條才是已解決。
 * 退件原因、單一案件的處理按鈕與欄位標籤沿用 returnedReview（不另存一份）。
 * R12 起案件的通知與入口改為郵件（郵件包 mail.return-receipts），「文件問題」頁已移除：
 * 頁首、篩選、清單欄位、空狀態、未讀／待處理件數、下次處理日與回條發出日等只供該頁的字一併移除；
 * 這裡只留郵件附件、郵件閱讀與當日工作仍使用的字。
 */
export const DOCUMENT_ISSUES_UI_SHAPE = {
  /** 案件狀態；鍵對應 ISSUE_STATUSES（awaiting-check → awaitingCheck、awaiting-window → awaitingWindow）。 */
  status: { pending: 'string', awaitingCheck: 'string', awaitingWindow: 'string', resolved: 'string' },
  /** 送窗口待查、尚無下游核對結果的版本所顯示的狀態。 */
  next: { windowWaiting: 'string' },
  /** 第幾次送件；`{number}` 為 1 起算（原始送件為第 1 次）。 */
  submissionTemplate: 'string',
  /** 來源工作；`{dayName}`＝該工作所屬日、`{task}`＝工作標題（bundle.ts 的 taskHeading）。 */
  sourceTaskTemplate: 'string',
  /** 附件文件內的區段：原件、歷次修改、第二輪審查。 */
  sections: { original: 'string', versions: 'string', reviewRecord: 'string' },
  /** 某一版送件的下游核對結果（尚未核對的版本用 status.awaitingCheck）。 */
  outcome: { resolved: 'string', returned: 'string' },
  receipts: {
    /** 退件回條標題；`{caseNumber}`。 */
    returnedTemplate: 'string',
    /** 收件回條標題；`{caseNumber}`。 */
    resolvedTemplate: 'string',
    /** 回條上核對的送件編號標籤。 */
    codeLabel: 'string',
    /** 收件回條的結案說明（原因行沿用 returnedReview.reason／codeMismatch）。 */
    resolvedNote: 'string',
  },
  /** 郵件閱讀窗（窄版）返回信件清單的按鈕。 */
  close: 'string',
  /** 每日「錯誤文件處理」工作：虛擬任務的 eyebrow（內容定義的 return-review 任務用自己的 text.eyebrow）。 */
  taskEyebrow: 'string',
  /** 每日「錯誤文件處理」工作在工作清單與工作頁上的標題（bundle.ts 的 taskHeading）。 */
  taskHeading: 'string',
  taskInstruction: 'string',
  /** 當日工作中的案件列（R12）：開啟該案最新郵件的按鈕、此案今日已處理的標示。 */
  task: { openMail: 'string', handled: 'string' },
} as const satisfies Shape;
export type DocumentIssuesUi = FromShape<typeof DOCUMENT_ISSUES_UI_SHAPE>;

/**
 * 電腦桌面（ui.zh-Hant.json 的 `desktop`，R12）：三個應用入口、視窗列未讀、主選單與狀態區。純功能性文字。
 * 應用鍵與桌面應用視窗（app.work／app.messages／app.mail）一致。
 */
export const DESKTOP_UI_SHAPE = {
  /** 桌面區域的無障礙名稱。 */
  label: 'string',
  /** 應用入口群組的無障礙名稱。 */
  appsLabel: 'string',
  apps: { work: 'string', messages: 'string', mail: 'string' },
  /** 應用入口按鈕的無障礙名稱；`{app}`＝應用名稱。 */
  openAppTemplate: 'string',
  /** 郵件入口的未讀數（螢幕閱讀器）；`{count}`。 */
  mailUnreadTemplate: 'string',
  /** 主選單：icon 按鈕的無障礙名稱、選單標籤與三個選項。 */
  menu: { button: 'string', label: 'string', backToCover: 'string', motion: 'string', resetLayout: 'string' },
  /** 系統狀態區（時間、使用者）的無障礙名稱。 */
  statusLabel: 'string',
  /** 桌面的分頁標題（再由 pageTitle 加上 app 後綴）。 */
  docTitle: 'string',
} as const satisfies Shape;
export type DesktopUi = FromShape<typeof DESKTOP_UI_SHAPE>;
export type DesktopApp = keyof DesktopUi['apps'];

/**
 * 郵件應用的介面字（郵件包的 `ui`，R12；目前取 mail.return-receipts 的 ui，text.ts 的 MAIL_UI）。
 * 收件匣／篩選／空狀態／閱讀區欄位、附件版本狀態（歷史／目前待處理／已送出／已結案）、過期與找不到附件、
 * 讀取失敗，以及附件版本名稱（initialVersion＝原始送件；revisionTemplate 代入 `{revision}`＝index＋1）與退件原因。
 */
export const MAIL_UI_SHAPE = {
  appName: 'string',
  inbox: 'string',
  all: 'string',
  unread: 'string',
  pending: 'string',
  empty: 'string',
  emptyUnread: 'string',
  emptyPending: 'string',
  selectMail: 'string',
  sender: 'string',
  received: 'string',
  attachments: 'string',
  openAttachment: 'string',
  historical: 'string',
  current: 'string',
  awaiting: 'string',
  resolved: 'string',
  stale: 'string',
  missingAttachment: 'string',
  loadFailed: 'string',
  retry: 'string',
  initialVersion: 'string',
  revisionTemplate: 'string',
  codeMismatch: 'string',
} as const satisfies Shape;
export type MailUi = FromShape<typeof MAIL_UI_SHAPE>;

/** 入職前情的介面字（入職包的 `ui`，R12）；loggingIn 必須含 `{playerName}`，legacyPlayerName 是舊存檔沒有姓名時的顯示名。 */
export const ONBOARDING_UI_SHAPE = {
  continue: 'string',
  reveal: 'string',
  signing: 'string',
  saveFailed: 'string',
  retry: 'string',
  loggingIn: 'string',
  legacyPlayerName: 'string',
} as const satisfies Shape;
export type OnboardingUi = FromShape<typeof ONBOARDING_UI_SHAPE>;

/** 合約簽名欄（R12）的文字；maxGraphemes 另外檢查（必須等於 core 的 PLAYER_NAME_MAX）。 */
export const ONBOARDING_SIGNATURE_TEXT_SHAPE = {
  label: 'string',
  placeholder: 'string',
  submit: 'string',
  required: 'string',
  tooLong: 'string',
} as const satisfies Shape;

/** 詢問說明包的入口文字（R12）：第一次詢問、之後重看說明。 */
export const HELP_UI_SHAPE = {
  ask: 'string',
  revisit: 'string',
} as const satisfies Shape;
export type HelpUi = FromShape<typeof HELP_UI_SHAPE>;

/** `kind: "reconcile"` 任務的畫面文字（Day 2 核對、回覆選項與回覆對話框）。 */
export const RECONCILE_TASK_TEXT_SHAPE = {
  eyebrow: 'string',
  heading: 'string',
  body: 'string',
  openReport: 'string',
  reportOpened: 'string',
  openReceipt: 'string',
  receiptOpened: 'string',
  replyHeading: 'string',
  choices: REPLY_SHAPE,
  hintNeedReport: 'string',
  hintNeedReceipt: 'string',
  hintReady: 'string',
  dialog: {
    headingAsk: 'string',
    headingDefault: 'string',
    response: REPLY_SHAPE,
    back: 'string',
  },
} as const satisfies Shape;
export type ReconcileTaskText = FromShape<typeof RECONCILE_TASK_TEXT_SHAPE>;

/**
 * `kind: "return-review"` 任務的日別文字（R10）：只有 eyebrow。
 * 標題與說明共用 ui.documentIssues（taskHeading／taskInstruction；標題由 bundle.ts 的 taskHeading 取得），
 * 單一案件的按鈕共用 ui.returnedReview。
 */
export const RETURN_REVIEW_TASK_TEXT_SHAPE = {
  eyebrow: 'string',
} as const satisfies Shape;
export type ReturnReviewTaskText = FromShape<typeof RETURN_REVIEW_TASK_TEXT_SHAPE>;

/** `kind: "report"` 文件（批次摘要）。 */
export const REPORT_DOCUMENT_TEXT_SHAPE = {
  heading: 'string',
  versionTemplate: 'string',
  /**
   * 沒有夜間結果時的中性版本行（R9 §0）：同日 archive → reconcile 時摘要可先開啟，
   * 不提早擲骰，也不寫任何判定。
   */
  versionNeutral: 'string',
  sourceTemplate: 'string',
  sourceOrigin: { intervention: 'string', rules: 'string' },
  arranged: 'string',
  pendingReview: 'string',
  notArranged: 'string',
  refusalTemplate: 'string',
  footer: 'string',
} as const satisfies Shape;
export type ReportDocumentText = FromShape<typeof REPORT_DOCUMENT_TEXT_SHAPE>;

/** `kind: "case-source"` 文件的一個欄位（R9）；label 在同一文件內唯一，value 一律為字串（前導零保留）。 */
export interface CaseSourceField {
  readonly label: string;
  readonly value: string;
}

/**
 * `kind: "case-source"` 文件（R9 比對案件的來源）：只有 heading 與非空的 fields，
 * 欄位順序即畫面順序。不是 *_SHAPE（fields 是陣列），由 validate-content.ts 另外逐欄嚴格檢查。
 */
export interface CaseSourceDocumentText {
  readonly heading: string;
  readonly fields: readonly CaseSourceField[];
}

/** `kind: "receipt"` 文件（昨日送件副本）。 */
export const RECEIPT_DOCUMENT_TEXT_SHAPE = {
  heading: 'string',
  sub: 'string',
  destReview: 'string',
  destArchive: 'string',
} as const satisfies Shape;
export type ReceiptDocumentText = FromShape<typeof RECEIPT_DOCUMENT_TEXT_SHAPE>;

/**
 * 有下一日（`nextDayId` 非 null）的日結轉場：對應 Stage `wrap`。
 * R8：`countLabel`／`next` 移除；逐項工作的筆數與「結束今日」按鈕改用共用的 ui.handoff。
 */
export const WRAP_TRANSITION_TEXT_SHAPE = {
  docTitle: 'string',
  eyebrow: 'string',
  heading: 'string',
  body: 'string',
  backToCover: 'string',
} as const satisfies Shape;
export type WrapTransitionText = FromShape<typeof WRAP_TRANSITION_TEXT_SHAPE>;

/**
 * 最後一日（`nextDayId: null`）的結束轉場：對應 Stage `end`。
 * task-neutral（R6-02）：不依任何任務種類的結果分支，只有一句 `summary`；舊的 `outcome` 已移除。
 */
export const END_TRANSITION_TEXT_SHAPE = {
  docTitle: 'string',
  eyebrow: 'string',
  heading: 'string',
  body: 'string',
  summary: 'string',
  thanks: 'string',
  outro: 'string',
  backToCover: 'string',
} as const satisfies Shape;
export type EndTransitionText = FromShape<typeof END_TRANSITION_TEXT_SHAPE>;

export type TransitionText = WrapTransitionText | EndTransitionText;

/** 每日檔頂層的工作台與側欄文字，以及訊息頁的日期分隔（R7：`chatDateLabel`，必填且非空）。 */
export const DAY_TEXT_SHAPE = {
  chatDateLabel: 'string',
  workbench: { greeting: 'string', workHeading: 'string' },
  aside: { heading: 'string', body: 'string' },
} as const satisfies Shape;

/* ---------- 共用欄位 ---------- */

/** 給內容編輯看的備註；不會顯示給玩家。 */
export interface Annotated {
  note?: string;
}

/* ---------- data/actors.json ---------- */

export interface ContentActor extends Annotated {
  id: string;
  /** 畫面上顯示的稱呼。未命名角色不得在此被命名。 */
  displayName: string;
}

export interface ActorsFile extends Annotated {
  actors: ContentActor[];
}

/* ---------- data/channels.json ---------- */

export interface ContentChannel extends Annotated {
  id: string;
  kind: ChannelKind;
  /** 群組頻道的名稱；direct 不填，標題取自對方 actor 的 displayName。department／group 必填。 */
  title?: string;
  /** 對話 header 的頻道說明（R7）；department／group 必填且非空，direct 不得填。 */
  topic?: string;
  /** 主角以外的參與者。direct 必須剛好一位。 */
  actorIds: string[];
}

export interface ChannelsFile extends Annotated {
  channels: ContentChannel[];
}

/* ---------- data/bulletins.json ---------- */

export interface ContentBulletin extends Annotated {
  id: string;
  title: string;
  /** 每個元素是一段；長篇正文才改放 content/documents/ 的 Markdown。 */
  body: string[];
}

export interface BulletinsFile extends Annotated {
  bulletins: ContentBulletin[];
}

/* ---------- data/days/day-NN.json ---------- */

/** 一筆來源紀錄。`key` 是存檔識別，`code` 一律為字串，0102 的前導零不得消失。 */
export interface ContentRecord extends Annotated {
  id: string;
  key: string;
  name: string | null;
  code: string;
  refusal: boolean | null;
  refusalApplies: boolean;
}

interface ContentDocumentBase extends Annotated {
  id: string;
  /** 這份文件引用到的紀錄；可跨日引用其他 day-NN.json 定義的紀錄。非空。 */
  recordIds: string[];
}

export interface ReportDocument extends ContentDocumentBase {
  kind: 'report';
  text: ReportDocumentText;
}

export interface ReceiptDocument extends ContentDocumentBase {
  kind: 'receipt';
  text: ReceiptDocumentText;
}

export interface CaseSourceDocument extends ContentDocumentBase {
  kind: 'case-source';
  text: CaseSourceDocumentText;
}

/** 文件依 `kind` 分型；各自的 text 欄位由對應的 *_SHAPE（case-source 為 CaseSourceDocumentText）決定。 */
export type ContentDocument = ReportDocument | ReceiptDocument | CaseSourceDocument;

interface ContentTaskBase extends Annotated {
  id: string;
  recordIds: string[];
  documentIds: string[];
}

/** 比對案件的補件收件狀態變體（R9）：依 seed＋case ID 選一個並保存；只影響佐證多寡，不決定正解。 */
export interface CaseReceiptVariant {
  /** 同一案件內唯一，不含 `.`（CHOICE_ID_PATTERN）。 */
  id: string;
  /** case-source 文件；在任務的 documentIds 內，且不是 sourceDocumentIds 之一。 */
  documentId: string;
}

/** 比對案件的一個合法決定（R9）；三條路都能完成此筆，沒有正確答案。 */
export interface CaseDecision {
  /** 同一案件內唯一，不含 `.`；`cond.case.<case 去前綴>.<id>` 引用。 */
  id: string;
  /** 玩家看到的選項文字。 */
  label: string;
  /**
   * 預填的人員編號（字串，R10）：必須是依據文件的某個欄位值，只作初次預填／作者參照。
   * 玩家可編輯編號；選處理方式不覆寫已編輯的草稿，保存的是玩家實際提交的編號。
   */
  archiveCode: string;
  destination: CaseDestination;
  /** 依據文件；必須是 sourceDocumentIds 之一。 */
  basisDocumentId: string;
  /** 保存進提交快照的差異註記。 */
  note: string;
}

/**
 * 多來源比對案件（R9）：批次中某一筆有兩份來源文件，玩家選擇依據與去向（R10：處理方式＝依據／去向／註記，
 * 編號由玩家填寫）。驗證見 validate-content.ts（引用、互斥、ID 規則、預填 archiveCode 的來源）。
 */
export interface CaseReview {
  /** `case.` 前綴，含所屬日識別，全域唯一。 */
  id: string;
  /** 任務 recordIds 內的一筆；同一筆紀錄最多一個案件。 */
  recordId: string;
  /** 剛好兩份 case-source 文件，在任務的 documentIds 內。 */
  sourceDocumentIds: string[];
  /** 至少兩個；文件互不重複，也不與 sourceDocumentIds 重疊。 */
  receiptVariants: CaseReceiptVariant[];
  /** 非空。 */
  decisions: CaseDecision[];
}

/** 歸檔任務：定義一個工作批次，玩家把 recordIds 逐筆歸入該批次。 */
export interface ArchiveTask extends ContentTaskBase {
  kind: 'archive';
  /** 這個任務建立的批次 ID（`batch.` 前綴，全域唯一）。 */
  batchId: string;
  /** 非空。 */
  recordIds: string[];
  text: ArchiveTaskText;
  /** 可選的多來源比對案件（R9）。 */
  caseReview?: CaseReview;
}

/**
 * 核對後的下游稽核（R10）：第二輪明確放行、且提交編號與保存的原始來源不一致的紀錄，
 * 於 notifyDayId 建立文件問題案件（只一次）。R11：案件跨日持續存在，排入通知日的下一工作日的
 * 「錯誤文件處理」位置；reviewTaskId 只是可省略的作者參照，不決定處理對象。
 */
export interface ReturnAudit {
  /** 全域唯一、不含 `.`（AUDIT_ID_PATTERN）；`cond.return.notified.<id>` 引用。 */
  id: string;
  /** 通知日（day ID）；必須晚於這個核對任務所屬的日。 */
  notifyDayId: DayId;
  /**
   * 可省略（R11）。有填時：必須是 return-review 任務、位於通知日的下一工作日（notifyDayId 那一天的 nextDayId），
   * 且該任務若帶 auditId 必須等於 id。
   */
  reviewTaskId?: string;
  /**
   * 案件的顯示案號樣板（R11），例如 `RT-{key}`；`{key}` 代入紀錄的存檔 key。
   * 必填；各稽核之間不得相同（否則同一筆紀錄在不同稽核會撞號）。text.ts 的 caseNumber(auditId, key) 代入。
   */
  caseNumberTemplate: string;
}

/** 核對任務：檢視某個既有批次的結果並回覆。 */
export interface ReconcileTask extends ContentTaskBase {
  kind: 'reconcile';
  /** 要核對的那一批；必須是某個 archive 任務定義的 batchId。 */
  sourceBatchId: string;
  /** 核對畫面聚焦的那一筆紀錄（R6-01）；必須在 recordIds 內。 */
  subjectRecordId: string;
  /** 非空；核對時可開啟的文件。 */
  documentIds: string[];
  text: ReconcileTaskText;
  /** 可選的下游稽核（R10）。 */
  returnAudit?: ReturnAudit;
}

/** field-map 的來源欄位（舊表欄位名）。 */
export interface FieldMapSourceField {
  id: string;
  label: string;
}

interface FieldMapTargetBase {
  id: string;
  label: string;
  /**
   * 作者預設／參照的來源欄位（R10）：必須存在、各目標之間一對一，boolean 目標的預設來源值需可轉換。
   * **不是必答的正解**：轉換與空白筆數一律依玩家實際配對（assignments）計算，不得拿 sourceId 矯正玩家選擇。
   */
  sourceId: string;
}

export interface FieldMapTextTarget extends FieldMapTargetBase {
  convert: 'text';
}

/**
 * boolean 目標：來源值是 trueValue／falseValue 時轉換，空字串交給玩家選的 blankPolicy；
 * 其他值依玩家配對無法轉換（規則層的 unconvertible，介面顯示 ui.fieldMap.convertError），不會靜默當成 null。
 */
export interface FieldMapBooleanTarget extends FieldMapTargetBase {
  convert: 'boolean';
  trueValue: string;
  falseValue: string;
}

/** 目標欄位依 `convert` 分型。 */
export type FieldMapTargetField = FieldMapTextTarget | FieldMapBooleanTarget;

/** 來源表的一列；`values` 的鍵恰為全部來源欄位 ID，值一律為字串（前導零保留，空字串＝空值）。 */
export interface FieldMapRow extends Annotated {
  id: string;
  values: Readonly<Record<string, string>>;
}

/** 欄位映射任務（R6-03）：玩家為每個目標欄位選一個來源欄位，處理空白值後匯入。 */
export interface FieldMapTask extends ContentTaskBase {
  kind: 'field-map';
  /** 非空。 */
  sourceFields: FieldMapSourceField[];
  /** 非空。 */
  targetFields: FieldMapTargetField[];
  /** 非空。 */
  rows: FieldMapRow[];
  text: FieldMapTaskText;
}

/**
 * 錯誤文件處理任務（R10 退件複審；R11 起為當日的處理位置）：沒有自己的紀錄與文件（recordIds／documentIds 皆為空陣列），
 * 處理對象是存檔排入當日的文件問題案件（issueSchedule），不綁定特定稽核；沒有到期案件時不進入當日佇列。
 * 每日最多一個；沒有內容定義的日，狀態層以 issueTaskId(n) 插入虛擬任務。
 */
export interface ReturnReviewTask extends ContentTaskBase {
  kind: 'return-review';
  /**
   * 可省略（R11），不決定處理對象。有填時：必須是存在的稽核，且該稽核的 reviewTaskId 指回這個任務。
   */
  auditId?: string;
  /** 空陣列。 */
  recordIds: string[];
  /** 空陣列。 */
  documentIds: string[];
  text: ReturnReviewTaskText;
}

/** 任務依 `kind` 分型（KB-R5-03、R6-03、R10）；每日至少一個，依陣列順序執行（R8）。 */
export type ContentTask = ArchiveTask | ReconcileTask | FieldMapTask | ReturnReviewTask;

export interface MessageVariant {
  key: VariantKey;
  value: number;
}

/**
 * 固定回覆的一則回應（R7）。畫面在玩家選擇後依序插入；
 * 頻道與可見日**繼承 anchor 訊息**（不另存 channelId／visibleFrom）。
 * `id` 使用 `msg.` 前綴，與普通訊息共用全域唯一的 ID 空間。
 */
export interface ContentReplyResponse {
  id: string;
  /** 必須是 anchor 頻道的成員（channels.json 的 actorIds）。 */
  actorId: string;
  /** `HH:MM`。 */
  time: string;
  /** 非空。 */
  lines: string[];
}

/** 固定回覆的一個選項（R7）；`id` 只需在同一 prompt 內唯一，且不含 `.`（CHOICE_ID_PATTERN）。 */
export interface ContentReplyChoice {
  id: string;
  /** 玩家送出的文字（以「你」顯示）。非空。 */
  text: string;
  /** 非空；依序插入。 */
  responses: ContentReplyResponse[];
}

/**
 * 掛在訊息上的固定回覆（R7）。anchor 訊息解鎖後、到 availableThrough 為止可回答一次（或不回覆）；
 * 選擇由存檔保存，`cond.chat.<id 去掉 prompt.>.<choiceId>` 讀取。
 */
export interface ContentReplyPrompt {
  /** `prompt.` 前綴，全域唯一，含所屬日識別（例如 `prompt.day3.lunch-plan`）。 */
  id: string;
  /** 最後可回答的日（day ID）；不得早於 anchor 的 visibleFrom。 */
  availableThrough: DayId;
  /** 非空。 */
  choices: ContentReplyChoice[];
}

/**
 * 訊息的「當日工作進度」解鎖（R8 §4）：指定 archive 批次已提交至少 `archivedCount` 筆才解鎖。
 * 由存檔推導（ConditionContext.archivedCount），不模擬時鐘；批次所屬日不得晚於訊息的 visibleFrom。
 */
export interface MessageUnlockAfter {
  /** 某個 archive 任務的 batchId。 */
  archiveBatchId: string;
  /** 1 以上、不超過該批次筆數的整數。 */
  archivedCount: number;
}

export interface ContentMessage extends Annotated {
  id: string;
  channelId: string;
  actorId: string;
  /** 顯示用時間字串，例如 '08:36'。 */
  time: string;
  /**
   * 從哪一天起可見（day ID，例如 'day.01'）。之後各日仍保留在頻道歷史（KB-R5-01）。
   * 日期不再寫在 unlock 裡。
   */
  visibleFrom: string;
  /** 其他解鎖條件 ID（全部成立才解鎖）；白名單見 content/conditions.ts。 */
  unlock: string[];
  /** 可選的工作進度解鎖（R8）；與 visibleFrom、unlock 同時成立才解鎖。 */
  unlockAfter?: MessageUnlockAfter;
  /** 同一 variant.key 只會出現一則；由規則層依存檔挑選。 */
  variant?: MessageVariant;
  lines: string[];
  /** 這則訊息之後的固定回覆（R7）；選項與 responses 見 ContentReplyPrompt。 */
  replyPrompt?: ContentReplyPrompt;
}

/**
 * 當日結束的轉場。`text` 的形狀由該日的 `nextDayId` 決定：
 * 有下一日 → WrapTransitionText（Stage `wrap`）；沒有 → EndTransitionText（Stage `end`）。
 */
export interface ContentTransition extends Annotated {
  id: string;
  text: TransitionText;
}

/** 日結轉場的欄位是結束轉場的子集（R8），因此以「沒有結束轉場專屬欄位」判斷。 */
export function isWrapTransitionText(text: TransitionText): text is WrapTransitionText {
  return !('summary' in text) && !('outro' in text);
}

export function isEndTransitionText(text: TransitionText): text is EndTransitionText {
  return 'summary' in text && 'outro' in text;
}

export interface DayContent extends Annotated {
  id: string;
  /** 第幾天；與 id 的編號一致。 */
  day: number;
  /** 日結後前往的下一日 ID；最後一日為 null（KB-R5-03）。 */
  nextDayId: string | null;
  /** 訊息頁的日期分隔文字（R7），例如「9 月 15 日」；必填且非空。不得寫 DAY／第 N 天。 */
  chatDateLabel: string;
  workbench: { greeting: string; workHeading: string };
  aside: { heading: string; body: string };
  records: ContentRecord[];
  documents: ContentDocument[];
  /** 至少一個可執行任務；依陣列順序執行（R8），全部完成才進日結。 */
  tasks: ContentTask[];
  messages: ContentMessage[];
  transition: ContentTransition;
}

/* ---------- R12 內容包共用 ---------- */

/**
 * 內容包的 `integration`：給實作／內容編輯看的接線說明，**不會顯示給玩家**。
 * 值只能是非空字串或非空字串陣列；鍵不限。
 */
export type IntegrationNotes = Readonly<Record<string, string | readonly string[]>>;

/* ---------- data/mail/*.json（R12） ---------- */

/** 郵件寄件者：只有 ID 與顯示名稱（例如「資料作業窗口」），不虛構真實 email 地址。 */
export interface ContentMailSender {
  /** `sender.` 前綴。同一寄件者出現在多個包時名稱必須一致。 */
  id: string;
  name: string;
}

/** 郵件模板（R12）：主旨、逐段內文（非空）、附件名稱；只可用 `{caseNumber}`、`{versionLabel}`、`{reason}`。 */
export interface ContentMailTemplate {
  subject: string;
  lines: string[];
  attachmentLabel: string;
}

/**
 * 郵件內容包（R12，data/mail/*.json）：寄件者、以模板 ID 為鍵的模板、郵件應用介面字與接線說明。
 * 郵件紀錄（core MailRecord）以 packId＋templateId 引用；退件回條包的模板 ID＝回條種類。
 */
export interface ContentMailPack extends Annotated {
  /** `mail.` 前綴；退件回條包為 RETURN_RECEIPT_MAIL_PACK_ID。 */
  id: string;
  schemaVersion: typeof CONTENT_PACK_SCHEMA_VERSION;
  sender: ContentMailSender;
  /** 剛好 returned／resolved 兩個模板（ISSUE_RECEIPT_KINDS）。 */
  templates: Readonly<Record<IssueReceiptKind, ContentMailTemplate>>;
  ui: MailUi;
  integration?: IntegrationNotes;
}

/* ---------- data/onboarding/*.json（R12） ---------- */

/** 入職前情的呈現設定：黑底白字、逐字間隔與推進方式。 */
export interface OnboardingPresentation {
  /** `#rrggbb`。 */
  background: string;
  /** `#rrggbb`。 */
  foreground: string;
  /** 每字間隔（毫秒），正整數。 */
  characterIntervalMs: number;
  advance: (typeof ONBOARDING_ADVANCE_MODES)[number];
  reducedMotion: (typeof ONBOARDING_REDUCED_MOTION_MODES)[number];
}

/** 旁白一段；逐字呈現。 */
export interface OnboardingLineStep extends Annotated {
  /** 同一入職包內唯一，只用小寫英數與 `-`。 */
  id: string;
  kind: 'line';
  text: string;
}

/** 合約簽名欄；maxGraphemes 必須等於 core 的 PLAYER_NAME_MAX。 */
export interface OnboardingSignature {
  label: string;
  placeholder: string;
  submit: string;
  required: string;
  tooLong: string;
  maxGraphemes: number;
}

/** 合約：標題、條款、頁尾與簽名欄一次一起顯示，不逐字；需明確按簽名鈕。 */
export interface OnboardingContractStep extends Annotated {
  id: string;
  kind: 'contract';
  heading: string;
  /** 非空。 */
  clauses: string[];
  footer: string;
  signature: OnboardingSignature;
}

export type OnboardingStep = OnboardingLineStep | OnboardingContractStep;

/**
 * 入職前情包（R12，data/onboarding/*.json）。steps 依序呈現；剛好一個 contract，且不在第一段或最後一段。
 * 存檔 onboarding.step 是這裡 steps 的 index。
 */
export interface ContentOnboarding extends Annotated {
  /** `onboarding.` 前綴。 */
  id: string;
  schemaVersion: typeof CONTENT_PACK_SCHEMA_VERSION;
  presentation: OnboardingPresentation;
  steps: OnboardingStep[];
  ui: OnboardingUi;
  integration?: IntegrationNotes;
}

/* ---------- data/help/*.json（R12） ---------- */

/**
 * 詢問說明包的提問：玩家按入口後自動送出一次 playerText，之後依排程送達 messages。
 * unlockCondition 必須是自己的 `cond.help.<id 去掉 request.>.requested`。
 */
export interface ContentHelpRequest {
  /** `request.` 前綴，全域唯一；存檔 helpRequests 的鍵。 */
  id: string;
  /** 既有的 direct 頻道。 */
  channelId: string;
  unlockCondition: string;
  /** 玩家送出的提問文字（以「你」顯示）。 */
  playerText: string;
  /** 每份存檔只問一次；固定為 true。 */
  oncePerSave: true;
}

/**
 * 向同事詢問的說明包（R12，data/help/*.json）。messages 沿用 ContentMessage／replyPrompt 格式，
 * 全部在提問頻道、unlock 含提問條件；ID 含 `help` 識別（取代每日檔的 dayN）。
 * 這些訊息加入 bundle.ts 的 ALL_MESSAGES／messagesOfChannel／ALL_PROMPTS，排在同一 visibleFrom 的每日訊息之後。
 */
export interface ContentHelpPack extends Annotated {
  /** `help.` 前綴。 */
  id: string;
  schemaVersion: typeof CONTENT_PACK_SCHEMA_VERSION;
  request: ContentHelpRequest;
  ui: HelpUi;
  /** 非空；依序送達。 */
  messages: ContentMessage[];
  integration?: IntegrationNotes;
}

/* ---------- data/ui.zh-Hant.json ---------- */

export interface UiCover {
  eyebrow: string;
  title: string;
  subtitle: string;
  start: string;
  continue: string;
  settings: string;
  noSave: string;
  savePrefix: string;
  footerLeft: string;
  footerRight: string;
  artAlt: string;
  artSrc: string;
  docTitle: string;
}

export interface UiDialog {
  heading: string;
  body?: string;
  keep?: string;
  start?: string;
  motionLabel?: string;
  note?: string;
  back?: string;
}

export interface UiContent extends Annotated {
  id: string;
  locale: string;
  appTitleSuffix: string;
  cover: UiCover;
  /** 封面進度樣板（取代舊的 phaseLabel）。 */
  progressLabel: ProgressLabelText;
  dialogs: {
    newGame: { heading: string; body: string; keep: string; start: string };
    settings: { heading: string; motionLabel: string; note: string; back: string };
  };
  storage: { readIssue: string; writeIssue: string; saved: string };
  workbench: {
    brandLead: string;
    brandRest: string;
    brandSuffix: string;
    navLabel: string;
    /**
     * 工作平台左側單組功能導航（R12）：`messages`／`mail` 開啟對應桌面應用。
     * R12 移除 navGroupPersonal／navGroupTeam（雙 group）與 issues（「文件問題」頁改由郵件取代）。
     */
    nav: { work: string; messages: string; news: string; mail: string };
    /** 應用右上身分區的組別（R12），與玩家姓名分開顯示。 */
    team: string;
    /** 身分區的標籤（R12），例如「目前登入」。 */
    identityLabel: string;
    /** 公告頁的標題（R12 移除 messages：通訊改為桌面應用）。 */
    heading: { news: string };
    dayTagTemplate: string;
    docTitleTemplate: string;
    /** 每一個存在的日別（以 `day` 數字為鍵）都要有國字日名；驗證會逐日檢查。 */
    dayName: Record<string, string>;
  };
  aside: { eyebrow: string; colleagueActorId: string; quote: string; slogan: string };
  sourceCard: SourceCardUi;
  /** 玩家可見的紀錄狀態文字（R7）。 */
  recordStatus: RecordStatusText;
  records: Annotated & { nameUnregistered: string };
  messages: UiMessages;
  news: { eyebrow: string; back: string };
  /** 全部 archive 任務共用的介面字串。 */
  archive: ArchiveUi;
  /** 全部 field-map 任務共用的介面字串。 */
  fieldMap: FieldMapUi;
  /** 同日多工作的步驟、狀態與交付按鈕（R8）。 */
  tasks: TasksUi;
  /** 日結頁「本日交接」（R8）。 */
  handoff: HandoffUi;
  /** 次日收件（R8）。 */
  morning: MorningUi;
  /** 工作頁右欄的系統作業紀錄（R8）。 */
  executionLog: ExecutionLogUiText;
  /** 多來源比對案件（R9）。 */
  caseReview: CaseReviewUi;
  /** 共用視窗殼（R9）。 */
  windowShell: WindowShellUi;
  /** 提交的執行階段（R10）。 */
  operation: OperationUi;
  /** 浮動視窗與視窗列（R10）。 */
  windows: WindowsUi;
  /** 核對的逐筆審查（R10）。 */
  recordReview: RecordReviewUi;
  /** 退件複審（R10）。 */
  returnedReview: ReturnedReviewUi;
  /** 文件問題案件與每日「錯誤文件處理」工作（R11）。 */
  documentIssues: DocumentIssuesUi;
  /** 電腦桌面：應用入口、主選單與狀態區（R12）。 */
  desktop: DesktopUi;
}

/* ---------- 樣板欄位 ---------- */

/**
 * 每個樣板欄位允許出現的 placeholder。
 * 驗證時會檢查：不得出現白名單以外的 `{...}`，也不得缺少必要的 placeholder。
 * 鍵通常是欄位名；含 `.` 的鍵是完整欄位路徑（例如 `morning.docTitleTemplate`），優先於同名欄位。
 */
export const TEMPLATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  progressTemplate: ['count', 'total'],
  footerPendingTemplate: ['total'],
  dayTagTemplate: ['day'],
  docTitleTemplate: ['dayName', 'view'],
  eyebrowTemplate: ['key'],
  versionTemplate: ['revision'],
  sourceTemplate: ['origin'],
  refusalTemplate: ['value'],
  unreadTemplate: ['count'],
  unreadChannelTemplate: ['channel', 'count'],
  typingTemplate: ['name'],
  memberCountTemplate: ['count'],
  workTemplate: ['dayName'],
  wrapTemplate: ['dayName'],
  morningTemplate: ['dayName'],
  endTemplate: ['dayName'],
  stepTemplate: ['index', 'total'],
  totalTemplate: ['count'],
  itemTemplate: ['kind', 'count', 'unit'],
  pendingTemplate: ['count', 'unit'],
  markedCountTemplate: ['count'],
  /** returnAudit 的案號樣板（R11，每日檔）。 */
  caseNumberTemplate: ['key'],
  /* ui.documentIssues（R11） */
  submissionTemplate: ['number'],
  sourceTaskTemplate: ['dayName', 'task'],
  returnedTemplate: ['caseNumber'],
  resolvedTemplate: ['caseNumber'],
  'morning.docTitleTemplate': ['dayName'],
  /* ui.desktop（R12） */
  openAppTemplate: ['app'],
  mailUnreadTemplate: ['count'],
  /** 郵件包 ui 的附件版本名稱（R12）：`{revision}`＝版本 index＋1。 */
  revisionTemplate: ['revision'],
};

/* ---------- 驗證輸入 ---------- */

/** 一個內容檔的原始內容；驗證錯誤訊息需要指出來源檔名。 */
export interface ContentSource {
  file: string;
  data: unknown;
}

/** validate-content.ts 的輸入：全部內容檔，未經型別斷言。 */
export interface ContentInput {
  ui: ContentSource;
  actors: ContentSource;
  channels: ContentSource;
  bulletins: ContentSource;
  days: ContentSource[];
  /** 郵件包（R12，data/mail/）；必須含 RETURN_RECEIPT_MAIL_PACK_ID。 */
  mail: ContentSource[];
  /** 入職前情包（R12，data/onboarding/）。 */
  onboarding: ContentSource;
  /** 詢問說明包（R12，data/help/）。 */
  help: ContentSource[];
}

/** 整包載入後的內容；`days` 依 `day` 數字排序，mail／help 依清單順序。 */
export interface ContentBundle {
  ui: UiContent;
  actors: readonly ContentActor[];
  channels: readonly ContentChannel[];
  bulletins: readonly ContentBulletin[];
  days: readonly DayContent[];
  mail: readonly ContentMailPack[];
  onboarding: ContentOnboarding;
  help: readonly ContentHelpPack[];
}
