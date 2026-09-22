import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CONTENT, unlockedMessages } from '../../content/bundle';
import { RECORDS } from '../../content/records';
import { MissingPolicy, RecordKey, ValidationOk } from '../../core/types';
import { GameStateService } from '../../state/game-state.service';
import { MessageUnreadService } from './message-unread.service';
import { MessagesComponent } from './messages.component';

/**
 * KB-R4-04 第 4～9 點的整合驗證：正式內容 ＋ 真實存檔。
 *
 * 涵蓋：只進訊息頁不清未讀、打開頻道才記為已讀、只影響該頻道、
 * 重新載入後已讀保留、進到第二天新解鎖的訊息讓紅點重新出現，
 * 以及查看訊息不動 night／phase／事件。
 */

const DM = 'channel.dm.lin-yuan';

interface Harness {
  game: GameStateService;
  unread: MessageUnreadService;
}

/** service 在建構時讀 localStorage，所以每次都要重建 injector。 */
function boot(): Harness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  return { game: TestBed.inject(GameStateService), unread: TestBed.inject(MessageUnreadService) };
}

function openPage(): ComponentFixture<MessagesComponent> {
  const fixture = TestBed.createComponent(MessagesComponent);
  fixture.detectChanges();
  return fixture;
}

function clickChannel(fixture: ComponentFixture<MessagesComponent>, channelId: string): void {
  const el = fixture.nativeElement as HTMLElement;
  const button = el.querySelector<HTMLButtonElement>(`[data-channel-id="${channelId}"]`);
  if (button === null) throw new Error(`找不到頻道 ${channelId} 的按鈕`);
  button.click();
  fixture.detectChanges();
}

function okOf(game: GameStateService, key: RecordKey): ValidationOk {
  const r = game.validate(key);
  if (!r.ok) throw new Error(`validation for ${key} failed: ${r.error}`);
  return r;
}

function playToDay2(game: GameStateService, policy: MissingPolicy = 'default_false'): void {
  for (const record of RECORDS) {
    game.updateDraft(record.key, { value: record.code, policy });
    game.archive(record.key, okOf(game, record.key));
  }
  expect(game.completeDay1()).toBeTrue();
  game.advanceToDay2();
  expect(game.phase()).toBe('day2');
}

/** 目前狀態下該頻道已解鎖的訊息 ID；期望值一律由內容檔推導，不寫死。 */
function unlockedIds(game: GameStateService, channelId = DM): readonly string[] {
  const phase = game.phase();
  if (phase === null) return [];
  return unlockedMessages(channelId, { day: game.day(), phase, night: game.night() }).map((m) => m.id);
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

  it('打開頻道後該頻道的已解鎖訊息才記為已讀，紅點消失', () => {
    const fixture = openPage();
    clickChannel(fixture, DM);

    expect(game.save()?.readMessages).toEqual([...unlockedIds(game)]);
    expect(unread.channel(DM)?.unreadIds).toEqual([]);
    expect(unread.total()).toBe(0);
  });

  it('已讀只含被打開頻道的訊息，不會波及其他頻道', () => {
    const fixture = openPage();
    clickChannel(fixture, DM);

    const read = game.save()?.readMessages ?? [];
    for (const channel of CONTENT.channels) {
      if (channel.id === DM) continue;
      for (const id of unlockedIds(game, channel.id)) expect(read).not.toContain(id);
    }
    for (const id of read) expect(unlockedIds(game, DM)).toContain(id);
  });

  it('查看訊息不改 night、phase 與事件數量', () => {
    const phase = game.phase();
    const night = game.night();
    const events = game.save()?.events.length ?? 0;

    const fixture = openPage();
    clickChannel(fixture, DM);

    expect(game.phase()).toBe(phase);
    expect(game.night()).toEqual(night);
    expect(game.save()?.events.length).toBe(events);
  });

  it('已讀狀態在重新載入後保留', () => {
    clickChannel(openPage(), DM);
    const read = game.save()?.readMessages ?? [];
    expect(read.length).toBeGreaterThan(0);

    // 重新載入：新的 injector 從 localStorage 讀回同一份存檔
    ({ game, unread } = boot());
    expect(game.save()?.readMessages).toEqual([...read]);
    expect(unread.total()).toBe(0);
    openPage();
    expect(unread.total()).toBe(0);
  });

  it('進到第二天後新解鎖的訊息讓紅點重新出現', () => {
    clickChannel(openPage(), DM);
    expect(unread.total()).toBe(0);

    playToDay2(game);

    const day2Unlocked = unlockedIds(game);
    const alreadyRead = game.save()?.readMessages ?? [];
    const expected = day2Unlocked.filter((id) => !alreadyRead.includes(id));
    expect(expected.length).toBeGreaterThan(0);
    expect(unread.channel(DM)?.unreadIds).toEqual([...expected]);
    expect(unread.total()).toBe(expected.length);

    // 再打開一次才會清掉；第一天已讀的訊息不會被重複加入
    clickChannel(openPage(), DM);
    expect(unread.total()).toBe(0);
    const finalRead = game.save()?.readMessages ?? [];
    expect(new Set(finalRead).size).toBe(finalRead.length);
  });

  it('三種分類都會列出；沒有頻道的分類顯示中性空狀態', () => {
    const el = openPage().nativeElement as HTMLElement;
    const headings = Array.from(el.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    const ui = CONTENT.ui.messages;
    for (const kind of ['department', 'group', 'direct'] as const) {
      expect(headings).toContain(ui.sectionTitle[kind]);
    }
    expect(el.textContent).toContain(ui.sectionEmpty);
    expect(el.querySelectorAll(`[data-channel-id="${DM}"]`).length).toBe(1);
  });
});
