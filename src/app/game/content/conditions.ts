import { NightResult, Phase } from '../core/types';

/**
 * game/content/conditions：解鎖條件與動作的白名單。
 *
 * 資料檔只寫 ID，全部的判斷都在這裡以 TypeScript 完成；
 * JSON 不得出現運算式、函式字串或 eval。未列在白名單的 ID 會被
 * validate-content.ts 判為錯誤，而不是在執行期默默當成 false。
 */

/**
 * 目前支援的解鎖條件。
 * - `cond.always`：無條件。
 * - `cond.day.N`：目前是第 N 天。
 * - `cond.phase.X`：目前處於哪個階段。
 * - `cond.night.smalltalk.N`：夜間閒聊版本；由存檔的 night 決定，重看不重抽。
 */
export const CONDITION_IDS = [
  'cond.always',
  'cond.day.1',
  'cond.day.2',
  'cond.phase.day1',
  'cond.phase.overnight',
  'cond.phase.day2',
  'cond.phase.end',
  'cond.night.smalltalk.0',
  'cond.night.smalltalk.1',
] as const;

export type ConditionId = (typeof CONDITION_IDS)[number];

export function isConditionId(value: unknown): value is ConditionId {
  return typeof value === 'string' && (CONDITION_IDS as readonly string[]).includes(value);
}

/**
 * 內容可以引用的動作 ID；對應既有流程，資料檔本輪尚未使用。
 * 新增動作時必須同時在規則層實作，不得讓資料檔自行描述行為。
 */
export const ACTION_IDS = [
  'action.archive.commit',
  'action.day.complete',
  'action.day.advance',
  'action.document.open',
  'action.reply.submit',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && (ACTION_IDS as readonly string[]).includes(value);
}

/** 判斷條件時可以看到的狀態；只讀，不會回寫存檔，也不重抽亂數。 */
export interface ConditionContext {
  /** 目前第幾天。 */
  day: number;
  phase: Phase;
  /** 夜間判定結果；尚未判定時為 null。 */
  night: NightResult | null;
}

/** 解析單一條件；未知 ID 一律回傳 false（驗證階段就會先擋下）。 */
export function evaluateCondition(id: string, ctx: ConditionContext): boolean {
  switch (id) {
    case 'cond.always':
      return true;
    case 'cond.day.1':
      return ctx.day === 1;
    case 'cond.day.2':
      return ctx.day === 2;
    case 'cond.phase.day1':
      return ctx.phase === 'day1';
    case 'cond.phase.overnight':
      return ctx.phase === 'overnight';
    case 'cond.phase.day2':
      return ctx.phase === 'day2';
    case 'cond.phase.end':
      return ctx.phase === 'end';
    case 'cond.night.smalltalk.0':
      return ctx.night?.smallTalkVariant === 0;
    case 'cond.night.smalltalk.1':
      return ctx.night?.smallTalkVariant === 1;
    default:
      return false;
  }
}

/** 全部條件都成立才算解鎖；空陣列代表無條件。 */
export function isUnlocked(unlock: readonly string[], ctx: ConditionContext): boolean {
  return unlock.every((id) => evaluateCondition(id, ctx));
}
