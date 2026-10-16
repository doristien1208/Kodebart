import { Stage } from '../core/types';
import { CONTENT, ONBOARDING, actorName, bulletin, caseNumberTemplateOf, helpPackOf, mailPack } from './bundle';
import { PLACEHOLDER_PATTERN, format } from './format';
import { NAME_UNREGISTERED } from './records';
import {
  ArchiveUi,
  CaseReviewUi,
  DesktopUi,
  DocumentIssuesUi,
  ExecutionLogUiText,
  FieldMapUi,
  HandoffUi,
  HelpUi,
  IssueReason,
  IssueReceiptKind,
  IssueStatus,
  MAIL_TEMPLATE_PLACEHOLDERS,
  MailTemplatePlaceholder,
  MailUi,
  MorningUi,
  OnboardingUi,
  OperationUi,
  RecordReviewUi,
  RecordStatusText,
  RETURN_RECEIPT_MAIL_PACK_ID,
  ReturnedReviewUi,
  TaskKind,
  TasksUi,
  WindowShellUi,
  WindowsUi,
  ContentInterlude,
  ContentWorkday,
  ContentWorkdayTemplate,
  WorkdayUi,
} from './schema';

/**
 * game/content/text：跨日共用的介面文案 API。
 *
 * 值全部來自 data/ 的 JSON（見 content/README.md），這裡只負責挑選、組裝與代入樣板，
 * 不保留任何寫死的玩家可見字串。內容在 bundle.ts 載入時已依 kind 逐欄驗證，
 * 因此這裡直接從已驗證的型別讀取，不做任何 `as unknown as` 斷言。
 *
 * 這裡**不綁日別**（R6-01）：每日的標題、說明、任務文字、文件與轉場，一律由目前 dayId／taskId
 * 從 bundle.ts 取得（dayContentById、tasksOfDay、contentTask、archiveTask／reconcileTask／fieldMapTask、
 * documentsOfTask、wrapTransitionText／endTransitionText）。不要在這裡新增 DAY3～DAY6 之類的物件。
 *
 * 訊息一律走 bundle.ts 的頻道 API（channelsOfKind／messagesOfChannel／unlockedMessages／promptOf／
 * promptsOfChannel／chatDateLabel）。
 */

/** 公告內容 ID；只有 ID，不含文本。 */
const BULLETIN_IDS = {
  newsWelcome: 'bulletin.welcome',
  newsMaintenance: 'bulletin.maintenance',
} as const;

const ui = CONTENT.ui;
const welcome = bulletin(BULLETIN_IDS.newsWelcome);
const maintenance = bulletin(BULLETIN_IDS.newsMaintenance);

/** 國字日名（ui.workbench.dayName）；驗證保證每個存在的日都有。未知日退回阿拉伯數字。 */
export function dayName(day: number): string {
  return ui.workbench.dayName[String(day)] ?? String(day);
}

/** 純字串樣板代入（`{name}` → 值）；UI 需要代入每日文字的樣板時使用。 */
export { format as formatText } from './format';

/* ---------- 對外 API ---------- */

export const APP_TITLE_SUFFIX = ui.appTitleSuffix;
export function pageTitle(text: string): string {
  return text + APP_TITLE_SUFFIX;
}

export const COVER = ui.cover;

/**
 * 封面「本機紀錄」的進度文字（R6-02），由目前日序與 stage 產生：
 * work →「第三日」、wrap →「第二日交接完成」、morning →「第三日收件」（R8，dayNumber 為新的一日）、
 * end →「六日試玩完成」（end 用最後一日的日名）。
 */
export function progressLabel(dayNumber: number, stage: Stage, lastDayNumber: number): string {
  switch (stage) {
    case 'work':
      return format(ui.progressLabel.workTemplate, { dayName: dayName(dayNumber) });
    case 'wrap':
      return format(ui.progressLabel.wrapTemplate, { dayName: dayName(dayNumber) });
    case 'morning':
      return format(ui.progressLabel.morningTemplate, { dayName: dayName(dayNumber) });
    case 'end':
      return format(ui.progressLabel.endTemplate, { dayName: dayName(lastDayNumber) });
  }
}

export const NEW_GAME_DIALOG = ui.dialogs.newGame;

export const SETTINGS_DIALOG = ui.dialogs.settings;

export const STORAGE = ui.storage;

const WORKBENCH_NAV = ui.workbench.nav;

/**
 * 工作平台（桌面中的公司應用）的外殼字。R12：左側單組功能導航（nav：工作、通訊、公告、郵件），
 * 右上身分區顯示玩家姓名與組別 `team`（「資料作業組」），`identityLabel` 為身分區標籤；不再有雙 group 與「文件問題」頁。
 * 返回開始頁在桌面主選單（DESKTOP_UI.menu.backToCover）；通訊是桌面應用，`heading` 只剩公告頁。
 */
export const WORKBENCH = {
  brandLead: ui.workbench.brandLead,
  brandRest: ui.workbench.brandRest,
  brandSuffix: ui.workbench.brandSuffix,
  navLabel: ui.workbench.navLabel,
  nav: WORKBENCH_NAV,
  team: ui.workbench.team,
  identityLabel: ui.workbench.identityLabel,
  heading: {
    news: ui.workbench.heading.news,
  },
  dayTag: (day: number) => format(ui.workbench.dayTagTemplate, { day }),
  docTitle: (day: number, view: keyof typeof WORKBENCH_NAV) =>
    format(ui.workbench.docTitleTemplate, { dayName: dayName(day), view: WORKBENCH_NAV[view] }),
} as const;

/** 側欄的跨日部分；每日的 heading／body 在 dayContentById(dayId).aside。 */
export const ASIDE = {
  eyebrow: ui.aside.eyebrow,
  colleague: actorName(ui.aside.colleagueActorId),
  quote: ui.aside.quote,
  slogan: ui.aside.slogan,
} as const;

/**
 * 來源卡的標籤；拒絕紀錄的值用 RECORD_STATUS 顯示（R7），不再有 refusalNA／Null／True。
 * 適用拒絕紀錄的紀錄另顯示安排項目（arrangement：arrangementValue，R12）；來源未附拒絕紀錄時，值後接 missingNote 說明（R12）。
 */
export const SOURCE_CARD = {
  eyebrow: (key: string) => format(ui.sourceCard.eyebrowTemplate, { key }),
  name: ui.sourceCard.name,
  nameUnregistered: NAME_UNREGISTERED,
  code: ui.sourceCard.code,
  arrangement: ui.sourceCard.arrangement,
  arrangementValue: ui.sourceCard.arrangementValue,
  refusal: ui.sourceCard.refusal,
  missingNote: ui.sourceCard.missingNote,
} as const;

/**
 * 玩家可見的紀錄狀態（ui.recordStatus，R7 §6.1）。底層的 boolean／null／origin 不直接顯示；
 * 來源卡、歸檔預覽與 Day 2 摘要的 `{value}` 一律傳這裡的文字。
 */
export const RECORD_STATUS: RecordStatusText = ui.recordStatus;

/** 全部 archive 任務共用的介面字串（ui.archive）；每日的 eyebrow／heading／instruction 在 archiveTask(taskId).text。 */
export const ARCHIVE_UI: ArchiveUi = ui.archive;

/** 歸檔進度，例如「2 / 5 已處理」；總筆數由呼叫端從當日批次傳入，不寫死。 */
export function archiveProgress(count: number, total: number): string {
  return format(ui.archive.progressTemplate, { count, total });
}

/** 歸檔尚未完成時的頁尾，例如「完成 5 筆資料後即可交接。」 */
export function archiveFooterPending(total: number): string {
  return format(ui.archive.footerPendingTemplate, { total });
}

/** 全部 field-map 任務共用的介面字串（ui.fieldMap）；每日的標題與 policy 文字在 fieldMapTask(taskId).text。 */
export const FIELD_MAP_UI: FieldMapUi = ui.fieldMap;

/* ---------- 同日多工作、日結、次日收件、系統作業紀錄（R8） ---------- */

/** 同日多工作的共用字串（ui.tasks）：狀態、交付按鈕、種類與單位。 */
export const TASKS_UI: TasksUi = ui.tasks;

/** 工作頁的步驟標示，例如「第 1 / 2 項」；`index` 為 **1 起算**的第幾項。 */
export function stepLabel(index: number, total: number): string {
  return format(ui.tasks.stepTemplate, { index, total });
}

/** 任務種類的業務動詞（歸檔／核對／匯入／複審）。 */
export function taskKindLabel(kind: TaskKind): string {
  return ui.tasks.kind[kind];
}

/** 任務種類的數量單位（筆／列）。 */
export function taskUnit(kind: TaskKind): string {
  return ui.tasks.unit[kind];
}

/** 交付按鈕：當日還有其他未完成工作時「交付此項工作」，最後一項「完成今日交接」。 */
export function deliverLabel(isLastTask: boolean): string {
  return isLastTask ? ui.tasks.finishDay : ui.tasks.deliver;
}

/** 日結頁「本日交接」的共用字串（ui.handoff）。每日的 heading／body 在 wrapTransitionText(dayId)。 */
export const HANDOFF_UI: HandoffUi = ui.handoff;

/** 日結頁的總數，例如「共 2 項工作」；`count` 是工作項數，不是筆數。 */
export function totalTasks(count: number): string {
  return format(ui.handoff.totalTemplate, { count });
}

/** 日結頁每項工作的摘要，例如「歸檔 3 筆」「匯入 8 列」；`count` 為該項實際筆數／列數。 */
export function handoffItem(kind: TaskKind, count: number): string {
  return format(ui.handoff.itemTemplate, { kind: taskKindLabel(kind), count, unit: taskUnit(kind) });
}

/** 次日收件的共用字串（ui.morning）；問候沿用 dayContentById(dayId).workbench.greeting。 */
export const MORNING_UI: MorningUi = ui.morning;

/** 次日收件的待處理數，例如「待處理 4 筆」。 */
export function morningPending(kind: TaskKind, count: number): string {
  return format(ui.morning.pendingTemplate, { count, unit: taskUnit(kind) });
}

/** 次日收件的分頁標題，例如「第二日 — 收件」（再由 pageTitle 加上 app 後綴）。 */
export function morningDocTitle(dayNumber: number): string {
  return format(ui.morning.docTitleTemplate, { dayName: dayName(dayNumber) });
}

/**
 * 系統作業紀錄（ui.executionLog）加上沿用的值：資料去向取 ui.archive、空白處理取 ui.fieldMap，
 * 比對案件的去向取 ui.caseReview.destination（R9；窗口待查 ≠ 資料覆核佇列），
 * 紀錄的拒絕狀態請用 RECORD_STATUS。presenter 只從這裡與已保存的狀態組字，不寫死任何字串。
 */
export const EXECUTION_LOG_UI: ExecutionLogUiText & {
  readonly destination: { readonly archive: string; readonly review: string };
  readonly caseDestination: { readonly archive: string; readonly review: string };
  readonly blank: { readonly default: string; readonly review: string };
} = {
  ...ui.executionLog,
  destination: { archive: ui.archive.destinationArchive, review: ui.archive.destinationReview },
  caseDestination: ui.caseReview.destination,
  blank: { default: ui.fieldMap.notExcluded, review: ui.fieldMap.pendingReview },
};

/* ---------- 多來源比對案件與視窗殼（R9） ---------- */

/**
 * 比對案件的共用介面字（ui.caseReview）。決定的 label／note、文件標題與欄位在每日檔
 * （bundle.ts 的 caseReviewOf／caseReviewForRecord／caseSourceDocument）。
 */
export const CASE_REVIEW_UI: CaseReviewUi = ui.caseReview;

/** 已標記的差異數，例如「已標記 2 處差異」。 */
export function caseMarkedCount(count: number): string {
  return format(ui.caseReview.markedCountTemplate, { count });
}

/** 共用視窗殼（ui.windowShell）：系統作業紀錄窗的歷史切換（顯示較早紀錄／收合）。 */
export const WINDOW_SHELL_UI: WindowShellUi = ui.windowShell;

/* ---------- 操作流程、浮動視窗、逐筆審查與退件複審（R10） ---------- */

/**
 * 提交的執行階段（ui.operation）：received → validating → validated → processing → saving → done／failed。
 * `validated`（格式檢查通過）只代表結構合法；`done`（已保存）只在持久化成功後顯示。
 */
export const OPERATION_UI: OperationUi = ui.operation;

/**
 * 浮動視窗與視窗列（ui.windows）：最小化、最大化／還原、關閉、視窗列、開啟紀錄窗、文件群組與鍵盤提示。
 * 「重設視窗位置」在桌面主選單（DESKTOP_UI.menu.resetLayout）。
 */
export const WINDOWS_UI: WindowsUi = ui.windows;

/** 核對的逐筆審查（ui.recordReview）：「核對後放行／保留待查」與各筆狀態、送出回覆前的提示。 */
export const RECORD_REVIEW_UI: RecordReviewUi = ui.recordReview;

/** 退件複審（ui.returnedReview，逐字來自 doc/content/R10-return-review.json）。 */
export const RETURNED_REVIEW_UI: ReturnedReviewUi = ui.returnedReview;

/* ---------- 文件問題與錯誤文件處理（R11） ---------- */

/**
 * 文件問題案件與每日「錯誤文件處理」工作的共用字（ui.documentIssues）；R12 起案件入口改為郵件（MAIL_UI），
 * 「文件問題」頁已移除，這裡只留郵件附件（狀態、區段、核對結果、回條）、郵件閱讀窗的返回（close）
 * 與當日工作的「開啟最新郵件／已處理」（task）。單一案件的處理按鈕與欄位標籤沿用 RETURNED_REVIEW_UI；
 * 工作標題／eyebrow 用 bundle.ts 的 taskHeading／issueTaskText。
 */
export const DOCUMENT_ISSUES_UI: DocumentIssuesUi = ui.documentIssues;

/** 案件狀態文字；`status` 與 core 的 ReturnStatus 同一組值（awaiting-check → 已重送／待核對 等）。 */
export function issueStatusLabel(status: IssueStatus): string {
  switch (status) {
    case 'pending':
      return ui.documentIssues.status.pending;
    case 'awaiting-check':
      return ui.documentIssues.status.awaitingCheck;
    case 'awaiting-window':
      return ui.documentIssues.status.awaitingWindow;
    case 'resolved':
      return ui.documentIssues.status.resolved;
  }
}

/** 第幾次送件，例如「第 2 次送件」；`number` 為 1 起算（原始送件為第 1 次，第一次重送為第 2 次）。 */
export function issueSubmissionLabel(number: number): string {
  return format(ui.documentIssues.submissionTemplate, { number });
}

/** 來源工作，例如「第一日 · 人員資料歸檔」；`task` 傳 bundle.ts 的 taskHeading(原歸檔工作)。 */
export function issueSourceTaskLabel(dayNumber: number, task: string): string {
  return format(ui.documentIssues.sourceTaskTemplate, { dayName: dayName(dayNumber), task });
}

/** 退件原因文字；沿用 ui.returnedReview.codeMismatch（不另存一份）。 */
export function issueReasonText(reason: IssueReason): string {
  switch (reason) {
    case 'code-mismatch':
      return ui.returnedReview.codeMismatch;
  }
}

/** 下游回條標題，例如「退件回條：RT-B102」「收件回條：RT-B102」；`caseNumber` 傳 caseNumber(auditId, key)。 */
export function receiptLabel(kind: IssueReceiptKind, caseNumber: string): string {
  const template = kind === 'returned' ? ui.documentIssues.receipts.returnedTemplate : ui.documentIssues.receipts.resolvedTemplate;
  return format(template, { caseNumber });
}

/**
 * 案件的顯示案號：以該稽核的 caseNumberTemplate 代入紀錄的存檔 key，例如 `caseNumber('day1-code-audit', 'B102')` →「RT-B102」。
 * 稽核已不在內容中（舊存檔）時退回 key 本身，不丟例外。
 */
export function caseNumber(auditId: string, key: string): string {
  const template = caseNumberTemplateOf(auditId);
  return template === undefined ? key : format(template, { key });
}

/** 日結轉場的大數字：補零到兩位（3 → 03、12 → 12）；三位數以上照原樣。 */
export function transitionCount(count: number): string {
  return String(count).padStart(2, '0');
}

/**
 * 訊息頁的介面字串；訊息內容本身走 bundle.ts 的頻道 API（messagesOfChannel／unlockedMessages／
 * promptOf／promptsOfChannel／chatDateLabel）。R7 移除 eyebrow 與 back（訊息頁不放「返回工作」）。
 */
export const MESSAGES = {
  /** 頻道欄最上方的通訊軟體名稱。 */
  workspace: ui.messages.workspace,
  /* 頻道列表與對話區（KB-R4-04）；分類標題與空狀態都來自資料檔。 */
  listLabel: ui.messages.listLabel,
  backToList: ui.messages.backToList,
  sectionTitle: ui.messages.sectionTitle,
  sectionEmpty: ui.messages.sectionEmpty,
  selectHeading: ui.messages.selectHeading,
  selectPrompt: ui.messages.selectPrompt,
  emptyChannel: ui.messages.emptyChannel,
  /** direct 對話 header 的狀態。 */
  online: ui.messages.online,
  /** department／group 對話 header 的成員數，例如「3 位成員」。 */
  memberCount: (count: number) => format(ui.messages.memberCountTemplate, { count }),
  /** 玩家回覆訊息列的作者名。 */
  you: ui.messages.you,
  quickReplyHeading: ui.messages.quickReplyHeading,
  skipReply: ui.messages.skipReply,
  /** 未讀的螢幕閱讀器文字；紅點之外一定有文字說明，不只靠顏色。 */
  unread: (count: number) => format(ui.messages.unreadTemplate, { count }),
  unreadChannel: (channel: string, count: number) =>
    format(ui.messages.unreadChannelTemplate, { channel, count }),
  /** 對方回應出現前的「正在輸入」提示。 */
  typing: (name: string) => format(ui.messages.typingTemplate, { name }),
  /** 停在歷史訊息上方、下方有新訊息時的「跳到最新」提示與其無障礙名稱（R12）。 */
  newBelow: ui.messages.newBelow,
  newBelowAria: ui.messages.newBelowAria,
} as const;

export const NEWS = {
  eyebrow: ui.news.eyebrow,
  title: welcome.title,
  body: welcome.body[0] ?? '',
  thanks: welcome.body[1] ?? '',
  maintenanceTitle: maintenance.title,
  maintenanceBody: maintenance.body[0] ?? '',
  back: ui.news.back,
} as const;

/* ---------- 桌面（R12） ---------- */

/** 電腦桌面的介面字（ui.desktop）：應用入口、主選單、狀態區與分頁標題。 */
export const DESKTOP_UI: DesktopUi = ui.desktop;

/** 應用入口的無障礙名稱，例如「開啟郵件」；`appName` 傳 DESKTOP_UI.apps 的名稱。 */
export function desktopOpenApp(appName: string): string {
  return format(ui.desktop.openAppTemplate, { app: appName });
}

/** 郵件入口的未讀數（螢幕閱讀器），例如「2 封未讀郵件」。 */
export function mailUnreadCount(count: number): string {
  return format(ui.desktop.mailUnreadTemplate, { count });
}

/* ---------- 郵件（R12） ---------- */

function requiredMailPack(id: string) {
  const pack = mailPack(id);
  if (pack === undefined) throw new Error(`content: 找不到郵件包 ${id}`);
  return pack;
}

/** 郵件應用的介面字（退件回條包 mail.return-receipts 的 ui；驗證保證此包存在）。 */
export const MAIL_UI: MailUi = requiredMailPack(RETURN_RECEIPT_MAIL_PACK_ID).ui;

/** 郵件的寄件者名稱（例如「資料作業窗口」）；未知郵件包回傳 undefined（舊存檔的包可能已移除）。 */
export function mailSenderName(packId: string): string | undefined {
  if (CONTENT.workday?.mail.packId === packId) return CONTENT.workday.mail.sender.name;
  return mailPack(packId)?.sender.name;
}

/** 郵件模板的代入值；只接受 MAIL_TEMPLATE_PLACEHOLDERS（案號、版本名稱、退件原因），皆為純文字。 */
export type MailTemplateParams = Readonly<Partial<Record<MailTemplatePlaceholder, string>>>;

/**
 * 代入郵件模板（主旨、內文一行或附件名）：只取代 `{caseNumber}`／`{versionLabel}`／`{reason}`，缺值代入空字串，
 * 其他大括號原樣保留（驗證保證模板沒有其他 placeholder）。純字串取代、不解析 HTML；畫面以文字插值呈現。
 */
export function renderMailTemplate(text: string, params: MailTemplateParams): string {
  return text.replace(PLACEHOLDER_PATTERN, (match, name: string) =>
    (MAIL_TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name) ? (params[name as MailTemplatePlaceholder] ?? '') : match,
  );
}

/**
 * 附件的版本名稱：null＝原始送件（MAIL_UI.initialVersion）；數字為保存的版本 index，畫面修訂號為 index＋1
 * （0 →「修訂 1」）。底層 ID 不變。
 */
export function mailVersionLabel(versionIndex: number | null): string {
  return versionIndex === null ? MAIL_UI.initialVersion : format(MAIL_UI.revisionTemplate, { revision: versionIndex + 1 });
}

/** 郵件的退件原因文字（MAIL_UI.codeMismatch）；沒有原因（收件回條）回傳空字串。 */
export function mailReasonText(reason: IssueReason | null): string {
  switch (reason) {
    case 'code-mismatch':
      return MAIL_UI.codeMismatch;
    case null:
      return '';
  }
}

/* ---------- 入職前情（R12） ---------- */

/**
 * 入職前情的介面字（入職包的 ui）：繼續／補完提示、簽名保存中／失敗、重試、登入提示與舊存檔顯示名
 * （舊存檔顯示名的常數是 bundle.ts 的 LEGACY_PLAYER_NAME，狀態層也用）。
 */
export const ONBOARDING_UI: OnboardingUi = ONBOARDING.ui;

/** 登入提示，例如「正在登入，王小明。」；`name` 為角色名（純文字代入）。 */
export function onboardingLoggingIn(name: string): string {
  return format(ONBOARDING.ui.loggingIn, { playerName: name });
}

/* ---------- 向同事詢問（R12） ---------- */

/** 詢問入口的文字（第一次「這個欄位是什麼？」、之後「查看予安的說明」）；未知提問回傳 undefined。 */
export function helpUi(requestId: string): HelpUi | undefined {
  return helpPackOf(requestId)?.ui;
}

/* ---------- M1 工作日（data/workday/） ---------- */

function requiredWorkday(): ContentWorkday {
  if (CONTENT.workday === null) throw new Error('content: 找不到 M1 工作日內容包（data/workday/）');
  return CONTENT.workday;
}

/** 工作佇列、文件、批次與交接的介面字（M1 內容包 ui）。 */
export const WORKDAY_UI: WorkdayUi = requiredWorkday().ui;

/** M1 延後回條的郵件包 ID。 */
export const WORKDAY_MAIL_PACK: string = requiredWorkday().mail.packId;

/** 延後回條的模板（主旨與內文）；未知模板回傳 undefined（舊存檔的模板可能已移除）。 */
export function workdayMailTemplate(packId: string, templateId: string): ContentWorkdayTemplate | undefined {
  const mail = CONTENT.workday?.mail;
  if (!mail || mail.packId !== packId) return undefined;
  return (mail.templates as Readonly<Record<string, ContentWorkdayTemplate | undefined>>)[templateId];
}

/** 某日結束後的離班／到班短文；沒有為 undefined。 */
export function interludeAfter(dayId: string): ContentInterlude | undefined {
  return CONTENT.workday?.interludes.find((i) => i.afterDay === dayId);
}

/** 進入某日時的到班短文（前一日的 interlude.arrive）；沒有為空陣列。 */
export function arriveLines(dayId: string): readonly string[] {
  return CONTENT.workday?.interludes.find((i) => i.beforeDay === dayId)?.arrive ?? [];
}

/** JSON 值的領域意義對照（例如「false＝未拒絕」）。 */
export function legendText(value: string, meaning: string): string {
  return format(WORKDAY_UI.legendTemplate, { value, meaning });
}

/** 附件關聯版本名稱：0＝原始送件；之後為「修訂 n」。 */
export function attachmentVersionLabel(index: number): string {
  return index === 0 ? MAIL_UI.initialVersion : format(MAIL_UI.revisionTemplate, { revision: index });
}
