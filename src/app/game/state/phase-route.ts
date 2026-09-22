import { Phase } from '../core/types';

/** 每個 phase 對應的唯一畫面路徑；phase guard 據此導正。 */
export function routeForPhase(phase: Phase): '/work' | '/overnight' | '/end' {
  switch (phase) {
    case 'day1':
    case 'day2':
      return '/work';
    case 'overnight':
      return '/overnight';
    case 'end':
      return '/end';
  }
}
