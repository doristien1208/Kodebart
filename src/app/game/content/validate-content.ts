import { PLAYER_NAME_MAX } from '../core/validate';
import {
  CASE_CONDITION_PREFIX,
  CHAT_CONDITION_PREFIX,
  HELP_CONDITION_PREFIX,
  RETIRED_CONDITION_PREFIXES,
  RETURN_CONDITION_PREFIX,
  helpConditionId,
  isActionId,
  isConditionId,
  parseCaseCondition,
  parseChatCondition,
  parseHelpCondition,
  parseReturnCondition,
  parseReviewCondition,
} from './conditions';
import { ANY_BRACE_PATTERN, placeholders } from './format';
import {
  ARCHIVE_TASK_TEXT_SHAPE,
  ARCHIVE_UI_SHAPE,
  ATTACHMENT_EVIDENCE_KINDS,
  ATTACHMENT_TASK_TEXT_SHAPE,
  REPORT_TASK_TEXT_SHAPE,
  TRANSFORM_TASK_TEXT_SHAPE,
  WORKDAY_TRIGGER_KINDS,
  WORKDAY_UI_SHAPE,
  AUDIT_ID_PATTERN,
  CASE_DECISION_DESTINATIONS,
  CASE_REVIEW_UI_SHAPE,
  CHOICE_ID_PATTERN,
  CONTENT_PACK_SCHEMA_VERSION,
  ContentHelpPack,
  ContentWorkday,
  ContentMailPack,
  ContentOnboarding,
  DESKTOP_UI_SHAPE,
  HELP_UI_SHAPE,
  HEX_COLOR_PATTERN,
  ISSUE_RECEIPT_KINDS,
  MAIL_TEMPLATE_PLACEHOLDERS,
  MAIL_UI_SHAPE,
  ONBOARDING_ADVANCE_MODES,
  ONBOARDING_LOGGING_IN_PLACEHOLDERS,
  ONBOARDING_REDUCED_MOTION_MODES,
  ONBOARDING_SIGNATURE_TEXT_SHAPE,
  ONBOARDING_STEP_KINDS,
  ONBOARDING_UI_SHAPE,
  RETURN_RECEIPT_MAIL_PACK_ID,
  FIELD_CONVERSIONS,
  FIELD_MAP_TASK_TEXT_SHAPE,
  FIELD_MAP_UI_SHAPE,
  PROGRESS_LABEL_SHAPE,
  ActorsFile,
  BulletinsFile,
  CHANNEL_KINDS,
  ChannelsFile,
  ContentBundle,
  ContentInput,
  ContentSource,
  DAY_TEXT_SHAPE,
  DOCUMENT_ISSUES_UI_SHAPE,
  DOCUMENT_KINDS,
  DayContent,
  END_TRANSITION_TEXT_SHAPE,
  EXECUTION_LOG_UI_SHAPE,
  HANDOFF_UI_SHAPE,
  ID_PATTERN,
  ID_PREFIX,
  MESSAGES_UI_SHAPE,
  MESSAGE_TIME_PATTERN,
  MORNING_UI_SHAPE,
  OPERATION_UI_SHAPE,
  RECEIPT_DOCUMENT_TEXT_SHAPE,
  RECORD_REVIEW_UI_SHAPE,
  RECORD_STATUS_SHAPE,
  RECONCILE_TASK_TEXT_SHAPE,
  REPORT_DOCUMENT_TEXT_SHAPE,
  RETURNED_REVIEW_UI_SHAPE,
  RETURN_REVIEW_TASK_TEXT_SHAPE,
  SOURCE_CARD_UI_SHAPE,
  Shape,
  TASKS_UI_SHAPE,
  TASK_KINDS,
  TEMPLATE_FIELDS,
  UiContent,
  VARIANT_KEYS,
  WINDOWS_UI_SHAPE,
  WINDOW_SHELL_UI_SHAPE,
  WRAP_TRANSITION_TEXT_SHAPE,
  dayToken,
  issueTaskId,
  parseDayId,
} from './schema';

/**
 * game/content/validate-content：內容資料檔的驗證。
 *
 * 檢查重複 ID、不存在的人物／頻道／文件／紀錄／批次／日別引用、未知條件與動作 ID、
 * 缺少必要欄位、錯誤型別、day 數字與 ID 不一致、每日至少一個任務（R8：有序多工作），以及資料檔夾帶可執行內容。
 * task／document／transition 的 `text` 依 kind（或 nextDayId）對照 schema.ts 的 *_SHAPE
 * 逐欄檢查（KB-R5-02），因此畫面會讀的每一個欄位都在載入時就被驗過。
 *
 * text 區塊採「嚴格 shape」：shape 以外的欄位（`note` 除外）也會被指出，例如每日 archive 任務帶入
 * 已搬到 ui.archive 的共同字串、或結束轉場殘留已移除的 `outcome`。
 * field-map 任務另檢查欄位對應一對一、資料列鍵值與 boolean 值域（R6-03）；
 * `cond.review.*` 條件檢查批次存在且早於訊息的 visibleFrom。
 * 訊息的 `replyPrompt`（R7）檢查 prompt／choice／response 的 ID、非空文字、`HH:MM` 時間、
 * 回應者是 anchor 頻道成員、availableThrough 不早於 visibleFrom；`cond.chat.*` 檢查 prompt 與 choice 存在、
 * 不引用自己的 prompt，且 prompt 的 anchor 不晚於引用它的訊息。頻道另檢查 topic（department／group 必填、direct 不得填）。
 * 訊息的 `unlockAfter`（R8）檢查批次是 archive 批次、筆數為 1 以上且不超過該批筆數的整數、批次所屬日不晚於 visibleFrom。
 * 同日 archive → reconcile（R9 §0）：reconcile 的 sourceBatchId 若屬於同日的 archive 任務，該 archive 必須排在前面。
 * 比對案件（R9）：`case-source` 文件的 fields 逐欄嚴格檢查；archive 任務的 `caseReview` 檢查 ID、紀錄、
 * 兩份來源與收件狀態變體（case-source、在任務 documentIds 內、互不重疊）、決定（ID、去向、依據文件、
 * 預填 archiveCode 取自依據文件）；`cond.case.*` 檢查案件與決定存在且案件所屬日早於訊息的 visibleFrom。
 * 退件（R10／R11）：reconcile 的 `returnAudit` 檢查 ID、通知日晚於核對日、案號樣板 `caseNumberTemplate`
 * （必填、只用 `{key}`、各稽核不重複）；可省略的 `reviewTaskId` 有填時檢查任務存在、是 return-review、位於通知日的
 * 下一工作日、auditId（有填時）一致。return-review 任務每日最多一項、recordIds／documentIds 為空；可省略的 `auditId`
 * 有填時檢查稽核存在且稽核的 reviewTaskId 指回自己。`task.day<N>.return-review` 保留給當日的 return-review。
 * `cond.return.notified.*` 檢查稽核存在且通知日不晚於訊息的 visibleFrom。
 * field-map 的 `sourceId` 只是作者預設配對（存在、一對一、boolean 預設來源值可轉換），不是必答的正解。
 * R12 內容包（頂層欄位皆為嚴格白名單，`integration` 只能是字串／字串陣列的說明物件）：
 * 郵件包檢查 ID、schemaVersion、寄件者、剛好 returned／resolved 兩個模板（主旨／內文／附件名只可用
 * `{caseNumber}`、`{versionLabel}`、`{reason}`）、郵件介面字（`revisionTemplate` 必須含 `{revision}`），且一定有
 * `mail.return-receipts`；入職包檢查呈現設定（色碼、逐字間隔、推進方式）、段落（ID 唯一、剛好一個合約且不在頭尾、
 * 簽名上限等於 core 的 PLAYER_NAME_MAX）與介面字（`loggingIn` 必須含 `{playerName}`）；詢問說明包檢查提問
 * （既有 direct 頻道、unlockCondition 是自己的 `cond.help.*.requested`、oncePerSave 為 true）與說明訊息
 * （與每日訊息同一套檢查，另要求在提問頻道、作者是頻道成員、unlock 含提問條件、ID 含 `help` 識別）。
 * `cond.help.*` 檢查提問存在，且只能用在該提問自己的說明訊息。ui 的 `desktop` 為嚴格 shape；
 * workbench 殘留 R12 移除的 navGroupPersonal／navGroupTeam／nav.issues／role／backToCover／heading.messages 會被指出。
 *
 * 每個錯誤都會指出來源檔、內容 ID 與完整欄位路徑，例如
 * `data/days/day-02.json [task.day2.reconcile] tasks[0].text.dialog.response.ask：缺少必要欄位…`。
 * bundle.ts 在載入時呼叫 parseContent()；有任何問題就 throw，錯誤內容不會進入執行期。
 */

export interface ContentIssue {
  /** 來源檔，例如 `data/days/day-01.json`。 */
  file: string;
  /** 出錯的內容 ID；檔案層級的問題為 null。 */
  id: string | null;
  /** 完整欄位路徑，例如 `messages[0].unlock[1]`、`tasks[0].text.dialog.response.ask`。 */
  field: string;
  message: string;
}

export function describeIssue(issue: ContentIssue): string {
  return `${issue.file} [${issue.id ?? '檔案層級'}] ${issue.field}：${issue.message}`;
}

export function formatIssues(issues: readonly ContentIssue[]): string {
  return issues.map(describeIssue).join('\n');
}

/** 內容不合法時丟出例外；訊息含全部問題。 */
export function assertContentValid(input: ContentInput): void {
  const issues = validateContent(input);
  if (issues.length > 0) throw new Error(`內容驗證失敗（${issues.length} 項）：\n${formatIssues(issues)}`);
}

/**
 * 驗證後才把原始 JSON 收斂成 ContentBundle。這是唯一的型別收斂點：
 * 上面已逐欄檢查過每個必要欄位，所以這裡的單次 `as` 不是在猜；有問題會先 throw。
 * `days` 依 `day` 數字排序。
 */
export function parseContent(input: ContentInput): ContentBundle {
  assertContentValid(input);
  const ui = input.ui.data as UiContent;
  const actors = (input.actors.data as ActorsFile).actors;
  const channels = (input.channels.data as ChannelsFile).channels;
  const bulletins = (input.bulletins.data as BulletinsFile).bulletins;
  const days = input.days.map((d) => d.data as DayContent).sort((a, b) => a.day - b.day);
  const mail = input.mail.map((m) => m.data as ContentMailPack);
  const onboarding = input.onboarding.data as ContentOnboarding;
  const help = input.help.map((h) => h.data as ContentHelpPack);
  const workday = input.workday ? (input.workday.data as ContentWorkday) : null;
  return { ui, actors, channels, bulletins, days, mail, onboarding, help, workday };
}

/* ---------- 不得出現在資料檔的內容 ---------- */

const FORBIDDEN_FRAGMENTS: readonly { fragment: string; message: string }[] = [
  { fragment: '${', message: '資料檔不得包含樣板字面值或運算式' },
  { fragment: '=>', message: '資料檔不得包含函式字串' },
  { fragment: 'function(', message: '資料檔不得包含函式字串' },
  { fragment: 'function (', message: '資料檔不得包含函式字串' },
  { fragment: 'new Function', message: '資料檔不得包含函式字串' },
  { fragment: 'eval(', message: '資料檔不得包含 eval' },
  { fragment: 'javascript:', message: '資料檔不得包含 javascript: URI' },
];

/* ---------- ui.zh-Hant.json 的必要字串欄位 ---------- */

const UI_STRING_FIELDS: readonly string[] = [
  'id',
  'locale',
  'appTitleSuffix',
  'cover.eyebrow',
  'cover.title',
  'cover.subtitle',
  'cover.start',
  'cover.continue',
  'cover.settings',
  'cover.noSave',
  'cover.savePrefix',
  'cover.footerLeft',
  'cover.footerRight',
  'cover.artAlt',
  'cover.artSrc',
  'cover.docTitle',
  'dialogs.newGame.heading',
  'dialogs.newGame.body',
  'dialogs.newGame.keep',
  'dialogs.newGame.start',
  'dialogs.settings.heading',
  'dialogs.settings.motionLabel',
  'dialogs.settings.note',
  'dialogs.settings.back',
  'storage.readIssue',
  'storage.writeIssue',
  'storage.saved',
  'workbench.brandLead',
  'workbench.brandRest',
  'workbench.brandSuffix',
  'workbench.navLabel',
  'workbench.nav.work',
  'workbench.nav.messages',
  'workbench.nav.news',
  'workbench.nav.mail',
  'workbench.team',
  'workbench.identityLabel',
  'workbench.heading.news',
  'workbench.dayTagTemplate',
  'workbench.docTitleTemplate',
  'aside.eyebrow',
  'aside.colleagueActorId',
  'aside.quote',
  'aside.slogan',
  'records.nameUnregistered',
  'news.eyebrow',
  'news.back',
];

/* ---------- 小工具 ---------- */

/** 嚴格 shape 以外的欄位；`allowed` 以外（`note` 除外）的鍵回傳 [key, path]。 */
function extraKeys(node: Record<string, unknown>, base: string, allowed: readonly string[], allowNote = true): [string, string][] {
  return Object.keys(node)
    .filter((key) => !(allowNote && key === 'note') && !allowed.includes(key))
    .map((key) => [key, join(base, key)]);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function at(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (!isObj(node)) return undefined;
    node = node[part];
  }
  return node;
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function join(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

type RefKind = 'actor' | 'channel' | 'record' | 'document' | 'batch' | 'day';

interface Reference {
  file: string;
  id: string | null;
  field: string;
  kind: RefKind;
  target: string;
}

const REF_LABEL: Readonly<Record<RefKind, string>> = {
  actor: '人物',
  channel: '頻道',
  record: '紀錄',
  document: '文件',
  batch: '批次',
  day: '日別',
};

type AddIssue = (file: string, id: string | null, field: string, message: string) => void;

/** 內容 ID 必須包含的識別片段與缺少時的訊息；null＝不檢查。 */
type IdToken = { readonly token: string; readonly message: string } | null;

/** 每日檔：ID 須含 `dayN`（例如 `task.day2.*` 屬於 `day.02`）。 */
function dayIdToken(dayNumber: number | null): IdToken {
  if (dayNumber === null) return null;
  const token = dayToken(dayNumber);
  return { token, message: `ID 必須包含所屬日的識別 \`${token}\`（此檔為第 ${dayNumber} 天）` };
}

/** 詢問說明包（R12）：訊息、prompt 與回應 ID 須含 `help`（不屬於任何一日）。 */
const HELP_ID_TOKEN: IdToken = {
  token: 'help',
  message: 'ID 必須包含詢問說明包的識別 `help`（例如 msg.help.*、prompt.help.*）',
};

/** 非 *Template 欄位的專用 placeholder 規則（R12）。 */
interface PlaceholderRule {
  readonly allowed: readonly string[];
  readonly required: readonly string[];
}

/** 郵件模板（主旨、內文、附件名）：只可用這三個 placeholder，不要求必填。 */
const MAIL_TEMPLATE_RULE: PlaceholderRule = { allowed: MAIL_TEMPLATE_PLACEHOLDERS, required: [] };

/** 入職 ui.loggingIn：必須且只能用 `{playerName}`。 */
const LOGGING_IN_RULE: PlaceholderRule = {
  allowed: ONBOARDING_LOGGING_IN_PLACEHOLDERS,
  required: ONBOARDING_LOGGING_IN_PLACEHOLDERS,
};

/** M1 工作日 ui.legendTemplate：必須且只能用 `{value}`、`{meaning}`。 */
const LEGEND_RULE: PlaceholderRule = { allowed: ['value', 'meaning'], required: ['value', 'meaning'] };

const WORKDAY_KEYS = ['id', 'schemaVersion', 'mail', 'interludes', 'ui', 'integration'] as const;
const WORKDAY_MAIL_KEYS = ['packId', 'sender', 'templates', 'outcomes'] as const;
const WORKDAY_OUTCOME_KEYS = ['id', 'templateId', 'dayId', 'ordinary', 'trigger'] as const;
const WORKDAY_INTERLUDE_KEYS = ['afterDay', 'beforeDay', 'leave', 'arrive'] as const;
const ATTACHMENT_CANDIDATE_KEYS = ['documentId', 'evidence', 'objection'] as const;
const TRANSFORM_ROW_KEYS = ['id', 'recordId', 'attachmentTaskId', 'attachment'] as const;
const FIELD_MAP_DYNAMIC_KEYS = ['codeFieldId', 'replyFieldId', 'rows'] as const;
const FIELD_MAP_DYNAMIC_ROW_KEYS = ['rowId', 'recordId', 'transformTaskIds'] as const;

/** 附件任務的候選附件與批次列隨附的附件（case-source 文件可以掛在這些任務的 documentIds）。 */
function workdayDocuments(raw: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const take = (c: unknown) => {
    if (isObj(c) && typeof c['documentId'] === 'string') out.add(c['documentId']);
  };
  if (Array.isArray(raw['candidates'])) raw['candidates'].forEach(take);
  if (Array.isArray(raw['rows'])) for (const row of raw['rows']) if (isObj(row)) take(row['attachment']);
  return out;
}

/* R12 內容包的欄位白名單（`note` 另外允許）。 */
const MAIL_PACK_KEYS = ['id', 'schemaVersion', 'sender', 'templates', 'ui', 'integration'] as const;
const MAIL_TEMPLATE_KEYS = ['subject', 'lines', 'attachmentLabel'] as const;
const ONBOARDING_KEYS = ['id', 'schemaVersion', 'presentation', 'steps', 'ui', 'integration'] as const;
const ONBOARDING_PRESENTATION_KEYS = ['background', 'foreground', 'characterIntervalMs', 'advance', 'reducedMotion'] as const;
const ONBOARDING_LINE_KEYS = ['id', 'kind', 'text'] as const;
const ONBOARDING_CONTRACT_KEYS = ['id', 'kind', 'heading', 'clauses', 'footer', 'signature'] as const;
const ONBOARDING_SIGNATURE_KEYS = [...Object.keys(ONBOARDING_SIGNATURE_TEXT_SHAPE), 'maxGraphemes'] as const;
const HELP_PACK_KEYS = ['id', 'schemaVersion', 'request', 'ui', 'messages', 'integration'] as const;
const HELP_REQUEST_KEYS = ['id', 'channelId', 'unlockCondition', 'playerText', 'oncePerSave'] as const;
/** 說明訊息沿用 ContentMessage 的欄位（不含每日訊息才用得到的 actions）。 */
const HELP_MESSAGE_KEYS = [
  'id',
  'channelId',
  'actorId',
  'time',
  'visibleFrom',
  'unlock',
  'unlockAfter',
  'variant',
  'lines',
  'replyPrompt',
] as const;

/** R12 從 workbench 移除的欄位；殘留時提示改法。 */
const WORKBENCH_REMOVED: readonly (readonly [string, string])[] = [
  ['workbench.navGroupPersonal', 'navGroupPersonal 已移除（R12）：工作平台左側只列單組功能，組別改用 workbench.team 顯示在右上身分區'],
  ['workbench.navGroupTeam', 'navGroupTeam 已移除（R12）：組別改用 workbench.team 顯示在右上身分區'],
  ['workbench.nav.issues', 'nav.issues 已移除（R12）：「文件問題」頁改由郵件取代，導覽改用 workbench.nav.mail'],
  ['workbench.role', 'role 已移除（R12）：工作平台右上身分區顯示玩家姓名與 workbench.team'],
  ['workbench.backToCover', 'backToCover 已移除（R12）：返回開始頁改在桌面主選單 desktop.menu.backToCover'],
  ['workbench.heading.messages', 'heading.messages 已移除（R12）：通訊改為桌面應用，工作平台只保留公告頁標題 heading.news'],
];

/* ---------- 主驗證 ---------- */

export function validateContent(input: ContentInput): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const seenIds = new Map<string, string>();
  const seenRecordKeys = new Map<string, string>();
  const registry: Record<RefKind, Set<string>> = {
    actor: new Set(),
    channel: new Set(),
    record: new Set(),
    document: new Set(),
    batch: new Set(),
    day: new Set(),
  };
  const references: Reference[] = [];
  /** archive 批次所屬日序；`cond.review.*` 需要比較批次日與訊息 visibleFrom。 */
  const batchDay = new Map<string, number>();
  /** archive 批次的筆數；`unlockAfter.archivedCount` 不得超過。 */
  const batchSize = new Map<string, number>();
  const unlockAfterRefs: {
    file: string;
    id: string | null;
    /** `messages[i].unlockAfter`。 */
    base: string;
    batchId: string;
    count: number | null;
    visibleFrom: unknown;
  }[] = [];
  const dayNumberOf = new Map<string, number>();
  const reviewRefs: { file: string; id: string | null; field: string; batchId: string; visibleFrom: unknown }[] = [];
  /** 頻道 → 成員（actorIds）；回應者必須是 anchor 頻道的成員。 */
  const channelMembers = new Map<string, readonly string[]>();
  /** prompt ID → choice 與 anchor 資訊；`cond.chat.*` 與 availableThrough 的後段檢查用。 */
  const prompts = new Map<string, { choices: ReadonlySet<string>; visibleFrom: unknown }>();
  const promptRanges: { file: string; id: string | null; field: string; availableThrough: string; visibleFrom: unknown }[] = [];
  const chatRefs: {
    file: string;
    id: string | null;
    field: string;
    promptId: string;
    choiceId: string;
    visibleFrom: unknown;
    ownPromptId: unknown;
  }[] = [];
  const responseActors: { file: string; id: string | null; field: string; actorId: unknown; channelId: unknown }[] = [];
  /** 文件 → kind／欄位值（case-source）／recordIds；case 檢查在所有日檔登記完文件後進行（可跨日引用）。 */
  const documentKind = new Map<string, string>();
  const caseSourceValues = new Map<string, readonly string[]>();
  const documentRecords = new Map<string, readonly string[]>();
  /** 案件 ID → 所屬日與決定；`cond.case.*` 用。 */
  const cases = new Map<string, { day: number | null; decisions: ReadonlySet<string> }>();
  /** 紀錄 ID → 引用它的案件；同一筆紀錄最多一個案件。 */
  const caseOfRecord = new Map<string, string>();
  /** caseReview 引用的文件（來源或變體）；後段檢查存在、kind、在 documentIds 內、recordIds 含案件紀錄。 */
  const caseDocRefs: {
    file: string;
    id: string | null;
    field: string;
    documentId: string;
    taskDocumentIds: readonly unknown[] | null;
    recordId: string | null;
  }[] = [];
  /** 決定的 archiveCode 必須是依據文件的欄位值。 */
  const archiveCodeRefs: { file: string; id: string | null; field: string; archiveCode: string; basisDocumentId: string }[] = [];
  /** 任務 documentIds 內的每一項與該任務 caseReview 引用的文件；case-source 只能掛在引用它的任務上。 */
  const taskDocRefs: { file: string; id: string | null; field: string; documentId: string; caseDocs: ReadonlySet<string> }[] = [];
  const caseRefs: { file: string; id: string | null; field: string; caseId: string; decisionId: string; visibleFrom: unknown }[] = [];
  /** 任務 ID → kind、所屬日與（return-review 的）auditId（省略時為 undefined）；稽核的 reviewTaskId 可跨日引用。 */
  const taskInfo = new Map<string, { kind: unknown; day: number | null; auditId: unknown }>();
  /** day ID → nextDayId（最後一日為 null）；reviewTaskId 必須位於通知日的下一工作日（R11）。 */
  const nextDayOf = new Map<string, string | null>();
  /**
   * 稽核 ID → 定義它的 reconcile 任務與設定（R10）；後段檢查通知日與複審任務。
   * `reviewTask`：`absent`＝省略（R11 允許）、`invalid`＝有填但格式錯（已指出），否則為任務 ID。
   */
  const audits = new Map<
    string,
    {
      file: string;
      taskId: string | null;
      base: string;
      day: number | null;
      notifyDayId: string | null;
      reviewTask: 'absent' | 'invalid' | { id: string };
    }
  >();
  /** 案號樣板 → 第一個使用它的稽核；不同稽核不得共用（R11）。 */
  const caseNumberTemplates = new Map<string, string>();
  const returnReviewRefs: { file: string; id: string | null; field: string; auditId: string }[] = [];
  const returnRefs: { file: string; id: string | null; field: string; auditId: string; visibleFrom: unknown }[] = [];
  /** 頻道 → kind；詢問說明包的提問頻道必須是 direct（R12）。 */
  const channelKinds = new Map<string, unknown>();
  /** `cond.help.*` 的引用（R12）；owner＝所在說明訊息的提問 ID，每日訊息為 null。 */
  const helpRefs: { file: string; id: string | null; field: string; cond: string; requestId: string; owner: string | null }[] = [];
  /** 詢問說明包定義的提問 ID（R12）。 */
  const helpRequestIds = new Set<string>();
  /** 郵件包 ID（R12）；一定要有 RETURN_RECEIPT_MAIL_PACK_ID。 */
  const mailPackIds = new Set<string>();
  /** 寄件者 ID → 第一個出現時的名稱與檔案；同一寄件者在不同包的名稱必須一致。 */
  const mailSenders = new Map<string, { name: unknown; file: string }>();
  /* ---- M1 工作日 ---- */
  /** 紀錄 ID → 歸檔它的 archive 任務、批次與日序；附件／批次／動態欄位映射的對象必須已由某個 archive 任務歸檔。 */
  const recordArchive = new Map<string, { taskId: string | null; batchId: string; day: number | null }>();
  /** field-map 任務 → 來源欄位、boolean 目標的預設來源、資料列與是否有 dynamic。 */
  const fieldMapInfo = new Map<string, { day: number | null; sourceIds: ReadonlySet<string>; booleanSources: ReadonlySet<string>; rowIds: ReadonlySet<string>; dynamic: boolean }>();
  /** 新任務種類的後段檢查（需要全部日檔登記完文件、紀錄與任務）。 */
  const workdayTaskRefs: {
    file: string;
    id: string | null;
    field: string;
    kind: 'attachment' | 'transform' | 'report' | 'field-map';
    day: number | null;
    raw: Record<string, unknown>;
    dependsOn: ReadonlySet<string>;
  }[] = [];
  /** M1 工作進度解鎖（caseOpened／taskOpened／taskPreviewed）。 */
  const progressUnlockRefs: { file: string; id: string | null; base: string; key: 'caseOpened' | 'taskOpened' | 'taskPreviewed'; target: string; visibleFrom: unknown }[] = [];

  const add: AddIssue = (file, id, field, message) => {
    issues.push({ file, id, field, message });
  };

  /** 註冊 ID：檢查前綴、字元與全域唯一。 */
  const takeId = (source: ContentSource, value: unknown, field: string, prefix: string, kind?: RefKind): string | null => {
    if (typeof value !== 'string' || value === '') {
      add(source.file, null, field, `缺少 id 或型別錯誤（得到 ${typeName(value)}）`);
      return null;
    }
    if (!value.startsWith(prefix)) add(source.file, value, field, `ID 必須以 \`${prefix}\` 開頭`);
    if (!ID_PATTERN.test(value)) add(source.file, value, field, 'ID 只能使用小寫英數、`-` 與 `.`');
    const previous = seenIds.get(value);
    if (previous !== undefined) add(source.file, value, field, `ID 重複，已在 ${previous} 使用`);
    else seenIds.set(value, source.file);
    if (kind !== undefined) registry[kind].add(value);
    return value;
  };

  /** 必要且非空的字串；`path` 是相對 root 的完整欄位路徑。 */
  const requireString = (source: ContentSource, id: string | null, root: unknown, path: string): string | null => {
    const value = at(root, path);
    if (typeof value !== 'string') {
      add(source.file, id, path, `缺少必要欄位或型別錯誤：需要 string，得到 ${typeName(value)}`);
      return null;
    }
    if (value === '') {
      add(source.file, id, path, '不得為空字串');
      return null;
    }
    return value;
  };

  /**
   * 依 shape 逐欄檢查：葉節點需為非空字串，巢狀節點需為物件。錯誤路徑為 `${base}.${key}`。
   * `strict` 時 shape 以外的欄位（`note` 除外，含巢狀層）也是錯誤；`hints` 為特定多餘欄位的改法提示（巢狀層沿用同一份）。
   */
  const checkShape = (
    source: ContentSource,
    id: string | null,
    node: unknown,
    base: string,
    shape: Shape,
    strict = false,
    hints: Readonly<Record<string, string>> = {},
  ): void => {
    if (!isObj(node)) {
      add(source.file, id, base, `需要物件，得到 ${typeName(node)}`);
      return;
    }
    if (strict) {
      for (const key of Object.keys(node)) {
        if (key === 'note' || Object.prototype.hasOwnProperty.call(shape, key)) continue;
        const hint = Object.prototype.hasOwnProperty.call(hints, key) ? hints[key] : '請移除，或先在 schema.ts 的 shape 登記';
        add(source.file, id, join(base, key), `不在此區塊 shape 內的欄位：${hint}`);
      }
    }
    for (const key of Object.keys(shape)) {
      const expected = shape[key];
      const path = join(base, key);
      if (expected !== 'string') {
        checkShape(source, id, node[key], path, expected, strict, hints);
        continue;
      }
      const value = node[key];
      if (typeof value !== 'string') {
        add(source.file, id, path, `缺少必要欄位或型別錯誤：需要 string，得到 ${typeName(value)}`);
      } else if (value === '') {
        add(source.file, id, path, '不得為空字串');
      }
    }
  };

  const ref = (source: ContentSource, id: string | null, field: string, kind: RefKind, target: unknown): void => {
    if (typeof target !== 'string' || target === '') {
      add(source.file, id, field, `${REF_LABEL[kind]}引用必須是非空字串，得到 ${typeName(target)}`);
      return;
    }
    references.push({ file: source.file, id, field, kind, target });
  };

  /** ID 引用陣列；`nonEmpty` 時不得為空。 */
  const refList = (
    source: ContentSource,
    id: string | null,
    field: string,
    kind: RefKind,
    list: unknown,
    nonEmpty: boolean,
  ): void => {
    if (!Array.isArray(list)) {
      add(source.file, id, field, `需要${REF_LABEL[kind]} ID 陣列，得到 ${typeName(list)}`);
      return;
    }
    if (nonEmpty && list.length === 0) {
      add(source.file, id, field, `不得為空陣列，至少需要一個${REF_LABEL[kind]}引用`);
      return;
    }
    list.forEach((target, i) => ref(source, id, `${field}[${i}]`, kind, target));
  };

  /** 內容 ID 必須含指定的識別片段（每日檔為 `dayN`、詢問說明包為 `help`）；token 為 null 時不檢查。 */
  const requireIdToken = (source: ContentSource, id: string | null, field: string, token: IdToken): void => {
    if (id === null || token === null) return;
    if (!id.split('.').includes(token.token)) add(source.file, id, field, token.message);
  };

  /** 該日檔內的內容 ID 必須含日識別片段（例如 `task.day2.*` 屬於 `day.02`）。 */
  const requireDayToken = (source: ContentSource, id: string | null, field: string, dayNumber: number | null): void => {
    requireIdToken(source, id, field, dayIdToken(dayNumber));
  };

  /** `HH:MM` 時間（R7）；訊息與回應共用。 */
  const checkTime = (source: ContentSource, id: string | null, field: string, value: unknown): void => {
    if (typeof value !== 'string') {
      add(source.file, id, field, `缺少必要欄位或型別錯誤：需要 string，得到 ${typeName(value)}`);
    } else if (!MESSAGE_TIME_PATTERN.test(value)) {
      add(source.file, id, field, `時間必須是 HH:MM（24 小時制），得到 ${value === '' ? '空字串' : value}`);
    }
  };

  /**
   * 訊息的 replyPrompt（R7）。prompt／response ID 走全域 ID 空間（takeId），response 用 `msg.` 前綴，
   * 因此與普通訊息不得重複；choice ID 只在同一 prompt 內唯一。responses 繼承 anchor 的頻道與可見日，
   * 另存 channelId／visibleFrom 會被指出。跨檔的日序與頻道成員在後段檢查。
   */
  const checkReplyPrompt = (
    source: ContentSource,
    token: IdToken,
    messageId: string | null,
    field: string,
    raw: Record<string, unknown>,
    visibleFrom: unknown,
  ): void => {
    const prompt = raw['replyPrompt'];
    if (prompt === undefined) return;
    const base = `${field}.replyPrompt`;
    if (!isObj(prompt)) {
      add(source.file, messageId, base, `需要物件，得到 ${typeName(prompt)}`);
      return;
    }
    const promptId = takeId(source, prompt['id'], `${base}.id`, ID_PREFIX.prompt);
    requireIdToken(source, promptId, `${base}.id`, token);
    const pid = promptId ?? messageId;
    for (const [, path] of extraKeys(prompt, base, ['id', 'availableThrough', 'choices'], false)) {
      add(source.file, pid, path, '不在 replyPrompt 內的欄位（只允許 id、availableThrough、choices）');
    }

    const through = prompt['availableThrough'];
    if (typeof through !== 'string' || through === '') {
      add(source.file, pid, `${base}.availableThrough`, `缺少必要欄位 availableThrough（最後可回答的 day ID），得到 ${typeName(through)}`);
    } else {
      ref(source, pid, `${base}.availableThrough`, 'day', through);
      promptRanges.push({ file: source.file, id: pid, field: `${base}.availableThrough`, availableThrough: through, visibleFrom });
    }

    const choiceIds = new Set<string>();
    const choices = prompt['choices'];
    if (!Array.isArray(choices)) {
      add(source.file, pid, `${base}.choices`, `需要選項陣列，得到 ${typeName(choices)}`);
    } else if (choices.length === 0) {
      add(source.file, pid, `${base}.choices`, '不得為空陣列，至少需要一個選項');
    } else {
      choices.forEach((choice, c) => {
        const cb = `${base}.choices[${c}]`;
        if (!isObj(choice)) {
          add(source.file, pid, cb, `需要物件，得到 ${typeName(choice)}`);
          return;
        }
        for (const [, path] of extraKeys(choice, cb, ['id', 'text', 'responses'], false)) {
          add(source.file, pid, path, '不在選項內的欄位（只允許 id、text、responses）');
        }
        const choiceId = choice['id'];
        if (typeof choiceId !== 'string' || choiceId === '') {
          add(source.file, pid, `${cb}.id`, `choice id 必須是非空字串，得到 ${typeName(choiceId)}`);
        } else if (!CHOICE_ID_PATTERN.test(choiceId)) {
          add(source.file, pid, `${cb}.id`, `choice id 只能使用小寫英數與 \`-\`，不得含 \`.\`（得到 ${choiceId}）`);
        } else if (choiceIds.has(choiceId)) {
          add(source.file, pid, `${cb}.id`, `choice id ${choiceId} 在同一 prompt 內重複`);
        } else choiceIds.add(choiceId);
        const text = choice['text'];
        if (typeof text !== 'string' || text === '') {
          add(source.file, pid, `${cb}.text`, `玩家回覆文字必須是非空字串，得到 ${text === '' ? '空字串' : typeName(text)}`);
        }
        const responses = choice['responses'];
        if (!Array.isArray(responses)) {
          add(source.file, pid, `${cb}.responses`, `需要回應陣列，得到 ${typeName(responses)}`);
          return;
        }
        if (responses.length === 0) {
          add(source.file, pid, `${cb}.responses`, '不得為空陣列，至少需要一則回應');
          return;
        }
        responses.forEach((response, r) => {
          const rb = `${cb}.responses[${r}]`;
          if (!isObj(response)) {
            add(source.file, pid, rb, `需要物件，得到 ${typeName(response)}`);
            return;
          }
          const rid = takeId(source, response['id'], `${rb}.id`, ID_PREFIX.message);
          requireIdToken(source, rid, `${rb}.id`, token);
          const owner = rid ?? pid;
          for (const [key, path] of extraKeys(response, rb, ['id', 'actorId', 'time', 'lines'], false)) {
            const hint =
              key === 'channelId' || key === 'visibleFrom'
                ? `回應繼承 anchor 訊息的 ${key}，不另存`
                : '不在回應內的欄位（只允許 id、actorId、time、lines）';
            add(source.file, owner, path, hint);
          }
          ref(source, owner, `${rb}.actorId`, 'actor', response['actorId']);
          responseActors.push({
            file: source.file,
            id: owner,
            field: `${rb}.actorId`,
            actorId: response['actorId'],
            channelId: raw['channelId'],
          });
          checkTime(source, owner, `${rb}.time`, response['time']);
          requireStringArray(source, owner, `${rb}.lines`, response['lines'], add);
        });
      });
    }
    if (promptId !== null && !prompts.has(promptId)) prompts.set(promptId, { choices: choiceIds, visibleFrom });
  };

  /**
   * 訊息的 unlockAfter（R8 §4）：只允許 archiveBatchId 與 archivedCount；
   * 批次是否存在、筆數上限與日序在所有日檔登記完批次後檢查。
   */
  const checkUnlockAfter = (
    source: ContentSource,
    messageId: string | null,
    field: string,
    value: unknown,
    visibleFrom: unknown,
  ): void => {
    if (value === undefined) return;
    const base = `${field}.unlockAfter`;
    if (!isObj(value)) {
      add(source.file, messageId, base, `需要物件，得到 ${typeName(value)}`);
      return;
    }
    // M1：工作進度解鎖（擇一）：案件已開啟／任務已開啟／批次或報告已建立預覽
    const progressKey = (['caseOpened', 'taskOpened', 'taskPreviewed'] as const).find((k) => k in value);
    if (progressKey !== undefined) {
      for (const [, path] of extraKeys(value, base, [progressKey], false)) {
        add(source.file, messageId, path, `不在 unlockAfter 內的欄位（${progressKey} 只能單獨使用）`);
      }
      const target = value[progressKey];
      if (typeof target !== 'string' || target === '') {
        add(source.file, messageId, `${base}.${progressKey}`, `${progressKey} 必須是非空字串，得到 ${typeName(target)}`);
        return;
      }
      progressUnlockRefs.push({ file: source.file, id: messageId, base, key: progressKey, target, visibleFrom });
      return;
    }
    for (const [, path] of extraKeys(value, base, ['archiveBatchId', 'archivedCount'], false)) {
      add(source.file, messageId, path, '不在 unlockAfter 內的欄位（只允許 archiveBatchId、archivedCount）');
    }
    const batchId = value['archiveBatchId'];
    const count = value['archivedCount'];
    let validCount: number | null = null;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      add(
        source.file,
        messageId,
        `${base}.archivedCount`,
        `archivedCount 必須是 1 以上的整數，得到 ${typeof count === 'number' ? String(count) : typeName(count)}`,
      );
    } else validCount = count;
    if (typeof batchId !== 'string' || batchId === '') {
      add(source.file, messageId, `${base}.archiveBatchId`, `archiveBatchId 必須是非空字串，得到 ${typeName(batchId)}`);
      return;
    }
    unlockAfterRefs.push({ file: source.file, id: messageId, base, batchId, count: validCount, visibleFrom });
  };

  /**
   * `case-source` 文件的 text（R9）：只允許 heading 與 fields（`note` 除外）；fields 非空，
   * 每一項只有非空的 label／value 字串，label 在同一文件內唯一（差異標記以 label 保存）。回傳欄位值。
   */
  const checkCaseSourceText = (source: ContentSource, id: string | null, text: unknown, base: string): string[] => {
    const values: string[] = [];
    if (!isObj(text)) {
      add(source.file, id, base, `需要物件，得到 ${typeName(text)}`);
      return values;
    }
    for (const [, path] of extraKeys(text, base, ['heading', 'fields'])) {
      add(source.file, id, path, '不在此區塊 shape 內的欄位：case-source 文件的 text 只允許 heading 與 fields');
    }
    const heading = text['heading'];
    if (typeof heading !== 'string') {
      add(source.file, id, `${base}.heading`, `缺少必要欄位或型別錯誤：需要 string，得到 ${typeName(heading)}`);
    } else if (heading === '') add(source.file, id, `${base}.heading`, '不得為空字串');
    const list = text['fields'];
    if (!Array.isArray(list)) {
      add(source.file, id, `${base}.fields`, `需要欄位陣列，得到 ${typeName(list)}`);
      return values;
    }
    if (list.length === 0) {
      add(source.file, id, `${base}.fields`, '不得為空陣列，至少需要一個欄位');
      return values;
    }
    const labels = new Set<string>();
    list.forEach((item, i) => {
      const fb = `${base}.fields[${i}]`;
      if (!isObj(item)) {
        add(source.file, id, fb, `需要物件，得到 ${typeName(item)}`);
        return;
      }
      for (const [, path] of extraKeys(item, fb, ['label', 'value'], false)) {
        add(source.file, id, path, '不在欄位內的鍵（只允許 label、value）');
      }
      const label = item['label'];
      if (typeof label !== 'string' || label === '') {
        add(source.file, id, `${fb}.label`, `label 必須是非空字串，得到 ${label === '' ? '空字串' : typeName(label)}`);
      } else if (labels.has(label)) {
        add(source.file, id, `${fb}.label`, `label ${label} 在同一文件內重複（差異標記以 label 識別）`);
      } else labels.add(label);
      const value = item['value'];
      if (typeof value !== 'string') {
        add(source.file, id, `${fb}.value`, `欄位值必須是字串（編號的前導零不得寫成數字），得到 ${typeName(value)}`);
      } else if (value === '') {
        add(source.file, id, `${fb}.value`, '不得為空字串');
      } else values.push(value);
    });
    return values;
  };

  /**
   * archive 任務的 caseReview（R9）。結構在此檢查；文件是否存在、kind、archiveCode 是否取自依據文件在後段檢查。
   * 回傳 caseReview 引用的文件 ID（來源＋變體），供「case-source 只能掛在引用它的任務上」的檢查。
   */
  const checkCaseReview = (
    source: ContentSource,
    dayNumber: number | null,
    taskId: string | null,
    field: string,
    raw: Record<string, unknown>,
  ): Set<string> => {
    const referenced = new Set<string>();
    const value = raw['caseReview'];
    if (value === undefined) return referenced;
    const base = `${field}.caseReview`;
    if (!isObj(value)) {
      add(source.file, taskId, base, `需要物件，得到 ${typeName(value)}`);
      return referenced;
    }
    const caseId = takeId(source, value['id'], `${base}.id`, ID_PREFIX.case);
    requireDayToken(source, caseId, `${base}.id`, dayNumber);
    const cid = caseId ?? taskId;
    for (const [, path] of extraKeys(value, base, ['id', 'recordId', 'sourceDocumentIds', 'receiptVariants', 'decisions'], false)) {
      add(source.file, cid, path, '不在 caseReview 內的欄位（只允許 id、recordId、sourceDocumentIds、receiptVariants、decisions）');
    }
    const taskDocs = Array.isArray(raw['documentIds']) ? (raw['documentIds'] as unknown[]) : null;

    /* recordId：任務 recordIds 內的一筆，且只屬於一個案件 */
    let recordId: string | null = null;
    const rawRecord = value['recordId'];
    if (typeof rawRecord !== 'string' || rawRecord === '') {
      add(source.file, cid, `${base}.recordId`, `recordId 必須是非空字串，得到 ${typeName(rawRecord)}`);
    } else {
      recordId = rawRecord;
      ref(source, cid, `${base}.recordId`, 'record', rawRecord);
      const taskRecords = raw['recordIds'];
      if (Array.isArray(taskRecords) && !taskRecords.includes(rawRecord)) {
        add(source.file, cid, `${base}.recordId`, `recordId ${rawRecord} 必須列在同一任務的 recordIds 內`);
      }
      const previous = caseOfRecord.get(rawRecord);
      if (previous !== undefined) {
        add(source.file, cid, `${base}.recordId`, `紀錄 ${rawRecord} 已由案件 ${previous} 使用；同一筆紀錄最多一個案件`);
      } else if (caseId !== null) caseOfRecord.set(rawRecord, caseId);
    }

    const docRef = (path: string, documentId: string): void => {
      referenced.add(documentId);
      caseDocRefs.push({ file: source.file, id: cid, field: path, documentId, taskDocumentIds: taskDocs, recordId });
    };

    /* sourceDocumentIds：剛好兩份、不重複 */
    const sources = new Set<string>();
    const rawSources = value['sourceDocumentIds'];
    const sourcesOk = Array.isArray(rawSources);
    if (!Array.isArray(rawSources)) {
      add(source.file, cid, `${base}.sourceDocumentIds`, `需要文件 ID 陣列，得到 ${typeName(rawSources)}`);
    } else {
      if (rawSources.length !== 2) {
        add(source.file, cid, `${base}.sourceDocumentIds`, `比對案件需要剛好兩份來源文件，得到 ${rawSources.length} 份`);
      }
      rawSources.forEach((doc, i) => {
        const path = `${base}.sourceDocumentIds[${i}]`;
        if (typeof doc !== 'string' || doc === '') {
          add(source.file, cid, path, `文件引用必須是非空字串，得到 ${typeName(doc)}`);
        } else if (sources.has(doc)) {
          add(source.file, cid, path, `來源文件 ${doc} 重複`);
        } else {
          sources.add(doc);
          docRef(path, doc);
        }
      });
    }

    /* receiptVariants：至少兩個，ID 唯一且不含 `.`，文件互不重複、不與來源重疊 */
    const variantIds = new Set<string>();
    const variantDocs = new Set<string>();
    const rawVariants = value['receiptVariants'];
    if (!Array.isArray(rawVariants)) {
      add(source.file, cid, `${base}.receiptVariants`, `需要變體陣列，得到 ${typeName(rawVariants)}`);
    } else {
      if (rawVariants.length < 2) {
        add(source.file, cid, `${base}.receiptVariants`, `收件狀態變體至少需要兩個，得到 ${rawVariants.length} 個`);
      }
      rawVariants.forEach((variant, i) => {
        const vb = `${base}.receiptVariants[${i}]`;
        if (!isObj(variant)) {
          add(source.file, cid, vb, `需要物件，得到 ${typeName(variant)}`);
          return;
        }
        for (const [, path] of extraKeys(variant, vb, ['id', 'documentId'], false)) {
          add(source.file, cid, path, '不在變體內的欄位（只允許 id、documentId）');
        }
        const vid = variant['id'];
        if (typeof vid !== 'string' || vid === '') {
          add(source.file, cid, `${vb}.id`, `變體 id 必須是非空字串，得到 ${typeName(vid)}`);
        } else if (!CHOICE_ID_PATTERN.test(vid)) {
          add(source.file, cid, `${vb}.id`, `變體 id 只能使用小寫英數與 \`-\`，不得含 \`.\`（得到 ${vid}）`);
        } else if (variantIds.has(vid)) {
          add(source.file, cid, `${vb}.id`, `變體 id ${vid} 在同一案件內重複`);
        } else variantIds.add(vid);
        const doc = variant['documentId'];
        if (typeof doc !== 'string' || doc === '') {
          add(source.file, cid, `${vb}.documentId`, `文件引用必須是非空字串，得到 ${typeName(doc)}`);
        } else if (sources.has(doc)) {
          add(source.file, cid, `${vb}.documentId`, `變體文件 ${doc} 已是來源文件；變體只放佐證，不得與 sourceDocumentIds 重疊`);
        } else if (variantDocs.has(doc)) {
          add(source.file, cid, `${vb}.documentId`, `變體文件 ${doc} 重複；每個變體需要自己的文件`);
        } else {
          variantDocs.add(doc);
          docRef(`${vb}.documentId`, doc);
        }
      });
    }

    /* decisions：非空；ID 唯一且不含 `.`；去向白名單；依據是來源之一 */
    const decisionIds = new Set<string>();
    const rawDecisions = value['decisions'];
    if (!Array.isArray(rawDecisions)) {
      add(source.file, cid, `${base}.decisions`, `需要決定陣列，得到 ${typeName(rawDecisions)}`);
    } else if (rawDecisions.length === 0) {
      add(source.file, cid, `${base}.decisions`, '不得為空陣列，至少需要一個處理方式');
    } else {
      rawDecisions.forEach((decision, i) => {
        const db = `${base}.decisions[${i}]`;
        if (!isObj(decision)) {
          add(source.file, cid, db, `需要物件，得到 ${typeName(decision)}`);
          return;
        }
        for (const [, path] of extraKeys(decision, db, ['id', 'label', 'archiveCode', 'destination', 'basisDocumentId', 'note'], false)) {
          add(source.file, cid, path, '不在決定內的欄位（只允許 id、label、archiveCode、destination、basisDocumentId、note）');
        }
        const did = decision['id'];
        if (typeof did !== 'string' || did === '') {
          add(source.file, cid, `${db}.id`, `決定 id 必須是非空字串，得到 ${typeName(did)}`);
        } else if (!CHOICE_ID_PATTERN.test(did)) {
          add(source.file, cid, `${db}.id`, `決定 id 只能使用小寫英數與 \`-\`，不得含 \`.\`（得到 ${did}）`);
        } else if (decisionIds.has(did)) {
          add(source.file, cid, `${db}.id`, `決定 id ${did} 在同一案件內重複`);
        } else decisionIds.add(did);
        for (const key of ['label', 'archiveCode', 'note'] as const) {
          const text = decision[key];
          if (typeof text !== 'string') {
            const hint = key === 'archiveCode' ? '（編號的前導零不得寫成數字）' : '';
            add(source.file, cid, `${db}.${key}`, `缺少必要欄位或型別錯誤：需要 string${hint}，得到 ${typeName(text)}`);
          } else if (text === '') add(source.file, cid, `${db}.${key}`, '不得為空字串');
        }
        const destination = decision['destination'];
        if (typeof destination !== 'string' || !(CASE_DECISION_DESTINATIONS as readonly string[]).includes(destination)) {
          add(source.file, cid, `${db}.destination`, `destination 必須是 ${CASE_DECISION_DESTINATIONS.join('／')}，得到 ${String(destination)}`);
        }
        const basis = decision['basisDocumentId'];
        if (typeof basis !== 'string' || basis === '') {
          add(source.file, cid, `${db}.basisDocumentId`, `basisDocumentId 必須是非空字串，得到 ${typeName(basis)}`);
        } else if (sourcesOk && !sources.has(basis)) {
          add(source.file, cid, `${db}.basisDocumentId`, `依據文件 ${basis} 必須是 sourceDocumentIds 之一（${[...sources].join('、')}）`);
        } else if (typeof decision['archiveCode'] === 'string' && decision['archiveCode'] !== '') {
          archiveCodeRefs.push({
            file: source.file,
            id: cid,
            field: `${db}.archiveCode`,
            archiveCode: decision['archiveCode'],
            basisDocumentId: basis,
          });
        }
      });
    }
    if (caseId !== null && !cases.has(caseId)) cases.set(caseId, { day: dayNumber, decisions: decisionIds });
    return referenced;
  };

  /**
   * reconcile 任務的 returnAudit（R10）。結構在此檢查；通知日與核對日的先後、複審任務的存在／kind／日序／auditId
   * 在所有日檔登記完任務後檢查。
   */
  const checkReturnAudit = (
    source: ContentSource,
    dayNumber: number | null,
    taskId: string | null,
    field: string,
    value: unknown,
  ): void => {
    if (value === undefined) return;
    const base = `${field}.returnAudit`;
    if (!isObj(value)) {
      add(source.file, taskId, base, `需要物件，得到 ${typeName(value)}`);
      return;
    }
    for (const [, path] of extraKeys(value, base, ['id', 'notifyDayId', 'reviewTaskId', 'caseNumberTemplate'], false)) {
      add(source.file, taskId, path, '不在 returnAudit 內的欄位（只允許 id、notifyDayId、reviewTaskId、caseNumberTemplate）');
    }
    const rawId = value['id'];
    let auditId: string | null = null;
    if (typeof rawId !== 'string' || rawId === '') {
      add(source.file, taskId, `${base}.id`, `稽核 id 必須是非空字串，得到 ${typeName(rawId)}`);
    } else if (!AUDIT_ID_PATTERN.test(rawId)) {
      add(source.file, taskId, `${base}.id`, `稽核 id 只能使用小寫英數與 \`-\`，不得含 \`.\`（得到 ${rawId}）`);
    } else if (audits.has(rawId)) {
      add(source.file, taskId, `${base}.id`, `稽核 id ${rawId} 重複，已由 ${audits.get(rawId)?.taskId ?? '其他任務'} 定義`);
    } else auditId = rawId;
    const notify = value['notifyDayId'];
    let notifyDayId: string | null = null;
    if (typeof notify !== 'string' || notify === '') {
      add(source.file, taskId, `${base}.notifyDayId`, `缺少必要欄位 notifyDayId（通知退件的 day ID），得到 ${typeName(notify)}`);
    } else {
      notifyDayId = notify;
      ref(source, taskId, `${base}.notifyDayId`, 'day', notify);
    }
    /* reviewTaskId：R11 起可省略；有填時必須是 task. 前綴的非空字串（指向與日序在後段檢查） */
    const review = value['reviewTaskId'];
    let reviewTask: 'absent' | 'invalid' | { id: string } = 'absent';
    if (review === undefined) {
      // 省略：案件照排程進入通知日下一工作日的錯誤文件處理
    } else if (typeof review !== 'string' || review === '') {
      add(source.file, taskId, `${base}.reviewTaskId`, `reviewTaskId 可省略；有填時必須是任務 ID 字串，得到 ${review === '' ? '空字串' : typeName(review)}`);
      reviewTask = 'invalid';
    } else if (!review.startsWith(ID_PREFIX.task)) {
      add(source.file, taskId, `${base}.reviewTaskId`, `ID 必須以 \`${ID_PREFIX.task}\` 開頭`);
      reviewTask = 'invalid';
    } else reviewTask = { id: review };
    /* caseNumberTemplate：必填（placeholder 由 TEMPLATE_FIELDS 檢查，只能且必須用 {key}）；各稽核不得相同 */
    const template = value['caseNumberTemplate'];
    if (typeof template !== 'string' || template === '') {
      add(
        source.file,
        taskId,
        `${base}.caseNumberTemplate`,
        `缺少必要欄位 caseNumberTemplate（案號樣板，例如 RT-{key}），得到 ${template === '' ? '空字串' : typeName(template)}`,
      );
    } else {
      const previous = caseNumberTemplates.get(template);
      if (previous !== undefined) {
        add(source.file, taskId, `${base}.caseNumberTemplate`, `案號樣板 ${template} 已由稽核 ${previous} 使用；同一筆紀錄在不同稽核會撞號`);
      } else caseNumberTemplates.set(template, auditId ?? taskId ?? base);
    }
    if (auditId !== null) {
      audits.set(auditId, { file: source.file, taskId, base, day: dayNumber, notifyDayId, reviewTask });
    }
  };

  /*
   * ---- 字串掃描：可執行內容與樣板 placeholder ----
   * `rule` 回傳某路徑的專用 placeholder 規則（R12：郵件模板、入職 loggingIn 不是 *Template 欄位）；
   * 沒有專用規則時沿用 *Template／TEMPLATE_FIELDS 的檢查。
   */
  const scanStrings = (
    source: ContentSource,
    node: unknown,
    path: string,
    id: string | null,
    rule?: (path: string) => PlaceholderRule | undefined,
  ): void => {
    if (typeof node === 'string') {
      for (const f of FORBIDDEN_FRAGMENTS) {
        if (node.includes(f.fragment)) add(source.file, id, path, `${f.message}（發現 \`${f.fragment}\`）`);
      }
      const key = path.split('.').pop() ?? path;
      const custom = rule?.(path);
      if (custom !== undefined) checkPlaceholders(source, id, path, node, custom.allowed, custom.required, add);
      else if (key.endsWith('Template')) checkTemplate(source, id, path, key, node, add);
      else if (node.includes('{')) add(source.file, id, path, '只有 *Template 欄位可以使用 {…} placeholder');
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => scanStrings(source, v, `${path}[${i}]`, id, rule));
      return;
    }
    if (isObj(node)) {
      const own = node['id'];
      const nextId = typeof own === 'string' ? own : id;
      for (const key of Object.keys(node)) {
        scanStrings(source, node[key], join(path, key), nextId, rule);
      }
    }
  };

  /**
   * 一則訊息（每日檔 messages，或 R12 詢問說明包的 messages）：ID、頻道、作者、時間、visibleFrom、unlock 條件、
   * unlockAfter、lines、replyPrompt 與 variant。`token` 是 ID 須含的識別（dayN／help）；
   * `helpOwner` 是說明訊息所屬的提問 ID（每日訊息為 null），`cond.help.*` 只能用在自己提問的說明訊息。
   * 回傳訊息 ID（格式錯誤時為 null）。
   */
  const checkMessage = (
    source: ContentSource,
    token: IdToken,
    raw: Record<string, unknown>,
    field: string,
    variantSeen: Map<string, string>,
    helpOwner: string | null,
  ): string | null => {
    const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.message);
    requireIdToken(source, id, `${field}.id`, token);
    ref(source, id, `${field}.channelId`, 'channel', raw['channelId']);
    ref(source, id, `${field}.actorId`, 'actor', raw['actorId']);
    checkTime(source, id, `${field}.time`, raw['time']);
    const visibleFrom = raw['visibleFrom'];
    if (typeof visibleFrom !== 'string' || visibleFrom === '') {
      add(
        source.file,
        id,
        `${field}.visibleFrom`,
        `缺少必要欄位 visibleFrom（從哪一天起可見的 day ID），得到 ${typeName(visibleFrom)}`,
      );
    } else ref(source, id, `${field}.visibleFrom`, 'day', visibleFrom);
    const unlock = raw['unlock'];
    if (!Array.isArray(unlock)) {
      add(source.file, id, `${field}.unlock`, `需要條件 ID 陣列，得到 ${typeName(unlock)}`);
    } else {
      const ownPrompt = raw['replyPrompt'];
      const ownPromptId = isObj(ownPrompt) ? ownPrompt['id'] : undefined;
      unlock.forEach((cond, n) => {
        const chat = typeof cond === 'string' ? parseChatCondition(cond) : null;
        if (chat !== null) {
          chatRefs.push({ file: source.file, id, field: `${field}.unlock[${n}]`, ...chat, visibleFrom, ownPromptId });
          return;
        }
        const decided = typeof cond === 'string' ? parseCaseCondition(cond) : null;
        if (decided !== null) {
          caseRefs.push({ file: source.file, id, field: `${field}.unlock[${n}]`, ...decided, visibleFrom });
          return;
        }
        const review = typeof cond === 'string' ? parseReviewCondition(cond) : null;
        if (review !== null) {
          reviewRefs.push({ file: source.file, id, field: `${field}.unlock[${n}]`, batchId: review.batchId, visibleFrom });
          return;
        }
        const returned = typeof cond === 'string' ? parseReturnCondition(cond) : null;
        if (returned !== null) {
          returnRefs.push({ file: source.file, id, field: `${field}.unlock[${n}]`, auditId: returned.auditId, visibleFrom });
          return;
        }
        const help = typeof cond === 'string' ? parseHelpCondition(cond) : null;
        if (help !== null) {
          helpRefs.push({ file: source.file, id, field: `${field}.unlock[${n}]`, cond: String(cond), requestId: help.requestId, owner: helpOwner });
          return;
        }
        if (isConditionId(cond)) return;
        const retired =
          typeof cond === 'string' ? RETIRED_CONDITION_PREFIXES.find((r) => cond.startsWith(r.prefix)) : undefined;
        if (retired !== undefined) {
          add(source.file, id, `${field}.unlock[${n}]`, `條件 ${String(cond)} 已停用：${retired.hint}`);
        } else {
          const hint =
            typeof cond === 'string' && cond.startsWith('cond.review.')
              ? '；覆核條件格式為 cond.review.any|none.<batch ID>'
              : typeof cond === 'string' && cond.startsWith(CHAT_CONDITION_PREFIX)
                ? '；聊天條件格式為 cond.chat.<prompt ID 去掉 prompt.>.<choice ID>'
                : typeof cond === 'string' && cond.startsWith(CASE_CONDITION_PREFIX)
                  ? '；案件條件格式為 cond.case.<case ID 去掉 case.>.<decision ID>'
                  : typeof cond === 'string' && cond.startsWith('cond.return.')
                    ? `；退件條件格式為 ${RETURN_CONDITION_PREFIX}<audit ID>`
                    : typeof cond === 'string' && cond.startsWith(HELP_CONDITION_PREFIX)
                      ? `；詢問條件格式為 ${HELP_CONDITION_PREFIX}<request ID 去掉 request.>.requested`
                      : '';
          add(
            source.file,
            id,
            `${field}.unlock[${n}]`,
            `未知的條件 ID ${String(cond)}（白名單見 content/conditions.ts）${hint}`,
          );
        }
      });
    }
    checkUnlockAfter(source, id, field, raw['unlockAfter'], visibleFrom);
    requireStringArray(source, id, `${field}.lines`, raw['lines'], add);
    checkActions(source, id, `${field}.actions`, raw['actions'], add);
    checkReplyPrompt(source, token, id, field, raw, visibleFrom);
    const variant = raw['variant'];
    if (variant !== undefined) {
      if (!isObj(variant)) {
        add(source.file, id, `${field}.variant`, `需要物件，得到 ${typeName(variant)}`);
      } else {
        const key = variant['key'];
        const value = variant['value'];
        if (typeof key !== 'string' || !(VARIANT_KEYS as readonly string[]).includes(key)) {
          add(source.file, id, `${field}.variant.key`, `未知的變體來源 ${String(key)}`);
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          add(source.file, id, `${field}.variant.value`, `需要 0 以上的整數，得到 ${typeName(value)}`);
        }
        if (typeof key === 'string' && typeof value === 'number') {
          const slot = `${String(raw['channelId'])}|${key}|${value}`;
          const previous = variantSeen.get(slot);
          if (previous !== undefined) {
            add(source.file, id, `${field}.variant`, `同一頻道的 ${key}=${value} 已由 ${previous} 使用`);
          } else variantSeen.set(slot, id ?? field);
        }
      }
    }
    return id;
  };

  /* ---------- R12 內容包 ---------- */

  /** 非空字串（完整路徑版的 requireString：值已取出，錯誤路徑直接用 `path`）。 */
  const textAt = (source: ContentSource, id: string | null, value: unknown, path: string): string | null => {
    if (typeof value !== 'string') {
      add(source.file, id, path, `缺少必要欄位或型別錯誤：需要 string，得到 ${typeName(value)}`);
      return null;
    }
    if (value === '') {
      add(source.file, id, path, '不得為空字串');
      return null;
    }
    return value;
  };

  /** 嚴格欄位白名單；`allowNote` 時另外允許 `note`。 */
  const onlyKeys = (
    source: ContentSource,
    id: string | null,
    node: Record<string, unknown>,
    base: string,
    allowed: readonly string[],
    what: string,
    allowNote = true,
  ): void => {
    for (const [, path] of extraKeys(node, base, allowed, allowNote)) {
      add(source.file, id, path, `不在${what}內的欄位（只允許 ${allowed.join('、')}${allowNote ? '，以及 note' : ''}）`);
    }
  };

  /** `integration`：接線說明物件，值只能是非空字串或非空字串陣列；不會顯示給玩家。 */
  const checkNotes = (source: ContentSource, id: string | null, value: unknown, base: string): void => {
    if (!isObj(value)) {
      add(source.file, id, base, `integration 必須是說明物件（值為字串或字串陣列），得到 ${typeName(value)}`);
      return;
    }
    for (const [key, note] of Object.entries(value)) {
      const path = join(base, key);
      if (Array.isArray(note)) requireStringArray(source, id, path, note, add);
      else if (typeof note !== 'string') add(source.file, id, path, `integration 的值只能是字串或字串陣列，得到 ${typeName(note)}`);
      else if (note === '') add(source.file, id, path, '不得為空字串');
    }
  };

  /** 內容包的共同檢查：頂層欄位白名單、schemaVersion、可選的 integration。 */
  const checkPackHeader = (
    source: ContentSource,
    id: string | null,
    data: Record<string, unknown>,
    allowed: readonly string[],
    what: string,
  ): void => {
    onlyKeys(source, id, data, '', allowed, what);
    const version = data['schemaVersion'];
    if (version !== CONTENT_PACK_SCHEMA_VERSION) {
      add(
        source.file,
        id,
        'schemaVersion',
        `schemaVersion 必須是 ${CONTENT_PACK_SCHEMA_VERSION}，得到 ${typeof version === 'number' ? String(version) : typeName(version)}`,
      );
    }
    if (data['integration'] !== undefined) checkNotes(source, id, data['integration'], 'integration');
  };

  /**
   * 郵件包（data/mail/*.json）：寄件者、剛好 returned／resolved 兩個模板（主旨／內文／附件名只可用
   * {caseNumber}／{versionLabel}／{reason}）、郵件介面字（revisionTemplate 由 TEMPLATE_FIELDS 要求 {revision}）。
   */
  const checkMailPack = (source: ContentSource): void => {
    const data = source.data;
    if (!isObj(data)) {
      add(source.file, null, '(root)', `內容必須是物件，得到 ${typeName(data)}`);
      return;
    }
    scanStrings(source, data, '', null, (path) => (path.startsWith('templates.') ? MAIL_TEMPLATE_RULE : undefined));
    const packId = takeId(source, data['id'], 'id', ID_PREFIX.mail);
    if (packId !== null) mailPackIds.add(packId);
    checkPackHeader(source, packId, data, MAIL_PACK_KEYS, '郵件包');

    /* sender：`sender.` 前綴的 ID 與顯示名稱；同一寄件者在不同包的名稱一致 */
    const sender = data['sender'];
    if (!isObj(sender)) {
      add(source.file, packId, 'sender', `需要物件，得到 ${typeName(sender)}`);
    } else {
      onlyKeys(source, packId, sender, 'sender', ['id', 'name'], '寄件者', false);
      const senderId = textAt(source, packId, sender['id'], 'sender.id');
      const name = textAt(source, packId, sender['name'], 'sender.name');
      if (senderId !== null) {
        if (!senderId.startsWith(ID_PREFIX.sender)) add(source.file, packId, 'sender.id', `ID 必須以 \`${ID_PREFIX.sender}\` 開頭`);
        if (!ID_PATTERN.test(senderId)) add(source.file, packId, 'sender.id', 'ID 只能使用小寫英數、`-` 與 `.`');
        const previous = mailSenders.get(senderId);
        if (previous === undefined) mailSenders.set(senderId, { name, file: source.file });
        else if (name !== null && previous.name !== null && previous.name !== name) {
          add(source.file, packId, 'sender.name', `寄件者 ${senderId} 在 ${previous.file} 的名稱是 ${String(previous.name)}；同一寄件者名稱必須一致`);
        }
      }
    }

    /* templates：剛好 returned／resolved（模板 ID＝回條種類） */
    const templates = data['templates'];
    if (!isObj(templates)) {
      add(source.file, packId, 'templates', `需要物件，得到 ${typeName(templates)}`);
    } else {
      onlyKeys(source, packId, templates, 'templates', ISSUE_RECEIPT_KINDS, '模板（模板 ID＝回條種類）', false);
      for (const kind of ISSUE_RECEIPT_KINDS) {
        const base = `templates.${kind}`;
        const template = templates[kind];
        if (!isObj(template)) {
          add(source.file, packId, base, `缺少模板 ${kind} 或型別錯誤：需要物件，得到 ${typeName(template)}`);
          continue;
        }
        onlyKeys(source, packId, template, base, MAIL_TEMPLATE_KEYS, '郵件模板', false);
        textAt(source, packId, template['subject'], `${base}.subject`);
        requireStringArray(source, packId, `${base}.lines`, template['lines'], add);
        textAt(source, packId, template['attachmentLabel'], `${base}.attachmentLabel`);
      }
    }

    checkShape(source, packId, data['ui'], 'ui', MAIL_UI_SHAPE, true);
  };

  /**
   * M1 工作日內容包（data/workday/*.json）：延後回條（寄件者、模板只有主旨與內文、計畫的觸發條件引用存在的
   * 案件／任務且送達日晚於工作所屬日）、每日離班／到班短文、介面字（WORKDAY_UI_SHAPE）。
   * 需要日檔的任務與案件登記，因此在日檔之後檢查。
   */
  const checkWorkday = (source: ContentSource): void => {
    const data = source.data;
    if (!isObj(data)) {
      add(source.file, null, '(root)', `內容必須是物件，得到 ${typeName(data)}`);
      return;
    }
    scanStrings(source, data, '', null, (path) => (path === 'ui.legendTemplate' ? LEGEND_RULE : undefined));
    const packId = takeId(source, data['id'], 'id', ID_PREFIX.workday);
    checkPackHeader(source, packId, data, WORKDAY_KEYS, '工作日內容包');

    const mail = data['mail'];
    if (!isObj(mail)) add(source.file, packId, 'mail', `需要物件，得到 ${typeName(mail)}`);
    else {
      onlyKeys(source, packId, mail, 'mail', WORKDAY_MAIL_KEYS, '回條設定', false);
      const mailPackId = textAt(source, packId, mail['packId'], 'mail.packId');
      if (mailPackId !== null) {
        if (!mailPackId.startsWith(ID_PREFIX.mail)) add(source.file, packId, 'mail.packId', `ID 必須以 \`${ID_PREFIX.mail}\` 開頭`);
        if (mailPackIds.has(mailPackId)) add(source.file, packId, 'mail.packId', `${mailPackId} 已是 data/mail/ 的郵件包`);
      }
      const sender = mail['sender'];
      if (!isObj(sender)) add(source.file, packId, 'mail.sender', `需要物件，得到 ${typeName(sender)}`);
      else {
        onlyKeys(source, packId, sender, 'mail.sender', ['id', 'name'], '寄件者', false);
        const senderId = textAt(source, packId, sender['id'], 'mail.sender.id');
        const name = textAt(source, packId, sender['name'], 'mail.sender.name');
        if (senderId !== null) {
          if (!senderId.startsWith(ID_PREFIX.sender)) add(source.file, packId, 'mail.sender.id', `ID 必須以 \`${ID_PREFIX.sender}\` 開頭`);
          const previous = mailSenders.get(senderId);
          if (previous === undefined) mailSenders.set(senderId, { name, file: source.file });
          else if (name !== null && previous.name !== null && previous.name !== name) {
            add(source.file, packId, 'mail.sender.name', `寄件者 ${senderId} 在 ${previous.file} 的名稱是 ${String(previous.name)}；同一寄件者名稱必須一致`);
          }
        }
      }
      const templates = mail['templates'];
      const templateIds = new Set<string>();
      if (!isObj(templates)) add(source.file, packId, 'mail.templates', `需要物件，得到 ${typeName(templates)}`);
      else {
        for (const [key, template] of Object.entries(templates)) {
          const base = `mail.templates.${key}`;
          if (!CHOICE_ID_PATTERN.test(key)) add(source.file, packId, base, '模板 ID 只能使用小寫英數與 `-`');
          if (!isObj(template)) {
            add(source.file, packId, base, `需要物件，得到 ${typeName(template)}`);
            continue;
          }
          templateIds.add(key);
          onlyKeys(source, packId, template, base, ['subject', 'lines'], '回條模板', false);
          textAt(source, packId, template['subject'], `${base}.subject`);
          requireStringArray(source, packId, `${base}.lines`, template['lines'], add);
        }
      }
      const outcomes = mail['outcomes'];
      if (!Array.isArray(outcomes) || outcomes.length === 0) add(source.file, packId, 'mail.outcomes', `需要非空陣列，得到 ${typeName(outcomes)}`);
      else {
        outcomes.forEach((raw, i) => {
          const base = `mail.outcomes[${i}]`;
          if (!isObj(raw)) {
            add(source.file, packId, base, `需要物件，得到 ${typeName(raw)}`);
            return;
          }
          onlyKeys(source, packId, raw, base, WORKDAY_OUTCOME_KEYS, '回條計畫');
          const id = takeId(source, raw['id'], `${base}.id`, ID_PREFIX.mail);
          const templateId = raw['templateId'];
          if (typeof templateId !== 'string' || !templateIds.has(templateId)) add(source.file, id, `${base}.templateId`, `找不到模板 ${String(templateId)}`);
          const dayId = raw['dayId'];
          const day = typeof dayId === 'string' ? dayNumberOf.get(dayId) : undefined;
          if (day === undefined) add(source.file, id, `${base}.dayId`, `找不到日別 ${String(dayId)}`);
          else requireDayToken(source, id, `${base}.id`, day);
          if (typeof raw['ordinary'] !== 'boolean') add(source.file, id, `${base}.ordinary`, `需要 boolean，得到 ${typeName(raw['ordinary'])}`);
          const trigger = raw['trigger'];
          if (!isObj(trigger)) {
            add(source.file, id, `${base}.trigger`, `需要物件，得到 ${typeName(trigger)}`);
            return;
          }
          const kind = trigger['kind'];
          if (!WORKDAY_TRIGGER_KINDS.includes(kind as never)) {
            add(source.file, id, `${base}.trigger.kind`, `kind 必須是 ${WORKDAY_TRIGGER_KINDS.join('／')}，得到 ${String(kind)}`);
            return;
          }
          const targetKey = kind === 'case-decided' ? 'caseId' : 'taskId';
          const allowed = kind === 'batch-delivered' ? ['kind', 'taskId', 'attachmentTaskId'] : ['kind', targetKey];
          onlyKeys(source, id, trigger, `${base}.trigger`, allowed, '觸發條件', false);
          const target = trigger[targetKey];
          const wantKind = kind === 'attachment-mismatch' || kind === 'attachment-submitted' ? 'attachment' : 'transform';
          let targetDay: number | null | undefined;
          if (kind === 'case-decided') {
            const c = typeof target === 'string' ? cases.get(target) : undefined;
            if (!c) add(source.file, id, `${base}.trigger.caseId`, `找不到案件 ${String(target)}`);
            targetDay = c?.day;
          } else {
            const info = typeof target === 'string' ? taskInfo.get(target) : undefined;
            if (info?.kind !== wantKind) add(source.file, id, `${base}.trigger.taskId`, `必須是 ${wantKind} 任務，得到 ${String(target)}`);
            targetDay = info?.day;
          }
          if (kind === 'batch-delivered' && trigger['attachmentTaskId'] !== undefined) {
            const att = trigger['attachmentTaskId'];
            if (typeof att !== 'string' || taskInfo.get(att)?.kind !== 'attachment') {
              add(source.file, id, `${base}.trigger.attachmentTaskId`, `必須是 attachment 任務，得到 ${String(att)}`);
            }
          }
          if (day !== undefined && targetDay !== undefined && targetDay !== null && targetDay >= day) {
            add(source.file, id, `${base}.dayId`, `回條送達日必須晚於工作所屬日（第 ${targetDay} 日）`);
          }
        });
      }
    }

    const interludes = data['interludes'];
    if (!Array.isArray(interludes)) add(source.file, packId, 'interludes', `需要陣列，得到 ${typeName(interludes)}`);
    else {
      const seen = new Set<string>();
      interludes.forEach((raw, i) => {
        const base = `interludes[${i}]`;
        if (!isObj(raw)) {
          add(source.file, packId, base, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        onlyKeys(source, packId, raw, base, WORKDAY_INTERLUDE_KEYS, '離班／到班短文');
        const after = raw['afterDay'];
        if (typeof after !== 'string' || !dayNumberOf.has(after)) add(source.file, packId, `${base}.afterDay`, `找不到日別 ${String(after)}`);
        else if (seen.has(after)) add(source.file, packId, `${base}.afterDay`, `${after} 重複`);
        else {
          seen.add(after);
          // beforeDay＝null 表示沒有到班短文（最後一日，或新增日別尚未補上）；有填時必須是下一日
          const expected = nextDayOf.get(after) ?? null;
          if (raw['beforeDay'] !== null && raw['beforeDay'] !== expected) {
            add(source.file, packId, `${base}.beforeDay`, `必須是 ${after} 的下一日（${String(expected)}）或 null`);
          }
        }
        requireStringArray(source, packId, `${base}.leave`, raw['leave'], add);
        if (raw['beforeDay'] === null) {
          if (!Array.isArray(raw['arrive']) || raw['arrive'].some((x) => typeof x !== 'string' || x === '')) {
            add(source.file, packId, `${base}.arrive`, '最後一日的 arrive 需要字串陣列（可為空）');
          }
        } else requireStringArray(source, packId, `${base}.arrive`, raw['arrive'], add);
      });
    }

    checkShape(source, packId, data['ui'], 'ui', WORKDAY_UI_SHAPE, true);
  };

  /**
   * 入職前情包（data/onboarding/*.json）：呈現設定、段落（ID 唯一、剛好一個合約且不在頭尾、簽名上限＝PLAYER_NAME_MAX）
   * 與介面字（loggingIn 必須且只能用 {playerName}）。
   */
  const checkOnboarding = (source: ContentSource): void => {
    const data = source.data;
    if (!isObj(data)) {
      add(source.file, null, '(root)', `內容必須是物件，得到 ${typeName(data)}`);
      return;
    }
    scanStrings(source, data, '', null, (path) => (path === 'ui.loggingIn' ? LOGGING_IN_RULE : undefined));
    const packId = takeId(source, data['id'], 'id', ID_PREFIX.onboarding);
    checkPackHeader(source, packId, data, ONBOARDING_KEYS, '入職包');

    /* presentation */
    const presentation = data['presentation'];
    if (!isObj(presentation)) {
      add(source.file, packId, 'presentation', `需要物件，得到 ${typeName(presentation)}`);
    } else {
      onlyKeys(source, packId, presentation, 'presentation', ONBOARDING_PRESENTATION_KEYS, '呈現設定', false);
      for (const key of ['background', 'foreground'] as const) {
        const color = textAt(source, packId, presentation[key], `presentation.${key}`);
        if (color !== null && !HEX_COLOR_PATTERN.test(color)) {
          add(source.file, packId, `presentation.${key}`, `色碼必須是 #rrggbb，得到 ${color}`);
        }
      }
      const interval = presentation['characterIntervalMs'];
      if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1) {
        add(
          source.file,
          packId,
          'presentation.characterIntervalMs',
          `characterIntervalMs 必須是正整數（毫秒），得到 ${typeof interval === 'number' ? String(interval) : typeName(interval)}`,
        );
      }
      const modes = [
        ['advance', ONBOARDING_ADVANCE_MODES],
        ['reducedMotion', ONBOARDING_REDUCED_MOTION_MODES],
      ] as const;
      for (const [key, allowed] of modes) {
        const value = presentation[key];
        if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
          add(source.file, packId, `presentation.${key}`, `${key} 必須是 ${allowed.join('／')}，得到 ${String(value)}`);
        }
      }
    }

    /* steps：非空；ID 唯一且不含 `.`；剛好一個 contract，不在第一段或最後一段 */
    const steps = data['steps'];
    if (!Array.isArray(steps)) {
      add(source.file, packId, 'steps', `需要段落陣列，得到 ${typeName(steps)}`);
    } else if (steps.length === 0) {
      add(source.file, packId, 'steps', '不得為空陣列，至少需要一段');
    } else {
      const stepIds = new Set<string>();
      const contracts: number[] = [];
      steps.forEach((step, i) => {
        const base = `steps[${i}]`;
        if (!isObj(step)) {
          add(source.file, packId, base, `需要物件，得到 ${typeName(step)}`);
          return;
        }
        const rawId = step['id'];
        let stepId: string | null = null;
        if (typeof rawId !== 'string' || rawId === '') {
          add(source.file, packId, `${base}.id`, `段落 id 必須是非空字串，得到 ${typeName(rawId)}`);
        } else if (!CHOICE_ID_PATTERN.test(rawId)) {
          add(source.file, packId, `${base}.id`, `段落 id 只能使用小寫英數與 \`-\`，不得含 \`.\`（得到 ${rawId}）`);
        } else if (stepIds.has(rawId)) {
          add(source.file, packId, `${base}.id`, `段落 id ${rawId} 在同一入職包內重複`);
        } else {
          stepIds.add(rawId);
          stepId = rawId;
        }
        const owner = stepId ?? packId;
        const kind = step['kind'];
        if (kind === 'line') {
          onlyKeys(source, owner, step, base, ONBOARDING_LINE_KEYS, '旁白段落');
          textAt(source, owner, step['text'], `${base}.text`);
        } else if (kind === 'contract') {
          contracts.push(i);
          onlyKeys(source, owner, step, base, ONBOARDING_CONTRACT_KEYS, '合約段落');
          textAt(source, owner, step['heading'], `${base}.heading`);
          requireStringArray(source, owner, `${base}.clauses`, step['clauses'], add);
          textAt(source, owner, step['footer'], `${base}.footer`);
          const signature = step['signature'];
          const sb = `${base}.signature`;
          if (!isObj(signature)) {
            add(source.file, owner, sb, `需要物件，得到 ${typeName(signature)}`);
          } else {
            onlyKeys(source, owner, signature, sb, ONBOARDING_SIGNATURE_KEYS, '簽名欄', false);
            checkShape(source, owner, signature, sb, ONBOARDING_SIGNATURE_TEXT_SHAPE);
            const max = signature['maxGraphemes'];
            if (max !== PLAYER_NAME_MAX) {
              add(
                source.file,
                owner,
                `${sb}.maxGraphemes`,
                `maxGraphemes 必須等於角色名上限 ${PLAYER_NAME_MAX}（core 的 PLAYER_NAME_MAX），得到 ${typeof max === 'number' ? String(max) : typeName(max)}`,
              );
            }
          }
        } else {
          add(source.file, owner, `${base}.kind`, `kind 必須是 ${ONBOARDING_STEP_KINDS.join('／')}，得到 ${String(kind)}`);
        }
      });
      if (contracts.length !== 1) {
        add(source.file, packId, 'steps', `入職前情需要剛好一個 contract 段落，得到 ${contracts.length} 個`);
      } else if (contracts[0] === 0 || contracts[0] === steps.length - 1) {
        add(
          source.file,
          packId,
          `steps[${contracts[0]}].kind`,
          'contract 段落不得是第一段或最後一段（簽名前需要前情，簽名後需要歡迎段落）',
        );
      }
    }

    checkShape(source, packId, data['ui'], 'ui', ONBOARDING_UI_SHAPE, true);
  };

  /**
   * 詢問說明包（data/help/*.json）：提問（`request.` ID、既有 direct 頻道、unlockCondition 是自己的
   * `cond.help.*.requested`、playerText、oncePerSave 為 true）、入口文字與說明訊息。
   * 說明訊息走 checkMessage（與每日訊息同一套），另要求在提問頻道、作者是頻道成員、unlock 含提問條件。
   */
  const checkHelpPack = (source: ContentSource): void => {
    const data = source.data;
    if (!isObj(data)) {
      add(source.file, null, '(root)', `內容必須是物件，得到 ${typeName(data)}`);
      return;
    }
    scanStrings(source, data, '', null);
    const packId = takeId(source, data['id'], 'id', ID_PREFIX.help);
    checkPackHeader(source, packId, data, HELP_PACK_KEYS, '詢問說明包');

    /* request */
    let requestId: string | null = null;
    let channelId: string | null = null;
    let condition: string | null = null;
    const request = data['request'];
    if (!isObj(request)) {
      add(source.file, packId, 'request', `需要物件，得到 ${typeName(request)}`);
    } else {
      onlyKeys(source, packId, request, 'request', HELP_REQUEST_KEYS, '提問', false);
      requestId = takeId(source, request['id'], 'request.id', ID_PREFIX.request);
      if (requestId !== null) helpRequestIds.add(requestId);
      const owner = requestId ?? packId;
      const rawChannel = request['channelId'];
      ref(source, owner, 'request.channelId', 'channel', rawChannel);
      if (typeof rawChannel === 'string' && rawChannel !== '') {
        channelId = rawChannel;
        const kind = channelKinds.get(rawChannel);
        if (kind !== undefined && kind !== 'direct') {
          add(source.file, owner, 'request.channelId', `提問頻道必須是既有的 direct（私訊）頻道，${rawChannel} 是 ${String(kind)}`);
        }
      }
      // ID 格式錯誤時已在 request.id 指出，不再推導條件
      if (requestId !== null && requestId.startsWith(ID_PREFIX.request) && ID_PATTERN.test(requestId)) {
        condition = helpConditionId(requestId);
      }
      const rawCondition = textAt(source, owner, request['unlockCondition'], 'request.unlockCondition');
      if (rawCondition !== null && condition !== null && rawCondition !== condition) {
        add(source.file, owner, 'request.unlockCondition', `unlockCondition 必須是這個提問自己的詢問條件 ${condition}，得到 ${rawCondition}`);
      }
      textAt(source, owner, request['playerText'], 'request.playerText');
      if (request['oncePerSave'] !== true) {
        add(source.file, owner, 'request.oncePerSave', `oncePerSave 必須是 true（每份存檔只問一次），得到 ${String(request['oncePerSave'])}`);
      }
    }

    checkShape(source, packId, data['ui'], 'ui', HELP_UI_SHAPE, true);

    /* messages：非空；每則走 checkMessage，另檢查頻道、作者與 unlock */
    const messages = data['messages'];
    if (!Array.isArray(messages)) {
      add(source.file, packId, 'messages', `需要訊息陣列，得到 ${typeName(messages)}`);
      return;
    }
    if (messages.length === 0) {
      add(source.file, packId, 'messages', '不得為空陣列，至少需要一則說明訊息');
      return;
    }
    const helpOwner = requestId ?? (isObj(request) && typeof request['id'] === 'string' ? request['id'] : null);
    const variantSeen = new Map<string, string>();
    messages.forEach((raw, i) => {
      const field = `messages[${i}]`;
      if (!isObj(raw)) {
        add(source.file, packId, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const messageId = checkMessage(source, HELP_ID_TOKEN, raw, field, variantSeen, helpOwner);
      const owner = messageId ?? packId;
      onlyKeys(source, owner, raw, field, HELP_MESSAGE_KEYS, '說明訊息');
      const rawChannel = raw['channelId'];
      if (channelId !== null && typeof rawChannel === 'string' && rawChannel !== '' && rawChannel !== channelId) {
        add(source.file, owner, `${field}.channelId`, `說明訊息必須在提問頻道 ${channelId}，得到 ${rawChannel}`);
      }
      const actorId = raw['actorId'];
      const members = typeof rawChannel === 'string' ? channelMembers.get(rawChannel) : undefined;
      if (typeof actorId === 'string' && registry.actor.has(actorId) && members !== undefined && !members.includes(actorId)) {
        add(source.file, owner, `${field}.actorId`, `作者 ${actorId} 不是頻道 ${String(rawChannel)} 的成員（見 channels.json 的 actorIds）`);
      }
      const unlock = raw['unlock'];
      if (condition !== null && Array.isArray(unlock) && !unlock.includes(condition)) {
        add(source.file, owner, `${field}.unlock`, `說明訊息的 unlock 必須包含提問條件 ${condition}（提問送出後才解鎖）`);
      }
    });
  };

  /* ---- ui ---- */
  const ui = input.ui;
  const uiOk = isObj(ui.data);
  if (!uiOk) {
    add(ui.file, null, '(root)', `內容必須是物件，得到 ${typeName(ui.data)}`);
  } else {
    scanStrings(ui, ui.data, '', null);
    for (const path of UI_STRING_FIELDS) requireString(ui, 'ui', ui.data, path);
    ref(ui, 'ui', 'aside.colleagueActorId', 'actor', at(ui.data, 'aside.colleagueActorId'));
    checkShape(ui, 'ui', at(ui.data, 'progressLabel'), 'progressLabel', PROGRESS_LABEL_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'archive'), 'archive', ARCHIVE_UI_SHAPE, true, { ...FINISH_DAY_HINTS, ...SOURCE_FILL_HINTS });
    checkShape(ui, 'ui', at(ui.data, 'fieldMap'), 'fieldMap', FIELD_MAP_UI_SHAPE, true, { ...FIELD_MAP_UI_HINTS, ...FINISH_DAY_HINTS });
    checkShape(ui, 'ui', at(ui.data, 'tasks'), 'tasks', TASKS_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'handoff'), 'handoff', HANDOFF_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'morning'), 'morning', MORNING_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'executionLog'), 'executionLog', EXECUTION_LOG_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'caseReview'), 'caseReview', CASE_REVIEW_UI_SHAPE, true, SOURCE_FILL_HINTS);
    checkShape(ui, 'ui', at(ui.data, 'windowShell'), 'windowShell', WINDOW_SHELL_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'operation'), 'operation', OPERATION_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'windows'), 'windows', WINDOWS_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'recordReview'), 'recordReview', RECORD_REVIEW_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'returnedReview'), 'returnedReview', RETURNED_REVIEW_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'documentIssues'), 'documentIssues', DOCUMENT_ISSUES_UI_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'sourceCard'), 'sourceCard', SOURCE_CARD_UI_SHAPE, true, SOURCE_CARD_HINTS);
    checkShape(ui, 'ui', at(ui.data, 'recordStatus'), 'recordStatus', RECORD_STATUS_SHAPE, true);
    checkShape(ui, 'ui', at(ui.data, 'messages'), 'messages', MESSAGES_UI_SHAPE, true, MESSAGES_UI_HINTS);
    checkShape(ui, 'ui', at(ui.data, 'desktop'), 'desktop', DESKTOP_UI_SHAPE, true);
    for (const [path, hint] of WORKBENCH_REMOVED) {
      if (at(ui.data, path) !== undefined) add(ui.file, 'ui', path, hint);
    }
    if (at(ui.data, 'phaseLabel') !== undefined) {
      add(ui.file, 'ui', 'phaseLabel', 'phaseLabel 已移除，封面進度改用 progressLabel 的 work／wrap／morning／end 樣板');
    }
  }

  /* ---- actors ---- */
  const actors = input.actors;
  const actorList = isObj(actors.data) ? actors.data['actors'] : undefined;
  if (!Array.isArray(actorList)) {
    add(actors.file, null, 'actors', `需要陣列，得到 ${typeName(actorList)}`);
  } else {
    scanStrings(actors, actors.data, '', null);
    actorList.forEach((raw, i) => {
      const field = `actors[${i}]`;
      if (!isObj(raw)) {
        add(actors.file, null, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const id = takeId(actors, raw['id'], `${field}.id`, ID_PREFIX.actor, 'actor');
      requireString(actors, id, raw, 'displayName');
    });
  }

  /* ---- channels ---- */
  const channels = input.channels;
  const channelList = isObj(channels.data) ? channels.data['channels'] : undefined;
  if (!Array.isArray(channelList)) {
    add(channels.file, null, 'channels', `需要陣列，得到 ${typeName(channelList)}`);
  } else {
    scanStrings(channels, channels.data, '', null);
    channelList.forEach((raw, i) => {
      const field = `channels[${i}]`;
      if (!isObj(raw)) {
        add(channels.file, null, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const id = takeId(channels, raw['id'], `${field}.id`, ID_PREFIX.channel, 'channel');
      const kind = raw['kind'];
      if (id !== null && !channelKinds.has(id)) channelKinds.set(id, kind);
      if (typeof kind !== 'string' || !(CHANNEL_KINDS as readonly string[]).includes(kind)) {
        add(channels.file, id, `${field}.kind`, `kind 必須是 ${CHANNEL_KINDS.join('／')}，得到 ${String(kind)}`);
      }
      const actorIds = raw['actorIds'];
      refList(channels, id, `${field}.actorIds`, 'actor', actorIds, false);
      if (id !== null && Array.isArray(actorIds)) {
        channelMembers.set(id, actorIds.filter((a): a is string => typeof a === 'string'));
      }
      if (kind === 'direct') {
        if (Array.isArray(actorIds) && actorIds.length !== 1) {
          add(channels.file, id, `${field}.actorIds`, 'direct 頻道必須剛好一位對象');
        }
        if (raw['title'] !== undefined) {
          add(channels.file, id, `${field}.title`, 'direct 頻道不填 title，標題取自對方的 displayName');
        }
        if (raw['topic'] !== undefined) {
          add(channels.file, id, `${field}.topic`, 'direct 頻道不填 topic，header 顯示對方姓名與狀態');
        }
      } else if (kind === 'department' || kind === 'group') {
        for (const key of ['title', 'topic'] as const) {
          const value = raw[key];
          if (typeof value !== 'string' || value === '') {
            add(channels.file, id, `${field}.${key}`, `${kind} 頻道必須有非空的 ${key}，得到 ${value === '' ? '空字串' : typeName(value)}`);
          }
        }
      }
    });
  }

  /* ---- bulletins ---- */
  const bulletins = input.bulletins;
  const bulletinList = isObj(bulletins.data) ? bulletins.data['bulletins'] : undefined;
  if (!Array.isArray(bulletinList)) {
    add(bulletins.file, null, 'bulletins', `需要陣列，得到 ${typeName(bulletinList)}`);
  } else {
    scanStrings(bulletins, bulletins.data, '', null);
    bulletinList.forEach((raw, i) => {
      const field = `bulletins[${i}]`;
      if (!isObj(raw)) {
        add(bulletins.file, null, field, `需要物件，得到 ${typeName(raw)}`);
        return;
      }
      const id = takeId(bulletins, raw['id'], `${field}.id`, ID_PREFIX.bulletin);
      requireString(bulletins, id, raw, 'title');
      requireStringArray(bulletins, id, `${field}.body`, raw['body'], add);
    });
  }

  /* ---- days：第一遍先登記 day ID，讓 nextDayId／visibleFrom 可以跨檔引用 ---- */
  const seenDayNumbers = new Map<number, string>();
  const dayNumbers: number[] = [];
  const dayIdOf = new Map<ContentSource, string | null>();
  for (const source of input.days) {
    const data = source.data;
    if (!isObj(data)) {
      add(source.file, null, '(root)', `內容必須是物件，得到 ${typeName(data)}`);
      dayIdOf.set(source, null);
      continue;
    }
    dayIdOf.set(source, takeId(source, data['id'], 'id', ID_PREFIX.day, 'day'));
  }

  for (const source of input.days) {
    const data = source.data;
    if (!isObj(data)) continue;
    const dayId = dayIdOf.get(source) ?? null;
    scanStrings(source, data, '', null);

    /* day 數字：整數、不重複、與 day.NN 一致 */
    let dayNumber: number | null = null;
    const rawDay = data['day'];
    if (typeof rawDay !== 'number' || !Number.isInteger(rawDay) || rawDay < 1) {
      add(source.file, dayId, 'day', `day 必須是 1 以上的整數，得到 ${typeName(rawDay)}`);
    } else {
      dayNumber = rawDay;
      const previous = seenDayNumbers.get(rawDay);
      if (previous !== undefined) add(source.file, dayId, 'day', `第 ${rawDay} 天已在 ${previous} 定義`);
      else {
        seenDayNumbers.set(rawDay, source.file);
        dayNumbers.push(rawDay);
      }
    }
    if (dayId !== null) {
      const fromId = parseDayId(dayId);
      if (Number.isNaN(fromId)) {
        add(source.file, dayId, 'id', '每日 ID 必須是 `day.` 加至少兩位數字，例如 day.01');
      } else if (dayNumber !== null && fromId !== dayNumber) {
        add(source.file, dayId, 'day', `day 數字 ${dayNumber} 與 ID ${dayId}（第 ${fromId} 天）不一致`);
      }
      if (dayNumber !== null) dayNumberOf.set(dayId, dayNumber);
    }

    /* nextDayId：null 或存在的 day ID，且不是自己 */
    const nextDayId = data['nextDayId'];
    if (nextDayId === undefined) {
      add(source.file, dayId, 'nextDayId', '缺少必要欄位 nextDayId（最後一日填 null）');
    } else if (nextDayId !== null) {
      if (typeof nextDayId !== 'string' || nextDayId === '') {
        add(source.file, dayId, 'nextDayId', `nextDayId 必須是 day ID 或 null，得到 ${typeName(nextDayId)}`);
      } else if (nextDayId === dayId) {
        add(source.file, dayId, 'nextDayId', 'nextDayId 不得指向自己');
      } else ref(source, dayId, 'nextDayId', 'day', nextDayId);
    }
    if (dayId !== null && (nextDayId === null || (typeof nextDayId === 'string' && nextDayId !== ''))) {
      nextDayOf.set(dayId, nextDayId);
    }
    /** 轉場種類：有下一日→wrap；null→end；nextDayId 本身有錯時不再連帶檢查轉場形狀。 */
    const transitionKind: 'wrap' | 'end' | null =
      typeof nextDayId === 'string' && nextDayId !== '' ? 'wrap' : nextDayId === null ? 'end' : null;

    checkShape(source, dayId, data, '', DAY_TEXT_SHAPE);

    /* records */
    const records = data['records'];
    if (!Array.isArray(records)) {
      add(source.file, dayId, 'records', `需要陣列，得到 ${typeName(records)}`);
    } else {
      records.forEach((raw, i) => {
        const field = `records[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.record, 'record');
        const key = raw['key'];
        if (typeof key !== 'string' || key === '') {
          add(source.file, id, `${field}.key`, `存檔 key 必須是非空字串，得到 ${typeName(key)}`);
        } else {
          const previous = seenRecordKeys.get(key);
          if (previous !== undefined) add(source.file, id, `${field}.key`, `存檔 key ${key} 已在 ${previous} 使用`);
          else seenRecordKeys.set(key, source.file);
        }
        const code = raw['code'];
        if (typeof code !== 'string' || code === '') {
          add(
            source.file,
            id,
            `${field}.code`,
            `人員編號必須是字串（0102 等前導零不得寫成數字），得到 ${typeName(code)}`,
          );
        }
        const name = raw['name'];
        if (name !== null && typeof name !== 'string') {
          add(source.file, id, `${field}.name`, `name 必須是字串或 null，得到 ${typeName(name)}`);
        }
        const refusal = raw['refusal'];
        if (refusal !== null && typeof refusal !== 'boolean') {
          add(source.file, id, `${field}.refusal`, `refusal 必須是 boolean 或 null，得到 ${typeName(refusal)}`);
        }
        const applies = raw['refusalApplies'];
        if (typeof applies !== 'boolean') {
          add(source.file, id, `${field}.refusalApplies`, `refusalApplies 必須是 boolean，得到 ${typeName(applies)}`);
        } else if (!applies && refusal !== null) {
          add(source.file, id, `${field}.refusal`, '不適用拒絕紀錄時 refusal 必須是 null');
        }
      });
    }

    /* documents：依 kind 檢查 text */
    const documents = data['documents'];
    if (!Array.isArray(documents)) {
      add(source.file, dayId, 'documents', `需要陣列，得到 ${typeName(documents)}`);
    } else {
      documents.forEach((raw, i) => {
        const field = `documents[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.document, 'document');
        requireDayToken(source, id, `${field}.id`, dayNumber);
        const kind = raw['kind'];
        refList(source, id, `${field}.recordIds`, 'record', raw['recordIds'], true);
        if (id !== null && typeof kind === 'string' && !documentKind.has(id)) {
          documentKind.set(id, kind);
          if (Array.isArray(raw['recordIds'])) documentRecords.set(id, raw['recordIds'].filter((r): r is string => typeof r === 'string'));
        }
        switch (kind) {
          case 'report':
            checkShape(source, id, raw['text'], `${field}.text`, REPORT_DOCUMENT_TEXT_SHAPE, true);
            break;
          case 'receipt':
            checkShape(source, id, raw['text'], `${field}.text`, RECEIPT_DOCUMENT_TEXT_SHAPE, true);
            break;
          case 'case-source': {
            const values = checkCaseSourceText(source, id, raw['text'], `${field}.text`);
            if (id !== null && !caseSourceValues.has(id)) caseSourceValues.set(id, values);
            break;
          }
          default:
            add(source.file, id, `${field}.kind`, `kind 必須是 ${DOCUMENT_KINDS.join('／')}，得到 ${String(kind)}`);
        }
      });
    }

    /* tasks：每日至少一個、依陣列順序執行（R8）；依 kind 檢查 batch 欄位與 text */
    const tasks = data['tasks'];
    if (!Array.isArray(tasks)) {
      add(source.file, dayId, 'tasks', `需要陣列，得到 ${typeName(tasks)}`);
    } else {
      if (tasks.length === 0) {
        add(source.file, dayId, 'tasks', '每日至少需要一個可執行任務，得到 0 個');
      } else if (tasks.every((t) => isObj(t) && t['kind'] === 'return-review')) {
        // 退件複審只有真的有退件時才適用；一天不能只有它，否則沒有退件時當天會沒有工作可做（R10）
        add(source.file, dayId, 'tasks', '每日至少需要一個非 return-review 的任務（退件複審可能不適用）');
      }
      /** 同日 archive 批次 → 任務位置；reconcile 的同日來源必須排在前面（R9 §0）。 */
      const archiveIndex = new Map<string, number>();
      /** 當日第一個 return-review 任務的位置；錯誤文件處理每天只有一個位置（R11）。 */
      let issueTaskIndex: number | null = null;
      const reconcileSources: { index: number; id: string | null; batchId: string }[] = [];
      /** 當日的任務 ID；dependsOn 只能指向同一天的任務，且不得形成循環（M1）。 */
      const dayTaskIds = new Set(
        tasks.map((t) => (isObj(t) && typeof t['id'] === 'string' ? t['id'] : null)).filter((x): x is string => x !== null),
      );
      const dayDeps: { id: string | null; field: string; deps: ReadonlySet<string> }[] = [];
      tasks.forEach((raw, i) => {
        const field = `tasks[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        const id = takeId(source, raw['id'], `${field}.id`, ID_PREFIX.task);
        requireDayToken(source, id, `${field}.id`, dayNumber);
        const kind = raw['kind'];
        /* dependsOn（M1）：可省略；同日、排在前面、不重複 */
        const dependsOn = new Set<string>();
        if (raw['dependsOn'] !== undefined) {
          if (!Array.isArray(raw['dependsOn'])) {
            add(source.file, id, `${field}.dependsOn`, `需要任務 ID 陣列，得到 ${typeName(raw['dependsOn'])}`);
          } else {
            raw['dependsOn'].forEach((dep, d) => {
              const path = `${field}.dependsOn[${d}]`;
              if (typeof dep !== 'string' || dep === '') add(source.file, id, path, `需要任務 ID，得到 ${typeName(dep)}`);
              else if (dependsOn.has(dep)) add(source.file, id, path, `重複的依賴 ${dep}`);
              else if (dep === id) add(source.file, id, path, '不能依賴自己');
              else if (!dayTaskIds.has(dep)) add(source.file, id, path, `依賴 ${dep} 必須是同一天的任務`);
              else dependsOn.add(dep);
            });
          }
        }
        dayDeps.push({ id, field, deps: dependsOn });
        checkActions(source, id, `${field}.actions`, raw['actions'], add);
        if (kind !== 'archive' && raw['caseReview'] !== undefined) {
          add(source.file, id, `${field}.caseReview`, `只有 archive 任務可以有 caseReview（此任務是 ${String(kind)}）`);
        }
        const caseDocs =
          kind === 'archive'
            ? checkCaseReview(source, dayNumber, id, field, raw)
            : kind === 'attachment' || kind === 'transform'
              ? workdayDocuments(raw)
              : new Set<string>();
        if (id !== null && !taskInfo.has(id)) taskInfo.set(id, { kind, day: dayNumber, auditId: raw['auditId'] });
        if (kind !== 'reconcile' && raw['returnAudit'] !== undefined) {
          add(source.file, id, `${field}.returnAudit`, `只有 reconcile 任務可以有 returnAudit（此任務是 ${String(kind)}）`);
        }
        if (kind !== 'return-review' && raw['auditId'] !== undefined) {
          add(source.file, id, `${field}.auditId`, `只有 return-review 任務使用 auditId（此任務是 ${String(kind)}）`);
        }
        if (kind !== 'return-review' && id !== null && dayNumber !== null && id === issueTaskId(dayNumber)) {
          add(
            source.file,
            id,
            `${field}.id`,
            `任務 ID ${id} 保留給當日的錯誤文件處理（return-review；沒有內容定義時由狀態層以此 ID 插入），${String(kind)} 任務請改用別的 ID`,
          );
        }
        if (Array.isArray(raw['documentIds'])) {
          raw['documentIds'].forEach((doc, d) => {
            if (typeof doc === 'string') taskDocRefs.push({ file: source.file, id, field: `${field}.documentIds[${d}]`, documentId: doc, caseDocs });
          });
        }
        switch (kind) {
          case 'archive': {
            const batchId = takeId(source, raw['batchId'], `${field}.batchId`, ID_PREFIX.batch, 'batch');
            if (batchId !== null && !archiveIndex.has(batchId)) archiveIndex.set(batchId, i);
            if (batchId !== null && dayNumber !== null) batchDay.set(batchId, dayNumber);
            if (batchId !== null && Array.isArray(raw['recordIds'])) batchSize.set(batchId, raw['recordIds'].length);
            if (batchId !== null && Array.isArray(raw['recordIds'])) {
              for (const r of raw['recordIds']) {
                if (typeof r === 'string' && !recordArchive.has(r)) recordArchive.set(r, { taskId: id, batchId, day: dayNumber });
              }
            }
            if (raw['sourceBatchId'] !== undefined) {
              add(source.file, id, `${field}.sourceBatchId`, 'archive 任務定義自己的 batchId，不使用 sourceBatchId');
            }
            refList(source, id, `${field}.recordIds`, 'record', raw['recordIds'], true);
            refList(source, id, `${field}.documentIds`, 'document', raw['documentIds'], false);
            checkShape(source, id, raw['text'], `${field}.text`, ARCHIVE_TASK_TEXT_SHAPE, true, ARCHIVE_COMMON_HINTS);
            break;
          }
          case 'reconcile':
            if (typeof raw['sourceBatchId'] !== 'string' || raw['sourceBatchId'] === '') {
              add(
                source.file,
                id,
                `${field}.sourceBatchId`,
                `reconcile 任務必須以 sourceBatchId 指定要核對的批次，得到 ${typeName(raw['sourceBatchId'])}`,
              );
            } else {
              if (!raw['sourceBatchId'].startsWith(ID_PREFIX.batch)) {
                add(source.file, id, `${field}.sourceBatchId`, `ID 必須以 \`${ID_PREFIX.batch}\` 開頭`);
              }
              ref(source, id, `${field}.sourceBatchId`, 'batch', raw['sourceBatchId']);
              reconcileSources.push({ index: i, id, batchId: raw['sourceBatchId'] });
            }
            if (raw['batchId'] !== undefined) {
              add(source.file, id, `${field}.batchId`, 'reconcile 任務不定義新批次，請用 sourceBatchId 指向要核對的批次');
            }
            refList(source, id, `${field}.recordIds`, 'record', raw['recordIds'], false);
            refList(source, id, `${field}.documentIds`, 'document', raw['documentIds'], true);
            checkSubjectRecord(source, id, field, raw, add, (f, target) => ref(source, id, f, 'record', target));
            checkShape(source, id, raw['text'], `${field}.text`, RECONCILE_TASK_TEXT_SHAPE, true, RECONCILE_TEXT_HINTS);
            checkReturnAudit(source, dayNumber, id, field, raw['returnAudit']);
            break;
          case 'field-map':
            for (const key of ['batchId', 'sourceBatchId'] as const) {
              if (raw[key] !== undefined) {
                add(source.file, id, `${field}.${key}`, `field-map 任務不定義也不核對批次，不使用 ${key}`);
              }
            }
            refList(source, id, `${field}.recordIds`, 'record', raw['recordIds'], false);
            refList(source, id, `${field}.documentIds`, 'document', raw['documentIds'], false);
            checkFieldMap(source, id, field, raw, add);
            checkShape(source, id, raw['text'], `${field}.text`, FIELD_MAP_TASK_TEXT_SHAPE, true);
            if (id !== null) {
              const sourceFields = Array.isArray(raw['sourceFields']) ? raw['sourceFields'].filter(isObj) : [];
              const targetFields = Array.isArray(raw['targetFields']) ? raw['targetFields'].filter(isObj) : [];
              const rows = Array.isArray(raw['rows']) ? raw['rows'].filter(isObj) : [];
              fieldMapInfo.set(id, {
                day: dayNumber,
                sourceIds: new Set(sourceFields.map((f) => f['id']).filter((x): x is string => typeof x === 'string')),
                booleanSources: new Set(
                  targetFields.filter((t) => t['convert'] === 'boolean').map((t) => t['sourceId']).filter((x): x is string => typeof x === 'string'),
                ),
                rowIds: new Set(rows.map((r) => r['id']).filter((x): x is string => typeof x === 'string')),
                dynamic: raw['dynamic'] !== undefined,
              });
            }
            if (raw['dynamic'] !== undefined) {
              workdayTaskRefs.push({ file: source.file, id, field, kind: 'field-map', day: dayNumber, raw, dependsOn });
            }
            break;
          case 'attachment':
          case 'transform':
          case 'report': {
            for (const key of ['batchId', 'sourceBatchId'] as const) {
              if (raw[key] !== undefined) add(source.file, id, `${field}.${key}`, `${kind} 任務不定義也不核對批次，不使用 ${key}`);
            }
            refList(source, id, `${field}.recordIds`, 'record', raw['recordIds'], kind === 'attachment');
            refList(source, id, `${field}.documentIds`, 'document', raw['documentIds'], kind === 'attachment');
            const shape =
              kind === 'attachment' ? ATTACHMENT_TASK_TEXT_SHAPE : kind === 'transform' ? TRANSFORM_TASK_TEXT_SHAPE : REPORT_TASK_TEXT_SHAPE;
            checkShape(source, id, raw['text'], `${field}.text`, shape, true);
            workdayTaskRefs.push({ file: source.file, id, field, kind, day: dayNumber, raw, dependsOn });
            break;
          }
          case 'return-review': {
            for (const key of ['batchId', 'sourceBatchId'] as const) {
              if (raw[key] !== undefined) {
                add(source.file, id, `${field}.${key}`, `return-review 任務不定義也不核對批次，不使用 ${key}`);
              }
            }
            for (const [key, kindLabel] of [
              ['recordIds', 'record'],
              ['documentIds', 'document'],
            ] as const) {
              const list = raw[key];
              if (!Array.isArray(list)) {
                add(source.file, id, `${field}.${key}`, `需要${REF_LABEL[kindLabel]} ID 陣列（空陣列），得到 ${typeName(list)}`);
              } else if (list.length > 0) {
                add(
                  source.file,
                  id,
                  `${field}.${key}`,
                  `return-review 任務的 ${key} 必須是空陣列：處理對象是存檔排入當日的文件問題案件（得到 ${list.length} 項）`,
                );
              }
            }
            if (issueTaskIndex !== null) {
              add(
                source.file,
                id,
                `${field}.kind`,
                `每日最多一項 return-review 任務（錯誤文件處理每天只有一個位置，已有 tasks[${issueTaskIndex}]）`,
              );
            } else issueTaskIndex = i;
            /* auditId：R11 起可省略、不決定處理對象；有填時必須指向稽核，且稽核的 reviewTaskId 指回這裡 */
            const auditId = raw['auditId'];
            if (auditId === undefined) {
              // 省略：處理對象是存檔排入當日的文件問題案件
            } else if (typeof auditId !== 'string' || auditId === '') {
              add(source.file, id, `${field}.auditId`, `auditId 可省略；有填時必須是稽核 ID 字串，得到 ${auditId === '' ? '空字串' : typeName(auditId)}`);
            } else returnReviewRefs.push({ file: source.file, id, field: `${field}.auditId`, auditId });
            checkShape(source, id, raw['text'], `${field}.text`, RETURN_REVIEW_TASK_TEXT_SHAPE, true, RETURN_REVIEW_TEXT_HINTS);
            break;
          }
          default:
            add(source.file, id, `${field}.kind`, `kind 必須是 ${TASK_KINDS.join('／')}，得到 ${String(kind)}`);
        }
      });
      /* dependsOn 不得形成循環（否則當天有工作永遠無法開始） */
      const depsOf = new Map(dayDeps.filter((d) => d.id !== null).map((d) => [d.id as string, d.deps] as const));
      for (const d of dayDeps) {
        if (d.id === null) continue;
        const seen = new Set<string>();
        const stack = [...d.deps];
        while (stack.length > 0) {
          const next = stack.pop() as string;
          if (next === d.id) {
            add(source.file, d.id, `${d.field}.dependsOn`, '工作依賴形成循環，當天會有工作永遠無法開始');
            break;
          }
          if (seen.has(next)) continue;
          seen.add(next);
          for (const x of depsOf.get(next) ?? []) stack.push(x);
        }
      }
      for (const r of reconcileSources) {
        const owner = archiveIndex.get(r.batchId);
        if (owner !== undefined && owner > r.index) {
          add(
            source.file,
            r.id,
            `tasks[${r.index}].sourceBatchId`,
            `批次 ${r.batchId} 由同日第 ${owner + 1} 項 archive 任務建立，必須排在這項 reconcile（第 ${r.index + 1} 項）之前`,
          );
        }
      }
    }

    /* messages */
    const messages = data['messages'];
    if (!Array.isArray(messages)) {
      add(source.file, dayId, 'messages', `需要陣列，得到 ${typeName(messages)}`);
    } else {
      const variantSeen = new Map<string, string>();
      messages.forEach((raw, i) => {
        const field = `messages[${i}]`;
        if (!isObj(raw)) {
          add(source.file, dayId, field, `需要物件，得到 ${typeName(raw)}`);
          return;
        }
        checkMessage(source, dayIdToken(dayNumber), raw, field, variantSeen, null);
      });
    }

    /* transition：text 形狀由 nextDayId 決定 */
    const transition = data['transition'];
    if (!isObj(transition)) {
      add(source.file, dayId, 'transition', `需要物件，得到 ${typeName(transition)}`);
    } else {
      const id = takeId(source, transition['id'], 'transition.id', ID_PREFIX.transition);
      requireDayToken(source, id, 'transition.id', dayNumber);
      if (transitionKind !== null) {
        const shape = transitionKind === 'wrap' ? WRAP_TRANSITION_TEXT_SHAPE : END_TRANSITION_TEXT_SHAPE;
        const hints = transitionKind === 'wrap' ? WRAP_TRANSITION_HINTS : END_TRANSITION_HINTS;
        checkShape(source, id, transition['text'], 'transition.text', shape, true, hints);
      }
    }
  }

  /* ---- R12 內容包：郵件、入職、詢問說明（說明訊息的跨檔檢查與每日訊息一起在後段進行） ---- */
  for (const source of input.mail) checkMailPack(source);
  if (!mailPackIds.has(RETURN_RECEIPT_MAIL_PACK_ID)) {
    add(
      input.mail[0]?.file ?? 'data/mail/',
      null,
      'id',
      `缺少退件回條郵件包 ${RETURN_RECEIPT_MAIL_PACK_ID}（退件／收件回條的郵件以此 packId 引用）`,
    );
  }
  checkOnboarding(input.onboarding);
  for (const source of input.help) checkHelpPack(source);

  /* ---- ui.workbench.dayName：每一個存在的日別都要有日名 ---- */
  if (uiOk) {
    for (const n of dayNumbers) requireString(ui, 'ui', ui.data, `workbench.dayName.${n}`);
  }

  /* ---- cond.review.*：批次必須是 archive 批次，且所屬日早於訊息的 visibleFrom ---- */
  for (const r of reviewRefs) {
    const from = typeof r.visibleFrom === 'string' ? dayNumberOf.get(r.visibleFrom) : undefined;
    const owner = batchDay.get(r.batchId);
    if (!registry.batch.has(r.batchId)) {
      add(r.file, r.id, r.field, `找不到批次 ${r.batchId}（覆核條件只能引用 archive 任務的 batchId）`);
    } else if (owner !== undefined && from !== undefined && owner >= from) {
      add(
        r.file,
        r.id,
        r.field,
        `批次 ${r.batchId} 屬於第 ${owner} 天，必須早於訊息的 visibleFrom（第 ${from} 天）；當日批次的結果尚未確定`,
      );
    }
  }

  /* ---- unlockAfter：archive 批次、筆數不超過批次、批次所屬日不晚於訊息的 visibleFrom（R8 §4） ---- */
  for (const r of unlockAfterRefs) {
    const batchField = `${r.base}.archiveBatchId`;
    if (!registry.batch.has(r.batchId)) {
      add(r.file, r.id, batchField, `找不到批次 ${r.batchId}（unlockAfter 只能引用 archive 任務的 batchId）`);
      continue;
    }
    const size = batchSize.get(r.batchId);
    if (r.count !== null && size !== undefined && r.count > size) {
      add(
        r.file,
        r.id,
        `${r.base}.archivedCount`,
        `archivedCount ${r.count} 超過批次 ${r.batchId} 的筆數（${size} 筆），訊息永遠不會解鎖`,
      );
    }
    const from = typeof r.visibleFrom === 'string' ? dayNumberOf.get(r.visibleFrom) : undefined;
    const owner = batchDay.get(r.batchId);
    if (owner !== undefined && from !== undefined && owner > from) {
      add(
        r.file,
        r.id,
        batchField,
        `批次 ${r.batchId} 屬於第 ${owner} 天，晚於訊息的 visibleFrom（第 ${from} 天）；請引用同日或更早的批次`,
      );
    }
  }

  /* ---- replyPrompt：availableThrough 不早於 anchor 的 visibleFrom ---- */
  for (const r of promptRanges) {
    const from = typeof r.visibleFrom === 'string' ? dayNumberOf.get(r.visibleFrom) : undefined;
    const through = dayNumberOf.get(r.availableThrough);
    if (from !== undefined && through !== undefined && through < from) {
      add(
        r.file,
        r.id,
        r.field,
        `availableThrough ${r.availableThrough}（第 ${through} 天）不得早於 anchor 訊息的 visibleFrom（第 ${from} 天）`,
      );
    }
  }

  /* ---- replyPrompt：回應者必須是 anchor 頻道的成員（人物或頻道不存在時由引用檢查指出） ---- */
  for (const r of responseActors) {
    if (typeof r.actorId !== 'string' || !registry.actor.has(r.actorId)) continue;
    const members = typeof r.channelId === 'string' ? channelMembers.get(r.channelId) : undefined;
    if (members !== undefined && !members.includes(r.actorId)) {
      add(r.file, r.id, r.field, `回應者 ${r.actorId} 不是頻道 ${String(r.channelId)} 的成員（見 channels.json 的 actorIds）`);
    }
  }

  /* ---- cond.chat.*：prompt 與 choice 存在、不引用自己的 prompt、anchor 不晚於訊息的 visibleFrom ---- */
  for (const r of chatRefs) {
    const prompt = prompts.get(r.promptId);
    if (prompt === undefined) {
      add(r.file, r.id, r.field, `找不到 prompt ${r.promptId}（聊天條件只能引用訊息 replyPrompt 的 id）`);
      continue;
    }
    if (!prompt.choices.has(r.choiceId)) {
      add(r.file, r.id, r.field, `prompt ${r.promptId} 沒有 choice ${r.choiceId}（可用：${[...prompt.choices].join('、')}）`);
      continue;
    }
    if (r.ownPromptId === r.promptId) {
      add(r.file, r.id, r.field, `條件不得引用這則訊息自己的 prompt ${r.promptId}：回答前訊息不會解鎖，prompt 永遠無法回答`);
      continue;
    }
    const anchorFrom = typeof prompt.visibleFrom === 'string' ? dayNumberOf.get(prompt.visibleFrom) : undefined;
    const from = typeof r.visibleFrom === 'string' ? dayNumberOf.get(r.visibleFrom) : undefined;
    if (anchorFrom !== undefined && from !== undefined && anchorFrom > from) {
      add(
        r.file,
        r.id,
        r.field,
        `prompt ${r.promptId} 從第 ${anchorFrom} 天起才能回答，晚於訊息的 visibleFrom（第 ${from} 天）；請把訊息放在同日或之後`,
      );
    }
  }

  /* ---- caseReview 的文件：存在、case-source、在任務 documentIds 內、recordIds 含案件紀錄（R9） ---- */
  for (const r of caseDocRefs) {
    const kind = documentKind.get(r.documentId);
    if (!registry.document.has(r.documentId)) {
      add(r.file, r.id, r.field, `找不到文件 ${r.documentId}`);
    } else if (kind !== 'case-source') {
      add(r.file, r.id, r.field, `文件 ${r.documentId} 不是 case-source（是 ${String(kind)}）；比對案件只能引用 case-source 文件`);
    } else if (r.taskDocumentIds !== null && !r.taskDocumentIds.includes(r.documentId)) {
      add(r.file, r.id, r.field, `文件 ${r.documentId} 必須列在同一任務的 documentIds 內`);
    } else if (r.recordId !== null && !(documentRecords.get(r.documentId) ?? []).includes(r.recordId)) {
      add(r.file, r.id, r.field, `文件 ${r.documentId} 的 recordIds 必須包含案件紀錄 ${r.recordId}`);
    }
  }

  /* ---- 決定的預填 archiveCode 取自依據文件的欄位值（作者預設；玩家可改，依據文件本身的錯誤由上面指出） ---- */
  for (const r of archiveCodeRefs) {
    const values = caseSourceValues.get(r.basisDocumentId);
    if (values !== undefined && !values.includes(r.archiveCode)) {
      add(
        r.file,
        r.id,
        r.field,
        `archiveCode ${r.archiveCode} 不在依據文件 ${r.basisDocumentId} 的欄位值中；預填編號需取自依據來源（玩家提交時可改）`,
      );
    }
  }

  /* ---- case-source 只能掛在引用它的 caseReview 任務上 ---- */
  for (const r of taskDocRefs) {
    if (documentKind.get(r.documentId) === 'case-source' && !r.caseDocs.has(r.documentId)) {
      add(
        r.file,
        r.id,
        r.field,
        `case-source 文件 ${r.documentId} 沒有被這項任務的 caseReview 引用（需列在 sourceDocumentIds 或 receiptVariants）`,
      );
    }
  }

  /* ---- cond.case.*：案件與決定存在，且案件所屬日早於訊息的 visibleFrom（R9） ---- */
  for (const r of caseRefs) {
    const found = cases.get(r.caseId);
    if (found === undefined) {
      add(r.file, r.id, r.field, `找不到案件 ${r.caseId}（案件條件只能引用 archive 任務 caseReview 的 id）`);
      continue;
    }
    if (!found.decisions.has(r.decisionId)) {
      add(r.file, r.id, r.field, `案件 ${r.caseId} 沒有決定 ${r.decisionId}（可用：${[...found.decisions].join('、')}）`);
      continue;
    }
    const from = typeof r.visibleFrom === 'string' ? dayNumberOf.get(r.visibleFrom) : undefined;
    if (found.day !== null && from !== undefined && found.day >= from) {
      add(
        r.file,
        r.id,
        r.field,
        `案件 ${r.caseId} 屬於第 ${found.day} 天，必須早於訊息的 visibleFrom（第 ${from} 天）；當日案件決定尚未確定`,
      );
    }
  }

  /*
   * ---- returnAudit：通知日晚於核對日；reviewTaskId（有填時）存在、是 return-review、位於通知日的下一工作日、
   * auditId（有填時）一致（R10／R11） ----
   */
  for (const [auditId, a] of audits) {
    const notify = a.notifyDayId !== null ? dayNumberOf.get(a.notifyDayId) : undefined;
    const notifyOk = notify !== undefined && a.day !== null && notify > a.day;
    if (notify !== undefined && a.day !== null && notify <= a.day) {
      add(
        a.file,
        a.taskId,
        `${a.base}.notifyDayId`,
        `通知日 ${a.notifyDayId}（第 ${notify} 天）必須晚於核對任務所屬日（第 ${a.day} 天）；退件在第二輪放行後才延後通知`,
      );
    }
    if (a.reviewTask === 'absent' || a.reviewTask === 'invalid') continue;
    const reviewTaskId = a.reviewTask.id;
    const field = `${a.base}.reviewTaskId`;
    const review = taskInfo.get(reviewTaskId);
    if (review === undefined) {
      add(a.file, a.taskId, field, `找不到複審任務 ${reviewTaskId}`);
      continue;
    }
    if (review.kind !== 'return-review') {
      add(a.file, a.taskId, field, `複審任務 ${reviewTaskId} 必須是 return-review（是 ${String(review.kind)}）`);
      continue;
    }
    // 通知日本身有錯時不再連帶判斷日序；通知日的下一工作日才會把案件排入錯誤文件處理（R11）
    const next = notifyOk && a.notifyDayId !== null ? nextDayOf.get(a.notifyDayId) : undefined;
    if (next === null) {
      add(
        a.file,
        a.taskId,
        field,
        `通知日 ${a.notifyDayId} 是最後一日，沒有下一工作日可以排入錯誤文件處理；請省略 reviewTaskId`,
      );
    } else if (next !== undefined) {
      const due = dayNumberOf.get(next);
      if (due !== undefined && review.day !== null && review.day !== due) {
        add(
          a.file,
          a.taskId,
          field,
          `複審任務 ${reviewTaskId} 屬於第 ${review.day} 天；案件在通知日 ${a.notifyDayId} 的下一工作日 ${next}（第 ${due} 天）排入錯誤文件處理，reviewTaskId 只能指向那一天的 return-review 任務（或省略）`,
        );
      }
    }
    // auditId 省略時不比對；格式錯誤已在任務處指出，不連帶報不一致
    if (typeof review.auditId === 'string' && review.auditId !== '' && review.auditId !== auditId) {
      add(a.file, a.taskId, field, `複審任務 ${reviewTaskId} 的 auditId 是 ${String(review.auditId)}，與稽核 ${auditId} 不一致`);
    }
  }

  /* ---- return-review 任務的 auditId（有填時）：稽核存在，且稽核的 reviewTaskId 指回這個任務（每個稽核最多對應一項） ---- */
  for (const r of returnReviewRefs) {
    const audit = audits.get(r.auditId);
    if (audit === undefined) {
      add(r.file, r.id, r.field, `找不到退件稽核 ${r.auditId}（需在 reconcile 任務的 returnAudit 定義）`);
    } else if (audit.reviewTask === 'absent') {
      add(r.file, r.id, r.field, `稽核 ${r.auditId} 沒有 reviewTaskId 指回這項任務；請在稽核補上 reviewTaskId，或省略這裡的 auditId`);
    } else if (audit.reviewTask !== 'invalid' && audit.reviewTask.id !== r.id) {
      add(r.file, r.id, r.field, `稽核 ${r.auditId} 的 reviewTaskId 是 ${audit.reviewTask.id}，不是這項任務；每個稽核最多對應一項複審任務`);
    }
  }

  /* ---- cond.return.notified.*：稽核存在，且通知日不晚於訊息的 visibleFrom（R10） ---- */
  for (const r of returnRefs) {
    const audit = audits.get(r.auditId);
    if (audit === undefined) {
      add(r.file, r.id, r.field, `找不到退件稽核 ${r.auditId}（退件條件只能引用 reconcile 任務 returnAudit 的 id）`);
      continue;
    }
    const notify = audit.notifyDayId !== null ? dayNumberOf.get(audit.notifyDayId) : undefined;
    const from = typeof r.visibleFrom === 'string' ? dayNumberOf.get(r.visibleFrom) : undefined;
    if (notify !== undefined && from !== undefined && from < notify) {
      add(
        r.file,
        r.id,
        r.field,
        `稽核 ${r.auditId} 的通知日是 ${audit.notifyDayId}（第 ${notify} 天），晚於訊息的 visibleFrom（第 ${from} 天）；請把訊息放在通知日或之後`,
      );
    }
  }

  /* ---- cond.help.*：提問存在，且只能用在該提問自己的說明訊息（R12） ---- */
  for (const r of helpRefs) {
    if (!helpRequestIds.has(r.requestId)) {
      add(r.file, r.id, r.field, `找不到提問 ${r.requestId}（詢問條件只能引用 data/help 包 request 的 id）`);
    } else if (r.owner !== r.requestId) {
      add(r.file, r.id, r.field, `詢問條件 ${r.cond} 只能用在提問 ${r.requestId} 自己的說明訊息（data/help 包的 messages）`);
    }
  }

  /* ---- M1：附件關聯、批次轉換、交付報告、欄位映射 dynamic（全部日檔登記完文件、紀錄與任務之後） ---- */
  type WorkdayRef = (typeof workdayTaskRefs)[number];
  const attachmentSubject = new Map<string, string>();
  for (const r of workdayTaskRefs) {
    if (r.kind === 'attachment' && r.id !== null && typeof r.raw['subjectRecordId'] === 'string') attachmentSubject.set(r.id, r.raw['subjectRecordId']);
  }
  const listed = (raw: Record<string, unknown>, key: 'recordIds' | 'documentIds', value: string) =>
    Array.isArray(raw[key]) && (raw[key] as unknown[]).includes(value);
  /** 紀錄必須由 archive 任務歸檔，且不晚於這項任務；同日歸檔時須列入 dependsOn。 */
  const checkArchivedRecord = (r: WorkdayRef, path: string, recordId: string): void => {
    const owner = recordArchive.get(recordId);
    if (!owner) {
      add(r.file, r.id, path, `紀錄 ${recordId} 沒有由任何 archive 任務歸檔，無法取得採用的人員編號`);
      return;
    }
    if (r.day !== null && owner.day !== null && owner.day > r.day) {
      add(r.file, r.id, path, `紀錄 ${recordId} 在第 ${owner.day} 日才歸檔，晚於這項任務（第 ${r.day} 日）`);
    } else if (owner.day === r.day && owner.taskId !== null && !r.dependsOn.has(owner.taskId)) {
      add(r.file, r.id, path, `紀錄 ${recordId} 由同日的 ${owner.taskId} 歸檔，請把它列入 dependsOn`);
    }
  };
  /** 候選附件／隨附附件：case-source 文件、證明範圍、reply 才有 objection。回傳文件 ID。 */
  const checkCandidate = (r: WorkdayRef, path: string, value: unknown): string | null => {
    if (!isObj(value)) {
      add(r.file, r.id, path, `需要物件，得到 ${typeName(value)}`);
      return null;
    }
    for (const [, p] of extraKeys(value, path, ATTACHMENT_CANDIDATE_KEYS, false)) {
      add(r.file, r.id, p, `不在附件內的欄位（只允許 ${ATTACHMENT_CANDIDATE_KEYS.join('、')}）`);
    }
    const evidence = value['evidence'];
    if (!ATTACHMENT_EVIDENCE_KINDS.includes(evidence as never)) {
      add(r.file, r.id, `${path}.evidence`, `evidence 必須是 ${ATTACHMENT_EVIDENCE_KINDS.join('／')}，得到 ${String(evidence)}`);
    }
    const objection = value['objection'];
    if (evidence === 'reply' && typeof objection !== 'boolean') {
      add(r.file, r.id, `${path}.objection`, `本人回覆附件必須以 boolean 寫出異議回覆，得到 ${typeName(objection)}`);
    } else if (evidence !== 'reply' && objection !== undefined) {
      add(r.file, r.id, `${path}.objection`, '只有 reply 附件使用 objection');
    }
    const doc = value['documentId'];
    if (typeof doc !== 'string' || doc === '') {
      add(r.file, r.id, `${path}.documentId`, `需要文件 ID，得到 ${typeName(doc)}`);
      return null;
    }
    const kind = documentKind.get(doc);
    if (kind === undefined) add(r.file, r.id, `${path}.documentId`, `找不到文件 ${doc}`);
    else if (kind !== 'case-source') add(r.file, r.id, `${path}.documentId`, `附件必須是 case-source 文件（${doc} 是 ${kind}）`);
    else if ((documentRecords.get(doc)?.length ?? 0) === 0) add(r.file, r.id, `${path}.documentId`, `附件 ${doc} 沒有所屬紀錄（recordIds）`);
    if (!listed(r.raw, 'documentIds', doc)) add(r.file, r.id, `${path}.documentId`, `附件 ${doc} 必須列在任務的 documentIds`);
    return doc;
  };
  /** transform 任務 ID 清單：存在、kind 為 transform、所屬日不晚於這項任務。 */
  const checkTransformList = (r: WorkdayRef, path: string, value: unknown): void => {
    if (!Array.isArray(value)) {
      add(r.file, r.id, path, `需要 transform 任務 ID 陣列，得到 ${typeName(value)}`);
      return;
    }
    value.forEach((t, j) => {
      const info = typeof t === 'string' ? taskInfo.get(t) : undefined;
      if (info?.kind !== 'transform') add(r.file, r.id, `${path}[${j}]`, `必須是 transform 任務，得到 ${String(t)}`);
      else if (r.day !== null && info.day !== null && info.day > r.day) add(r.file, r.id, `${path}[${j}]`, `${String(t)} 晚於這項任務`);
      else if (info.day === r.day && typeof t === 'string' && !r.dependsOn.has(t)) add(r.file, r.id, `${path}[${j}]`, `同日的 ${t} 必須列入 dependsOn`);
    });
  };
  for (const r of workdayTaskRefs) {
    const raw = r.raw;
    switch (r.kind) {
      case 'attachment': {
        const subject = raw['subjectRecordId'];
        if (typeof subject !== 'string' || subject === '') {
          add(r.file, r.id, `${r.field}.subjectRecordId`, `需要紀錄 ID，得到 ${typeName(subject)}`);
        } else {
          if (!listed(raw, 'recordIds', subject)) add(r.file, r.id, `${r.field}.subjectRecordId`, 'subjectRecordId 必須在 recordIds 內');
          checkArchivedRecord(r, `${r.field}.subjectRecordId`, subject);
        }
        const candidates = raw['candidates'];
        if (!Array.isArray(candidates) || candidates.length === 0) {
          add(r.file, r.id, `${r.field}.candidates`, `需要非空的附件陣列，得到 ${typeName(candidates)}`);
          break;
        }
        const seen = new Set<string>();
        candidates.forEach((c, j) => {
          const doc = checkCandidate(r, `${r.field}.candidates[${j}]`, c);
          if (doc === null) return;
          if (seen.has(doc)) add(r.file, r.id, `${r.field}.candidates[${j}].documentId`, `重複的附件 ${doc}`);
          seen.add(doc);
        });
        break;
      }
      case 'transform': {
        const rows = raw['rows'];
        if (!Array.isArray(rows) || rows.length === 0) {
          add(r.file, r.id, `${r.field}.rows`, `需要非空的資料列陣列，得到 ${typeName(rows)}`);
          break;
        }
        const ids = new Set<string>();
        rows.forEach((row, j) => {
          const path = `${r.field}.rows[${j}]`;
          if (!isObj(row)) {
            add(r.file, r.id, path, `需要物件，得到 ${typeName(row)}`);
            return;
          }
          for (const [, p] of extraKeys(row, path, TRANSFORM_ROW_KEYS, false)) {
            add(r.file, r.id, p, `不在資料列內的欄位（只允許 ${TRANSFORM_ROW_KEYS.join('、')}）`);
          }
          const rowId = row['id'];
          if (typeof rowId !== 'string' || !rowId.startsWith(ID_PREFIX.row) || !ID_PATTERN.test(rowId)) {
            add(r.file, r.id, `${path}.id`, `資料列 ID 必須以 \`${ID_PREFIX.row}\` 開頭、只用小寫英數、\`-\` 與 \`.\``);
          } else if (ids.has(rowId)) add(r.file, r.id, `${path}.id`, `重複的資料列 ${rowId}`);
          else ids.add(rowId);
          const recordId = row['recordId'];
          if (typeof recordId !== 'string' || recordId === '') {
            add(r.file, r.id, `${path}.recordId`, `需要紀錄 ID，得到 ${typeName(recordId)}`);
          } else {
            if (!listed(raw, 'recordIds', recordId)) add(r.file, r.id, `${path}.recordId`, '資料列的紀錄必須在 recordIds 內');
            checkArchivedRecord(r, `${path}.recordId`, recordId);
          }
          const attTask = row['attachmentTaskId'];
          if (attTask !== undefined && row['attachment'] !== undefined) {
            add(r.file, r.id, path, 'attachmentTaskId 與 attachment 只能擇一');
          }
          if (attTask !== undefined) {
            const info = typeof attTask === 'string' ? taskInfo.get(attTask) : undefined;
            if (info?.kind !== 'attachment') add(r.file, r.id, `${path}.attachmentTaskId`, `必須是 attachment 任務，得到 ${String(attTask)}`);
            else if (r.day !== null && info.day !== null && info.day > r.day) add(r.file, r.id, `${path}.attachmentTaskId`, `${String(attTask)} 晚於這項任務`);
            else if (info.day === r.day && !r.dependsOn.has(attTask as string)) add(r.file, r.id, `${path}.attachmentTaskId`, `同日的 ${String(attTask)} 必須列入 dependsOn`);
            else if (attachmentSubject.get(attTask as string) !== recordId) add(r.file, r.id, `${path}.attachmentTaskId`, `${String(attTask)} 的對象不是這一列的紀錄`);
          }
          if (row['attachment'] !== undefined) checkCandidate(r, `${path}.attachment`, row['attachment']);
        });
        break;
      }
      case 'report': {
        const fm = raw['fieldMapTaskId'];
        const info = typeof fm === 'string' ? fieldMapInfo.get(fm) : undefined;
        if (!info) add(r.file, r.id, `${r.field}.fieldMapTaskId`, `必須是 field-map 任務，得到 ${String(fm)}`);
        else if (!info.dynamic) add(r.file, r.id, `${r.field}.fieldMapTaskId`, `${String(fm)} 沒有 dynamic，報告無法對應保存的資料`);
        else if (info.day !== r.day) add(r.file, r.id, `${r.field}.fieldMapTaskId`, `${String(fm)} 必須在同一天`);
        else if (!r.dependsOn.has(fm as string)) add(r.file, r.id, `${r.field}.fieldMapTaskId`, `${String(fm)} 必須列入 dependsOn`);
        checkTransformList(r, `${r.field}.transformTaskIds`, raw['transformTaskIds']);
        break;
      }
      case 'field-map': {
        const dyn = raw['dynamic'];
        const info = r.id !== null ? fieldMapInfo.get(r.id) : undefined;
        const base = `${r.field}.dynamic`;
        if (!isObj(dyn) || !info) {
          add(r.file, r.id, base, `需要物件，得到 ${typeName(dyn)}`);
          break;
        }
        for (const [, p] of extraKeys(dyn, base, FIELD_MAP_DYNAMIC_KEYS, false)) {
          add(r.file, r.id, p, `不在 dynamic 內的欄位（只允許 ${FIELD_MAP_DYNAMIC_KEYS.join('、')}）`);
        }
        const code = dyn['codeFieldId'];
        const reply = dyn['replyFieldId'];
        if (typeof code !== 'string' || !info.sourceIds.has(code)) add(r.file, r.id, `${base}.codeFieldId`, `必須是來源欄位 ID，得到 ${String(code)}`);
        if (typeof reply !== 'string' || !info.booleanSources.has(reply)) {
          add(r.file, r.id, `${base}.replyFieldId`, `必須是某個 boolean 目標的預設來源欄位，得到 ${String(reply)}`);
        }
        if (code === reply) add(r.file, r.id, `${base}.replyFieldId`, 'codeFieldId 與 replyFieldId 不能相同');
        const rows = dyn['rows'];
        if (!Array.isArray(rows)) {
          add(r.file, r.id, `${base}.rows`, `需要陣列，得到 ${typeName(rows)}`);
          break;
        }
        const seen = new Set<string>();
        rows.forEach((row, j) => {
          const path = `${base}.rows[${j}]`;
          if (!isObj(row)) {
            add(r.file, r.id, path, `需要物件，得到 ${typeName(row)}`);
            return;
          }
          for (const [, p] of extraKeys(row, path, FIELD_MAP_DYNAMIC_ROW_KEYS, false)) {
            add(r.file, r.id, p, `不在 dynamic 資料列內的欄位（只允許 ${FIELD_MAP_DYNAMIC_ROW_KEYS.join('、')}）`);
          }
          const rowId = row['rowId'];
          if (typeof rowId !== 'string' || !info.rowIds.has(rowId)) add(r.file, r.id, `${path}.rowId`, `必須是 rows 內的資料列，得到 ${String(rowId)}`);
          else if (seen.has(rowId)) add(r.file, r.id, `${path}.rowId`, `重複的資料列 ${rowId}`);
          else seen.add(rowId);
          const recordId = row['recordId'];
          if (typeof recordId !== 'string' || recordId === '') add(r.file, r.id, `${path}.recordId`, `需要紀錄 ID，得到 ${typeName(recordId)}`);
          else checkArchivedRecord(r, `${path}.recordId`, recordId);
          checkTransformList(r, `${path}.transformTaskIds`, row['transformTaskIds']);
        });
        break;
      }
    }
  }

  /* ---- M1 unlockAfter：案件／任務存在、種類相符、所屬日不晚於訊息的 visibleFrom ---- */
  for (const u of progressUnlockRefs) {
    const visibleDay = typeof u.visibleFrom === 'string' ? dayNumberOf.get(u.visibleFrom) : undefined;
    const path = `${u.base}.${u.key}`;
    let day: number | null | undefined;
    if (u.key === 'caseOpened') {
      const c = cases.get(u.target);
      if (!c) add(u.file, u.id, path, `找不到案件 ${u.target}`);
      day = c?.day;
    } else {
      const info = taskInfo.get(u.target);
      const allowed = u.key === 'taskOpened' ? ['attachment', 'transform', 'report'] : ['transform', 'report'];
      if (!info || !allowed.includes(String(info.kind))) add(u.file, u.id, path, `${u.key} 必須是 ${allowed.join('／')} 任務，得到 ${u.target}`);
      day = info?.day;
    }
    if (visibleDay !== undefined && day !== undefined && day !== null && day > visibleDay) {
      add(u.file, u.id, path, `${u.target} 屬於第 ${day} 日，晚於訊息的 visibleFrom`);
    }
  }

  /* ---- M1 工作日內容包：延後回條（模板、觸發條件）、離班／到班短文、介面字 ---- */
  if (input.workday) checkWorkday(input.workday);

  /* ---- 引用檢查 ---- */
  for (const r of references) {
    if (!registry[r.kind].has(r.target)) {
      add(r.file, r.id, r.field, `找不到${REF_LABEL[r.kind]} ${r.target}`);
    }
  }

  return issues;
}

/* ---------- 抽出的檢查 ---------- */

function requireStringArray(
  source: ContentSource,
  id: string | null,
  field: string,
  value: unknown,
  add: AddIssue,
): void {
  if (!Array.isArray(value)) {
    add(source.file, id, field, `需要字串陣列，得到 ${typeName(value)}`);
    return;
  }
  if (value.length === 0) {
    add(source.file, id, field, '不得為空陣列');
    return;
  }
  value.forEach((line, i) => {
    if (typeof line !== 'string' || line === '') {
      add(source.file, id, `${field}[${i}]`, `需要非空字串，得到 ${typeName(line)}`);
    }
  });
}

function checkActions(source: ContentSource, id: string | null, field: string, value: unknown, add: AddIssue): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add(source.file, id, field, `需要動作 ID 陣列，得到 ${typeName(value)}`);
    return;
  }
  value.forEach((action, i) => {
    if (!isActionId(action)) {
      add(source.file, id, `${field}[${i}]`, `未知的動作 ID ${String(action)}（白名單見 content/conditions.ts）`);
    }
  });
}

function checkTemplate(
  source: ContentSource,
  id: string | null,
  field: string,
  key: string,
  value: string,
  add: AddIssue,
): void {
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(TEMPLATE_FIELDS, k);
  /** 完整路徑的登記優先（例如 `morning.docTitleTemplate`），否則依欄位名。 */
  const allowed: readonly string[] | undefined = own(field) ? TEMPLATE_FIELDS[field] : own(key) ? TEMPLATE_FIELDS[key] : undefined;
  if (allowed === undefined) {
    add(source.file, id, field, `未知的樣板欄位 ${key}（可用欄位見 schema.ts 的 TEMPLATE_FIELDS）`);
    return;
  }
  checkPlaceholders(source, id, field, value, allowed, allowed, add);
}

/**
 * placeholder 檢查：大括號必須是 `{英數底線}`、名稱在 allowed 內、required 全部出現。
 * TEMPLATE_FIELDS 的樣板欄位 allowed＝required；R12 的郵件模板只限定可用名稱、不要求必填。
 */
function checkPlaceholders(
  source: ContentSource,
  id: string | null,
  field: string,
  value: string,
  allowed: readonly string[],
  required: readonly string[],
  add: AddIssue,
): void {
  for (const brace of value.match(ANY_BRACE_PATTERN) ?? []) {
    if (!/^\{[A-Za-z0-9_]+\}$/.test(brace)) add(source.file, id, field, `不合法的 placeholder ${brace}`);
  }
  for (const name of placeholders(value)) {
    if (!allowed.includes(name)) {
      add(source.file, id, field, `未知的 placeholder {${name}}，可用：${allowed.map((a) => `{${a}}`).join('、')}`);
    }
  }
  for (const name of required) {
    if (!value.includes(`{${name}}`)) add(source.file, id, field, `缺少必要的 placeholder {${name}}`);
  }
}

/* ---------- 嚴格 shape 的改法提示 ---------- */

/** R11：移除來源編號帶入；編號一律由玩家自行輸入。 */
const SOURCE_FILL_HINTS: Readonly<Record<string, string>> = Object.fromEntries(
  ['useCode', 'useDocumentTemplate'].map((key) => [key, `${key} 已移除（R11）：編號由玩家自行輸入，不提供來源編號帶入`]),
);

/** R8：交付按鈕集中到 ui.tasks（deliver／finishDay）。 */
const FINISH_DAY_HINTS: Readonly<Record<string, string>> = {
  finishDay: 'finishDay 已移到 ui.tasks.finishDay（當日尚有工作時用 ui.tasks.deliver）',
};

/** archive 任務 text 帶入共同字串時的提示（R6-01）。 */
const ARCHIVE_COMMON_HINTS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.keys(ARCHIVE_UI_SHAPE).map((key) => [key, '共同介面字串已集中在 ui.zh-Hant.json 的 archive 區塊，不要複製進每日檔']),
  ),
  ...FINISH_DAY_HINTS,
};

/** R8：reconcile 回覆對話框不再有自己的完成按鈕。 */
const RECONCILE_TEXT_HINTS: Readonly<Record<string, string>> = {
  finish: 'dialog.finish 已移除；完成按鈕改用 ui.tasks.deliver／finishDay',
};

/** R10／R11：return-review 任務的標題與說明共用 ui.documentIssues（taskHeading／taskInstruction），每日檔只放 eyebrow。 */
const RETURN_REVIEW_TEXT_HINTS: Readonly<Record<string, string>> = Object.fromEntries(
  ['heading', 'instruction'].map((key) => [key, `${key} 共用 ui.zh-Hant.json 的 documentIssues（taskHeading／taskInstruction），每日檔只放 eyebrow`]),
);

/** R7 移除的 ui 欄位：玩家介面不再顯示 true／false／null。 */
const FIELD_MAP_UI_HINTS: Readonly<Record<string, string>> = Object.fromEntries(
  ['valueTrue', 'valueFalse', 'valueNull'].map((key) => [key, `${key} 已移除；預覽改用 excluded／notExcluded／pendingReview`]),
);

const SOURCE_CARD_HINTS: Readonly<Record<string, string>> = Object.fromEntries(
  ['refusalNA', 'refusalNull', 'refusalTrue'].map((key) => [key, `${key} 已移除；拒絕紀錄的值改用 ui.recordStatus`]),
);

const MESSAGES_UI_HINTS: Readonly<Record<string, string>> = {
  eyebrow: 'eyebrow 已移除；訊息頁頂部改用 workspace',
  back: 'back 已移除；訊息頁不放「返回工作」，由工作台主導航切換',
};

/** R8：日結頁的筆數與按鈕改由 ui.handoff 產生。 */
const HANDOFF_MOVED_HINTS: Readonly<Record<string, string>> = {
  countLabel: 'countLabel 已移除；逐項工作的筆數改用 ui.handoff.itemTemplate',
  next: 'next 已移除；日結按鈕改用 ui.handoff.next',
};

const END_TRANSITION_HINTS: Readonly<Record<string, string>> = {
  outcome: 'outcome 已移除；結束轉場改為 task-neutral，請用 summary',
  ...HANDOFF_MOVED_HINTS,
};

const WRAP_TRANSITION_HINTS: Readonly<Record<string, string>> = {
  ...HANDOFF_MOVED_HINTS,
  outcome: 'outcome 已移除',
  summary: '日結轉場沒有 summary（最後一日才用結束轉場）',
  thanks: '日結轉場沒有 thanks（最後一日才用結束轉場）',
  outro: '日結轉場沒有 outro（最後一日才用結束轉場）',
};

/* ---------- reconcile：subjectRecordId ---------- */

function checkSubjectRecord(
  source: ContentSource,
  id: string | null,
  field: string,
  raw: Record<string, unknown>,
  add: AddIssue,
  addRef: (field: string, target: unknown) => void,
): void {
  const subject = raw['subjectRecordId'];
  const path = `${field}.subjectRecordId`;
  if (typeof subject !== 'string' || subject === '') {
    add(source.file, id, path, `reconcile 任務必須以 subjectRecordId 指定核對的紀錄，得到 ${typeName(subject)}`);
    return;
  }
  addRef(path, subject);
  const recordIds = raw['recordIds'];
  if (Array.isArray(recordIds) && !recordIds.includes(subject)) {
    add(source.file, id, path, `subjectRecordId ${subject} 必須列在同一任務的 recordIds 內`);
  }
}

/* ---------- field-map（R6-03） ---------- */

function checkFieldMap(
  source: ContentSource,
  id: string | null,
  field: string,
  raw: Record<string, unknown>,
  add: AddIssue,
): void {
  /** 非空的物件陣列；回傳 [index, object] 對。 */
  const objects = (key: string, what: string): [number, Record<string, unknown>][] | null => {
    const list = raw[key];
    if (!Array.isArray(list)) {
      add(source.file, id, `${field}.${key}`, `需要${what}陣列，得到 ${typeName(list)}`);
      return null;
    }
    if (list.length === 0) {
      add(source.file, id, `${field}.${key}`, `不得為空陣列，至少需要一個${what}`);
      return null;
    }
    const out: [number, Record<string, unknown>][] = [];
    list.forEach((item, i) => {
      if (isObj(item)) out.push([i, item]);
      else add(source.file, id, `${field}.${key}[${i}]`, `需要物件，得到 ${typeName(item)}`);
    });
    return out;
  };

  /** 欄位 ID：非空、合法字元、在 `seen` 內唯一。 */
  const fieldId = (path: string, value: unknown, seen: Set<string>, what: string): string | null => {
    if (typeof value !== 'string' || value === '') {
      add(source.file, id, path, `${what} id 必須是非空字串，得到 ${typeName(value)}`);
      return null;
    }
    if (!ID_PATTERN.test(value)) add(source.file, id, path, 'ID 只能使用小寫英數、`-` 與 `.`');
    if (seen.has(value)) {
      add(source.file, id, path, `${what} id ${value} 重複`);
      return null;
    }
    seen.add(value);
    return value;
  };

  const label = (path: string, value: unknown): void => {
    if (typeof value !== 'string' || value === '') {
      add(source.file, id, path, `label 必須是非空字串，得到 ${typeName(value)}`);
    }
  };

  /* 來源欄位 */
  const sourceIds = new Set<string>();
  const sources = objects('sourceFields', '來源欄位');
  for (const [i, f] of sources ?? []) {
    const base = `${field}.sourceFields[${i}]`;
    fieldId(`${base}.id`, f['id'], sourceIds, '來源欄位');
    label(`${base}.label`, f['label']);
  }

  /*
   * 目標欄位：sourceId 是作者預設配對（R10）——存在、各目標一對一、boolean 目標需要 trueValue／falseValue。
   * 這裡不代表玩家必須選 sourceId；玩家實際配對的合法性（完整、一對一、可轉換）由規則層依 assignments 檢查。
   */
  const targetIds = new Set<string>();
  const usedSources = new Map<string, string>();
  /** 來源欄位 → boolean 值域（該來源是 boolean 目標的預設配對時）。 */
  const booleanDomain = new Map<string, readonly string[]>();
  for (const [i, t] of objects('targetFields', '目標欄位') ?? []) {
    const base = `${field}.targetFields[${i}]`;
    const targetId = fieldId(`${base}.id`, t['id'], targetIds, '目標欄位');
    label(`${base}.label`, t['label']);
    const sourceId = t['sourceId'];
    if (typeof sourceId !== 'string' || sourceId === '') {
      add(source.file, id, `${base}.sourceId`, `sourceId（作者預設配對）必須是非空字串，得到 ${typeName(sourceId)}`);
    } else if (sources !== null && !sourceIds.has(sourceId)) {
      add(source.file, id, `${base}.sourceId`, `找不到來源欄位 ${sourceId}（預設配對需列在 sourceFields）`);
    } else {
      const previous = usedSources.get(sourceId);
      if (previous !== undefined) {
        add(source.file, id, `${base}.sourceId`, `來源欄位 ${sourceId} 已由目標 ${previous} 使用；預設配對必須一對一`);
      } else usedSources.set(sourceId, targetId ?? base);
    }
    const convert = t['convert'];
    if (typeof convert !== 'string' || !(FIELD_CONVERSIONS as readonly string[]).includes(convert)) {
      add(source.file, id, `${base}.convert`, `convert 必須是 ${FIELD_CONVERSIONS.join('／')}，得到 ${String(convert)}`);
      continue;
    }
    if (convert === 'boolean') {
      const values: string[] = [];
      for (const key of ['trueValue', 'falseValue'] as const) {
        const v = t[key];
        if (typeof v !== 'string' || v === '') {
          add(source.file, id, `${base}.${key}`, `boolean 欄位必須有非空的 ${key}，得到 ${typeName(v)}`);
        } else values.push(v);
      }
      if (values.length === 2 && values[0] === values[1]) {
        add(source.file, id, `${base}.falseValue`, 'trueValue 與 falseValue 不得相同');
      }
      if (values.length === 2 && typeof sourceId === 'string') booleanDomain.set(sourceId, values);
    } else {
      for (const key of ['trueValue', 'falseValue'] as const) {
        if (t[key] !== undefined) add(source.file, id, `${base}.${key}`, `text 欄位不使用 ${key}`);
      }
    }
  }

  /* 資料列：row. 前綴且唯一；values 的鍵恰為全部來源欄位；boolean 目標的預設來源值需可轉換（作者預設配對能完成匯入） */
  const rowIds = new Set<string>();
  for (const [i, row] of objects('rows', '資料列') ?? []) {
    const base = `${field}.rows[${i}]`;
    const rowId = row['id'];
    if (typeof rowId !== 'string' || rowId === '') {
      add(source.file, id, `${base}.id`, `資料列 id 必須是非空字串，得到 ${typeName(rowId)}`);
    } else {
      if (!rowId.startsWith(ID_PREFIX.row)) add(source.file, id, `${base}.id`, `ID 必須以 \`${ID_PREFIX.row}\` 開頭`);
      if (!ID_PATTERN.test(rowId)) add(source.file, id, `${base}.id`, 'ID 只能使用小寫英數、`-` 與 `.`');
      if (rowIds.has(rowId)) add(source.file, id, `${base}.id`, `資料列 id ${rowId} 重複`);
      rowIds.add(rowId);
    }
    const values = row['values'];
    if (!isObj(values)) {
      add(source.file, id, `${base}.values`, `需要物件，得到 ${typeName(values)}`);
      continue;
    }
    if (sources === null) continue;
    for (const key of sourceIds) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        add(source.file, id, `${base}.values.${key}`, `缺少來源欄位 ${key} 的值（空值請填空字串）`);
      }
    }
    for (const key of Object.keys(values)) {
      const path = `${base}.values.${key}`;
      if (!sourceIds.has(key)) {
        add(source.file, id, path, `不是來源欄位；values 的鍵必須恰為 sourceFields 的 id`);
        continue;
      }
      const v = values[key];
      if (typeof v !== 'string') {
        add(source.file, id, path, `來源值必須是字串（前導零不得寫成數字；空值填空字串），得到 ${typeName(v)}`);
        continue;
      }
      const domain = booleanDomain.get(key);
      if (domain !== undefined && v !== '' && !domain.includes(v)) {
        add(source.file, id, path, `boolean 目標的預設來源值只能是 ${domain.join('／')} 或空字串（預設配對需可轉換），得到 ${v}`);
      }
    }
  }
}
