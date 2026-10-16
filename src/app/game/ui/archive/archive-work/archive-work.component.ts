import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  untracked,
  viewChild,
} from '@angular/core';
import { ALL_DOCUMENTS, HELP_PACKS, caseReviewForRecord, caseSourceDocument, helpRequestOf } from '../../../content/bundle';
import { recordLabel } from '../../../content/records';
import { ArchiveTaskText } from '../../../content/schema';
import { ARCHIVE_UI, CASE_REVIEW_UI, archiveFooterPending, archiveProgress, deliverLabel, helpUi } from '../../../content/text';
import { MissingPolicy, RecordKey, ValidationOk } from '../../../core/types';
import { VALIDATION_MESSAGES, isValidCodeString } from '../../../core/validate';
import { GameStateService } from '../../../state/game-state.service';
import { WorkDeliveryService } from '../../workbench/services/work-delivery.service';
import { OperationView, WorkOperationsService } from '../../../state/work-operations.service';
import { DesktopService } from '../../desktop/services/desktop.service';
import { MessagesNavigationService } from '../../messages/services/messages-navigation.service';
import { ArchiveCheckFormComponent } from '../archive-check-form/archive-check-form.component';
import { ArchiveQueueComponent, ArchiveQueueItem } from '../archive-queue/archive-queue.component';
import { CaseDoneView, CaseReviewComponent, CaseReviewView } from '../case-review/case-review.component';

/**
 * 歸檔工作（task kind `archive`）的容器（R6-01）：Day 1、3、4、5 共用同一套元件。
 *
 * 這裡只做頁面協調：取得遊戲狀態、保存畫面本地狀態（目前選取、預覽、欄位錯誤）、
 * 把資料以 input 傳給子元件，並把子元件回報的事件轉成 GameStateService 呼叫。
 * 當日的 eyebrow／heading／instruction 取自目前 archive task 的內容；
 * 跨日共用的介面字（進度、按鈕、欄位標籤）取自 ui.archive（ARCHIVE_UI）。不綁任何日別。
 * 呈現細節分別屬於 ArchiveQueueComponent（工作佇列）、ArchiveCheckFormComponent（來源／核對表單）
 * 與 ArchivePreviewComponent（預覽與確認）；子元件不注入狀態服務、不讀寫 localStorage。
 * 規則全部在 core/validate.ts 與 state service；草稿與已歸檔紀錄一律經由 GameStateService。
 *
 * R9：選取的紀錄若是多來源比對案件（`game.caseFor(key)`），核對表單換成 CaseReviewComponent；
 * 第一次選到時開案（變體只保存一次），差異標記經由 GameStateService。
 *
 * R10：人員編號只驗型別與必填，照玩家輸入原樣保存，驗證時不暗中採用來源。
 * R11：沒有來源編號帶入——新紀錄與新開的案件編號欄位一律空白，由玩家自己輸入；已有草稿（含重新載入）與已提交紀錄照舊顯示。
 * 確認歸檔／確認處理經 WorkOperationsService（接收 → 格式檢查 → 處理 → 保存），
 * 處理中停用提交（連點只保存一次），表單旁顯示實際階段；寫入失敗可重試。
 * 案件的處理方式（依據／去向／註記）存在草稿的 decisionId，選方式不改動玩家的編號草稿。
 * R12 §4：拒絕紀錄欄旁「這個欄位是什麼？」→ 第一次送出提問（每份存檔一次），打開通訊並定位到自己的提問；
 * 之後只定位既有說明、不重送。草稿本來就在存檔中，這裡不清除；不開對話框、不阻擋工作。
 */
/** 拒絕紀錄欄的詢問說明包（R12 §4）；提問 ID 由內容包決定，不寫死在元件。 */
const REFUSAL_HELP_PACK_ID = 'help.refusal-record';
const REFUSAL_REQUEST_ID: string | null = HELP_PACKS.find((h) => h.id === REFUSAL_HELP_PACK_ID)?.request.id ?? null;

/** 依據文件的標題；內容日後移除該文件時顯示空白，不讓舊快照失效、不顯示 ID。 */
function basisHeading(documentId: string): string {
  const doc = ALL_DOCUMENTS.find((d) => d.id === documentId);
  return doc?.kind === 'case-source' ? doc.text.heading : '';
}

@Component({
  selector: 'app-archive-work',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ArchiveQueueComponent, ArchiveCheckFormComponent, CaseReviewComponent],
  templateUrl: './archive-work.component.html',
})
export class ArchiveWorkComponent {
  protected readonly game = inject(GameStateService);
  private readonly delivery = inject(WorkDeliveryService);
  private readonly ops = inject(WorkOperationsService);
  private readonly desktop = inject(DesktopService);
  private readonly nav = inject(MessagesNavigationService);

  /** 處理中：停用所有提交按鈕（同一時間只處理一件提交）。 */
  protected readonly busy = this.ops.busy;

  /** 跨日共用的歸檔介面字。 */
  protected readonly ui = ARCHIVE_UI;

  /** 目前 archive task 的當日文字；不是歸檔日時為 null（work view 不會掛上本元件）。 */
  protected readonly text = computed<ArchiveTaskText | null>(() => {
    const task = this.game.taskContent();
    return task?.kind === 'archive' ? task.text : null;
  });

  /** 一般紀錄的核對表單；案件紀錄改顯示 CaseReviewComponent，此時不存在。 */
  private readonly checkForm = viewChild<ArchiveCheckFormComponent>('checkForm');
  private readonly caseReview = viewChild<CaseReviewComponent>('caseReview');
  private readonly injector = inject(Injector);

  /**
   * 目前選取項目只存在元件內，不寫入存檔：切換工作／訊息／公告或重新載入後，
   * 一律回到目前批次的第一筆（沿用既有行為）。草稿與已歸檔狀態仍由 GameStateService 保存。
   * R8：選取、預覽與欄位錯誤都用 `linkedSignal` 綁在 taskId 上——同日換到下一件歸檔工作時
   * （元件沿用），三者一起重設為新批次第一筆、無預覽、無錯誤。
   */
  private readonly picked = linkedSignal<string | null, RecordKey>({
    source: this.game.taskId,
    computation: () => this.game.records()[0]?.key ?? '',
  });
  /**
   * 實際使用的選取：必須屬於目前批次，否則退回目前批次第一筆。
   * 防止任何時序下拿前一批的 key 呼叫 `game.record()`（會拋錯）。
   */
  protected readonly selected = computed<RecordKey>(() => {
    const key = this.picked();
    const records = this.game.records();
    return records.some((r) => r.key === key) ? key : (records[0]?.key ?? '');
  });
  protected readonly preview = linkedSignal<string | null, ValidationOk | null>({
    source: this.game.taskId,
    computation: () => null,
  });
  protected readonly fieldError = linkedSignal<string | null, string>({
    source: this.game.taskId,
    computation: () => '',
  });

  protected readonly record = computed(() => this.game.record(this.selected()));
  protected readonly draft = computed(() => this.game.draft(this.selected()));
  protected readonly done = computed(() => this.game.archived(this.selected()));

  /* ---------- 多來源比對案件（R9；資料驅動，不綁日別或編號） ---------- */

  /**
   * 目前選取是否為比對案件：狀態層有案件計畫，且不是「舊檔已歸檔但沒有案件決定」
   * （舊檔不補造選擇、不要求重做，照一般已歸檔結果顯示）。
   */
  private readonly casePlan = computed(() => {
    const plan = this.game.caseFor(this.selected());
    const archived = this.done();
    return plan && !(archived && !archived.caseDecision) ? plan : undefined;
  });
  protected readonly isCase = computed(() => this.casePlan() !== undefined);

  /**
   * 案件畫面資料：兩份來源＋已保存的那一個補件收件狀態變體（另一個變體不查、不傳）。
   * 尚未開案（變體未保存）時為 null。
   */
  protected readonly caseView = computed<CaseReviewView | null>(() => {
    const plan = this.casePlan();
    const taskId = this.game.taskId();
    if (!plan || !taskId) return null;
    const state = this.game.caseState(plan.id);
    const entry = caseReviewForRecord(taskId, plan.recordKey);
    if (!state || !entry) return null;
    const variant = entry.review.receiptVariants.find((v) => v.id === state.variantId);
    return {
      caseId: plan.id,
      review: entry.review,
      sources: entry.review.sourceDocumentIds.map(caseSourceDocument),
      supporting: variant ? caseSourceDocument(variant.documentId) : null,
      marks: state.marks,
    };
  });

  /** 已提交的案件處理摘要（取自提交快照，不從目前內容重算）。 */
  protected readonly caseDone = computed<CaseDoneView | null>(() => {
    const a = this.done();
    const d = a?.caseDecision;
    if (!a || !d) return null;
    return {
      code: a.archiveCode,
      destination: CASE_REVIEW_UI.destination[d.destination],
      basis: basisHeading(d.basisDocumentId),
      note: d.note,
    };
  });

  protected readonly caseError = linkedSignal<string | null, string>({
    source: this.game.taskId,
    computation: () => '',
  });

  /** 本畫面最近一次送出的是哪一筆（只在畫面；換工作時重設）。 */
  private readonly submittedKey = linkedSignal<string | null, RecordKey | null>({
    source: this.game.taskId,
    computation: () => null,
  });

  /**
   * 表單旁顯示的提交階段：目前工作的歸檔／案件提交。處理中一律顯示（按鈕都停用）；
   * 結束後只在送出的那一筆顯示（已保存／保存失敗），選到其他筆不顯示別筆的結果。
   * 換頁回來時元件重建：處理中的提交仍會顯示，因為狀態在服務裡，不依附本元件。
   */
  protected readonly operation = computed<OperationView | null>(() => {
    const op = this.ops.current();
    if (!op || (op.kind !== 'archive' && op.kind !== 'case') || op.taskId !== this.game.taskId()) return null;
    return this.ops.busy() || this.submittedKey() === this.selected() ? op : null;
  });

  /** 拒絕紀錄欄旁的詢問入口文字：問過前「這個欄位是什麼？」，問過後「查看予安的說明」；內容沒有時不顯示。 */
  protected readonly helpLabel = computed<string | null>(() => {
    const id = REFUSAL_REQUEST_ID;
    const ui = id === null ? undefined : helpUi(id);
    if (id === null || !ui) return null;
    return this.game.helpRequest(id) ? ui.revisit : ui.ask;
  });

  /** 進度與頁尾的總筆數來自目前批次，不寫死。 */
  protected readonly progressText = computed(() =>
    archiveProgress(this.game.archivedCount(), this.game.totalRecords()),
  );
  protected readonly footerText = computed(() =>
    this.game.allArchived() ? ARCHIVE_UI.footerDone : archiveFooterPending(this.game.totalRecords()),
  );

  /** 佇列列表：可辨識識別（有姓名顯示姓名，否則顯示人員編號）與是否已提交。 */
  protected readonly queueItems = computed<readonly ArchiveQueueItem[]>(() =>
    this.game.records().map((r) => ({
      key: r.key,
      label: recordLabel(r),
      done: this.game.archived(r.key) !== undefined,
    })),
  );

  constructor() {
    // 第一次選到案件紀錄時開案：狀態層保存補件收件狀態變體一次；之後重新整理、換頁都不重抽。
    // R11：開案不寫入任何編號草稿（欄位保持空白或既有草稿）。
    effect(() => {
      const plan = this.casePlan();
      if (!plan || this.done() || this.game.caseState(plan.id)) return;
      untracked(() => this.game.openCase(plan.id));
    });
  }

  protected select(key: RecordKey): void {
    this.picked.set(key);
    this.resetFeedback();
  }

  protected onInput(value: string): void {
    this.game.updateDraft(this.selected(), { value });
    this.resetFeedback();
  }

  protected setPolicy(policy: MissingPolicy): void {
    this.game.updateDraft(this.selected(), { policy });
    this.resetFeedback();
  }

  protected onValidate(): void {
    const result = this.game.validate(this.selected());
    if (!result.ok) {
      this.fieldError.set(result.error);
      this.preview.set(null);
      this.focusInput();
      return;
    }
    this.fieldError.set('');
    this.preview.set(result);
  }

  /** 確認歸檔：送出通過驗證的結果（照玩家輸入原樣）；處理中或已提交時不重送。 */
  protected async onConfirm(): Promise<void> {
    const p = this.preview();
    const key = this.selected();
    if (!p || this.done() || this.busy()) return;
    this.submittedKey.set(key);
    const saved = await this.ops.archive(key, p);
    if (saved && this.selected() === key) this.preview.set(null);
  }

  /** 寫入失敗後重試同一件提交（服務保證不重複事件）。 */
  protected async onRetry(): Promise<void> {
    const key = this.submittedKey();
    const saved = await this.ops.retry();
    if (saved && key !== null && this.selected() === key) {
      this.preview.set(null);
      if (this.isCase()) afterNextRender(() => this.caseReview()?.focusDone(), { injector: this.injector });
    }
  }

  protected onCaseMark(label: string): void {
    const plan = this.casePlan();
    if (plan) this.game.toggleCaseMark(plan.id, label);
  }

  /** 案件的人員編號草稿（玩家輸入）；不影響已選的處理方式。 */
  protected onCaseCode(value: string): void {
    this.game.updateDraft(this.selected(), { value });
    this.caseError.set('');
  }

  /** 選擇處理方式＝依據／去向／註記；只存 decisionId，不改動編號草稿（R10）。 */
  protected onCaseDecide(decisionId: string): void {
    this.game.updateDraft(this.selected(), { decisionId });
    this.caseError.set('');
  }

  /**
   * 確認案件處理：三種決定都合法；檢查「有選方式」、編號必填（只驗型別）與既有的缺值處理規則，
   * 再以玩家實際的編號草稿送出。
   */
  protected async onCaseConfirm(): Promise<void> {
    const plan = this.casePlan();
    const key = this.selected();
    if (!plan || this.done() || this.busy()) return;
    const draft = this.draft();
    const decisionId = plan.decisions.some((d) => d.id === draft.decisionId) ? (draft.decisionId ?? null) : null;
    if (decisionId === null) {
      this.caseError.set(CASE_REVIEW_UI.decisionRequired);
      return;
    }
    if (!isValidCodeString(draft.value)) {
      this.caseError.set(VALIDATION_MESSAGES.codeRequired);
      this.caseReview()?.focusCode();
      return;
    }
    const r = this.record();
    if (r.refusalApplies && r.refusal === null && !draft.policy) {
      this.caseError.set(VALIDATION_MESSAGES.policyRequired);
      return;
    }
    this.caseError.set('');
    this.submittedKey.set(key);
    const saved = await this.ops.commitCase(key, decisionId, draft.value);
    if (saved && this.selected() === key) {
      afterNextRender(() => this.caseReview()?.focusDone(), { injector: this.injector });
    }
  }

  /** 已處理後回到佇列：選取下一筆未處理的紀錄（沒有則留在原處）。 */
  protected onCaseBack(): void {
    const next = this.game.records().find((r) => !this.game.archived(r.key));
    if (next) this.select(next.key);
  }

  /**
   * 交付按鈕文字：當日還有其他工作 →「交付此項工作」；最後一項 →「完成今日交接」。
   * 交付最後一項後 stage 已離開 work（導航完成前），仍維持「完成今日交接」不閃動。
   */
  protected readonly deliverText = computed(() =>
    deliverLabel(this.game.stage() !== 'work' || this.game.isLastTask()),
  );

  /**
   * 交付此項工作／完成今日交接 → 依新 stage 導向：
   * 當日還有工作時仍是 work（停在 /work，WorkView 換成下一件）；全部完成才到日結或結束。
   */
  protected onDeliver(): void {
    // M1：當日最後一件先打開「本日交接」，確認後才離開桌面（WorkDeliveryService）
    this.delivery.deliver();
  }

  /**
   * 向同事詢問拒絕紀錄欄：第一次送出提問（之後只定位），打開通訊並捲到自己的提問列。
   * 不動草稿、預覽或欄位錯誤；寫入失敗時照樣打開對話，但沒有提問列可定位。
   */
  protected onAskHelp(): void {
    const id = REFUSAL_REQUEST_ID;
    const request = id === null ? undefined : helpRequestOf(id);
    if (id === null || !request) return;
    if (!this.game.helpRequest(id)) this.game.requestHelp(id);
    this.desktop.openApp('messages');
    if (this.game.helpRequest(id)) this.nav.revealEntry(request.channelId, `${id}:you`);
    else this.nav.select(request.channelId);
  }

  private resetFeedback(): void {
    this.preview.set(null);
    this.fieldError.set('');
    this.caseError.set('');
  }

  private focusInput(): void {
    this.checkForm()?.focusCode();
  }
}
