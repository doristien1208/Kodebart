import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ALL_TASKS,
  LEGACY_PLAYER_NAME,
  ONBOARDING,
  contentTask,
  dayContentById,
  dayOrder,
  helpMessages,
  helpRequestOf,
  helpRequestOfMessage,
  promptOf,
  taskHeading,
} from '../content/bundle';
import { ConditionContext, isUnlocked } from '../content/conditions';
import { ARCHIVE_UI, DOCUMENT_ISSUES_UI, FIELD_MAP_UI, STORAGE, progressLabel } from '../content/text';
import {
  ArchivedRecord,
  Draft,
  FieldMapCheck,
  MissingPolicy,
  RecordKey,
  Reply,
  Save,
  SourceRecord,
  ValidationOk,
  ValidationResult,
  advanceDay,
  handledOnOrAfter,
  latestIssueCode,
  editableReceiptOf,
  setIssueDraft,
  markMailRead,
  requestHelp,
  advanceOnboarding,
  signContract,
  completeOnboarding,
  HelpRequestState,
  MailRecord,
  OnboardingProgress,
  scheduledIssues,
  isTaskApplicable,
  resubmitReturn,
  returnNotified,
  returnsOfAudit,
  sendReturnToWindow,
  setRecordReview,
  RecordReview,
  ReturnCase,
  ReviewDisposition,
  casePlanOf,
  caseDecisionOf,
  caseStateOf,
  commitCase,
  openCase,
  toggleCaseMark,
  CasePlan,
  CaseReviewState,
  activeTaskOf,
  eventDayId,
  isTaskWaived,
  startDay,
  TaskPlan,
  answerChat,
  chatChoiceOf,
  chatReplyOf,
  skipChat,
  ChatReply,
  allArchived,
  archivedCount,
  batchHasReview,
  batchIdOfTask,
  batchOf,
  canReply,
  commitArchive,
  completeWork,
  createSave,
  fieldMapCheck,
  fieldMapProgressOf,
  isArrangedInSave,
  isMessageRead,
  isTaskDone,
  lastDayNumber,
  markMessagesRead,
  markReceiptOpened,
  markReportOpened,
  planOf,
  previewFieldMap,
  reconcileProgressOf,
  setDraft,
  setFieldAssignment,
  setFieldBlankPolicy,
  submitFieldMap,
  submitReply,
  validateRecord,
  SAVE_VERSION,
  AttachmentInput,
  AttachmentProgress,
  ReportSnapshot,
  TransformCheck,
  TransformPolicy,
  TransformProgress,
  attachmentProgressOf,
  attachmentStatus,
  deliveredMail,
  isTaskOpen,
  isTaskOpened,
  isTaskPreviewed,
  isTaskSettled,
  markTaskOpened,
  pendingDependencies,
  previewTransform,
  reportOf,
  reportProgressOf,
  resolvedFieldMapTask,
  reviseAttachment,
  selectTask,
  setAttachmentDraft,
  setTransformPolicy,
  submitAttachment,
  submitReport,
  submitTransform,
  transformCheckOf,
  transformProgressOf,
  generateReport,
  checkTransform,
  findTask,
  transformMissingCount,
  TransformOutput,
} from '../core';
import { createSeed } from '../platform/seed';
import { DAY_DIRECTORY } from './day-directory';
import { GameClock, deliverySchedule } from './game-clock';
import { SaveRepository } from './save-repository';

/**
 * game/state：把純核心規則包成 Angular signals。
 *
 * 目前日、工作與批次全部由存檔的 `dayId` 經內容目錄查得（KB-R5-03）；
 * 呈現層讀 `dayContent()`／`task()`／`records()`，不再有 Day 1／Day 2 分支。
 * 所有寫入都經過 commit() → 存檔；呈現層只讀 signals，不自行擲骰。
 */
/** 交易式提交的結果：ok＝已保存；noop＝規則不允許（例如重複提交）；failed＝寫入失敗、可重試。 */
export type CommitOutcome = 'ok' | 'noop' | 'failed';

/** 當日工作清單的一項。 */
export interface DayTaskItem {
  taskId: string;
  kind: TaskPlan['kind'];
  /** 1 起算的順序。 */
  index: number;
  /** 工作名稱（內容 task text 的 heading）。 */
  heading: string;
  /** done＝已交付；waived＝舊檔免補（不代表已提交）；active＝進行中；pending＝待處理。 */
  status: 'done' | 'waived' | 'active' | 'pending';
  total: number;
  processed: number;
  /** M1：資料依賴尚未交付（不能開始）；工作佇列顯示「等待前一批交付」。 */
  locked: boolean;
  /** M1：可以切換成目前工作（work 階段、未完成、依賴已結清、不是目前工作）。 */
  selectable: boolean;
  /** M1：已送件但仍有待補（保留缺漏、附件待修正或批次有待補列）。 */
  awaiting: boolean;
  /** M1：尚未交付的依賴工作名稱（依內容順序）。 */
  waitingFor: readonly string[];
}

@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly repo = inject(SaveRepository);
  private readonly clock = inject(GameClock);
  private readonly dir = DAY_DIRECTORY;
  private readonly _save = signal<Save | null>(null);

  /** 目前存檔；null＝尚無紀錄（或讀取失敗）。 */
  readonly save = this._save.asReadonly();
  /** 儲存／讀取問題提示；空字串＝正常。 */
  readonly storageIssue = signal('');
  /** 一般操作提示（例如「歸檔完成。」）。 */
  readonly status = signal('');

  readonly hasSave = computed(() => this._save() !== null);
  readonly dayId = computed(() => this._save()?.dayId ?? null);
  readonly stage = computed(() => this._save()?.stage ?? null);
  readonly taskId = computed(() => this._save()?.taskId ?? null);

  /** 目前這一天的日程（工作種類、批次、下一天）。 */
  readonly plan = computed(() => {
    const s = this._save();
    return s ? planOf(s, this.dir) : null;
  });
  /** 目前這一天的內容（工作台標題、側欄、任務文字、轉場文字）。 */
  readonly dayContent = computed(() => {
    const id = this.dayId();
    return id ? dayContentById(id) : null;
  });
  /** 目前進行的工作：由存檔 taskId 在當日佇列中精確取得。 */
  readonly task = computed(() => {
    const s = this._save();
    return s ? activeTaskOf(s, this.dir) : null;
  });
  readonly nextDayId = computed(() => this.plan()?.nextDayId ?? null);
  /** 目前工作所讀寫（或檢視）的批次。 */
  readonly batchId = computed(() => {
    const t = this.task();
    return t ? batchIdOfTask(t) : null;
  });
  /** 目前批次的資料集合（歸檔佇列來源）；不再讀跨日全域清單。 */
  readonly records = computed<readonly SourceRecord[]>(() => {
    const b = this.batchId();
    return b ? this.dir.records(b) : [];
  });
  readonly totalRecords = computed(() => this.records().length);

  readonly archivedCount = computed(() => {
    const s = this._save();
    const b = this.batchId();
    return s && b ? archivedCount(s, b) : 0;
  });
  readonly allArchived = computed(() => {
    const s = this._save();
    const b = this.batchId();
    return s && b ? allArchived(s, b, this.records()) : false;
  });
  readonly night = computed(() => this._save()?.night ?? null);

  /** 目前這一天的工作內容（依 kind 分型的 ContentTask：文字、欄位、資料列）。 */
  readonly taskContent = computed(() => {
    const id = this.taskId();
    // 虛擬的錯誤文件處理位置（R11）不在內容檔中，沒有 ContentTask
    return id && ALL_TASKS.some((t) => t.id === id) ? contentTask(id) : null;
  });
  /** 日序（1 起算）。 */
  readonly dayNumber = computed(() => this.plan()?.dayNumber ?? 0);
  /** 最後一天的日序，給「N 日試玩完成」等標籤。 */
  readonly lastDayNumber = lastDayNumber(this.dir);
  /** 目前工作是否已完成（不看 stage）。 */
  readonly taskDone = computed(() => {
    const s = this._save();
    const t = this.task();
    return s && t ? isTaskDone(s, this.dir, t) : false;
  });

  /* ---------- 核對工作（reconcile）的進度 ---------- */

  /** 目前核對工作的進度；不是核對日時為 null。 */
  readonly reconcile = computed(() => {
    const s = this._save();
    const t = this.task();
    return s && t?.kind === 'reconcile' ? reconcileProgressOf(s, t.id) : null;
  });
  readonly reply = computed(() => this.reconcile()?.reply ?? null);
  readonly evidence = computed(() => {
    const p = this.reconcile();
    return { reportOpened: p?.reportOpened ?? false, receiptOpened: p?.receiptOpened ?? false };
  });
  /** 核對工作所看的那一筆（來源批次中的 subject）；不是核對日時為 null。 */
  readonly subjectKey = computed(() => {
    const t = this.task();
    return t?.kind === 'reconcile' ? t.subjectKey : null;
  });
  /** 四格矛盾結果：安排對象是否「已列入安排」。 */
  readonly arranged = computed(() => {
    const s = this._save();
    return s ? isArrangedInSave(s, this.dir) : false;
  });

  /* ---------- 欄位映射工作（field-map）的進度 ---------- */

  /** 目前欄位映射工作的日程（欄位、資料列；M1 起資料列依保存資料解析）；不是映射日時為 null。 */
  readonly fieldMapPlan = computed(() => {
    const s = this._save();
    const t = this.task();
    return s && t?.kind === 'field-map' ? resolvedFieldMapTask(s, t) : null;
  });
  readonly fieldMap = computed(() => {
    const s = this._save();
    const t = this.fieldMapPlan();
    return s && t ? fieldMapProgressOf(s, t.id) : null;
  });
  /** 目前對應的檢查結果（唯讀）；已提交時為提交快照。 */
  readonly fieldMapCheck = computed<FieldMapCheck | null>(() => {
    const s = this._save();
    return s && this.fieldMapPlan() ? fieldMapCheck(s, this.dir) : null;
  });

  /**
   * 當日有序工作清單（工作頁步驟、本日交接、次日收件共用）。
   * 狀態：active 之前＝已完成或免補；active＝進行中（work）；之後＝待處理；wrap／end 全部已完成或免補。
   * total＝這件工作的資料量（歸檔筆數、核對來源筆數、映射列數）；processed＝已處理的量。
   */
  readonly dayTasks = computed<readonly DayTaskItem[]>(() => {
    const s = this._save();
    const plan = this.plan();
    if (!s || !plan) return [];
    // 不適用的工作（沒有退件的複審）不出現在清單，也不佔序號
    const tasks = plan.tasks.filter((t) => isTaskApplicable(s, t));
    const headingOf = (t: TaskPlan) => (t.kind === 'return-review' ? DOCUMENT_ISSUES_UI.taskHeading : taskHeading(t.id));
    // M1：工作可自選順序，狀態依各工作自己的完成與依賴判斷（不再以「排在目前工作之前」推斷已完成）
    return tasks.map((t, i): DayTaskItem => {
      const waived = isTaskWaived(s, t.id);
      const done = isTaskDone(s, this.dir, t);
      const settled = isTaskSettled(s, this.dir, t);
      let status: DayTaskItem['status'];
      if (s.stage === 'wrap' || s.stage === 'end' || (settled && t.id !== s.taskId)) status = waived && !done ? 'waived' : 'done';
      else if (t.id === s.taskId && s.stage === 'work') status = 'active';
      else status = 'pending';
      const waiting = pendingDependencies(s, this.dir, t);
      return {
        taskId: t.id,
        kind: t.kind,
        index: i + 1,
        heading: headingOf(t),
        status,
        ...this.taskAmounts(s, t),
        locked: !settled && waiting.length > 0,
        selectable: s.stage === 'work' && t.id !== s.taskId && isTaskOpen(s, this.dir, t),
        awaiting: done && this.hasAwaiting(s, t),
        waitingFor: waiting.map(headingOf),
      };
    });
  });
  /**
   * 目前工作是當日最後一件未完成的工作（按鈕叫「完成今日交接」而不是「交付此項工作」）。
   * M1：其他尚未結清的工作即使還在等依賴（鎖住）也算「還有工作」，交付目前這件後就會開放。
   */
  readonly isLastTask = computed(() => {
    const s = this._save();
    const plan = this.plan();
    if (!s || !plan || s.stage !== 'work') return false;
    return plan.tasks.every((t) => t.id === s.taskId || isTaskSettled(s, this.dir, t));
  });

  /** 當日的事件（依 payload 的 dayId／taskId／batchId 歸屬），依發生順序；給系統作業紀錄。 */
  readonly dayEvents = computed(() => {
    const s = this._save();
    if (!s) return [];
    return s.events.filter((e) => eventDayId(e, this.dir) === s.dayId);
  });

  /**
   * 訊息解鎖條件的唯讀狀態（R7）：訊息列表、未讀與固定回覆共用同一份。
   * 讀 save()，因此批次或回覆變動時會重新計算。
   */
  readonly conditionContext = computed<ConditionContext | null>(() => {
    const s = this._save();
    if (!s) return null;
    return {
      dayId: s.dayId,
      dayOrder,
      stage: s.stage,
      night: s.night ?? null,
      hasReview: (batchId: string) => batchHasReview(s, batchId),
      archivedCount: (batchId: string) => archivedCount(s, batchId),
      caseDecision: (caseId: string) => caseDecisionOf(s, this.dir, caseId),
      caseOpened: (caseId: string) => s.caseReviews[caseId] !== undefined,
      taskOpened: (taskId: string) => isTaskOpened(s, taskId),
      taskPreviewed: (taskId: string) => isTaskPreviewed(s, taskId),
      returnNotified: (auditId: string) => returnNotified(s, this.dir, auditId),
      chatChoice: (promptId: string) => chatChoiceOf(s, promptId),
      helpRequested: (requestId: string) => s.helpRequests[requestId] !== undefined,
    };
  });

  /* ---------- 角色與入職（R12） ---------- */

  /** 入職簽名的角色名；null＝尚未簽名或舊存檔。 */
  readonly profileName = computed(() => this._save()?.profile.name ?? null);
  /** 顯示用的角色名（右上身分、登入提示、自己的聊天署名）；舊存檔顯示「員工」。 */
  readonly displayName = computed(() => this.profileName() ?? LEGACY_PLAYER_NAME);
  /** 入職前情進度；段落限制在內容 steps 範圍內（手改存檔也不會越界）。 */
  readonly onboarding = computed<OnboardingProgress | null>(() => {
    const o = this._save()?.onboarding;
    if (!o) return null;
    return { step: Math.min(o.step, ONBOARDING.steps.length - 1), complete: o.complete };
  });

  /** 狀態列文字：儲存問題 > 操作提示 > 已保存。 */
  readonly statusText = computed(() => this.storageIssue() || this.status() || STORAGE.saved);

  /** 封面「本機紀錄」標籤：由 dayNumber＋stage 經 JSON 樣板產生。 */
  readonly progressText = computed(() => {
    const s = this._save();
    return s ? progressLabel(this.dayNumber(), s.stage, this.lastDayNumber) : '';
  });

  constructor() {
    const loaded = this.repo.load(this.dir);
    this._save.set(loaded.save);
    this.storageIssue.set(loaded.issue);
    // 舊檔轉換後立刻寫回，避免每次載入都重新遷移
    if (loaded.save && loaded.migratedFrom !== null && loaded.migratedFrom !== SAVE_VERSION) {
      this.storageIssue.set(this.repo.persist(loaded.save));
    }
  }

  /** 已有紀錄或讀取失敗時，開始新遊戲前應先用對話框確認。 */
  needsOverwriteConfirm(): boolean {
    return this.hasSave() || this.storageIssue() !== '';
  }

  newGame(): void {
    this.status.set('');
    this.commit(createSave(createSeed(), this.dir));
  }

  /** 目前批次內的一筆資料；找不到即拋錯，避免靜默讀到別日資料。 */
  record(key: RecordKey): SourceRecord {
    const r = this.records().find((x) => x.key === key);
    if (!r) throw new Error(`Record ${key} is not in the current batch`);
    return r;
  }

  archived(key: RecordKey): ArchivedRecord | undefined {
    const s = this._save();
    const b = this.batchId();
    return s && b ? batchOf(s, b).archived[key] : undefined;
  }

  /** 讀草稿；不存在時回傳空草稿（不寫入）。 */
  draft(key: RecordKey): Draft {
    const s = this._save();
    const b = this.batchId();
    return (s && b ? batchOf(s, b).drafts[key] : undefined) ?? { value: '' };
  }

  updateDraft(key: RecordKey, patch: Partial<Draft>): void {
    const s = this._save();
    const b = this.batchId();
    if (!s || !b || s.stage !== 'work') return;
    const draft: Draft = { ...this.draft(key), ...patch };
    // 清空處理方式＝移除欄位（空字串不是合法的決定 ID）
    if (!draft.decisionId) delete draft.decisionId;
    this.commit(setDraft(s, b, key, draft));
  }

  validate(key: RecordKey): ValidationResult {
    return validateRecord(this.record(key), this.draft(key));
  }

  /** 確認歸檔：提交鎖定，已提交者忽略；連同來源快照保存。 */
  archive(key: RecordKey, ok: ValidationOk): void {
    const s = this._save();
    const b = this.batchId();
    if (!s || !b || this.archived(key) || this.caseFor(key)) return;
    if (this.apply((cur) => commitArchive(cur, b, this.record(key), ok))) this.status.set(ARCHIVE_UI.statusArchived);
  }

  /* ---------- 多來源比對案件（R9） ---------- */

  /** 目前歸檔工作中，這筆紀錄的案件計畫；一般紀錄為 undefined。 */
  caseFor(key: RecordKey): CasePlan | undefined {
    const t = this.task();
    return t ? casePlanOf(t, key) : undefined;
  }

  /** 案件的閱讀狀態（變體與差異標記）；尚未開案為 undefined。 */
  caseState(caseId: string): CaseReviewState | undefined {
    const s = this._save();
    return s ? caseStateOf(s, caseId) : undefined;
  }

  /** 已保存的案件決定 ID；未決定為 null。 */
  caseDecision(caseId: string): string | null {
    const s = this._save();
    return s ? caseDecisionOf(s, this.dir, caseId) : null;
  }

  /** 開案：第一次開啟時選定並保存補件收件狀態變體；之後不重抽。 */
  openCase(caseId: string): void {
    this.apply((s) => openCase(s, this.dir, caseId));
  }

  toggleCaseMark(caseId: string, label: string): void {
    this.apply((s) => toggleCaseMark(s, this.dir, caseId, label));
  }

  /**
   * 提交案件決定（三種都合法）：決定＝依據／去向／註記，人員編號為玩家填寫的 code（只驗型別）。
   * 回傳是否成功。
   */
  commitCase(key: RecordKey, decisionId: string, code: string): boolean {
    return this.commitCaseStrict(key, decisionId, code) === 'ok';
  }

  /* ---------- 逐筆審查與延後退件（R10） ---------- */

  /** 目前核對工作中某筆的審查處置；未處置為 undefined。 */
  recordReview(key: RecordKey): RecordReview | undefined {
    return this.reconcile()?.reviews?.[key];
  }

  /** 逐筆審查：核對後放行／保留待查（回覆前可改）。 */
  setRecordReview(key: RecordKey, disposition: ReviewDisposition): void {
    this.apply((s) => setRecordReview(s, this.dir, key, disposition));
  }

  /** 目前退件複審工作的退件項目；不是複審工作時為空陣列。 */
  readonly activeReturns = computed<readonly ReturnCase[]>(() => {
    const s = this._save();
    const t = this.task();
    return s && t?.kind === 'return-review' ? scheduledIssues(s, t.dayId) : [];
  });

  /* ---------- 文件問題頁（R11）：跨日可查看，與當日工作佇列共用案件狀態 ---------- */

  /** 待修正件數（一般未處理數）。 */
  readonly pendingIssueCount = computed(() => this.returns().filter((r) => r.status === 'pending').length);

  /**
   * 案件目前可建立新修訂的回條 ID（R12）：最新回條為退件且案件待修正；其餘（舊回條、待核對、待窗口、已結案）為 null。
   */
  editableReceiptId(caseId: string): string | null {
    const item = this.returns().find((r) => r.id === caseId);
    return item ? (editableReceiptOf(item)?.id ?? null) : null;
  }

  /** 某份回條的修訂草稿；沒有為 undefined（過期回條的草稿仍可讀出供查看）。 */
  issueDraft(receiptId: string): string | undefined {
    return this._save()?.issueDrafts[receiptId];
  }

  /** 寫入修訂草稿；只有目前可修訂的回條會寫入。 */
  setIssueDraft(receiptId: string, value: string): void {
    this.apply((s) => setIssueDraft(s, receiptId, value));
  }

  /* ---------- 郵件（R12） ---------- */

  /** 已送達的郵件（依收到順序）；M1 一般回條在送達前不出現。 */
  readonly mailbox = computed<readonly MailRecord[]>(() => {
    const s = this._save();
    return s ? deliveredMail(s, this.dir) : [];
  });
  /** 未開啟過的郵件數（只算已送達的）；與案件是否解決無關。 */
  readonly unreadMailCount = computed(() => {
    const s = this._save();
    if (!s) return 0;
    const read = new Set(s.readMail);
    return this.mailbox().filter((m) => !read.has(m.id)).length;
  });

  isMailRead(mailId: string): boolean {
    return this._save()?.readMail.includes(mailId) ?? false;
  }

  /** 開啟郵件時標已讀（開收件匣不算）。 */
  markMailRead(mailIds: readonly string[]): void {
    this.apply((s) => markMailRead(s, mailIds));
  }

  /* ---------- 向同事詢問（R12） ---------- */

  helpRequest(requestId: string): HelpRequestState | undefined {
    return this._save()?.helpRequests[requestId];
  }

  /**
   * 提問（每份存檔一次）：保存玩家提問的遊戲日與實際時間，說明訊息依回覆節奏逐則排定送達時間。
   * 已問過回傳 false、不寫入（再次點擊只定位既有說明）。
   */
  requestHelp(requestId: string): boolean {
    const s = this._save();
    if (!s || s.helpRequests[requestId] || !helpRequestOf(requestId)) return false;
    const messages = helpMessages(requestId);
    const askedAt = this.clock.now();
    const times = deliverySchedule(askedAt, messages.length, this.clock.random);
    const deliveries = messages.map((m, i) => ({ messageId: m.id, at: times[i] as number }));
    return this.apply((cur) => requestHelp(cur, requestId, askedAt, deliveries));
  }

  /** 由提問排定的說明訊息是否已送達（非提問訊息回傳 true）；以實際時間判斷，不寫入。 */
  isHelpMessageDelivered(messageId: string, now = this.clock.now()): boolean {
    const requestId = helpRequestOfMessage(messageId);
    if (requestId === undefined) return true;
    const at = this.helpRequest(requestId)?.deliveries.find((d) => d.messageId === messageId)?.at;
    return at !== undefined && at <= now;
  }

  /* ---------- M1：工作佇列、附件關聯、批次轉換、交付報告 ---------- */

  /** 切換目前工作（只能切到當日可開始的工作）；回傳是否切換。 */
  selectTask(taskId: string): boolean {
    this.status.set('');
    return this.apply((s) => selectTask(s, this.dir, taskId));
  }

  /** 第一次開啟附件／批次／報告工作時記下（訊息依此解鎖）。 */
  markTaskOpened(): void {
    this.apply((s) => markTaskOpened(s, this.dir));
  }

  attachmentProgress(taskId: string): AttachmentProgress {
    const s = this._save();
    return s ? attachmentProgressOf(s, taskId) : { kind: 'attachment', opened: false, versions: [], checks: [] };
  }

  /** 附件草稿（目前工作尚未送件，或可修訂的版本）。 */
  setAttachmentDraft(taskId: string, draft: AttachmentInput): void {
    this.apply((s) => setAttachmentDraft(s, this.dir, taskId, draft));
  }

  submitAttachmentStrict(input: AttachmentInput): CommitOutcome {
    return this.applyStrict((s) => submitAttachment(s, this.dir, input), '');
  }

  /** 修訂（版本鎖定）：expectedIndex 必須仍是可修訂的版本，否則 'noop'。 */
  reviseAttachmentStrict(taskId: string, expectedIndex: number, input: AttachmentInput): CommitOutcome {
    return this.applyStrict((s) => reviseAttachment(s, this.dir, taskId, expectedIndex, input), '');
  }

  transformProgress(taskId: string): TransformProgress {
    const s = this._save();
    return s ? transformProgressOf(s, taskId) : { kind: 'transform', opened: false, previewed: false, previewedOnce: false };
  }

  /** 某個批次的檢查結果（已交付＝交付快照）。 */
  transformCheck(taskId: string): TransformCheck | null {
    const s = this._save();
    return s ? transformCheckOf(s, this.dir, taskId) : null;
  }

  /**
   * 批次的列（顯示用）：已交付＝快照；否則依目前策略即時建立（尚未選策略時以「保留缺漏」顯示，
   * 只用來列出輸入與哪些列有缺漏，不代表已選）。
   */
  transformDisplay(taskId: string): TransformOutput | null {
    const s = this._save();
    const task = findTask(this.dir, taskId);
    if (!s || task?.kind !== 'transform') return null;
    const p = transformProgressOf(s, taskId);
    if (p.submitted) return p.submitted;
    const check = checkTransform(s, this.dir, task, p.policy ?? 'review');
    return check.ok ? check.output : null;
  }

  /** 這批有沒有需要選策略的缺漏列。 */
  transformMissing(taskId: string): number {
    const s = this._save();
    const task = findTask(this.dir, taskId);
    return s && task?.kind === 'transform' ? transformMissingCount(s, this.dir, task) : 0;
  }

  setTransformPolicy(policy: TransformPolicy): void {
    this.apply((s) => setTransformPolicy(s, this.dir, policy));
  }

  /** 建立批次預覽；回傳是否通過（缺策略時不通過、不寫入）。 */
  previewTransform(): boolean {
    this.apply((s) => previewTransform(s, this.dir));
    const id = this.taskId();
    return id !== null && this.transformCheck(id)?.ok === true && this.transformProgress(id).previewed;
  }

  submitTransformStrict(): CommitOutcome {
    return this.applyStrict((s) => submitTransform(s, this.dir), '');
  }

  /** 報告（已交付＝快照；未交付依保存資料即時建立；欄位映射未匯入為 null）。 */
  report(taskId: string): ReportSnapshot | null {
    const s = this._save();
    return s ? reportOf(s, this.dir, taskId) : null;
  }

  reportGenerated(taskId: string): boolean {
    const s = this._save();
    return s ? reportProgressOf(s, taskId).generated : false;
  }

  generateReport(): boolean {
    return this.apply((s) => generateReport(s, this.dir));
  }

  submitReportStrict(): CommitOutcome {
    return this.applyStrict((s) => submitReport(s, this.dir), '');
  }

  /** 某個附件關聯工作的目前狀態。 */
  attachmentStatus(taskId: string): ReturnType<typeof attachmentStatus> {
    return attachmentStatus(this.attachmentProgress(taskId));
  }

  /** 某案件最後一次實際送出的編號（修訂表單預填用）。 */
  latestIssueCode(item: ReturnCase): string {
    return latestIssueCode(item);
  }

  /** 全部退件（含已處理），給歷史與紀錄使用。 */
  readonly returns = computed<readonly ReturnCase[]>(() => this._save()?.returns ?? []);

  /* ---------- 交易式提交（給 WorkOperationsService）：持久化成功才前進 ---------- */

  archiveStrict(key: RecordKey, ok: ValidationOk): CommitOutcome {
    const b = this.batchId();
    if (!b || this.archived(key) || this.caseFor(key)) return 'noop';
    const record = this.records().find((r) => r.key === key);
    if (!record) return 'noop';
    return this.applyStrict((cur) => commitArchive(cur, b, record, ok), ARCHIVE_UI.statusArchived);
  }

  commitCaseStrict(key: RecordKey, decisionId: string, code: string): CommitOutcome {
    const record = this.records().find((r) => r.key === key);
    if (!record) return 'noop';
    const policy = this.draft(key).policy;
    return this.applyStrict((s) => commitCase(s, this.dir, record, decisionId, code, policy), ARCHIVE_UI.statusArchived);
  }

  submitReplyStrict(reply: Reply): CommitOutcome {
    return this.applyStrict((s) => submitReply(s, this.dir, reply), '');
  }

  submitFieldMapStrict(): CommitOutcome {
    return this.applyStrict((s) => submitFieldMap(s, this.dir), FIELD_MAP_UI.statusImported);
  }

  /** 修訂重送（版本鎖定）：receiptId 必須仍是目前可修訂的回條，否則 'noop'，不覆寫新版本。 */
  resubmitReturnStrict(returnId: string, receiptId: string, code: string): CommitOutcome {
    return this.applyStrict((s) => resubmitReturn(s, this.dir, returnId, code, receiptId), '');
  }

  sendReturnToWindowStrict(returnId: string, receiptId: string): CommitOutcome {
    return this.applyStrict((s) => sendReturnToWindow(s, this.dir, returnId, receiptId), '');
  }

  /* ---------- 入職前情與簽名（R12） ---------- */

  /**
   * 前進到下一段（逐段）：合約段必須先簽名（簽名本身會前進），最後一段之後改用 completeOnboarding。
   */
  advanceOnboarding(step: number): boolean {
    const s = this._save();
    const o = this.onboarding();
    if (!s || !o || o.complete || step !== s.onboarding.step + 1 || step >= ONBOARDING.steps.length) return false;
    if (ONBOARDING.steps[s.onboarding.step]?.kind === 'contract') return false;
    return this.apply((cur) => advanceOnboarding(cur, step));
  }

  /** 簽名（交易式）：必須停在合約段、尚未簽名；名字依核心規則正規化。 */
  signContractStrict(name: string): CommitOutcome {
    const s = this._save();
    if (!s || ONBOARDING.steps[s.onboarding.step]?.kind !== 'contract') return 'noop';
    return this.applyStrict((cur) => signContract(cur, name), '');
  }

  /** 完成入職（已簽名、停在最後一段）：之後進登入與桌面。 */
  completeOnboarding(): boolean {
    const s = this._save();
    if (!s || s.onboarding.step < ONBOARDING.steps.length - 1) return false;
    return this.apply((cur) => completeOnboarding(cur));
  }

  /** 完成今日交接（歸檔、欄位映射）→ 日結轉場或結束。回傳是否成功。 */
  completeWork(): boolean {
    const s = this._save();
    if (!s) return false;
    const next = completeWork(s, this.dir);
    if (next === s) return false;
    this.status.set('');
    this.commit(next);
    return true;
  }

  /** 日結轉場 → 下一天（或 Demo 結束）；夜間判定只在第一次跨日擲一次。 */
  advanceDay(): void {
    this.apply((s) => advanceDay(s, this.dir));
  }

  /** 次日收件 → 開始今日工作。 */
  startDay(): void {
    this.apply((s) => startDay(s));
  }

  openReport(): void {
    const s = this._save();
    if (s) this.commit(markReportOpened(s, this.dir));
  }

  openReceipt(): void {
    const s = this._save();
    if (s) this.commit(markReceiptOpened(s, this.dir));
  }

  canReply(reply: Reply): boolean {
    const s = this._save();
    return s ? canReply(s, this.dir, reply) : false;
  }

  submitReply(reply: Reply): boolean {
    const s = this._save();
    if (!s) return false;
    const next = submitReply(s, this.dir, reply);
    if (next === s) return false;
    this.status.set('');
    this.commit(next);
    return true;
  }

  /* ---------- 欄位映射 ---------- */

  /** 設定目標欄位的來源；空字串＝清除。會清除已預覽狀態。 */
  setFieldAssignment(targetId: string, sourceId: string): void {
    this.apply((s) => setFieldAssignment(s, this.dir, targetId, sourceId));
  }

  setFieldBlankPolicy(policy: MissingPolicy): void {
    this.apply((s) => setFieldBlankPolicy(s, this.dir, policy));
  }

  /** 驗證並預覽：回傳檢查結果；通過時標記已預覽。錯誤不改存檔。 */
  previewFieldMap(): FieldMapCheck | null {
    this.apply((s) => previewFieldMap(s, this.dir));
    return this.fieldMapCheck();
  }

  /** 確認匯入：鎖定快照並寫事件；回傳是否成功。 */
  submitFieldMap(): boolean {
    const changed = this.apply((s) => submitFieldMap(s, this.dir));
    if (changed) this.status.set(STORAGE.saved);
    return changed;
  }

  /* ---------- 訊息固定回覆（R7） ---------- */

  /** 某個 prompt 已保存的回覆；未回覆為 undefined。 */
  chatReply(promptId: string): ChatReply | undefined {
    const s = this._save();
    return s ? chatReplyOf(s, promptId) : undefined;
  }

  /** 已回答的選項 id；skipped 或未回答為 null。 */
  chatChoice(promptId: string): string | null {
    const s = this._save();
    return s ? chatChoiceOf(s, promptId) : null;
  }

  /**
   * 目前是否可回答：錨點訊息已解鎖（含 visibleFrom 與條件）、今天不晚於 availableThrough、
   * 尚未 answered／skipped。超過期限未回覆即視為自然未回覆，不寫入任何東西。
   */
  isPromptOpen(promptId: string): boolean {
    const s = this._save();
    const ctx = this.conditionContext();
    const found = promptOf(promptId);
    if (!s || !ctx || !found || chatReplyOf(s, promptId)) return false;
    if (!isUnlocked(found.anchor, ctx)) return false;
    // 由提問排定的說明訊息要實際送達後才能回覆（R12）
    if (!this.isHelpMessageDelivered(found.anchor.id)) return false;
    const today = dayOrder(s.dayId);
    const through = dayOrder(found.prompt.availableThrough);
    return Number.isFinite(through) && today <= through;
  }

  /**
   * 選擇固定回覆：保存玩家文字與回應快照，以及回答時間、遊戲日與逐則送達時間（3–4 秒累加，擲一次後保存）；
   * 回傳是否成功（重複點擊或過期時為 false）。
   */
  answerPrompt(promptId: string, choiceId: string): boolean {
    if (!this.isPromptOpen(promptId)) return false;
    const choice = promptOf(promptId)?.prompt.choices.find((c) => c.id === choiceId);
    if (!choice) return false;
    const answeredAt = this.clock.now();
    const deliverAt = deliverySchedule(answeredAt, choice.responses.length, this.clock.random);
    return this.apply((s) => answerChat(s, promptId, choice, { answeredAt, deliverAt }));
  }

  /** 不回覆：只保存 skipped。 */
  skipPrompt(promptId: string): boolean {
    if (!this.isPromptOpen(promptId)) return false;
    return this.apply((s) => skipChat(s, promptId));
  }

  /** 訊息條件用：某批次是否至少有一筆送覆核（唯讀，從保存結果推導）。 */
  hasReview(batchId: string): boolean {
    const s = this._save();
    return s ? batchHasReview(s, batchId) : false;
  }

  /* ---------- 訊息已讀 ---------- */

  isMessageRead(messageId: string): boolean {
    const s = this._save();
    return s ? isMessageRead(s, messageId) : false;
  }

  /** 標記已讀；不重抽亂數、不觸發工作事件。 */
  markMessagesRead(messageIds: readonly string[]): void {
    const s = this._save();
    if (!s || messageIds.length === 0) return;
    const next = markMessagesRead(s, messageIds);
    if (next !== s) this.commit(next);
  }

  private taskAmounts(s: Save, t: TaskPlan): { total: number; processed: number } {
    switch (t.kind) {
      case 'archive':
        return { total: this.dir.records(t.batchId).length, processed: archivedCount(s, t.batchId) };
      case 'reconcile': {
        // 核對量＝這件核對工作引用的紀錄數（Day 2 為 2），不是整個來源批次
        const total = t.recordKeys.length;
        return { total, processed: reconcileProgressOf(s, t.id).reply ? total : 0 };
      }
      case 'field-map':
        return { total: t.rows.length, processed: fieldMapProgressOf(s, t.id).submitted?.rowCount ?? 0 };
      case 'return-review': {
        // 與 isTaskDone 同一規則：當天（或之後）有處理版本就算本日已處理，與之後是否再被退回無關
        const items = scheduledIssues(s, t.dayId);
        return { total: items.length, processed: items.filter((r) => handledOnOrAfter(r, t.dayId, this.dir)).length };
      }
      case 'attachment':
        return { total: 1, processed: attachmentProgressOf(s, t.id).versions.length > 0 ? 1 : 0 };
      case 'transform':
        return { total: t.rows.length, processed: transformProgressOf(s, t.id).submitted?.rows.length ?? 0 };
      case 'report': {
        const report = reportProgressOf(s, t.id).submitted;
        return { total: report?.rows.length ?? 0, processed: report?.rows.length ?? 0 };
      }
    }
  }

  /** 已送件但仍有待補：附件保留缺漏或待修正、批次有待補列、報告列有待補。 */
  private hasAwaiting(s: Save, t: TaskPlan): boolean {
    switch (t.kind) {
      case 'attachment': {
        const p = attachmentProgressOf(s, t.id);
        const latest = p.versions[p.versions.length - 1];
        return latest?.destination === 'review' || attachmentStatus(p) === 'returned';
      }
      case 'transform':
        return (transformProgressOf(s, t.id).submitted?.pendingCount ?? 0) > 0;
      case 'report':
        return (reportProgressOf(s, t.id).submitted?.pendingCount ?? 0) > 0;
      case 'archive':
        return batchHasReview(s, t.batchId);
      default:
        return false;
    }
  }

  /**
   * 交易式套用：先寫入本機存檔，成功才更新畫面狀態；失敗時存檔與畫面都停在原狀，可重試而不重複事件。
   */
  private applyStrict(fn: (s: Save) => Save, statusText: string): CommitOutcome {
    const s = this._save();
    if (!s) return 'noop';
    const next = fn(s);
    if (next === s) return 'noop';
    const issue = this.repo.persist(next);
    this.storageIssue.set(issue);
    if (issue !== '') return 'failed';
    this._save.set(next);
    if (statusText) this.status.set(statusText);
    return 'ok';
  }

  /** 套用純函式；有變動才寫檔。回傳是否有變動。 */
  private apply(fn: (s: Save) => Save): boolean {
    const s = this._save();
    if (!s) return false;
    const next = fn(s);
    if (next === s) return false;
    this.commit(next);
    return true;
  }

  private commit(next: Save): void {
    this._save.set(next);
    this.storageIssue.set(this.repo.persist(next));
  }
}
