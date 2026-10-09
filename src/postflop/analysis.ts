// 翻后求解结果的分析：按 169 类别汇总、动作说明、判分
import { parseCard } from '../lib/cards.ts';
import { HAND_CLASSES, NUM_CLASSES, comboToClass } from '../lib/hands.ts';
import { CHIPS_PER_BB, type NodeData, parseAction } from './types.ts';

const classCache = new Map<string, number>();
export function comboClass(hand: string): number {
  let v = classCache.get(hand);
  if (v === undefined) {
    v = comboToClass(parseCard(hand.slice(0, 2)), parseCard(hand.slice(2, 4)));
    classCache.set(hand, v);
  }
  return v;
}

/** 某个动作在当前节点的中文名称 */
export function describeAction(code: string, node: Pick<NodeData, 'pot' | 'bets'>): string {
  const a = parseAction(code);
  const bb = (x: number) => `${+(x / CHIPS_PER_BB).toFixed(1)}bb`;
  const toCall = Math.abs(node.bets[0] - node.bets[1]);
  switch (a.kind) {
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return `跟注 ${bb(toCall)}`;
    case 'bet':
      return `下注 ${bb(a.amount)}（${Math.round((a.amount / node.pot) * 100)}%）`;
    case 'raise':
      return `加注到 ${bb(a.amount)}`;
    case 'allin':
      return `全下 ${bb(a.amount)}`;
  }
}

/** 简短名称（按钮、图例用） */
export function shortAction(code: string, node: Pick<NodeData, 'pot' | 'bets'>): string {
  const a = parseAction(code);
  if (a.kind === 'bet') return `下注 ${Math.round((a.amount / node.pot) * 100)}%`;
  if (a.kind === 'raise') return `加注 ${+(a.amount / CHIPS_PER_BB).toFixed(1)}bb`;
  if (a.kind === 'allin') return '全下';
  return describeAction(code, node).split(' ')[0];
}

/** 动作颜色：弃牌灰蓝、过牌/跟注绿、下注按尺寸由橙到红、全下紫 */
export function actionColor(code: string, node: Pick<NodeData, 'pot'>): string {
  const a = parseAction(code);
  if (a.kind === 'fold') return 'var(--c-fold)';
  if (a.kind === 'check' || a.kind === 'call') return 'var(--c-call)';
  if (a.kind === 'allin') return 'var(--c-allin)';
  const ratio = Math.min(1.5, a.amount / Math.max(1, node.pot));
  // 33% → 橙，100%+ → 深红
  const t = Math.min(1, Math.max(0, (ratio - 0.25) / 1));
  const hue = 32 - 30 * t;
  const light = 58 - 14 * t;
  return `hsl(${hue.toFixed(0)} 78% ${light.toFixed(0)}%)`;
}

export interface ClassAgg {
  /** 每个类别：在范围中的组合数（按到达权重） */
  weight: Float64Array;
  /** freq[a][h]：类别 h 中采取动作 a 的比例 */
  freq: Float64Array[];
  ev: Float64Array; // 筹码（加权平均）
  equity: Float64Array;
  /** 每个动作的 EV（当前行动者） */
  actionEv: Float64Array[];
}

/** 把某位玩家的组合级数据汇总到 169 个类别 */
export function aggregate(node: NodeData, hands: string[], player: number): ClassAgg {
  const nA = node.kind === 'player' && node.player === player ? node.actions.length : 0;
  const n = hands.length;
  const w = node.weights[player];
  const nw = node.normWeights?.[player] ?? w;
  const norm = new Float64Array(NUM_CLASSES);
  const out: ClassAgg = {
    weight: new Float64Array(NUM_CLASSES),
    freq: Array.from({ length: nA }, () => new Float64Array(NUM_CLASSES)),
    ev: new Float64Array(NUM_CLASSES),
    equity: new Float64Array(NUM_CLASSES),
    actionEv: Array.from({ length: nA }, () => new Float64Array(NUM_CLASSES)),
  };
  for (let i = 0; i < n; i++) {
    if ((w[i] ?? 0) <= 0) continue;
    const wi = nw[i] > 0 ? nw[i] : 1e-9;
    const c = comboClass(hands[i]);
    out.weight[c] += w[i];
    norm[c] += wi;
    out.ev[c] += wi * (node.ev[player]?.[i] ?? 0);
    out.equity[c] += wi * (node.equity[player]?.[i] ?? 0);
    for (let a = 0; a < nA; a++) {
      out.freq[a][c] += wi * node.strategy[a * n + i];
      out.actionEv[a][c] += wi * (node.actionEv[a * n + i] ?? 0);
    }
  }
  for (let c = 0; c < NUM_CLASSES; c++) {
    const wc = norm[c];
    if (wc <= 0) continue;
    out.ev[c] /= wc;
    out.equity[c] /= wc;
    for (let a = 0; a < nA; a++) {
      out.freq[a][c] /= wc;
      out.actionEv[a][c] /= wc;
    }
  }
  return out;
}

/** 整体范围中各动作的比例（按组合加权） */
export function overallFreq(node: NodeData, n: number): number[] {
  const w = node.normWeights?.[node.player] ?? node.weights[node.player];
  const out = node.actions.map(() => 0);
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const wi = w[i] ?? 0;
    if (wi <= 0) continue;
    tot += wi;
    for (let a = 0; a < out.length; a++) out[a] += wi * node.strategy[a * n + i];
  }
  return out.map((x) => (tot > 0 ? x / tot : 0));
}

/** 范围的组合数（权重之和） */
export function rangeSize(node: NodeData, player: number): number {
  return node.weights[player].reduce((s, x) => s + x, 0);
}

export function rangeEquity(node: NodeData, player: number): number {
  const w = node.normWeights?.[player] ?? node.weights[player];
  let s = 0;
  let t = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i] * (node.equity[player]?.[i] ?? 0);
    t += w[i];
  }
  return t > 0 ? s / t : 0;
}

export function rangeEv(node: NodeData, player: number): number {
  const w = node.normWeights?.[player] ?? node.weights[player];
  let s = 0;
  let t = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i] * (node.ev[player]?.[i] ?? 0);
    t += w[i];
  }
  return t > 0 ? s / t : 0;
}

// ---------- 判分 ----------

export type PostflopGrade = 'best' | 'ok' | 'wrong';

/** 最高频率相差不超过这个值视为最佳 */
export const PF_BEST_MARGIN = 0.05;
/** 频率不低于这个值的动作视为可接受（混合策略中的低频选项） */
export const PF_OK_FREQ = 0.1;
/** EV 损失不超过底池的这个比例也视为可接受 */
export const PF_OK_EV_LOSS = 0.01;

export interface PostflopGradeResult {
  grade: PostflopGrade;
  freq: number;
  best: number; // 频率最高的动作序号
  evLoss: number; // 相对 EV 最高动作的损失（筹码，≥ 0）
  evs: number[];
  freqs: number[];
}

export function gradePostflop(node: NodeData, n: number, hand: number, action: number): PostflopGradeResult {
  const k = node.actions.length;
  const freqs = Array.from({ length: k }, (_, a) => node.strategy[a * n + hand]);
  const evs = Array.from({ length: k }, (_, a) => node.actionEv[a * n + hand] ?? 0);
  let best = 0;
  for (let a = 1; a < k; a++) if (freqs[a] > freqs[best]) best = a;
  const maxEv = Math.max(...evs);
  const evLoss = Math.max(0, maxEv - evs[action]);
  const freq = freqs[action];
  let grade: PostflopGrade;
  if (freq >= freqs[best] - PF_BEST_MARGIN) grade = 'best';
  else if (freq >= PF_OK_FREQ || evLoss <= PF_OK_EV_LOSS * node.pot) grade = 'ok';
  else grade = 'wrong';
  return { grade, freq, best, evLoss, evs, freqs };
}

export function className(h: number): string {
  return HAND_CLASSES[h].name;
}
