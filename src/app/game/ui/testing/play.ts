import { fieldMapTask } from '../../content/bundle';
import { MissingPolicy, RecordKey, Reply, ReviewDisposition, ValidationOk } from '../../core/types';
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
    default:
      throw new Error('completeTask：目前沒有工作');
  }
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
