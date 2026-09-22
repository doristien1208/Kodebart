import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { recordLabel } from '../../content/records';
import { DAY1 } from '../../content/text';
import { MissingPolicy, RecordKey, ValidationOk } from '../../core/types';
import { toPreview } from '../../core/validate';
import { GameStateService } from '../../state/game-state.service';
import { SourceCardComponent } from '../shared/source-card.component';

/**
 * Day 1 人員資料歸檔（原型 day1()）。
 * 工作佇列由 game.records 產生，可容納 10–12 筆以上：桌機分欄、窄螢幕單欄，
 * 超過高度時佇列自己垂直捲動，整頁不會橫向溢出。狀態（待處理／已完成／目前選取）
 * 一律有文字或符號，不只靠顏色；目前選取以 aria-current 表示。
 * 玩家依來源資料核對人員編號；姓名只作顯示，不提供輸入框。
 * 規則全部在 core/validate.ts 與 state service；這裡只保存畫面本地狀態
 * （目前選取、預覽、欄位錯誤），草稿與已歸檔紀錄一律經由 GameStateService。
 */
@Component({
  selector: 'app-day1-archive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourceCardComponent],
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

      <section class="mb-[1.4rem]">
        <span class="eyebrow">{{ t.queueEyebrow }}</span>
        <ul
          role="list"
          [attr.aria-label]="t.queueLabel"
          class="grid gap-2 p-2 mt-1.5 border border-border bg-background max-h-[17rem] overflow-y-auto md:grid-cols-2 xl:grid-cols-3"
        >
          @for (r of game.records; track r.key) {
            <li class="min-w-0">
              <button
                type="button"
                class="w-full flex items-center gap-2 py-2 px-2.5"
                [class.border-primary]="r.key === selected()"
                [class.bg-elevated]="r.key === selected()"
                [attr.aria-current]="r.key === selected() ? 'true' : null"
                (click)="select(r.key)"
              >
                <span class="font-mono text-primary w-[.9em] shrink-0" aria-hidden="true">{{
                  r.key === selected() ? t.queueSelectedMark : ''
                }}</span>
                <span class="flex-1 min-w-0 truncate">{{ label(r) }}</span>
                @if (game.archived(r.key)) {
                  <span class="tag shrink-0 text-primary border-primary"
                    ><span aria-hidden="true">{{ t.queueDoneMark }}</span> {{ t.queueDone }}</span
                  >
                } @else {
                  <span class="tag shrink-0">{{ t.queuePending }}</span>
                }
              </button>
            </li>
          }
        </ul>
      </section>

      <div class="grid gap-4 md:grid-cols-2">
        <app-source-card [record]="record()" />

        @if (done(); as a) {
          <div>
            <h3>{{ t.doneHeading }}</h3>
            <p class="text-muted">{{ t.doneBody }}</p>
            <p>{{ t.nameLabel }}：{{ nameText() }}</p>
            <p>{{ t.doneCode }}<code>{{ a.archiveCode }}</code></p>
            <p>{{ t.doneMethod }}{{ a.origin === 'review' ? t.methodReview : t.methodArchive }}</p>
          </div>
        } @else {
          <form novalidate (submit)="$event.preventDefault()">
            <p class="mt-0 mb-4">
              <span class="block font-semibold">{{ t.nameLabel }}</span>
              <span>{{ nameText() }}</span>
            </p>

            <label for="archive-input" class="block mb-1.5 font-semibold">{{ t.fieldLabel }}</label>
            <input
              #archiveInput
              id="archive-input"
              class="input"
              type="text"
              autocomplete="off"
              [value]="draft().value"
              [attr.aria-invalid]="fieldError() ? 'true' : 'false'"
              aria-describedby="field-error"
              (input)="onInput($event)"
            />
            <p id="field-error" class="field-error" role="status">{{ fieldError() }}</p>

            <div class="flex flex-wrap gap-2 mt-2.5">
              <button
                type="button"
                class="text-[.8rem] py-1.5 px-2.5 min-h-0"
                (click)="useSourceCode()"
              >{{ t.useCode }}</button>
            </div>

            @if (needsPolicy()) {
              <fieldset>
                <legend>{{ t.missingLegend }}</legend>
                <label class="radio">
                  <input
                    type="radio"
                    name="policy"
                    value="default_false"
                    [checked]="draft().policy === 'default_false'"
                    (change)="setPolicy('default_false')"
                  />
                  <span>{{ t.policyDefault }}</span>
                </label>
                <label class="radio">
                  <input
                    type="radio"
                    name="policy"
                    value="request_review"
                    [checked]="draft().policy === 'request_review'"
                    (change)="setPolicy('request_review')"
                  />
                  <span>{{ t.policyReview }}</span>
                </label>
              </fieldset>
            }

            <button type="button" class="btn-primary" (click)="onValidate()">{{ t.validate }}</button>

            @if (preview(); as p) {
              <div class="preview">
                <p class="text-sm">{{ t.previewOk }}</p>
                <pre>{{ previewJson() }}</pre>
                <div class="flex gap-2.5 items-center flex-wrap mt-5">
                  <button type="button" class="btn-primary" (click)="onConfirm()">{{ t.confirm }}</button>
                </div>
              </div>
            }
          </form>
        }
      </div>
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

  /** 輸入框只在未完成視圖中存在，因此不用 required。 */
  private readonly archiveInput = viewChild<ElementRef<HTMLInputElement>>('archiveInput');

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

  /** 佇列上的可辨識識別：有姓名顯示姓名，否則顯示人員編號。 */
  protected readonly label = recordLabel;

  /** 姓名只顯示，不可編輯；來源未登記時顯示「未登記」。 */
  protected readonly nameText = computed(() => this.record().name ?? DAY1.nameUnregistered);

  /** 適用拒絕紀錄但來源未附時，才需要選擇處理方式。 */
  protected readonly needsPolicy = computed(() => {
    const r = this.record();
    return r.refusalApplies && r.refusal === null;
  });

  protected readonly previewJson = computed(() => {
    const p = this.preview();
    return p ? JSON.stringify(toPreview(p), null, 2) : '';
  });

  protected select(key: RecordKey): void {
    this.selected.set(key);
    this.resetFeedback();
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
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
    this.archiveInput()?.nativeElement.focus();
  }
}
