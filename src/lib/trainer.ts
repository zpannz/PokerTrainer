// 翻前训练：出题、判分、统计
import { type ActionKey, type Format, type Position, type Spot, type SpotCategory, spotCategories, spotsOf } from './formats.ts';
import { ALL_CLASS_COMBOS, HAND_CLASSES, NUM_CLASSES } from './hands.ts';
import type { Chart } from '../data/charts.ts';
import { load, save } from './storage.ts';

export type Grade = 'best' | 'ok' | 'wrong';

export const GRADE_NAMES: Record<Grade, string> = {
  best: '最佳',
  ok: '可接受（混合策略中的低频选项）',
  wrong: '错误',
};

/** 低于这个频率的动作视为错误 */
export const OK_THRESHOLD = 0.1;
/** 与最高频率相差不超过这个值即视为最佳 */
export const BEST_MARGIN = 0.05;

export function gradeAction(chart: Chart, hand: number, action: ActionKey): { grade: Grade; freq: number; best: ActionKey } {
  let best: ActionKey = chart.actions[0];
  let max = -1;
  for (const a of chart.actions) {
    const f = chart.freq[a]![hand];
    if (f > max) {
      max = f;
      best = a;
    }
  }
  const freq = chart.freq[action]?.[hand] ?? 0;
  const grade: Grade = freq >= max - BEST_MARGIN ? 'best' : freq >= OK_THRESHOLD ? 'ok' : 'wrong';
  return { grade, freq, best };
}

/** 出题时的手牌权重：有决策意义的手牌（会入池、混合策略）权重更高，纯弃牌的垃圾牌少出 */
export function handWeights(chart: Chart): Float64Array {
  const w = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    const p = chart.prior[h];
    if (p <= 0) continue;
    const fold = chart.freq.fold?.[h] ?? 0;
    let max = 0;
    for (const a of chart.actions) max = Math.max(max, chart.freq[a]![h]);
    let interest = 0.12 + (1 - fold);
    if (max < 0.95) interest += 1.5; // 混合策略
    // 与边界相邻的弃牌手牌也值得考
    if (fold > 0.95 && nearBoundary(chart, h)) interest += 0.8;
    w[h] = p * HAND_CLASSES[h].combos * interest;
  }
  return w;
}

function nearBoundary(chart: Chart, h: number): boolean {
  const { row, col } = HAND_CLASSES[h];
  for (const [dr, dc] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r > 12 || c < 0 || c > 12) continue;
    const n = r * 13 + c;
    if ((chart.freq.fold?.[n] ?? 0) < 0.6 && chart.prior[n] > 0) return true;
  }
  return false;
}

export function weightedPick(weights: ArrayLike<number>, rand: () => number): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return Math.floor(rand() * weights.length);
  let x = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

export function randomCombo(hand: number, rand: () => number): [number, number] {
  const cs = ALL_CLASS_COMBOS[hand];
  const c = cs[Math.floor(rand() * cs.length)];
  // 随机决定两张牌的显示顺序：大牌在前
  return (c[0] >> 2) >= (c[1] >> 2) ? c : [c[1], c[0]];
}

// ---------- 统计 ----------

export interface Tally {
  n: number;
  best: number;
  ok: number;
  wrong: number;
}

export interface Mistake {
  spotId: string;
  hand: number;
  chosen: ActionKey;
  t: number;
  /** 之后又答对了几次（答对 2 次后从错题本移除） */
  fixed: number;
}

export interface TrainingStats {
  /** key = `${formatId}|${category}|${hero}` */
  tallies: Record<string, Tally>;
  mistakes: Mistake[];
  totalAnswered: number;
}

const STATS_KEY = 'trainingStats';

export function loadStats(): TrainingStats {
  return load<TrainingStats>(STATS_KEY, { tallies: {}, mistakes: [], totalAnswered: 0 });
}

export function saveStats(s: TrainingStats): void {
  save(STATS_KEY, s);
}

export function resetStats(): TrainingStats {
  const s: TrainingStats = { tallies: {}, mistakes: [], totalAnswered: 0 };
  saveStats(s);
  return s;
}

export function tallyKey(formatId: string, category: SpotCategory, hero: Position): string {
  return `${formatId}|${category}|${hero}`;
}

export function recordAnswer(stats: TrainingStats, spot: Spot, hand: number, chosen: ActionKey, grade: Grade): void {
  stats.totalAnswered++;
  for (const cat of spotCategories(spot)) {
    const k = tallyKey(spot.format.id, cat, spot.hero);
    const t = (stats.tallies[k] ??= { n: 0, best: 0, ok: 0, wrong: 0 });
    t.n++;
    t[grade]++;
  }
  const idx = stats.mistakes.findIndex((m) => m.spotId === spot.id && m.hand === hand);
  if (grade === 'wrong') {
    if (idx >= 0) {
      stats.mistakes[idx].t = Date.now();
      stats.mistakes[idx].chosen = chosen;
      stats.mistakes[idx].fixed = 0;
    } else stats.mistakes.push({ spotId: spot.id, hand, chosen, t: Date.now(), fixed: 0 });
    if (stats.mistakes.length > 400) stats.mistakes.splice(0, stats.mistakes.length - 400);
  } else if (idx >= 0) {
    stats.mistakes[idx].fixed++;
    if (stats.mistakes[idx].fixed >= 2) stats.mistakes.splice(idx, 1);
  }
}

export function errorRate(stats: TrainingStats, spot: Spot): number {
  let n = 0;
  let wrong = 0;
  for (const cat of spotCategories(spot)) {
    const t = stats.tallies[tallyKey(spot.format.id, cat, spot.hero)];
    if (t) {
      n += t.n;
      wrong += t.wrong;
    }
  }
  // 平滑：没有数据时视为 20% 错误率
  return (wrong + 1) / (n + 5);
}

// ---------- 出题 ----------

export interface Question {
  spot: Spot;
  chart: Chart;
  hand: number;
  cards: [number, number];
  fromMistakes: boolean;
}

export function buildPool(format: Format, categories: SpotCategory[], positions: Position[] | null): Spot[] {
  return spotsOf(format).filter(
    (s) => spotCategories(s).some((c) => categories.includes(c)) && (!positions || positions.length === 0 || positions.includes(s.hero)),
  );
}

/**
 * 随机出题。mistakeBias：从错题本中抽题的概率；同时按各场景的历史错误率加权选场景。
 */
export function nextQuestion(
  pool: Spot[],
  stats: TrainingStats,
  chartOf: (id: string) => Chart,
  rand: () => number,
  mistakeBias = 0.3,
  avoid?: { spotId: string; hand: number },
): Question {
  if (pool.length === 0) throw new Error('题库为空，请至少选择一个场景');
  const poolIds = new Set(pool.map((s) => s.id));
  const relevant = stats.mistakes.filter((m) => poolIds.has(m.spotId) && !(avoid && m.spotId === avoid.spotId && m.hand === avoid.hand));
  if (relevant.length > 0 && rand() < mistakeBias) {
    const m = relevant[Math.floor(rand() * relevant.length)];
    const spot = pool.find((s) => s.id === m.spotId)!;
    const chart = chartOf(spot.id);
    if (chart.prior[m.hand] > 0) return { spot, chart, hand: m.hand, cards: randomCombo(m.hand, rand), fromMistakes: true };
  }
  // 先选场景分类（各分类机会均等，再按错误率加权），再在分类内按错误率选具体场景
  const groups = new Map<SpotCategory, Spot[]>();
  for (const s of pool) {
    const c = spotCategories(s)[0];
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(s);
  }
  const cats = [...groups.keys()];
  const catW = cats.map((c) => {
    const list = groups.get(c)!;
    return 0.5 + (list.reduce((a, s) => a + errorRate(stats, s), 0) / list.length) * 4;
  });
  const list = groups.get(cats[weightedPick(catW, rand)])!;
  const spot = list[weightedPick(list.map((s) => 0.5 + errorRate(stats, s) * 4), rand)];
  const chart = chartOf(spot.id);
  let hand = weightedPick(handWeights(chart), rand);
  if (avoid && avoid.spotId === spot.id && avoid.hand === hand) hand = weightedPick(handWeights(chart), rand);
  return { spot, chart, hand, cards: randomCombo(hand, rand), fromMistakes: false };
}
