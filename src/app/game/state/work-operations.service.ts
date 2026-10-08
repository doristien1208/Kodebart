import { Injectable, computed, inject, signal } from '@angular/core';
import { AttachmentInput, Reply, ValidationOk, attachmentInputError, findTask, isValidCodeString } from '../core';
import { DAY_DIRECTORY } from './day-directory';
import { SettingsService } from '../platform/settings.service';
import { CommitOutcome, GameStateService } from './game-state.service';

/**
 * 提交的執行過程（R10 §3）：接收 → 驗證結構／型別 → 處理資料 → 保存 → 成功／失敗。
 *
 * - 不依附單一畫面元件：切去訊息頁或最小化紀錄窗，回來仍看得到目前階段。
 * - 本機存檔，不新增 API、不偽造 HTTP；只有真正的寫入發生在「保存」階段，
 *   而且是交易式的（寫入成功才前進），因此結果不受播放速度影響，失敗可重試且不重複事件。
 * - 動態開啟時各階段間有短暫節奏（合計約 0.6 秒）讓階段可辨識；關閉動態或 reduced-motion 時立即完成。
 * - 同一時間只處理一件提交（busy 時拒絕重送）。重新整理後這裡是空的：未保存的處理不假裝完成。
 */
export type OperationStage = 'received' | 'validating' | 'validated' | 'processing' | 'saving' | 'done' | 'failed';

export type OperationKind =
  | 'archive'
  | 'case'
  | 'reply'
  | 'field-map'
  | 'return-resubmit'
  | 'return-window'
  | 'attachment'
  | 'attachment-revise'
  | 'transform'
  | 'report';

export interface OperationView {
  /** 本次工作階段內遞增的 ID。 */
  id: number;
  kind: OperationKind;
  taskId: string;
  /** 指令參數（例如實際提交的人員編號）；來自提交內容，不含內部 ID。 */
  arg: string;
  /** 目前階段。 */
  stage: OperationStage;
  /** 已經過的階段（依序），給 terminal 逐行追加。 */
  trail: readonly OperationStage[];
  /** 失敗原因：invalid＝結構／型別不符；rejected＝規則不允許；storage＝寫入失敗。 */
  failure: 'invalid' | 'rejected' | 'storage' | null;
}

/** 各階段之間的節奏（毫秒）；只在動態開啟時等待。 */
const STEP_MS = { validating: 120, processing: 160, saving: 160, done: 120 } as const;

interface OperationSpec {
  kind: OperationKind;
  arg: string;
  /** 提交所屬的工作（省略＝目前工作；修訂從郵件附件開啟時是附件工作）。 */
  taskId?: string;
  /** 結構／型別檢查；false＝不符（不寫入）。 */
  validate: () => boolean;
  /** 真正的寫入（交易式）。 */
  commit: () => CommitOutcome;
}

@Injectable({ providedIn: 'root' })
export class WorkOperationsService {
  private readonly game = inject(GameStateService);
  private readonly settings = inject(SettingsService);

  private readonly _current = signal<OperationView | null>(null);
  private lastSpec: OperationSpec | null = null;
  private seq = 0;

  /** 最近一次提交的狀態（本次工作階段）。 */
  readonly current = this._current.asReadonly();
  /** 處理中：禁止重送。 */
  readonly busy = computed(() => {
    const op = this._current();
    return op !== null && op.stage !== 'done' && op.stage !== 'failed';
  });

  /** 測試可替換的等待函式。 */
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------- 各種提交 ---------- */

  archive(key: string, ok: ValidationOk): Promise<boolean> {
    return this.run({
      kind: 'archive',
      arg: ok.code,
      validate: () => isValidCodeString(ok.code),
      commit: () => this.game.archiveStrict(key, ok),
    });
  }

  commitCase(key: string, decisionId: string, code: string): Promise<boolean> {
    return this.run({
      kind: 'case',
      arg: code,
      validate: () => isValidCodeString(code) && decisionId !== '',
      commit: () => this.game.commitCaseStrict(key, decisionId, code),
    });
  }

  submitReply(reply: Reply): Promise<boolean> {
    return this.run({
      kind: 'reply',
      arg: reply,
      validate: () => this.game.canReply(reply),
      commit: () => this.game.submitReplyStrict(reply),
    });
  }

  submitFieldMap(): Promise<boolean> {
    const check = this.game.fieldMapCheck();
    return this.run({
      kind: 'field-map',
      arg: String(check?.ok ? check.result.rowCount : 0),
      validate: () => this.game.fieldMapCheck()?.ok === true && this.game.fieldMap()?.previewed === true,
      commit: () => this.game.submitFieldMapStrict(),
    });
  }

  /**
   * 修訂重送（版本鎖定，R12）：receiptId 是玩家開啟的附件所引用的回條。
   * 格式檢查只驗結構；保存時由核心規則在寫入前重新確認它仍是案件目前可修訂的回條——
   * 附件已過期、或處理途中案件已被另一個視窗送出／換了新回條時，以 rejected 結束，不覆寫新版本。
   */
  resubmitReturn(returnId: string, receiptId: string, code: string): Promise<boolean> {
    return this.run({
      kind: 'return-resubmit',
      arg: code,
      validate: () => isValidCodeString(code),
      commit: () => this.game.resubmitReturnStrict(returnId, receiptId, code),
    });
  }

  sendReturnToWindow(returnId: string, receiptId: string): Promise<boolean> {
    return this.run({
      kind: 'return-window',
      arg: '',
      validate: () => true,
      commit: () => this.game.sendReturnToWindowStrict(returnId, receiptId),
    });
  }

  /**
   * 附件關聯送件（M1）：格式檢查只驗處理方式合法、引用時附件是候選附件；不判斷附件是否適用這個對象。
   * arg＝引用附件的標題（保留缺漏時為空字串）。
   */
  submitAttachment(input: AttachmentInput, arg: string): Promise<boolean> {
    const taskId = this.game.taskId() ?? '';
    return this.run({
      kind: 'attachment',
      arg,
      validate: () => {
        const task = findTask(DAY_DIRECTORY, taskId);
        return task?.kind === 'attachment' && attachmentInputError(task, input) === null;
      },
      commit: () => this.game.submitAttachmentStrict(input),
    });
  }

  /** 附件關聯修訂（版本鎖定）：保存時由核心規則確認 expectedIndex 仍是可修訂的版本，否則 rejected。 */
  reviseAttachment(taskId: string, expectedIndex: number, input: AttachmentInput, arg: string): Promise<boolean> {
    return this.run({
      kind: 'attachment-revise',
      arg,
      taskId,
      validate: () => {
        const task = findTask(DAY_DIRECTORY, taskId);
        return task?.kind === 'attachment' && attachmentInputError(task, input) === null;
      },
      commit: () => this.game.reviseAttachmentStrict(taskId, expectedIndex, input),
    });
  }

  /** 批次執行並交付（M1）：驗證處理設定 → 建立批次輸出 → 保存送件副本 → 加入後續佇列。arg＝列數。 */
  submitTransform(): Promise<boolean> {
    const taskId = this.game.taskId() ?? '';
    const check = this.game.transformCheck(taskId);
    return this.run({
      kind: 'transform',
      arg: String(check?.ok ? check.output.rows.length : 0),
      validate: () => this.game.transformCheck(taskId)?.ok === true && this.game.transformProgress(taskId).previewed,
      commit: () => this.game.submitTransformStrict(),
    });
  }

  /** 交付報告（M1）。arg＝報告列數。 */
  submitReport(): Promise<boolean> {
    const taskId = this.game.taskId() ?? '';
    return this.run({
      kind: 'report',
      arg: String(this.game.report(taskId)?.rows.length ?? 0),
      validate: () => this.game.reportGenerated(taskId) && this.game.report(taskId) !== null,
      commit: () => this.game.submitReportStrict(),
    });
  }

  /** 保存失敗後重試同一件提交（不會重複事件：失敗時存檔沒有前進）。 */
  retry(): Promise<boolean> {
    const op = this._current();
    if (!this.lastSpec || op?.stage !== 'failed') return Promise.resolve(false);
    return this.run(this.lastSpec);
  }

  /* ---------- 流程 ---------- */

  private async run(spec: OperationSpec): Promise<boolean> {
    if (this.busy()) return false;
    const taskId = spec.taskId ?? this.game.taskId() ?? '';
    this.lastSpec = spec;
    const id = ++this.seq;
    this._current.set({ id, kind: spec.kind, taskId, arg: spec.arg, stage: 'received', trail: ['received'], failure: null });

    await this.step(id, 'validating', STEP_MS.validating);
    if (!spec.validate()) return this.fail(id, 'invalid');
    this.advance(id, 'validated');

    await this.step(id, 'processing', STEP_MS.processing);
    await this.step(id, 'saving', STEP_MS.saving);
    const outcome = spec.commit();
    if (outcome === 'failed') return this.fail(id, 'storage');
    if (outcome === 'noop') return this.fail(id, 'rejected');

    await this.pause(STEP_MS.done);
    this.advance(id, 'done');
    return true;
  }

  private async step(id: number, stage: OperationStage, ms: number): Promise<void> {
    await this.pause(ms);
    this.advance(id, stage);
  }

  private pause(ms: number): Promise<void> {
    return this.settings.animationsEnabled() ? this.wait(ms) : Promise.resolve();
  }

  private advance(id: number, stage: OperationStage): void {
    this._current.update((op) => (op && op.id === id ? { ...op, stage, trail: [...op.trail, stage] } : op));
  }

  private fail(id: number, failure: NonNullable<OperationView['failure']>): false {
    this._current.update((op) => (op && op.id === id ? { ...op, stage: 'failed', trail: [...op.trail, 'failed'], failure } : op));
    return false;
  }
}
