import { NightResult, Stage } from '../core/types';
import { AUDIT_ID_PATTERN, CHOICE_ID_PATTERN, ContentMessage, ID_PATTERN, ID_PREFIX, MessageUnlockAfter } from './schema';

/**
 * game/content/conditions：解鎖條件與動作的白名單。
 *
 * 資料檔只寫 ID，全部的判斷都在這裡以 TypeScript 完成；
 * JSON 不得出現運算式、函式字串或 eval。未列在白名單的 ID 會被
 * validate-content.ts 判為錯誤，而不是在執行期默默當成 false。
 *
 * 日期不是條件（KB-R5-01）：訊息用 `visibleFrom`（day ID）表示「從這一天起可見」，
 * 之後各日仍留在頻道歷史。因此這裡沒有 `cond.day.N`，也不會逐日列舉。
 */

/**
 * 目前支援的解鎖條件。
 * - `cond.always`：無條件。
 * - `cond.stage.X`：目前處於哪個畫面階段（work＝工作台、wrap＝日結轉場、end＝Demo 結束）。
 * - `cond.night.smalltalk.N`：夜間閒聊版本；由存檔的 night 決定，重看不重抽。
 * 另有參數化的 `cond.review.any|none.<batchId>`（見 REVIEW_CONDITION_PREFIX）與
 * `cond.chat.<prompt 去前綴>.<choiceId>`（見 CHAT_CONDITION_PREFIX）、
 * `cond.case.<case 去前綴>.<decisionId>`（見 CASE_CONDITION_PREFIX，R9）、
 * `cond.return.notified.<auditId>`（見 RETURN_CONDITION_PREFIX，R10）與
 * `cond.help.<request 去前綴>.requested`（見 HELP_CONDITION_PREFIX，R12）。
 */
export const CONDITION_IDS = [
  'cond.always',
  'cond.stage.work',
  'cond.stage.wrap',
  'cond.stage.end',
  'cond.night.smalltalk.0',
  'cond.night.smalltalk.1',
] as const;

export type ConditionId = (typeof CONDITION_IDS)[number];

/**
 * 參數化的批次覆核條件（R6-03）：`cond.review.any.<batchId>`／`cond.review.none.<batchId>`。
 * 「指定批次是否至少有一筆 origin=review」，由呼叫端依存檔的 batches 推導（ConditionContext.hasReview）；
 * 不擲骰、不另存分支。同一批次的 any／none 兩則訊息因此永遠互斥。
 * 驗證（validate-content.ts）要求 batchId 是某個 archive 任務的批次，且該批次所屬日早於訊息的 visibleFrom。
 */
export const REVIEW_CONDITION_PREFIX = { any: 'cond.review.any.', none: 'cond.review.none.' } as const;
export type ReviewConditionMode = keyof typeof REVIEW_CONDITION_PREFIX;

export interface ReviewCondition {
  mode: ReviewConditionMode;
  batchId: string;
}

/** 組出批次覆核條件 ID，例如 `reviewConditionId('any', 'batch.day03.archive')`。 */
export function reviewConditionId(mode: ReviewConditionMode, batchId: string): string {
  return REVIEW_CONDITION_PREFIX[mode] + batchId;
}

/** 解析批次覆核條件；格式不符（含 batchId 缺 `batch.` 前綴或字元不合法）回傳 null。 */
export function parseReviewCondition(id: string): ReviewCondition | null {
  for (const mode of ['any', 'none'] as const) {
    const prefix = REVIEW_CONDITION_PREFIX[mode];
    if (!id.startsWith(prefix)) continue;
    const batchId = id.slice(prefix.length);
    return batchId.startsWith(ID_PREFIX.batch) && ID_PATTERN.test(batchId) ? { mode, batchId } : null;
  }
  return null;
}

/**
 * 參數化的聊天回覆條件（R7）：`cond.chat.<promptId 去掉 prompt.>.<choiceId>`，
 * 例如 `cond.chat.day3.lunch-plan.join` ↔ prompt `prompt.day3.lunch-plan` 的 choice `join`。
 * 只讀存檔保存的選擇（ConditionContext.chatChoice）；skipped 或尚未回答都不成立。
 * choiceId 不含 `.`，因此以最後一個 `.` 切開。
 * 驗證（validate-content.ts）要求 prompt 與 choice 存在，且 prompt 的 anchor visibleFrom 不晚於訊息的 visibleFrom。
 */
export const CHAT_CONDITION_PREFIX = 'cond.chat.';

export interface ChatCondition {
  /** 含 `prompt.` 前綴的完整 prompt ID。 */
  promptId: string;
  choiceId: string;
}

/** 組出聊天回覆條件 ID，例如 `chatConditionId('prompt.day3.lunch-plan', 'join')`。格式不符丟例外。 */
export function chatConditionId(promptId: string, choiceId: string): string {
  if (!promptId.startsWith(ID_PREFIX.prompt) || !ID_PATTERN.test(promptId) || !CHOICE_ID_PATTERN.test(choiceId)) {
    throw new Error(`content: 無法組出聊天條件（prompt ${promptId}，choice ${choiceId}）`);
  }
  return CHAT_CONDITION_PREFIX + promptId.slice(ID_PREFIX.prompt.length) + '.' + choiceId;
}

/** 解析聊天回覆條件；格式不符（缺 choice、字元不合法）回傳 null。prompt 是否存在由 validate-content.ts 另外檢查。 */
export function parseChatCondition(id: string): ChatCondition | null {
  if (!id.startsWith(CHAT_CONDITION_PREFIX)) return null;
  const rest = id.slice(CHAT_CONDITION_PREFIX.length);
  const cut = rest.lastIndexOf('.');
  if (cut <= 0) return null;
  const promptId = ID_PREFIX.prompt + rest.slice(0, cut);
  const choiceId = rest.slice(cut + 1);
  return ID_PATTERN.test(promptId) && CHOICE_ID_PATTERN.test(choiceId) ? { promptId, choiceId } : null;
}

/**
 * 參數化的比對案件條件（R9）：`cond.case.<caseId 去掉 case.>.<decisionId>`，
 * 例如 `cond.case.day3.h204.registry` ↔ 案件 `case.day3.h204` 的決定 `registry`。
 * 只讀存檔保存的案件決定（ConditionContext.caseDecision）；尚未決定、或舊存檔已歸檔但沒有案件決定，一律不成立。
 * decisionId 不含 `.`，因此以最後一個 `.` 切開。
 * 驗證（validate-content.ts）要求案件與決定存在，且案件所屬日**早於**訊息的 visibleFrom。
 */
export const CASE_CONDITION_PREFIX = 'cond.case.';

export interface CaseCondition {
  /** 含 `case.` 前綴的完整案件 ID。 */
  caseId: string;
  decisionId: string;
}

/** 組出案件條件 ID，例如 `caseConditionId('case.day3.h204', 'registry')`。格式不符丟例外。 */
export function caseConditionId(caseId: string, decisionId: string): string {
  if (!caseId.startsWith(ID_PREFIX.case) || !ID_PATTERN.test(caseId) || !CHOICE_ID_PATTERN.test(decisionId)) {
    throw new Error(`content: 無法組出案件條件（case ${caseId}，decision ${decisionId}）`);
  }
  return CASE_CONDITION_PREFIX + caseId.slice(ID_PREFIX.case.length) + '.' + decisionId;
}

/** 解析案件條件；格式不符（缺 decision、字元不合法）回傳 null。案件是否存在由 validate-content.ts 另外檢查。 */
export function parseCaseCondition(id: string): CaseCondition | null {
  if (!id.startsWith(CASE_CONDITION_PREFIX)) return null;
  const rest = id.slice(CASE_CONDITION_PREFIX.length);
  const cut = rest.lastIndexOf('.');
  if (cut <= 0) return null;
  const caseId = ID_PREFIX.case + rest.slice(0, cut);
  const decisionId = rest.slice(cut + 1);
  return ID_PATTERN.test(caseId) && CHOICE_ID_PATTERN.test(decisionId) ? { caseId, decisionId } : null;
}

/**
 * 參數化的退件通知條件（R10）：`cond.return.notified.<auditId>`，例如 `cond.return.notified.day1-code-audit`。
 * 只讀存檔（ConditionContext.returnNotified）：該稽核**已保存退件**且目前日已到通知日才成立；
 * 與退件目前是否仍待處理無關，因此處理完畢後通知仍留在訊息歷史。沒有退件（資料正確、保留待查、
 * 只確認收件、舊檔沒有審查處置）一律不成立。
 * 驗證（validate-content.ts）要求稽核存在，且稽核的通知日不晚於訊息的 visibleFrom。
 */
export const RETURN_CONDITION_PREFIX = 'cond.return.notified.';

export interface ReturnCondition {
  /** reconcile 任務 returnAudit 的 id（不含 `.`）。 */
  auditId: string;
}

/** 組出退件通知條件 ID，例如 `returnConditionId('day1-code-audit')`。格式不符丟例外。 */
export function returnConditionId(auditId: string): string {
  if (!AUDIT_ID_PATTERN.test(auditId)) throw new Error(`content: 無法組出退件條件（audit ${auditId}）`);
  return RETURN_CONDITION_PREFIX + auditId;
}

/** 解析退件通知條件；格式不符（缺 auditId、含 `.` 或大寫）回傳 null。稽核是否存在由 validate-content.ts 另外檢查。 */
export function parseReturnCondition(id: string): ReturnCondition | null {
  if (!id.startsWith(RETURN_CONDITION_PREFIX)) return null;
  const auditId = id.slice(RETURN_CONDITION_PREFIX.length);
  return AUDIT_ID_PATTERN.test(auditId) ? { auditId } : null;
}

/**
 * 參數化的詢問條件（R12）：`cond.help.<requestId 去掉 request.>.requested`，
 * 例如 `cond.help.refusal-record.requested` ↔ 提問 `request.refusal-record`。
 * 只讀存檔（ConditionContext.helpRequested）：玩家已送出該提問才成立，之後各日仍成立（說明永久留存）；
 * 成立只代表已觸發，不代表說明訊息都已送達（逐則送達由狀態層依保存的排程判斷）。
 * 驗證（validate-content.ts）要求提問存在，且只能用在該提問自己的說明訊息（help 包 messages）。
 */
export const HELP_CONDITION_PREFIX = 'cond.help.';
export const HELP_CONDITION_SUFFIX = '.requested';

export interface HelpCondition {
  /** 含 `request.` 前綴的完整提問 ID。 */
  requestId: string;
}

/** 組出詢問條件 ID，例如 `helpConditionId('request.refusal-record')`。格式不符丟例外。 */
export function helpConditionId(requestId: string): string {
  if (!requestId.startsWith(ID_PREFIX.request) || !ID_PATTERN.test(requestId)) {
    throw new Error(`content: 無法組出詢問條件（request ${requestId}）`);
  }
  return HELP_CONDITION_PREFIX + requestId.slice(ID_PREFIX.request.length) + HELP_CONDITION_SUFFIX;
}

/** 解析詢問條件；格式不符（缺提問、缺 `.requested`、字元不合法）回傳 null。提問是否存在由 validate-content.ts 另外檢查。 */
export function parseHelpCondition(id: string): HelpCondition | null {
  if (!id.startsWith(HELP_CONDITION_PREFIX) || !id.endsWith(HELP_CONDITION_SUFFIX)) return null;
  const rest = id.slice(HELP_CONDITION_PREFIX.length, id.length - HELP_CONDITION_SUFFIX.length);
  if (rest === '') return null;
  const requestId = ID_PREFIX.request + rest;
  return ID_PATTERN.test(requestId) ? { requestId } : null;
}

/** 白名單內的固定條件，或格式正確的參數化條件。批次／prompt／案件／稽核／提問是否存在由 validate-content.ts 另外檢查。 */
export function isConditionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return (
    (CONDITION_IDS as readonly string[]).includes(value) ||
    parseReviewCondition(value) !== null ||
    parseChatCondition(value) !== null ||
    parseCaseCondition(value) !== null ||
    parseReturnCondition(value) !== null ||
    parseHelpCondition(value) !== null
  );
}

/** 已停用的條件前綴；出現時驗證會提示改用 `visibleFrom` 或 `cond.stage.*`。 */
export const RETIRED_CONDITION_PREFIXES: readonly { prefix: string; hint: string }[] = [
  { prefix: 'cond.day.', hint: '日期改用訊息的 visibleFrom（day ID），不再寫在 unlock' },
  { prefix: 'cond.phase.', hint: 'phase 已停用，改用 cond.stage.work／wrap／end' },
];

/**
 * 內容可以引用的動作 ID；對應既有流程，資料檔本輪尚未使用。
 * 新增動作時必須同時在規則層實作，不得讓資料檔自行描述行為。
 */
export const ACTION_IDS = [
  'action.archive.commit',
  'action.day.complete',
  'action.day.advance',
  'action.document.open',
  'action.reply.submit',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && (ACTION_IDS as readonly string[]).includes(value);
}

/** 判斷條件時可以看到的狀態；只讀，不會回寫存檔，也不重抽亂數。 */
export interface ConditionContext {
  /** 目前內容日，例如 'day.02'。 */
  dayId: string;
  /** 由內容目錄解析日序（day 數字）；未知 day ID 回傳 NaN。通常傳 bundle.ts 的 dayOrder。 */
  dayOrder: (dayId: string) => number;
  /** 目前畫面階段。 */
  stage: Stage;
  /** 夜間判定結果；尚未判定時為 null。 */
  night: NightResult | null;
  /** 指定批次是否至少有一筆 origin==='review'；由存檔 batches 推導，唯讀。未知批次回傳 false。 */
  hasReview: (batchId: string) => boolean;
  /**
   * 指定 prompt 已保存的回答 choiceId（R7）；skipped、尚未回答或未知 prompt 一律回傳 null。
   * 由存檔的 chatReplies 推導，唯讀。
   */
  chatChoice: (promptId: string) => string | null;
  /**
   * 指定 archive 批次目前已提交的筆數（R8 §4）；由存檔 batches 推導，唯讀。未知批次回傳 0。
   * 訊息的 `unlockAfter` 讀這裡，因此列表、未讀、對話串與 replyPrompt 共用同一個判斷，刷新後依存檔重算。
   */
  archivedCount: (batchId: string) => number;
  /**
   * 指定比對案件已保存的決定 ID（R9）；尚未決定、未知案件，或舊存檔已歸檔該筆卻沒有案件決定，一律回傳 null。
   * 由存檔的歸檔快照（caseDecision）推導，唯讀；`cond.case.*` 讀這裡，列表、未讀與對話串因此一致。
   */
  caseDecision: (caseId: string) => string | null;
  /**
   * 指定稽核是否已通知退件（R10）：存檔中有該稽核的退件，且目前日 ≥ 通知日才回傳 true；
   * 與退件狀態（待處理／已重新送審／等待窗口確認）無關。未知稽核回傳 false。唯讀，不建立退件。
   * `cond.return.notified.*` 讀這裡，列表、未讀與對話串因此一致，刷新與跨日依存檔重算。
   */
  returnNotified: (auditId: string) => boolean;
  /**
   * 指定提問是否已送出（R12，存檔 helpRequests 有該提問 ID）；未知提問回傳 false。唯讀。
   * `cond.help.*` 讀這裡；只代表已觸發，個別說明訊息是否已送達由狀態層依保存的送達時間判斷。
   */
  helpRequested: (requestId: string) => boolean;
  /** M1：比對案件是否已開啟（存檔 caseReviews 有該案件）。省略＝一律 false。 */
  caseOpened?: (caseId: string) => boolean;
  /** M1：附件／批次／報告任務是否開啟過。省略＝一律 false。 */
  taskOpened?: (taskId: string) => boolean;
  /** M1：批次是否開啟過預覽、報告是否已建立。省略＝一律 false。 */
  taskPreviewed?: (taskId: string) => boolean;
}

/** 解析單一條件；未知 ID 一律回傳 false（驗證階段就會先擋下）。 */
export function evaluateCondition(id: string, ctx: ConditionContext): boolean {
  switch (id) {
    case 'cond.always':
      return true;
    case 'cond.stage.work':
      return ctx.stage === 'work';
    case 'cond.stage.wrap':
      return ctx.stage === 'wrap';
    case 'cond.stage.end':
      return ctx.stage === 'end';
    case 'cond.night.smalltalk.0':
      return ctx.night?.smallTalkVariant === 0;
    case 'cond.night.smalltalk.1':
      return ctx.night?.smallTalkVariant === 1;
    default: {
      const review = parseReviewCondition(id);
      if (review !== null) {
        const has = ctx.hasReview(review.batchId);
        return review.mode === 'any' ? has : !has;
      }
      const chat = parseChatCondition(id);
      if (chat !== null) return ctx.chatChoice(chat.promptId) === chat.choiceId;
      const decided = parseCaseCondition(id);
      if (decided !== null) return ctx.caseDecision(decided.caseId) === decided.decisionId;
      const returned = parseReturnCondition(id);
      if (returned !== null) return ctx.returnNotified(returned.auditId);
      const help = parseHelpCondition(id);
      if (help !== null) return ctx.helpRequested(help.requestId);
      return false;
    }
  }
}

/** `unlock` 全部條件都成立；空陣列代表無條件。不看日期。 */
export function conditionsHold(unlock: readonly string[], ctx: ConditionContext): boolean {
  return unlock.every((id) => evaluateCondition(id, ctx));
}

/**
 * 「從 visibleFrom 那一天起可見」：目前日序 ≥ visibleFrom 的日序。
 * 任一方解析不出日序（NaN）視為不可見，不會因為 NaN 比較而意外成立。
 */
export function isVisibleFrom(visibleFrom: string, ctx: ConditionContext): boolean {
  const now = ctx.dayOrder(ctx.dayId);
  const from = ctx.dayOrder(visibleFrom);
  return Number.isFinite(now) && Number.isFinite(from) && now >= from;
}

/**
 * 工作進度解鎖（R8 §4）：沒有 `unlockAfter` 時成立；有則指定批次已提交筆數 ≥ archivedCount。
 * 已提交的紀錄會鎖定、不會減少，因此一旦成立之後各日仍成立。
 */
export function progressHolds(unlockAfter: MessageUnlockAfter | undefined, ctx: ConditionContext): boolean {
  if (unlockAfter === undefined) return true;
  // M1：案件開啟、任務開啟、預覽／報告建立都只會由 false 變 true，與已提交筆數一樣不會倒退
  if ('caseOpened' in unlockAfter) return ctx.caseOpened?.(unlockAfter.caseOpened) ?? false;
  if ('taskOpened' in unlockAfter) return ctx.taskOpened?.(unlockAfter.taskOpened) ?? false;
  if ('taskPreviewed' in unlockAfter) return ctx.taskPreviewed?.(unlockAfter.taskPreviewed) ?? false;
  return ctx.archivedCount(unlockAfter.archiveBatchId) >= unlockAfter.archivedCount;
}

/**
 * 訊息是否已解鎖：已到 visibleFrom 的那一天（含之後各日）、unlock 全部成立，**且** unlockAfter（若有）成立。
 * 一旦某日解鎖，之後各日仍成立，因此頻道歷史不會跨日消失（KB-R5-01）。
 * 訊息列表、未讀、對話串與 replyPrompt 的 anchor 都應只走這個函式（或 bundle.ts 的 unlockedMessages）。
 */
export function isUnlocked(
  message: Pick<ContentMessage, 'visibleFrom' | 'unlock' | 'unlockAfter'>,
  ctx: ConditionContext,
): boolean {
  return (
    isVisibleFrom(message.visibleFrom, ctx) && conditionsHold(message.unlock, ctx) && progressHolds(message.unlockAfter, ctx)
  );
}
