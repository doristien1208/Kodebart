import { MAX_SEED } from '../core/rand';

/** 新遊戲產生 32 位 seed；只在瀏覽器呼叫。 */
export function createSeed(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return Math.min(buf[0], MAX_SEED);
}
