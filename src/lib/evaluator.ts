// 5~7 张牌的快速牌力评估器（位运算实现）
// 返回值越大牌力越强；最高 4 位为牌型（0 高牌 … 8 同花顺），其余为比较用的点数
import { rankOf, suitOf } from './cards.ts';

export const HAND_CATEGORY_NAMES = [
  '高牌 (High Card)',
  '一对 (One Pair)',
  '两对 (Two Pair)',
  '三条 (Three of a Kind)',
  '顺子 (Straight)',
  '同花 (Flush)',
  '葫芦 (Full House)',
  '四条 (Four of a Kind)',
  '同花顺 (Straight Flush)',
];

const POP = new Uint8Array(8192);
const STRAIGHT_TOP = new Int8Array(8192); // -1 = 无顺子；否则为顺子最高张点数
const TOP5 = new Int32Array(8192); // 掩码中最大的 5 个点数打包

function highBit(m: number): number {
  return 31 - Math.clz32(m);
}

for (let m = 0; m < 8192; m++) {
  let c = 0;
  for (let b = 0; b < 13; b++) if (m & (1 << b)) c++;
  POP[m] = c;
  let top = -1;
  for (let t = 12; t >= 4; t--) {
    const need = 0x1f << (t - 4);
    if ((m & need) === need) {
      top = t;
      break;
    }
  }
  if (top < 0 && (m & 0x100f) === 0x100f) top = 3; // A2345
  STRAIGHT_TOP[m] = top;
  let packed = 0;
  let mm = m;
  for (let k = 0; k < 5; k++) {
    packed <<= 4;
    if (mm) {
      const h = highBit(mm);
      packed |= h;
      mm &= ~(1 << h);
    }
  }
  TOP5[m] = packed;
}

/** 取掩码中最大的 n 个点数，按 4 位一组打包 */
function topN(m: number, n: number): number {
  let packed = 0;
  for (let k = 0; k < n; k++) {
    const h = highBit(m);
    packed = (packed << 4) | h;
    m &= ~(1 << h);
  }
  return packed;
}

const CAT = (c: number) => c << 20;

/** 以四个花色的点数掩码评估牌力（适用于 5~7 张牌） */
export function evalMasks(s0: number, s1: number, s2: number, s3: number): number {
  // 7 张牌以内同花与葫芦/四条不可能同时出现，所以有同花时只需判断同花顺
  let fm = -1;
  if (POP[s0] >= 5) fm = s0;
  else if (POP[s1] >= 5) fm = s1;
  else if (POP[s2] >= 5) fm = s2;
  else if (POP[s3] >= 5) fm = s3;
  if (fm >= 0) {
    const st = STRAIGHT_TOP[fm];
    if (st >= 0) return CAT(8) | (st << 16);
    return CAT(5) | TOP5[fm];
  }
  const all = s0 | s1 | s2 | s3;
  const quads = s0 & s1 & s2 & s3;
  if (quads) {
    const q = highBit(quads);
    return CAT(7) | (q << 16) | (highBit(all & ~(1 << q)) << 12);
  }
  const tripsPlus = (s0 & s1 & s2) | (s0 & s1 & s3) | (s0 & s2 & s3) | (s1 & s2 & s3);
  const pairsPlus = (s0 & s1) | (s0 & s2) | (s0 & s3) | (s1 & s2) | (s1 & s3) | (s2 & s3);
  const pairs = pairsPlus & ~tripsPlus;
  if (tripsPlus) {
    const t = highBit(tripsPlus);
    const rest = (tripsPlus & ~(1 << t)) | pairs;
    if (rest) return CAT(6) | (t << 16) | (highBit(rest) << 12);
  }
  const st = STRAIGHT_TOP[all];
  if (st >= 0) return CAT(4) | (st << 16);
  if (tripsPlus) {
    const t = highBit(tripsPlus);
    return CAT(3) | (t << 16) | (topN(all & ~(1 << t), 2) << 8);
  }
  if (pairs) {
    const p1 = highBit(pairs);
    const rest = pairs & ~(1 << p1);
    if (rest) {
      const p2 = highBit(rest);
      return CAT(2) | (p1 << 16) | (p2 << 12) | (highBit(all & ~(1 << p1) & ~(1 << p2)) << 8);
    }
    return CAT(1) | (p1 << 16) | (topN(all & ~(1 << p1), 3) << 4);
  }
  return CAT(0) | TOP5[all];
}

export function evaluate(cards: ArrayLike<number>): number {
  const m = [0, 0, 0, 0];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const bit = 1 << rankOf(c);
    const s = suitOf(c);
    if (m[s] & bit) throw new Error('重复的牌');
    m[s] |= bit;
  }
  return evalMasks(m[0], m[1], m[2], m[3]);
}

export const handCategory = (value: number): number => value >> 20;
