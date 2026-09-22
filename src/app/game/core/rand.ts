/**
 * 種子亂數：seed ＋ 固定 eventId → [0,1)。
 * 同一 seed 與 id 永遠得到同一值；多開一次新聞或重繪 UI 不會改變關鍵事件。
 * 演算法與原型 prototype-source.html 的 rand() 完全一致（FNV-1a 變體）。
 */
export const MAX_SEED = 4294967295;

export function rand(seed: number, id: string): number {
  let h = seed >>> 0;
  for (const c of id) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function isValidSeed(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_SEED;
}
