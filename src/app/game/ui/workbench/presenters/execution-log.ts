import { ALL_DOCUMENTS, reconcileTask } from '../../../content/bundle';
import { DOCUMENT_ISSUES_UI, EXECUTION_LOG_UI, OPERATION_UI, RECORD_REVIEW_UI, RETURNED_REVIEW_UI, caseNumber } from '../../../content/text';
import { EVENT_KINDS } from '../../../core/rules';
import { GameEvent, MissingPolicy, Reply, ReviewDisposition, Save } from '../../../core/types';
import type { DayTaskItem } from '../../../state/game-state.service';
import type { OperationKind, OperationStage, OperationView } from '../../../state/work-operations.service';
import { archivedRefusalStatus } from '../../shared/presenters/record-status';

/**
 * 系統作業紀錄（R8 §3）的純函式 presenter。
 *
 * 只轉寫「玩家已操作、已保存且可見」的流程結果：輸入是當日事件（依發生順序）、
 * 存檔中的批次提交快照與工作進度、以及當日工作清單的筆數。每個業務事件產生一筆紀錄：
 *   archive           → `$ archive.submit <人員編號>`，值取批次提交快照；
 *                       比對案件（R9）另取案件決定快照：去向（正式歸檔／窗口待查）、依據文件標題與差異註記
 *   reply.submit      → `$ reply.submit`，回覆文字取核對任務的選項
 *   field-map.submit  → `$ import.submit`，列數／空白數／處理方式取提交快照
 *   record.review     → `$ review.record <審查時看到的編號>`，值取保存的審查紀錄（審查時的送件編號、原始來源編號），
 *                       處置文字取 ui.recordReview（核對後放行／保留待查）
 *   return.resubmit   → `$ return.submit <本次送出的編號>`，狀態取 ui.returnedReview（已重新送審）
 *   return.window     → `$ return.submit <編號>`，狀態取 ui.returnedReview（等待窗口確認）
 *                       （R11：版本以事件的 versionIndex 對應；舊檔事件沒有時依同案同動作的第 n 次）
 *   return.checked    → `$ receipt.check <案號>`（R11 下游回條），result 取 ui.documentIssues（已解決／再次退回），
 *                       personnelId 為該版本送出的編號——只描述文件核對的結果，不做其他判定
 *   task.complete     → `$ task.handoff`，交付筆數取工作清單
 * 其他事件（day.complete、夜間判定、聊天回覆、第一次退件通知、R12 向同事詢問 help.request……）不產生紀錄；
 * 退件通知不在紀錄中責備任何人。不認得的事件種類（例如較新版本的存檔）一律略過，不拋錯。
 *
 * R10：`withOperation()` 再把目前這件提交（WorkOperationsService.current()）逐階段接上：
 * 處理中／失敗（尚未保存）時是最後一筆「待完成」紀錄；保存成功後把階段行接在它產生的那筆紀錄上。
 *
 * 規則：值一律是 JSON 文案或玩家看得到的資料（人員編號、筆數）；不輸出 origin 代碼、
 * true／false／null、task／batch ID、夜間判定或任何「安排」結果；不序列化整份存檔。
 * 字串值以 JSON 字串字面值呈現（只對單一值做跳脫），數字照原樣。
 */

/** 一個 `"key":value` 欄位；value 已是可直接顯示的 JSON 字面值（字串含引號）。 */
export interface LogField {
  key: string;
  value: string;
  /** 值的語法類別，只給畫面上色用。 */
  type: 'string' | 'number';
}

export interface LogEntry {
  /** 追蹤用（對應事件的保存 id）；不顯示。 */
  id: string;
  command: string;
  /** 指令參數（實際提交的人員編號；下游回條為案號）；沒有則為 null。 */
  arg: string | null;
  /** 提交過程逐行輸出（每個階段一行 JSON）；只有本次工作階段中目前這件提交才有。 */
  trail?: readonly LogField[];
  /** 最後一行 JSON（保存的結果）；處理中的提交為空陣列。 */
  fields: readonly LogField[];
  /** 尚未保存的提交：處理中或保存失敗。 */
  pending?: 'running' | 'failed';
  /** 失敗是寫入問題、可原樣重試；規則不允許（例如附件已不是目前版本）時為 false。 */
  retryable?: boolean;
}

export interface ExecutionLogInput {
  /** 當日事件，依發生順序（GameStateService.dayEvents()）。 */
  events: readonly GameEvent[];
  save: Save;
  /** 當日工作清單（GameStateService.dayTasks()）。 */
  tasks: readonly DayTaskItem[];
}

type LogText = typeof EXECUTION_LOG_UI;

function str(key: string, value: string): LogField {
  return { key, value: JSON.stringify(value), type: 'string' };
}

function num(key: string, value: number): LogField {
  return { key, value: String(value), type: 'number' };
}

function record(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
}

function stringOf(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' ? v : null;
}

function numberOf(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

const REPLIES: readonly Reply[] = ['ack', 'ask', 'review'];

function blankPolicyText(policy: MissingPolicy, text: LogText): string {
  return policy === 'default_false' ? text.blank.default : text.blank.review;
}

function archiveEntry(event: GameEvent, save: Save, text: LogText): LogEntry | null {
  const p = record(event.payload);
  const batchId = stringOf(p, 'batchId');
  const key = stringOf(p, 'key');
  if (!batchId || !key) return null;
  const snapshot = save.batches[batchId]?.archived[key];
  if (!snapshot) return null;
  const decision = snapshot.caseDecision;
  const fields: LogField[] = [
    str(text.key.check, text.check.pass),
    str(text.key.personnelId, snapshot.archiveCode),
    str(text.key.status, archivedRefusalStatus(snapshot)),
  ];
  if (decision) {
    // 比對案件：只轉寫玩家實際提交的去向、依據與註記，不寫誰對誰錯
    fields.push(str(text.key.destination, text.caseDestination[decision.destination]));
    const basis = caseDocumentHeading(decision.basisDocumentId);
    if (basis !== null) fields.push(str(text.key.basis, basis));
    fields.push(str(text.key.note, decision.note));
  } else {
    fields.push(str(text.key.destination, snapshot.origin === 'review' ? text.destination.review : text.destination.archive));
  }
  return { id: event.id, command: text.command.archive, arg: snapshot.archiveCode, fields };
}

/** 依據文件的標題（玩家在畫面上看過的文字）；內容已移除該文件時回傳 null，不輸出 ID、不猜值。 */
function caseDocumentHeading(documentId: string): string | null {
  const doc = ALL_DOCUMENTS.find((d) => d.id === documentId);
  return doc?.kind === 'case-source' ? doc.text.heading : null;
}

function replyEntry(event: GameEvent, tasks: readonly DayTaskItem[], text: LogText): LogEntry | null {
  const p = record(event.payload);
  const taskId = stringOf(p, 'taskId');
  const choice = stringOf(p, 'choice') as Reply | null;
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task || task.kind !== 'reconcile' || !choice || !REPLIES.includes(choice)) return null;
  return {
    id: event.id,
    command: text.command.reply,
    arg: null,
    fields: [
      str(text.key.reply, reconcileTask(task.taskId).text.choices[choice]),
      str(text.key.result, choice === 'review' ? text.result.sentReview : text.result.sent),
    ],
  };
}

function fieldMapEntry(event: GameEvent, save: Save, tasks: readonly DayTaskItem[], text: LogText): LogEntry | null {
  const taskId = stringOf(record(event.payload), 'taskId');
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task || task.kind !== 'field-map') return null;
  const progress = save.taskProgress[task.taskId];
  const submitted = progress?.kind === 'field-map' ? progress.submitted : undefined;
  if (!submitted) return null;
  const fields = [num(text.key.rows, submitted.rowCount), num(text.key.blank, submitted.affectedCount)];
  if (submitted.blankPolicy !== null) fields.push(str(text.key.blankPolicy, blankPolicyText(submitted.blankPolicy, text)));
  return { id: event.id, command: text.command.fieldMap, arg: null, fields };
}

function recordReviewEntry(event: GameEvent, save: Save, text: LogText): LogEntry | null {
  const p = record(event.payload);
  const taskId = stringOf(p, 'taskId');
  const key = stringOf(p, 'key');
  const disposition = stringOf(p, 'disposition') as ReviewDisposition | null;
  if (!taskId || !key || (disposition !== 'release' && disposition !== 'hold')) return null;
  const progress = save.taskProgress[taskId];
  const review = progress?.kind === 'reconcile' ? progress.reviews?.[key] : undefined;
  if (!review) return null;
  return {
    id: event.id,
    command: text.command.recordReview,
    arg: review.reviewedCode,
    fields: [
      str(text.key.personnelId, review.reviewedCode),
      str(text.key.source, review.sourceCode),
      str(text.key.result, disposition === 'release' ? RECORD_REVIEW_UI.release : RECORD_REVIEW_UI.hold),
    ],
  };
}

/**
 * 文件問題的處理：事件的 versionIndex 對應處理版本（舊檔事件沒有時，第 n 次同案同動作事件對應第 n 個同動作版本）；
 * 編號取該版本實際送出的值。狀態文字只描述處理結果（已重新送審／等待窗口確認），不寫誰對誰錯。
 */
function returnEntry(event: GameEvent, save: Save, occurrence: number, text: LogText): LogEntry | null {
  const p = record(event.payload);
  const returnId = stringOf(p, 'returnId');
  const index = numberOf(p, 'versionIndex');
  const item = save.returns.find((r) => r.id === returnId);
  const action = event.kind === EVENT_KINDS.returnResubmit ? 'resubmit' : 'window';
  const version =
    index !== null
      ? item?.versions.find((v) => v.index === index && v.action === action)
      : item?.versions.filter((v) => v.action === action)[occurrence];
  if (!item || !version) return null;
  return {
    id: event.id,
    command: text.command.returnReview,
    arg: version.code,
    fields: [
      str(text.key.personnelId, version.code),
      str(text.key.status, action === 'resubmit' ? RETURNED_REVIEW_UI.resubmitted : RETURNED_REVIEW_UI.pendingWindow),
    ],
  };
}

/**
 * 下游回條（R11）：進入新的一天時，下游核對前一工作日重送的版本——指令參數是案號，
 * 結果只寫文件核對的結論（已解決／再次退回）與所核對的送件編號。
 */
function receiptCheckEntry(event: GameEvent, save: Save, text: LogText): LogEntry | null {
  const p = record(event.payload);
  const item = save.returns.find((r) => r.id === stringOf(p, 'returnId'));
  const index = numberOf(p, 'versionIndex');
  const version = item?.versions.find((v) => v.index === index);
  const outcome = version?.outcome ?? stringOf(p, 'outcome');
  if (!item || !version || (outcome !== 'resolved' && outcome !== 'returned')) return null;
  const number = caseNumber(item.auditId, item.recordKey);
  return {
    id: event.id,
    command: text.command.receiptCheck,
    arg: number,
    fields: [
      str(text.key.result, outcome === 'resolved' ? DOCUMENT_ISSUES_UI.status.resolved : DOCUMENT_ISSUES_UI.outcome.returned),
      str(text.key.personnelId, version.code),
    ],
  };
}

function handoffEntry(event: GameEvent, tasks: readonly DayTaskItem[], text: LogText): LogEntry | null {
  const taskId = stringOf(record(event.payload), 'taskId');
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return null;
  return {
    id: event.id,
    command: text.command.handoff,
    arg: null,
    fields: [str(text.key.result, text.result.delivered), num(text.key.items, task.processed)],
  };
}

/** 當日事件 → 唯讀紀錄（依發生順序）；沒有業務事件時回傳空陣列（畫面顯示空狀態）。 */
export function buildExecutionLog(input: ExecutionLogInput, text: LogText = EXECUTION_LOG_UI): LogEntry[] {
  const out: LogEntry[] = [];
  const returnSeen = new Map<string, number>();
  for (const event of input.events) {
    let entry: LogEntry | null = null;
    switch (event.kind) {
      case EVENT_KINDS.archive:
        entry = archiveEntry(event, input.save, text);
        break;
      case EVENT_KINDS.replySubmit:
        entry = replyEntry(event, input.tasks, text);
        break;
      case EVENT_KINDS.fieldMapSubmit:
        entry = fieldMapEntry(event, input.save, input.tasks, text);
        break;
      case EVENT_KINDS.recordReview:
        entry = recordReviewEntry(event, input.save, text);
        break;
      case EVENT_KINDS.returnResubmit:
      case EVENT_KINDS.returnWindow: {
        const seenKey = `${event.kind}|${stringOf(record(event.payload), 'returnId') ?? ''}`;
        const n = returnSeen.get(seenKey) ?? 0;
        returnSeen.set(seenKey, n + 1);
        entry = returnEntry(event, input.save, n, text);
        break;
      }
      case EVENT_KINDS.returnChecked:
        entry = receiptCheckEntry(event, input.save, text);
        break;
      case EVENT_KINDS.taskComplete:
        entry = handoffEntry(event, input.tasks, text);
        break;
      default:
        // help.request 等非業務事件與未知種類：不產生紀錄
        break;
    }
    if (entry) out.push(entry);
  }
  return out;
}

/* ---------- 目前這件提交的執行過程（R10 §3） ---------- */

type OperationText = typeof OPERATION_UI;

/** 各種提交對應的指令（與保存後的紀錄相同）。 */
function operationCommand(kind: OperationKind, text: LogText): string {
  switch (kind) {
    case 'archive':
    case 'case':
      return text.command.archive;
    case 'reply':
      return text.command.reply;
    case 'field-map':
      return text.command.fieldMap;
    case 'return-resubmit':
    case 'return-window':
      return text.command.returnReview;
  }
}

/** 只有「玩家輸入的編號」可以當指令參數；回覆選項 ID、列數等不顯示在指令列。 */
function operationArg(op: OperationView): string | null {
  return op.kind === 'archive' || op.kind === 'case' || op.kind === 'return-resubmit' ? op.arg : null;
}

/** 一個階段 → 一行 JSON：過程是 status，結束是 result（已保存／保存失敗）。 */
function stageField(stage: OperationStage, text: LogText, op: OperationText): LogField {
  if (stage === 'done') return str(text.key.result, op.done);
  if (stage === 'failed') return str(text.key.result, op.failed);
  return str(text.key.status, op[stage]);
}

/**
 * 把目前這件提交接到紀錄上（純函式）：
 * - 處理中：最後多一筆待完成紀錄（指令列＋已經過的階段），還沒有結果行；
 * - 失敗：同上，最後一行是「保存失敗」（pending='failed'，畫面提供重試）；存檔沒有前進，所以沒有重複紀錄；
 * - 保存成功：找到它產生的那筆（同指令的最後一筆），把階段行接在結果行之前；找不到（例如已換日）就不顯示。
 * 不屬於今天工作的提交不顯示。指令參數與結果都來自實際提交／保存的快照。
 */
export function withOperation(
  entries: readonly LogEntry[],
  op: OperationView | null,
  tasks: readonly DayTaskItem[],
  text: LogText = EXECUTION_LOG_UI,
  opText: OperationText = OPERATION_UI,
): LogEntry[] {
  const out = [...entries];
  if (!op || !tasks.some((t) => t.taskId === op.taskId)) return out;
  const command = operationCommand(op.kind, text);
  const trail = op.trail.map((s) => stageField(s, text, opText));
  if (op.stage === 'done') {
    for (let i = out.length - 1; i >= 0; i--) {
      const e = out[i]!;
      if (e.command !== command) continue;
      out[i] = { ...e, trail };
      break;
    }
    return out;
  }
  const failed = op.stage === 'failed';
  out.push({
    id: `operation:${op.id}`,
    command,
    arg: operationArg(op),
    trail: failed ? trail.slice(0, -1) : trail,
    fields: failed ? [stageField('failed', text, opText)] : [],
    pending: failed ? 'failed' : 'running',
    ...(failed ? { retryable: op.failure === 'storage' } : {}),
  });
  return out;
}
