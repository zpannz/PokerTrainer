// AI 对手的决策
// 翻前：能对应到范围库场景时按（风格调整后的）范围表行动；锦标赛短筹码用全下/弃牌表；其余局面按翻前牌力和风格参数
// 翻后：能匹配预计算牌面时按求解结果行动；否则按"对估计范围的胜率"、底池赔率和风格参数决策
import { type Position, fourBetSize, openSize, parseSpotId, threeBetSize } from '../lib/formats.ts';
import { comboToClass } from '../lib/hands.ts';
import { getChart } from '../data/charts.ts';
import { cardToString } from '../lib/cards.ts';
import { type Act, type HandState, currentPlayer, legalActions, potTotal } from './engine.ts';
import { type GameKind, effectiveBB, preflopSituation, seatPositions, styledChart } from './preflop.ts';
import { type PostKind, type PreCategory, categoryRange, equityVsRanges, narrowRange, preflopStrength, toCombos } from './ranges.ts';
import type { Style } from './styles.ts';
import type { Rng } from './rng.ts';
import type { NodeData } from '../postflop/types.ts';
import { parseAction } from '../postflop/types.ts';

export interface SolverView {
  node: NodeData;
  hands: string[];
  /** AI 手牌在 hands 中的序号（-1 = 不在求解范围内） */
  handIndex: number;
  /** 树中的筹码 → 实际筹码 */
  toReal: (treeChips: number) => number;
}

export interface AiContext {
  st: HandState;
  seat: number;
  style: Style;
  game: GameKind;
  rand: Rng;
  solver?: SolverView | null;
  /** 蒙特卡洛样本数 */
  samples?: number;
}

export interface AiDecision extends Act {
  /** 决策依据（调试/显示用） */
  basis: 'chart' | 'pushfold' | 'preflop-heuristic' | 'solver' | 'equity';
}

const roundTo = (x: number, unit: number) => Math.max(unit, Math.round(x / unit) * unit);

function chipUnit(st: HandState): number {
  return Math.max(1, Math.round(st.bb / 20));
}

/** 把"加注到"的金额修正为合法值；接近全下时直接全下 */
function raiseAct(st: HandState, to: number, allinFrac = 0.45): Act {
  const L = legalActions(st);
  if (!L.canRaise) return { type: L.call > 0 ? 'call' : 'check' };
  let t = roundTo(to, chipUnit(st));
  // 投入超过筹码的一定比例：直接全下
  if (t >= allinFrac * L.maxTo) t = L.maxTo;
  t = Math.max(L.minTo, Math.min(L.maxTo, t));
  return { type: L.isBet ? 'bet' : 'raise', to: t };
}

export function aiDecide(ctx: AiContext): AiDecision {
  const { st } = ctx;
  if (!currentPlayer(st) || currentPlayer(st)!.seat !== ctx.seat) throw new Error('不是这名玩家行动');
  return st.street === 0 ? preflop(ctx) : postflop(ctx);
}

// ---------- 翻前 ----------

function preflop(ctx: AiContext): AiDecision {
  const { st, seat, style, rand } = ctx;
  const me = currentPlayer(st)!;
  const L = legalActions(st);
  const sit = preflopSituation(st, seat, ctx.game);
  const h = comboToClass(me.hole[0], me.hole[1]);
  const bb = st.bb;
  if (sit.spotId) {
    const chart = getChart(sit.spotId);
    const sf = styledChart(chart, style);
    const r = sf.raise[h];
    const c = sf.call[h];
    const x = rand();
    const spot = parseSpotId(sit.spotId);
    const basis = spot.type === 'push' || spot.type === 'vsShove' || spot.type === 'reshove' || spot.type === 'vsReshove' ? 'pushfold' : 'chart';
    if (x < r) {
      if (sf.aggressive === 'allin') return { ...raiseAct(st, L.maxTo), basis };
      const f = sit.format;
      let to: number;
      if (spot.type === 'rfi') to = openSize(f, sit.pos) * bb;
      else if (spot.type === 'vsOpen') {
        const o = openSize(f, spot.villain!);
        const t = threeBetSize(f, spot.villain!, sit.pos);
        to = t === null ? L.maxTo : sit.raises[0].to * (t / o);
      } else if (spot.type === 'vs3bet') {
        const fb = fourBetSize(f, sit.raises[1].to / bb);
        to = fb === null ? L.maxTo : sit.raises[1].to * 2.25;
      } else to = L.maxTo;
      return { ...raiseAct(st, to), basis };
    }
    if (x < r + c) return { type: L.call > 0 ? 'call' : 'check', basis };
    return { type: L.canCheck ? 'check' : 'fold', basis };
  }
  return { ...preflopHeuristic(ctx, sit.raises.length, sit.limpers.length + sit.callersAfterRaise.length, sit.pos), basis: 'preflop-heuristic' };
}

/** 没有范围表可查时：按翻前牌力百分位、需要投入的筹码和风格参数决策 */
function preflopHeuristic(ctx: AiContext, R: number, callers: number, pos: Position): Act {
  const { st, style, rand } = ctx;
  const me = currentPlayer(st)!;
  const L = legalActions(st);
  const bb = st.bb;
  const p = 1 - preflopStrength()[comboToClass(me.hole[0], me.hole[1])]; // 0 = 最强
  const loose = style.pre.loose;
  const aggr = style.pre.aggr;
  const eff = effectiveBB(st, ctx.seat);
  const stackLeft = me.stack;
  const pot = potTotal(st);
  const fold: Act = { type: L.canCheck ? 'check' : 'fold' };
  const callAct: Act = { type: L.call > 0 ? 'call' : 'check' };
  const facingAllin = L.call > 0 && st.players.some((q) => q.seat !== ctx.seat && !q.folded && q.allin && q.street === st.currentBet);
  // 面对全下（或跟注需要投入大部分筹码）：按估计的全下范围计算胜率
  if (L.call > 0 && (facingAllin || L.call >= 0.5 * (stackLeft + me.street))) {
    const raiser = st.players.find((q) => q.street === st.currentBet && q.seat !== ctx.seat)!;
    const depth = Math.min(raiser.startStack, me.startStack) / bb;
    const cat: PreCategory = R >= 3 ? '4bet' : R === 2 ? (depth > 30 ? '4bet' : 'shove') : 'shove';
    const range = toCombos(categoryRange(cat, 0.25, depth), [...me.hole]);
    const eq = equityVsRanges(me.hole, [], [range], 400, rand);
    const need = L.call / (pot + L.call);
    const adj = (style.pre.callShove - 1) * 0.08;
    return eq + adj >= need ? callAct : fold;
  }
  const isBB = pos === 'BB';
  if (R === 0) {
    // 有人溜入
    const iso = Math.min(0.3, 0.09 * loose) * (0.6 + aggr * 0.6);
    const limpW = Math.min(0.55, 0.2 * loose);
    if (p < iso) return raiseAct(st, (3 + callers) * bb + (st.currentBet > bb ? st.currentBet : 0));
    if (p < limpW || L.call === 0) return isBB || L.call === 0 ? { type: 'check' } : callAct;
    return fold;
  }
  const facing = st.currentBet / bb;
  const sizeF = Math.min(1, 7 / Math.max(facing, 1));
  let raiseW: number;
  let callW: number;
  if (R === 1) {
    raiseW = Math.min(0.08, 0.03 * loose) * (0.5 + aggr);
    callW = Math.min(0.45, (0.12 + 0.02 * callers) * loose) * sizeF;
  } else if (R === 2) {
    raiseW = Math.min(0.04, 0.018 * loose) * (0.5 + aggr * 0.8);
    callW = Math.min(0.2, 0.05 * loose) * sizeF;
  } else {
    raiseW = Math.min(0.02, 0.01 * loose);
    callW = Math.min(0.1, 0.03 * loose) * sizeF;
  }
  void eff;
  if (p < raiseW && L.canRaise && rand() < 0.85) {
    const to = R === 1 ? st.currentBet * (3 + callers) : st.currentBet * 2.3;
    return raiseAct(st, to, 0.4);
  }
  if (p < Math.max(callW, raiseW)) return callAct;
  return fold;
}

// ---------- 翻后 ----------

const OPEN_WIDTH: Record<Position, number> = { UTG: 0.15, UTG1: 0.16, UTG2: 0.18, LJ: 0.2, HJ: 0.23, CO: 0.28, BTN: 0.42, SB: 0.36, BB: 0.3 };

/** 由翻前行动估计的初始范围类别 */
export function preflopCategory(st: HandState, seat: number): { cat: PreCategory; width: number; depth: number } {
  const pos = seatPositions(st).get(seat)!;
  let raises = 0;
  let lastRaiseAllin = false;
  let cat: PreCategory = 'any';
  for (const e of st.log) {
    if (e.street !== 0) continue;
    if (e.seat === seat) {
      if (e.kind === 'raise' || e.kind === 'bet') {
        const deep = effectiveBB(st, seat);
        cat = raises === 0 ? (e.allin && deep <= 25 ? 'shove' : 'open') : raises === 1 ? '3bet' : '4bet';
      } else if (e.kind === 'call') cat = raises === 0 ? 'limp' : raises === 1 ? (lastRaiseAllin ? 'callShove' : 'callOpen') : 'call3bet';
      else if (e.kind === 'check') cat = 'any';
    }
    if (e.kind === 'raise' || e.kind === 'bet') {
      raises++;
      lastRaiseAllin = e.allin;
    }
  }
  return { cat, width: OPEN_WIDTH[pos], depth: effectiveBB(st, seat) };
}

const rangeCache = new WeakMap<HandState, Map<string, Float64Array>>();

/** 某名玩家在当前时刻（按所有已发生的行动收窄后）的估计范围；dead 为观察者知道的牌 */
export function estimateRange(st: HandState, seat: number, dead: number[]): Float64Array {
  let m = rangeCache.get(st);
  if (!m) {
    m = new Map();
    rangeCache.set(st, m);
  }
  const key = `${seat}|${dead.join(',')}|${st.log.length}`;
  const hit = m.get(key);
  if (hit) return hit;
  const { cat, width, depth } = preflopCategory(st, seat);
  const range = toCombos(categoryRange(cat, width, depth), [...dead, ...st.board]);
  // 翻后逐街收窄
  let pot = 0;
  for (const e of st.log) {
    if (e.street > 0 && e.seat === seat && (e.kind === 'bet' || e.kind === 'raise' || e.kind === 'call' || e.kind === 'check')) {
      const board = st.board.slice(0, e.street === 1 ? 3 : e.street === 2 ? 4 : 5);
      const kind: PostKind = e.kind === 'bet' ? 'bet' : e.kind === 'raise' ? 'raise' : e.kind === 'call' ? 'call' : 'check';
      narrowRange(range, board, kind, pot > 0 ? e.amount / pot : 0.6);
    }
    pot += e.amount;
  }
  m.set(key, range);
  return range;
}

function postflop(ctx: AiContext): AiDecision {
  if (ctx.solver && ctx.solver.handIndex >= 0) {
    const d = solverDecision(ctx, ctx.solver);
    if (d) return d;
  }
  return { ...equityDecision(ctx), basis: 'equity' };
}

/** 按求解结果的混合策略抽样；非 GTO 风格按风格参数做少量偏移 */
function solverDecision(ctx: AiContext, sv: SolverView): AiDecision | null {
  const { st, style, rand } = ctx;
  const n = sv.hands.length;
  const k = sv.node.actions.length;
  const freqs = Array.from({ length: k }, (_, a) => sv.node.strategy[a * n + sv.handIndex] ?? 0);
  const kinds = sv.node.actions.map(parseAction);
  // 风格偏移
  const fi = kinds.findIndex((x) => x.kind === 'fold');
  const ci = kinds.findIndex((x) => x.kind === 'call' || x.kind === 'check');
  if (fi >= 0 && ci >= 0 && style.post.solverFoldToCall > 0) {
    const m = freqs[fi] * style.post.solverFoldToCall;
    freqs[fi] -= m;
    freqs[ci] += m;
  }
  if (ci >= 0 && style.post.solverPassive > 0)
    kinds.forEach((x, a) => {
      if (x.kind === 'bet' || x.kind === 'raise' || x.kind === 'allin') {
        const m = freqs[a] * style.post.solverPassive;
        freqs[a] -= m;
        freqs[ci] += m;
      }
    });
  const tot = freqs.reduce((a, b) => a + b, 0);
  if (tot <= 0) return null;
  let x = rand() * tot;
  let pick = k - 1;
  for (let a = 0; a < k; a++) {
    x -= freqs[a];
    if (x < 0) {
      pick = a;
      break;
    }
  }
  const act = kinds[pick];
  const L = legalActions(st);
  switch (act.kind) {
    case 'fold':
      return { type: L.canFold ? 'fold' : 'check', basis: 'solver' };
    case 'check':
      return { type: 'check', basis: 'solver' };
    case 'call':
      return { type: L.call > 0 ? 'call' : 'check', basis: 'solver' };
    case 'allin':
      return { ...raiseAct(st, L.maxTo), basis: 'solver' };
    default: {
      const to = sv.toReal(act.amount);
      return { ...raiseAct(st, to, 0.9), basis: 'solver' };
    }
  }
}

function equityDecision(ctx: AiContext): Act {
  const { st, seat, style, rand } = ctx;
  const me = currentPlayer(st)!;
  const L = legalActions(st);
  const opps = st.players.filter((p) => p.seat !== seat && !p.folded);
  const dead = [...me.hole];
  const ranges = opps.map((p) => estimateRange(st, p.seat, dead));
  const samples = ctx.samples ?? (opps.length > 1 ? 260 : 320);
  const eq = equityVsRanges(me.hole, st.board, ranges, samples, rand);
  const pot = potTotal(st);
  const nOpp = opps.length;
  const sp = style.post;
  const river = st.street === 3;
  // 多人底池需要更强的牌
  const multi = (nOpp - 1) * 0.06;
  const pickSize = () => sp.sizes[Math.floor(rand() * sp.sizes.length)];
  const betTo = (frac: number) => raiseAct(st, st.currentBet + frac * pot, 0.7);
  if (L.call === 0) {
    const preAggr = isPreflopAggressor(st, seat);
    const valueEq = sp.valueEq + multi;
    if (eq >= valueEq && L.canRaise) {
      const big = eq > 0.85 ? Math.max(...sp.sizes) : pickSize();
      // 很强的牌偶尔慢打（紧弱更常见）
      if (eq > 0.9 && rand() < (style.id === 'nit' ? 0.4 : 0.15) && !river) return { type: 'check' };
      return betTo(big);
    }
    let bluff = sp.bluff / nOpp;
    if (st.street === 1 && preAggr) bluff += sp.cbet / nOpp;
    if (river) bluff *= eq < 0.25 ? 1 : 0.4; // 河牌只用最弱的牌诈唬
    if (L.canRaise && rand() < bluff) return betTo(pickSize());
    return { type: 'check' };
  }
  const need = L.call / (pot + L.call);
  const callEq = eq + sp.callAdj - multi * 0.5;
  // 剩余筹码很少时已经套牢
  const committed = me.stack - L.call <= 0.25 * (pot + L.call);
  if (L.canRaise && eq >= sp.raiseEq + multi) {
    const to = st.currentBet + (pot + L.call) * (eq > 0.9 ? 1 : 0.8);
    return raiseAct(st, to, 0.55);
  }
  if (L.canRaise && !river && eq > 0.28 && eq < 0.5 && rand() < sp.raiseBluff / nOpp) {
    return raiseAct(st, st.currentBet + (pot + L.call) * 0.75, 0.55);
  }
  if (callEq >= need * (river ? 1 : 0.92) || (committed && eq >= need * 0.8)) return { type: 'call' };
  return { type: 'fold' };
}

function isPreflopAggressor(st: HandState, seat: number): boolean {
  let last = -1;
  for (const e of st.log) if (e.street === 0 && (e.kind === 'raise' || e.kind === 'bet')) last = e.seat;
  return last === seat;
}

/** 调试用：手牌文字 */
export const holeText = (h: [number, number]) => h.map(cardToString).join('');
