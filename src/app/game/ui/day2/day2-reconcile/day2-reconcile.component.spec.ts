import { Injectable, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { documentsOfTask } from '../../../content/bundle';
import { ReceiptDocumentText, ReportDocumentText } from '../../../content/schema';
import { RECORD_REVIEW_UI, RETURNED_REVIEW_UI, formatText } from '../../../content/text';
import { EVENT_KINDS, isArrangedInSave } from '../../../core/rules';
import { MissingPolicy, NightResult } from '../../../core/types';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { archiveWith, finishDay, instantOperations, settle } from '../../testing/play';
import { Day2ReconcileComponent } from './day2-reconcile.component';

/**
 * R9 §0：核對摘要在來源批次已交付時即可開啟，不必等跨日夜間結果。
 * 沒有夜間結果時只顯示內容的中性版本行（versionNeutral），不擲骰；四格沿用既有的 arranged 計算
 * （沒有夜間結果＝intervention false）。
 *
 * 正式內容的核對工作都在跨日之後，存檔驗證也要求第一天之後一定有夜間結果，
 * 所以「同日 archive → reconcile」以覆寫 night／arranged／allArchived 的狀態服務模擬（只換讀取面，規則不變）。
 */

@Injectable()
class SameDayGameState extends GameStateService {
  /** 模擬同日 archive → reconcile：還沒有跨日夜間結果。 */
  override readonly night = signal<NightResult | null>(null);
  /** 模擬來源批次是否已交付。 */
  readonly sourceDelivered = signal(true);
  override readonly allArchived = computed(() => this.sourceDelivered());
  /** 既有的四格計算，只是沒有夜間結果（intervention＝false）。 */
  override readonly arranged = computed(() => {
    const s = this.save();
    return s ? isArrangedInSave({ ...s, night: undefined }, DAY_DIRECTORY) : false;
  });
}

function receipt(): ReceiptDocumentText {
  const doc = documentsOfTask('task.day2.reconcile').find((d) => d.kind === 'receipt');
  if (doc?.kind !== 'receipt') throw new Error('沒有副本文件');
  return doc.text;
}

function report(): ReportDocumentText {
  const doc = documentsOfTask('task.day2.reconcile').find((d) => d.kind === 'report');
  if (doc?.kind !== 'report') throw new Error('沒有摘要文件');
  return doc.text;
}

function boot(sameDay: boolean): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), ...(sameDay ? [{ provide: GameStateService, useClass: SameDayGameState }] : [])],
  });
  return TestBed.inject(GameStateService);
}

/** 以真實流程玩到 Day 2 核對（Day 1 的缺值處理決定核對對象的拒絕紀錄）。 */
function toReconcile(policy: MissingPolicy, sameDay: boolean): GameStateService {
  localStorage.clear();
  const game = boot(false);
  game.newGame();
  finishDay(game, policy);
  expect(game.task()?.kind).toBe('reconcile');
  return sameDay ? boot(true) : game;
}

function render(): ComponentFixture<Day2ReconcileComponent> {
  const f = TestBed.createComponent(Day2ReconcileComponent);
  f.autoDetectChanges(true);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<Day2ReconcileComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function openReport(f: ComponentFixture<Day2ReconcileComponent>, game: GameStateService): void {
  const t = game.taskContent();
  if (t?.kind !== 'reconcile') throw new Error('不是核對工作');
  const b = Array.from(el(f).querySelectorAll<HTMLButtonElement>('button')).find(
    (x) => x.textContent?.trim() === t.text.openReport,
  );
  b?.click();
  f.detectChanges();
}

function reportDoc(f: ComponentFixture<Day2ReconcileComponent>): HTMLElement | null {
  const heading = report().heading;
  return (
    Array.from(el(f).querySelectorAll<HTMLElement>('app-day2-document')).find(
      (d) => d.querySelector('h3')?.textContent?.trim() === heading,
    ) ?? null
  );
}

describe('Day2ReconcileComponent 摘要開啟條件（R9 §0）', () => {
  afterEach(() => localStorage.clear());

  it('跨日後（有夜間結果）：版本行用版本號，來源行依保存的夜間結果', () => {
    const game = toReconcile('default_false', false);
    const night = game.night();
    expect(night).not.toBeNull();
    const f = render();
    openReport(f, game);
    const doc = reportDoc(f);
    expect(doc).not.toBeNull();
    const r = report();
    expect(doc?.querySelector('.tag')?.textContent?.trim()).toBe(
      formatText(r.versionTemplate, { revision: night?.reportRevision ?? 0 }),
    );
    const origin = night?.intervention ? r.sourceOrigin.intervention : r.sourceOrigin.rules;
    expect(doc?.textContent).toContain(formatText(r.sourceTemplate, { origin }));
  });

  for (const [policy, arranged] of [
    ['default_false', true],
    ['request_review', false],
  ] as const) {
    it(`沒有夜間結果、來源已交付（Day 1 ${policy}）：摘要仍可開啟，顯示中性版本行，不擲骰；四格＝${arranged ? '已列入安排' : '待資料覆核'}`, () => {
      const game = toReconcile(policy, true);
      expect(game.night()).toBeNull();
      const savedNight = JSON.stringify(game.save()?.night);
      const events = game.save()?.events.length;
      const f = render();
      openReport(f, game);
      const doc = reportDoc(f);
      expect(doc).not.toBeNull();
      const r = report();
      expect(doc?.querySelector('.tag')?.textContent?.trim()).toBe(r.versionNeutral);
      expect(doc?.textContent).toContain(formatText(r.sourceTemplate, { origin: r.sourceOrigin.rules }));
      expect(doc?.textContent).not.toContain(r.sourceOrigin.intervention);
      const cells = Array.from(doc?.querySelectorAll('.receipt-cell') ?? []);
      expect(cells.length).toBe(game.dayTasks().find((t) => t.kind === 'reconcile')?.total ?? -1);
      expect(cells[0]?.textContent).toContain(arranged ? r.arranged : r.pendingReview);
      // 開摘要不擲骰、不寫夜間結果，只記錄「已開啟」
      expect(JSON.stringify(game.save()?.night)).toBe(savedNight);
      expect(game.save()?.events.length).toBe(events);
      expect(game.evidence().reportOpened).toBeTrue();
      expect(el(f).textContent ?? '').not.toMatch(/\b(true|false|null|undefined)\b/);
    });
  }

  it('沒有夜間結果且來源尚未交付：不顯示摘要內容', () => {
    const game = toReconcile('default_false', true) as SameDayGameState;
    game.sourceDelivered.set(false);
    const f = render();
    openReport(f, game);
    expect(reportDoc(f)).toBeNull();
  });

  it('Day 2 核對量＝任務 recordIds（2 筆），不是來源批次的 3 筆', () => {
    const game = toReconcile('default_false', false);
    const item = game.dayTasks().find((t) => t.kind === 'reconcile');
    expect(item?.total).toBe(2);
    expect(game.records().length).toBe(3);
  });
});

/* ---------- R10：送件編號流入核對、逐筆審查、回覆經提交流程 ---------- */

describe('Day2ReconcileComponent 逐筆審查與送件編號（R10）', () => {
  afterEach(() => localStorage.clear());

  /** Day 1 第一批依 codes 輸入（其餘照來源），交付當日全部工作，進到 Day 2 核對。 */
  function toReconcileWith(codes: Record<string, string>): GameStateService {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    instantOperations(TestBed.inject(WorkOperationsService));
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
    const game = TestBed.inject(GameStateService);
    game.newGame();
    archiveWith(game, codes);
    expect(game.completeWork()).toBeTrue();
    finishDay(game);
    expect(game.task()?.kind).toBe('reconcile');
    return game;
  }

  function clickText(f: ComponentFixture<Day2ReconcileComponent>, text: string): void {
    const b = Array.from(el(f).querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === text);
    if (!b) throw new Error(`找不到按鈕「${text}」`);
    b.click();
    f.detectChanges();
  }

  function docByHeading(f: ComponentFixture<Day2ReconcileComponent>, heading: string): HTMLElement | null {
    return (
      Array.from(el(f).querySelectorAll<HTMLElement>('app-day2-document')).find(
        (d) => d.querySelector('h3')?.textContent?.trim() === heading,
      ) ?? null
    );
  }

  function cellCodes(doc: HTMLElement | null): string[] {
    return Array.from(doc?.querySelectorAll('.receipt-cell code') ?? []).map((c) => c.textContent?.trim() ?? '');
  }

  function reviewButton(f: ComponentFixture<Day2ReconcileComponent>, index: number, action: 'release' | 'hold'): HTMLButtonElement {
    const b = el(f).querySelector<HTMLButtonElement>(`[data-review-index="${index}"] [data-review-action="${action}"]`);
    if (!b) throw new Error(`找不到第 ${index} 筆的 ${action}`);
    return b;
  }

  function replyButtons(f: ComponentFixture<Day2ReconcileComponent>): HTMLButtonElement[] {
    const t = f.componentRef.injector.get(GameStateService).taskContent();
    if (t?.kind !== 'reconcile') throw new Error('不是核對工作');
    const labels = [t.text.choices.ack, t.text.choices.ask, t.text.choices.review];
    return Array.from(el(f).querySelectorAll<HTMLButtonElement>('button')).filter((b) => labels.includes(b.textContent?.trim() ?? ''));
  }

  it('Day 1 輸入 102：摘要與副本都顯示送件編號 102，原始來源 0102 只在標明的欄位出現', () => {
    const game = toReconcileWith({ B102: '102' });
    const f = render();
    const t = game.taskContent();
    if (t?.kind !== 'reconcile') throw new Error('不是核對工作');
    clickText(f, t.text.openReport);
    clickText(f, t.text.openReceipt);
    const reportCodes = cellCodes(docByHeading(f, report().heading));
    const receiptCodes = cellCodes(docByHeading(f, receipt().heading));
    expect(reportCodes).toEqual(['102', '0607']);
    expect(receiptCodes).toEqual(['102', '0607']);
    expect(docByHeading(f, report().heading)?.textContent).not.toContain('0102');
    expect(docByHeading(f, receipt().heading)?.textContent).not.toContain('0102');

    const first = el(f).querySelector('[data-review-index="0"]');
    expect(first?.querySelector('[data-review-code]')?.textContent?.trim()).toBe('102');
    expect(first?.querySelector('[data-review-source]')?.textContent?.trim()).toBe('0102');
    expect(first?.textContent).toContain(RETURNED_REVIEW_UI.source);
    expect(first?.querySelector('[data-review-status]')?.textContent?.trim()).toBe(RECORD_REVIEW_UI.statusPending);
    // 首次顯示不標示「填錯」
    expect(el(f).textContent ?? '').not.toMatch(/錯誤|不一致|正確/);
  });

  it('兩筆填成相同編號：摘要與副本各一格，不合併', () => {
    const game = toReconcileWith({ B102: '102', B607: '102' });
    const f = render();
    const t = game.taskContent();
    if (t?.kind !== 'reconcile') throw new Error('不是核對工作');
    clickText(f, t.text.openReport);
    clickText(f, t.text.openReceipt);
    expect(cellCodes(docByHeading(f, report().heading))).toEqual(['102', '102']);
    expect(cellCodes(docByHeading(f, receipt().heading))).toEqual(['102', '102']);
  });

  it('每一筆都有審查處置前不能回覆（中性提示）；處置可改，送出後鎖定並保存所看的版本', async () => {
    const game = toReconcileWith({ B102: '102' });
    const f = render();
    document.body.appendChild(f.nativeElement);
    const t = game.taskContent();
    if (t?.kind !== 'reconcile') throw new Error('不是核對工作');
    clickText(f, t.text.openReport);
    clickText(f, t.text.openReceipt);
    expect(el(f).querySelector('[data-review-required]')?.textContent?.trim()).toBe(RECORD_REVIEW_UI.requiredNotice);
    expect(replyButtons(f).every((b) => b.disabled)).toBeTrue();

    reviewButton(f, 0, 'hold').click();
    f.detectChanges();
    expect(replyButtons(f).every((b) => b.disabled)).toBeTrue();
    reviewButton(f, 0, 'release').click();
    reviewButton(f, 1, 'release').click();
    f.detectChanges();
    expect(reviewButton(f, 0, 'release').getAttribute('aria-pressed')).toBe('true');
    expect(reviewButton(f, 0, 'hold').getAttribute('aria-pressed')).toBe('false');
    expect(el(f).querySelector('[data-review-index="0"] [data-review-status]')?.textContent?.trim()).toBe(RECORD_REVIEW_UI.statusReleased);
    expect(el(f).querySelector('[data-review-required]')).toBeNull();
    expect(replyButtons(f).every((b) => !b.disabled)).toBeTrue();
    expect(game.recordReview('B102')).toEqual(
      jasmine.objectContaining({ disposition: 'release', sourceCode: '0102', reviewedCode: '102' }),
    );

    // 回覆（確認收到摘要）經提交流程；連點只保存一次
    replyButtons(f)[0]?.click();
    f.detectChanges();
    const confirm = el(f).querySelector<HTMLButtonElement>('dialog button.btn-primary');
    confirm?.click();
    confirm?.click();
    f.detectChanges();
    await settle();
    f.detectChanges();
    const replies = (game.save()?.events ?? []).filter((e) => e.kind === EVENT_KINDS.replySubmit);
    expect(replies.length).toBe(1);
    const progress = game.save()?.taskProgress['task.day2.reconcile'];
    expect(progress?.kind === 'reconcile' ? progress.reply : undefined).toBe('ack');
    expect(progress?.kind === 'reconcile' ? progress.reviews?.['B102']?.disposition : undefined).toBe('release');
    f.destroy();
    (f.nativeElement as HTMLElement).remove();
  });
});
