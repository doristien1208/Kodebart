import { Injectable } from '@angular/core';

/**
 * 遊戲用的實際時間與一般亂數（R12）：訊息送達排程、提問時間。
 * 這些值在發生當下寫入存檔，之後重整／讀檔只讀保存值，不重抽。
 * 亂數只決定閱讀節奏（3–4 秒），不影響任何遊戲結果，因此不用 seed。測試可替換 now／random。
 */
@Injectable({ providedIn: 'root' })
export class GameClock {
  now: () => number = () => Date.now();
  random: () => number = () => Math.random();
}

/** 同事每則回覆送達前的停頓（毫秒）：隨機 3–4 秒（R6 起的閱讀節奏；關閉動態時仍保留）。 */
export const REPLY_DELAY_MIN_MS = 3000;
export const REPLY_DELAY_MAX_MS = 4000;

/** 從 start 起逐則累加 3–4 秒的送達時間（遞增）。 */
export function deliverySchedule(start: number, count: number, random: () => number): number[] {
  const out: number[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    at += REPLY_DELAY_MIN_MS + Math.round(Math.min(1, Math.max(0, random())) * (REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS));
    out.push(at);
  }
  return out;
}
