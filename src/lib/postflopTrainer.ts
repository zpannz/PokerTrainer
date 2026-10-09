// 翻后训练：出题、判分、统计（题目来自预计算牌面库或自己求解的局面）
import { load, save } from './storage.ts';
import { weightedPick } from './trainer.ts';
import { type PostflopGrade, gradePostflop } from '../postflop/analysis.ts';
import { type NodeData, type SolvedSpot, parseAction } from '../postflop/types.ts';

export type NodeType = 'first' | 'vsCheck' | 'vsBet' | 'vsRaise';

export const NODE_TYPE_NAMES: Record<NodeType, string> = {
  first: '首先行动',
  vsCheck: '面对过牌（是否下注）',
  vsBet: '面对下注（弃/跟/加）',
  vsRaise: '面对加注',
};

/** 按本街到达节点前的动作判断节点类型 */
export function nodeType(spot: SolvedSpot, history: number[]): NodeType {
  let aggr = 0;
  let checks = 0;
  for (let i = 0; i < history.length; i++) {
    const n = spot.nodes[history.slice(0, i).join(',')];
    if (!n || n.kind !== 'player') continue;
    const a = parseAction(n.actions[history[i]]);
    if (a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin') aggr++;
    if (a.kind === 'check') checks++;
  }
  if (aggr === 0) return checks > 0 ? 'vsCheck' : 'first';
  return aggr === 1 ? 'vsBet' : 'vsRaise';
}

/** 一个节点前面的行动描述，例如 "BB 过牌 → BTN 下注 1.8bb" */
export function describeLine(spot: SolvedSpot, history: number[]): string {
  const players = spot.players ?? ['OOP', 'IP'];
  const parts: string[] = [];
  for (let i = 0; i < history.length; i++) {
    const n = spot.nodes[history.slice(0, i).join(',')];
    if (!n || n.kind !== 'player') continue;
    const a = parseAction(n.actions[history[i]]);
    const bb = (x: number) => `${+(x / 100).toFixed(1)}bb`;
    const txt =
      a.kind === 'check'
        ? '过牌'
        : a.kind === 'call'
          ? '跟注'
          : a.kind === 'fold'
            ? '弃牌'
            : a.kind === 'bet'
              ? `下注 ${bb(a.amount)}（${Math.round((a.amount / n.pot) * 100)}% 底池）`
              : a.kind === 'raise'
                ? `加注到 ${bb(a.amount)}`
                : `全下 ${bb(a.amount)}`;
    parts.push(`${players[n.player]} ${txt}`);
  }
  return parts.join(' → ');
}

/** 可以出题的节点：玩家行动且至少两个动作 */
export function decisionNodes(spot: SolvedSpot, types?: NodeType[]): { key: string; history: number[]; node: NodeData; type: NodeType }[] {
  const out: { key: string; history: number[]; node: NodeData; type: NodeType }[] = [];
  for (const [key, node] of Object.entries(spot.nodes)) {
    if (node.kind !== 'player' || node.actions.length < 2 || node.actionEv.length === 0) continue;
    const history = key === '' ? [] : key.split(',').map(Number);
    if (history.length !== node.history.length && node.history.length > 0) continue;
    const type = nodeType(spot, history);
    if (types && types.length && !types.includes(type)) continue;
    // 到达概率太低的节点（双方都很少走到）不出题
    const reach = node.weights[node.player].reduce((s, x) => s + x, 0);
    if (reach < 3) continue;
    out.push({ key, history, node, type });
  }
  return out;
}

/** 出题时的手牌权重：到达权重 × 有决策意义（混合策略或动作间 EV 差距明显） */
export function handPickWeights(node: NodeData): Float64Array {
  const n = node.weights[node.player].length;
  const k = node.actions.length;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = node.weights[node.player][i];
    if (r < 0.05) continue;
    let max = 0;
    let evMax = -Infinity;
    let evMin = Infinity;
    for (let a = 0; a < k; a++) {
      max = Math.max(max, node.strategy[a * n + i]);
      evMax = Math.max(evMax, node.actionEv[a * n + i]);
      evMin = Math.min(evMin, node.actionEv[a * n + i]);
    }
    let interest = 0.4;
    if (max < 0.9) interest += 1.2; // 混合策略
    if (evMax - evMin > node.pot * 0.05) interest += 0.6; // 选错代价明显
    w[i] = r * interest;
  }
  return w;
}

// ---------- 统计 ----------

export interface PfTally {
  n: number;
  best: number;
  ok: number;
  wrong: number;
  evLoss: number; // 累计 EV 损失（bb）
}

export interface PfMistake {
  ref: string; // "pre:<dir>/<flop>" 或 "solve:<key>"
  history: number[];
  hand: string;
  chosen: number;
  t: number;
  fixed: number;
  title: string;
}

export interface PfStats {
  tallies: Record<string, PfTally>; // key = `${scenarioTitle}|${nodeType}`
  mistakes: PfMistake[];
  total: number;
}

const KEY = 'postflopStats';

export function loadPfStats(): PfStats {
  return load<PfStats>(KEY, { tallies: {}, mistakes: [], total: 0 });
}

export function savePfStats(s: PfStats): void {
  save(KEY, s);
}

export function resetPfStats(): PfStats {
  const s: PfStats = { tallies: {}, mistakes: [], total: 0 };
  savePfStats(s);
  return s;
}

export function recordPf(
  stats: PfStats,
  q: { ref: string; history: number[]; hand: string; group: string; type: NodeType; title: string },
  chosen: number,
  grade: PostflopGrade,
  evLossBB: number,
): void {
  stats.total++;
  const k = `${q.group}|${q.type}`;
  const t = (stats.tallies[k] ??= { n: 0, best: 0, ok: 0, wrong: 0, evLoss: 0 });
  t.n++;
  t[grade]++;
  t.evLoss += evLossBB;
  const idx = stats.mistakes.findIndex((m) => m.ref === q.ref && m.hand === q.hand && m.history.join(',') === q.history.join(','));
  if (grade === 'wrong') {
    if (idx >= 0) Object.assign(stats.mistakes[idx], { chosen, t: Date.now(), fixed: 0 });
    else stats.mistakes.push({ ref: q.ref, history: q.history, hand: q.hand, chosen, t: Date.now(), fixed: 0, title: q.title });
    if (stats.mistakes.length > 300) stats.mistakes.splice(0, stats.mistakes.length - 300);
  } else if (idx >= 0) {
    stats.mistakes[idx].fixed++;
    if (stats.mistakes[idx].fixed >= 2) stats.mistakes.splice(idx, 1);
  }
}

export function pfErrorRate(stats: PfStats, group: string, type: NodeType): number {
  const t = stats.tallies[`${group}|${type}`];
  return t ? (t.wrong + 1) / (t.n + 5) : 0.2;
}

export interface PfQuestion {
  ref: string;
  spot: SolvedSpot;
  history: number[];
  node: NodeData;
  type: NodeType;
  handIndex: number;
  hand: string;
  group: string; // 统计分组（局面标题）
  fromMistakes: boolean;
}

/** 在一个求解结果里出一道题 */
export function questionFromSpot(spot: SolvedSpot, ref: string, group: string, types: NodeType[], stats: PfStats, rand: () => number): PfQuestion | null {
  const nodes = decisionNodes(spot, types);
  if (nodes.length === 0) return null;
  const pick = nodes[weightedPick(nodes.map((n) => 0.5 + pfErrorRate(stats, group, n.type) * 4), rand)];
  const w = handPickWeights(pick.node);
  if (w.every((x) => x <= 0)) return null;
  const i = weightedPick(w, rand);
  return { ref, spot, history: pick.history, node: pick.node, type: pick.type, handIndex: i, hand: spot.hands[pick.node.player][i], group, fromMistakes: false };
}

export function gradeQuestion(q: PfQuestion, action: number) {
  return gradePostflop(q.node, q.spot.hands[q.node.player].length, q.handIndex, action);
}
