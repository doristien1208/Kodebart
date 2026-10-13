import { Signal, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  ALL_CASE_REVIEWS,
  ALL_MESSAGES,
  ALL_PROMPTS,
  CONTENT,
  LEGACY_PLAYER_NAME,
  ReplyPromptEntry,
  chatDateLabel,
  dayOrder,
  helpRequestOfMessage,
  messagesOfChannel,
  unlockedMessages,
} from '../../../content/bundle';
import { MissingPolicy, SAVE_VERSION } from '../../../core/types';
import { GameClock } from '../../../state/game-clock';
import { GameStateService } from '../../../state/game-state.service';
import { APP_WINDOW_IDS, DesktopAppId, DesktopService } from '../../desktop/services/desktop.service';
import { WindowManagerService } from '../../shared/services/window-manager.service';
import { MessageUnreadService } from '../services/message-unread.service';
import { MessagesNavigationService } from '../services/messages-navigation.service';
import { MessagesComponent } from './messages.component';
import { archiveFirst, finishTasks, finishDay as finishDayWith, playTo as playToWith } from '../../testing/play';
import { SAVE_KEY } from '../../../state/save-repository';

/**
 * KB-R4-04 第 4～9 點與 KB-R5-01 的整合驗證：正式內容 ＋ 真實存檔 ＋ 完整流程。
 *
 * 涵蓋：只進通訊不清未讀、對話列實際可見且通訊視窗作用中才記為已讀、只影響該頻道、重新載入後已讀保留、
 * 進到第二天只有新解鎖的訊息讓紅點重新出現、Day 2 對話串含 Day 1 歷史且順序正確、
 * 夜間閒聊只顯示已保存的 variant、徽章為圓形、無存檔時零解鎖，
 * 以及查看訊息不動 night／dayId／stage／事件。
 * R7：日期分隔讀 chatDateLabel、header、固定回覆（回答／不回覆／重載／過期／重複點擊）、
 * Day 3 午餐選擇只解鎖對應的 Day 4 私訊、玩家畫面沒有 DAY／第 N 天或 true／false／null。
 * R12 §2：回覆依保存的送達時間出現、送達後切走仍亮紅點、視窗不作用中不標已讀、重整不重抽、
 * 舊回覆是已讀歷史、停在歷史上方不強制捲動；§4：提問區塊在提問日、實際時間、說明送達後才出現追問。
 * Day 2 以後的狀態一律用 GameStateService 走完整流程取得，不手刻存檔。
 *
 * 桌面（DesktopService）以假物件代替：active 表示「通訊視窗顯示中、在最上層、頁籤可見且有焦點」；
 * 真實視窗管理的最小化／關閉／其他應用在前另有一組測試。
 */

const DM = 'channel.dm.lin-yuan';
const FIRST_DAY_ID = 'day.01';
const SECOND_DAY_ID = 'day.02';

/** 假桌面：只回答通訊應用是否作用中，並記錄 openApp。 */
class FakeDesktop {
  readonly active = signal(true);
  readonly pageActive: Signal<boolean> = computed(() => this.active());
  readonly opened: DesktopAppId[] = [];
  isAppActive(app: DesktopAppId): boolean {
    return app === 'messages' && this.active();
  }
  isAppShown(app: DesktopAppId): boolean {
    return app === 'messages' && this.active();
  }
  openApp(app: DesktopAppId): void {
    this.opened.push(app);
  }
  flushPending(): void {
    /* 假物件：沒有視窗要開 */
  }
}

interface Harness {
  game: GameStateService;
  unread: MessageUnreadService;
}

let desktop: FakeDesktop;

/** service 在建構時讀 localStorage，所以每次都要重建 injector（假桌面沿用同一個狀態）。 */
function boot(): Harness {
  TestBed.resetTestingModule();
  desktop = new FakeDesktop();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: DesktopService, useValue: desktop }],
  });
  return { game: TestBed.inject(GameStateService), unread: TestBed.inject(MessageUnreadService) };
}

/**
 * 掛上通訊應用；height 是通訊視窗內容區的高度（預設夠高，對話列全部可見）。
 * 寬度固定為兩欄版面。
 */
function openPage(height = 4000): ComponentFixture<MessagesComponent> {
  const fixture = TestBed.createComponent(MessagesComponent);
  const host = fixture.nativeElement as HTMLElement;
  host.style.width = '960px';
  host.style.height = `${height}px`;
  fixture.detectChanges();
  return fixture;
}

/** 等 IntersectionObserver／ResizeObserver 回報（下一次繪製之後），每一輪都跑一次變更偵測。 */
async function settleView(fixture: ComponentFixture<MessagesComponent>, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    fixture.detectChanges();
  }
}

/** 點選頻道（只看畫面，不等已讀）。 */
function clickChannel(fixture: ComponentFixture<MessagesComponent>, channelId: string): void {
  const el = fixture.nativeElement as HTMLElement;
  const button = el.querySelector<HTMLButtonElement>(`[data-channel-id="${channelId}"]`);
  if (button === null) throw new Error(`找不到頻道 ${channelId} 的按鈕`);
  button.click();
  fixture.detectChanges();
}

/** 點選頻道並等對話列回報可見（通訊作用中時會記為已讀）。 */
async function openChannel(fixture: ComponentFixture<MessagesComponent>, channelId: string): Promise<void> {
  clickChannel(fixture, channelId);
  await settleView(fixture);
}

/** 完整流程：完成 Day 1 全部工作 → 本日交接 → 次日收件 → 開始第二天工作。 */
function playToDay2(game: GameStateService, policy: MissingPolicy = 'default_false'): void {
  expect(game.dayId()).toBe(FIRST_DAY_ID);
  finishTasks(game, policy);
  expect(game.stage()).toBe('wrap');
  game.advanceDay();
  expect(game.stage()).toBe('morning');
  game.startDay();
  expect(game.dayId()).toBe(SECOND_DAY_ID);
  expect(game.stage()).toBe('work');
  expect(game.night()).not.toBeNull();
}

/** 完成目前這一天的全部工作並開始下一天；archive 所有缺值都用同一個處理方式。 */
function finishDay(game: GameStateService, policy: MissingPolicy = 'default_false'): void {
  finishTasks(game, policy);
  expect(game.stage()).toBe('wrap');
  game.advanceDay();
  expect(game.stage()).toBe('morning');
  game.startDay();
  expect(game.stage()).toBe('work');
}

/** 從 Day 1 玩到指定日；day3Policy 決定 Day 3 批次的缺值處理（影響 Day 4 互斥訊息）。 */
function playTo(game: GameStateService, dayId: string, day3Policy: MissingPolicy = 'default_false'): void {
  while (game.dayId() !== dayId) {
    finishDay(game, game.dayId() === 'day.03' ? day3Policy : 'default_false');
  }
}

/** 玩到 Day 3 並歸檔 2 筆：午餐群組四則訊息的解鎖條件（R8 §4 unlockAfter）。 */
function playToDay3Lunch(game: GameStateService): void {
  playTo(game, 'day.03');
  archiveFirst(game, 2);
}

/** 目前狀態下該頻道已解鎖的訊息 ID；期望值一律由內容檔推導，不寫死。 */
function unlockedIds(game: GameStateService, channelId = DM): readonly string[] {
  const ctx = game.conditionContext();
  return ctx === null ? [] : unlockedMessages(channelId, ctx).map((m) => m.id);
}

function root(fixture: ComponentFixture<MessagesComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/** 對話區實際顯示的訊息列 id（DOM 順序）。 */
function threadIds(fixture: ComponentFixture<MessagesComponent>): string[] {
  return Array.from(root(fixture).querySelectorAll('app-message-thread [data-message-id]')).map(
    (m) => m.getAttribute('data-message-id') ?? '',
  );
}

/** 對話區每一列的文字（DOM 順序）。 */
function threadTexts(fixture: ComponentFixture<MessagesComponent>): string[] {
  return Array.from(root(fixture).querySelectorAll('app-message-thread [data-message-id]')).map(
    (m) => m.textContent?.trim() ?? '',
  );
}

function dayLabels(fixture: ComponentFixture<MessagesComponent>): string[] {
  return Array.from(root(fixture).querySelectorAll('app-message-thread [data-date-label]')).map(
    (p) => p.getAttribute('data-date-label') ?? '',
  );
}

describe('MessagesComponent 未讀與已讀', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('Day 1 一開始就有未讀，數量＝已解鎖訊息數', () => {
    const expected = unlockedIds(game);
    expect(expected.length).toBeGreaterThan(0);
    expect(unread.total()).toBe(expected.length);
  });

  it('只進訊息頁、不點開頻道時不會清空未讀', () => {
    const before = unread.total();
    openPage();
    expect(unread.total()).toBe(before);
    expect(game.save()?.readMessages).toEqual([]);
  });

  it('打開頻道、對話列實際可見且通訊作用中，該頻道的已解鎖訊息才記為已讀，紅點消失', async () => {
    const fixture = openPage();
    await openChannel(fixture, DM);

    expect(game.save()?.readMessages).toEqual([...unlockedIds(game)]);
    expect(unread.channel(DM)?.unreadIds).toEqual([]);
    expect(unread.total()).toBe(0);
  });

  it('已讀只含被打開頻道的訊息，不會波及其他頻道', async () => {
    const fixture = openPage();
    await openChannel(fixture, DM);

    const read = game.save()?.readMessages ?? [];
    for (const channel of CONTENT.channels) {
      if (channel.id === DM) continue;
      for (const id of unlockedIds(game, channel.id)) expect(read).not.toContain(id);
    }
    for (const id of read) expect(unlockedIds(game, DM)).toContain(id);
  });

  it('查看訊息不改 night、dayId、stage 與事件數量', async () => {
    const dayId = game.dayId();
    const stage = game.stage();
    const night = game.night();
    const events = game.save()?.events.length ?? 0;

    const fixture = openPage();
    await openChannel(fixture, DM);

    expect(game.dayId()).toBe(dayId);
    expect(game.stage()).toBe(stage);
    expect(game.night()).toEqual(night);
    expect(game.save()?.events.length).toBe(events);
  });

  it('已讀狀態在重新載入後保留', async () => {
    await openChannel(openPage(), DM);
    const read = game.save()?.readMessages ?? [];
    expect(read.length).toBeGreaterThan(0);

    // 重新載入：新的 injector 從 localStorage 讀回同一份存檔
    ({ game, unread } = boot());
    expect(game.save()?.readMessages).toEqual([...read]);
    expect(unread.total()).toBe(0);
    openPage();
    expect(unread.total()).toBe(0);
  });

  it('進到第二天後只有新解鎖的訊息讓紅點重新出現；Day 1 已讀的不會重新亮', async () => {
    await openChannel(openPage(), DM);
    const readOnDay1 = game.save()?.readMessages ?? [];
    expect(unread.total()).toBe(0);

    playToDay2(game);

    const day2Unlocked = unlockedIds(game);
    const expected = day2Unlocked.filter((id) => !readOnDay1.includes(id));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(day2Unlocked.length);
    expect(unread.channel(DM)?.unreadIds).toEqual([...expected]);
    for (const id of readOnDay1) expect(unread.channel(DM)?.unreadIds).not.toContain(id);
    expect(unread.total()).toBe(expected.length);

    // 再打開一次才會清掉；第一天已讀的訊息不會被重複加入
    await openChannel(openPage(), DM);
    expect(unread.total()).toBe(0);
    const finalRead = game.save()?.readMessages ?? [];
    expect(new Set(finalRead).size).toBe(finalRead.length);
    expect(finalRead.length).toBe(day2Unlocked.length);
  });

  it('通訊不作用中（最小化／關閉／其他應用在前／頁籤在背景）：打開頻道也不標已讀；恢復作用中時標記當下可見的列', async () => {
    desktop.active.set(false);
    const fixture = openPage();
    await openChannel(fixture, DM);
    expect(threadIds(fixture).length).toBeGreaterThan(0);
    expect(game.save()?.readMessages).toEqual([]);
    expect(unread.total()).toBe(unlockedIds(game).length);

    desktop.active.set(true);
    await settleView(fixture);
    expect(game.save()?.readMessages).toEqual([...unlockedIds(game)]);
    expect(unread.total()).toBe(0);
  });

  it('只有選取（selectedId）而沒有實際呈現對話時不標已讀', async () => {
    TestBed.inject(MessagesNavigationService).select(DM);
    await Promise.resolve();
    expect(unread.total()).toBe(unlockedIds(game).length);
    expect(game.save()?.readMessages).toEqual([]);
  });

  it('對話捲動區看不到的列不標已讀：捲到該列才記', async () => {
    playToDay2(game);
    const fixture = openPage(260);
    await openChannel(fixture, DM);
    const readNow = game.save()?.readMessages ?? [];
    const all = unlockedIds(game);
    expect(readNow.length).toBeGreaterThan(0);
    expect(readNow.length).toBeLessThan(all.length);

    const scroller = root(fixture).querySelector<HTMLElement>('[data-thread-scroller]');
    if (!scroller) throw new Error('沒有對話捲動區');
    // 逐段往下捲（每次半個捲動區），每段都等可見回報
    while (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1) {
      scroller.scrollTop += Math.max(20, Math.floor(scroller.clientHeight / 2));
      scroller.dispatchEvent(new Event('scroll'));
      await settleView(fixture, 2);
    }
    expect(new Set(game.save()?.readMessages)).toEqual(new Set(all));
  });

  it('頻道欄最上方是通訊軟體名稱；三種分類都會列出，沒有頻道的分類顯示中性空狀態', () => {
    const el = openPage().nativeElement as HTMLElement;
    const ui = CONTENT.ui.messages;
    expect(el.querySelector('app-channel-list h3')?.textContent?.trim()).toBe(ui.workspace);
    const headings = Array.from(el.querySelectorAll('app-channel-list h4')).map((h) => h.textContent?.trim());
    for (const kind of ['department', 'group', 'direct'] as const) {
      expect(headings).toContain(ui.sectionTitle[kind]);
    }
    expect(el.textContent).toContain(ui.sectionEmpty);
    expect(el.querySelectorAll(`[data-channel-id="${DM}"]`).length).toBe(1);
  });
});

describe('MessagesComponent 跨日歷史與對話串（KB-R5-01）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('Day 2 開啟私訊會同時看到 Day 1 舊訊息與 Day 2 新訊息，先日序再內容順序', () => {
    playToDay2(game);
    const fixture = openPage();
    clickChannel(fixture, DM);

    const shown = unread.channel(DM)?.unlocked ?? [];
    const day1 = shown.filter((m) => m.visibleFrom === FIRST_DAY_ID);
    const day2 = shown.filter((m) => m.visibleFrom === SECOND_DAY_ID);
    expect(day1.length).toBe(2);
    expect(day2.length).toBe(3);
    expect(shown.length).toBe(5);

    // 順序：Day 1 全部在前，之後才是 Day 2；同一日依內容檔順序
    const orders = shown.map((m) => dayOrder(m.visibleFrom));
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    const fileOrder = messagesOfChannel(DM).map((m) => m.id);
    const shownIdx = shown.map((m) => fileOrder.indexOf(m.id));
    expect(shownIdx).toEqual([...shownIdx].sort((a, b) => a - b));

    // 畫面：沒有回覆時訊息列就是這些內容訊息，順序相同
    expect(threadIds(fixture)).toEqual(shown.map((m) => m.id));
    const rendered = threadTexts(fixture);
    expect(rendered[0]).toContain(shown[0]?.lines[0] ?? '');
    expect(rendered[4]).toContain(shown[4]?.lines[0] ?? '');
  });

  it('對話串每一天的第一則前有日期分隔，文字是每日 chatDateLabel', () => {
    playToDay2(game);
    const fixture = openPage();
    clickChannel(fixture, DM);
    expect(dayLabels(fixture)).toEqual([chatDateLabel(FIRST_DAY_ID), chatDateLabel(SECOND_DAY_ID)]);
    expect(dayLabels(fixture)).toEqual(['9 月 15 日', '9 月 16 日']);
  });

  it('Day 1 的對話串只有一個日期分隔', () => {
    const fixture = openPage();
    clickChannel(fixture, DM);
    expect(dayLabels(fixture)).toEqual([chatDateLabel(FIRST_DAY_ID)]);
  });

  it('夜間閒聊只顯示已保存的 variant，不會兩個版本同時出現', () => {
    playToDay2(game);
    const variant = game.night()?.smallTalkVariant;
    expect(variant).toBeDefined();

    const shown = unread.channel(DM)?.unlocked ?? [];
    const smallTalk = shown.filter((m) => m.variant?.key === 'night.smallTalkVariant');
    expect(smallTalk.length).toBe(1);
    expect(smallTalk[0]?.variant?.value).toBe(variant);

    // 內容檔裡兩個版本都存在，只是未解鎖的那個不會出現
    const all = messagesOfChannel(DM).filter((m) => m.variant?.key === 'night.smallTalkVariant');
    expect(all.length).toBe(2);
  });

  it('Day 2 打開私訊後 readMessages＝已解鎖內容訊息數，events 數量與 night 不變', async () => {
    playToDay2(game);
    const events = game.save()?.events.length ?? 0;
    const night = game.night();

    const fixture = openPage();
    await openChannel(fixture, DM);

    expect(game.save()?.readMessages.length).toBe(unlockedIds(game).length);
    expect(game.save()?.events.length).toBe(events);
    expect(game.night()).toEqual(night);
    expect(game.dayId()).toBe(SECOND_DAY_ID);
    expect(game.stage()).toBe('work');
  });
});

describe('UnreadBadge 與無存檔狀態', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('沒有存檔時沒有任何已解鎖訊息，彙總未讀為 0', () => {
    localStorage.clear();
    const { game, unread } = boot();
    expect(game.hasSave()).toBeFalse();
    expect(unread.channels().every((c) => c.unlocked.length === 0)).toBeTrue();
    expect(unread.total()).toBe(0);
  });

  it('紅點是圓形：可見數字、sr-only 文字與 aria-hidden 色塊，class 含 rounded-[9999px]', () => {
    localStorage.clear();
    const { game } = boot();
    game.newGame();
    const el = openPage().nativeElement as HTMLElement;

    const badge = el.querySelector<HTMLElement>(`[data-channel-id="${DM}"] app-unread-badge [aria-hidden="true"]`);
    expect(badge).not.toBeNull();
    expect(badge?.classList.contains('rounded-[9999px]')).toBeTrue();
    expect(badge?.textContent?.trim()).toBe('2');

    const srOnly = el.querySelector(`[data-channel-id="${DM}"] app-unread-badge .sr-only`);
    expect(srOnly?.textContent).toContain('2');
  });
});

const DEPT = 'channel.department.data-ops';
const LUNCH = 'channel.group.lunch-chat';
const REVIEW_ANY = 'msg.day4.review-returned';
const REVIEW_NONE = 'msg.day4.quick-praise';

function listedChannelIds(fixture: ComponentFixture<MessagesComponent>): string[] {
  const el = fixture.nativeElement as HTMLElement;
  return Array.from(el.querySelectorAll('[data-channel-id]')).map((b) => b.getAttribute('data-channel-id') ?? '');
}

describe('MessagesComponent Day 3–6 頻道、紅點與互斥訊息（R6 §5）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('Day 1 只列出私訊；部門頻道與群組要等到第一則訊息解鎖才出現', () => {
    expect(listedChannelIds(openPage())).toEqual([DM]);
  });

  it('Day 3 部門頻道、群組與私訊都有紅點；只進訊息頁不清除', async () => {
    await openChannel(openPage(), DM);
    playToDay3Lunch(game);

    const fixture = openPage();
    expect(listedChannelIds(fixture)).toEqual([DEPT, LUNCH, DM]);
    for (const id of [DEPT, LUNCH]) {
      expect(unread.channel(id)?.unreadIds).toEqual([...unlockedIds(game, id)]);
      expect(unread.channel(id)?.unreadIds.length).toBeGreaterThan(0);
      const badge = (fixture.nativeElement as HTMLElement).querySelector(
        `[data-channel-id="${id}"] app-unread-badge [aria-hidden="true"]`,
      );
      expect(badge?.textContent?.trim()).toBe(String(unlockedIds(game, id).length));
    }
    expect(unread.channel(DM)?.unreadIds.length).toBeGreaterThan(0);
    expect(game.save()?.readMessages.some((id) => unlockedIds(game, LUNCH).includes(id))).toBeFalse();
  });

  it('Day 3 選群組只清群組的紅點，其他頻道維持；列表與對話順序不因已讀改變', async () => {
    playToDay3Lunch(game);
    const fixture = openPage();
    const orderBefore = listedChannelIds(fixture);
    const deptBefore = unread.channel(DEPT)?.unreadIds ?? [];

    await openChannel(fixture, LUNCH);
    expect(unread.channel(LUNCH)?.unreadIds).toEqual([]);
    expect(unread.channel(DEPT)?.unreadIds).toEqual([...deptBefore]);
    expect(listedChannelIds(fixture)).toEqual(orderBefore);
    const threadBefore = threadTexts(fixture);

    await openChannel(fixture, DEPT);
    await openChannel(fixture, LUNCH);
    expect(threadTexts(fixture)).toEqual(threadBefore);
    expect(listedChannelIds(fixture)).toEqual(orderBefore);
  });

  it('Day 3 有送覆核 → Day 4 群組只出現「排回來」那則', () => {
    playTo(game, 'day.04', 'request_review');
    expect(game.hasReview('batch.day03.archive')).toBeTrue();
    const ids = unread.channel(LUNCH)?.unlocked.map((m) => m.id) ?? [];
    expect(ids).toContain(REVIEW_ANY);
    expect(ids).not.toContain(REVIEW_NONE);
  });

  it('Day 3 沒有送覆核 → Day 4 群組只出現「結得很快」那則', () => {
    playTo(game, 'day.04', 'default_false');
    expect(game.hasReview('batch.day03.archive')).toBeFalse();
    const ids = unread.channel(LUNCH)?.unlocked.map((m) => m.id) ?? [];
    expect(ids).toContain(REVIEW_NONE);
    expect(ids).not.toContain(REVIEW_ANY);
  });

  it('Day 4 群組對話串保留 Day 3 歷史並分日，同一日內依內容順序', () => {
    playTo(game, 'day.04');
    const fixture = openPage();
    clickChannel(fixture, LUNCH);
    expect(dayLabels(fixture)).toEqual([chatDateLabel('day.03'), chatDateLabel('day.04')]);
    const shown = unread.channel(LUNCH)?.unlocked ?? [];
    expect(shown.map((m) => m.visibleFrom)).toEqual([...shown.map((m) => m.visibleFrom)].sort());
    expect(threadIds(fixture)).toEqual(shown.map((m) => m.id));
  });
});

/* ---------- R7：header、固定回覆、條件解鎖與玩家可見文字 ---------- */

const WU_DM = 'channel.dm.wu-wan-ting';
const DAY4_WU = {
  join: 'msg.day4.dm-lunch-join',
  'ask-floor': 'msg.day4.dm-lunch-floor',
  'brought-own': 'msg.day4.dm-lunch-own',
} as const;

/** 某 prompt 在正式內容中的 anchor 與 choices。 */
function promptEntry(promptId: string): ReplyPromptEntry {
  const e = ALL_PROMPTS.find((p) => p.prompt.id === promptId);
  if (!e) throw new Error(`找不到 ${promptId}`);
  return e;
}

/** 回覆區目前顯示的 prompt ID；沒有回覆區為 null。 */
function quickReplyPrompt(fixture: ComponentFixture<MessagesComponent>): string | null {
  return root(fixture).querySelector('app-quick-reply [data-prompt-id]')?.getAttribute('data-prompt-id') ?? null;
}

function clickChoice(fixture: ComponentFixture<MessagesComponent>, choiceId: string): void {
  const b = root(fixture).querySelector<HTMLButtonElement>(`app-quick-reply [data-choice-id="${choiceId}"]`);
  if (!b) throw new Error(`找不到選項 ${choiceId}`);
  b.click();
  fixture.detectChanges();
}

function clickSkip(fixture: ComponentFixture<MessagesComponent>): void {
  const b = root(fixture).querySelector<HTMLButtonElement>('app-quick-reply [data-skip-reply]');
  if (!b) throw new Error('找不到「不回覆」');
  b.click();
  fixture.detectChanges();
}

/**
 * 每個每日 prompt 所在日、需要的 Day 3 處理方式（Day 4 review.any／none 互斥）。
 * 說明包的 prompt（anchor 要先提問、送達）另有專門的測試。
 */
const PROMPT_CASES = ALL_PROMPTS.filter((e) => helpRequestOfMessage(e.anchor.id) === undefined).map((e) => ({
  promptId: e.prompt.id,
  dayId: e.anchor.visibleFrom,
  channelId: e.anchor.channelId,
  day3Policy: (e.prompt.id === 'prompt.day4.review-returned' ? 'request_review' : 'default_false') as MissingPolicy,
}));

describe('MessagesComponent header 與外觀（R7 §2.2／§2.3）', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    ({ game } = boot());
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('部門頻道 header：# 名稱、topic 與成員數（參與者＋玩家）', () => {
    playTo(game, 'day.03');
    const fixture = openPage();
    clickChannel(fixture, DEPT);
    const channel = CONTENT.channels.find((c) => c.id === DEPT);
    const header = root(fixture).querySelector('app-message-thread header');
    expect(header?.querySelector('h3')?.textContent).toContain('#');
    expect(header?.querySelector('h3')?.textContent).toContain(channel?.title ?? '?');
    expect(header?.querySelector('[data-thread-topic]')?.textContent?.trim()).toBe(channel?.topic ?? '?');
    expect(header?.querySelector('[data-thread-members]')?.textContent?.trim()).toBe(
      CONTENT.ui.messages.memberCountTemplate.replace('{count}', String((channel?.actorIds.length ?? 0) + 1)),
    );
  });

  it('私訊 header：首字頭像、姓名與「在線」；窄螢幕有返回列表按鈕', () => {
    const fixture = openPage();
    clickChannel(fixture, DM);
    const header = root(fixture).querySelector('app-message-thread header');
    const name = CONTENT.actors.find((a) => a.id === 'actor.lin-yuan')?.displayName ?? '?';
    expect(header?.querySelector('h3')?.textContent?.trim()).toBe(name);
    expect(header?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe(name.charAt(0));
    expect(header?.querySelector('[data-thread-status]')?.textContent?.trim()).toBe(CONTENT.ui.messages.online);
    const back = Array.from(header?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim() === CONTENT.ui.messages.backToList,
    );
    expect(back).toBeDefined();
  });

  it('頻道列表顯示最後一則可見訊息摘要與時間；選中項目有 aria-current', () => {
    const fixture = openPage();
    const last = unlockedMessages(DM, game.conditionContext()!).at(-1);
    const item = root(fixture).querySelector(`[data-channel-id="${DM}"]`);
    expect(item?.querySelector('[data-channel-preview]')?.textContent?.trim()).toBe(last?.lines.at(-1) ?? '?');
    expect(item?.textContent).toContain(last?.time ?? '?');
    clickChannel(fixture, DM);
    expect(root(fixture).querySelector(`[data-channel-id="${DM}"]`)?.getAttribute('aria-current')).toBe('true');
  });

  it('同作者五分鐘內連續發言合併：第二則不重複姓名', () => {
    const fixture = openPage();
    clickChannel(fixture, DM);
    const rows = Array.from(root(fixture).querySelectorAll('app-message-thread [data-message-id]'));
    expect(rows.length).toBe(2);
    expect(rows[0]?.hasAttribute('data-continued')).toBeFalse();
    expect(rows[1]?.getAttribute('data-continued')).toBe('true');
    expect(rows[1]?.querySelector('[data-author]')).toBeNull();
  });

  it('Day 1–6 訊息頁都沒有 DAY／0N、第 N 天、true／false／null 或原始 JSON', () => {
    for (const dayId of ['day.01', 'day.02', 'day.03', 'day.04', 'day.05', 'day.06']) {
      playTo(game, dayId);
      const fixture = openPage();
      for (const c of CONTENT.channels) {
        if (!root(fixture).querySelector(`[data-channel-id="${c.id}"]`)) continue;
        clickChannel(fixture, c.id);
        const text = root(fixture).textContent ?? '';
        expect(text).withContext(`${dayId} ${c.id}`).not.toMatch(/DAY\s*\/\s*\d/);
        // 台詞本身可以提到「第一天」；介面文字（header、分隔、作者、時間、列表標題）不得出現日別標籤
        const chrome = root(fixture).cloneNode(true) as HTMLElement;
        chrome.querySelectorAll('[data-line], [data-channel-preview]').forEach((n) => n.remove());
        expect(chrome.textContent).withContext(`${dayId} ${c.id}`).not.toMatch(/第\s*[0-9０-９一二三四五六七八九十]+\s*[天日]/);
        for (const label of dayLabels(fixture)) expect(label).toMatch(/^\d+ 月 \d+ 日$/);
        expect(text).withContext(`${dayId} ${c.id}`).not.toMatch(/\b(true|false|null)\b/);
        expect(text).withContext(`${dayId} ${c.id}`).not.toContain('{"');
      }
      fixture.destroy();
    }
  });
});

describe('MessagesComponent 固定回覆（R7 §2.4）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('正式內容 Day 1–6 每天各有 prompt', () => {
    expect(PROMPT_CASES.map((c) => c.dayId).sort()).toEqual(
      jasmine.arrayContaining(['day.01', 'day.02', 'day.03', 'day.04', 'day.05', 'day.06']),
    );
  });

  for (const c of PROMPT_CASES) {
    const entry = promptEntry(c.promptId);

    it(`${c.promptId}：回答 → 玩家列與 responses 緊接 anchor，回覆區消失，未讀不變；重載保留；重複點擊無效`, () => {
      playTo(game, c.dayId, c.day3Policy);
      if (c.dayId === 'day.03') archiveFirst(game, 2, c.day3Policy);
      const fixture = openPage();
      clickChannel(fixture, c.channelId);
      expect(quickReplyPrompt(fixture)).toBe(c.promptId);
      const totalBefore = unread.total();
      const eventsBefore = game.save()?.events.length ?? 0;
      const choice = entry.prompt.choices[entry.prompt.choices.length - 1];
      if (!choice) throw new Error('沒有選項');

      // 選項與「不回覆」都是原生 button（可鍵盤操作），沒有輸入框
      const buttons = Array.from(root(fixture).querySelectorAll('app-quick-reply button'));
      expect(buttons.length).toBe(entry.prompt.choices.length + 1);
      expect(root(fixture).querySelector('app-quick-reply input, app-quick-reply textarea')).toBeNull();

      // 送達時間：固定亂數＝最短 3 秒（回答當下保存），並用假時鐘推進
      TestBed.inject(GameClock).random = () => 0;
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 8, 17, 11, 45));
      let ids: string[];
      try {
        clickChoice(fixture, choice.id);

        expect(quickReplyPrompt(fixture)).toBeNull();
        expect(unread.total()).toBe(totalBefore);
        // 存檔當下已含完整回應與逐則送達時間；畫面上依送達時間逐則出現，每則前先顯示「正在輸入」
        expect(game.chatReply(c.promptId)).toEqual(jasmine.objectContaining({ kind: 'answered', choiceId: choice.id }));
        const expected = [`${c.promptId}:you`, ...choice.responses.map((r) => r.id)];
        const shownAfterAnchor = (): string[] => {
          const now = threadIds(fixture);
          const at = now.indexOf(entry.anchor.id);
          return now.slice(at + 1).filter((id) => expected.includes(id));
        };
        for (let i = 0; i < choice.responses.length; i++) {
          const next = choice.responses[i];
          if (!next) throw new Error('沒有回應');
          expect(shownAfterAnchor()).toEqual(expected.slice(0, i + 1));
          const typing = root(fixture).querySelector(`[data-typing="${c.promptId}"]`);
          expect(typing?.textContent).toContain(CONTENT.actors.find((a) => a.id === next.actorId)?.displayName ?? '?');
          jasmine.clock().tick(2999);
          fixture.detectChanges();
          expect(shownAfterAnchor()).toEqual(expected.slice(0, i + 1));
          jasmine.clock().tick(1);
          fixture.detectChanges();
          expect(shownAfterAnchor()).toEqual(expected.slice(0, i + 2));
        }
        expect(root(fixture).querySelector('[data-typing]')).toBeNull();
        ids = threadIds(fixture);
        const at = ids.indexOf(entry.anchor.id);
        expect(ids.slice(at + 1, at + 1 + expected.length)).toEqual(expected);
      } finally {
        jasmine.clock().uninstall();
      }
      const player = root(fixture).querySelector(`[data-message-id="${c.promptId}:you"]`);
      expect(player?.getAttribute('data-player')).toBe('true');
      // 玩家列署名＝角色名（新遊戲未簽名時為舊存檔顯示名「員工」）
      expect(player?.textContent).toContain(game.displayName());
      expect(game.displayName()).toBe(LEGACY_PLAYER_NAME);
      expect(player?.textContent).toContain(choice.text);
      expect(game.save()?.events.length).toBe(eventsBefore + 1);
      expect(game.save()?.events.at(-1)?.payload).toEqual({ promptId: c.promptId, choiceId: choice.id });

      // 重複：已回答就不可再回答或改成不回覆
      expect(game.answerPrompt(c.promptId, entry.prompt.choices[0]?.id ?? '')).toBeFalse();
      expect(game.skipPrompt(c.promptId)).toBeFalse();
      expect(game.save()?.events.length).toBe(eventsBefore + 1);

      // 重新載入：相同歷史，回覆區不再出現
      ({ game, unread } = boot());
      const again = openPage();
      clickChannel(again, c.channelId);
      expect(threadIds(again)).toEqual(ids);
      expect(quickReplyPrompt(again)).toBeNull();
    });

    it(`${c.promptId}：不回覆 → 對話串不變，回覆區消失，重載後仍無`, () => {
      playTo(game, c.dayId, c.day3Policy);
      if (c.dayId === 'day.03') archiveFirst(game, 2, c.day3Policy);
      const fixture = openPage();
      clickChannel(fixture, c.channelId);
      const before = threadIds(fixture);
      clickSkip(fixture);
      expect(quickReplyPrompt(fixture)).toBeNull();
      expect(threadIds(fixture)).toEqual(before);
      expect(root(fixture).textContent).not.toContain(CONTENT.ui.messages.skipReply);
      expect(game.chatReply(c.promptId)).toEqual({ kind: 'skipped' });
      expect(game.save()?.events.at(-1)?.payload).toEqual({ promptId: c.promptId });

      ({ game, unread } = boot());
      const again = openPage();
      clickChannel(again, c.channelId);
      expect(threadIds(again)).toEqual(before);
      expect(quickReplyPrompt(again)).toBeNull();
    });

    it(`${c.promptId}：未回答就到下一天 → 回覆區不再出現，也沒有玩家列`, () => {
      playTo(game, c.dayId, c.day3Policy);
      if (c.dayId === 'day.03') archiveFirst(game, 2, c.day3Policy);
      if (game.nextDayId() === null) {
        // 最後一日：完成工作進入 end，訊息頁不可達；以狀態確認不再可回答
        expect(game.isPromptOpen(c.promptId)).toBeTrue();
        return;
      }
      finishDay(game, 'default_false');
      expect(game.isPromptOpen(c.promptId)).toBeFalse();
      const fixture = openPage();
      clickChannel(fixture, c.channelId);
      expect(quickReplyPrompt(fixture)).not.toBe(c.promptId);
      expect(threadIds(fixture)).not.toContain(`${c.promptId}:you`);
      expect(game.chatReply(c.promptId)).toBeUndefined();
    });
  }

  it('沒有開放 prompt 的頻道不顯示回覆區', () => {
    playTo(game, 'day.03');
    const fixture = openPage();
    clickChannel(fixture, DEPT);
    expect(root(fixture).querySelector('app-quick-reply')).toBeNull();
  });
});

describe('MessagesComponent Day 3 午餐回答 → Day 4 吳婉庭私訊（R7 §8）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;
  const LUNCH_PROMPT = 'prompt.day3.lunch-plan';

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  for (const [choiceId, messageId] of Object.entries(DAY4_WU)) {
    it(`${choiceId} → Day 4 只解鎖 ${messageId}，並產生未讀`, () => {
      playToDay3Lunch(game);
      const fixture = openPage();
      clickChannel(fixture, LUNCH);
      clickChoice(fixture, choiceId);
      fixture.destroy();
      playTo(game, 'day.04');

      expect(unread.channel(WU_DM)?.unlocked.map((m) => m.id)).toEqual([messageId]);
      expect(unread.channel(WU_DM)?.unreadIds).toEqual([messageId]);
      expect(listedChannelIds(openPage())).toContain(WU_DM);
    });
  }

  it('skip → Day 4 沒有任何吳婉庭私訊，私訊頻道不出現', () => {
    playToDay3Lunch(game);
    const fixture = openPage();
    clickChannel(fixture, LUNCH);
    clickSkip(fixture);
    fixture.destroy();
    playTo(game, 'day.04');
    expect(unread.channel(WU_DM)?.unlocked).toEqual([]);
    expect(listedChannelIds(openPage())).not.toContain(WU_DM);
  });

  it('未回答 → Day 4 沒有任何吳婉庭私訊', () => {
    playTo(game, 'day.04');
    expect(game.chatReply(LUNCH_PROMPT)).toBeUndefined();
    expect(unread.channel(WU_DM)?.unlocked).toEqual([]);
  });
});

describe('MessagesComponent Day 4 review.any／none 各自的 prompt', () => {
  let game: GameStateService;

  beforeEach(() => {
    localStorage.clear();
    ({ game } = boot());
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('Day 3 有送覆核 → 群組顯示 review-returned 的回覆區', () => {
    playTo(game, 'day.04', 'request_review');
    const fixture = openPage();
    clickChannel(fixture, LUNCH);
    expect(quickReplyPrompt(fixture)).toBe('prompt.day4.review-returned');
    expect(game.isPromptOpen('prompt.day4.quick-close')).toBeFalse();
  });

  it('Day 3 沒有送覆核 → 群組顯示 quick-close 的回覆區', () => {
    playTo(game, 'day.04', 'default_false');
    const fixture = openPage();
    clickChannel(fixture, LUNCH);
    expect(quickReplyPrompt(fixture)).toBe('prompt.day4.quick-close');
    expect(game.isPromptOpen('prompt.day4.review-returned')).toBeFalse();
  });
});

describe('MessagesComponent Day 3 午餐群組依歸檔進度解鎖（R8 §4）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;
  const LUNCH_IDS = ['msg.day3.lunch-order', 'msg.day3.lunch-yesterday', 'msg.day3.lunch-hungry', 'msg.day3.lunch-ask-player'];
  const LUNCH_PROMPT = 'prompt.day3.lunch-plan';

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
    playTo(game, 'day.03');
  });

  afterEach(() => localStorage.clear());

  function day3LunchIds(): string[] {
    return (unread.channel(LUNCH)?.unlocked ?? []).map((m) => m.id).filter((id) => LUNCH_IDS.includes(id));
  }

  function day3LunchUnread(): string[] {
    return (unread.channel(LUNCH)?.unreadIds ?? []).filter((id) => LUNCH_IDS.includes(id));
  }

  it('0 筆與 1 筆：四則午餐訊息都不可見、沒有未讀、回覆區不開', () => {
    expect(day3LunchIds()).toEqual([]);
    expect(day3LunchUnread()).toEqual([]);
    expect(game.isPromptOpen(LUNCH_PROMPT)).toBeFalse();
    archiveFirst(game, 1);
    expect(game.archivedCount()).toBe(1);
    expect(day3LunchIds()).toEqual([]);
    expect(day3LunchUnread()).toEqual([]);
    expect(game.isPromptOpen(LUNCH_PROMPT)).toBeFalse();
    // 群組在 Day 3 之前沒有任何訊息：條件未達時整個頻道都不出現在列表
    expect(unread.channel(LUNCH)?.unlocked ?? []).toEqual([]);
    expect(listedChannelIds(openPage())).not.toContain(LUNCH);
  });

  it('2 筆後四則一起出現且為未讀；重新載入後依存檔重算', () => {
    archiveFirst(game, 2);
    expect(day3LunchIds()).toEqual(LUNCH_IDS);
    expect(day3LunchUnread()).toEqual(LUNCH_IDS);
    expect(game.isPromptOpen(LUNCH_PROMPT)).toBeTrue();
    expect(listedChannelIds(openPage())).toContain(LUNCH);

    ({ game, unread } = boot());
    expect(game.archivedCount()).toBe(2);
    expect(day3LunchIds()).toEqual(LUNCH_IDS);
    expect(day3LunchUnread()).toEqual(LUNCH_IDS);
  });
});

describe('MessagesComponent Day 3 比對案件 → Day 4 林予安私訊（R9）', () => {
  let game: GameStateService;
  const CASE = ALL_CASE_REVIEWS[0];
  const condOf = (decisionId: string) => `cond.case.${(CASE?.review.id ?? '').replace(/^case\./, '')}.${decisionId}`;
  /** 由內容推導：每個決定對應的 Day 4 訊息（unlock 引用 cond.case.*）。 */
  const byDecision = new Map(
    (CASE?.review.decisions ?? []).map((d) => [
      d.id,
      ALL_MESSAGES.filter((m) => m.unlock?.includes(condOf(d.id))).map((m) => m.id),
    ]),
  );
  const ALL_CASE_MSGS = [...byDecision.values()].flat();

  beforeEach(() => {
    localStorage.clear();
    ({ game } = boot());
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('內容：三個決定各對應一則、互不重複', () => {
    expect(byDecision.size).toBe(3);
    for (const ids of byDecision.values()) expect(ids.length).toBe(1);
    expect(new Set(ALL_CASE_MSGS).size).toBe(3);
  });

  for (const [decisionId, ids] of byDecision) {
    it(`${decisionId} → Day 4 私訊只出現對應的那一則`, () => {
      if (!CASE) throw new Error('內容沒有比對案件');
      playToWith(game, 'day.04', () => 'default_false', decisionId);
      expect(game.caseDecision(CASE.review.id)).toBe(decisionId);
      const shown = unlockedIds(game, DM).filter((id) => ALL_CASE_MSGS.includes(id));
      expect(shown).toEqual(ids);
      const fixture = openPage();
      clickChannel(fixture, DM);
      const thread = threadIds(fixture);
      for (const id of ALL_CASE_MSGS) expect(thread.includes(id)).toBe(ids.includes(id));
    });
  }

  it('Day 3 當天還看不到三則私訊（visibleFrom 是 Day 4）', () => {
    if (!CASE) throw new Error('內容沒有比對案件');
    playToWith(game, CASE.dayId);
    finishTasks(game);
    expect(unlockedIds(game, DM).filter((id) => ALL_CASE_MSGS.includes(id))).toEqual([]);
  });

  it('舊檔（v7）已歸檔案件紀錄但沒有案件決定：續玩到 Day 4，三則都不出現', () => {
    if (!CASE) throw new Error('內容沒有比對案件');
    playToWith(game, CASE.dayId);
    const s = game.save();
    const record = game.record(CASE.recordKey);
    const batchId = game.batchId() ?? '';
    if (!s) throw new Error('沒有存檔');
    const v7: Record<string, unknown> = {
      ...s,
      version: 7,
      batches: {
        ...s.batches,
        [batchId]: {
          archived: {
            [CASE.recordKey]: {
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
    ({ game } = boot());
    // 讀檔時遷移到目前版本（R10 起為 v9）
    expect(game.save()?.version).toBe(SAVE_VERSION);
    finishDayWith(game);
    expect(game.dayId()).toBe('day.04');
    expect(game.caseDecision(CASE.review.id)).toBeNull();
    expect(unlockedIds(game, DM).filter((id) => ALL_CASE_MSGS.includes(id))).toEqual([]);
  });
});

/* ---------- R12 §2：送達、未讀與捲動 ---------- */

type Answered = Extract<NonNullable<ReturnType<GameStateService['chatReply']>>, { kind: 'answered' }>;

function answeredOf(game: GameStateService, promptId: string): Answered {
  const reply = game.chatReply(promptId);
  if (reply?.kind !== 'answered') throw new Error(`${promptId} 沒有回答`);
  return reply;
}

function scrollerOf(fixture: ComponentFixture<MessagesComponent>): HTMLElement {
  const el = root(fixture).querySelector<HTMLElement>('[data-thread-scroller]');
  if (!el) throw new Error('沒有對話捲動區');
  return el;
}

function badgeText(fixture: ComponentFixture<MessagesComponent>, channelId: string): string | null {
  return (
    root(fixture)
      .querySelector(`[data-channel-id="${channelId}"] app-unread-badge [aria-hidden="true"]`)
      ?.textContent?.trim() ?? null
  );
}

const DAY2_PROMPT = 'prompt.day2.check-in';
const LUNCH_PLAN = 'prompt.day3.lunch-plan';

describe('MessagesComponent 回覆送達與未讀（R12 §2）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 8, 17, 11, 50));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  it('回答 → 立即換頻道 → 回覆送達後該頻道與總數亮紅點 → 回到該對話看到後才消失', async () => {
    playToDay3Lunch(game);
    TestBed.inject(GameClock).random = () => 0;
    const fixture = openPage();
    await openChannel(fixture, LUNCH);
    expect(unread.channel(LUNCH)?.unreadIds).toEqual([]);
    const choice = promptEntry(LUNCH_PLAN).prompt.choices[0];
    if (!choice) throw new Error('沒有選項');

    clickChoice(fixture, choice.id);
    await openChannel(fixture, DEPT);
    const before = unread.total();
    const responses = answeredOf(game, LUNCH_PLAN).responses;
    expect(responses.length).toBeGreaterThan(0);
    // 未送達前不算未讀
    expect(unread.channel(LUNCH)?.unreadIds).toEqual([]);

    jasmine.clock().tick(3000 * responses.length);
    fixture.detectChanges();
    await settleView(fixture);
    expect(unread.channel(LUNCH)?.unreadIds).toEqual(responses.map((r) => r.id));
    expect(unread.total()).toBe(before + responses.length);
    expect(badgeText(fixture, LUNCH)).toBe(String(responses.length));

    await openChannel(fixture, LUNCH);
    expect(unread.channel(LUNCH)?.unreadIds).toEqual([]);
    expect(unread.total()).toBe(before);
    expect(badgeText(fixture, LUNCH)).toBeNull();
  });

  it('送達時通訊不作用中（最小化／其他應用／背景頁籤）：留在未讀，恢復作用中才標記', async () => {
    playToDay2(game);
    TestBed.inject(GameClock).random = () => 0;
    const fixture = openPage();
    await openChannel(fixture, DM);
    const choice = promptEntry(DAY2_PROMPT).prompt.choices[0];
    if (!choice) throw new Error('沒有選項');
    clickChoice(fixture, choice.id);
    desktop.active.set(false);
    const responses = answeredOf(game, DAY2_PROMPT).responses;
    jasmine.clock().tick(3000 * responses.length);
    fixture.detectChanges();
    await settleView(fixture);
    // 列就在畫面上，但視窗不作用中：不標已讀
    for (const r of responses) expect(threadIds(fixture)).toContain(r.id);
    expect(unread.channel(DM)?.unreadIds).toEqual(responses.map((r) => r.id));

    desktop.active.set(true);
    await settleView(fixture);
    expect(unread.channel(DM)?.unreadIds).toEqual([]);
  });

  it('等待中重新載入：沿用保存的 deliverAt（不重抽、不重播）；送達後重載不再出現正在輸入', async () => {
    playToDay2(game);
    TestBed.inject(GameClock).random = () => 0;
    const fixture = openPage();
    clickChannel(fixture, DM);
    const choice = promptEntry(DAY2_PROMPT).prompt.choices[0];
    if (!choice) throw new Error('沒有選項');
    clickChoice(fixture, choice.id);
    const saved = answeredOf(game, DAY2_PROMPT).responses.map((r) => r.deliverAt);
    const firstId = answeredOf(game, DAY2_PROMPT).responses[0]?.id ?? '?';
    jasmine.clock().tick(1000);

    // 重新載入；亂數改成最大值也不會影響已保存的時間
    ({ game, unread } = boot());
    TestBed.inject(GameClock).random = () => 1;
    const again = openPage();
    clickChannel(again, DM);
    expect(answeredOf(game, DAY2_PROMPT).responses.map((r) => r.deliverAt)).toEqual(saved);
    expect(root(again).querySelector(`[data-typing="${DAY2_PROMPT}"]`)).not.toBeNull();
    expect(threadIds(again)).not.toContain(firstId);
    jasmine.clock().tick(1999);
    again.detectChanges();
    expect(threadIds(again)).not.toContain(firstId);
    jasmine.clock().tick(1);
    again.detectChanges();
    expect(threadIds(again)).toContain(firstId);
    jasmine.clock().tick(3000 * saved.length);
    again.detectChanges();
    expect(root(again).querySelector('[data-typing]')).toBeNull();
    const ids = threadIds(again);

    ({ game, unread } = boot());
    const third = openPage();
    clickChannel(third, DM);
    expect(threadIds(third)).toEqual(ids);
    expect(root(third).querySelector('[data-typing]')).toBeNull();
  });

  it('舊存檔（v10）已回答的回覆沒有送達時間：遷移為已讀歷史，不亮紅點、不出現正在輸入', () => {
    playToDay2(game);
    const choice = promptEntry(DAY2_PROMPT).prompt.choices[0];
    if (!choice) throw new Error('沒有選項');
    expect(game.answerPrompt(DAY2_PROMPT, choice.id)).toBeTrue();
    const s = game.save();
    if (!s) throw new Error('沒有存檔');
    const reply = answeredOf(game, DAY2_PROMPT);
    const legacyReply = {
      kind: 'answered',
      choiceId: reply.choiceId,
      playerText: reply.playerText,
      responses: reply.responses.map((r) => ({ id: r.id, actorId: r.actorId, time: r.time, lines: [...r.lines] })),
    };
    const responseIds = legacyReply.responses.map((r) => r.id);
    const v10: Record<string, unknown> = {
      ...s,
      version: 10,
      readIssueReceipts: [],
      chatReplies: { ...s.chatReplies, [DAY2_PROMPT]: legacyReply },
      readMessages: s.readMessages.filter((id) => !responseIds.includes(id)),
    };
    for (const key of ['profile', 'onboarding', 'mailbox', 'readMail', 'helpRequests', 'issueDrafts']) delete v10[key];
    localStorage.setItem(SAVE_KEY, JSON.stringify(v10));

    ({ game, unread } = boot());
    expect(game.save()?.version).toBe(SAVE_VERSION);
    for (const id of responseIds) expect(game.isMessageRead(id)).withContext(id).toBeTrue();
    expect(unread.channel(DM)?.unreadIds.some((id) => responseIds.includes(id))).toBeFalse();
    const fixture = openPage();
    clickChannel(fixture, DM);
    for (const id of responseIds) expect(threadIds(fixture)).toContain(id);
    expect(root(fixture).querySelector('[data-typing]')).toBeNull();
  });

  it('停在歷史上方時新回覆不強制捲動、不標已讀；顯示「有新訊息」，點了才跳到最新並標已讀', async () => {
    playToDay2(game);
    TestBed.inject(GameClock).random = () => 0;
    const fixture = openPage(300);
    await openChannel(fixture, DM);
    const choice = promptEntry(DAY2_PROMPT).prompt.choices[0];
    if (!choice) throw new Error('沒有選項');
    clickChoice(fixture, choice.id);
    await settleView(fixture);

    const scroller = scrollerOf(fixture);
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    await settleView(fixture);

    const first = answeredOf(game, DAY2_PROMPT).responses[0]?.id ?? '?';
    jasmine.clock().tick(3000);
    fixture.detectChanges();
    await settleView(fixture);
    expect(threadIds(fixture)).toContain(first);
    expect(scroller.scrollTop).toBe(0);
    expect(game.isMessageRead(first)).toBeFalse();
    expect(unread.channel(DM)?.unreadIds).toContain(first);

    const chip = root(fixture).querySelector<HTMLButtonElement>('[data-new-below]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent?.trim()).toBe(CONTENT.ui.messages.newBelow);
    expect(chip?.getAttribute('aria-label')).toBe(CONTENT.ui.messages.newBelowAria);
    chip?.click();
    fixture.detectChanges();
    await settleView(fixture);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(game.isMessageRead(first)).toBeTrue();
    expect(root(fixture).querySelector('[data-new-below]')).toBeNull();
  });

  it('在底部時新回覆自動捲到最新並標已讀', async () => {
    playToDay2(game);
    TestBed.inject(GameClock).random = () => 0;
    const fixture = openPage(300);
    await openChannel(fixture, DM);
    const choice = promptEntry(DAY2_PROMPT).prompt.choices[0];
    if (!choice) throw new Error('沒有選項');
    clickChoice(fixture, choice.id);
    await settleView(fixture);
    const responses = answeredOf(game, DAY2_PROMPT).responses;
    jasmine.clock().tick(3000 * responses.length);
    fixture.detectChanges();
    await settleView(fixture);
    const scroller = scrollerOf(fixture);
    expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThanOrEqual(48);
    for (const r of responses) expect(game.isMessageRead(r.id)).withContext(r.id).toBeTrue();
    expect(root(fixture).querySelector('[data-new-below]')).toBeNull();
  });
});

/* ---------- R12 §2：真實桌面視窗狀態 ---------- */

describe('MessagesComponent 已讀只在通訊視窗作用中（真實視窗管理）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;
  let windows: WindowManagerService;
  let desk: DesktopService;

  beforeEach(() => {
    localStorage.clear();
    spyOn(document, 'hasFocus').and.returnValue(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    game = TestBed.inject(GameStateService);
    unread = TestBed.inject(MessageUnreadService);
    windows = TestBed.inject(WindowManagerService);
    desk = TestBed.inject(DesktopService);
    windows.register(APP_WINDOW_IDS.work, { title: 'work', x: 0, y: 0, width: 400, height: 300 });
    windows.register(APP_WINDOW_IDS.messages, { title: 'messages', x: 40, y: 40, width: 400, height: 300, mode: 'closed' });
    game.newGame();
  });

  afterEach(() => localStorage.clear());

  it('通訊關閉：不標已讀；從入口開啟後標記看得到的列', async () => {
    const fixture = openPage();
    await openChannel(fixture, DM);
    expect(desk.isAppActive('messages')).toBeFalse();
    expect(unread.total()).toBe(unlockedIds(game).length);
    desk.openApp('messages');
    await settleView(fixture);
    expect(unread.total()).toBe(0);
  });

  it('通訊最小化：不標已讀；還原後標記', async () => {
    desk.openApp('messages');
    windows.minimize(APP_WINDOW_IDS.messages);
    const fixture = openPage();
    await openChannel(fixture, DM);
    expect(unread.total()).toBe(unlockedIds(game).length);
    windows.restore(APP_WINDOW_IDS.messages);
    await settleView(fixture);
    expect(unread.total()).toBe(0);
  });

  it('其他應用在最上層：不標已讀；通訊置前後標記', async () => {
    desk.openApp('messages');
    windows.focus(APP_WINDOW_IDS.work);
    const fixture = openPage();
    await openChannel(fixture, DM);
    expect(unread.total()).toBe(unlockedIds(game).length);
    windows.focus(APP_WINDOW_IDS.messages);
    await settleView(fixture);
    expect(unread.total()).toBe(0);
  });

  it('瀏覽器頁籤在背景：不標已讀；回到前景後標記', async () => {
    desk.openApp('messages');
    const visibility = spyOnProperty(document, 'visibilityState', 'get').and.returnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const fixture = openPage();
    await openChannel(fixture, DM);
    expect(unread.total()).toBe(unlockedIds(game).length);
    visibility.and.returnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settleView(fixture);
    expect(unread.total()).toBe(0);
  });
});

/* ---------- R12 §4：向同事詢問的提問區塊 ---------- */

const REFUSAL = 'request.refusal-record';
const REFUSAL_PROMPT = 'prompt.help.refusal';

describe('MessagesComponent 向同事詢問（R12 §4）', () => {
  let game: GameStateService;
  let unread: MessageUnreadService;
  const ASKED = new Date(2026, 8, 24, 14, 5);

  beforeEach(() => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
    playToDay2(game);
    // Day 2 私訊自己的 prompt 先略過，回覆區才會輪到說明的追問
    expect(game.skipPrompt(DAY2_PROMPT)).toBeTrue();
    TestBed.inject(GameClock).random = () => 0;
    jasmine.clock().install();
    jasmine.clock().mockDate(ASKED);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  function rowOf(fixture: ComponentFixture<MessagesComponent>, id: string): HTMLElement | null {
    return root(fixture).querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  }

  it('提問列在實際提問的那一天（Day 2）段落最後、用實際時間與玩家署名；說明逐則送達，追問送達後才出現', async () => {
    expect(game.requestHelp(REFUSAL)).toBeTrue();
    const fixture = openPage();
    clickChannel(fixture, DM);

    const ids = threadIds(fixture);
    expect(ids.at(-1)).toBe(`${REFUSAL}:you`);
    const you = rowOf(fixture, `${REFUSAL}:you`);
    expect(you?.getAttribute('data-player')).toBe('true');
    expect(you?.querySelector('[data-time]')?.textContent?.trim()).toBe('14:05');
    expect(you?.querySelector('[data-author]')?.textContent?.trim()).toBe(LEGACY_PLAYER_NAME);
    // 屬於 Day 2 的日期分隔之後（不是模板的 Day 1）
    expect(dayLabels(fixture)).toEqual([chatDateLabel(FIRST_DAY_ID), chatDateLabel(SECOND_DAY_ID)]);
    const entries = Array.from(root(fixture).querySelectorAll('[data-entry-id]')).map((e) => e.getAttribute('data-entry-id'));
    expect(entries.indexOf(`${REFUSAL}:you`)).toBeGreaterThan(entries.indexOf(`date:${SECOND_DAY_ID}`));
    expect(root(fixture).querySelector(`[data-typing="${REFUSAL}"]`)).not.toBeNull();
    expect(quickReplyPrompt(fixture)).toBeNull();
    expect(unread.total()).toBeGreaterThanOrEqual(0);
    const unreadBefore = unread.channel(DM)?.unreadIds ?? [];
    expect(unreadBefore.some((id) => id.startsWith('msg.help.'))).toBeFalse();

    jasmine.clock().tick(3000);
    fixture.detectChanges();
    expect(threadIds(fixture).slice(-2)).toEqual([`${REFUSAL}:you`, 'msg.help.refusal.meaning']);
    expect(rowOf(fixture, 'msg.help.refusal.meaning')?.querySelector('[data-time]')?.textContent?.trim()).toBe('14:05');
    expect(root(fixture).querySelector(`[data-typing="${REFUSAL}"]`)).not.toBeNull();
    expect(quickReplyPrompt(fixture)).toBeNull();
    expect(game.isPromptOpen(REFUSAL_PROMPT)).toBeFalse();

    jasmine.clock().tick(3000);
    fixture.detectChanges();
    expect(threadIds(fixture).slice(-3)).toEqual([`${REFUSAL}:you`, 'msg.help.refusal.meaning', 'msg.help.refusal.paths']);
    expect(root(fixture).querySelector('[data-typing]')).toBeNull();
    expect(quickReplyPrompt(fixture)).toBe(REFUSAL_PROMPT);

    // 看得到且通訊作用中：兩則說明記為已讀；提問列（自己的）從不算未讀
    await settleView(fixture);
    expect(game.isMessageRead('msg.help.refusal.meaning')).toBeTrue();
    expect(game.isMessageRead('msg.help.refusal.paths')).toBeTrue();
    expect(game.isMessageRead(`${REFUSAL}:you`)).toBeFalse();
    expect(unread.channel(DM)?.unreadIds).toEqual([]);

    // 重新載入：同樣的順序與時間，不重播
    const shown = threadIds(fixture);
    ({ game, unread } = boot());
    const again = openPage();
    clickChannel(again, DM);
    expect(threadIds(again)).toEqual(shown);
    expect(root(again).querySelector('[data-typing]')).toBeNull();
  });

  it('Day 1 提問、Day 2 才回答追問：回答接在 Day 1 段落的說明之後（實際時間），畫面捲到自己的回答，回覆送達且看得到才已讀', async () => {
    localStorage.clear();
    ({ game, unread } = boot());
    game.newGame();
    TestBed.inject(GameClock).random = () => 0;
    expect(game.requestHelp(REFUSAL)).toBeTrue();
    jasmine.clock().tick(6000);
    playToDay2(game);
    expect(game.isPromptOpen(REFUSAL_PROMPT)).toBeTrue();

    const fixture = openPage(520);
    await openChannel(fixture, DM);
    // 回覆區先輪到說明的追問（內容順序在 Day 2 的 prompt 之前）
    expect(quickReplyPrompt(fixture)).toBe(REFUSAL_PROMPT);
    const choice = promptEntry(REFUSAL_PROMPT).prompt.choices[1];
    if (!choice) throw new Error('沒有選項');
    const answeredAt = Date.now();
    clickChoice(fixture, choice.id);
    await settleView(fixture);

    const entries = Array.from(root(fixture).querySelectorAll('[data-entry-id]')).map((e) => e.getAttribute('data-entry-id') ?? '');
    const you = `${REFUSAL_PROMPT}:you`;
    expect(entries.indexOf(you)).toBeGreaterThan(entries.indexOf('msg.help.refusal.paths'));
    expect(entries.indexOf(you)).toBeLessThan(entries.indexOf(`date:${SECOND_DAY_ID}`));
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date(answeredAt);
    expect(rowOf(fixture, you)?.querySelector('[data-time]')?.textContent?.trim()).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    // 自己的回答在可視範圍內
    const scroller = scrollerOf(fixture);
    const top = (rowOf(fixture, you)?.getBoundingClientRect().top ?? -1) - scroller.getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(scroller.clientHeight);

    const response = choice.responses[0]?.id ?? '?';
    expect(game.isMessageRead(response)).toBeFalse();
    jasmine.clock().tick(3000);
    fixture.detectChanges();
    await settleView(fixture);
    expect(threadIds(fixture)).toContain(response);
    expect(game.isMessageRead(response)).toBeTrue();
  });

  it('只問一次：再次 requestHelp 不寫入、不重送；定位要求只捲動，不移動焦點、不標已讀', async () => {
    expect(game.requestHelp(REFUSAL)).toBeTrue();
    const saved = game.helpRequest(REFUSAL);
    const events = game.save()?.events.length ?? 0;
    jasmine.clock().tick(10_000);
    expect(game.requestHelp(REFUSAL)).toBeFalse();
    expect(game.helpRequest(REFUSAL)).toEqual(saved);
    expect(game.save()?.events.length).toBe(events);

    desktop.active.set(false);
    const fixture = openPage(260);
    const focused = document.activeElement;
    TestBed.inject(MessagesNavigationService).revealEntry(DM, `${REFUSAL}:you`);
    fixture.detectChanges();
    await settleView(fixture);
    const scroller = scrollerOf(fixture);
    const row = rowOf(fixture, `${REFUSAL}:you`);
    if (!row) throw new Error('沒有提問列');
    const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(scroller.clientHeight);
    expect(document.activeElement).toBe(focused);
    expect(game.isMessageRead('msg.help.refusal.meaning')).toBeFalse();
  });
});

/* ---------- R12 #7：舊存檔的拒絕紀錄說明回覆改用目前內容顯示 ---------- */

describe('MessagesComponent 舊存檔的拒絕紀錄說明回覆（R12 #7）', () => {
  let game: GameStateService;
  const ASKED = new Date(2026, 8, 24, 14, 5);
  /** #7 之前的 help JSON 保存下來的字句。 */
  const OLD_ASK_BLANK = {
    text: '可是沒寫拒絕，也不代表已經問過吧？',
    lines: ['對，單看空白看不出來。', '「未拒絕」是這邊歸檔時用的預設值，不是另外問到的答案。你想等資料補齊再處理，就選「未確認」。'],
  };
  const OLD_ACK_TEXT = '懂了，我再看一下原表。';

  beforeEach(() => {
    localStorage.clear();
    ({ game } = boot());
    game.newGame();
    playToDay2(game);
    expect(game.skipPrompt(DAY2_PROMPT)).toBeTrue();
    TestBed.inject(GameClock).random = () => 0;
    jasmine.clock().install();
    jasmine.clock().mockDate(ASKED);
    expect(game.requestHelp(REFUSAL)).toBeTrue();
    // 兩則說明各 3 秒後送達，追問才可回答
    jasmine.clock().tick(6000);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  function choiceOf(choiceId: string) {
    const choice = promptEntry(REFUSAL_PROMPT).prompt.choices.find((c) => c.id === choiceId);
    if (!choice) throw new Error(`內容缺少選項 ${choiceId}`);
    return choice;
  }

  function rowText(fixture: ComponentFixture<MessagesComponent>, id: string): string {
    return root(fixture).querySelector(`app-message-thread [data-message-id="${id}"]`)?.textContent ?? '';
  }

  /** 把已保存的存檔改成舊存檔的樣子（只動指定欄位），重新載入；回傳寫入的原始字串。 */
  function rewriteSave(mutate: (save: Record<string, any>) => void): string {
    const save = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') as Record<string, any>;
    mutate(save);
    const raw = JSON.stringify(save);
    localStorage.setItem(SAVE_KEY, raw);
    ({ game } = boot());
    expect(game.save()?.chatReplies[REFUSAL_PROMPT]).toEqual(save['chatReplies'][REFUSAL_PROMPT]);
    return raw;
  }

  it('已送達的舊 ask-blank 快照：對話串與頻道摘要都顯示目前文字；存檔原樣不動', async () => {
    expect(game.answerPrompt(REFUSAL_PROMPT, 'ask-blank')).toBeTrue();
    jasmine.clock().tick(3000);
    const raw = rewriteSave((s) => {
      s['chatReplies'][REFUSAL_PROMPT].playerText = OLD_ASK_BLANK.text;
      s['chatReplies'][REFUSAL_PROMPT].responses[0].lines = OLD_ASK_BLANK.lines;
    });
    const choice = choiceOf('ask-blank');
    // 通訊不作用中：畫面不寫入已讀，確認顯示本身不碰存檔
    desktop.active.set(false);
    const fixture = openPage();

    const preview = root(fixture).querySelector(`[data-channel-id="${DM}"] [data-channel-preview]`)?.textContent?.trim();
    expect(preview).toBe(choice.responses[0]?.lines.at(-1));

    clickChannel(fixture, DM);
    await settleView(fixture);
    expect(threadIds(fixture).slice(-2)).toEqual([`${REFUSAL_PROMPT}:you`, 'msg.help.refusal.blank-response']);
    expect(rowText(fixture, `${REFUSAL_PROMPT}:you`)).toContain(choice.text);
    expect(rowText(fixture, `${REFUSAL_PROMPT}:you`)).not.toContain(OLD_ASK_BLANK.text);
    const response = rowText(fixture, 'msg.help.refusal.blank-response');
    for (const line of choice.responses[0]?.lines ?? []) expect(response).toContain(line);
    for (const line of OLD_ASK_BLANK.lines) expect(response).not.toContain(line);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
  });

  it('尚未送達的舊 ack 快照：依保存的送達時間顯示「正在輸入」，送達後才出現；送達時間與 ID 不變', () => {
    expect(game.answerPrompt(REFUSAL_PROMPT, 'ack')).toBeTrue();
    const before = answeredOf(game, REFUSAL_PROMPT).responses.map((r) => [r.id, r.deliverAt]);
    rewriteSave((s) => {
      s['chatReplies'][REFUSAL_PROMPT].playerText = OLD_ACK_TEXT;
    });
    const fixture = openPage();
    clickChannel(fixture, DM);

    expect(rowText(fixture, `${REFUSAL_PROMPT}:you`)).toContain(choiceOf('ack').text);
    expect(rowText(fixture, `${REFUSAL_PROMPT}:you`)).not.toContain('原表');
    expect(root(fixture).querySelector(`[data-typing="${REFUSAL_PROMPT}"]`)).not.toBeNull();
    expect(threadIds(fixture)).not.toContain('msg.help.refusal.ack-response');

    jasmine.clock().tick(3000);
    fixture.detectChanges();
    expect(root(fixture).querySelector('[data-typing]')).toBeNull();
    expect(threadIds(fixture).at(-1)).toBe('msg.help.refusal.ack-response');
    expect(answeredOf(game, REFUSAL_PROMPT).responses.map((r) => [r.id, r.deliverAt])).toEqual(before);
  });

  it('找不到回應或選項時沿用舊快照、列不消失；一般 prompt 的快照文字不被改寫', () => {
    expect(game.answerPrompt(REFUSAL_PROMPT, 'ask-blank')).toBeTrue();
    jasmine.clock().tick(3000);
    const retired = 'msg.help.refusal.retired-response';
    rewriteSave((s) => {
      const reply = s['chatReplies'][REFUSAL_PROMPT];
      reply.playerText = OLD_ASK_BLANK.text;
      reply.responses[0].id = retired;
      reply.responses[0].lines = OLD_ASK_BLANK.lines;
      // 一般 prompt：保存的文字和目前內容不同，也照快照顯示
      s['chatReplies'][DAY2_PROMPT] = {
        kind: 'answered',
        choiceId: 'complicated',
        playerText: '（舊快照）一般回覆',
        responses: [{ id: 'msg.day2.reply.complicated', actorId: 'actor.lin-yuan', time: '09:40', lines: ['（舊快照）一般回應'] }],
      };
    });
    let fixture = openPage();
    clickChannel(fixture, DM);
    // 選項仍在：玩家列換成目前文字；回應 ID 已不在內容中：該列沿用舊字句
    expect(rowText(fixture, `${REFUSAL_PROMPT}:you`)).toContain(choiceOf('ask-blank').text);
    expect(threadIds(fixture)).toContain(retired);
    expect(rowText(fixture, retired)).toContain(OLD_ASK_BLANK.lines[1] ?? '?');
    expect(rowText(fixture, `${DAY2_PROMPT}:you`)).toContain('（舊快照）一般回覆');
    expect(rowText(fixture, 'msg.day2.reply.complicated')).toContain('（舊快照）一般回應');

    // 選項已不在內容中：整份沿用舊快照
    rewriteSave((s) => {
      s['chatReplies'][REFUSAL_PROMPT].choiceId = 'removed-choice';
    });
    fixture = openPage();
    clickChannel(fixture, DM);
    expect(rowText(fixture, `${REFUSAL_PROMPT}:you`)).toContain(OLD_ASK_BLANK.text);
    expect(rowText(fixture, retired)).toContain(OLD_ASK_BLANK.lines[1] ?? '?');
  });
});
