// 模拟对战的随机数：默认使用浏览器的加密随机数（crypto.getRandomValues），
// 测试时可以传入可复现的种子。洗牌用 Fisher-Yates，取随机整数用拒绝采样避免取模偏差。
import { mulberry32 } from '../lib/cards.ts';

export type Rng = () => number;

/** 返回 [0, 2^32) 的均匀随机整数 */
export type U32 = () => number;

export function cryptoU32(): U32 {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(256);
    let i = buf.length;
    return () => {
      if (i >= buf.length) {
        c.getRandomValues(buf);
        i = 0;
      }
      return buf[i++];
    };
  }
  // 没有加密随机数时退回 Math.random（不会发生在现代浏览器和 Node 中）
  return () => Math.floor(Math.random() * 4294967296) >>> 0;
}

export function seededU32(seed: number): U32 {
  const r = mulberry32(seed);
  return () => Math.floor(r() * 4294967296) >>> 0;
}

/** [0, n) 的均匀随机整数（拒绝采样） */
export function randInt(u: U32, n: number): number {
  if (n <= 1) return 0;
  const limit = 4294967296 - (4294967296 % n);
  let x: number;
  do x = u();
  while (x >= limit);
  return x % n;
}

/** [0, 1) 的随机小数 */
export const toUnit = (u: U32): Rng => () => u() / 4294967296;

/** 原地洗牌（Fisher-Yates） */
export function shuffle<T>(arr: T[], u: U32): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(u, i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function shuffledDeck(u: U32): number[] {
  return shuffle(
    Array.from({ length: 52 }, (_, i) => i),
    u,
  );
}
