import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { dayContentById, documentsOfTask } from '../../content/bundle';
import {
  HANDOFF_UI,
  MORNING_UI,
  DOCUMENT_ISSUES_UI,
  TASKS_UI,
  handoffItem,
  morningDocTitle,
  morningPending,
  pageTitle,
  taskKindLabel,
  totalTasks,
} from '../../content/text';
import { SettingsService } from '../../platform/settings.service';
import { GameStateService } from '../../state/game-state.service';
import { SAVE_KEY } from '../../state/save-repository';
import { ReviewDisposition, SAVE_VERSION } from '../../core/types';
import { archiveWith, completeTask, finishDay, finishTasks, reviewAll } from '../testing/play';
import { MorningComponent } from './morning/morning.component';
import { OvernightComponent } from './overnight/overnight.component';

/**
 * R8 §2：本日交接（/overnight）與次日收件（/morning）。
 * 逐項工作與「共 N 項工作」、跨日後的收件清單、重載一致、動態開關，以及 v6 舊檔免補的中性顯示。
 */

interface Harness {
  game: GameStateService;
  navigated: string[];
}

function boot(): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const navigated: string[] = [];
  spyOn(TestBed.inject(Router), 'navigateByUrl').and.callFake((url) => {
    navigated.push(String(url));
    return Promise.resolve(true);
  });
  return { game: TestBed.inject(GameStateService), navigated };
}

function render<T>(type: Type<T>): ComponentFixture<T> {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  return fixture;
}

function el(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function items(fixture: ComponentFixture<unknown>, attr: string): string[] {
  return Array.from(el(fixture).querySelectorAll(`[${attr}]`)).map((li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

function clickText(fixture: ComponentFixture<unknown>, text: string): void {
  const b = Array.from(el(fixture).querySelectorAll('button')).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`找不到按鈕「${text}」`);
  b.click();
  fixture.detectChanges();
}

/** 夜間與四格的秘密字樣不可出現在交接／收件頁。 */
function expectNoNightInfo(text: string): void {
  const report = documentsOfTask('task.day2.reconcile').find((d) => d.kind === 'report');
  if (report?.kind === 'report') {
    for (const s of [report.text.arranged, report.text.sourceOrigin.intervention, report.text.sourceOrigin.rules]) {
      expect(text).not.toContain(s);
    }
  }
  expect(text).not.toMatch(/\b(true|false|null)\b/);
  expect(text).not.toMatch(/task\.|batch\./);
}

describe('OvernightComponent（本日交接）', () => {
  let h: Harness;

  beforeEach(() => {
    localStorage.clear();
    h = boot();
    h.game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('Day 1：列出兩件歸檔、各自筆數與完成標記，「共 2 項工作」', () => {
    finishTasks(h.game);
    expect(h.game.stage()).toBe('wrap');
    const f = render(OvernightComponent);
    const rows = items(f, 'data-handoff-item');
    expect(rows.length).toBe(2);
    const tasks = h.game.dayTasks();
    tasks.forEach((t, i) => {
      expect(rows[i]).toContain(t.heading);
      expect(rows[i]).toContain(handoffItem(t.kind, t.processed));
      expect(rows[i]).toContain(HANDOFF_UI.doneMark);
    });
    expect(rows[0]).toContain('歸檔 3 筆');
    expect(el(f).querySelector('[data-handoff-total]')?.textContent?.trim()).toBe(totalTasks(2));
    expect(totalTasks(2)).toBe('共 2 項工作');
    expect(el(f).textContent).toContain(HANDOFF_UI.heading);
    expectNoNightInfo(el(f).textContent ?? '');
    expect(TestBed.inject(Title).getTitle()).toBe(pageTitle(dayContentById('day.01').transition.text.docTitle));
  });

  it('Day 2：核對與歸檔分列（不把來源筆數與歸檔筆數加總），共 2 項工作', () => {
    finishDay(h.game);
    finishTasks(h.game);
    const f = render(OvernightComponent);
    const rows = items(f, 'data-handoff-item');
    expect(rows[0]).toContain(handoffItem('reconcile', 2));
    expect(rows[1]).toContain(handoffItem('archive', 4));
    expect(el(f).querySelector('[data-handoff-total]')?.textContent?.trim()).toBe(totalTasks(2));
    expect(el(f).textContent).not.toContain('7');
    expectNoNightInfo(el(f).textContent ?? '');
  });

  it('「結束今日，查看明日收件」→ 次日收件 /morning', () => {
    finishTasks(h.game);
    const f = render(OvernightComponent);
    clickText(f, HANDOFF_UI.next);
    expect(h.game.stage()).toBe('morning');
    expect(h.game.dayId()).toBe('day.02');
    expect(h.navigated).toEqual(['/morning']);
  });
});

describe('MorningComponent（次日收件）', () => {
  let h: Harness;

  beforeEach(() => {
    localStorage.clear();
    h = boot();
    h.game.newGame();
    finishTasks(h.game);
    h.game.advanceDay();
    expect(h.game.stage()).toBe('morning');
  });

  afterEach(() => localStorage.clear());

  it('顯示新一日的問候與有序工作清單（種類、名稱、待處理數）', () => {
    const f = render(MorningComponent);
    expect(el(f).textContent).toContain(MORNING_UI.heading);
    expect(el(f).textContent).toContain(dayContentById('day.02').workbench.greeting);
    const rows = items(f, 'data-morning-item');
    const tasks = h.game.dayTasks();
    expect(rows.length).toBe(tasks.length);
    tasks.forEach((t, i) => {
      expect(rows[i]).toContain(taskKindLabel(t.kind));
      expect(rows[i]).toContain(t.heading);
      expect(rows[i]).toContain(morningPending(t.kind, t.total));
    });
    expect(rows[0]).toContain('待處理 2 筆');
    expect(rows[1]).toContain('待處理 4 筆');
    expectNoNightInfo(el(f).textContent ?? '');
    expect(TestBed.inject(Title).getTitle()).toBe(pageTitle(morningDocTitle(2)));
  });

  it('重新載入仍是次日收件；「開始今日工作」才進 /work', () => {
    h = boot();
    expect(h.game.stage()).toBe('morning');
    const f = render(MorningComponent);
    clickText(f, MORNING_UI.start);
    expect(h.game.stage()).toBe('work');
    expect(h.navigated).toEqual(['/work']);
  });

  it('動態開啟才有淡入／掃描線 class；關閉時直接顯示', () => {
    const settings = TestBed.inject(SettingsService);
    settings.setMotion(true);
    const on = render(MorningComponent);
    expect(el(on).classList.contains('kb-motion')).toBe(settings.animationsEnabled());
    settings.setMotion(false);
    on.detectChanges();
    expect(el(on).classList.contains('kb-motion')).toBeFalse();
    // 按鈕立即可用，沒有假等待
    expect(Array.from(el(on).querySelectorAll('button')).every((b) => !b.disabled)).toBeTrue();
  });
});

describe('v6 舊檔（Day 2 已交接）遷移後的本日交接', () => {
  afterEach(() => localStorage.clear());

  it('本輪新增而舊檔沒做的工作顯示中性的「不適用」，不宣稱已完成；可繼續到 Day 3 收件', () => {
    localStorage.clear();
    let h = boot();
    h.game.newGame();
    expect(completeTask(h.game)).toBeTrue();
    const s = h.game.save()!;
    const v6 = {
      version: 6,
      seed: s.seed,
      dayId: 'day.02',
      stage: 'wrap',
      taskId: 'task.day2.reconcile',
      batches: { 'batch.day01.archive': s.batches['batch.day01.archive'] },
      taskProgress: { 'task.day2.reconcile': { kind: 'reconcile', reportOpened: true, receiptOpened: true, reply: 'ack' } },
      chatReplies: {},
      night: { intervention: false, smallTalkVariant: 0, reportRevision: 1 },
      events: [],
      readMessages: [],
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(v6));
    h = boot();
    expect(h.game.save()?.version).toBe(SAVE_VERSION);
    expect(h.game.stage()).toBe('wrap');

    const f = render(OvernightComponent);
    const rows = items(f, 'data-handoff-item');
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain(handoffItem('reconcile', 2));
    expect(rows[0]).toContain(HANDOFF_UI.doneMark);
    expect(rows[1]).toContain(TASKS_UI.statusWaived);
    expect(rows[1]).not.toContain(HANDOFF_UI.doneMark);
    expect(rows[1]).not.toContain(TASKS_UI.statusDone);
    expect(rows[1]).not.toContain(handoffItem('archive', 4));

    clickText(f, HANDOFF_UI.next);
    expect(h.game.dayId()).toBe('day.03');
    expect(h.game.stage()).toBe('morning');
  });
});

describe('錯誤文件處理（R10／R11）在次日收件與本日交接的顯示', () => {
  afterEach(() => localStorage.clear());

  /** Day 1 依 codes 輸入 → Day 2 逐筆審查給 disposition → 玩到 Day 4 收件（stage morning）。 */
  function toDay4Morning(codes: Record<string, string>, disposition: ReviewDisposition): Harness {
    localStorage.clear();
    const h = boot();
    h.game.newGame();
    archiveWith(h.game, codes);
    expect(h.game.completeWork()).toBeTrue();
    finishDay(h.game);
    expect(h.game.task()?.kind).toBe('reconcile');
    h.game.openReport();
    reviewAll(h.game, disposition);
    expect(h.game.submitReply('ack')).toBeTrue();
    finishDay(h.game);
    expect(h.game.dayId()).toBe('day.03');
    finishTasks(h.game);
    h.game.advanceDay();
    expect(h.game.dayId()).toBe('day.04');
    expect(h.game.stage()).toBe('morning');
    return h;
  }

  it('錯字串＋明確放行：Day 4 收件列出「錯誤文件處理」一項（待處理 1 筆）；交付後本日交接顯示「複審 1 筆」', () => {
    const h = toDay4Morning({ B102: '102' }, 'release');
    const f = render(MorningComponent);
    const rows = items(f, 'data-morning-item');
    expect(rows.length).toBe(2);
    expect(rows[1]).toContain(taskKindLabel('return-review'));
    expect(rows[1]).toContain(DOCUMENT_ISSUES_UI.taskHeading);
    expect(rows[1]).toContain(morningPending('return-review', 1));
    expectNoNightInfo(el(f).textContent ?? '');

    h.game.startDay();
    finishTasks(h.game);
    expect(h.game.stage()).toBe('wrap');
    const w = render(OvernightComponent);
    const handoff = items(w, 'data-handoff-item');
    expect(handoff.length).toBe(2);
    expect(handoff[1]).toContain(handoffItem('return-review', 1));
    expect(handoff[1]).toContain(HANDOFF_UI.doneMark);
    expect(el(w).querySelector('[data-handoff-total]')?.textContent?.trim()).toBe(totalTasks(2));
  });

  for (const [label, codes, disposition] of [
    ['正確編號＋放行', {}, 'release'],
    ['錯字串＋保留待查', { B102: '102' }, 'hold'],
  ] as const) {
    it(`${label}：沒有退件，Day 4 不出現空的複審工作`, () => {
      const h = toDay4Morning(codes, disposition);
      expect(h.game.returns().length).toBe(0);
      const f = render(MorningComponent);
      const rows = items(f, 'data-morning-item');
      expect(rows.length).toBe(1);
      expect(el(f).textContent).not.toContain(DOCUMENT_ISSUES_UI.taskHeading);
    });
  }
});
