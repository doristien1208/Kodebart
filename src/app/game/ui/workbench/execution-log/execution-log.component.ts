import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { EXECUTION_LOG_UI, OPERATION_UI, WINDOW_SHELL_UI } from '../../../content/text';
import { WindowShellComponent, WindowShellDefaults } from '../../shared/window-shell/window-shell.component';
import { LogEntry } from '../presenters/execution-log';

/** 紀錄窗預設只露最新幾筆（R9 §3：3–5 筆）；較早的紀錄由「顯示較早紀錄」展開。 */
export const LOG_COMPACT_COUNT = 4;

/** 系統作業紀錄視窗的穩定 ID（視窗管理服務以它保存位置／尺寸／狀態）。 */
export const EXECUTION_LOG_WINDOW_ID = 'system.execution-log';

/**
 * 工作頁的「系統作業紀錄」（R8 §3／R9 §3／R10 §2–3）：浮動視窗（共用 WindowShell），唯讀。
 *
 * 紀錄由 workbench 以 `buildExecutionLog()`＋`withOperation()`（純函式 presenter）產生：
 * 已保存的事件，加上目前這件提交的逐階段輸出。這裡只負責排版：指令列（提示符號＋指令＋參數）、
 * 每個階段一行 JSON、最後一行保存結果；保存失敗時顯示說明與「重試」（交給 workbench 呼叫 retry）。
 * 預設只顯示最新 LOG_COMPACT_COUNT 筆；可切換顯示當日全部歷史（切換狀態只在畫面，不寫入存檔）。
 * 沒有輸入框、不接受指令；等寬字、細線、低彩度語法標示，不發光、不用紅色警示。
 * 新紀錄或新階段出現時把視窗內文捲到底（終端機慣例：最新一筆在最下面）。
 */
@Component({
  selector: 'app-execution-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  imports: [WindowShellComponent],
  templateUrl: './execution-log.component.html',
})
export class ExecutionLogComponent {
  readonly entries = input.required<readonly LogEntry[]>();
  /** 視窗第一次註冊時的位置與尺寸（由 workbench 依工作區大小給）。 */
  readonly defaults = input<WindowShellDefaults>({ x: 16, y: 16, width: 380, height: 300 });
  /** 保存失敗後按「重試」。 */
  readonly retry = output<void>();

  protected readonly windowId = EXECUTION_LOG_WINDOW_ID;
  protected readonly ui = EXECUTION_LOG_UI;
  protected readonly opUi = OPERATION_UI;
  protected readonly shellUi = WINDOW_SHELL_UI;
  private readonly shell = viewChild(WindowShellComponent);
  private readonly injector = inject(Injector);

  /** 是否顯示全部歷史；換日（紀錄清空）時回到精簡模式。 */
  protected readonly showHistory = linkedSignal<boolean, boolean>({
    source: computed(() => this.entries().length === 0),
    computation: () => false,
  });
  /** 精簡模式下被隱藏的較早紀錄筆數。 */
  protected readonly hiddenCount = computed(() => Math.max(0, this.entries().length - LOG_COMPACT_COUNT));
  protected readonly visible = computed(() =>
    this.showHistory() ? this.entries() : this.entries().slice(-LOG_COMPACT_COUNT),
  );

  constructor() {
    effect(() => {
      this.visible();
      afterNextRender(() => this.shell()?.scrollToEnd(), { injector: this.injector });
    });
  }

  protected toggleHistory(): void {
    this.showHistory.update((v) => !v);
  }
}
