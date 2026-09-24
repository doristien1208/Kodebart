import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ALL_CASE_REVIEWS, CaseReviewEntry, caseSourceDocument } from '../../../content/bundle';
import { recordLabel } from '../../../content/records';
import { CaseSourceDocument } from '../../../content/schema';
import { ARCHIVE_UI, CASE_REVIEW_UI, caseMarkedCount } from '../../../content/text';
import { EVENT_KINDS } from '../../../core/rules';
import { rand } from '../../../core/rand';
import { SAVE_VERSION } from '../../../core/types';
import { VALIDATION_MESSAGES } from '../../../core/validate';
import { GameStateService } from '../../../state/game-state.service';
import { SAVE_KEY } from '../../../state/save-repository';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { instantOperations, playTo, settle } from '../../testing/play';
import { WindowManagerService, WindowState } from '../../shared/services/window-manager.service';
import { desktopLayout } from '../../desktop/presenters/desktop-layout';
import { ArchiveWorkComponent } from '../archive-work/archive-work.component';

/**
 * R9：多來源比對案件的畫面。一律由內容推導期望值（案件、文件、決定），不在 TS 寫日別或編號分支。
 * 涵蓋：只渲染抽中的補件收件狀態、兩個 seed 各自的變體、重新整理不重抽、差異標記保存、
 * 三種決定樣式相同且都能完成、提交後鎖定、舊檔已歸檔不補造、其他紀錄照一般流程。
 * R10：人員編號可編輯、選處理方式不改編號、提交保存玩家實際編號；
 * R11：沒有任何帶入按鈕或開案預填，新案件編號欄位空白；既有草稿保留；
 * 文件是浮動視窗（穩定 ID），關閉後由文件入口重開。
 * R12：預設位置在桌面上工作平台右側的空白區（並排或上下疊），不遮住工作平台；窄桌面一次一份。
 */

/** 兩個視窗矩形是否重疊。 */
function overlap(a: Pick<WindowState, 'x' | 'y' | 'width' | 'height'>, b: Pick<WindowState, 'x' | 'y' | 'width' | 'height'>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const ENTRY: CaseReviewEntry = (() => {
  const e = ALL_CASE_REVIEWS[0];
  if (!e) throw new Error('內容沒有比對案件');
  return e;
})();
const CASE_ID = ENTRY.review.id;
const KEY = ENTRY.recordKey;
const VARIANT_IDS = ENTRY.review.receiptVariants.map((v) => v.id);

/** 找一個讓 openCase 抽到指定變體的 seed（與 core openCase 同一公式）。 */
function seedFor(variantId: string): number {
  const want = VARIANT_IDS.indexOf(variantId);
  for (let seed = 1; seed < 100000; seed++) {
    const i = Math.min(VARIANT_IDS.length - 1, Math.floor(rand(seed, CASE_ID) * VARIANT_IDS.length));
    if (i === want) return seed;
  }
  throw new Error(`找不到 ${variantId} 的 seed`);
}

function variantDoc(variantId: string): CaseSourceDocument {
  const v = ENTRY.review.receiptVariants.find((x) => x.id === variantId);
  if (!v) throw new Error(variantId);
  return caseSourceDocument(v.documentId);
}

function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  return TestBed.inject(GameStateService);
}

/** 某份來源文件上的人員編號（以該文件為依據的決定之 archiveCode）；測試裡由玩家手動輸入。 */
function sourceCode(index: number): string {
  const doc = caseSourceDocument(ENTRY.review.sourceDocumentIds[index] ?? '');
  const decision = ENTRY.review.decisions.find((d) => d.basisDocumentId === doc.id);
  if (!decision) throw new Error(`${doc.id} 沒有以它為依據的決定`);
  return decision.archiveCode;
}

/** 新遊戲玩到案件所在日（尚未渲染、尚未開案）；可指定 seed（改寫存檔後重新載入）。 */
function bootAtCaseDay(seed?: number): GameStateService {
  localStorage.clear();
  let game = boot();
  game.newGame();
  playTo(game, ENTRY.dayId);
  expect(game.caseState(CASE_ID)).toBeUndefined();
  if (seed !== undefined) {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...game.save(), seed }));
    game = boot();
  }
  return game;
}

function render(): ComponentFixture<ArchiveWorkComponent> {
  const fixture = TestBed.createComponent(ArchiveWorkComponent);
  fixture.autoDetectChanges(true);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  return fixture;
}

function el(f: ComponentFixture<ArchiveWorkComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function selectKey(f: ComponentFixture<ArchiveWorkComponent>, game: GameStateService, key: string): void {
  const label = recordLabel(game.record(key));
  const button = Array.from(el(f).querySelectorAll<HTMLButtonElement>('app-archive-queue button')).find(
    (b) => b.querySelector('.truncate')?.textContent?.trim() === label,
  );
  if (!button) throw new Error(`找不到佇列項目 ${key}`);
  button.click();
  f.detectChanges();
}

function windowHeadings(f: ComponentFixture<ArchiveWorkComponent>, kind: 'source' | 'supporting'): string[] {
  return Array.from(el(f).querySelectorAll(`[data-case-window="${kind}"] [role="heading"]`)).map(
    (h) => h.textContent?.trim() ?? '',
  );
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
}

function markButton(f: ComponentFixture<ArchiveWorkComponent>, label: string): HTMLButtonElement | null {
  return el(f).querySelector<HTMLButtonElement>(`[data-case-window="source"] [data-case-field="${label}"] button`);
}

function chooseDecision(f: ComponentFixture<ArchiveWorkComponent>, decisionId: string): void {
  const input = el(f).querySelector<HTMLInputElement>(`[data-case-review] input[type="radio"][value="${decisionId}"]`);
  if (!input) throw new Error(`找不到決定 ${decisionId}`);
  input.click();
  f.detectChanges();
}

async function confirm(f: ComponentFixture<ArchiveWorkComponent>): Promise<void> {
  buttonByText(el(f), CASE_REVIEW_UI.confirm)?.click();
  f.detectChanges();
  await settle();
  f.detectChanges();
}

function codeInput(f: ComponentFixture<ArchiveWorkComponent>): HTMLInputElement {
  const input = el(f).querySelector<HTMLInputElement>('[data-case-code]');
  if (!input) throw new Error('沒有案件編號輸入框');
  return input;
}

function typeCode(f: ComponentFixture<ArchiveWorkComponent>, value: string): void {
  const input = codeInput(f);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  f.detectChanges();
}

/** 兩份來源都有、但值不同的欄位（例如人員編號）。 */
const DIFF_LABEL = (() => {
  const [a, b] = ENTRY.review.sourceDocumentIds.map(caseSourceDocument);
  const hit = a?.text.fields.find((f) => b?.text.fields.some((g) => g.label === f.label && g.value !== f.value));
  if (!hit) throw new Error('兩份來源沒有差異欄位');
  return hit.label;
})();

describe('比對案件畫面（R9）', () => {
  afterEach(() => localStorage.clear());

  it('選到案件紀錄：核對表單換成比對畫面，第一次選取即開案並保存變體', () => {
    const game = bootAtCaseDay();
    const f = render();
    selectKey(f, game, KEY);
    expect(el(f).querySelector('app-case-review')).not.toBeNull();
    expect(el(f).querySelector('app-archive-check-form')).toBeNull();
    const state = game.caseState(CASE_ID);
    expect(state).toBeDefined();
    expect(VARIANT_IDS).toContain(state?.variantId ?? '');
    expect(windowHeadings(f, 'source')).toEqual(
      ENTRY.review.sourceDocumentIds.map((id) => caseSourceDocument(id).text.heading),
    );
    expect(windowHeadings(f, 'supporting').length).toBe(1);
    expect(el(f).textContent).toContain(CASE_REVIEW_UI.instruction);
    expect(el(f).querySelector('[data-case-marked-count]')?.textContent?.trim()).toBe(caseMarkedCount(0));
  });

  for (const variantId of VARIANT_IDS) {
    it(`seed 抽到 ${variantId}：只渲染該份附加文件，另一份不在 DOM`, () => {
      const game = bootAtCaseDay(seedFor(variantId));
      const f = render();
      selectKey(f, game, KEY);
      expect(game.caseState(CASE_ID)?.variantId).toBe(variantId);
      const chosen = variantDoc(variantId);
      const supporting = el(f).querySelector('[data-case-window="supporting"]');
      expect(Array.from(supporting?.querySelectorAll('[data-case-field]') ?? []).map((r) => r.getAttribute('data-case-field'))).toEqual(
        chosen.text.fields.map((x) => x.label),
      );
      const html = el(f).innerHTML;
      for (const other of VARIANT_IDS.filter((v) => v !== variantId)) {
        const chosenValues = new Set(chosen.text.fields.map((x) => x.value));
        const unique = variantDoc(other).text.fields.filter((x) => !chosenValues.has(x.value));
        expect(unique.length).toBeGreaterThan(0);
        for (const field of unique) expect(html).not.toContain(field.value);
        expect(html).not.toContain(other);
      }
      // 沒有變體／案件 ID、seed 或布林字樣出現在可見文字
      const text = el(f).textContent ?? '';
      for (const v of VARIANT_IDS) expect(text).not.toContain(v);
      expect(text).not.toContain(CASE_ID);
      expect(text).not.toMatch(/\b(true|false|null|undefined|seed)\b/);
    });
  }

  it('兩個 seed 抽到不同變體（兩種都會出現）', () => {
    expect(new Set(VARIANT_IDS.map(seedFor)).size).toBe(VARIANT_IDS.length);
  });

  it('差異標記：兩份來源同欄位一起標示、計數更新；重新載入保留，變體也不重抽', () => {
    let game = bootAtCaseDay(seedFor(VARIANT_IDS[0] ?? ''));
    let f = render();
    selectKey(f, game, KEY);
    const before = game.caseState(CASE_ID)?.variantId;
    markButton(f, DIFF_LABEL)?.click();
    f.detectChanges();
    const marked = el(f).querySelectorAll(`[data-case-window="source"] [data-case-field="${DIFF_LABEL}"][data-marked]`);
    expect(marked.length).toBe(2);
    expect(markButton(f, DIFF_LABEL)?.getAttribute('aria-pressed')).toBe('true');
    expect(markButton(f, DIFF_LABEL)?.textContent?.trim()).toBe(CASE_REVIEW_UI.unmarkDiff);
    expect(el(f).querySelector('[data-case-marked-count]')?.textContent?.trim()).toBe(caseMarkedCount(1));
    expect(game.caseState(CASE_ID)?.marks).toEqual([DIFF_LABEL]);
    f.destroy();

    // 改寫 seed 後重新載入：已保存的變體與標記不變（不重抽）
    const other = VARIANT_IDS.find((v) => v !== before) ?? '';
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...game.save(), seed: seedFor(other) }));
    game = boot();
    f = render();
    selectKey(f, game, KEY);
    expect(game.caseState(CASE_ID)?.variantId).toBe(before);
    expect(game.caseState(CASE_ID)?.marks).toEqual([DIFF_LABEL]);
    expect(el(f).querySelectorAll(`[data-case-window="source"] [data-case-field="${DIFF_LABEL}"][data-marked]`).length).toBe(2);

    // 再按一次取消標記
    markButton(f, DIFF_LABEL)?.click();
    f.detectChanges();
    expect(game.caseState(CASE_ID)?.marks).toEqual([]);
  });

  it('三種處理方式：文字取自內容、樣式完全相同、沒有預選；未選就確認只顯示提示', async () => {
    const game = bootAtCaseDay();
    const f = render();
    selectKey(f, game, KEY);
    const labels = Array.from(el(f).querySelectorAll<HTMLLabelElement>('[data-case-review] fieldset .radio'));
    expect(labels.map((l) => l.textContent?.trim())).toEqual(ENTRY.review.decisions.map((d) => d.label));
    expect(new Set(labels.map((l) => l.className)).size).toBe(1);
    expect(labels.some((l) => l.querySelector('input')?.checked)).toBeFalse();
    await confirm(f);
    expect(el(f).querySelector('[data-case-error]')?.textContent?.trim()).toBe(CASE_REVIEW_UI.decisionRequired);
    expect(game.archived(KEY)).toBeUndefined();
  });

  it('R11 開案時編號欄位空白、草稿不被寫入；沒有「帶入<文件>」之類的按鈕', () => {
    const game = bootAtCaseDay();
    const f = render();
    selectKey(f, game, KEY);
    expect(game.caseState(CASE_ID)).toBeDefined();
    expect(game.draft(KEY).value).toBe('');
    expect(codeInput(f).value).toBe('');
    expect(el(f).querySelector('[data-case-use]')).toBeNull();
    expect(el(f).querySelector('[data-case-use-document]')).toBeNull();
    const formButtons = Array.from(el(f).querySelectorAll<HTMLButtonElement>('[data-case-review] form button')).map(
      (b) => b.textContent?.trim(),
    );
    expect(formButtons).toEqual([CASE_REVIEW_UI.confirm]);
    expect(el(f).querySelector('[data-case-review] form')?.textContent).not.toMatch(/帶入|使用來源/);
    // 選處理方式只記 decisionId，不填編號
    chooseDecision(f, ENTRY.review.decisions[0]?.id ?? '');
    expect(game.draft(KEY).value).toBe('');
    expect(codeInput(f).value).toBe('');
  });

  it('R11 玩家輸入的編號（含前導零）在重建畫面與重新載入後保留，開案不覆寫', () => {
    let game = bootAtCaseDay();
    let f = render();
    selectKey(f, game, KEY);
    typeCode(f, sourceCode(1));
    f.destroy();
    game = boot();
    f = render();
    selectKey(f, game, KEY);
    expect(codeInput(f).value).toBe(sourceCode(1));
    expect(game.draft(KEY).value).toBe(sourceCode(1));
  });

  it('R10 編輯過的編號不會被處理方式改回；提交保存玩家實際編號與所選依據／去向', async () => {
    let game = bootAtCaseDay();
    let f = render();
    selectKey(f, game, KEY);
    typeCode(f, 'H204x');
    for (const d of ENTRY.review.decisions) {
      chooseDecision(f, d.id);
      expect(game.draft(KEY).decisionId).toBe(d.id);
      expect(game.draft(KEY).value).toBe('H204x');
      expect(codeInput(f).value).toBe('H204x');
      expect(el(f).querySelector('[data-case-selected-field="code"]')?.textContent?.trim()).toBe('H204x');
    }
    // 處理方式存在草稿：重新載入後仍選著，編號也仍是玩家輸入
    f.destroy();
    game = boot();
    f = render();
    selectKey(f, game, KEY);
    const last = ENTRY.review.decisions[ENTRY.review.decisions.length - 1];
    if (!last) throw new Error('沒有決定');
    expect(el(f).querySelector<HTMLInputElement>(`[data-case-review] input[type="radio"][value="${last.id}"]`)?.checked).toBeTrue();
    expect(codeInput(f).value).toBe('H204x');

    await confirm(f);
    const a = game.archived(KEY);
    expect(a?.archiveCode).toBe('H204x');
    expect(a?.caseDecision?.decisionId).toBe(last.id);
    expect(a?.caseDecision?.destination).toBe(last.destination);
    expect(a?.caseDecision?.basisDocumentId).toBe(last.basisDocumentId);
    expect(el(f).querySelector('[data-case-done-field="code"]')?.textContent?.trim()).toBe('H204x');
  });

  it('R10 已選處理方式但編號清空：提示必填，不提交', async () => {
    const game = bootAtCaseDay();
    const f = render();
    selectKey(f, game, KEY);
    chooseDecision(f, ENTRY.review.decisions[0]?.id ?? '');
    typeCode(f, '  ');
    await confirm(f);
    expect(el(f).querySelector('[data-case-error]')?.textContent?.trim()).toBe(VALIDATION_MESSAGES.codeRequired);
    expect(game.archived(KEY)).toBeUndefined();
  });

  it('R10 連點確認處理只保存一次', async () => {
    const game = bootAtCaseDay();
    const f = render();
    selectKey(f, game, KEY);
    typeCode(f, sourceCode(0));
    chooseDecision(f, ENTRY.review.decisions[0]?.id ?? '');
    const button = buttonByText(el(f), CASE_REVIEW_UI.confirm);
    button?.click();
    button?.click();
    f.detectChanges();
    await settle();
    f.detectChanges();
    const events = (game.save()?.events ?? []).filter(
      (e) => e.kind === EVENT_KINDS.archive && (e.payload as { key?: string }).key === KEY,
    );
    expect(events.length).toBe(1);
    expect(game.archived(KEY)?.archiveCode).toBe(sourceCode(0));
  });

  for (const decision of ENTRY.review.decisions) {
    it(`決定 ${decision.id}：確認後鎖定為處理摘要（編號、去向、依據、註記），重新載入仍鎖定`, async () => {
      let game = bootAtCaseDay();
      let f = render();
      selectKey(f, game, KEY);
      markButton(f, DIFF_LABEL)?.click();
      f.detectChanges();
      // R11：編號由玩家自己輸入（沒有預填）；選處理方式不改動
      const code = sourceCode(0);
      typeCode(f, code);
      chooseDecision(f, decision.id);
      const basis = caseSourceDocument(decision.basisDocumentId).text.heading;
      const destination = CASE_REVIEW_UI.destination[decision.destination];
      const selected = el(f).querySelector('[data-case-selected]')?.textContent ?? '';
      for (const s of [code, destination, basis, decision.note]) expect(selected).toContain(s);
      await confirm(f);

      const done = (field: string) =>
        el(f).querySelector(`[data-case-done-field="${field}"]`)?.textContent?.trim();
      const expectDone = () => {
        expect(el(f).querySelector('[data-case-done]')).not.toBeNull();
        expect(done('code')).toBe(code);
        expect(done('destination')).toBe(destination);
        expect(done('basis')).toBe(basis);
        expect(done('note')).toBe(decision.note);
        // 鎖定：沒有處理選項、確認鈕與標記鈕；已標記欄位留中性標示
        expect(el(f).querySelector('[data-case-review] input[type="radio"]')).toBeNull();
        expect(buttonByText(el(f), CASE_REVIEW_UI.confirm)).toBeUndefined();
        expect(markButton(f, DIFF_LABEL)).toBeNull();
        expect(el(f).querySelector(`[data-case-field="${DIFF_LABEL}"]`)?.textContent).toContain(CASE_REVIEW_UI.markedLabel);
      };
      expectDone();
      expect(document.activeElement?.textContent?.trim()).toBe(CASE_REVIEW_UI.doneHeading);

      const a = game.archived(KEY);
      expect(a?.archiveCode).toBe(code);
      expect(a?.caseDecision?.decisionId).toBe(decision.id);
      expect(game.caseDecision(CASE_ID)).toBe(decision.id);
      // 提交後標記不可再改
      game.toggleCaseMark(CASE_ID, DIFF_LABEL);
      expect(game.caseState(CASE_ID)?.marks).toEqual([DIFF_LABEL]);
      // 沒有「正確／錯誤」或分數字樣
      expect(el(f).textContent ?? '').not.toMatch(/正確|錯誤|分數|score/i);
      f.destroy();

      game = boot();
      f = render();
      selectKey(f, game, KEY);
      expectDone();

      // 「返回佇列」選到下一筆未處理的紀錄（一般表單）
      buttonByText(el(f), CASE_REVIEW_UI.closeLabel)?.click();
      f.detectChanges();
      expect(el(f).querySelector('app-archive-check-form')).not.toBeNull();
    });
  }

  it('舊檔（v7）已歸檔案件紀錄但沒有案件決定：照一般已歸檔結果顯示，不開案、不補造選擇', () => {
    let game = bootAtCaseDay();
    const s = game.save();
    if (!s) throw new Error('沒有存檔');
    const record = game.record(KEY);
    const batchId = game.batchId() ?? '';
    const v7: Record<string, unknown> = {
      ...s,
      version: 7,
      batches: {
        ...s.batches,
        [batchId]: {
          archived: {
            [KEY]: {
              archiveCode: record.code,
              refusal: record.refusal,
              origin: 'source',
              source: { name: record.name, code: record.code, refusal: record.refusal, refusalApplies: record.refusalApplies },
            },
          },
          drafts: {},
        },
      },
    };
    delete v7['caseReviews'];
    localStorage.setItem(SAVE_KEY, JSON.stringify(v7));
    game = boot();
    expect(game.save()?.version).toBe(SAVE_VERSION);
    const f = render();
    selectKey(f, game, KEY);
    expect(el(f).querySelector('app-case-review')).toBeNull();
    expect(el(f).querySelector('app-archive-check-form h3')?.textContent?.trim()).toBe(ARCHIVE_UI.doneHeading);
    expect(game.caseState(CASE_ID)).toBeUndefined();
    expect(game.caseDecision(CASE_ID)).toBeNull();
    expect(game.archived(KEY)?.caseDecision).toBeUndefined();
  });

  it('同批其他紀錄照一般流程：與來源不同的編號也照輸入預覽（R10 不比對來源），沒有來源編號帶入', () => {
    const game = bootAtCaseDay();
    const f = render();
    const other = game.records().find((r) => r.key !== KEY);
    if (!other) throw new Error('批次只有案件紀錄');
    selectKey(f, game, other.key);
    expect(el(f).querySelector('app-case-review')).toBeNull();
    const input = el(f).querySelector<HTMLInputElement>('#archive-input');
    if (!input) throw new Error('沒有輸入框');
    input.value = `${other.code}9`;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    buttonByText(el(f), ARCHIVE_UI.validate)?.click();
    f.detectChanges();
    expect(el(f).querySelector('#field-error')?.textContent?.trim()).toBe('');
    expect(el(f).querySelector('app-archive-preview [data-summary="code"]')?.textContent?.trim()).toBe(`${other.code}9`);
    expect(game.draft(other.key).value).toBe(`${other.code}9`);
    expect(el(f).textContent).not.toContain('使用來源編號');
  });

  it('R10 文件是浮動視窗（穩定 ID）：桌面預設兩份來源在工作平台右側上下並看、附加文件先最小化；關閉後從文件入口重開，重複點只聚焦', () => {
    const game = bootAtCaseDay();
    const bounds = { width: 1440, height: 848 };
    TestBed.inject(WindowManagerService).setBounds(bounds.width, bounds.height);
    const work = desktopLayout(bounds).work;
    const f = render();
    selectKey(f, game, KEY);
    const wm = TestBed.inject(WindowManagerService);
    const windows = Array.from(el(f).querySelectorAll<HTMLElement>('[data-case-window]'));
    const ids = windows.map((w) => w.getAttribute('data-window-id') ?? '');
    expect(ids.length).toBe(3);
    expect(ids.slice(0, 2)).toEqual(ENTRY.review.sourceDocumentIds);
    const entries = Array.from(el(f).querySelectorAll<HTMLButtonElement>('[data-case-documents] [data-window-open]'));
    expect(entries.map((b) => b.getAttribute('data-window-open'))).toEqual(ids);

    // 兩份來源在工作平台右側上下並看：同一欄、不重疊、都顯示、不蓋到工作平台；高度放得下全部欄位
    const [a, b, receipt] = ids.map((id) => wm.state(id)());
    expect(a && b && receipt).toBeTruthy();
    if (a && b && receipt) {
      expect(overlap(a, work) || overlap(b, work)).toBeFalse();
      expect(a.x + a.width).toBeLessThanOrEqual(bounds.width);
      expect(a.x).toBe(b.x);
      expect(a.width).toBe(b.width);
      expect(a.y + a.height).toBeLessThanOrEqual(b.y);
      expect([a.mode, b.mode]).toEqual(['normal', 'normal']);
      expect(wm.isShown(a.id) && wm.isShown(b.id)).toBeTrue();
      // 附加文件（補件收件狀態）先最小化在視窗列，從文件入口開啟
      expect(receipt.mode).toBe('minimized');
      expect(receipt.x).toBe(a.x);
    }

    // 關閉 → 從入口重開；位置與尺寸不變
    const before = wm.state(ids[0] ?? '')();
    windows[0]?.querySelector<HTMLButtonElement>('[data-window-close]')?.click();
    f.detectChanges();
    expect(wm.state(ids[0] ?? '')()?.mode).toBe('closed');
    entries[0]?.click();
    f.detectChanges();
    const after = wm.state(ids[0] ?? '')();
    expect(after?.mode).toBe('normal');
    expect([after?.x, after?.y, after?.width, after?.height]).toEqual([before?.x, before?.y, before?.width, before?.height]);
    // 已開啟的再點一次只聚焦（置前），不新增視窗
    entries[1]?.click();
    f.detectChanges();
    expect(wm.windows().filter((w) => ids.includes(w.id)).length).toBe(3);
    expect(wm.state(ids[1] ?? '')()?.z).toBe(Math.max(...wm.windows().map((w) => w.z)));
    // 最小化的附加文件由文件入口開啟
    entries[2]?.click();
    f.detectChanges();
    expect(wm.state(ids[2] ?? '')()?.mode).toBe('normal');
    // 重設視窗位置：回到同一套預設（附加文件再收回視窗列）
    wm.resetLayout();
    expect(ids.map((id) => wm.state(id)()?.mode)).toEqual(['normal', 'normal', 'minimized']);
  });

  it('R10 文件第一次開啟時，未移動過的系統作業紀錄若被蓋到就讓位（最小化）；玩家動過的不動', () => {
    const game = bootAtCaseDay();
    const wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    const bounds = { width: 1440, height: 848 };
    wm.setBounds(bounds.width, bounds.height);
    const layout = desktopLayout(bounds);
    const side = layout.side;
    if (!side) throw new Error('沒有右側空白區');
    // 紀錄窗（讓位視窗）在右下角，與桌面給的預設相同
    wm.register('log', { title: '紀錄', ...layout.log, yields: true });
    expect(wm.state('log')()?.mode).toBe('normal');
    const f = render();
    selectKey(f, game, KEY);
    const ids = Array.from(el(f).querySelectorAll<HTMLElement>('[data-case-window]')).map((w) => w.getAttribute('data-window-id') ?? '');
    const [a, b] = ids.map((id) => wm.state(id)());
    expect(wm.state('log')()?.mode).toBe('minimized');
    // 兩份主文件都在右側空白區內，彼此不重疊
    for (const w of [a, b]) {
      expect(w?.x ?? 0).toBeGreaterThanOrEqual(side.x);
      expect((w?.y ?? 0) + (w?.height ?? 0)).toBeLessThanOrEqual(side.y + side.height);
    }
    wm.restore('log');
    expect(wm.state('log')()?.mode).toBe('normal');
  });

  it('R12 寬桌面：右側空白區夠寬時兩份來源左右並排、同時顯示，都不蓋到工作平台', () => {
    const game = bootAtCaseDay();
    const wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    const bounds = { width: 1920, height: 1030 };
    wm.setBounds(bounds.width, bounds.height);
    const { work, side } = desktopLayout(bounds);
    if (!side) throw new Error('沒有右側空白區');
    const f = render();
    selectKey(f, game, KEY);
    const ids = Array.from(el(f).querySelectorAll<HTMLElement>('[data-case-window="source"]')).map((w) => w.getAttribute('data-window-id') ?? '');
    const [a, b] = ids.map((id) => wm.state(id)());
    if (!a || !b) throw new Error('沒有文件視窗');
    expect([a.mode, b.mode]).toEqual(['normal', 'normal']);
    expect(a.y).toBe(b.y);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(overlap(a, b)).toBeFalse();
    expect(overlap(a, work) || overlap(b, work)).toBeFalse();
    expect(b.x + b.width).toBeLessThanOrEqual(bounds.width);
  });

  it('R12 窄桌面（工作平台右側沒有空白區）：一次一份，第一份在右側、第二份先最小化（開啟時在同一欄）', () => {
    const game = bootAtCaseDay();
    const wm = TestBed.inject(WindowManagerService);
    wm.setCompact(false);
    const bounds = { width: 1000, height: 700 };
    wm.setBounds(bounds.width, bounds.height);
    expect(desktopLayout(bounds).side).toBeNull();
    const f = render();
    selectKey(f, game, KEY);
    const ids = Array.from(el(f).querySelectorAll<HTMLElement>('[data-case-window="source"]')).map((w) => w.getAttribute('data-window-id') ?? '');
    const [a, b] = ids.map((id) => wm.state(id)());
    if (!a || !b) throw new Error('沒有文件視窗');
    expect(a.mode).toBe('normal');
    expect(b.mode).toBe('minimized');
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThanOrEqual(a.y);
    expect(a.x + a.width).toBeLessThanOrEqual(bounds.width);
    expect(a.x).toBeGreaterThan(bounds.width / 2);
  });

  it('R10 關閉／最小化文件視窗不影響草稿、標記與已選處理方式', () => {
    const game = bootAtCaseDay();
    const f = render();
    selectKey(f, game, KEY);
    typeCode(f, 'H-2O4');
    chooseDecision(f, ENTRY.review.decisions[1]?.id ?? '');
    markButton(f, DIFF_LABEL)?.click();
    f.detectChanges();
    const variant = game.caseState(CASE_ID)?.variantId;
    for (const w of Array.from(el(f).querySelectorAll<HTMLElement>('[data-case-window]'))) {
      w.querySelector<HTMLButtonElement>('[data-window-minimize]')?.click();
    }
    f.detectChanges();
    expect(game.draft(KEY).value).toBe('H-2O4');
    expect(game.draft(KEY).decisionId).toBe(ENTRY.review.decisions[1]?.id);
    expect(game.caseState(CASE_ID)?.marks).toEqual([DIFF_LABEL]);
    expect(game.caseState(CASE_ID)?.variantId).toBe(variant);
  });
});
