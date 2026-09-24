import { Injectable, inject, signal } from '@angular/core';
import { OperationView, WorkOperationsService } from '../../../state/work-operations.service';

/**
 * 附件文件的修訂送出（R12 §1）：「重新送審／註記並送窗口待查」一律經 WorkOperationsService
 * （接收 → 格式檢查 → 處理 → 保存），並帶著開啟的回條 ID——驗證與保存都重新確認它仍是案件目前可修訂的回條，
 * 過期的視窗或操作以失敗結束，不覆寫新版本。
 *
 * - 同一時間只處理一件（busy 時拒絕），兩個視窗不會重複送出。
 * - 記住目前這件提交屬於哪份回條（案件＋回條＋提交 ID），提交階段只顯示在那一份文件上；
 *   root 服務，關閉／最小化視窗、切換應用後仍在。只在畫面層，不保存遊戲資料。
 */
@Injectable({ providedIn: 'root' })
export class ReturnRevisionService {
  private readonly ops = inject(WorkOperationsService);

  private readonly target = signal<{ caseId: string; receiptId: string; opId: number } | null>(null);

  /** 有提交處理中：所有附件的送出按鈕一起停用。 */
  readonly busy = this.ops.busy;

  /** 某份回條要顯示的提交階段；不是從它送出的提交為 null。 */
  operationFor(caseId: string, receiptId: string): OperationView | null {
    const op = this.ops.current();
    const t = this.target();
    if (!op || !t || t.caseId !== caseId || t.receiptId !== receiptId || t.opId !== op.id) return null;
    return op.kind === 'return-resubmit' || op.kind === 'return-window' ? op : null;
  }

  /** 重新送審（只驗型別；照填寫的字串原樣送出）。 */
  resubmit(caseId: string, receiptId: string, code: string): Promise<boolean> {
    if (this.busy()) return Promise.resolve(false);
    return this.track(caseId, receiptId, this.ops.resubmitReturn(caseId, receiptId, code));
  }

  /** 註記並送窗口待查（仍屬未解決）。 */
  sendToWindow(caseId: string, receiptId: string): Promise<boolean> {
    if (this.busy()) return Promise.resolve(false);
    return this.track(caseId, receiptId, this.ops.sendReturnToWindow(caseId, receiptId));
  }

  /** 保存失敗後重試（只重試這份回條自己的提交）。 */
  retry(caseId: string, receiptId: string): Promise<boolean> {
    const t = this.target();
    if (t?.caseId !== caseId || t.receiptId !== receiptId) return Promise.resolve(false);
    return this.track(caseId, receiptId, this.ops.retry());
  }

  /** 提交被受理時 WorkOperationsService 會同步建立新的 current()；記下它屬於哪份回條。 */
  private track(caseId: string, receiptId: string, run: Promise<boolean>): Promise<boolean> {
    const op = this.ops.current();
    if (op) this.target.set({ caseId, receiptId, opId: op.id });
    return run;
  }
}
