import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HELP_PACKS, archiveTask, recordsOfTask } from '../../../content/bundle';
import { recordLabel } from '../../../content/records';
import { ARCHIVE_UI, OPERATION_UI, RECORD_STATUS, archiveFooterPending, archiveProgress, helpUi } from '../../../content/text';
import { EVENT_KINDS } from '../../../core/rules';
import { MissingPolicy, RecordKey } from '../../../core/types';
import { VALIDATION_MESSAGES } from '../../../core/validate';
import { GameStateService } from '../../../state/game-state.service';
import { SaveRepository } from '../../../state/save-repository';
import { WorkOperationsService } from '../../../state/work-operations.service';
import { completeTask, finishDay, instantOperations, settle } from '../../testing/play';
import { DesktopService } from '../../desktop/services/desktop.service';
import { MessagesNavigationService } from '../../messages/services/messages-navigation.service';
import { ArchiveWorkComponent } from './archive-work.component';

/**
 * R6-01：Day 1、3、4、5 共用同一套 archive 元件，各自只讀自己的 task 文字、批次與筆數。
 * 期望值一律由內容檔推導。
 */

function boot(): GameStateService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  return TestBed.inject(GameStateService);
}

function render(): ComponentFixture<ArchiveWorkComponent> {
  const fixture = TestBed.createComponent(ArchiveWorkComponent);
  fixture.detectChanges();
  return fixture;
}

function queueLabels(fixture: ComponentFixture<ArchiveWorkComponent>): string[] {
  const el = fixture.nativeElement as HTMLElement;
  return Array.from(el.querySelectorAll('app-archive-queue li .truncate')).map((s) => s.textContent?.trim() ?? '');
}

/** skip＝同日要先交付幾件工作才輪到這一件（R8：Day 1、2 各有第二件工作）。 */
const CASES = [
  { dayId: 'day.01', taskId: 'task.day1.archive', count: 3, skip: 0 },
  { dayId: 'day.01', taskId: 'task.day1.archive-followup', count: 3, skip: 1 },
  { dayId: 'day.02', taskId: 'task.day2.archive', count: 4, skip: 1 },
  { dayId: 'day.03', taskId: 'task.day3.archive', count: 5, skip: 0 },
  { dayId: 'day.04', taskId: 'task.day4.archive', count: 6, skip: 0 },
  { dayId: 'day.05', taskId: 'task.day5.archive', count: 8, skip: 0 },
] as const;

describe('ArchiveWorkComponent（各歸檔日共用）', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    game = boot();
    game.newGame();
  });

  afterEach(() => {
    localStorage.clear();
  });

  for (const c of CASES) {
    it(`${c.taskId}：顯示該 task 文字、${c.count} 筆佇列與該批進度`, () => {
      while (game.dayId() !== c.dayId) finishDay(game);
      for (let i = 0; i < c.skip; i++) expect(completeTask(game)).toBeTrue();
      expect(game.taskId()).toBe(c.taskId);
      const fixture = render();
      const el = fixture.nativeElement as HTMLElement;
      const text = archiveTask(c.taskId).text;

      expect(el.querySelector('.eyebrow')?.textContent?.trim()).toBe(text.eyebrow);
      expect(el.querySelector('h3')?.textContent?.trim()).toBe(text.heading);
      expect(el.textContent).toContain(text.instruction);
      expect(el.querySelector('.tag')?.textContent?.trim()).toBe(archiveProgress(0, c.count));
      expect(el.textContent).toContain(archiveFooterPending(c.count));
      expect(queueLabels(fixture)).toEqual(recordsOfTask(c.taskId).map((r) => recordLabel(r)));
      expect(game.totalRecords()).toBe(c.count);
    });
  }

  it('Day 1 文字與原本一致（ui.archive 共用字＋當日標題）', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.eyebrow')?.textContent?.trim()).toBe('ARCHIVE / BATCH 01');
    expect(el.querySelector('h3')?.textContent?.trim()).toBe('人員資料歸檔');
    expect(el.textContent).toContain('請依來源資料核對人員編號，完成歸檔。');
    expect(el.querySelector('.tag')?.textContent?.trim()).toBe('0 / 3 已處理');
    expect(el.textContent).toContain('完成 3 筆資料後即可交接。');
    expect(el.textContent).toContain(ARCHIVE_UI.queueEyebrow);
  });

  it('Day 3 的草稿只寫進 Day 3 批次，不動 Day 1 批次', () => {
    while (game.dayId() !== 'day.03') finishDay(game);
    const day1 = JSON.stringify(game.save()?.batches['batch.day01.archive']);
    const first = game.records()[0];
    if (!first) throw new Error('Day 3 沒有紀錄');
    game.updateDraft(first.key, { value: first.code });
    expect(JSON.stringify(game.save()?.batches['batch.day01.archive'])).toBe(day1);
    expect(game.save()?.batches['batch.day03.archive']?.drafts[first.key]?.value).toBe(first.code);
  });

  /* ---------- R7 §6.2：來源卡與預覽摘要只顯示人類文字 ---------- */

  function el(fixture: ComponentFixture<ArchiveWorkComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function selectKey(fixture: ComponentFixture<ArchiveWorkComponent>, key: RecordKey): void {
    const label = recordLabel(game.record(key));
    const button = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('app-archive-queue button')).find(
      (b) => b.querySelector('.truncate')?.textContent?.trim() === label,
    );
    if (!button) throw new Error(`找不到佇列項目 ${key}`);
    button.click();
    fixture.detectChanges();
  }

  function refusalText(fixture: ComponentFixture<ArchiveWorkComponent>): string {
    const dds = el(fixture).querySelectorAll('app-source-card dd');
    return dds[dds.length - 1]?.textContent?.trim() ?? '';
  }

  function previewSummary(fixture: ComponentFixture<ArchiveWorkComponent>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const dd of Array.from(el(fixture).querySelectorAll('app-archive-preview [data-summary]'))) {
      out[dd.getAttribute('data-summary') ?? ''] = dd.textContent?.trim() ?? '';
    }
    return out;
  }

  function validateWith(fixture: ComponentFixture<ArchiveWorkComponent>, key: RecordKey, policy?: MissingPolicy): void {
    game.updateDraft(key, { value: game.record(key).code, ...(policy ? { policy } : {}) });
    fixture.detectChanges();
    const button = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === ARCHIVE_UI.validate,
    );
    button?.click();
    fixture.detectChanges();
  }

  it('Day 4 來源卡四種拒絕紀錄狀態各自正確（不適用／未拒絕／已拒絕／未提供）', () => {
    while (game.dayId() !== 'day.04') finishDay(game);
    const fixture = render();
    const cases: Array<[RecordKey, string]> = [
      ['H233', RECORD_STATUS.notApplicable],
      ['B731', RECORD_STATUS.notRefused],
      ['B842', RECORD_STATUS.refused],
      ['B716', RECORD_STATUS.missing],
    ];
    for (const [key, expected] of cases) {
      selectKey(fixture, key);
      expect(refusalText(fixture)).withContext(key).toBe(expected);
    }
    // 修正前 refusal=false 會顯示成「已拒絕」
    expect(RECORD_STATUS.notRefused).not.toBe(RECORD_STATUS.refused);
  });

  it('Day 4 預覽為三列摘要：狀態與去向依 origin 顯示，沒有 pre／JSON／true／false／null', () => {
    while (game.dayId() !== 'day.04') finishDay(game);
    const fixture = render();
    const cases: Array<[RecordKey, MissingPolicy | undefined, string, string]> = [
      ['H233', undefined, RECORD_STATUS.notApplicable, ARCHIVE_UI.destinationArchive],
      ['B731', undefined, RECORD_STATUS.sourceNotRefused, ARCHIVE_UI.destinationArchive],
      ['B842', undefined, RECORD_STATUS.sourceRefused, ARCHIVE_UI.destinationArchive],
      ['B716', 'default_false', RECORD_STATUS.defaultedNotRefused, ARCHIVE_UI.destinationArchive],
      ['B905', 'request_review', RECORD_STATUS.unconfirmed, ARCHIVE_UI.destinationReview],
    ];
    for (const [key, policy, status, destination] of cases) {
      selectKey(fixture, key);
      validateWith(fixture, key, policy);
      expect(previewSummary(fixture)).withContext(key).toEqual({ code: game.record(key).code, status, destination });
      const preview = el(fixture).querySelector('app-archive-preview');
      expect(preview?.querySelector('pre')).toBeNull();
      expect(preview?.textContent).not.toContain('{');
      expect(el(fixture).textContent).not.toMatch(/\b(true|false|null)\b/);
    }
  });

  it('缺拒絕紀錄時兩個處理選項各附說明文字', () => {
    const fixture = render();
    selectKey(fixture, 'B102');
    const text = el(fixture).querySelector('fieldset')?.textContent ?? '';
    for (const s of [ARCHIVE_UI.policyDefault, ARCHIVE_UI.policyDefaultHint, ARCHIVE_UI.policyReview, ARCHIVE_UI.policyReviewHint]) {
      expect(text).toContain(s);
    }
  });

  /* ---------- R10：人員編號只驗型別與必填，照玩家輸入保存；提交經 operation 流程 ---------- */

  function button(fixture: ComponentFixture<ArchiveWorkComponent>, text: string): HTMLButtonElement {
    const b = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === text);
    if (!b) throw new Error(`找不到按鈕「${text}」`);
    return b;
  }

  function type(fixture: ComponentFixture<ArchiveWorkComponent>, value: string): void {
    const input = el(fixture).querySelector<HTMLInputElement>('#archive-input');
    if (!input) throw new Error('沒有輸入框');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** 輸入 → 驗證並預覽 → 確認歸檔，並等提交流程結束。 */
  async function submitTyped(fixture: ComponentFixture<ArchiveWorkComponent>, key: RecordKey, value: string, policy?: MissingPolicy): Promise<void> {
    selectKey(fixture, key);
    type(fixture, value);
    if (policy) game.updateDraft(key, { policy });
    fixture.detectChanges();
    button(fixture, ARCHIVE_UI.validate).click();
    fixture.detectChanges();
    button(fixture, ARCHIVE_UI.confirm).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  function archiveEvents(key: RecordKey): number {
    return (game.save()?.events ?? []).filter(
      (e) => e.kind === EVENT_KINDS.archive && (e.payload as { key?: string }).key === key,
    ).length;
  }

  for (const typed of ['0102', '102', '0103']) {
    it(`來源 0102 輸入「${typed}」：沒有不符提示，預覽與保存都照輸入原樣，重新載入不變`, async () => {
      instantOperations(TestBed.inject(WorkOperationsService));
      const fixture = render();
      expect(game.record('B102').code).toBe('0102');
      selectKey(fixture, 'B102');
      type(fixture, typed);
      game.updateDraft('B102', { policy: 'default_false' });
      fixture.detectChanges();
      button(fixture, ARCHIVE_UI.validate).click();
      fixture.detectChanges();
      expect(el(fixture).querySelector('#field-error')?.textContent?.trim()).toBe('');
      expect(previewSummary(fixture)['code']).toBe(typed);
      // 驗證不會暗中改成來源值
      expect(game.draft('B102').value).toBe(typed);

      button(fixture, ARCHIVE_UI.confirm).click();
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();
      expect(game.archived('B102')?.archiveCode).toBe(typed);
      expect(game.archived('B102')?.source.code).toBe('0102');
      expect(el(fixture).querySelector('app-archive-check-form h3')?.textContent?.trim()).toBe(ARCHIVE_UI.doneHeading);
      expect(el(fixture).textContent).toContain(typed);
      expect(el(fixture).querySelector('[data-operation-stage]')?.getAttribute('data-operation-stage')).toBe('done');
      expect(el(fixture).querySelector('[data-operation-status]')?.textContent).toContain(OPERATION_UI.done);

      game = boot();
      expect(game.archived('B102')?.archiveCode).toBe(typed);
    });
  }

  it('R11 新遊戲每一筆的編號欄位都是空白；表單只有「驗證並預覽」，沒有任何帶入來源編號的按鈕', () => {
    const fixture = render();
    for (const r of game.records()) {
      selectKey(fixture, r.key);
      const input = el(fixture).querySelector<HTMLInputElement>('#archive-input');
      expect(input?.value).withContext(r.key).toBe('');
      // R12 §4 的「這個欄位是什麼？」是詢問入口，不是帶入按鈕；另有專門測試
      const labels = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('app-archive-check-form button:not([data-help-ask])')).map(
        (b) => b.textContent?.trim() ?? '',
      );
      expect(labels).withContext(r.key).toEqual([ARCHIVE_UI.validate]);
      expect(el(fixture).textContent).not.toContain('使用來源編號');
      expect(game.draft(r.key).value).toBe('');
    }
    // 開頁與切換都不寫入草稿
    expect(Object.keys(game.save()?.batches['batch.day01.archive']?.drafts ?? {})).toEqual([]);
  });

  it('純空白仍視為未填，不會被換成來源值', () => {
    const fixture = render();
    selectKey(fixture, 'B607');
    type(fixture, '   ');
    button(fixture, ARCHIVE_UI.validate).click();
    fixture.detectChanges();
    expect(el(fixture).querySelector('#field-error')?.textContent?.trim()).toBe(VALIDATION_MESSAGES.codeRequired);
    expect(el(fixture).querySelector('app-archive-preview')).toBeNull();
    expect(game.draft('B607').value).toBe('   ');
  });

  it('R11 既有草稿不被清空：切換紀錄、重建元件與重新載入後仍顯示玩家輸入（含前導零）', () => {
    let fixture = render();
    selectKey(fixture, 'B102');
    type(fixture, '0102x');
    selectKey(fixture, 'B607');
    expect(el(fixture).querySelector<HTMLInputElement>('#archive-input')?.value).toBe('');
    selectKey(fixture, 'B102');
    expect(el(fixture).querySelector<HTMLInputElement>('#archive-input')?.value).toBe('0102x');
    fixture.destroy();

    game = boot();
    fixture = render();
    selectKey(fixture, 'B102');
    expect(el(fixture).querySelector<HTMLInputElement>('#archive-input')?.value).toBe('0102x');
    expect(game.draft('B102').value).toBe('0102x');
  });

  it('兩筆填成相同編號：各自保存一份提交，來源快照分開，不互相覆蓋', async () => {
    instantOperations(TestBed.inject(WorkOperationsService));
    const fixture = render();
    await submitTyped(fixture, 'B102', '102', 'default_false');
    await submitTyped(fixture, 'B607', '102');
    expect(game.archived('B102')?.archiveCode).toBe('102');
    expect(game.archived('B607')?.archiveCode).toBe('102');
    expect(game.archived('B102')?.source.code).toBe('0102');
    expect(game.archived('B607')?.source.code).toBe('0607');
    expect(archiveEvents('B102')).toBe(1);
    expect(archiveEvents('B607')).toBe(1);
    expect(game.archivedCount()).toBe(2);
  });

  it('連點確認歸檔只保存一次：處理中停用確認，階段依序出現', async () => {
    const ops = TestBed.inject(WorkOperationsService);
    const release: Array<() => void> = [];
    ops.wait = () => new Promise<void>((resolve) => release.push(resolve));
    const fixture = render();
    selectKey(fixture, 'B607');
    type(fixture, '0607');
    button(fixture, ARCHIVE_UI.validate).click();
    fixture.detectChanges();
    const confirmButton = button(fixture, ARCHIVE_UI.confirm);
    confirmButton.click();
    confirmButton.click();
    fixture.detectChanges();
    expect(ops.busy()).toBeTrue();
    expect(button(fixture, ARCHIVE_UI.confirm).disabled).toBeTrue();
    expect(el(fixture).querySelector('[data-operation-stage]')?.getAttribute('data-operation-stage')).toBe('received');
    // 還沒保存：不假裝完成
    expect(game.archived('B607')).toBeUndefined();

    while (ops.busy()) {
      release.shift()?.();
      await settle();
      fixture.detectChanges();
    }
    expect(ops.current()?.trail).toEqual(['received', 'validating', 'validated', 'processing', 'saving', 'done']);
    expect(game.archived('B607')?.archiveCode).toBe('0607');
    expect(archiveEvents('B607')).toBe(1);
  });

  it('寫入失敗：顯示保存失敗與重試，存檔不前進；重試成功只有一筆事件', async () => {
    instantOperations(TestBed.inject(WorkOperationsService));
    const repo = TestBed.inject(SaveRepository);
    const persist = repo.persist.bind(repo);
    let fail = true;
    spyOn(repo, 'persist').and.callFake((s) => (fail ? 'x' : persist(s)));
    const fixture = render();
    await submitTyped(fixture, 'B607', '607');
    expect(game.archived('B607')).toBeUndefined();
    const status = el(fixture).querySelector('[data-operation-status]');
    expect(status?.textContent).toContain(OPERATION_UI.failed);
    expect(status?.textContent).toContain(OPERATION_UI.failedHint);

    fail = false;
    button(fixture, OPERATION_UI.retry).click();
    await settle();
    fixture.detectChanges();
    expect(game.archived('B607')?.archiveCode).toBe('607');
    expect(archiveEvents('B607')).toBe(1);
  });
});

/* ---------- R12 §4：拒絕紀錄欄旁向同事詢問 ---------- */

describe('ArchiveWorkComponent 拒絕紀錄欄「這個欄位是什麼？」（R12 §4）', () => {
  const PACK = HELP_PACKS.find((h) => h.id === 'help.refusal-record');
  const REQUEST_ID = PACK?.request.id ?? '?';
  let game: GameStateService;
  let opened: string[];
  let nav: MessagesNavigationService;

  beforeEach(() => {
    localStorage.clear();
    opened = [];
    const desktop = { openApp: (app: string) => opened.push(app), isAppActive: () => false, isAppShown: () => false };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DesktopService, useValue: desktop }] });
    game = TestBed.inject(GameStateService);
    nav = TestBed.inject(MessagesNavigationService);
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  function el(fixture: ComponentFixture<ArchiveWorkComponent>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function selectKey(fixture: ComponentFixture<ArchiveWorkComponent>, key: RecordKey): void {
    const label = recordLabel(game.record(key));
    const button = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('app-archive-queue button')).find(
      (b) => b.querySelector('.truncate')?.textContent?.trim() === label,
    );
    if (!button) throw new Error(`找不到佇列項目 ${key}`);
    button.click();
    fixture.detectChanges();
  }

  function helpButton(fixture: ComponentFixture<ArchiveWorkComponent>): HTMLButtonElement | null {
    return el(fixture).querySelector<HTMLButtonElement>('fieldset legend [data-help-ask]');
  }

  /** 目前批次第一筆「適用拒絕紀錄但來源沒寫」的紀錄。 */
  function missingPolicyKey(): RecordKey {
    const r = game.records().find((x) => x.refusalApplies && x.refusal === null && !game.caseFor(x.key));
    if (!r) throw new Error('目前批次沒有缺拒絕紀錄的紀錄');
    return r.key;
  }

  it('內容：說明包與入口文字存在', () => {
    expect(PACK).toBeDefined();
    expect(helpUi(REQUEST_ID)?.ask).toBe(PACK?.ui.ask ?? '?');
  });

  it('入口在缺值處理欄的標題旁；不需要選擇處理方式的紀錄沒有入口', () => {
    const fixture = render();
    const key = missingPolicyKey();
    selectKey(fixture, key);
    expect(helpButton(fixture)?.textContent?.trim()).toBe(PACK?.ui.ask ?? '?');
    expect(helpButton(fixture)?.type).toBe('button');
    const other = game.records().find((r) => !(r.refusalApplies && r.refusal === null));
    if (other) {
      selectKey(fixture, other.key);
      expect(helpButton(fixture)).toBeNull();
    }
  });

  it('第一次點：保留草稿、送出提問一次、打開通訊並定位到自己的提問；之後文字改成「查看說明」', () => {
    const fixture = render();
    const key = missingPolicyKey();
    selectKey(fixture, key);
    const input = el(fixture).querySelector<HTMLInputElement>('#archive-input');
    if (!input) throw new Error('沒有輸入框');
    input.value = '0102';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const draft = game.draft(key);
    const events = game.save()?.events.length ?? 0;

    helpButton(fixture)?.click();
    fixture.detectChanges();

    expect(game.helpRequest(REQUEST_ID)?.dayId).toBe(game.dayId() ?? '?');
    expect(game.save()?.events.length).toBe(events + 1);
    expect(game.save()?.events.at(-1)?.payload).toEqual({ dayId: game.dayId(), requestId: REQUEST_ID });
    expect(opened).toEqual(['messages']);
    expect(nav.selectedId()).toBe(PACK?.request.channelId ?? '?');
    expect(nav.reveal()?.entryId).toBe(`${REQUEST_ID}:you`);
    // 草稿、輸入框與編號都不動；沒有對話框
    expect(game.draft(key)).toEqual(draft);
    expect(el(fixture).querySelector<HTMLInputElement>('#archive-input')?.value).toBe('0102');
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(helpButton(fixture)?.textContent?.trim()).toBe(PACK?.ui.revisit ?? '?');
  });

  it('再次點：只定位既有說明，不重送（提問與事件不變）', () => {
    const fixture = render();
    selectKey(fixture, missingPolicyKey());
    helpButton(fixture)?.click();
    fixture.detectChanges();
    const saved = game.helpRequest(REQUEST_ID);
    const events = game.save()?.events.length ?? 0;
    const firstSeq = nav.reveal()?.seq ?? 0;

    helpButton(fixture)?.click();
    fixture.detectChanges();
    expect(game.helpRequest(REQUEST_ID)).toEqual(saved);
    expect(game.save()?.events.length).toBe(events);
    expect(opened).toEqual(['messages', 'messages']);
    expect(nav.reveal()?.seq).toBeGreaterThan(firstSeq);
    expect(nav.reveal()?.entryId).toBe(`${REQUEST_ID}:you`);
  });

  it('已詢問狀態跨日與重新載入保存：Day 3 的入口直接是「查看說明」，點了也不重送', () => {
    const fixture = render();
    selectKey(fixture, missingPolicyKey());
    helpButton(fixture)?.click();
    fixture.detectChanges();
    fixture.destroy();
    while (game.dayId() !== 'day.03') finishDay(game);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: DesktopService, useValue: { openApp: () => undefined } }],
    });
    game = TestBed.inject(GameStateService);
    expect(game.helpRequest(REQUEST_ID)?.dayId).toBe('day.01');
    const again = render();
    selectKey(again, missingPolicyKey());
    expect(helpButton(again)?.textContent?.trim()).toBe(PACK?.ui.revisit ?? '?');
    const events = game.save()?.events.length ?? 0;
    helpButton(again)?.click();
    again.detectChanges();
    expect(game.save()?.events.length).toBe(events);
  });

  it('任何一天都能第一次詢問（Day 3 才問，提問日記為 Day 3）', () => {
    while (game.dayId() !== 'day.03') finishDay(game);
    const fixture = render();
    selectKey(fixture, missingPolicyKey());
    expect(helpButton(fixture)?.textContent?.trim()).toBe(PACK?.ui.ask ?? '?');
    helpButton(fixture)?.click();
    fixture.detectChanges();
    expect(game.helpRequest(REQUEST_ID)?.dayId).toBe('day.03');
  });
});
