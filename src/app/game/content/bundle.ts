import { BatchId, DayId, TaskId } from '../core/types';
import { ConditionContext, isUnlocked } from './conditions';
import actorsJson from './data/actors.json';
import bulletinsJson from './data/bulletins.json';
import channelsJson from './data/channels.json';
import { DAY_SOURCES, HELP_SOURCES, MAIL_SOURCES, ONBOARDING_SOURCE } from './data/manifest';
import uiJson from './data/ui.zh-Hant.json';
import {
  ArchiveTask,
  CaseReview,
  CaseSourceDocument,
  ContentActor,
  ContentBulletin,
  ContentBundle,
  ContentChannel,
  ContentDocument,
  ContentHelpPack,
  ContentHelpRequest,
  ContentInput,
  ContentMailPack,
  ContentMessage,
  ContentOnboarding,
  ContentRecord,
  ContentReplyPrompt,
  ContentTask,
  DayContent,
  EndTransitionText,
  FieldMapTask,
  ReceiptDocument,
  ReconcileTask,
  ReportDocument,
  ReturnAudit,
  ReturnReviewTask,
  WrapTransitionText,
  isEndTransitionText,
  isWrapTransitionText,
  parseIssueTaskId,
} from './schema';
import { parseContent } from './validate-content';

/**
 * game/content/bundle：把 data/ 的 JSON 載入成有型別的內容，並提供查詢。
 *
 * 這一層只做載入、索引與查詢，不含玩家可見文本。
 * 載入時先以 validate-content.ts 的 parseContent() 逐欄驗證（KB-R5-02）；有任何問題會在
 * 模組初始化時 throw，錯誤內容不會進入執行期。CONTENT 之後的所有取值都是已驗證的型別。
 */

/** 檔名對照；驗證與錯誤訊息用。每日檔與 R12 內容包的清單來自 data/manifest.ts（唯一來源）。 */
export const CONTENT_FILES = {
  ui: 'data/ui.zh-Hant.json',
  actors: 'data/actors.json',
  channels: 'data/channels.json',
  bulletins: 'data/bulletins.json',
  days: DAY_SOURCES.map((d) => d.file),
  mail: MAIL_SOURCES.map((m) => m.file),
  onboarding: ONBOARDING_SOURCE.file,
  help: HELP_SOURCES.map((h) => h.file),
} as const;

/** 未經斷言的原始內容；validate-content.ts 的輸入，也供 spec 複製後做反例。 */
export const CONTENT_SOURCES: ContentInput = {
  ui: { file: CONTENT_FILES.ui, data: uiJson },
  actors: { file: CONTENT_FILES.actors, data: actorsJson },
  channels: { file: CONTENT_FILES.channels, data: channelsJson },
  bulletins: { file: CONTENT_FILES.bulletins, data: bulletinsJson },
  days: DAY_SOURCES.map((d) => ({ file: d.file, data: d.data })),
  mail: MAIL_SOURCES.map((m) => ({ file: m.file, data: m.data })),
  onboarding: { file: ONBOARDING_SOURCE.file, data: ONBOARDING_SOURCE.data },
  help: HELP_SOURCES.map((h) => ({ file: h.file, data: h.data })),
};

/** 已驗證的內容；`days` 依 day 數字排序。驗證失敗會在此 throw。 */
export const CONTENT: ContentBundle = parseContent(CONTENT_SOURCES);

/* ---------- 日程 ---------- */

/** 全部 day ID，依 day 數字排序。 */
export const DAY_IDS: readonly DayId[] = CONTENT.days.map((d) => d.id);

const DAY_ORDER: ReadonlyMap<string, number> = new Map(CONTENT.days.map((d) => [d.id, d.day]));

/** 由內容目錄解析日序（day 數字）；未知 day ID 回傳 NaN。可直接當 ConditionContext.dayOrder。 */
export function dayOrder(dayId: string): number {
  return DAY_ORDER.get(dayId) ?? Number.NaN;
}

/** 給 state adapter 的每日工作查表（KB-R5-03）：由 dayId 查得有序的 task、批次與引用。 */
export type DayPlanTask =
  | {
      id: TaskId;
      kind: 'archive';
      batchId: BatchId;
      recordIds: readonly string[];
      documentIds: readonly string[];
    }
  | {
      id: TaskId;
      kind: 'reconcile';
      sourceBatchId: BatchId;
      subjectRecordId: string;
      recordIds: readonly string[];
      documentIds: readonly string[];
      /** 下游稽核（R10）；只有內容有設定時才出現。 */
      returnAudit?: ReturnAudit;
    }
  | {
      id: TaskId;
      kind: 'field-map';
      recordIds: readonly string[];
      documentIds: readonly string[];
    }
  | {
      id: TaskId;
      kind: 'return-review';
      /**
       * 可省略的稽核參照（R11 起不決定處理對象）；只有內容有設定時才出現。
       * 當日是否適用由狀態層依存檔的 issueSchedule 決定。
       */
      auditId?: string;
      recordIds: readonly string[];
      documentIds: readonly string[];
    };

/**
 * 一日的工作計畫（R8）：`tasks` 為 JSON 定義的有序工作佇列（至少一個）。
 * 目前工作由存檔的 taskId 決定，不要讀 `tasks[0]` 當作目前工作；以 taskId 查詢請用 contentTask／archiveTask 等。
 */
export interface DayPlan {
  dayId: DayId;
  dayNumber: number;
  nextDayId: DayId | null;
  tasks: readonly DayPlanTask[];
}

function planTask(task: ContentTask): DayPlanTask {
  const base = { id: task.id, recordIds: task.recordIds, documentIds: task.documentIds };
  switch (task.kind) {
    case 'archive':
      return { ...base, kind: 'archive', batchId: task.batchId };
    case 'reconcile':
      return {
        ...base,
        kind: 'reconcile',
        sourceBatchId: task.sourceBatchId,
        subjectRecordId: task.subjectRecordId,
        ...(task.returnAudit === undefined ? {} : { returnAudit: task.returnAudit }),
      };
    case 'field-map':
      return { ...base, kind: 'field-map' };
    case 'return-review':
      return { ...base, kind: 'return-review', ...(task.auditId === undefined ? {} : { auditId: task.auditId }) };
  }
}

export function dayPlan(dayId: string): DayPlan {
  const d = dayContentById(dayId);
  return { dayId: d.id, dayNumber: d.day, nextDayId: d.nextDayId, tasks: d.tasks.map(planTask) };
}

/** 該日的全部任務，依 JSON 順序（驗證保證至少一個）。未知 day ID 丟例外。 */
export function tasksOfDay(dayId: string): readonly ContentTask[] {
  return dayContentById(dayId).tasks;
}

/* ---------- 查詢 ---------- */

function required<T>(value: T | undefined, kind: string, id: string): T {
  if (value === undefined) throw new Error(`content: 找不到${kind} ${id}`);
  return value;
}

export function actor(id: string): ContentActor {
  return required(
    CONTENT.actors.find((a) => a.id === id),
    '人物',
    id,
  );
}

/** 顯示用稱呼；未命名角色不會在這裡被命名。 */
export function actorName(id: string): string {
  return actor(id).displayName;
}

export function channel(id: string): ContentChannel {
  return required(
    CONTENT.channels.find((c) => c.id === id),
    '頻道',
    id,
  );
}

/** 頻道標題：群組用自己的 title，個人訊息用對方的稱呼。 */
export function channelTitle(id: string): string {
  const c = channel(id);
  if (c.title !== undefined) return c.title;
  const other = c.actorIds[0];
  return other === undefined ? c.id : actorName(other);
}

/** KB-R4-04 用：依分類取得頻道。 */
export function channelsOfKind(kind: ContentChannel['kind']): readonly ContentChannel[] {
  return CONTENT.channels.filter((c) => c.kind === kind);
}

export function bulletin(id: string): ContentBulletin {
  return required(
    CONTENT.bulletins.find((b) => b.id === id),
    '公告',
    id,
  );
}

export function dayContentById(id: string): DayContent {
  return required(
    CONTENT.days.find((d) => d.id === id),
    '每日內容',
    id,
  );
}

/** 訊息頁的日期分隔文字（R7），例如「9 月 15 日」；未知 day ID 丟例外。畫面不得改用 DAY／第 N 天。 */
export function chatDateLabel(dayId: string): string {
  return dayContentById(dayId).chatDateLabel;
}

/**
 * 某一遊戲日的日期文字（R12：郵件收到時間、說明訊息的日期），與訊息頁日期分隔同一份（chatDateLabel）。
 * 未知 day ID 丟例外。
 */
export function dayDateLabel(dayId: string): string {
  return chatDateLabel(dayId);
}

/** 全部日別的來源紀錄索引（模組內部用）；同一筆紀錄只定義一次，之後幾天以 ID 引用。 */
const RECORD_INDEX: ReadonlyMap<string, ContentRecord> = new Map(
  CONTENT.days.flatMap((d) => d.records).map((r) => [r.id, r] as const),
);

export const ALL_DOCUMENTS: readonly ContentDocument[] = CONTENT.days.flatMap((d) => d.documents);

export function contentDocument(id: string): ContentDocument {
  return required(
    ALL_DOCUMENTS.find((d) => d.id === id),
    '文件',
    id,
  );
}

/** 依 kind 收斂的文件取值；kind 不符時是內容錯誤，直接丟例外。 */
export function reportDocument(id: string): ReportDocument {
  const d = contentDocument(id);
  if (d.kind !== 'report') throw new Error(`content: 文件 ${id} 不是 report（是 ${d.kind}）`);
  return d;
}

export function receiptDocument(id: string): ReceiptDocument {
  const d = contentDocument(id);
  if (d.kind !== 'receipt') throw new Error(`content: 文件 ${id} 不是 receipt（是 ${d.kind}）`);
  return d;
}

/** 比對案件的來源／佐證文件（R9）；欄位順序即畫面順序，value 一律為字串。 */
export function caseSourceDocument(id: string): CaseSourceDocument {
  const d = contentDocument(id);
  if (d.kind !== 'case-source') throw new Error(`content: 文件 ${id} 不是 case-source（是 ${d.kind}）`);
  return d;
}

export const ALL_TASKS: readonly ContentTask[] = CONTENT.days.flatMap((d) => d.tasks);

export function contentTask(id: string): ContentTask {
  return required(
    ALL_TASKS.find((t) => t.id === id),
    '任務',
    id,
  );
}

/** 依 kind 收斂的任務取值；kind 不符時是內容錯誤，直接丟例外。 */
export function archiveTask(id: string): ArchiveTask {
  const t = contentTask(id);
  if (t.kind !== 'archive') throw new Error(`content: 任務 ${id} 不是 archive（是 ${t.kind}）`);
  return t;
}

export function reconcileTask(id: string): ReconcileTask {
  const t = contentTask(id);
  if (t.kind !== 'reconcile') throw new Error(`content: 任務 ${id} 不是 reconcile（是 ${t.kind}）`);
  return t;
}

export function fieldMapTask(id: string): FieldMapTask {
  const t = contentTask(id);
  if (t.kind !== 'field-map') throw new Error(`content: 任務 ${id} 不是 field-map（是 ${t.kind}）`);
  return t;
}

export function returnReviewTask(id: string): ReturnReviewTask {
  const t = contentTask(id);
  if (t.kind !== 'return-review') throw new Error(`content: 任務 ${id} 不是 return-review（是 ${t.kind}）`);
  return t;
}

/**
 * 狀態層插入的虛擬「錯誤文件處理」任務（R11）：ID 為 issueTaskId(n)、所屬日存在，且內容沒有同 ID 的任務。
 * 內容定義的 return-review 任務不算（它有自己的 text）。
 */
function isVirtualIssueTask(taskId: string): boolean {
  const n = parseIssueTaskId(taskId);
  return !Number.isNaN(n) && CONTENT.days.some((d) => d.day === n) && !ALL_TASKS.some((t) => t.id === taskId);
}

/**
 * 工作清單／步驟列上的任務標題（R10）：archive／reconcile／field-map 取該任務 text.heading；
 * return-review（內容定義的，或狀態層以 issueTaskId(n) 插入的虛擬任務，R11）取 ui.documentIssues.taskHeading。
 * 其他未知 task ID 丟例外。
 */
export function taskHeading(taskId: string): string {
  if (isVirtualIssueTask(taskId)) return CONTENT.ui.documentIssues.taskHeading;
  const task = contentTask(taskId);
  return task.kind === 'return-review' ? CONTENT.ui.documentIssues.taskHeading : task.text.heading;
}

/**
 * 每日「錯誤文件處理」工作的畫面文字（R11）：內容定義的 return-review 任務用自己的 text.eyebrow，
 * 虛擬任務（issueTaskId(n)）用 ui.documentIssues.taskEyebrow；標題與說明一律取 ui.documentIssues。
 * 不是 return-review 的任務或未知 ID 丟例外。
 */
export function issueTaskText(taskId: string): { readonly eyebrow: string; readonly heading: string; readonly instruction: string } {
  const ui = CONTENT.ui.documentIssues;
  const eyebrow = isVirtualIssueTask(taskId) ? ui.taskEyebrow : returnReviewTask(taskId).text.eyebrow;
  return { eyebrow, heading: ui.taskHeading, instruction: ui.taskInstruction };
}

/* ---------- 退件稽核（R10） ---------- */

/** 一個退件稽核與定義它的核對任務、日別與被核對的批次（state adapter 建 ReturnAuditPlan 用）。 */
export interface ReturnAuditEntry {
  audit: ReturnAudit;
  /** 定義稽核的 reconcile 任務（第二輪審查所在）。 */
  reconcileTaskId: TaskId;
  /** reconcile 任務所屬日。 */
  dayId: DayId;
  /** 被核對（第一輪提交所在）的 archive 批次。 */
  sourceBatchId: BatchId;
}

/**
 * 全部退件稽核，依日序、再依任務順序。驗證保證 audit ID 全域唯一、案號樣板互不相同；
 * reviewTaskId（可省略）有填時指向通知日下一工作日的 return-review 任務。
 */
export const ALL_RETURN_AUDITS: readonly ReturnAuditEntry[] = CONTENT.days.flatMap((d) =>
  d.tasks.flatMap((t) =>
    t.kind === 'reconcile' && t.returnAudit !== undefined
      ? [{ audit: t.returnAudit, reconcileTaskId: t.id, dayId: d.id, sourceBatchId: t.sourceBatchId }]
      : [],
  ),
);

/**
 * 依稽核 ID 取得稽核；未知 ID 回傳 undefined（不丟例外）：
 * 舊存檔可能保存了內容日後移除的稽核，歷史退件不應因此失效。
 */
export function returnAuditOf(auditId: string): ReturnAuditEntry | undefined {
  return ALL_RETURN_AUDITS.find((e) => e.audit.id === auditId);
}

/**
 * 稽核的案號樣板（R11，例如 `RT-{key}`）；未知 ID 回傳 undefined（舊存檔的稽核可能已從內容移除）。
 * 代入請用 text.ts 的 caseNumber(auditId, key)。
 */
export function caseNumberTemplateOf(auditId: string): string | undefined {
  return returnAuditOf(auditId)?.audit.caseNumberTemplate;
}

/* ---------- 多來源比對案件（R9） ---------- */

/** 一個比對案件與它所在的 archive 任務、日別，以及案件紀錄的存檔 key（state adapter 建 CasePlan 用）。 */
export interface CaseReviewEntry {
  review: CaseReview;
  taskId: TaskId;
  dayId: DayId;
  /** 案件紀錄的存檔 key（例如 `H204`）。 */
  recordKey: string;
}

/** 全部比對案件，依日序、再依任務順序。驗證保證 case ID 全域唯一、同一筆紀錄最多一個案件。 */
export const ALL_CASE_REVIEWS: readonly CaseReviewEntry[] = CONTENT.days.flatMap((d) =>
  d.tasks.flatMap((t) =>
    t.kind === 'archive' && t.caseReview !== undefined
      ? [
          {
            review: t.caseReview,
            taskId: t.id,
            dayId: d.id,
            recordKey: required(RECORD_INDEX.get(t.caseReview.recordId), '紀錄', t.caseReview.recordId).key,
          },
        ]
      : [],
  ),
);

/**
 * 依 case ID 取得案件；未知 ID 回傳 undefined（不丟例外）：
 * 舊存檔可能保存了內容日後移除的案件，歷史快照不應因此失效。
 */
export function caseReviewOf(caseId: string): CaseReviewEntry | undefined {
  return ALL_CASE_REVIEWS.find((e) => e.review.id === caseId);
}

/** 某任務中某一筆紀錄的案件；`record` 可以是內容 ID（`record.day3-h204`）或存檔 key（`H204`）。沒有案件回傳 undefined。 */
export function caseReviewForRecord(taskId: string, record: string): CaseReviewEntry | undefined {
  return ALL_CASE_REVIEWS.find((e) => e.taskId === taskId && (e.review.recordId === record || e.recordKey === record));
}

/** 任務掛的文件，依 documentIds 順序；可跨日引用。 */
export function documentsOfTask(taskId: string): readonly ContentDocument[] {
  return contentTask(taskId).documentIds.map(contentDocument);
}

/** 任務引用的來源紀錄，依 recordIds 順序；可跨日引用（例如 Day 2 核對 Day 1 的紀錄）。 */
export function recordsOfTask(taskId: string): readonly ContentRecord[] {
  return contentTask(taskId).recordIds.map((id) => required(RECORD_INDEX.get(id), '紀錄', id));
}

/** 有下一日的日結轉場文字（Stage wrap）。 */
export function wrapTransitionText(dayId: string): WrapTransitionText {
  const d = dayContentById(dayId);
  const text = d.transition.text;
  if (d.nextDayId === null || !isWrapTransitionText(text)) {
    throw new Error(`content: ${dayId} 沒有下一日，轉場不是日結轉場`);
  }
  return text;
}

/** 最後一日的結束轉場文字（Stage end）。 */
export function endTransitionText(dayId: string): EndTransitionText {
  const d = dayContentById(dayId);
  const text = d.transition.text;
  if (d.nextDayId !== null || !isEndTransitionText(text)) {
    throw new Error(`content: ${dayId} 還有下一日，轉場不是結束轉場`);
  }
  return text;
}

/**
 * 全部訊息：先依 visibleFrom 的日序，再依檔案內順序（穩定排序）。
 * 因此某日檔內若放了「從更早一天起可見」的訊息，也會排到正確的位置。
 * R12 詢問說明包的訊息（help.messages）接在每日訊息之後，因此排在同一 visibleFrom 的每日訊息後面；
 * 它們由提問條件解鎖，時間軸上的實際位置由狀態層保存的提問日與送達時間決定（見 helpRequestOfMessage）。
 */
export const ALL_MESSAGES: readonly ContentMessage[] = [
  ...CONTENT.days.flatMap((d) => d.messages),
  ...CONTENT.help.flatMap((h) => h.messages),
]
  .map((m, index) => ({ m, index }))
  .sort((a, b) => dayOrder(a.m.visibleFrom) - dayOrder(b.m.visibleFrom) || a.index - b.index)
  .map((x) => x.m);

export function contentMessage(id: string): ContentMessage {
  return required(
    ALL_MESSAGES.find((m) => m.id === id),
    '訊息',
    id,
  );
}

/** 某頻道的全部訊息（含尚未解鎖的）；順序為 visibleFrom 日序，再依檔案順序。 */
export function messagesOfChannel(channelId: string): readonly ContentMessage[] {
  return ALL_MESSAGES.filter((m) => m.channelId === channelId);
}

/**
 * 目前狀態下已解鎖的訊息：跨日累積的歷史（Day 2 時包含 Day 1 的訊息）。
 * 只讀狀態、不擲骰；同一組 variant.key 只會留下符合目前存檔的那一則。
 * `unlockAfter`（R8）依 ctx.archivedCount 判斷；未讀、對話串與 replyPrompt 的 anchor 都應共用 isUnlocked。
 */
export function unlockedMessages(channelId: string, ctx: ConditionContext): readonly ContentMessage[] {
  return messagesOfChannel(channelId).filter((m) => isUnlocked(m, ctx));
}

/* ---------- 固定回覆（R7） ---------- */

/** 一個 replyPrompt 與它所在的 anchor 訊息；responses 繼承 anchor 的 channelId 與 visibleFrom。 */
export interface ReplyPromptEntry {
  prompt: ContentReplyPrompt;
  anchor: ContentMessage;
}

/** 全部 prompt，依訊息順序（visibleFrom 日序，再依檔案順序）。 */
export const ALL_PROMPTS: readonly ReplyPromptEntry[] = ALL_MESSAGES.flatMap((anchor) =>
  anchor.replyPrompt === undefined ? [] : [{ prompt: anchor.replyPrompt, anchor }],
);

const PROMPT_INDEX: ReadonlyMap<string, ReplyPromptEntry> = new Map(ALL_PROMPTS.map((e) => [e.prompt.id, e] as const));

/**
 * 依 prompt ID 取得 prompt 與 anchor 訊息；未知 ID 回傳 undefined（不丟例外）：
 * 舊存檔可能保存了內容日後移除的 prompt，歷史快照不應因此失效。
 */
export function promptOf(promptId: string): ReplyPromptEntry | undefined {
  return PROMPT_INDEX.get(promptId);
}

/** 某頻道的全部 prompt（含 anchor 尚未解鎖的），依內容順序。 */
export function promptsOfChannel(channelId: string): readonly ReplyPromptEntry[] {
  return ALL_PROMPTS.filter((e) => e.anchor.channelId === channelId);
}

/* ---------- 郵件包（R12） ---------- */

/** 全部郵件包，依 data/manifest.ts 順序；驗證保證含退件回條包（RETURN_RECEIPT_MAIL_PACK_ID）。 */
export const MAIL_PACKS: readonly ContentMailPack[] = CONTENT.mail;

/**
 * 依 packId 取得郵件包；未知 ID 回傳 undefined（不丟例外）：
 * 舊存檔的郵件可能引用日後移除的包，畫面應顯示讀取失敗而不是整頁出錯。
 */
export function mailPack(id: string): ContentMailPack | undefined {
  return MAIL_PACKS.find((p) => p.id === id);
}

/* ---------- 入職前情（R12） ---------- */

/** 已驗證的入職前情包；存檔 onboarding.step 是 steps 的 index。 */
export const ONBOARDING: ContentOnboarding = CONTENT.onboarding;

/** 合約段落在 steps 中的 index；驗證保證剛好一個，且不是第一段或最後一段。 */
export const onboardingContractIndex: number = ONBOARDING.steps.findIndex((s) => s.kind === 'contract');

/** 舊存檔沒有簽名姓名時的顯示名（入職包 ui.legacyPlayerName，「員工」）；不強迫補簽。 */
export const LEGACY_PLAYER_NAME: string = ONBOARDING.ui.legacyPlayerName;

/* ---------- 向同事詢問（R12） ---------- */

/** 全部詢問說明包，依 data/manifest.ts 順序。 */
export const HELP_PACKS: readonly ContentHelpPack[] = CONTENT.help;

const HELP_PACK_INDEX: ReadonlyMap<string, ContentHelpPack> = new Map(HELP_PACKS.map((h) => [h.request.id, h] as const));

/** 說明訊息 ID → 提問 ID（只含說明包的 messages，不含固定回覆的 responses）。 */
const HELP_MESSAGE_INDEX: ReadonlyMap<string, string> = new Map(
  HELP_PACKS.flatMap((h) => h.messages.map((m) => [m.id, h.request.id] as const)),
);

/** 詢問說明包（以提問 ID 查）；未知 ID 回傳 undefined（舊存檔的提問可能已從內容移除）。 */
export function helpPackOf(requestId: string): ContentHelpPack | undefined {
  return HELP_PACK_INDEX.get(requestId);
}

/** 提問設定（頻道、解鎖條件、玩家提問文字）；未知 ID 回傳 undefined。 */
export function helpRequestOf(requestId: string): ContentHelpRequest | undefined {
  return helpPackOf(requestId)?.request;
}

/** 提問的說明訊息，依說明包順序（也是送達順序）；未知 ID 回傳空陣列。 */
export function helpMessages(requestId: string): readonly ContentMessage[] {
  return helpPackOf(requestId)?.messages ?? [];
}

/**
 * 說明訊息所屬的提問 ID（這類訊息錨定在提問上：時間軸以保存的提問日與送達時間排列，
 * visibleFrom 只決定何時起可問）；每日訊息、固定回覆的 responses 或未知 ID 回傳 undefined。
 */
export function helpRequestOfMessage(messageId: string): string | undefined {
  return HELP_MESSAGE_INDEX.get(messageId);
}
