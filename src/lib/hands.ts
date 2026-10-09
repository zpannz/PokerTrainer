// 169 种起手牌类别与 13×13 格子
// 格子行列使用 GRID_RANKS（A 在前）。第 i 行第 j 列：i == j 对子；i < j 同花（右上）；i > j 不同花（左下）
import { makeCard, RANK_CHARS } from './cards.ts';

export const GRID_RANKS = 'AKQJT98765432';
export const NUM_CLASSES = 169;

export type HandKind = 'pair' | 'suited' | 'offsuit';

export interface HandClass {
  index: number; // = row * 13 + col
  row: number;
  col: number;
  name: string; // 例如 AA, AKs, AKo
  kind: HandKind;
  combos: number; // 6 / 4 / 12
  hi: number; // 评估器点数（0 = 2, 12 = A）
  lo: number;
}

/** 格子点数 → 评估器点数 */
const gridToRank = (g: number) => 12 - g;

export const HAND_CLASSES: HandClass[] = [];
for (let row = 0; row < 13; row++) {
  for (let col = 0; col < 13; col++) {
    const a = GRID_RANKS[row];
    const b = GRID_RANKS[col];
    let name: string;
    let kind: HandKind;
    if (row === col) {
      name = a + a;
      kind = 'pair';
    } else if (row < col) {
      name = a + b + 's';
      kind = 'suited';
    } else {
      name = b + a + 'o';
      kind = 'offsuit';
    }
    const hi = gridToRank(Math.min(row, col));
    const lo = gridToRank(Math.max(row, col));
    HAND_CLASSES.push({
      index: row * 13 + col,
      row,
      col,
      name,
      kind,
      combos: kind === 'pair' ? 6 : kind === 'suited' ? 4 : 12,
      hi,
      lo,
    });
  }
}

const NAME_TO_INDEX = new Map(HAND_CLASSES.map((h) => [h.name, h.index]));

export function classIndex(name: string): number {
  const n = normalizeClassName(name);
  const idx = NAME_TO_INDEX.get(n);
  if (idx === undefined) throw new Error(`无效的手牌: ${name}`);
  return idx;
}

export function normalizeClassName(name: string): string {
  const s = name.trim();
  if (s.length < 2) return s;
  let a = s[0].toUpperCase();
  let b = s[1].toUpperCase();
  const suf = s.slice(2).toLowerCase();
  if (RANK_CHARS.indexOf(a) < RANK_CHARS.indexOf(b)) [a, b] = [b, a];
  return a + b + suf;
}

export const TOTAL_COMBOS = 1326;

/** 某个类别的所有具体组合（两张牌） */
export function classCombos(index: number): [number, number][] {
  const h = HAND_CLASSES[index];
  const out: [number, number][] = [];
  if (h.kind === 'pair') {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = s1 + 1; s2 < 4; s2++) out.push([makeCard(h.hi, s1), makeCard(h.hi, s2)]);
  } else if (h.kind === 'suited') {
    for (let s = 0; s < 4; s++) out.push([makeCard(h.hi, s), makeCard(h.lo, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([makeCard(h.hi, s1), makeCard(h.lo, s2)]);
  }
  return out;
}

export const ALL_CLASS_COMBOS: [number, number][][] = HAND_CLASSES.map((h) => classCombos(h.index));

/** 两张具体的牌属于哪个类别 */
export function comboToClass(c1: number, c2: number): number {
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const gHi = 12 - hi;
  const gLo = 12 - lo;
  if (hi === lo) return gHi * 13 + gHi;
  const suited = (c1 & 3) === (c2 & 3);
  return suited ? gHi * 13 + gLo : gLo * 13 + gHi;
}

/**
 * 类别 a 与类别 b 之间互不冲突的组合对数量（用于计算牌的去除效应 card removal）
 */
export function compatiblePairs(a: number, b: number): number {
  let n = 0;
  for (const [x1, x2] of ALL_CLASS_COMBOS[a])
    for (const [y1, y2] of ALL_CLASS_COMBOS[b]) if (x1 !== y1 && x1 !== y2 && x2 !== y1 && x2 !== y2) n++;
  return n;
}

let compatCache: Uint8Array | null = null;
/** 169×169 的互不冲突组合对数量表 */
export function compatTable(): Uint8Array {
  if (compatCache) return compatCache;
  const t = new Uint8Array(NUM_CLASSES * NUM_CLASSES);
  for (let a = 0; a < NUM_CLASSES; a++)
    for (let b = a; b < NUM_CLASSES; b++) {
      const v = compatiblePairs(a, b);
      t[a * NUM_CLASSES + b] = v;
      t[b * NUM_CLASSES + a] = v;
    }
  compatCache = t;
  return t;
}

/** 范围（每个类别 0~1 的权重）中的组合数 */
export function rangeCombos(weights: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < NUM_CLASSES; i++) s += weights[i] * HAND_CLASSES[i].combos;
  return s;
}

export function rangePercent(weights: ArrayLike<number>): number {
  return (rangeCombos(weights) / TOTAL_COMBOS) * 100;
}
