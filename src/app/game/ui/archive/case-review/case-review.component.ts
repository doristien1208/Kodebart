import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CaseDecision, CaseReview, CaseSourceDocument } from '../../../content/schema';
import { ARCHIVE_UI, CASE_REVIEW_UI, WINDOWS_UI, caseMarkedCount } from '../../../content/text';
import { Draft, MissingPolicy, SourceRecord } from '../../../core/types';
import { OperationView } from '../../../state/work-operations.service';
import { OperationStatusComponent } from '../../shared/operation-status/operation-status.component';
import { DESKTOP_GAP, DESKTOP_MARGIN, DesktopRect, desktopSideArea } from '../../desktop/presenters/desktop-layout';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { WindowShellComponent, WindowShellDefaults } from '../../shared/window-shell/window-shell.component';

/**
 * 案件畫面所需的資料（由容器從遊戲狀態與內容推導後傳入）。
 * `supporting` 只會是已保存的那一個補件收件狀態變體；另一個變體從不傳進來，因此也不會出現在 DOM。
 */
export interface CaseReviewView {
  caseId: string;
  review: CaseReview;
  /** 兩份來源文件（依 sourceDocumentIds 順序）。 */
  sources: readonly CaseSourceDocument[];
  /** 抽中並保存的補件收件狀態文件；尚無時為 null。 */
  supporting: CaseSourceDocument | null;
  /** 玩家標記為有差異的欄位名稱。 */
  marks: readonly string[];
}

/** 提交後鎖定的處理摘要（全部是玩家看得懂的文字）。 */
export interface CaseDoneView {
  code: string;
  destination: string;
  basis: string;
  note: string;
}

/** 一個文件視窗：來源文件可標記差異，附加文件唯讀。 */
interface CaseWindow {
  /** 穩定的視窗 ID（＝文件內容 ID；不顯示）。 */
  id: string;
  doc: CaseSourceDocument;
  markable: boolean;
  defaults: WindowShellDefaults;
}

/**
 * 文件視窗的預設尺寸（px）：依欄位列數估算剛好放得下的高度（不需內部捲動）。
 * 數值對應 WindowShell 與下方表格的樣式：框線＋標題列＋內文上下內距＋表頭、每列高度（可標記的列含「標記差異」按鈕）。
 */
const DOC = {
  chrome: 98,
  markableRow: 45,
  plainRow: 33,
  /** 附加文件表格上方的說明行。 */
  supportingNote: 26,
  slack: 4,
  /** 兩份主文件上下疊時每份至少這麼高（不足時在視窗內捲動）；再矮就改為一次顯示一份。 */
  minHeight: 200,
  /** 右側空白區內左右並排時每份至少／至多這麼寬；右側不夠並排時上下疊，寬度至多 maxWidth。 */
  minWidth: 320,
  maxWidth: 520,
  /** 桌面較窄（工作平台右側沒有空白區）時文件的寬度。 */
  narrowWidth: 300,
  /** 尚未量到桌面時（例如單元測試）假設的桌面尺寸（1440×900 瀏覽器扣掉工作列）。 */
  fallbackBounds: { width: 1440, height: 848 },
} as const;

/**
 * 多來源比對案件（R9／R10）的呈現：兩份來源文件＋抽中的附加文件（各自一個浮動 WindowShell，穩定 ID）、
 * 欄位差異標記、可編輯的人員編號、三種處理方式與確認；提交後改為鎖定的處理摘要。
 *
 * - 人員編號是玩家的草稿（只驗型別）：R11 起沒有任何帶入按鈕或自動預填，新案件欄位空白、由玩家自己輸入；
 *   選處理方式只回報 decisionId（依據／去向／註記），不改動編號。
 * - 文件入口按鈕（`data-window-open`）開啟或聚焦文件視窗；關閉的視窗從這裡重開。
 *   預設版面見 layout()：寬桌面時兩份主文件放在工作平台右側的空白區（並排或上下疊），
 *   工作平台的佇列、表單與提交不被遮住；小螢幕由視窗管理服務單窗最大化顯示。
 * - 純呈現元件：不注入 GameStateService、不讀寫 localStorage、不知道是哪一天或哪一筆。
 *   三種處理方式樣式完全相同，沒有「正確」提示、沒有分數。
 */
@Component({
  selector: 'app-case-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [WindowShellComponent, OperationStatusComponent],
  templateUrl: './case-review.component.html',
})
export class CaseReviewComponent {
  readonly view = input.required<CaseReviewView>();
  readonly record = input.required<SourceRecord>();
  /** 編號草稿（value）、已選處理方式（decisionId）與缺值處理（policy）。 */
  readonly draft = input.required<Draft>();
  /** 已提交的處理摘要；null＝尚未提交。 */
  readonly done = input.required<CaseDoneView | null>();
  /** 確認時的提示（未選處理方式、未填編號、缺值處理未選）；空字串＝無。 */
  readonly error = input.required<string>();
  /** 有提交處理中：停用確認（連點只送出一次）。 */
  readonly busy = input(false);
  /** 這一筆的提交階段；null＝不顯示。 */
  readonly operation = input<OperationView | null>(null);

  readonly toggleMark = output<string>();
  /** 編號草稿改變（玩家輸入）。 */
  readonly codeInput = output<string>();
  /** 選擇處理方式（只帶 decisionId）。 */
  readonly decide = output<string>();
  readonly policySelect = output<MissingPolicy>();
  /** 玩家按下確認（容器讀草稿並檢查）。 */
  readonly confirm = output<void>();
  /** 寫入失敗後重試。 */
  readonly retry = output<void>();
  /** 已處理後回到佇列。 */
  readonly back = output<void>();

  protected readonly t = CASE_REVIEW_UI;
  protected readonly a = ARCHIVE_UI;
  protected readonly windowsUi = WINDOWS_UI;
  private readonly windowManager = inject(WindowManagerService);

  /**
   * 第一次繪製後才掛上文件視窗：工作區在自己的第一次繪製後才量到尺寸，
   * 等它量好再註冊，預設位置才會依實際工作區寬度排（重新整理時也一樣）。
   */
  protected readonly windowsReady = signal(false);

  private readonly doneHeading = viewChild<ElementRef<HTMLElement>>('doneHeading');
  private readonly codeInputEl = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly windows = computed<readonly CaseWindow[]>(() => {
    const v = this.view();
    const docs: { doc: CaseSourceDocument; markable: boolean }[] = v.sources.map((doc) => ({ doc, markable: true }));
    if (v.supporting) docs.push({ doc: v.supporting, markable: false });
    const layout = this.layout(docs.filter((d) => d.markable).map((d) => d.doc));
    return docs.map((d, i) => ({ id: d.doc.id, ...d, defaults: d.markable ? layout.source(i) : layout.supporting(d.doc) }));
  });

  protected readonly markedText = computed(() => caseMarkedCount(this.view().marks.length));

  /** 已選的處理方式（存在草稿，重新整理與換頁都保留）；不是本案件的決定時視為未選。 */
  protected readonly choice = computed<string | null>(() => {
    const id = this.draft().decisionId;
    return this.view().review.decisions.some((d) => d.id === id) ? (id ?? null) : null;
  });

  protected readonly chosen = computed<CaseDecision | null>(
    () => this.view().review.decisions.find((d) => d.id === this.choice()) ?? null,
  );

  /** 選中處理方式的預覽：玩家目前的編號草稿＋去向、依據文件標題與註記。 */
  protected readonly chosenSummary = computed<CaseDoneView | null>(() => {
    const d = this.chosen();
    if (!d) return null;
    return {
      code: this.draft().value,
      destination: this.t.destination[d.destination],
      basis: this.view().sources.find((s) => s.id === d.basisDocumentId)?.text.heading ?? '',
      note: d.note,
    };
  });

  /** 適用拒絕紀錄但來源未附時，確認前需要選擇缺值處理（沿用一般歸檔的選項）。 */
  protected readonly needsPolicy = computed(() => {
    const r = this.record();
    return r.refusalApplies && r.refusal === null;
  });

  constructor() {
    afterNextRender(() => this.windowsReady.set(true));
  }

  protected isMarked(label: string): boolean {
    return this.view().marks.includes(label);
  }

  /** 文件入口：重開關閉／最小化的視窗，已開啟的只聚焦。 */
  protected openWindow(id: string): void {
    this.windowManager.open(id);
  }

  protected onCodeInput(event: Event): void {
    this.codeInput.emit((event.target as HTMLInputElement).value);
  }

  /** 容器在提交成功後把焦點移到處理摘要標題。 */
  focusDone(): void {
    this.doneHeading()?.nativeElement.focus();
  }

  /** 容器在編號未填時把焦點放回輸入框。 */
  focusCode(): void {
    this.codeInputEl()?.nativeElement.focus();
  }

  /**
   * 文件視窗的預設位置與顯示狀態（依序：兩份主文件、附加文件）。只在第一次註冊時使用；之後由視窗管理服務保存，
   * 桌面大小改變時重新計算的值只影響「重設視窗位置」。
   *
   * - 工作平台右側有空白區（desktopSideArea，寬桌面）：夠寬時兩份主文件左右並排，否則上下疊；
   *   高度剛好放下全部欄位（太矮時平分高度、內部捲動，再矮就只開第一份、第二份最小化）。都不遮住工作平台。
   * - 沒有空白區（較窄的桌面）：放不下兩份又不遮內容，改為一次一份：第一份開在桌面右側，
   *   第二份最小化（從文件入口或視窗列開啟時疊在第一份下方；桌面太矮時與第一份同位置）。
   * - 附加文件（補件收件狀態）一律先最小化在視窗列，從文件入口開啟時靠右側底部。
   * 會讓位的系統作業紀錄由視窗管理服務處理（主文件第一次開啟時若蓋到未移動過的紀錄窗，紀錄窗自動最小化）。
   */
  private layout(sources: readonly CaseSourceDocument[]): {
    source: (index: number) => WindowShellDefaults;
    supporting: (doc: CaseSourceDocument) => WindowShellDefaults;
  } {
    const bounds = this.windowManager.bounds() ?? DOC.fallbackBounds;
    const side = desktopSideArea(bounds);
    const area: DesktopRect = side ?? {
      x: Math.max(DESKTOP_MARGIN, bounds.width - DESKTOP_MARGIN - DOC.narrowWidth),
      y: DESKTOP_MARGIN,
      width: Math.min(DOC.narrowWidth, Math.max(0, bounds.width - DESKTOP_MARGIN * 2)),
      height: Math.max(0, bounds.height - DESKTOP_MARGIN * 2),
    };
    const [idealA = 0, idealB = 0] = sources.map((d) => docHeight(d, true));
    const supporting = (doc: CaseSourceDocument): WindowShellDefaults => {
      const width = Math.min(area.width, DOC.maxWidth);
      const height = Math.min(docHeight(doc, false), area.height);
      return { x: area.x + area.width - width, y: area.y + area.height - height, width, height, mode: 'minimized' };
    };

    // 左右並排：右側空白區放得下兩份最小寬度
    if (side && side.width >= DOC.minWidth * 2 + DESKTOP_GAP) {
      const width = Math.min(DOC.maxWidth, Math.floor((side.width - DESKTOP_GAP) / 2));
      const x = side.x + side.width - (width * 2 + DESKTOP_GAP);
      return {
        source: (index) => ({
          x: index === 0 ? x : x + width + DESKTOP_GAP,
          y: side.y,
          width,
          height: Math.min(index === 0 ? idealA : idealB, side.height),
        }),
        supporting,
      };
    }

    // 上下疊：放得下就用剛好的高度，放不下就平分（內部捲動）
    const width = Math.min(area.width, DOC.maxWidth);
    const x = area.x + area.width - width;
    let a = idealA;
    let b = idealB;
    if (a + DESKTOP_GAP + b > area.height) {
      a = Math.min(idealA, Math.floor((area.height - DESKTOP_GAP) / 2));
      b = Math.min(idealB, area.height - DESKTOP_GAP - a);
    }
    const stacked = a >= DOC.minHeight && b >= DOC.minHeight;
    if (!stacked) {
      // 疊不下：一次看一份，第二份開啟時與第一份同位置
      a = Math.min(idealA, area.height);
      b = Math.min(idealB, area.height);
    }
    /** 兩份同時開啟：只有右側空白區（不遮工作平台）且疊得下時。 */
    const both = !!side && stacked;
    const secondY = stacked ? area.y + a + DESKTOP_GAP : area.y;
    return {
      source: (index) =>
        index === 0
          ? { x, y: area.y, width, height: a }
          : { x, y: secondY, width, height: b, mode: both ? 'normal' : 'minimized' },
      supporting,
    };
  }
}

/** 放得下文件全部欄位的視窗高度（估算，見 DOC）。 */
function docHeight(doc: CaseSourceDocument, markable: boolean): number {
  const rows = doc.text.fields.length * (markable ? DOC.markableRow : DOC.plainRow);
  return DOC.chrome + (markable ? 0 : DOC.supportingNote) + rows + DOC.slack;
}
