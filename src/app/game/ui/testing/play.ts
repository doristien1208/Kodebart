import { fieldMapTask } from '../../content/bundle';
import { TransformPolicy } from '../../core/day-plan';
import { MissingPolicy, RecordKey, Reply, ReviewDisposition, ValidationOk } from '../../core/types';
import { AttachmentInput } from '../../core/workday';
import { GameStateService } from '../../state/game-state.service';
import { WorkOperationsService } from '../../state/work-operations.service';

/**
 * UI 規格共用的「照正常流程玩」工具（只給 *.spec.ts 匯入，不進 app bundle）。
 * 一律經 GameStateService 走真實規則，不手刻存檔；R8 起一天可以有多件工作。
 */

export function okOf(game: GameStateService, key: RecordKey): ValidationOk {
  const r = game.validate(key);
  if (!r.ok) throw new Error(`validation for ${key} failed: ${r.error}`);
  return r;
}

/**
 * 歸檔一筆：一般紀錄走驗證＋歸檔；多來源比對案件（R9）走開案＋提交決定
 * （decisionId 省略時用案件的第一個決定；R10 起人員編號由玩家填寫，這裡照該決定的預填值送出）。
 * code 省略＝照來源原字串；給定時照玩家輸入原樣保存（R10：只驗型別，例如 "102"）。
 */
export function archiveOne(
  game: GameStateService,
  key: RecordKey,
  policy: MissingPolicy,
  decisionId?: string,
  code?: string,
): void {
  if (game.archived(key)) return;
  const record = game.record(key);
  game.updateDraft(key, { value: code ?? record.code, policy });
  const plan = game.caseFor(key);
  if (plan) {
    game.openCase(plan.id);
    const decision = plan.decisions.find((d) => d.id === decisionId) ?? plan.decisions[0];
    if (!decision || !game.commitCase(key, decision.id, code ?? decision.archiveCode)) {
      throw new Error(`case ${plan.id} commit failed`);
    }
    return;
  }
  game.archive(key, okOf(game, key));
}

/** 核對工作的逐筆審查（R10）：目前核對工作引用的每一筆都給同一個處置；回覆前必須先做。 */
export function reviewAll(game: GameStateService, disposition: ReviewDisposition = 'release'): void {
  const task = game.task();
  if (task?.kind !== 'reconcile') return;
  for (const key of task.recordKeys) game.setRecordReview(key, disposition);
}

/** 提交流程（WorkOperationsService）不等待演出節奏：規格中各階段立即前進（資料結果本來就與節奏無關）。 */
export function instantOperations(ops: WorkOperationsService): WorkOperationsService {
  ops.wait = () => Promise.resolve();
  return ops;
}

/** 等 instantOperations 的提交跑完：各階段都是微任務，一個 macrotask 之後必定已結束。 */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 歸檔目前批次的全部紀錄（不交付）；缺拒絕紀錄者一律用 policy；案件用 decisionId（省略＝第一個決定）。 */
export function archiveAll(game: GameStateService, policy: MissingPolicy = 'default_false', decisionId?: string): void {
  for (const record of game.records()) archiveOne(game, record.key, policy, decisionId);
}

/**
 * 歸檔目前批次的全部紀錄，codes 指定某些紀錄的輸入（R10：照輸入原樣保存，例如 { B102: '102' }），
 * 其餘照來源原字串；不交付。
 */
export function archiveWith(
  game: GameStateService,
  codes: Readonly<Record<RecordKey, string>>,
  policy: MissingPolicy = 'default_false',
): void {
  for (const record of game.records()) archiveOne(game, record.key, policy, undefined, codes[record.key]);
}

/** 只歸檔目前批次的前 n 筆（不交付）；用來測「當日工作進度」解鎖條件。 */
export function archiveFirst(game: GameStateService, n: number, policy: MissingPolicy = 'default_false'): void {
  for (const record of game.records().slice(0, n)) archiveOne(game, record.key, policy);
}

/** 完成並交付目前這一件工作；回傳交付是否成功。 */
export function completeTask(
  game: GameStateService,
  policy: MissingPolicy = 'default_false',
  reply: Reply = 'ack',
  decisionId?: string,
): boolean {
  const task = game.task();
  switch (task?.kind) {
    case 'archive':
      archiveAll(game, policy, decisionId);
      return game.completeWork();
    case 'reconcile':
      game.openReport();
      game.openReceipt();
      reviewAll(game, 'release');
      return game.submitReply(reply);
    case 'return-review': {
      // 錯誤文件處理：照最後一次送出的編號原樣重新送審（只驗型別；差異保留，下一工作日由下游核對）
      // R12 版本鎖定：從案件目前可修訂的回條送出
      for (const item of game.activeReturns()) {
        if (item.status !== 'pending') continue;
        const receiptId = game.editableReceiptId(item.id) ?? '';
        if (game.resubmitReturnStrict(item.id, receiptId, game.latestIssueCode(item)) !== 'ok') return false;
      }
      return game.completeWork();
    }
    case 'field-map': {
      for (const t of fieldMapTask(task.id).targetFields) game.setFieldAssignment(t.id, t.sourceId);
      game.setFieldBlankPolicy(policy);
      game.previewFieldMap();
      game.submitFieldMap();
      return game.completeWork();
    }
    // M1 新增的工作種類（既有種類的行為不變）：附件引用第一份候選附件；
    // 批次的缺漏策略跟著歸檔的缺值處理（補登＝套用部門預設、送覆核＝保留缺漏）；報告建立後交付
    case 'attachment':
      game.markTaskOpened();
      if (game.submitAttachmentStrict({ choiceId: 'reference', documentId: task.candidates[0]?.documentId }) !== 'ok') return false;
      return game.completeWork();
    case 'transform':
      game.setTransformPolicy(policy === 'default_false' ? 'departmentDefault' : 'review');
      game.previewTransform();
      if (game.submitTransformStrict() !== 'ok') return false;
      return game.completeWork();
    case 'report':
      game.generateReport();
      if (game.submitReportStrict() !== 'ok') return false;
      return game.completeWork();
    default:
      throw new Error('completeTask：目前沒有工作');
  }
}

/**
 * M1 新增的工作種類（附件關聯、批次轉換、交付報告）用固定的處理方式完成並交付；
 * 目前工作不是這三種時回傳 null（呼叫端照原本的方式處理）。新增 helper，不改既有 helper 的行為。
 */
export function completeWorkdayTask(game: GameStateService, policy: MissingPolicy = 'default_false'): boolean | null {
  const kind = game.task()?.kind;
  return kind === 'attachment' || kind === 'transform' || kind === 'report' ? completeTask(game, policy) : null;
}

/** 完成當日全部工作（停在 wrap／end，不跨日）。 */
export function finishTasks(game: GameStateService, policy: MissingPolicy = 'default_false', decisionId?: string): void {
  let guard = 0;
  while (game.stage() === 'work') {
    if (!completeTask(game, policy, 'ack', decisionId)) throw new Error(`交付 ${game.taskId()} 失敗`);
    if (++guard > 20) throw new Error('finishTasks：工作數異常');
  }
}

/** 完成當日全部工作 → 本日交接 → 次日收件 → 開始下一日工作（最後一日停在 end）。 */
export function finishDay(game: GameStateService, policy: MissingPolicy = 'default_false', decisionId?: string): void {
  finishTasks(game, policy, decisionId);
  if (game.stage() === 'wrap') game.advanceDay();
  if (game.stage() === 'morning') game.startDay();
}

/** 從目前進度玩到指定日的工作階段；policyOf 決定各日歸檔的缺值處理；decisionId 為比對案件的決定（省略＝第一個）。 */
export function playTo(
  game: GameStateService,
  dayId: string,
  policyOf: (dayId: string) => MissingPolicy = () => 'default_false',
  decisionId?: string,
): void {
  let guard = 0;
  while (game.dayId() !== dayId) {
    const current = game.dayId();
    if (!current) throw new Error('playTo：沒有存檔');
    finishDay(game, policyOf(current), decisionId);
    if (++guard > 20) throw new Error(`playTo：到不了 ${dayId}`);
  }
}

/* ---------- M1：一份存檔一路的選擇（新增 helper） ---------- */

/** 一份存檔一路的選擇：歸檔輸入（codes）與缺值處理、各附件工作的處理（省略＝引用第一份候選）、批次缺漏策略。 */
export interface M1Choices {
  codes: Readonly<Record<RecordKey, string>>;
  policy: MissingPolicy;
  attach: Readonly<Record<string, AttachmentInput>>;
  transform: TransformPolicy;
}

/** 合法的錯編號（0314 打成 0341）＋錯附件（0314 引用 0521 的本人回覆）＋部門預設。 */
export const M1_SAVE_A: M1Choices = {
  codes: { B314: '0341' },
  policy: 'default_false',
  attach: { 'task.day4.m1-attachment': { choiceId: 'reference', documentId: 'doc.day4.m1-0521-reply' } },
  transform: 'departmentDefault',
};

/** 正確編號＋引用 0314 的窗口收件回條＋保留缺漏（各階段都不補值）。 */
export const M1_SAVE_B: M1Choices = {
  codes: {},
  policy: 'request_review',
  attach: { 'task.day4.m1-attachment': { choiceId: 'reference', documentId: 'doc.day4.m1-0314-window' } },
  transform: 'review',
};

/** 依選擇完成並交付目前這一件工作（交付失敗即丟例外，訊息含工作 ID）。 */
export function doM1Task(game: GameStateService, c: M1Choices): void {
  const task = game.task();
  const fail = (step: string): never => {
    throw new Error(`${task?.id ?? '（沒有工作）'}：${step}失敗`);
  };
  switch (task?.kind) {
    case 'archive':
      archiveWith(game, c.codes, c.policy);
      if (!game.completeWork()) fail('交付');
      return;
    case 'attachment':
      game.markTaskOpened();
      if (game.submitAttachmentStrict(c.attach[task.id] ?? { choiceId: 'reference', documentId: task.candidates[0]?.documentId }) !== 'ok') fail('送件');
      if (!game.completeWork()) fail('交付');
      return;
    case 'transform':
      game.setTransformPolicy(c.transform);
      if (!game.previewTransform()) fail('預覽');
      if (game.submitTransformStrict() !== 'ok') fail('執行');
      if (!game.completeWork()) fail('交付');
      return;
    default:
      if (!completeTask(game, c.policy)) fail('交付');
  }
}

/** 依選擇完成今天的工作（停在 wrap／end）。 */
export function playM1Day(game: GameStateService, c: M1Choices): void {
  for (let guard = 0; game.stage() === 'work'; guard++) {
    if (guard > 20) throw new Error('playM1Day：工作數異常');
    doM1Task(game, c);
  }
}

/** 依選擇從目前進度玩到指定日的工作階段（剛開工、尚未交付任何工作）；'end' 玩到結束。 */
export function playM1To(game: GameStateService, dayId: string, c: M1Choices): void {
  for (let guard = 0; game.dayId() !== dayId || game.stage() !== 'work'; guard++) {
    if (guard > 20) throw new Error(`playM1To：到不了 ${dayId}`);
    if (game.stage() === 'work') playM1Day(game, c);
    if (game.stage() === 'end') {
      if (dayId === 'end') return;
      throw new Error(`playM1To：${dayId} 之前就結束了`);
    }
    if (game.stage() === 'wrap') game.advanceDay();
    if (game.stage() === 'morning') game.startDay();
  }
}

/** 在目前這一天依選擇完成工作，直到目前工作是指定種類（不交付它）。 */
export function playM1UntilKind(game: GameStateService, kind: string, c: M1Choices): void {
  for (let guard = 0; game.task()?.kind !== kind; guard++) {
    if (guard > 20 || game.stage() !== 'work') throw new Error(`playM1UntilKind：今天沒有 ${kind}`);
    doM1Task(game, c);
  }
}
