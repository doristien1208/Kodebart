import { LEGACY_STAGES, STAGES, Stage } from '../core/types';
import { routeForSave, routeForStage } from './stage-route';

describe('routeForStage', () => {
  it('work → /work、wrap → /overnight、morning → /morning、end → /end（沿用既有 URL）', () => {
    expect(routeForStage('work')).toBe('/work');
    expect(routeForStage('wrap')).toBe('/overnight');
    expect(routeForStage('morning')).toBe('/morning');
    expect(routeForStage('end')).toBe('/end');
  });

  it('每個通用階段都有唯一路徑（含 R8 的 morning）', () => {
    expect([...STAGES]).toEqual(['work', 'wrap', 'morning', 'end']);
    const routes = STAGES.map((s: Stage) => routeForStage(s));
    expect(new Set(routes).size).toBe(STAGES.length);
    for (const r of routes) expect(r.startsWith('/')).toBeTrue();
  });

  it('舊檔階段（work／wrap／end）的路徑與 R7 相同', () => {
    expect(LEGACY_STAGES.map((s) => routeForStage(s))).toEqual(['/work', '/overnight', '/end']);
  });
});

describe('routeForSave（R12）', () => {
  it('入職前情未完成 → /onboarding（不論階段；刷新、繼續遊戲都回到原段落）', () => {
    for (const stage of STAGES) {
      expect(routeForSave({ stage, onboarding: { step: 0, complete: false } })).withContext(stage).toBe('/onboarding');
      expect(routeForSave({ stage, onboarding: { step: 7, complete: false } })).withContext(stage).toBe('/onboarding');
    }
  });

  it('入職已完成（含舊檔遷移的 step 0＋complete）→ 依通用階段的路徑', () => {
    for (const stage of STAGES) {
      expect(routeForSave({ stage, onboarding: { step: 7, complete: true } })).withContext(stage).toBe(routeForStage(stage));
      expect(routeForSave({ stage, onboarding: { step: 0, complete: true } })).withContext(stage).toBe(routeForStage(stage));
    }
  });
});
