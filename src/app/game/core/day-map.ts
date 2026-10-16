import { DayId, Phase, Stage } from './types';

/**
 * 舊存檔（v2／v3）的相容對照，**只**用於遷移。
 *
 * v2／v3 以寫死的 phase 表示流程，這裡把它對回「內容日＋通用階段」。
 * 現行規則與驗證不再使用這些函式；日程由 DayDirectory 提供。
 */
export const LEGACY_DAY_01: DayId = 'day.01';
export const LEGACY_DAY_02: DayId = 'day.02';

/**
 * 六日內容（存檔 v12 以前）的最後一天（M2）：之後接第七日。停在這一天 end 的舊存檔是合法的舊章節終點，
 * 由玩家明確「繼續工作」才進入下一天；其他有下一天的日子停在 end 仍是不一致的存檔。
 */
export const LEGACY_CHAPTER_END_DAY: DayId = 'day.06';

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
