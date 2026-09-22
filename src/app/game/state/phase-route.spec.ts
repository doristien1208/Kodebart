import { PHASES } from '../core/types';
import { routeForPhase } from './phase-route';

describe('routeForPhase', () => {
  it('day1 → /work', () => {
    expect(routeForPhase('day1')).toBe('/work');
  });

  it('overnight → /overnight', () => {
    expect(routeForPhase('overnight')).toBe('/overnight');
  });

  it('day2 → /work', () => {
    expect(routeForPhase('day2')).toBe('/work');
  });

  it('end → /end', () => {
    expect(routeForPhase('end')).toBe('/end');
  });

  it('每個 phase 都對應到三條路徑之一', () => {
    for (const phase of PHASES) {
      expect(['/work', '/overnight', '/end']).toContain(routeForPhase(phase));
    }
  });
});
