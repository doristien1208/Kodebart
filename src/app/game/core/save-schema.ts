import { DayDirectory, FieldMapTaskPlan, TaskPlan, batchIdOfTask, findAudit, findCase, taskPlanOf } from './day-plan';
import { isValidCodeString, normalizePlayerName } from './validate';
import { RETURN_RECEIPT_MAIL_PACK, RETURN_RECEIPT_TEMPLATES, mailIdOfReceipt } from './mail';
import { checkFieldMap } from './field-map';
import { isValidSeed } from './rand';
import {
  MISSING_POLICIES,
  ORIGINS,
  PHASES,
  REPLIES,
  SAVE_VERSION,
  STAGES,
  Save,
  SaveV2,
  SaveV3,
  SaveV4,
  SaveV5,
  SaveV6,
  SaveV7,
  SaveV8,
  SaveV9,
  SaveV10,
  RETURN_STATUSES,
  REVIEW_DISPOSITIONS,
  LEGACY_STAGES,
  CASE_DESTINATIONS,
} from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidDraft(d: unknown): boolean {
  if (!isPlainObject(d)) return false;
  if (typeof d['value'] !== 'string') return false;
  if (d['decisionId'] !== undefined && (typeof d['decisionId'] !== 'string' || d['decisionId'] === '')) return false;
  return d['policy'] === undefined || MISSING_POLICIES.includes(d['policy'] as never);
}

function isValidSnapshot(s: unknown): boolean {
  if (!isPlainObject(s)) return false;
  if (!(s['name'] === null || typeof s['name'] === 'string')) return false;
  if (typeof s['code'] !== 'string') return false;
  if (!(s['refusal'] === null || typeof s['refusal'] === 'boolean')) return false;
  return typeof s['refusalApplies'] === 'boolean';
}

function isValidArchived(a: unknown, requireSnapshot: boolean): boolean {
  if (!isPlainObject(a)) return false;
  // R10：人員編號只驗型別（文字、非空白）；照玩家提交保存，不與來源比較
  if (!isValidCodeString(a['archiveCode'])) return false;
  if (!ORIGINS.includes(a['origin'] as never)) return false;
  if (!(a['refusal'] === null || typeof a['refusal'] === 'boolean')) return false;
  if (requireSnapshot && !isValidSnapshot(a['source'])) return false;
  if (a['caseDecision'] !== undefined && !isValidCaseDecisionShape(a['caseDecision'])) return false;
  return true;
}

/** 案件決定快照的結構（內容比對只對目前批次做）。 */
function isValidCaseDecisionShape(d: unknown): boolean {
  if (!isPlainObject(d)) return false;
  for (const k of ['caseId', 'decisionId', 'basisDocumentId', 'note']) {
    if (typeof d[k] !== 'string' || d[k] === '') return false;
  }
  return CASE_DESTINATIONS.includes(d['destination'] as never);
}

function isValidNight(n: unknown): boolean {
  if (!isPlainObject(n)) return false;
  if (typeof n['intervention'] !== 'boolean') return false;
  if (n['smallTalkVariant'] !== 0 && n['smallTalkVariant'] !== 1) return false;
  return n['reportRevision'] === (n['intervention'] ? 2 : 1);
}

function isValidEvidence(e: unknown): boolean {
  return isPlainObject(e) && typeof e['reportOpened'] === 'boolean' && typeof e['receiptOpened'] === 'boolean';
}

/** 批次結構檢查（不比對內容）。 */
function isValidBatchShape(batch: unknown, requireSnapshot: boolean): batch is { archived: Record<string, unknown>; drafts: Record<string, unknown> } {
  if (!isPlainObject(batch)) return false;
  const archived = batch['archived'];
  const drafts = batch['drafts'];
  if (!isPlainObject(archived) || !isPlainObject(drafts)) return false;
  for (const v of Object.values(archived)) if (!isValidArchived(v, requireSnapshot)) return false;
  for (const v of Object.values(drafts)) if (!isValidDraft(v)) return false;
  return true;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((m) => typeof m === 'string');
}

/* ---------- 工作進度 ---------- */

function isValidReconcileProgress(p: Record<string, unknown>): boolean {
  if (typeof p['reportOpened'] !== 'boolean' || typeof p['receiptOpened'] !== 'boolean') return false;
  if (p['reply'] !== undefined) {
    if (!REPLIES.includes(p['reply'] as never)) return false;
    // 回覆一定是先開過摘要；請求覆核一定開過副本。
    if (!p['reportOpened']) return false;
    if (p['reply'] === 'review' && !p['receiptOpened']) return false;
  }
  if (p['reviews'] !== undefined && !isValidReviews(p['reviews'])) return false;
  const rev = p['reportRevision'];
  if (!(rev === undefined || rev === null || rev === 1 || rev === 2)) return false;
  return true;
}

/** 逐筆審查處置（R10）：結構與追蹤引用；舊檔沒有這個欄位。 */
function isValidReviews(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  for (const [key, r] of Object.entries(v)) {
    if (!isPlainObject(r)) return false;
    if (!REVIEW_DISPOSITIONS.includes(r['disposition'] as never)) return false;
    if (r['recordKey'] !== key) return false;
    for (const k of ['batchId', 'archiveTaskId', 'sourceCode']) if (typeof r[k] !== 'string') return false;
    if (!isValidCodeString(r['reviewedCode'])) return false;
  }
  return true;
}

function isMappedValue(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'boolean';
}

function isValidSubmission(sub: unknown, task: FieldMapTaskPlan): boolean {
  if (!isPlainObject(sub)) return false;
  if (typeof sub['rowCount'] !== 'number' || typeof sub['affectedCount'] !== 'number') return false;
  if (!(sub['blankPolicy'] === null || MISSING_POLICIES.includes(sub['blankPolicy'] as never))) return false;
  const rows = sub['rows'];
  if (!Array.isArray(rows) || rows.length !== sub['rowCount']) return false;
  const targetIds = new Set(task.targets.map((t) => t.id));
  for (const row of rows) {
    if (!isPlainObject(row) || typeof row['id'] !== 'string') return false;
    const values = row['values'];
    if (!isPlainObject(values)) return false;
    for (const [k, v] of Object.entries(values)) if (!targetIds.has(k) || !isMappedValue(v)) return false;
  }
  return true;
}

function isValidFieldMapProgress(p: Record<string, unknown>, task: FieldMapTaskPlan): boolean {
  const assignments = p['assignments'];
  if (!isPlainObject(assignments)) return false;
  const targetIds = new Set(task.targets.map((t) => t.id));
  const used = new Set<string>();
  for (const [target, source] of Object.entries(assignments)) {
    // 映射欄位必須存在，且來源不可重複
    if (!targetIds.has(target)) return false;
    if (typeof source !== 'string' || !task.sourceFieldIds.includes(source)) return false;
    if (used.has(source)) return false;
    used.add(source);
  }
  if (p['blankPolicy'] !== undefined && !MISSING_POLICIES.includes(p['blankPolicy'] as never)) return false;
  if (typeof p['previewed'] !== 'boolean') return false;
  if (p['submitted'] !== undefined) {
    if (!p['previewed']) return false;
    if (!isValidSubmission(p['submitted'], task)) return false;
    // 已提交代表當時的對應完整且正確，政策也已選好
    const policy = p['blankPolicy'] as Parameters<typeof checkFieldMap>[2];
    if (!checkFieldMap(task, assignments as Record<string, string>, policy).ok) return false;
  }
  return true;
}

/** 每一筆進度：taskId 必須是已知工作，kind 必須與該工作一致（歸檔工作不用進度）。 */
function isValidTaskProgress(progress: unknown, dir: DayDirectory): boolean {
  if (!isPlainObject(progress)) return false;
  for (const [taskId, p] of Object.entries(progress)) {
    if (!isPlainObject(p)) return false;
    const plan = dir.planOfTask(taskId);
    const task = plan ? taskPlanOf(plan, taskId) : undefined;
    if (!task || p['kind'] !== task.kind) return false;
    if (task.kind === 'reconcile' && !isValidReconcileProgress(p)) return false;
    if (task.kind === 'field-map' && !isValidFieldMapProgress(p, task)) return false;
    if (task.kind === 'archive') return false;
  }
  return true;
}

/* ---------- 工作完成（不信任型別，直接看原始物件） ---------- */

function rawProgress(s: Record<string, unknown>, taskId: string): Record<string, unknown> | undefined {
  const all = s['taskProgress'];
  if (!isPlainObject(all)) return undefined;
  const p = all[taskId];
  return isPlainObject(p) ? p : undefined;
}

function rawBatch(s: Record<string, unknown>, batchId: string): Record<string, unknown> {
  const b = (s['batches'] as Record<string, unknown>)[batchId];
  return isPlainObject(b) && isPlainObject(b['archived']) ? (b['archived'] as Record<string, unknown>) : {};
}

/** 工作是否已完成（直接看原始物件）；遷移也用它判斷免補。 */
export function isRawTaskDone(s: Record<string, unknown>, dir: DayDirectory, task: TaskPlan): boolean {
  switch (task.kind) {
    case 'archive': {
      const archived = rawBatch(s, task.batchId);
      return dir.records(task.batchId).every((r) => archived[r.key] !== undefined);
    }
    case 'reconcile':
      return rawProgress(s, task.id)?.['reply'] !== undefined;
    case 'field-map':
      return rawProgress(s, task.id)?.['submitted'] !== undefined;
    case 'return-review': {
      // 當天排入的案件在當天或之後都有處理版本（與案件之後是否再被退回無關）
      const ids = rawSchedule(s)[task.dayId] ?? [];
      const at = dir.days.indexOf(task.dayId);
      const items = rawReturns(s).filter((r) => ids.includes(String(r['id'])));
      return (
        items.length > 0 &&
        items.every((r) => {
          const versions = Array.isArray(r['versions']) ? r['versions'] : [];
          return versions.some((v) => isPlainObject(v) && dir.days.indexOf(String(v['dayId'])) >= at);
        })
      );
    }
  }
}

function rawSchedule(s: Record<string, unknown>): Record<string, string[]> {
  const v = s['issueSchedule'];
  if (!isPlainObject(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(v)) if (isStringArray(ids)) out[k] = ids;
  return out;
}

function rawReturns(s: Record<string, unknown>): Record<string, unknown>[] {
  const v = s['returns'];
  return Array.isArray(v) ? v.filter(isPlainObject) : [];
}

/** 錯誤文件處理只有當天排入案件時才適用；不適用的工作視為已結清。 */
function isRawTaskApplicable(s: Record<string, unknown>, task: TaskPlan): boolean {
  return task.kind !== 'return-review' || (rawSchedule(s)[task.dayId]?.length ?? 0) > 0;
}

/** 有限、非負的時間（epoch ms）。 */
function isTimestamp(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * 訊息回覆（R7）：只驗結構，不比對內容檔。
 * 歷史快照在內容日後移除 prompt 時仍有效，不會讓整份存檔失效。
 * R12 的送達時間皆為可選：回答時間、遊戲日與逐則送達時間（遞增、不早於回答時間）；沒有＝舊檔、已送達。
 */
function isValidChatReplies(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  for (const reply of Object.values(v)) {
    if (!isPlainObject(reply)) return false;
    if (reply['kind'] === 'skipped') continue;
    if (reply['kind'] !== 'answered') return false;
    if (typeof reply['choiceId'] !== 'string' || reply['choiceId'] === '') return false;
    if (typeof reply['playerText'] !== 'string' || reply['playerText'] === '') return false;
    const answeredAt = reply['answeredAt'];
    if (answeredAt !== undefined && !isTimestamp(answeredAt)) return false;
    if (reply['dayId'] !== undefined && typeof reply['dayId'] !== 'string') return false;
    const responses = reply['responses'];
    if (!Array.isArray(responses)) return false;
    let prev = typeof answeredAt === 'number' ? answeredAt : 0;
    for (const r of responses) {
      if (!isPlainObject(r)) return false;
      if (typeof r['id'] !== 'string' || typeof r['actorId'] !== 'string' || typeof r['time'] !== 'string') return false;
      if (!isStringArray(r['lines'])) return false;
      const at = r['deliverAt'];
      if (at === undefined) continue;
      if (!isTimestamp(at) || at < prev) return false;
      prev = at;
    }
  }
  return true;
}

/**
 * 舊檔免補清單：與遷移規則一致，只能列出「已跨過的日子」裡的第 2 件以後工作
 * （目前日之前的日子；目前日只有在 wrap／end 時才算跨過）。每天第一件、未來的日子、
 * 以及目前日仍在進行中的工作都不可免補，因此手改存檔無法跳過真正的第一件工作。
 */
function isValidWaived(v: unknown, s: Record<string, unknown>, dir: DayDirectory): v is string[] {
  if (!isStringArray(v)) return false;
  if (new Set(v).size !== v.length) return false;
  const current = dir.days.indexOf(String(s['dayId']));
  const passedThrough = s['stage'] === 'wrap' || s['stage'] === 'end' ? current : current - 1;
  return v.every((id) => {
    const plan = dir.planOfTask(id);
    if (!plan) return false;
    if (plan.tasks[0]?.id === id) return false;
    return dir.days.indexOf(plan.dayId) <= passedThrough;
  });
}

/** 已完成或舊檔免補（直接看原始物件，不信任型別）。 */
function isRawTaskSettled(s: Record<string, unknown>, dir: DayDirectory, task: TaskPlan): boolean {
  const waived = s['waivedTasks'];
  if (Array.isArray(waived) && waived.includes(task.id)) return true;
  if (!isRawTaskApplicable(s, task)) return true;
  return isRawTaskDone(s, dir, task);
}

/**
 * v11 存檔檢查（R12）：v10 的案件／排程規則 ＋ 郵件（每份回條恰一封、附件引用一致）、郵件已讀、
 * 修訂草稿（既有回條）、向同事詢問、角色資料與入職進度。
 */
export function isValidSave(s: unknown, dir: DayDirectory): s is Save {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== SAVE_VERSION) return false;
  if (!isValidReturns(s['returns'], s, dir)) return false;
  if (!isValidIssueSchedule(s['issueSchedule'], s, dir)) return false;
  if (!isValidIssueDrafts(s['issueDrafts'], s)) return false;
  if (!isValidMailbox(s['mailbox'], s)) return false;
  if (!isValidReadMail(s['readMail'], s)) return false;
  if (!isValidHelpRequests(s['helpRequests'], s, dir)) return false;
  if (!isValidProfile(s['profile']) || !isValidOnboarding(s['onboarding'])) return false;
  if (!isValidCaseReviews(s['caseReviews'], dir)) return false;
  return isValidV7Fields(s, dir);
}

/** v10 舊檔（R11）：案件、排程與回條已讀的完整規則（遷移成 v11 不改案件資料）。 */
export function isValidLegacySaveV10(s: unknown, dir: DayDirectory): s is SaveV10 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 10) return false;
  if (!isValidReturns(s['returns'], s, dir)) return false;
  if (!isValidIssueSchedule(s['issueSchedule'], s, dir)) return false;
  if (!isValidReadReceipts(s['readIssueReceipts'], s)) return false;
  if (!isValidCaseReviews(s['caseReviews'], dir)) return false;
  return isValidV7Fields(s, dir);
}

/** 存檔中所有回條（依案件、再依回條順序）與所屬案件 ID。 */
function rawReceipts(s: Record<string, unknown>): { caseId: string; receipt: Record<string, unknown> }[] {
  return rawReturns(s).flatMap((r) =>
    (Array.isArray(r['receipts']) ? r['receipts'] : [])
      .filter(isPlainObject)
      .map((receipt) => ({ caseId: String(r['id']), receipt })),
  );
}

/**
 * 郵件（R12）：每份回條恰有一封固定 ID 的郵件，郵件包／模板／日期與附件引用（案件、回條、版本）都和回條一致；
 * 不能有指向不存在回條的郵件，也不能少寄。
 */
function isValidMailbox(v: unknown, s: Record<string, unknown>): boolean {
  if (!Array.isArray(v)) return false;
  const receipts = new Map(rawReceipts(s).map((x) => [String(x.receipt['id']), x]));
  const seen = new Set<string>();
  for (const m of v) {
    if (!isPlainObject(m) || typeof m['id'] !== 'string' || seen.has(m['id'])) return false;
    seen.add(m['id']);
    if (m['packId'] !== RETURN_RECEIPT_MAIL_PACK || !RETURN_RECEIPT_TEMPLATES.includes(m['templateId'] as never)) return false;
    const attachments = m['attachments'];
    if (!Array.isArray(attachments) || attachments.length !== 1) return false;
    const a = attachments[0];
    if (!isPlainObject(a) || a['kind'] !== 'return-receipt' || typeof a['receiptId'] !== 'string') return false;
    const found = receipts.get(a['receiptId']);
    if (!found || a['caseId'] !== found.caseId || a['versionIndex'] !== found.receipt['versionIndex']) return false;
    if (m['id'] !== mailIdOfReceipt(a['receiptId'])) return false;
    if (m['templateId'] !== found.receipt['kind'] || m['dayId'] !== found.receipt['dayId']) return false;
  }
  return seen.size === receipts.size;
}

/** 郵件已讀：既有郵件 ID、不重複。 */
function isValidReadMail(v: unknown, s: Record<string, unknown>): boolean {
  if (!isStringArray(v) || new Set(v).size !== v.length) return false;
  const mailbox = s['mailbox'];
  const known = new Set(Array.isArray(mailbox) ? mailbox.map((m) => (isPlainObject(m) ? m['id'] : undefined)) : []);
  return v.every((id) => known.has(id));
}

/** 修訂草稿：以既有回條 ID 為鍵的文字（過期草稿保留供查看）。 */
function isValidIssueDrafts(v: unknown, s: Record<string, unknown>): boolean {
  if (!isPlainObject(v)) return false;
  const known = new Set(rawReceipts(s).map((x) => x.receipt['id']));
  return Object.entries(v).every(([id, value]) => known.has(id) && typeof value === 'string');
}

/** 向同事詢問：已到的遊戲日、實際時間；說明逐則送達時間遞增、訊息 ID 不重複。 */
function isValidHelpRequests(v: unknown, s: Record<string, unknown>, dir: DayDirectory): boolean {
  if (!isPlainObject(v)) return false;
  const today = dir.days.indexOf(String(s['dayId']));
  for (const [requestId, r] of Object.entries(v)) {
    if (requestId === '' || !isPlainObject(r)) return false;
    const at = dir.days.indexOf(String(r['dayId']));
    if (at < 0 || at > today || !isTimestamp(r['askedAt'])) return false;
    const deliveries = r['deliveries'];
    if (!Array.isArray(deliveries) || deliveries.length === 0) return false;
    const ids = new Set<string>();
    let prev = r['askedAt'];
    for (const d of deliveries) {
      if (!isPlainObject(d) || typeof d['messageId'] !== 'string' || d['messageId'] === '' || ids.has(d['messageId'])) return false;
      if (!isTimestamp(d['at']) || d['at'] < prev) return false;
      ids.add(d['messageId']);
      prev = d['at'];
    }
  }
  return true;
}

/** 角色資料：null（舊檔、尚未簽名）或已正規化的角色名。 */
function isValidProfile(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const name = v['name'];
  return name === null || (typeof name === 'string' && normalizePlayerName(name) === name);
}

/** 入職進度：非負整數段落與完成旗標（段落上限由內容決定，state 讀取時限制）。 */
function isValidOnboarding(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const step = v['step'];
  return typeof step === 'number' && Number.isInteger(step) && step >= 0 && typeof v['complete'] === 'boolean';
}

/**
 * v9 舊檔（R10）：只檢查結構；完整規則在遷移成 v10 之後檢查
 * （v9 的退件狀態、複審日與現行排程模型不同，不能直接套用 v10 的日程規則）。
 */
export function isValidLegacySaveV9(s: unknown, dir: DayDirectory): s is SaveV9 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 9) return false;
  if (!isValidSeed(s['seed']) || typeof s['dayId'] !== 'string' || !dir.plan(s['dayId'])) return false;
  if (!isValidCaseReviews(s['caseReviews'], dir) || !isValidChatReplies(s['chatReplies'])) return false;
  const returns = s['returns'];
  if (!Array.isArray(returns)) return false;
  for (const r of returns) {
    if (!isPlainObject(r)) return false;
    if (!['pending', 'resubmitted', 'window'].includes(String(r['status']))) return false;
    for (const k of ['id', 'auditId', 'recordKey', 'notifyDayId', 'returnDayId']) if (typeof r[k] !== 'string') return false;
    const versions = r['versions'];
    if (!Array.isArray(versions)) return false;
    for (const ver of versions) {
      if (!isPlainObject(ver) || (ver['action'] !== 'resubmit' && ver['action'] !== 'window')) return false;
      if (!isValidCodeString(ver['code']) || typeof ver['dayId'] !== 'string' || !dir.plan(ver['dayId'])) return false;
    }
  }
  return true;
}

/** 已讀回條：既有回條 ID、不重複。 */
function isValidReadReceipts(v: unknown, s: Record<string, unknown>): boolean {
  if (!isStringArray(v) || new Set(v).size !== v.length) return false;
  const known = new Set(
    rawReturns(s).flatMap((r) => (Array.isArray(r['receipts']) ? r['receipts'] : []).map((rc) => (isPlainObject(rc) ? rc['id'] : undefined))),
  );
  return v.every((id) => known.has(id));
}

/** 每日排程：已到的日子、既有案件、不重複。 */
function isValidIssueSchedule(v: unknown, s: Record<string, unknown>, dir: DayDirectory): boolean {
  if (!isPlainObject(v)) return false;
  const today = dir.days.indexOf(String(s['dayId']));
  const ids = new Set(rawReturns(s).map((r) => String(r['id'])));
  for (const [dayId, list] of Object.entries(v)) {
    const at = dir.days.indexOf(dayId);
    if (at < 0 || at > today) return false;
    if (!isStringArray(list) || list.length === 0 || new Set(list).size !== list.length) return false;
    if (list.some((id) => !ids.has(id))) return false;
  }
  return true;
}

/** v8 舊檔（R9）：v9 少了 returns。 */
export function isValidLegacySaveV8(s: unknown, dir: DayDirectory): s is SaveV8 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 8) return false;
  if (!isValidCaseReviews(s['caseReviews'], dir)) return false;
  return isValidV7Fields(s, dir);
}

/**
 * 延後退件（R10）：穩定 ID、稽核與紀錄存在、今天已到通知日、
 * 對應的第二輪審查確實是「放行」且所看版本與原始來源不一致；版本紀錄只附加。
 */
function isValidReturns(v: unknown, s: Record<string, unknown>, dir: DayDirectory): boolean {
  if (!Array.isArray(v)) return false;
  const ids = new Set<string>();
  const today = dir.days.indexOf(String(s['dayId']));
  const knownDay = (d: unknown): d is string => typeof d === 'string' && dir.days.includes(d) && dir.days.indexOf(d) <= today;
  for (const r of v) {
    if (!isPlainObject(r)) return false;
    const auditId = r['auditId'];
    const key = r['recordKey'];
    if (typeof auditId !== 'string' || typeof key !== 'string') return false;
    const found = findAudit(dir, auditId);
    if (!found || !found.task.recordKeys.includes(key)) return false;
    const id = `return.${auditId}.${key}`;
    // 案件唯一：同一筆紀錄重錯只增加版本與回條，不會複製成新案件
    if (r['id'] !== id || ids.has(id)) return false;
    ids.add(id);
    if (r['notifyDayId'] !== found.audit.notifyDayId || today < dir.days.indexOf(found.audit.notifyDayId)) return false;
    if (r['reviewTaskId'] !== found.task.id || r['batchId'] !== found.task.sourceBatchId) return false;
    if (typeof r['archiveTaskId'] !== 'string' || typeof r['sourceCode'] !== 'string') return false;
    if (!isValidCodeString(r['submittedCode']) || !isValidCodeString(r['reviewedCode'])) return false;
    if (r['disposition'] !== 'release' || r['reason'] !== 'code-mismatch') return false;
    if (r['reviewedCode'] === r['sourceCode']) return false;
    // 必須對應一筆已保存的「放行」審查，且案件內容與那次審查的快照一致
    const reviews = rawProgress(s, found.task.id)?.['reviews'];
    const review = isPlainObject(reviews) ? reviews[key] : undefined;
    if (!isPlainObject(review) || review['disposition'] !== 'release') return false;
    if (review['reviewedCode'] !== r['reviewedCode'] || review['sourceCode'] !== r['sourceCode']) return false;
    if (review['archiveTaskId'] !== r['archiveTaskId'] || review['batchId'] !== r['batchId']) return false;
    if (!RETURN_STATUSES.includes(r['status'] as never)) return false;
    if (!(r['dueDayId'] === null || (typeof r['dueDayId'] === 'string' && dir.plan(r['dueDayId'])))) return false;

    // 版本：序號連續、型別合法；錯誤內容本身不拒絕（只驗文字非空白）
    const versions = r['versions'];
    if (!Array.isArray(versions)) return false;
    for (const [i, ver] of versions.entries()) {
      if (!isPlainObject(ver) || ver['index'] !== i) return false;
      if (ver['action'] !== 'resubmit' && ver['action'] !== 'window') return false;
      if (!isValidCodeString(ver['code']) || !knownDay(ver['dayId'])) return false;
      if (!(ver['checkDayId'] === null || (typeof ver['checkDayId'] === 'string' && dir.plan(ver['checkDayId'])))) return false;
      if (ver['action'] === 'window' && ver['checkDayId'] !== null) return false;
      if (ver['outcome'] !== undefined) {
        if (ver['outcome'] !== 'resolved' && ver['outcome'] !== 'returned') return false;
        if (ver['action'] !== 'resubmit' || ver['checkedDayId'] !== ver['checkDayId'] || !knownDay(ver['checkedDayId'])) return false;
      }
      // 只有最後一個版本可以尚未核對
      if (i < versions.length - 1 && ver['action'] === 'resubmit' && ver['outcome'] !== 'returned') return false;
      if (i < versions.length - 1 && ver['action'] === 'window') return false;
    }

    // 回條：穩定 ID、第一張是對原提交的退件
    const receipts = r['receipts'];
    if (!Array.isArray(receipts) || receipts.length === 0) return false;
    for (const [i, rc] of receipts.entries()) {
      if (!isPlainObject(rc) || rc['id'] !== `${id}#${i}`) return false;
      if (rc['kind'] !== 'returned' && rc['kind'] !== 'resolved') return false;
      if (!knownDay(rc['dayId']) || !isValidCodeString(rc['code'])) return false;
      if (rc['reason'] !== (rc['kind'] === 'returned' ? 'code-mismatch' : null)) return false;
      const vi = rc['versionIndex'];
      if (i === 0 ? vi !== null || rc['kind'] !== 'returned' : typeof vi !== 'number' || !versions[vi]) return false;
    }

    // 回條與核對結果一一對應：每個已核對的版本恰有一張同種類、同日期的回條；未核對的版本沒有回條
    for (const [i, ver] of versions.entries()) {
      const vr = ver as Record<string, unknown>;
      const matching = receipts.filter((rc) => isPlainObject(rc) && rc['versionIndex'] === i) as Record<string, unknown>[];
      if (vr['outcome'] === undefined) {
        if (matching.length !== 0) return false;
      } else {
        const rc = matching[0];
        if (matching.length !== 1 || !rc || rc['kind'] !== vr['outcome'] || rc['dayId'] !== vr['checkedDayId']) return false;
        if (rc['code'] !== vr['code']) return false;
      }
      // 重送的預定核對日必須晚於受理日（通常是下一工作日；舊檔遷移時可能順延）；null 只出現在最後一天之後
      if (vr['action'] === 'resubmit' && vr['checkDayId'] !== null) {
        if (dir.days.indexOf(String(vr['checkDayId'])) <= dir.days.indexOf(String(vr['dayId']))) return false;
      }
    }

    // 狀態與最後版本一致；只有下游核對能結案
    const last = versions[versions.length - 1] as Record<string, unknown> | undefined;
    switch (r['status']) {
      case 'pending':
        if (last && last['outcome'] !== 'returned') return false;
        break;
      case 'awaiting-check':
        if (!last || last['action'] !== 'resubmit' || last['outcome'] !== undefined || r['dueDayId'] !== null) return false;
        // 尚未核對：預定核對日必須還沒到（已到的日子在進入時就會核對）
        if (last['checkDayId'] !== null && dir.days.indexOf(String(last['checkDayId'])) <= today) return false;
        break;
      case 'awaiting-window':
        if (!last || last['action'] !== 'window' || r['dueDayId'] !== null) return false;
        break;
      case 'resolved':
        if (!last || last['outcome'] !== 'resolved' || r['dueDayId'] !== null) return false;
        break;
    }
  }
  return true;
}

/** v7 舊檔（R8）：v8 少了 caseReviews；規則相同。 */
export function isValidLegacySaveV7(s: unknown, dir: DayDirectory): s is SaveV7 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 7) return false;
  return isValidV7Fields(s, dir);
}

function isValidV7Fields(s: Record<string, unknown>, dir: DayDirectory): boolean {
  if (!isValidChatReplies(s['chatReplies'])) return false;
  if (!isValidWaived(s['waivedTasks'], s, dir)) return false;
  return isValidSaveBody(s, dir);
}

/** 案件閱讀狀態：case 必須存在、變體屬於該案件、標記為不重複字串。 */
function isValidCaseReviews(v: unknown, dir: DayDirectory): boolean {
  if (!isPlainObject(v)) return false;
  for (const [caseId, state] of Object.entries(v)) {
    const found = findCase(dir, caseId);
    if (!found || !isPlainObject(state)) return false;
    if (typeof state['variantId'] !== 'string' || !found.casePlan.variantIds.includes(state['variantId'])) return false;
    const marks = state['marks'];
    if (!isStringArray(marks) || new Set(marks).size !== marks.length) return false;
  }
  return true;
}

/**
 * 現行規則（R6-02／R8）。
 *
 * - 以存檔自己的 `dayId` 查內容目錄；active `taskId` 必須屬於當日佇列。
 * - 當日排在 active 之前的工作必須已完成或免補；wrap／end 時當日全部完成或免補；
 *   morning 只出現在第一天之後，且 active 必須是當日第一件尚未完成的工作。
 * - 階段與日程一致：有下一日卻 end、無下一日卻 wrap 都拒絕。
 * - 前面每一天的每件工作都必須已完成或免補。
 * - 進度以 taskId 為鍵、依 kind 驗證；映射欄位不存在或來源重複都拒絕。
 * - 只對「目前工作的批次」比對內容；歷史批次只驗結構與快照，不拿新版內容覆寫。
 */
function isValidSaveBody(s: Record<string, unknown>, dir: DayDirectory): boolean {
  if (!isValidSeed(s['seed'])) return false;
  if (!STAGES.includes(s['stage'] as never)) return false;
  if (!Array.isArray(s['events'])) return false;
  if (!isStringArray(s['readMessages'])) return false;

  const dayId = s['dayId'];
  if (typeof dayId !== 'string') return false;
  const plan = dir.plan(dayId);
  if (!plan) return false;
  const activeIndex = plan.tasks.findIndex((t) => t.id === s['taskId']);
  const active = plan.tasks[activeIndex];
  if (!active) return false;
  // 不適用的工作（沒有退件的複審）不會成為目前工作
  if (!isRawTaskApplicable(s, active)) return false;

  const batches = s['batches'];
  if (!isPlainObject(batches)) return false;
  for (const batch of Object.values(batches)) {
    if (!isValidBatchShape(batch, true)) return false;
  }
  if (!isValidTaskProgress(s['taskProgress'], dir)) return false;

  // 目前工作的批次（歸檔寫入的批次，或核對所看的來源批次）：內容必須對得上該批次自己的資料集合
  const batchId = batchIdOfTask(active);
  if (batchId !== null) {
    const records = dir.records(batchId);
    const current = batches[batchId] as { archived?: Record<string, unknown>; drafts?: Record<string, unknown> } | undefined;
    const archived = current?.archived ?? {};
    for (const key of Object.keys(archived)) {
      const r = records.find((x) => x.key === key);
      if (!r) return false;
      const entry = archived[key] as {
        caseDecision?: { caseId: string; decisionId: string; destination: string; basisDocumentId: string };
      };
      // R10：不比對 archiveCode 與來源或決定預設值（格式合法的「填錯編號」不是毀損存檔）。
      // 案件決定仍須是該案件的合法決定，依據／去向與決定一致。
      if (entry.caseDecision !== undefined) {
        // 依 case ID 找案件本身（目前工作可能是讀這個批次的核對，不一定是歸檔工作）。
        const found = findCase(dir, entry.caseDecision.caseId);
        const casePlan = found && found.task.batchId === batchId && found.casePlan.recordKey === key ? found.casePlan : undefined;
        const decision = casePlan?.decisions.find((x) => x.id === entry.caseDecision?.decisionId);
        if (!decision) return false;
        if (entry.caseDecision.destination !== decision.destination) return false;
        if (entry.caseDecision.basisDocumentId !== decision.basisDocumentId) return false;
      }
    }
    for (const key of Object.keys(current?.drafts ?? {})) {
      if (!records.some((x) => x.key === key)) return false;
    }
  }

  // 當日佇列
  const stage = s['stage'] as Save['stage'];
  if (plan.tasks.slice(0, activeIndex).some((t) => !isRawTaskSettled(s, dir, t))) return false;
  if (stage === 'end' && plan.nextDayId !== null) return false;
  if (stage === 'wrap' && plan.nextDayId === null) return false;
  if ((stage === 'wrap' || stage === 'end') && plan.tasks.some((t) => !isRawTaskSettled(s, dir, t))) return false;

  // 前面每一天的每件工作都已完成或免補
  const index = dir.days.indexOf(dayId);
  if (stage === 'morning' && index === 0) return false;
  // 核對工作在送出回覆時就交付；已回覆卻仍是 work 的目前工作只可能是手改存檔，而且會卡住
  if (stage === 'work' && active.kind === 'reconcile' && isRawTaskDone(s, dir, active)) return false;
  // 次日收件：目前工作就是當日第一件尚未完成的工作（前面已由「active 之前全部已完成」檢查）
  if (stage === 'morning' && isRawTaskSettled(s, dir, active)) return false;
  for (const earlier of dir.days.slice(0, index)) {
    const p = dir.plan(earlier);
    if (!p || p.tasks.some((t) => !isRawTaskSettled(s, dir, t))) return false;
  }

  // 第一天之後必定已跨過一夜
  if (index > 0 && !isValidNight(s['night'])) return false;
  if (s['night'] !== undefined && !isValidNight(s['night'])) return false;

  return true;
}

/* ---------- v5／v6：結構＋日程對照，完整檢查在遷移成 v7 之後 ---------- */

/**
 * v2–v6 時代每天只有一件工作（即現行內容的當日第一件），因此舊檔的 taskId 必須是當日第一件、
 * 階段只有 work／wrap／end。其餘一致性（批次、前面日子已完成…）在遷移補上免補清單後以 v7 規則檢查。
 */
function isValidLegacyCurrentShape(s: Record<string, unknown>, dir: DayDirectory): boolean {
  if (!isValidSeed(s['seed'])) return false;
  if (!LEGACY_STAGES.includes(s['stage'] as never)) return false;
  if (!Array.isArray(s['events'])) return false;
  if (!isStringArray(s['readMessages'])) return false;
  if (typeof s['dayId'] !== 'string') return false;
  const plan = dir.plan(s['dayId']);
  if (!plan || plan.tasks[0]?.id !== s['taskId']) return false;
  const batches = s['batches'];
  if (!isPlainObject(batches)) return false;
  for (const batch of Object.values(batches)) if (!isValidBatchShape(batch, true)) return false;
  if (!isValidTaskProgress(s['taskProgress'], dir)) return false;
  if (s['night'] !== undefined && !isValidNight(s['night'])) return false;
  return true;
}

/** v6：v7 少了 waivedTasks、沒有 morning。 */
export function isValidLegacySaveV6(s: unknown, dir: DayDirectory): s is SaveV6 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 6) return false;
  if (!isValidChatReplies(s['chatReplies'])) return false;
  return isValidLegacyCurrentShape(s, dir);
}

/** v5：v6 少了 chatReplies。 */
export function isValidLegacySaveV5(s: unknown, dir: DayDirectory): s is SaveV5 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 5) return false;
  return isValidLegacyCurrentShape(s, dir);
}

/* ---------- 舊格式：結構檢查，供遷移使用 ---------- */

function isValidLegacyCommon(s: Record<string, unknown>): boolean {
  if (!isValidSeed(s['seed'])) return false;
  if (!PHASES.includes(s['phase'] as never)) return false;
  if (!Array.isArray(s['events'])) return false;
  if (!isValidEvidence(s['evidence'])) return false;
  const phase = s['phase'];
  if ((phase === 'day2' || phase === 'end') && !isValidNight(s['night'])) return false;
  if (phase === 'end' && !REPLIES.includes(s['reply'] as never)) return false;
  return true;
}

/** v2：全域 archived／drafts。內容比對交由遷移時的資料集合處理。 */
export function isValidLegacySaveV2(s: unknown): s is SaveV2 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 2) return false;
  if (!isValidLegacyCommon(s)) return false;
  const archived = s['archived'];
  const drafts = s['drafts'];
  if (!isPlainObject(archived) || !isPlainObject(drafts)) return false;
  for (const v of Object.values(archived)) if (!isValidArchived(v, false)) return false;
  for (const v of Object.values(drafts)) if (!isValidDraft(v)) return false;
  return true;
}

/** v3：批次化＋phase。 */
export function isValidLegacySaveV3(s: unknown): s is SaveV3 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 3) return false;
  if (!isValidLegacyCommon(s)) return false;
  if (typeof s['dayId'] !== 'string') return false;
  if (!Array.isArray(s['readMessages']) || s['readMessages'].some((m) => typeof m !== 'string')) return false;
  const batches = s['batches'];
  if (!isPlainObject(batches)) return false;
  for (const batch of Object.values(batches)) if (!isValidBatchShape(batch, true)) return false;
  return true;
}

/** v4：dayId＋stage＋taskId＋全域 evidence／reply。內容比對交由遷移後的 v5 驗證。 */
export function isValidLegacySaveV4(s: unknown): s is SaveV4 {
  if (!isPlainObject(s)) return false;
  if (s['version'] !== 4) return false;
  if (!isValidSeed(s['seed'])) return false;
  if (!STAGES.includes(s['stage'] as never)) return false;
  if (typeof s['dayId'] !== 'string' || typeof s['taskId'] !== 'string') return false;
  if (!Array.isArray(s['events'])) return false;
  if (!isValidEvidence(s['evidence'])) return false;
  if (!isStringArray(s['readMessages'])) return false;
  if (s['reply'] !== undefined && !REPLIES.includes(s['reply'] as never)) return false;
  if (s['night'] !== undefined && !isValidNight(s['night'])) return false;
  const batches = s['batches'];
  if (!isPlainObject(batches)) return false;
  for (const batch of Object.values(batches)) if (!isValidBatchShape(batch, true)) return false;
  return true;
}
