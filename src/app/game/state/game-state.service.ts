import { Injectable, computed, inject, signal } from '@angular/core';
import { RECORDS } from '../content/records';
import { DAY1, STORAGE } from '../content/text';
import {
  ArchivedRecord,
  Draft,
  RecordKey,
  Reply,
  SaveV2,
  SourceRecord,
  ValidationOk,
  ValidationResult,
  advanceToDay2,
  allArchived,
  archivedCount,
  canReply,
  commitArchive,
  completeDay1,
  createSave,
  isArrangedInSave,
  markReceiptOpened,
  markReportOpened,
  setDraft,
  submitReply,
  validateRecord,
} from '../core';
import { createSeed } from '../platform/seed';
import { SaveRepository } from './save-repository';

/**
 * game/state：把純核心規則包成 Angular signals。
 * 所有寫入都經過 commit() → 存檔；呈現層只讀 signals，不自行擲骰。
 */
@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly repo = inject(SaveRepository);
  private readonly _save = signal<SaveV2 | null>(null);

  /** 目前存檔；null＝尚無紀錄（或讀取失敗）。 */
  readonly save = this._save.asReadonly();
  /** 儲存／讀取問題提示；空字串＝正常。 */
  readonly storageIssue = signal('');
  /** 一般操作提示（例如「資料已保存至本日批次。」）。 */
  readonly status = signal('');

  readonly records: readonly SourceRecord[] = RECORDS;
  /** 本日資料集合的總筆數；畫面文案一律用它，不得寫死筆數。 */
  readonly totalRecords = computed(() => this.records.length);

  readonly hasSave = computed(() => this._save() !== null);
  readonly phase = computed(() => this._save()?.phase ?? null);
  /** 第一日（day1／overnight）＝1；第二日（day2／end）＝2。 */
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
    return s ? allArchived(s, RECORDS) : false;
  });
  readonly night = computed(() => this._save()?.night ?? null);
  readonly reply = computed(() => this._save()?.reply ?? null);
  readonly evidence = computed(() => this._save()?.evidence ?? { reportOpened: false, receiptOpened: false });
  /** 四格矩陣結果：0102 是否「已列入安排」。 */
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
  }

  /** 已有紀錄或讀取失敗時，開始新遊戲前應先用對話框確認。 */
  needsOverwriteConfirm(): boolean {
    return this.hasSave() || this.storageIssue() !== '';
  }

  /** 直接建立新存檔（確認對話框由呼叫端負責）。 */
  newGame(): void {
    this.status.set('');
    this.commit(createSave(createSeed()));
  }

  /** RecordKey 放寬為 string 後，未知鍵不再由型別擋下，因此這裡必須繼續 throw。 */
  record(key: RecordKey): SourceRecord {
    const r = RECORDS.find((x) => x.key === key);
    if (!r) throw new Error(`Unknown record ${key}`);
    return r;
  }

  archived(key: RecordKey): ArchivedRecord | undefined {
    return this._save()?.archived[key];
  }

  /** 讀草稿；不存在時回傳空草稿（不寫入）。 */
  draft(key: RecordKey): Draft {
    return this._save()?.drafts[key] ?? { value: '' };
  }

  updateDraft(key: RecordKey, patch: Partial<Draft>): void {
    const s = this._save();
    if (!s || s.phase !== 'day1') return;
    this.commit(setDraft(s, key, { ...this.draft(key), ...patch }));
  }

  validate(key: RecordKey): ValidationResult {
    return validateRecord(this.record(key), this.draft(key));
  }

  /** 確認歸檔：提交鎖定，已提交者忽略。 */
  archive(key: RecordKey, ok: ValidationOk): void {
    const s = this._save();
    if (!s || s.archived[key]) return;
    this.status.set(DAY1.statusArchived);
    this.commit(commitArchive(s, key, ok));
  }

  completeDay1(): boolean {
    const s = this._save();
    if (!s) return false;
    const next = completeDay1(s, RECORDS);
    if (next === s) return false;
    this.status.set('');
    this.commit(next);
    return true;
  }

  /** 進入第二天；night 只判定一次。 */
  advanceToDay2(): void {
    const s = this._save();
    if (!s) return;
    this.commit(advanceToDay2(s));
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

  private commit(next: SaveV2): void {
    this._save.set(next);
    this.storageIssue.set(this.repo.persist(next));
  }
}
