import { MAX_SEED, isValidSeed, rand } from './rand';

/** 移植 doc/prototype/verify-core.cjs 第 34–42 行的 seed 掃描。 */
const INTERVENTION_ID = 'night.intervention';
const SMALLTALK_ID = 'night.smalltalk';

describe('rand', () => {
  it('同一 seed＋id 回傳相同值', () => {
    expect(rand(42, INTERVENTION_ID)).toBe(rand(42, INTERVENTION_ID));
    expect(rand(0, SMALLTALK_ID)).toBe(rand(0, SMALLTALK_ID));
    expect(rand(MAX_SEED, 'x')).toBe(rand(MAX_SEED, 'x'));
  });

  it('同一 seed 不同 id 回傳不同值', () => {
    expect(rand(42, INTERVENTION_ID)).not.toBe(rand(42, SMALLTALK_ID));
  });

  it('不同 seed 同 id 回傳不同值', () => {
    expect(rand(1, INTERVENTION_ID)).not.toBe(rand(2, INTERVENTION_ID));
  });

  it('範圍在 [0,1)', () => {
    for (const seed of [0, 1, 42, 12345, 2 ** 31, MAX_SEED]) {
      const v = rand(seed, INTERVENTION_ID);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('與原型 prototype-source.html 的 rand() 位元一致（黃金值）', () => {
    expect(rand(42, INTERVENTION_ID)).toBe(0.29279173677787185);
    expect(rand(42, SMALLTALK_ID)).toBe(0.5846431709360331);
    expect(rand(1, INTERVENTION_ID)).toBe(0.4956913886126131);
    expect(rand(0, INTERVENTION_ID)).toBe(0.8472142168320715);
    expect(rand(MAX_SEED, INTERVENTION_ID)).toBe(0.6489639801438898);
    expect(rand(7, SMALLTALK_ID)).toBe(0.6525197101291269);
  });

  it('1000 個 seed 對 night.intervention：全部 [0,1)、可重現、< 0.45 的 yes 與 no 都出現', () => {
    let yes = 0;
    let no = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const a = rand(seed, INTERVENTION_ID);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      expect(rand(seed, INTERVENTION_ID)).toBe(a);
      // 原型的 JSON 往返檢查：布林判定結果可以原樣存回。
      const restored = JSON.parse(JSON.stringify({ seed, night: { intervention: a < 0.45 } }));
      expect(restored.night.intervention).toBe(a < 0.45);
      if (a < 0.45) yes++;
      else no++;
    }
    expect(yes).toBeGreaterThan(0);
    expect(no).toBeGreaterThan(0);
    expect(yes + no).toBe(1000);
  });
});

describe('isValidSeed', () => {
  it('MAX_SEED 是 32 位無號整數上限', () => {
    expect(MAX_SEED).toBe(4294967295);
  });

  it('0 與 4294967295 合法', () => {
    expect(isValidSeed(0)).toBeTrue();
    expect(isValidSeed(4294967295)).toBeTrue();
    expect(isValidSeed(42)).toBeTrue();
  });

  it('-1、4294967296、1.5、"1"、NaN 不合法', () => {
    expect(isValidSeed(-1)).toBeFalse();
    expect(isValidSeed(4294967296)).toBeFalse();
    expect(isValidSeed(1.5)).toBeFalse();
    expect(isValidSeed('1')).toBeFalse();
    expect(isValidSeed(NaN)).toBeFalse();
  });

  it('null、undefined、Infinity、物件不合法', () => {
    expect(isValidSeed(null)).toBeFalse();
    expect(isValidSeed(undefined)).toBeFalse();
    expect(isValidSeed(Infinity)).toBeFalse();
    expect(isValidSeed({})).toBeFalse();
    expect(isValidSeed([1])).toBeFalse();
  });
});
