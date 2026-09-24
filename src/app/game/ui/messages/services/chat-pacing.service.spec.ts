import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ALL_PROMPTS, helpRequestOfMessage } from '../../../content/bundle';
import { GameClock, REPLY_DELAY_MAX_MS, REPLY_DELAY_MIN_MS } from '../../../state/game-clock';
import { GameStateService } from '../../../state/game-state.service';
import { SAVE_KEY } from '../../../state/save-repository';
import { ChatPacingService, deliveryTimesOf, isDeliveredAt } from './chat-pacing.service';

/**
 * R12 §2：送達時鐘只讀存檔中的送達時間（回答／提問當下擲一次並保存），
 * 一個計時器設在下一個未來的送達時間；重新整理不重抽、不重播。
 */

const START = new Date(2026, 8, 15, 9, 30);
/** Day 1 私訊第一個（非說明）prompt。 */
const DAY1_PROMPT = ALL_PROMPTS.find((e) => e.anchor.visibleFrom === 'day.01' && !helpRequestOfMessage(e.anchor.id));
const REFUSAL = 'request.refusal-record';

function boot(): { game: GameStateService; pacing: ChatPacingService; clock: GameClock } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const clock = TestBed.inject(GameClock);
  clock.random = () => 0;
  return { game: TestBed.inject(GameStateService), pacing: TestBed.inject(ChatPacingService), clock };
}

describe('送達時間小工具', () => {
  it('isDeliveredAt：undefined（舊存檔）視為已送達；時間到（含剛好）才送達', () => {
    expect(isDeliveredAt(undefined, 0)).toBeTrue();
    expect(isDeliveredAt(1000, 999)).toBeFalse();
    expect(isDeliveredAt(1000, 1000)).toBeTrue();
  });

  it('deliveryTimesOf：沒有存檔為空', () => {
    expect(deliveryTimesOf(null)).toEqual([]);
  });

  it('節奏常數仍是 3–4 秒（狀態層 game-clock）', () => {
    expect(REPLY_DELAY_MIN_MS).toBe(3000);
    expect(REPLY_DELAY_MAX_MS).toBe(4000);
  });
});

describe('ChatPacingService（送達時鐘）', () => {
  beforeEach(() => {
    localStorage.clear();
    jasmine.clock().install();
    jasmine.clock().mockDate(START);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.clear();
  });

  it('回答後依保存的 deliverAt 逐則送達：時間到之前未送達，到點後 now 前進', () => {
    if (!DAY1_PROMPT) throw new Error('內容沒有 Day 1 prompt');
    const { game, pacing } = boot();
    game.newGame();
    const choice = DAY1_PROMPT.prompt.choices[0];
    if (!choice) throw new Error('沒有選項');
    expect(game.answerPrompt(DAY1_PROMPT.prompt.id, choice.id)).toBeTrue();
    TestBed.flushEffects();

    const reply = game.chatReply(DAY1_PROMPT.prompt.id);
    if (reply?.kind !== 'answered') throw new Error('沒有回答');
    const first = reply.responses[0]?.deliverAt;
    expect(first).toBe(START.getTime() + REPLY_DELAY_MIN_MS);
    expect(deliveryTimesOf(game.save())).toContain(first as number);
    expect(pacing.isDelivered(first)).toBeFalse();

    jasmine.clock().tick(REPLY_DELAY_MIN_MS - 1);
    expect(pacing.isDelivered(first)).toBeFalse();
    jasmine.clock().tick(1);
    expect(pacing.isDelivered(first)).toBeTrue();
    expect(pacing.now()).toBe(START.getTime() + REPLY_DELAY_MIN_MS);
  });

  it('提問的說明依保存的送達時間逐則送達（計時器接續設到下一則）', () => {
    const { game, pacing } = boot();
    game.newGame();
    expect(game.requestHelp(REFUSAL)).toBeTrue();
    TestBed.flushEffects();
    const deliveries = game.helpRequest(REFUSAL)?.deliveries ?? [];
    expect(deliveries.length).toBe(2);
    expect(deliveries.map((d) => pacing.isDelivered(d.at))).toEqual([false, false]);
    jasmine.clock().tick(REPLY_DELAY_MIN_MS);
    expect(deliveries.map((d) => pacing.isDelivered(d.at))).toEqual([true, false]);
    jasmine.clock().tick(REPLY_DELAY_MIN_MS);
    expect(deliveries.map((d) => pacing.isDelivered(d.at))).toEqual([true, true]);
  });

  it('重新整理（等待中）：沿用保存的送達時間，不重抽、不重播；已過時間的直接送達', () => {
    const { game } = boot();
    game.newGame();
    game.requestHelp(REFUSAL);
    const saved = game.helpRequest(REFUSAL)?.deliveries.map((d) => d.at) ?? [];
    jasmine.clock().tick(REPLY_DELAY_MIN_MS + 500);

    // 新的 injector 從 localStorage 讀回；亂數改成最大值也不影響已保存的時間
    const again = boot();
    again.clock.random = () => 1;
    TestBed.flushEffects();
    expect(again.game.helpRequest(REFUSAL)?.deliveries.map((d) => d.at)).toEqual(saved);
    expect(saved.map((at) => again.pacing.isDelivered(at))).toEqual([true, false]);
    jasmine.clock().tick(REPLY_DELAY_MIN_MS - 500);
    expect(saved.map((at) => again.pacing.isDelivered(at))).toEqual([true, true]);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}').helpRequests[REFUSAL].deliveries.map((d: { at: number }) => d.at)).toEqual(saved);
  });
});
