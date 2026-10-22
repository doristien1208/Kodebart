import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ARCHIVE_UI, RECORD_STATUS } from '../../../content/text';
import { Save } from '../../../core/types';
import { DAY_DIRECTORY } from '../../../state/day-directory';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { M1_SAVE_B, instantOperations, playM1To, playM1UntilKind } from '../../testing/play';
import { CONTENT_LABELS, DocumentRef, workDocumentView } from '../presenters/work-document';
import { BatchViewComponent } from './batch-view.component';

/**
 * 批次 input／rule／output 的實際顯示（M2 R2）：JSON 對照按欄位解釋 null——來源未提供、採用仍未確認
 * （是否送覆核看 origin）、輸出保留未確認；不適用的資料另列不適用。原始 JSON 的值照存（null 不改寫）。
 * 資料一律由 work-document presenter 從實際玩過的存檔推導。
 */

const TRANSFORM_D4 = 'task.day4.m1-transform';
const INTERNAL = /task\.|record\.|doc\.|batch\.|day\.0|mail\.|case\.|\bseed\b/;

/** 對照逐字：true／false 沿用 legendTemplate 與 recordStatus；其餘取自 doc/content/M2-shared-city-content.json 的 ui.batchFieldMeaning。 */
const LEGEND = [
  'true＝已拒絕',
  'false＝未拒絕',
  'sourceRefusal 的 null：來源未提供拒絕紀錄。',
  'adoptedRefusal 的 null：採用值仍未確認；是否送覆核請看 origin 與處理去向。',
  '輸出 refusal 的 null：本次輸出保留未確認，不代表本人已回覆。',
  '不適用的資料另列不適用，不用未提供或未確認代替。',
];

function boot(): GameStateService {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.returnValue(Promise.resolve(true));
  const game = TestBed.inject(GameStateService);
  game.newGame();
  return game;
}

function saveOf(game: GameStateService): Save {
  const s = game.save();
  if (!s) throw new Error('沒有存檔');
  return s;
}

/** 以 presenter 從存檔推導的批次資料呈現 BatchView。 */
function render(save: Save, ref: DocumentRef): ComponentFixture<BatchViewComponent> {
  const v = workDocumentView(ref, save, DAY_DIRECTORY, CONTENT_LABELS);
  if (v.kind !== 'batch') throw new Error(`不是批次：${v.kind}`);
  const f = TestBed.createComponent(BatchViewComponent);
  f.componentRef.setInput('rows', v.rows);
  f.componentRef.setInput('json', v.json);
  f.componentRef.setInput('legend', v.legend);
  f.componentRef.setInput('counts', v.counts);
  f.detectChanges();
  return f;
}

function el(f: ComponentFixture<BatchViewComponent>): HTMLElement {
  return f.nativeElement as HTMLElement;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function legendItems(f: ComponentFixture<BatchViewComponent>): string[] {
  return Array.from(el(f).querySelectorAll('[data-batch-legend] li')).map((li) => text(li));
}

/** 畫面上 JSON 窗格的內容（原樣解析）。 */
function jsonPane(f: ComponentFixture<BatchViewComponent>, pane: 'input' | 'output'): Record<string, unknown>[] {
  return JSON.parse(el(f).querySelector(`[data-batch-json-${pane}]`)?.textContent ?? '') as Record<string, unknown>[];
}

/** 某列的儲存格文字：序號、人員編號、來源、採用、輸出、依據、附件、狀態。 */
function cells(f: ComponentFixture<BatchViewComponent>, code: string): string[] {
  return Array.from(el(f).querySelectorAll(`[data-batch-row="${code}"] td`)).map((td) => text(td));
}

describe('BatchViewComponent（批次 JSON 的欄位意義對照，M2 R2）', () => {
  afterEach(() => localStorage.clear());

  it('批次副本的對照：true／false 之後依序是 sourceRefusal、adoptedRefusal、輸出 refusal 的 null 與不適用；沒有通用的「null＝未確認」', () => {
    const game = boot();
    playM1To(game, 'day.05', M1_SAVE_B);
    const f = render(saveOf(game), { kind: 'batch-output', taskId: TRANSFORM_D4 });
    expect(legendItems(f)).toEqual(LEGEND);
    expect(legendItems(f)).not.toContain('null＝未確認');
  });

  it('Save B（各階段都保留缺漏）：三種 null 都照存在 JSON；表格分別顯示來源未提供、採用未確認（送覆核）、輸出未確認；送覆核看 adoptedOrigin', () => {
    const game = boot();
    playM1To(game, 'day.05', M1_SAVE_B);
    const submitted = game.transformProgress(TRANSFORM_D4).submitted;
    if (!submitted) throw new Error('批次尚未交付');
    const f = render(saveOf(game), { kind: 'batch-output', taskId: TRANSFORM_D4 });
    const input = jsonPane(f, 'input');
    const output = jsonPane(f, 'output');
    expect(input.map((r) => [r['sourceRefusal'], r['adoptedRefusal'], r['adoptedOrigin']])).toEqual(
      submitted.rows.map((r) => [r.sourceRefusal, r.adoptedRefusal, r.adoptedOrigin]),
    );
    expect(output.map((r) => r['refusal'])).toEqual(submitted.rows.map((r) => r.value));
    expect(input.map((r) => [r['sourceRefusal'], r['adoptedRefusal'], r['adoptedOrigin']])).toEqual([
      [null, null, 'review'],
      [null, null, 'review'],
      [null, null, 'review'],
    ]);
    expect(input.every((r) => !('refusalApplies' in r))).toBeTrue();

    // 0716：來源 null、採用 null（送覆核）、輸出 null 在表格上各是各的意思
    const held = cells(f, '0716');
    expect(held.slice(2, 5)).toEqual([RECORD_STATUS.missing, `${RECORD_STATUS.unconfirmed}（${ARCHIVE_UI.methodReview}）`, RECORD_STATUS.unconfirmed]);
    expect(output.find((r) => r['personnelCode'] === '0716')?.['refusal']).toBeNull();
    expect(text(el(f))).not.toMatch(INTERNAL);
  });

  it('不適用的列：表格的來源／採用欄顯示不適用（不叫未提供或未確認），輸入 JSON 只在這一列另標 refusalApplies: false', () => {
    const game = boot();
    playM1To(game, 'day.04', M1_SAVE_B);
    playM1UntilKind(game, 'transform', M1_SAVE_B);
    game.setTransformPolicy('review');
    const save = saveOf(game);
    const base = game.transformDisplay(TRANSFORM_D4)?.rows.find((r) => r.adoptedCode === '0716');
    if (!base) throw new Error('沒有 0716 列');
    const b = save.batches[base.batchId];
    if (!b) throw new Error('沒有批次');
    const entry = { archiveCode: '0716', refusal: null, origin: 'source' as const, source: { name: null, code: '0716', refusal: null, refusalApplies: false } };
    const notApplicable: Save = { ...save, batches: { ...save.batches, [base.batchId]: { ...b, archived: { ...b.archived, [base.recordKey]: entry } } } };

    const f = render(notApplicable, { kind: 'batch-preview', taskId: TRANSFORM_D4 });
    expect(cells(f, '0716').slice(2, 4)).toEqual([RECORD_STATUS.notApplicable, RECORD_STATUS.notApplicable]);
    expect(cells(f, '0314')[2]).toBe(RECORD_STATUS.missing);
    const flagged = jsonPane(f, 'input').filter((r) => 'refusalApplies' in r);
    expect(flagged.map((r) => [r['personnelCode'], r['sourceRefusal'], r['refusalApplies'], r['adoptedOrigin']])).toEqual([['0716', null, false, 'source']]);
    expect(legendItems(f)).toContain(LEGEND[5]);
  });
});
