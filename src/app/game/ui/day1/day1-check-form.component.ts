import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DAY1 } from '../../content/text';
import {
  ArchivedRecord,
  Draft,
  MissingPolicy,
  SourceRecord,
  ValidationOk,
} from '../../core/types';
import { SourceCardComponent } from '../shared/source-card.component';
import { Day1PreviewComponent } from './day1-preview.component';

/**
 * Day 1 來源／核對表單（KB-R4-02）：來源卡、姓名顯示、人員編號輸入與缺值處理選項。
 * 這裡只呈現容器傳入的資料並回報玩家意圖，不注入 GameStateService、不讀寫 localStorage、
 * 不呼叫驗證規則；已提交的紀錄改顯示鎖定後的結果（提交鎖定由容器與狀態層負責）。
 * 姓名只作顯示，不提供輸入框。
 */
@Component({
  selector: 'app-day1-check-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [SourceCardComponent, Day1PreviewComponent],
  template: `
    <div class="grid gap-4 md:grid-cols-2">
      <app-source-card [record]="record()" />

      @if (archived(); as a) {
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
              (click)="useSourceCode.emit()"
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
                  (change)="policySelect.emit('default_false')"
                />
                <span>{{ t.policyDefault }}</span>
              </label>
              <label class="radio">
                <input
                  type="radio"
                  name="policy"
                  value="request_review"
                  [checked]="draft().policy === 'request_review'"
                  (change)="policySelect.emit('request_review')"
                />
                <span>{{ t.policyReview }}</span>
              </label>
            </fieldset>
          }

          <button type="button" class="btn-primary" (click)="validate.emit()">{{ t.validate }}</button>

          @if (preview(); as p) {
            <app-day1-preview [preview]="p" (confirm)="confirm.emit()" />
          }
        </form>
      }
    </div>
  `,
})
export class Day1CheckFormComponent {
  readonly record = input.required<SourceRecord>();
  readonly draft = input.required<Draft>();
  /** 已提交至本日批次的結果；undefined＝尚未提交，顯示表單。 */
  readonly archived = input.required<ArchivedRecord | undefined>();
  /** 欄位錯誤訊息；空字串＝無錯誤（訊息由容器向規則層取得）。 */
  readonly fieldError = input.required<string>();
  /** 驗證通過待確認的結果；null＝尚未驗證或已清除。 */
  readonly preview = input.required<ValidationOk | null>();

  readonly codeInput = output<string>();
  readonly useSourceCode = output<void>();
  readonly policySelect = output<MissingPolicy>();
  readonly validate = output<void>();
  readonly confirm = output<void>();

  protected readonly t = DAY1;

  /** 輸入框只在未提交的表單中存在，因此不用 required。 */
  private readonly archiveInput = viewChild<ElementRef<HTMLInputElement>>('archiveInput');

  /** 姓名只顯示，不可編輯；來源未登記時顯示「未登記」。 */
  protected readonly nameText = computed(() => this.record().name ?? DAY1.nameUnregistered);

  /** 適用拒絕紀錄但來源未附時，才需要選擇處理方式。 */
  protected readonly needsPolicy = computed(() => {
    const r = this.record();
    return r.refusalApplies && r.refusal === null;
  });

  /** 容器在帶入來源編號或驗證失敗後把焦點還給輸入框。 */
  focusCode(): void {
    this.archiveInput()?.nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.codeInput.emit((event.target as HTMLInputElement).value);
  }
}
