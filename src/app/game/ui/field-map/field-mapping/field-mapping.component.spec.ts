import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fieldMapTask } from '../../../content/bundle';
import { FIELD_MAP_UI, TASKS_UI } from '../../../content/text';
import { MissingPolicy } from '../../../core/types';
import { EVENT_KINDS } from '../../../core/rules';
import { GameStateService } from '../../../state/game-state.service';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { instantOperations, playTo, settle } from '../../testing/play';
import { FieldMappingComponent } from './field-mapping.component';

/**
 * R6 §6 Day 6 欄位映射的畫面整合：正式內容 ＋ 真實存檔 ＋ DOM 操作。
 * Day 6 狀態一律用 GameStateService 走完整流程取得，不手刻存檔。
 * 期望值（欄位名稱、列數、錯誤文字）一律從內容檔推導。
 */

const TASK = fieldMapTask('task.day6.field-map');

function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  instantOperations(TestBed.inject(WorkOperationsService));
  return TestBed.inject(GameStateService);
}

/** 依 convert 型別找目標欄位（不寫死欄位 ID）。 */
function targetsOf(convert: 'text' | 'boolean') {
  return TASK.targetFields.filter((t) => t.convert === convert);
}

function playToDay6(game: GameStateService): void {
  playTo(game, 'day.06');
  expect(game.task()?.kind).toBe('field-map');
}

function render(): ComponentFixture<FieldMappingComponent> {
  const fixture = TestBed.createComponent(FieldMappingComponent);
  fixture.detectChanges();
  return fixture;
}

function root(fixture: ComponentFixture<FieldMappingComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function selectFor(fixture: ComponentFixture<FieldMappingComponent>, targetId: string): HTMLSelectElement {
  const el = root(fixture).querySelector<HTMLSelectElement>(`#map-target-${targetId}`);
  if (!el) throw new Error(`找不到 ${targetId} 的 select`);
  return el;
}

function choose(fixture: ComponentFixture<FieldMappingComponent>, targetId: string, sourceId: string): void {
  const el = selectFor(fixture, targetId);
  el.value = sourceId;
  el.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

/** 正確對應：每個目標欄位選自己的 sourceId。 */
function mapCorrectly(fixture: ComponentFixture<FieldMappingComponent>): void {
  for (const t of TASK.targetFields) choose(fixture, t.id, t.sourceId);
}

function button(fixture: ComponentFixture<FieldMappingComponent>, text: string): HTMLButtonElement {
  const found = Array.from(root(fixture).querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`找不到按鈕「${text}」`);
  return found;
}

function click(fixture: ComponentFixture<FieldMappingComponent>, text: string): void {
  button(fixture, text).click();
  fixture.detectChanges();
}

function pickPolicy(fixture: ComponentFixture<FieldMappingComponent>, policy: MissingPolicy): void {
  const input = root(fixture).querySelector<HTMLInputElement>(`input[type="radio"][value="${policy}"]`);
  if (!input) throw new Error('找不到空白值處理選項');
  input.checked = true;
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function errorText(fixture: ComponentFixture<FieldMappingComponent>): string {
  return root(fixture).querySelector('#field-map-error')?.textContent?.trim() ?? '';
}

function previewText(fixture: ComponentFixture<FieldMappingComponent>): string {
  return root(fixture).querySelector('app-mapping-preview')?.textContent ?? '';
}

/** 預覽表中某個目標欄位那一欄的全部文字（依目標欄位順序定位）。 */
function cellsOf(fixture: ComponentFixture<FieldMappingComponent>, targetId: string): string[] {
  const index = TASK.targetFields.findIndex((t) => t.id === targetId);
  const rows = Array.from(root(fixture).querySelectorAll('app-mapping-preview tbody tr'));
  return rows.map((tr) => tr.querySelectorAll('td')[index]?.textContent?.trim() ?? '');
}

describe('FieldMappingComponent（Day 6 欄位映射）', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    game = boot();
    game.newGame();
    playToDay6(game);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('左側來源表：表頭為來源欄位名稱，列數與內容相同，空值顯示共用字樣', () => {
    const fixture = render();
    const table = root(fixture).querySelector('app-mapping-source-table table');
    const headers = Array.from(table?.querySelectorAll('th') ?? []).map((th) => th.textContent?.trim());
    expect(headers).toEqual(TASK.sourceFields.map((f) => f.label));
    expect(table?.querySelectorAll('tbody tr').length).toBe(TASK.rows.length);
    expect(table?.textContent).toContain(FIELD_MAP_UI.blankValue);
    expect(table?.textContent).toContain('0102');
  });

  it('來源欄位依內容檔順序（已打亂，與目標欄位順序不同）；對應仍依 ID 驗證', () => {
    const sourceOrder = TASK.sourceFields.map((f) => f.id);
    const targetOrder = TASK.targetFields.map((t) => t.sourceId);
    expect(sourceOrder).not.toEqual(targetOrder);
    expect([...sourceOrder].sort()).toEqual([...targetOrder].sort());

    const fixture = render();
    for (const t of TASK.targetFields) {
      expect(Array.from(selectFor(fixture, t.id).options).slice(1).map((o) => o.value)).toEqual(sourceOrder);
    }
    mapCorrectly(fixture);
    pickPolicy(fixture, 'default_false');
    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe('');
    expect(game.fieldMap()?.previewed).toBeTrue();
  });

  it('右側每個目標欄位一個有標籤的 select，選項＝預設提示＋全部來源欄位，未預選', () => {
    const fixture = render();
    for (const t of TASK.targetFields) {
      const el = selectFor(fixture, t.id);
      const label = root(fixture).querySelector(`label[for="${el.id}"]`);
      expect(label?.textContent?.trim()).toBe(t.label);
      expect(Array.from(el.options).map((o) => o.textContent?.trim())).toEqual([
        FIELD_MAP_UI.selectPlaceholder,
        ...TASK.sourceFields.map((f) => f.label),
      ]);
      expect(el.value).toBe('');
    }
    expect(root(fixture).querySelector('fieldset legend')?.textContent?.trim()).toBe(FIELD_MAP_UI.blankLegend);
  });

  it('未填、重複只顯示一般欄位錯誤；布林欄位配到無法轉換的來源顯示轉換錯誤；都不寫存檔，確認匯入仍停用', () => {
    const fixture = render();
    const before = JSON.stringify(game.save());

    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe(FIELD_MAP_UI.mappingError);

    const [a, b] = TASK.targetFields;
    mapCorrectly(fixture);
    choose(fixture, b.id, a.sourceId); // 重複
    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe(FIELD_MAP_UI.mappingError);

    choose(fixture, a.id, b.sourceId); // 互換：文字 ↔ 布林，布林目標讀到無法轉換的值
    expect(a.convert).not.toBe(b.convert);
    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe(FIELD_MAP_UI.convertError);
    for (const t of TASK.targetFields) expect(errorText(fixture)).not.toContain(t.label);

    expect(button(fixture, FIELD_MAP_UI.confirm).disabled).toBeTrue();
    expect(game.fieldMap()?.previewed).toBeFalse();
    expect(JSON.parse(JSON.stringify(game.save())).events).toEqual(JSON.parse(before).events);
  });

  it('正確對應但未選空白值處理時顯示處理方式錯誤', () => {
    const fixture = render();
    mapCorrectly(fixture);
    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe(FIELD_MAP_UI.policyRequired);
    expect(root(fixture).querySelector('app-mapping-preview')).toBeNull();
    expect(button(fixture, FIELD_MAP_UI.confirm).disabled).toBeTrue();
  });

  for (const policy of ['default_false', 'request_review'] as const) {
    it(`${policy}：預覽 8／4／4 與 0102，確認後鎖定，重新載入仍保留`, async () => {
      const fixture = render();
      mapCorrectly(fixture);
      pickPolicy(fixture, policy);
      click(fixture, FIELD_MAP_UI.validate);
      expect(errorText(fixture)).toBe('');

      const text = previewText(fixture);
      const numbers = Array.from(root(fixture).querySelectorAll('app-mapping-preview dd')).map((d) =>
        d.textContent?.trim(),
      );
      expect(numbers).toEqual(['8', '4', '4', '0102']);
      // R7 §6.2：沒有樣本 JSON；排除狀態以人類文字顯示
      expect(root(fixture).querySelector('app-mapping-preview pre')).toBeNull();
      expect(text).not.toContain('{"');
      expect(text).not.toMatch(/\b(true|false|null)\b/);
      expect(text).toContain(policy === 'default_false' ? FIELD_MAP_UI.notExcluded : FIELD_MAP_UI.pendingReview);
      if (policy === 'default_false') expect(text).not.toContain(FIELD_MAP_UI.pendingReview);
      expect(text).toContain(FIELD_MAP_UI.excluded);
      expect(cellsOf(fixture, 'personnel-code')).toContain('0102');

      expect(button(fixture, TASKS_UI.finishDay).disabled).toBeTrue();
      click(fixture, FIELD_MAP_UI.confirm);
      await settle();
      fixture.detectChanges();

      expect(game.fieldMap()?.submitted?.blankPolicy).toBe(policy);
      expect(root(fixture).textContent).toContain(FIELD_MAP_UI.doneHeading);
      expect(root(fixture).textContent).toContain(FIELD_MAP_UI.footerDone);
      for (const t of TASK.targetFields) expect(selectFor(fixture, t.id).disabled).toBeTrue();
      expect(button(fixture, TASKS_UI.finishDay).disabled).toBeFalse();

      // 重新載入：新的 injector 從 localStorage 讀回同一份存檔
      fixture.destroy();
      game = boot();
      const again = render();
      for (const t of TASK.targetFields) {
        expect(selectFor(again, t.id).value).toBe(t.sourceId);
        expect(selectFor(again, t.id).disabled).toBeTrue();
      }
      expect(root(again).querySelector<HTMLInputElement>(`input[value="${policy}"]`)?.checked).toBeTrue();
      expect(root(again).textContent).toContain(FIELD_MAP_UI.doneHeading);
      expect(cellsOf(again, 'personnel-code')).toContain('0102');
      expect(previewText(again)).not.toMatch(/\b(true|false|null)\b/);

      expect(game.completeWork()).toBeTrue();
      expect(game.stage()).toBe('end');
    });
  }

  it('預覽後改動對應會清除預覽，確認匯入重新停用', () => {
    const fixture = render();
    mapCorrectly(fixture);
    pickPolicy(fixture, 'default_false');
    click(fixture, FIELD_MAP_UI.validate);
    expect(button(fixture, FIELD_MAP_UI.confirm).disabled).toBeFalse();

    const [a] = TASK.targetFields;
    choose(fixture, a.id, '');
    expect(root(fixture).querySelector('app-mapping-preview')).toBeNull();
    expect(button(fixture, FIELD_MAP_UI.confirm).disabled).toBeTrue();
  });

  /* ---------- R10：依玩家對應轉換；文字欄位配錯可匯入，布林無法轉換被擋 ---------- */

  it('兩個文字欄位互換：可預覽並匯入，預覽與提交快照都依玩家的對應（不矯正成預設配對）', async () => {
    const [t1, t2] = targetsOf('text');
    if (!t1 || !t2) throw new Error('需要兩個文字目標欄位');
    const fixture = render();
    mapCorrectly(fixture);
    choose(fixture, t1.id, t2.sourceId);
    choose(fixture, t2.id, t1.sourceId);
    pickPolicy(fixture, 'default_false');
    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe('');
    const expected1 = TASK.rows.map((r) => r.values[t2.sourceId] ?? '');
    const expected2 = TASK.rows.map((r) => r.values[t1.sourceId] ?? '');
    expect(cellsOf(fixture, t1.id)).toEqual(expected1);
    expect(cellsOf(fixture, t2.id)).toEqual(expected2);
    expect(button(fixture, FIELD_MAP_UI.confirm).disabled).toBeFalse();

    click(fixture, FIELD_MAP_UI.confirm);
    await settle();
    fixture.detectChanges();
    const rows = game.fieldMap()?.submitted?.rows ?? [];
    expect(rows.map((r) => r.values[t1.id])).toEqual(expected1);
    expect(rows.map((r) => r.values[t2.id])).toEqual(expected2);
    expect(root(fixture).textContent).toContain(FIELD_MAP_UI.doneHeading);
  });

  it('布林欄位配到含無法轉換值的來源：顯示轉換錯誤、不預覽、不能匯入（不靜默當成空白）', () => {
    const [bool] = targetsOf('boolean');
    const [text] = targetsOf('text');
    if (!bool || !text) throw new Error('需要布林與文字目標欄位');
    const fixture = render();
    mapCorrectly(fixture);
    choose(fixture, bool.id, text.sourceId);
    choose(fixture, text.id, bool.sourceId);
    // 布林欄位改讀沒有空白的來源 → 不需要空白值處理；擋下的是無法轉換的值
    expect(root(fixture).querySelector('fieldset legend')).toBeNull();
    click(fixture, FIELD_MAP_UI.validate);
    expect(errorText(fixture)).toBe(FIELD_MAP_UI.convertError);
    expect(root(fixture).querySelector('app-mapping-preview')).toBeNull();
    expect(button(fixture, FIELD_MAP_UI.confirm).disabled).toBeTrue();
    expect(game.fieldMap()?.previewed).toBeFalse();
    expect(game.fieldMap()?.submitted).toBeUndefined();
  });

  it('空白值處理是否出現依玩家的對應重算：布林欄位改配沒有空白的來源時不需要處理方式', () => {
    const [bool] = targetsOf('boolean');
    if (!bool) throw new Error('需要布林目標欄位');
    const noBlank = TASK.sourceFields.find((f) => TASK.rows.every((r) => (r.values[f.id] ?? '') !== ''));
    if (!noBlank) throw new Error('需要沒有空白的來源欄位');
    const fixture = render();
    choose(fixture, bool.id, bool.sourceId);
    expect(root(fixture).querySelector('fieldset legend')?.textContent?.trim()).toBe(FIELD_MAP_UI.blankLegend);
    choose(fixture, bool.id, noBlank.id);
    expect(root(fixture).querySelector('fieldset legend')).toBeNull();
  });

  it('連點確認匯入只保存一次', async () => {
    const fixture = render();
    mapCorrectly(fixture);
    pickPolicy(fixture, 'request_review');
    click(fixture, FIELD_MAP_UI.validate);
    const confirm = button(fixture, FIELD_MAP_UI.confirm);
    confirm.click();
    confirm.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    const events = (game.save()?.events ?? []).filter((e) => e.kind === EVENT_KINDS.fieldMapSubmit);
    expect(events.length).toBe(1);
    expect(game.fieldMap()?.submitted?.blankPolicy).toBe('request_review');
  });
});
