// 胜率（equity）计算：精确枚举 + 蒙特卡洛
import { evalMasks } from './evaluator.ts';
import { rankOf, suitOf } from './cards.ts';

export interface WeightedCombo {
  c1: number;
  c2: number;
  w: number;
}

export interface EquityResult {
  equity: number[]; // 每位玩家的胜率（平局按人数平分）
  win: number[];
  tie: number[];
  samples: number; // 计算的牌局数（加权前）
  exact: boolean;
  stdErr: number; // 蒙特卡洛的标准误差（精确枚举为 0）
  ms: number;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

const bitOf = (c: number) => 1 << rankOf(c);

/** 枚举从 deck 中取 r 张牌的所有组合，回调传入四个花色的点数掩码 */
function enumBoards(
  deck: number[],
  r: number,
  m0: number,
  m1: number,
  m2: number,
  m3: number,
  start: number,
  cb: (b0: number, b1: number, b2: number, b3: number) => void,
): void {
  if (r === 0) {
    cb(m0, m1, m2, m3);
    return;
  }
  const n = deck.length;
  for (let i = start; i <= n - r; i++) {
    const c = deck[i];
    const b = bitOf(c);
    switch (suitOf(c)) {
      case 0:
        enumBoards(deck, r - 1, m0 | b, m1, m2, m3, i + 1, cb);
        break;
      case 1:
        enumBoards(deck, r - 1, m0, m1 | b, m2, m3, i + 1, cb);
        break;
      case 2:
        enumBoards(deck, r - 1, m0, m1, m2 | b, m3, i + 1, cb);
        break;
      default:
        enumBoards(deck, r - 1, m0, m1, m2, m3 | b, i + 1, cb);
    }
  }
}

function masksOf(cards: number[]): [number, number, number, number] {
  const m: [number, number, number, number] = [0, 0, 0, 0];
  for (const c of cards) m[suitOf(c)] |= bitOf(c);
  return m;
}

/** 估算精确枚举需要的牌局数 */
export function exactWorkload(players: WeightedCombo[][], board: number[], dead: number[] = []): number {
  const used = new Set([...board, ...dead]);
  let tuples = 1;
  for (const p of players) tuples *= p.filter((c) => !used.has(c.c1) && !used.has(c.c2)).length;
  const remaining = 52 - board.length - dead.length - 2 * players.length;
  return tuples * choose(remaining, 5 - board.length);
}

/**
 * 计算多名玩家（2~3 人，每人一个加权组合列表）的胜率。
 * 工作量不超过 maxExact 时精确枚举，否则蒙特卡洛 mcSamples 次。
 */
export function calcEquity(
  players: WeightedCombo[][],
  board: number[],
  opts: { dead?: number[]; maxExact?: number; mcSamples?: number; seed?: number; onProgress?: (p: number) => void } = {},
): EquityResult {
  const t0 = Date.now();
  const dead = opts.dead ?? [];
  const n = players.length;
  const used = new Set([...board, ...dead]);
  const lists = players.map((p) => p.filter((c) => c.w > 0 && !used.has(c.c1) && !used.has(c.c2)));
  if (lists.some((l) => l.length === 0)) throw new Error('有玩家没有可用的手牌组合（可能与公共牌冲突）');
  const work = exactWorkload(lists, board, dead);
  const maxExact = opts.maxExact ?? 4e6;
  const res = work <= maxExact ? exact(lists, board, dead, opts.onProgress) : monteCarlo(lists, board, dead, opts.mcSamples ?? 300000, opts.seed ?? Date.now(), opts.onProgress);
  res.ms = Date.now() - t0;
  if (res.samples === 0) throw new Error('所有手牌组合彼此冲突，无法计算');
  void n;
  return res;
}

function finalize(win: number[], tie: number[], eqSum: number[], total: number, samples: number, exactFlag: boolean, eqSq: number[] = []): EquityResult {
  const equity = eqSum.map((x) => x / total);
  let stdErr = 0;
  if (!exactFlag && samples > 1) {
    // 取最大的标准误差
    stdErr = Math.max(...eqSq.map((sq, i) => Math.sqrt(Math.max(0, sq / total - equity[i] ** 2) / samples)));
  }
  return {
    equity,
    win: win.map((x) => x / total),
    tie: tie.map((x) => x / total),
    samples,
    exact: exactFlag,
    stdErr,
    ms: 0,
  };
}

function exact(lists: WeightedCombo[][], board: number[], dead: number[], onProgress?: (p: number) => void): EquityResult {
  const n = lists.length;
  const win = new Array(n).fill(0);
  const tie = new Array(n).fill(0);
  const eqSum = new Array(n).fill(0);
  let total = 0;
  let samples = 0;
  const boardMasks = masksOf(board);
  const need = 5 - board.length;
  const vals = new Array(n).fill(0);
  const pm: number[][] = new Array(n);
  const chosen: WeightedCombo[] = new Array(n);
  const totalTuples = lists.reduce((a, l) => a * l.length, 1);
  let tupleCount = 0;

  const runTuple = (weight: number) => {
    const usedSet = new Set<number>([...board, ...dead]);
    for (const c of chosen) {
      usedSet.add(c.c1);
      usedSet.add(c.c2);
    }
    const deck: number[] = [];
    for (let c = 0; c < 52; c++) if (!usedSet.has(c)) deck.push(c);
    for (let i = 0; i < n; i++) {
      const m = masksOf([chosen[i].c1, chosen[i].c2]);
      pm[i] = [m[0] | boardMasks[0], m[1] | boardMasks[1], m[2] | boardMasks[2], m[3] | boardMasks[3]];
    }
    enumBoards(deck, need, 0, 0, 0, 0, 0, (b0, b1, b2, b3) => {
      let best = -1;
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        const p = pm[i];
        const v = evalMasks(p[0] | b0, p[1] | b1, p[2] | b2, p[3] | b3);
        vals[i] = v;
        if (v > best) {
          best = v;
          cnt = 1;
        } else if (v === best) cnt++;
      }
      for (let i = 0; i < n; i++) {
        if (vals[i] === best) {
          if (cnt === 1) win[i] += weight;
          else tie[i] += weight;
          eqSum[i] += weight / cnt;
        }
      }
      total += weight;
      samples++;
    });
  };

  const rec = (k: number, weight: number, usedCards: number[]) => {
    if (k === n) {
      runTuple(weight);
      tupleCount++;
      if (onProgress && tupleCount % 16 === 0) onProgress(tupleCount / totalTuples);
      return;
    }
    for (const c of lists[k]) {
      if (usedCards.includes(c.c1) || usedCards.includes(c.c2)) {
        continue;
      }
      chosen[k] = c;
      rec(k + 1, weight * c.w, [...usedCards, c.c1, c.c2]);
    }
  };
  rec(0, 1, []);
  return finalize(win, tie, eqSum, total, samples, true);
}

/** xorshift32 */
function rng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function monteCarlo(lists: WeightedCombo[][], board: number[], dead: number[], samples: number, seed: number, onProgress?: (p: number) => void): EquityResult {
  const n = lists.length;
  const rand = rng(seed);
  const win = new Array(n).fill(0);
  const tie = new Array(n).fill(0);
  const eqSum = new Array(n).fill(0);
  const eqSq = new Array(n).fill(0);
  // 每位玩家按权重抽样的累积分布
  const cum = lists.map((l) => {
    const a = new Float64Array(l.length);
    let s = 0;
    l.forEach((c, i) => {
      s += c.w;
      a[i] = s;
    });
    return a;
  });
  const pick = (k: number): WeightedCombo => {
    const a = cum[k];
    const x = rand() * a[a.length - 1];
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return lists[k][lo];
  };
  const baseUsed = new Uint8Array(52);
  for (const c of board) baseUsed[c] = 1;
  for (const c of dead) baseUsed[c] = 1;
  const boardMasks = masksOf(board);
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const vals = new Array(n).fill(0);
  const pm = new Int32Array(4 * n);
  let done = 0;
  let attempts = 0;
  const order = Array.from({ length: n }, (_, i) => i);
  while (done < samples) {
    attempts++;
    if (attempts > samples * 50 && done === 0) break;
    used.set(baseUsed);
    let ok = true;
    // 随机顺序抽取，减少先抽玩家的偏差
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const k of order) {
      const c = pick(k);
      if (used[c.c1] || used[c.c2]) {
        ok = false;
        break;
      }
      used[c.c1] = 1;
      used[c.c2] = 1;
      const m = masksOf([c.c1, c.c2]);
      for (let s = 0; s < 4; s++) pm[k * 4 + s] = m[s] | boardMasks[s];
    }
    if (!ok) continue;
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0;
    for (let d = 0; d < need; d++) {
      let c: number;
      do c = Math.floor(rand() * 52);
      while (used[c]);
      used[c] = 1;
      const b = bitOf(c);
      const s = suitOf(c);
      if (s === 0) b0 |= b;
      else if (s === 1) b1 |= b;
      else if (s === 2) b2 |= b;
      else b3 |= b;
    }
    let best = -1;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const v = evalMasks(pm[i * 4] | b0, pm[i * 4 + 1] | b1, pm[i * 4 + 2] | b2, pm[i * 4 + 3] | b3);
      vals[i] = v;
      if (v > best) {
        best = v;
        cnt = 1;
      } else if (v === best) cnt++;
    }
    for (let i = 0; i < n; i++) {
      let e = 0;
      if (vals[i] === best) {
        if (cnt === 1) win[i]++;
        else tie[i]++;
        e = 1 / cnt;
      }
      eqSum[i] += e;
      eqSq[i] += e * e;
    }
    done++;
    if (onProgress && done % 20000 === 0) onProgress(done / samples);
  }
  return finalize(win, tie, eqSum, done, done, false, eqSq);
}
