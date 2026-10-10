// AI 用的范围估计与胜率计算：按对手的翻前行动估计初始范围，翻后按行动逐街收窄，再用蒙特卡洛计算胜率
import { evalMasks } from '../lib/evaluator.ts';
import { rankOf, suitOf } from '../lib/cards.ts';
import { ALL_CLASS_COMBOS, HAND_CLASSES, NUM_CLASSES, compatTable } from '../lib/hands.ts';
import { getEquityMatrix } from '../data/equityData.ts';
import type { Rng } from './rng.ts';

/** 1326 个具体组合 */
export const COMBOS: [number, number][] = [];
export const COMBO_CLASS: number[] = [];
const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);
for (let h = 0; h < NUM_CLASSES; h++)
  for (const [a, b] of ALL_CLASS_COMBOS[h]) {
    COMBO_INDEX[a * 52 + b] = COMBOS.length;
    COMBO_INDEX[b * 52 + a] = COMBOS.length;
    COMBOS.push([a, b]);
    COMBO_CLASS.push(h);
  }
export const comboIndex = (a: number, b: number) => COMBO_INDEX[a * 52 + b];

let strengthCache: Float64Array | null = null;
/**
 * 翻前牌力（0~1，1 最强）：对随机手牌的胜率加上同花/连张/对子的可玩性，再换算成按组合数计的百分位
 */
export function preflopStrength(): Float64Array {
  if (strengthCache) return strengthCache;
  const eq = getEquityMatrix();
  const compat = compatTable();
  const score = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    let w = 0;
    let s = 0;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const x = compat[h * NUM_CLASSES + c];
      w += x;
      s += x * eq[h * NUM_CLASSES + c];
    }
    const k = HAND_CLASSES[h];
    let bonus = 0;
    if (k.kind === 'suited') bonus += 0.025;
    if (k.kind !== 'pair') {
      const gap = k.hi - k.lo - 1;
      bonus += gap === 0 ? 0.015 : gap === 1 ? 0.008 : 0;
      if (k.kind === 'offsuit' && k.lo < 7) bonus -= 0.015;
    } else bonus += 0.02;
    score[h] = s / w + bonus;
  }
  const order = Array.from({ length: NUM_CLASSES }, (_, i) => i).sort((a, b) => score[b] - score[a]);
  const out = new Float64Array(NUM_CLASSES);
  let cum = 0;
  for (const h of order) {
    const c = HAND_CLASSES[h].combos;
    out[h] = 1 - (cum + c / 2) / 1326;
    cum += c;
  }
  strengthCache = out;
  return out;
}

/** 按牌力取前 top 比例的范围（带线性过渡）；exclude 为去掉最强的部分（按权重 excludeWeight 保留） */
export function topRange(top: number, exclude = 0, excludeWeight = 1): Float64Array {
  const s = preflopStrength();
  const out = new Float64Array(NUM_CLASSES);
  const band = 0.03;
  for (let h = 0; h < NUM_CLASSES; h++) {
    const pct = 1 - s[h]; // 0 = 最强
    let w = Math.max(0, Math.min(1, (top - pct) / band + 0.5));
    if (exclude > 0 && pct < exclude) w *= excludeWeight;
    out[h] = w;
  }
  return out;
}

export type PreCategory = 'any' | 'limp' | 'open' | 'callOpen' | '3bet' | 'call3bet' | '4bet' | 'shove' | 'callShove';

/** 按翻前行动类型估计的范围（169 类别权重） */
export function categoryRange(cat: PreCategory, openWidth = 0.25, depthBB = 100): Float64Array {
  switch (cat) {
    case 'any':
      return new Float64Array(NUM_CLASSES).fill(1);
    case 'limp':
      return topRange(0.55, 0.06, 0.3);
    case 'open':
      return topRange(openWidth);
    case 'callOpen':
      return topRange(Math.min(0.42, openWidth + 0.06), 0.035, 0.35);
    case '3bet':
      return topRange(0.09);
    case 'call3bet':
      return topRange(0.13, 0.02, 0.3);
    case '4bet':
      return topRange(0.035);
    case 'shove':
      return topRange(depthBB <= 8 ? 0.45 : depthBB <= 12 ? 0.3 : depthBB <= 20 ? 0.18 : 0.08);
    case 'callShove':
      return topRange(depthBB <= 8 ? 0.3 : depthBB <= 12 ? 0.18 : depthBB <= 20 ? 0.11 : 0.05);
  }
}

/** 169 类别权重 → 1326 组合权重（去掉与已知牌冲突的组合） */
export function toCombos(classW: ArrayLike<number>, dead: number[]): Float64Array {
  const out = new Float64Array(COMBOS.length);
  const deadSet = new Uint8Array(52);
  for (const c of dead) deadSet[c] = 1;
  for (let i = 0; i < COMBOS.length; i++) {
    const [a, b] = COMBOS[i];
    if (deadSet[a] || deadSet[b]) continue;
    out[i] = classW[COMBO_CLASS[i]];
  }
  return out;
}

const bit = (c: number) => 1 << rankOf(c);

function masks(cards: number[]): [number, number, number, number] {
  const m: [number, number, number, number] = [0, 0, 0, 0];
  for (const c of cards) m[suitOf(c)] |= bit(c);
  return m;
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** 听牌：4 张同花（至少一张手牌）、两头顺子听牌（简化判断） */
export function drawStrength(hole: [number, number], board: number[]): number {
  if (board.length >= 5) return 0;
  const all = [...hole, ...board];
  let flush = false;
  for (let s = 0; s < 4; s++) {
    const n = all.filter((c) => suitOf(c) === s).length;
    if (n === 4 && (suitOf(hole[0]) === s || suitOf(hole[1]) === s)) flush = true;
  }
  let rm = 0;
  for (const c of all) rm |= bit(c);
  if (rm & (1 << 12)) rm |= 1 << 13; // A 也可以当 1，用第 13 位表示（下面整体右移一位）
  const ext = ((rm & 0x1fff) << 1) | ((rm >> 12) & 1);
  let oesd = false;
  let gut = false;
  for (let lo = 0; lo + 4 <= 13; lo++) {
    const win = (ext >> lo) & 0x1f;
    const cnt = popcount(win);
    if (cnt === 4) {
      // 两头：连续 4 张且两端都可以补
      if (win === 0x0f || win === 0x1e) oesd = true;
      else gut = true;
    }
  }
  const holeRanks = bit(hole[0]) | bit(hole[1]);
  // 顺子听牌必须用到手牌
  let boardOnly = 0;
  for (const c of board) boardOnly |= bit(c);
  const usesHole = (holeRanks & ~boardOnly) !== 0;
  const straight = usesHole && (oesd || gut);
  let v = 0;
  if (flush && straight) v = 0.72;
  else if (flush) v = 0.6;
  else if (oesd && usesHole) v = 0.5;
  else if (straight) v = 0.38;
  if (board.length === 4) v *= 0.85;
  return v;
}

/** 范围中每个组合在当前牌面上的牌力百分位（0~1，1 最强），听牌按固定的百分位计 */
export function boardPercentiles(range: Float64Array, board: number[]): Float64Array {
  const bm = masks(board);
  const deadSet = new Uint8Array(52);
  for (const c of board) deadSet[c] = 1;
  const vals = new Float64Array(COMBOS.length);
  const idx: number[] = [];
  let total = 0;
  for (let i = 0; i < COMBOS.length; i++) {
    if (range[i] <= 0) continue;
    const [a, b] = COMBOS[i];
    if (deadSet[a] || deadSet[b]) continue;
    const m = [bm[0], bm[1], bm[2], bm[3]];
    m[suitOf(a)] |= bit(a);
    m[suitOf(b)] |= bit(b);
    vals[i] = evalMasks(m[0], m[1], m[2], m[3]);
    idx.push(i);
    total += range[i];
  }
  idx.sort((x, y) => vals[x] - vals[y]);
  const out = new Float64Array(COMBOS.length);
  let cum = 0;
  for (let k = 0; k < idx.length; k++) {
    // 牌力相同的组合取相同的百分位
    let j = k;
    let w = 0;
    while (j < idx.length && vals[idx[j]] === vals[idx[k]]) w += range[idx[j++]];
    const pct = total > 0 ? (cum + w / 2) / total : 0.5;
    for (let t = k; t < j; t++) out[idx[t]] = pct;
    cum += w;
    k = j - 1;
  }
  if (board.length < 5)
    for (const i of idx) {
      const d = drawStrength(COMBOS[i], board);
      if (d > out[i]) out[i] = d;
    }
  return out;
}

export type PostKind = 'bet' | 'raise' | 'call' | 'check';

/** 按一个翻后行动收窄范围（原地修改） */
export function narrowRange(range: Float64Array, board: number[], kind: PostKind, sizeRatio = 0.6): void {
  const pct = boardPercentiles(range, board);
  const valueCut = kind === 'raise' ? 0.72 : 0.5 - Math.min(0.15, (sizeRatio - 0.5) * 0.2);
  for (let i = 0; i < range.length; i++) {
    if (range[i] <= 0) continue;
    const p = pct[i];
    let f = 1;
    if (kind === 'bet' || kind === 'raise') {
      // 价值部分全部保留，其余作为诈唬按较低权重保留
      f = p >= valueCut ? 1 : kind === 'raise' ? 0.12 : 0.3;
      if (p >= 0.35 && p < 0.55 && kind === 'bet') f = Math.max(f, 0.35);
    } else if (kind === 'call') {
      f = p < 0.25 ? 0.15 : p > 0.92 ? 0.55 : 1;
    } else {
      f = p > 0.85 ? 0.45 : 1;
    }
    range[i] *= f;
  }
}

/**
 * 蒙特卡洛：手牌 hole 对若干对手范围的胜率（平局按人数平分）
 */
export function equityVsRanges(hole: [number, number], board: number[], ranges: Float64Array[], samples: number, rand: Rng): number {
  if (ranges.length === 0) return 1;
  const dead = new Uint8Array(52);
  dead[hole[0]] = 1;
  dead[hole[1]] = 1;
  for (const c of board) dead[c] = 1;
  // 每个对手可用组合的累积分布
  const lists = ranges.map((r) => {
    const idx: number[] = [];
    const cum: number[] = [];
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      if (r[i] <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead[a] || dead[b]) continue;
      s += r[i];
      idx.push(i);
      cum.push(s);
    }
    return { idx, cum, total: s };
  });
  if (lists.some((l) => l.total <= 0)) return 0.5;
  const bm = masks(board);
  const hm = masks(hole);
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  let eqSum = 0;
  let done = 0;
  let attempts = 0;
  const opp: number[] = [];
  while (done < samples && attempts < samples * 20) {
    attempts++;
    used.set(dead);
    opp.length = 0;
    let ok = true;
    for (const l of lists) {
      const x = rand() * l.total;
      let lo = 0;
      let hi = l.cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (l.cum[mid] > x) hi = mid;
        else lo = mid + 1;
      }
      const [a, b] = COMBOS[l.idx[lo]];
      if (used[a] || used[b]) {
        ok = false;
        break;
      }
      used[a] = 1;
      used[b] = 1;
      opp.push(a, b);
    }
    if (!ok) continue;
    const r = [0, 0, 0, 0];
    for (let d = 0; d < need; d++) {
      let c: number;
      do c = Math.floor(rand() * 52);
      while (used[c]);
      used[c] = 1;
      r[suitOf(c)] |= bit(c);
    }
    const b0 = bm[0] | r[0];
    const b1 = bm[1] | r[1];
    const b2 = bm[2] | r[2];
    const b3 = bm[3] | r[3];
    const mine = evalMasks(hm[0] | b0, hm[1] | b1, hm[2] | b2, hm[3] | b3);
    let best = mine;
    let ties = 1;
    let lose = false;
    for (let k = 0; k < opp.length; k += 2) {
      const a = opp[k];
      const b = opp[k + 1];
      const m = [b0, b1, b2, b3];
      m[suitOf(a)] |= bit(a);
      m[suitOf(b)] |= bit(b);
      const v = evalMasks(m[0], m[1], m[2], m[3]);
      if (v > best) {
        lose = true;
        break;
      }
      if (v === best) ties++;
    }
    if (!lose) eqSum += 1 / ties;
    done++;
  }
  return done > 0 ? eqSum / done : 0.5;
}
