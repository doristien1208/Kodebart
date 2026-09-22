import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { recordLabel } from '../../content/records';
import { DAY1 } from '../../content/text';
import { MissingPolicy, RecordKey, ValidationOk } from '../../core/types';
import { GameStateService } from '../../state/game-state.service';
import { Day1CheckFormComponent } from './day1-check-form.component';
import { Day1QueueComponent, Day1QueueItem } from './day1-queue.component';

/**
 * Day 1 人員資料歸檔（原型 day1()）的容器（KB-R4-02）。
 * 這裡只做頁面協調：取得遊戲狀態、保存畫面本地狀態（目前選取、預覽、欄位錯誤）、
 * 把資料以 input 傳給子元件，並把子元件回報的事件轉成 GameStateService 呼叫。
 * 呈現細節分別屬於 Day1QueueComponent（工作佇列）、Day1CheckFormComponent（來源／核對表單）
 * 與 Day1PreviewComponent（預覽與確認）；子元件不注入狀態服務、不讀寫 localStorage。
 * 規則全部在 core/validate.ts 與 state service；草稿與已歸檔紀錄一律經由 GameStateService。
 */
@Component({
  selector: 'app-day1-archive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Day1QueueComponent, Day1CheckFormComponent],
  template: `
    <div class="panel">
      <div class="flex flex-col md:flex-row md:justify-between items-start gap-4 mb-6">
        <div>
          <span class="eyebrow">{{ t.eyebrow }}</span>
          <h3>{{ t.heading }}</h3>
        </div>
        <span class="tag">{{ t.progress(count(), total()) }}</span>
      </div>

      <p class="text-muted">{{ t.instruction }}</p>

      <app-day1-queue
        [items]="queueItems()"
        [selectedKey]="selected()"
        (select)="select($event)"
      />

      <app-day1-check-form
        #checkForm
        [record]="record()"
        [draft]="draft()"
        [archived]="done()"
        [fieldError]="fieldError()"
        [preview]="preview()"
        (codeInput)="onInput($event)"
        (useSourceCode)="useSourceCode()"
        (policySelect)="setPolicy($event)"
        (validate)="onValidate()"
        (confirm)="onConfirm()"
      />
    </div>

    <div class="flex gap-2.5 items-center flex-wrap mt-5">
      <p class="text-sm text-muted mb-0">
        {{ game.allArchived() ? t.footerDone : t.footerPending(total()) }}
      </p>
      <button
        type="button"
        class="btn-primary ml-auto"
        [disabled]="!game.allArchived()"
        (click)="onFinishDay()"
      >{{ t.finishDay }}</button>
    </div>
  `,
})
export class Day1ArchiveComponent {
  protected readonly game = inject(GameStateService);
  private readonly router = inject(Router);

  protected readonly t = DAY1;

  private readonly checkForm = viewChild.required<Day1CheckFormComponent>('checkForm');

  /**
   * 目前選取項目只存在元件內，不寫入存檔：切換工作／訊息／公告或重新載入後，
   * 一律回到資料集合的第一筆（沿用既有行為）。草稿與已歸檔狀態仍由 GameStateService 保存。
   */
  protected readonly selected = signal<RecordKey>(this.game.records[0]?.key ?? '');
  protected readonly preview = signal<ValidationOk | null>(null);
  protected readonly fieldError = signal('');

  protected readonly record = computed(() => this.game.record(this.selected()));
  protected readonly draft = computed(() => this.game.draft(this.selected()));
  protected readonly done = computed(() => this.game.archived(this.selected()));
  protected readonly count = this.game.archivedCount;
  /** 總筆數來自資料集合，不寫死。 */
  protected readonly total = this.game.totalRecords;

  /** 佇列列表：可辨識識別（有姓名顯示姓名，否則顯示人員編號）與是否已提交。 */
  protected readonly queueItems = computed<readonly Day1QueueItem[]>(() =>
    this.game.records.map((r) => ({
      key: r.key,
      label: recordLabel(r),
      done: this.game.archived(r.key) !== undefined,
    })),
  );

  protected select(key: RecordKey): void {
    this.selected.set(key);
    this.resetFeedback();
  }

  protected onInput(value: string): void {
    this.game.updateDraft(this.selected(), { value });
    this.resetFeedback();
  }

  protected useSourceCode(): void {
    this.game.updateDraft(this.selected(), { value: this.record().code });
    this.resetFeedback();
    this.focusInput();
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

  protected onConfirm(): void {
    const p = this.preview();
    if (!p || this.done()) return;
    this.game.archive(this.selected(), p);
    this.preview.set(null);
  }

  protected onFinishDay(): void {
    if (this.game.completeDay1()) {
      void this.router.navigateByUrl('/overnight');
    }
  }

  private resetFeedback(): void {
    this.preview.set(null);
    this.fieldError.set('');
  }

  private focusInput(): void {
    this.checkForm().focusCode();
  }
}
