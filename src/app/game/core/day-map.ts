import { DayId, Phase, Stage } from './types';

/**
 * 舊存檔（v2／v3）的相容對照，**只**用於遷移。
 *
 * v2／v3 以寫死的 phase 表示流程，這裡把它對回「內容日＋通用階段」。
 * 現行規則與驗證不再使用這些函式；日程由 DayDirectory 提供。
 */
export const LEGACY_DAY_01: DayId = 'day.01';
export const LEGACY_DAY_02: DayId = 'day.02';

export function dayIdForPhase(phase: Phase): DayId {
  return phase === 'day2' || phase === 'end' ? LEGACY_DAY_02 : LEGACY_DAY_01;
}

export function stageForPhase(phase: Phase): Stage {
  switch (phase) {
    case 'overnight':
      return 'wrap';
    case 'end':
      return 'end';
    case 'day1':
    case 'day2':
    default:
      return 'work';
  }
}
