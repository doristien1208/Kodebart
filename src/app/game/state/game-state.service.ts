import { Injectable, computed, inject, signal } from '@angular/core';
import { RECORDS } from '../content/records';
import { DAY1, STORAGE } from '../content/text';
import {
  ArchivedRecord,
  BatchId,
  Draft,
  RecordKey,
  Reply,
  SaveV3,
  SourceRecord,
  ValidationOk,
  ValidationResult,
  advanceToDay2,
  allArchived,
  archivedCount,
  batchOf,
  canReply,
  commitArchive,
  completeDay1,
  createSave,
  currentBatchId,
  isArrangedInSave,
  isMessageRead,
  markMessagesRead,
  markReceiptOpened,
  markReportOpened,
  setDraft,
  submitReply,
  validateRecord,
} from '../core';
import { createSeed } from '../platform/seed';
import { recordsForBatch } from './batch-records';
import { SaveRepository } from './save-repository';

/**
 * game/state：把純核心規則包成 Angular signals。
 *
 * 所有寫入都經過 commit() → 存檔；呈現層只讀 signals，不自行擲骰。
 * 歸檔與草稿以「目前工作批次」為範圍（KB-R4-05），但對外的方法簽名不變，
 * 呈現層不需要知道批次的存在。
 */
@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly repo = inject(SaveRepository);
  private readonly _save = signal<SaveV3 | null>(null);

  /** 目前存檔；null＝尚無紀錄（或讀取失敗）。 */
  readonly save = this._save.asReadonly();
  /** 儲存／讀取問題提示；空字串＝正常。 */
  readonly storageIssue = signal('');
  /** 一般操作提示（例如「歸檔完成。」）。 */
  readonly status = signal('');

  /**
   * 目前批次要處理的資料集合。今天等同 content 的 RECORDS；
   * Day 3–10 接上後由 recordsForBatch() 依批次回傳不同集合。
   */
  readonly records: readonly SourceRecord[] = RECORDS;
  readonly totalRecords = computed(() => this.records.length);

  /** 完成條件與驗證用：一律取「目前批次自己的」資料集合。 */
  private batchRecords(save: SaveV3): readonly SourceRecord[] {
    return recordsForBatch(currentBatchId(save));
  }

  readonly hasSave = computed(() => this._save() !== null);
  readonly phase = computed(() => this._save()?.phase ?? null);
  /** 目前所在的日識別（穩定 ID，不是 1／2 這種序號）。 */
  readonly dayId = computed(() => this._save()?.dayId ?? null);
  /** 目前工作批次；歸檔進度與草稿都以它為範圍。 */
  readonly batchId = computed<BatchId | null>(() => {
    const s = this._save();
    return s ? currentBatchId(s) : null;
  });
  /** 第一日（day1／overnight）＝1；第二日（day2／end）＝2。呈現層沿用。 */
  readonly day = computed<1 | 2>(() => {
    const p = this._save()?.phase;
    return p === 'day2' || p === 'end' ? 2 : 1;
  });
  readonly archivedCount = computed(() => {
    const s = this._save();
    return s ? archivedCount(s) : 0;
  });
  readonly allArchived = computed(() => {
    const s = this._save();
    return s ? allArchived(s, this.batchRecords(s)) : false;
  });
  readonly night = computed(() => this._save()?.night ?? null);
  readonly reply = computed(() => this._save()?.reply ?? null);
  readonly evidence = computed(() => this._save()?.evidence ?? { reportOpened: false, receiptOpened: false });
  /** 四格矩陣結果：安排對象是否「已列入安排」。 */
  readonly arranged = computed(() => {
    const s = this._save();
    return s ? isArrangedInSave(s) : false;
  });
  /** 狀態列文字：儲存問題 > 操作提示 > 已保存。 */
  readonly statusText = computed(() => this.storageIssue() || this.status() || STORAGE.saved);

  constructor() {
    const loaded = this.repo.load();
    this._save.set(loaded.save);
    this.storageIssue.set(loaded.issue);
    // 舊檔轉換後立刻寫回，避免每次載入都重新遷移
    if (loaded.save && loaded.migrated) this.storageIssue.set(this.repo.persist(loaded.save));
  }

  /** 已有紀錄或讀取失敗時，開始新遊戲前應先用對話框確認。 */
  needsOverwriteConfirm(): boolean {
    return this.hasSave() || this.storageIssue() !== '';
  }

  newGame(): void {
    this.status.set('');
    this.commit(createSave(createSeed()));
  }

  record(key: RecordKey): SourceRecord {
    const r = RECORDS.find((x) => x.key === key);
    if (!r) throw new Error(`Unknown record ${key}`);
    return r;
  }

  archived(key: RecordKey): ArchivedRecord | undefined {
    const s = this._save();
    return s ? batchOf(s).archived[key] : undefined;
  }

  /** 讀草稿；不存在時回傳空草稿（不寫入）。 */
  draft(key: RecordKey): Draft {
    const s = this._save();
    return (s ? batchOf(s).drafts[key] : undefined) ?? { value: '' };
  }

  updateDraft(key: RecordKey, patch: Partial<Draft>): void {
    const s = this._save();
    if (!s || s.phase !== 'day1') return;
    this.commit(setDraft(s, key, { ...this.draft(key), ...patch }));
  }

  validate(key: RecordKey): ValidationResult {
    return validateRecord(this.record(key), this.draft(key));
  }

  /** 確認歸檔：提交鎖定，已提交者忽略；連同來源快照保存。 */
  archive(key: RecordKey, ok: ValidationOk): void {
    const s = this._save();
    if (!s || this.archived(key)) return;
    this.status.set(DAY1.statusArchived);
    this.commit(commitArchive(s, this.record(key), ok));
  }

  completeDay1(): boolean {
    const s = this._save();
    if (!s) return false;
    const next = completeDay1(s, this.batchRecords(s));
    if (next === s) return false;
    this.status.set('');
    this.commit(next);
    return true;
  }

  /** 進入第二天；night 只判定一次。 */
  advanceToDay2(): void {
    const s = this._save();
    if (s) this.commit(advanceToDay2(s));
  }

  openReport(): void {
    const s = this._save();
    if (s) this.commit(markReportOpened(s));
  }

  openReceipt(): void {
    const s = this._save();
    if (s) this.commit(markReceiptOpened(s));
  }

  canReply(reply: Reply): boolean {
    const s = this._save();
    return s ? canReply(s, reply) : false;
  }

  submitReply(reply: Reply): boolean {
    const s = this._save();
    if (!s) return false;
    const next = submitReply(s, reply);
    if (next === s) return false;
    this.status.set('');
    this.commit(next);
    return true;
  }

  /* ---------- 訊息已讀（KB-R4-04 使用） ---------- */

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

  private commit(next: SaveV3): void {
    this._save.set(next);
    this.storageIssue.set(this.repo.persist(next));
  }
}
