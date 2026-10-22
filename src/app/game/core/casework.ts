import { rand } from './rand';
import { DayId, TaskId } from './types';

/**
 * M2 案件檔案夾與送件包的純規則（不依賴 Angular、DOM、localStorage 或 content）。
 *
 * - 引用是資料操作：保存 documentId／版本／fieldIndex／label／value 的不可變快照；下游只拿到實際引用的段落，
 *   未引用的原件仍留在本機歷史，不因沒傳就刪除。
 * - 程序驗證只檢查有效選項、合法引用、最少引用數與必要來源；不以引用語意或來源相等擋送。
 * - 查詢的早回／次日回以 seed＋固定 eventId 擲一次並保存；刷新、切窗、讀取不重抽，晚回不改既成事實。
 * - 案件定義（選項輸出 enum、文件、查詢、條件回條）由 state adapter 從內容轉成這裡的型別傳入。
 */

/* ---------- 案件種類與選項輸出（內容 enum 的白名單） ---------- */

export type CaseVariant =
  | 'batch-scope'
  | 'contact-route'
  | 'receipt-followup'
  | 'service-proposal'
  | 'citation-packet'
  | 'batch-followup'
  | 'report-framing';
export const CASE_VARIANTS: readonly CaseVariant[] = [
  'batch-scope',
  'contact-route',
  'receipt-followup',
  'service-proposal',
  'citation-packet',
  'batch-followup',
  'report-framing',
];

export type ScopeRoute = 'window-all' | 'window-ready' | 'source-review';
export const SCOPE_ROUTES: readonly ScopeRoute[] = ['window-all', 'window-ready', 'source-review'];
export type PendingDisposition = 'included-and-marked' | 'separate-list' | 'source-requested';
export const PENDING_DISPOSITIONS: readonly PendingDisposition[] = ['included-and-marked', 'separate-list', 'source-requested'];
export type ContactRoute = 'registry-window' | 'training-window' | 'manual-check';
export const CONTACT_ROUTES: readonly ContactRoute[] = ['registry-window', 'training-window', 'manual-check'];
export type FollowupRoute = 'continue-current' | 'handoff-clarification';
export const FOLLOWUP_ROUTES: readonly FollowupRoute[] = ['continue-current', 'handoff-clarification'];
export type NoticeState = 'queued' | 'pending' | 'forwarding';
export const NOTICE_STATES: readonly NoticeState[] = ['queued', 'pending', 'forwarding'];
export type ProposalRoute = 'morning-draft' | 'afternoon-request' | 'awaiting-arrangement';
export const PROPOSAL_ROUTES: readonly ProposalRoute[] = ['morning-draft', 'afternoon-request', 'awaiting-arrangement'];
export type PacketRoute = 'standard-packet' | 'manual-read-packet';
export const PACKET_ROUTES: readonly PacketRoute[] = ['standard-packet', 'manual-read-packet'];
export type ScopeFollowupRoute = 'receipt-only' | 'receipt-and-pending';
export const SCOPE_FOLLOWUP_ROUTES: readonly ScopeFollowupRoute[] = ['receipt-only', 'receipt-and-pending'];
export type ReportFocus = 'procedure' | 'window-status' | 'open-questions';
export const REPORT_FOCUSES: readonly ReportFocus[] = ['procedure', 'window-status', 'open-questions'];

/**
 * 選項的輸出（依案件種類分型）。只有這些 enum 會影響規則；選項名稱與說明只是內容文字，
 * 不按名稱推斷要補上哪些引用。
 */
export type CaseChoiceOutput =
  | { variant: 'batch-scope'; route: ScopeRoute; pendingDisposition: PendingDisposition }
  | { variant: 'contact-route'; route: ContactRoute; noticeState: NoticeState }
  | { variant: 'receipt-followup'; route: FollowupRoute; noticeState: NoticeState }
  | {
      variant: 'service-proposal';
      route: ProposalRoute;
      /** 選項本身載明的時段（例如代理清單的預排）；沒有為 null。 */
      proposedTime: string | null;
      /** 查覆已到才附上查覆文件，未到只寫申請備註的需求，不編造可用時段。 */
      useInquiryWhenArrived: boolean;
    }
  | { variant: 'citation-packet'; route: PacketRoute }
  | { variant: 'batch-followup'; route: ScopeFollowupRoute; pendingTransferred: boolean }
  | { variant: 'report-framing'; focus: ReportFocus };

export interface CaseChoicePlan {
  id: string;
  output: CaseChoiceOutput;
}

/** 一件案件工作（M2）：目的、可開文件、綁定的已保存資料、查詢入口與選項。 */
export interface CaseworkPlan {
  caseId: string;
  taskId: TaskId;
  variant: CaseVariant;
  /** 可開啟並引用的來源文件，順序即列表順序。 */
  documentIds: readonly string[];
  /** 讀取的已保存資料（白名單綁定 ID）。 */
  bindingIds: readonly string[];
  /** 承辦查詢入口；沒有為 null。 */
  inquiryId: string | null;
  /** 交付前至少要有幾段引用。 */
  minimumCitations: number;
  choices: readonly CaseChoicePlan[];
}

/* ---------- 可引用的文件與引用快照 ---------- */

export interface CaseDocumentField {
  label: string;
  value: string;
}

/** 一份可引用的文件：內容原件（version 0）或依保存資料生成的副本（version＝來源送件版本序號＋1）。 */
export interface CaseDocument {
  id: string;
  version: number;
  heading: string;
  fields: readonly CaseDocumentField[];
}

/** 生成副本的版本號：來源送件第 n 版（0 起算）→ n＋1；來源缺漏時沿用內容原件的 0。 */
export function generatedVersionOf(sourceVersionIndex: number | null): number {
  return sourceVersionIndex === null ? 0 : sourceVersionIndex + 1;
}

/** 送件包的一段引用：加入當下的不可變快照。原文件之後異動也不回寫舊包。 */
export interface CaseCitation {
  documentId: string;
  version: number;
  fieldIndex: number;
  label: string;
  value: string;
}

/** 由文件欄位建立引用快照；欄位不存在回傳 null。 */
export function citationOf(doc: CaseDocument, fieldIndex: number): CaseCitation | null {
  if (!Number.isInteger(fieldIndex) || fieldIndex < 0) return null;
  const field = doc.fields[fieldIndex];
  if (!field) return null;
  return { documentId: doc.id, version: doc.version, fieldIndex, label: field.label, value: field.value };
}

/** 兩段引用是否指向同一份文件的同一版本、同一欄。 */
export function sameCitationTarget(
  a: Pick<CaseCitation, 'documentId' | 'version' | 'fieldIndex'>,
  b: Pick<CaseCitation, 'documentId' | 'version' | 'fieldIndex'>,
): boolean {
  return a.documentId === b.documentId && a.version === b.version && a.fieldIndex === b.fieldIndex;
}

/** 加入引用（依加入順序）；同一欄已引用就回傳原陣列。 */
export function addCitation(list: readonly CaseCitation[], citation: CaseCitation): readonly CaseCitation[] {
  return list.some((c) => sameCitationTarget(c, citation)) ? list : [...list, { ...citation }];
}

/** 移除引用；沒有這段就回傳原陣列。 */
export function removeCitation(
  list: readonly CaseCitation[],
  target: Pick<CaseCitation, 'documentId' | 'version' | 'fieldIndex'>,
): readonly CaseCitation[] {
  return list.some((c) => sameCitationTarget(c, target)) ? list.filter((c) => !sameCitationTarget(c, target)) : list;
}

/** 送件包是否引用了某份文件的某一欄（任何版本）；條件回條與訊息條件用。 */
export function citesField(list: readonly CaseCitation[], documentId: string, fieldIndex: number): boolean {
  return list.some((c) => c.documentId === documentId && c.fieldIndex === fieldIndex);
}

/* ---------- 交付前的程序驗證 ---------- */

export type CaseworkInputError = 'invalidCitation' | 'needCitation' | 'needAction' | 'sourceMissing';

export interface CaseworkInput {
  choiceId?: string;
  citations: readonly CaseCitation[];
}

export interface CaseworkCheckContext {
  /** 目前可開啟的文件（未送達的查詢文件、未知 ID 回傳 null）。 */
  document(documentId: string): CaseDocument | null;
  /** 綁定的舊批次是否附在存檔中（通知範圍用）。 */
  sourceAttached: boolean;
}

/**
 * 交付前的程序驗證：只檢查型別、必填與合法引用。
 * - invalidCitation：引用了不在本案、尚不可開、版本已變更或欄位不存在的文件，或快照與該欄不符。
 * - needCitation：引用少於本案最少段數。
 * - needAction：沒有選處理方式，或選項不屬於本案。
 * - sourceMissing：舊批次未附時，不能以「整批／先交可轉送列」造出空的成功清單（仍可請窗口補件）。
 * 不檢查引用語意、選項是否「正確」或編號是否與來源相等。
 */
export function caseworkInputError(plan: CaseworkPlan, input: CaseworkInput, ctx: CaseworkCheckContext): CaseworkInputError | null {
  for (const c of input.citations) {
    if (!plan.documentIds.includes(c.documentId)) return 'invalidCitation';
    const doc = ctx.document(c.documentId);
    const field = doc?.fields[c.fieldIndex];
    if (!doc || !field || doc.version !== c.version || field.label !== c.label || field.value !== c.value) return 'invalidCitation';
  }
  if (input.citations.length < plan.minimumCitations) return 'needCitation';
  const choice = plan.choices.find((ch) => ch.id === input.choiceId);
  if (!choice) return 'needAction';
  if (choice.output.variant === 'batch-scope' && choice.output.route !== 'source-review' && !ctx.sourceAttached) return 'sourceMissing';
  return null;
}

/** 選項輸出；選項不屬於本案回傳 null。 */
export function choiceOutputOf(plan: CaseworkPlan, choiceId: string): CaseChoiceOutput | null {
  return plan.choices.find((c) => c.id === choiceId)?.output ?? null;
}

/* ---------- 送件版本：已交付副本唯讀，最新修訂獨立 ---------- */

/** 案件工作的一個交付版本（只附加，不覆寫已交付的副本）。 */
export interface CaseworkVersion {
  /** 0＝原送件；之後的修訂依序加一。 */
  index: number;
  choiceId: string;
  /** 交付當下的選項輸出快照；內容檔日後修改也不改寫。 */
  output: CaseChoiceOutput;
  /** 實際交給接手窗口的引用（不可變快照）。 */
  citations: readonly CaseCitation[];
  dayId: DayId;
}

/** 案件工作的進度：開啟過、暫存的草稿（選項與引用），以及交付版本。 */
export interface CaseworkProgress {
  kind: 'casework';
  opened: boolean;
  draft: CaseworkInput;
  versions: readonly CaseworkVersion[];
}

export function emptyCaseworkProgress(): CaseworkProgress {
  return { kind: 'casework', opened: false, draft: { citations: [] }, versions: [] };
}

export function latestCaseworkVersion(p: CaseworkProgress): CaseworkVersion | undefined {
  return p.versions[p.versions.length - 1];
}

/** 暫存草稿：只改草稿，不動已交付的版本。 */
export function withCaseworkDraft(p: CaseworkProgress, draft: CaseworkInput): CaseworkProgress {
  return { ...p, draft: { ...(draft.choiceId !== undefined ? { choiceId: draft.choiceId } : {}), citations: [...draft.citations] } };
}

export type CaseworkSubmitResult =
  | { ok: true; progress: CaseworkProgress; version: CaseworkVersion }
  | { ok: false; error: CaseworkInputError | 'stale' };

/**
 * 交付或修訂（不可變附加）：expectedLatest＝畫面開始操作時看到的最新版本序號（第一次交付為 null）。
 * 與目前最新版本不符代表畫面已過期（重複送出、另一個視窗已交付），回傳 stale，不覆寫任何副本。
 * 交付成功後清空草稿；錯值照樣保存並往下游傳遞，不改已發生的後果。
 */
export function submitCaseworkVersion(
  plan: CaseworkPlan,
  p: CaseworkProgress,
  input: CaseworkInput,
  ctx: CaseworkCheckContext,
  dayId: DayId,
  expectedLatest: number | null,
): CaseworkSubmitResult {
  const latest = latestCaseworkVersion(p);
  if ((latest?.index ?? null) !== expectedLatest) return { ok: false, error: 'stale' };
  const error = caseworkInputError(plan, input, ctx);
  if (error) return { ok: false, error };
  const output = choiceOutputOf(plan, input.choiceId ?? '');
  if (!output) return { ok: false, error: 'needAction' };
  const version: CaseworkVersion = {
    index: latest ? latest.index + 1 : 0,
    choiceId: input.choiceId ?? '',
    output,
    citations: input.citations.map((c) => ({ ...c })),
    dayId,
  };
  return { ok: true, version, progress: { ...p, draft: { citations: [] }, versions: [...p.versions, version] } };
}

/* ---------- 承辦查詢：早回／次日回 ---------- */

export type InquiryTiming = 'after-current-work' | 'next-arrival';
export const INQUIRY_TIMINGS: readonly InquiryTiming[] = ['after-current-work', 'next-arrival'];

export interface InquiryPlan {
  id: string;
  caseId: string;
  /** 擲骰與送達郵件的固定 ID。 */
  eventId: string;
  /** 可以詢問的工作日。 */
  requestedOn: DayId;
  /** 早回：這件工作完成後送達。 */
  earlyAfterTask: TaskId;
  /** 不論有沒有詢問，這一天起文件必定可查。 */
  guaranteedBy: DayId;
  /** 回覆附上的新文件。 */
  documentId: string;
  /** 可能的送達時機（內容順序）；擲骰只在這些之中選。 */
  timings: readonly InquiryTiming[];
}

/** 詢問的保存狀態：送出當天與首次決定的送達時機。 */
export interface InquiryState {
  dayId: DayId;
  timing: InquiryTiming;
}

/** 送達時機：seed＋eventId 擲一次（同一 seed 永遠相同），由呼叫端保存後不再重擲。 */
export function rollInquiryTiming(seed: number, plan: Pick<InquiryPlan, 'eventId' | 'timings'>): InquiryTiming {
  const options = plan.timings.length > 0 ? plan.timings : INQUIRY_TIMINGS;
  const index = Math.min(options.length - 1, Math.floor(rand(seed, plan.eventId) * options.length));
  return options[index] ?? 'next-arrival';
}

/** 建立詢問的保存狀態；已詢問過回傳原狀態（不重擲、不重送）。 */
export function askInquiry(
  seed: number,
  plan: InquiryPlan,
  existing: InquiryState | undefined,
  dayId: DayId,
): InquiryState {
  return existing ?? { dayId, timing: rollInquiryTiming(seed, plan) };
}

export interface CaseworkDayContext {
  /** 目前遊戲日。 */
  dayId: DayId;
  /** 日序；未知日回傳 -1。 */
  dayNumber(dayId: DayId): number;
  /** 工作是否已交付（或免補）。 */
  taskDone(taskId: TaskId): boolean;
}

/**
 * 詢問回覆是否已送達：早回在指定的另一件工作完成後送達；次日回（或早回的工作當天沒完成）在下一個工作日到班時送達。
 * 只讀保存的狀態，刷新、切窗不會改變結果。
 */
export function inquiryReplyArrived(plan: InquiryPlan, state: InquiryState | undefined, ctx: CaseworkDayContext): boolean {
  if (!state) return false;
  if (state.timing === 'after-current-work' && ctx.taskDone(plan.earlyAfterTask)) return true;
  return ctx.dayNumber(ctx.dayId) > ctx.dayNumber(state.dayId);
}

/**
 * 文件目前是否可開啟：一般文件永遠可開；查詢附件只有回覆送達後，或到了保底日才出現。
 * 未送達時不能從來源列表、JSON、預覽或摘要讀到它。
 */
export function caseDocumentAvailable(
  documentId: string,
  inquiries: readonly InquiryPlan[],
  states: Readonly<Partial<Record<string, InquiryState>>>,
  ctx: CaseworkDayContext,
): boolean {
  const plan = inquiries.find((i) => i.documentId === documentId);
  if (!plan) return true;
  const guaranteed = ctx.dayNumber(plan.guaranteedBy);
  if (guaranteed >= 0 && ctx.dayNumber(ctx.dayId) >= guaranteed) return true;
  return inquiryReplyArrived(plan, states[plan.id], ctx);
}

/* ---------- 編號核定（黃品蓉）：只在後日回條／交接揭露，不在當日擋送 ---------- */

export type CodeState = 'pending-code' | 'awaiting-code-ratification';
export const CODE_STATES: readonly CodeState[] = ['pending-code', 'awaiting-code-ratification'];

/**
 * 保存的編號是否為文件內提供的代碼之一（逐字比對，不修剪、不改大小寫）：
 * 是＝聯絡路徑與編號核定分開處理（仍未核定唯一真值）；不是或缺漏＝留下 pending-code 核對待辦。原值保留，不自動修正。
 */
export function codeStateOf(providedCodes: readonly string[], code: string | null): CodeState {
  return code !== null && providedCodes.includes(code) ? 'awaiting-code-ratification' : 'pending-code';
}

/* ---------- 條件回條：只讀來源工作的不可變送件版本 ---------- */

export type CaseMailWhen =
  | { kind: 'choice'; choiceId: string }
  | { kind: 'cites'; documentId: string; fieldIndex: number }
  | { kind: 'not-cites'; documentId: string; fieldIndex: number };

/** 送件版本中條件回條需要的部分。 */
export interface CaseworkVersionFacts {
  choiceId: string;
  citations: readonly CaseCitation[];
}

/** 條件是否成立：choice＝保存的選項；cites／not-cites＝實際引用的欄位（不按選項名稱推斷、不讀目前草稿）。 */
export function caseMailMatches(when: CaseMailWhen, version: CaseworkVersionFacts): boolean {
  switch (when.kind) {
    case 'choice':
      return version.choiceId === when.choiceId;
    case 'cites':
      return citesField(version.citations, when.documentId, when.fieldIndex);
    case 'not-cites':
      return !citesField(version.citations, when.documentId, when.fieldIndex);
  }
}

/* ---------- 第七日通知範圍：列與數量一律由保存的前日輸出解析 ---------- */

/** 前日輸出的一列：識別、人員編號與保存狀態是否仍待補（沿既有保存狀態／origin，不以標準答案重算）。 */
export interface ScopeRow {
  id: string;
  code: string;
  pending: boolean;
}

/** 通知範圍的結果；舊批次未附時列數未知（null），不寫成 0。 */
export interface ScopeResult {
  sourceAttached: boolean;
  /** 前日實際輸出的全部列。 */
  rowIds: readonly string[];
  /** 本輪交給窗口的清單列。 */
  listRowIds: readonly string[];
  /** 仍待補的列（整批時標示在清單內，先交可轉送列時另列）。 */
  pendingRowIds: readonly string[];
}

export function scopeResultOf(route: ScopeRoute, rows: readonly ScopeRow[] | null): ScopeResult {
  if (rows === null) return { sourceAttached: false, rowIds: [], listRowIds: [], pendingRowIds: [] };
  const rowIds = rows.map((r) => r.id);
  const pendingRowIds = rows.filter((r) => r.pending).map((r) => r.id);
  const listRowIds =
    route === 'window-all' ? rowIds : route === 'window-ready' ? rows.filter((r) => !r.pending).map((r) => r.id) : [];
  return { sourceAttached: true, rowIds, listRowIds, pendingRowIds };
}

/** 清單列數：舊批次未附回傳 null（顯示「未附」），不寫成 0。 */
export function scopeListCount(result: ScopeResult): number | null {
  return result.sourceAttached ? result.listRowIds.length : null;
}
