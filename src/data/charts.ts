// 翻前范围表的生成
//
// 数据来源分三类（每张表都会标注）：
//  computed —— 计算得出：全下/弃牌纳什均衡（筹码 EV，含前注）
//  compiled —— 公开资料整理：6 人桌现金局 100bb 开池范围（见 baseCharts.ts）
//  approx   —— 近似：以精确胜率矩阵计算"每手牌对对手范围的胜率"，再按公开图表的典型频率分配动作
import {
  type ActionKey,
  type Format,
  type Position,
  type Spot,
  isPushFold,
  positionsOf,
  spotId,
  parseSpotId,
  openSize,
  threeBetSize,
  fourBetSize,
} from '../lib/formats.ts';
import { HAND_CLASSES, NUM_CLASSES, compatTable } from '../lib/hands.ts';
import { parseRange } from '../lib/rangeText.ts';
import { CASH6_RFI_TEXT } from './baseCharts.ts';
import { getEquityMatrix, getPushFold } from './equityData.ts';

export type SourceKind = 'computed' | 'compiled' | 'approx' | 'custom';

export const SOURCE_LABELS: Record<SourceKind, string> = {
  computed: '计算得出',
  compiled: '公开资料整理',
  approx: '近似',
  custom: '用户自定义',
};

export interface ChartSource {
  kind: SourceKind;
  note: string;
}

export interface Chart {
  spot: Spot;
  actions: ActionKey[]; // 按显示顺序（攻击性从高到低，弃牌最后）
  freq: Partial<Record<ActionKey, Float64Array>>; // 每个类别各动作的频率，合计为 1
  prior: Float64Array; // 到达该局面时持有该手牌的相对概率（例如面对 3-bet 时 = 开池频率）
  source: ChartSource;
  sizing: string;
  ev?: Partial<Record<ActionKey, Float64Array>>; // 若有（纳什表），相对弃牌的 EV（bb）
}

const H = NUM_CLASSES;
const TOTAL = 1326;

// ---------- 基础工具 ----------

/** 每手牌对一个加权范围的胜率（考虑牌的去除效应） */
export function equityVsRange(range: ArrayLike<number>): Float64Array {
  const eq = getEquityMatrix();
  const compat = compatTable();
  const out = new Float64Array(H);
  for (let h = 0; h < H; h++) {
    let w = 0;
    let s = 0;
    for (let c = 0; c < H; c++) {
      const x = compat[h * H + c] * range[c];
      if (x === 0) continue;
      w += x;
      s += x * eq[h * H + c];
    }
    out[h] = w > 0 ? s / w : 0.5;
  }
  return out;
}

const roundFreq = (v: number) => {
  const r = Math.round(v * 20) / 20;
  return r < 0 ? 0 : r > 1 ? 1 : r;
};

/**
 * 按顺序分配：从 order 的第一手牌开始，把每手牌"可用部分"的一定比例分配出去，
 * 直到分配的组合数达到 target。边界附近有宽度为 band 的线性过渡（形成混合策略）。
 */
function allocate(order: number[], avail: Float64Array, prior: ArrayLike<number>, target: number, band: number): Float64Array {
  const out = new Float64Array(H);
  let cum = 0;
  for (const h of order) {
    const mass = avail[h] * prior[h] * HAND_CLASSES[h].combos;
    if (mass <= 0) continue;
    const mid = cum + mass / 2;
    let f = band > 0 ? 0.5 + (target - mid) / band : target > mid ? 1 : 0;
    f = Math.max(0, Math.min(1, f));
    out[h] = f * avail[h];
    cum += mass;
  }
  return out;
}

const sortBy = (score: ArrayLike<number>) =>
  Array.from({ length: H }, (_, i) => i).sort((a, b) => score[b] - score[a]);

/** 可玩性加分：同花、连张、对子更适合跟注后打翻后 */
function playability(h: number): number {
  const c = HAND_CLASSES[h];
  if (c.kind === 'pair') return 0.03;
  let b = 0;
  const gap = c.hi - c.lo - 1;
  if (c.kind === 'suited') b += 0.035;
  if (gap === 0) b += 0.02;
  else if (gap === 1) b += 0.012;
  else if (gap === 2) b += 0.005;
  if (c.kind === 'offsuit' && c.lo < 8) b -= 0.02; // 不同花且小踢脚
  if (c.hi === 12 && c.kind === 'suited') b += 0.01; // 同花 A
  return b;
}

/** 诈唬（3-bet/4-bet bluff）的候选手牌：有阻断效果或可玩性好的同花牌 */
function bluffCandidate(h: number, allowOffsuit: boolean): boolean {
  const c = HAND_CLASSES[h];
  if (c.kind === 'pair') return false;
  if (c.kind === 'suited') {
    if (c.hi >= 10) return true; // Qx s+
    return c.hi - c.lo <= 2 && c.lo >= 2; // 同花连张/隔张（54s 以上）
  }
  return allowOffsuit && ((c.hi === 12 && c.lo <= 3) || (c.hi >= 11 && c.lo >= 7));
}

function finalizeFreq(parts: Partial<Record<ActionKey, Float64Array>>, actions: ActionKey[]): Partial<Record<ActionKey, Float64Array>> {
  const out: Partial<Record<ActionKey, Float64Array>> = {};
  for (const a of actions) out[a] = new Float64Array(H);
  for (let h = 0; h < H; h++) {
    let sum = 0;
    for (const a of actions) {
      if (a === 'fold') continue;
      const v = roundFreq(parts[a]?.[h] ?? 0);
      out[a]![h] = v;
      sum += v;
    }
    if (sum > 1) {
      // 归一化（只在四舍五入导致超出时发生）
      for (const a of actions) if (a !== 'fold') out[a]![h] /= sum;
      sum = 1;
    }
    out.fold![h] = Math.max(0, 1 - sum);
  }
  return out;
}

// ---------- 开池（RFI） ----------

let openOrderCache: number[] | null = null;
/** 开池优先顺序：由整理的 6 人桌开池表嵌套结构得出，再用"对前 15% 范围的胜率"细分 */
function openOrder(): number[] {
  if (openOrderCache) return openOrderCache;
  const score = new Float64Array(H);
  for (const p of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Position[]) {
    const w = parseRange(CASH6_RFI_TEXT[p]!).weights;
    for (let h = 0; h < H; h++) score[h] += w[h] * (p === 'SB' ? 0.5 : 1);
  }
  const top = new Float64Array(H);
  const order0 = sortBy(score);
  let cum = 0;
  for (const h of order0) {
    if (cum > 0.15 * TOTAL) break;
    top[h] = 1;
    cum += HAND_CLASSES[h].combos;
  }
  const eqTop = equityVsRange(top);
  for (let h = 0; h < H; h++) score[h] += 0.1 * (eqTop[h] + (HAND_CLASSES[h].kind === 'suited' ? 0.03 : 0));
  openOrderCache = sortBy(score);
  return openOrderCache;
}

const RFI_WIDTH_CASH9: Partial<Record<Position, number>> = { UTG: 0.11, UTG1: 0.125, UTG2: 0.145 };
const RFI_WIDTH_MTT6: Partial<Record<Position, number>> = { UTG: 0.19, HJ: 0.235, CO: 0.3, BTN: 0.46, SB: 0.44 };
const RFI_WIDTH_MTT9: Partial<Record<Position, number>> = { UTG: 0.135, UTG1: 0.155, UTG2: 0.175, LJ: 0.2, HJ: 0.235, CO: 0.3, BTN: 0.46, SB: 0.44 };
/** 9 人桌后面几个位置与 6 人桌距按钮相同的位置对应 */
const NINE_TO_SIX: Partial<Record<Position, Position>> = { LJ: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB' };

function depthFactor(f: Format, pos: Position): number {
  const late = pos === 'BTN' || pos === 'SB' || pos === 'CO';
  if (f.depth <= 25) return late ? 0.95 : 0.92;
  if (f.depth <= 30) return late ? 0.97 : 0.96;
  if (f.depth >= 60) return 0.97;
  return 1;
}

function rfiChart(f: Format, pos: Position): Chart {
  const spot = { id: spotId(f.id, 'rfi', pos), format: f, type: 'rfi' as const, hero: pos };
  const actions: ActionKey[] = ['raise', 'fold'];
  const prior = new Float64Array(H).fill(1);
  const size = openSize(f, pos);
  let raise: Float64Array;
  let source: ChartSource;
  if (f.game === 'cash' && (f.players === 6 || NINE_TO_SIX[pos])) {
    const p6 = f.players === 6 ? pos : NINE_TO_SIX[pos]!;
    raise = parseRange(CASH6_RFI_TEXT[p6]!).weights;
    source =
      f.players === 6
        ? { kind: 'compiled', note: '依据公开的 6 人桌 100bb 求解器开池图表的典型结构整理（非原始求解器导出），单手牌频率可能有 10~20 个百分点偏差。小盲为"加注或弃牌"简化策略（不含 limp）。' }
        : { kind: 'compiled', note: `按"距按钮相同的位置"沿用 6 人桌 ${p6} 的整理范围（9 人桌前面多了 3 名已弃牌玩家，真实 GTO 会略有不同）。` };
  } else {
    const table = f.game === 'cash' ? RFI_WIDTH_CASH9 : f.players === 6 ? RFI_WIDTH_MTT6 : RFI_WIDTH_MTT9;
    const width = (table[pos] ?? 0.2) * (f.game === 'mtt' ? depthFactor(f, pos) : 1);
    raise = allocate(openOrder(), new Float64Array(H).fill(1), prior, width * TOTAL, 0.025 * TOTAL);
    source = {
      kind: 'approx',
      note: `按开池比例约 ${(width * 100).toFixed(0)}% 生成：手牌顺序取自整理的 6 人桌开池表，边界附近为混合频率。${f.game === 'mtt' ? '锦标赛有前注，开池比现金局更宽。' : ''}不是求解器结果。`,
    };
  }
  return {
    spot,
    actions,
    freq: finalizeFreq({ raise }, actions),
    prior,
    source,
    sizing: `开池 ${size}bb`,
  };
}

// ---------- 面对开池（vs Open） ----------

interface ResponseParams {
  R: number; // 3-bet（或全下）占全部组合的比例
  C: number; // 跟注比例
  valueFrac: number;
  callBand: number;
  allowOffsuitBluff: boolean;
}

function vsOpenParams(f: Format, hero: Position, w: number): ResponseParams {
  const mtt = f.game === 'mtt';
  const shove = mtt && f.depth <= 25;
  if (hero === 'BB') {
    const T = mtt ? Math.min(0.8, 0.18 + 1.3 * w) : Math.min(0.7, 0.08 + 1.25 * w);
    const R = shove ? 0.2 * w + 0.02 : mtt ? 0.22 * w + 0.01 : 0.29 * w + 0.005;
    return { R, C: T - R, valueFrac: shove ? 0.85 : 0.5, callBand: 0.035, allowOffsuitBluff: !shove };
  }
  if (hero === 'SB') {
    const R = mtt ? 0.3 * w + 0.01 : 0.33 * w + 0.005;
    const C = mtt ? (shove ? 0.06 : 0.12) * w : 0.05 * w;
    return { R, C, valueFrac: shove ? 0.85 : 0.55, callBand: 0.015, allowOffsuitBluff: false };
  }
  const btn = hero === 'BTN';
  let R = mtt ? (shove ? 0.28 : 0.25) * w + 0.005 : 0.28 * w + 0.005;
  let C = (mtt ? (btn ? 0.4 : 0.22) : btn ? 0.36 : 0.18) * w;
  if (shove) C *= 0.6;
  if (!mtt) R = Math.min(R, 0.14);
  return { R, C, valueFrac: shove ? 0.85 : mtt ? 0.6 : 0.55, callBand: 0.015, allowOffsuitBluff: false };
}

/** 生成"加注/跟注/弃牌"三选一的回应策略 */
function buildResponse(prior: ArrayLike<number>, opp: ArrayLike<number>, p: ResponseParams) {
  const M = Array.from({ length: H }, (_, h) => prior[h] * HAND_CLASSES[h].combos).reduce((a, b) => a + b, 0);
  const eqv = equityVsRange(opp);
  const ones = new Float64Array(H).fill(1);
  // 1) 价值加注
  const value = allocate(sortBy(eqv), ones, prior, p.R * p.valueFrac * M, 0.012 * M);
  // 2) 跟注
  const remain = Float64Array.from(value, (v) => 1 - v);
  const callScore = Float64Array.from(eqv, (e, h) => e + playability(h));
  const call = allocate(sortBy(callScore), remain, prior, p.C * M, p.callBand * M);
  // 3) 诈唬加注：从非价值手牌中选有阻断效果/可玩性好的同花牌（同花小 A 优先），
  //    以混合频率加入；先占用弃牌部分，不够再占用跟注部分（形成"3-bet/跟注"混合）
  const raise = Float64Array.from(value);
  let bluffTarget = p.R * (1 - p.valueFrac) * M;
  const bluffScore = Float64Array.from(callScore, (v, h) => {
    const c = HAND_CLASSES[h];
    if (c.kind !== 'suited') return v;
    if (c.hi === 12 && c.lo <= 3) return v + 0.12; // A5s-A2s
    if (c.hi === 12) return v + 0.04;
    if (c.hi === 11) return v + 0.02;
    return v;
  });
  for (const h of sortBy(bluffScore)) {
    if (bluffTarget <= 0) break;
    if (!bluffCandidate(h, p.allowOffsuitBluff) || value[h] > 0) continue;
    const fold = 1 - call[h];
    const take = Math.min(0.55, fold + call[h]);
    const mass = take * prior[h] * HAND_CLASSES[h].combos;
    if (mass <= 0) continue;
    const frac = Math.min(1, bluffTarget / mass);
    const amt = take * frac;
    raise[h] += amt;
    const fromFold = Math.min(fold, amt);
    call[h] -= amt - fromFold;
    bluffTarget -= mass * frac;
  }
  return { raise, call, eqv };
}

/** 某个开池者的开池范围（用于对手范围） */
function openRange(f: Format, opener: Position): Float64Array {
  return getChart(spotId(f.id, 'rfi', opener)).freq.raise!;
}

function vsOpenChart(f: Format, hero: Position, opener: Position): Chart {
  const spot = { id: spotId(f.id, 'vsOpen', hero, opener), format: f, type: 'vsOpen' as const, hero, villain: opener };
  const opp = openRange(f, opener);
  const w = opp.reduce((s, v, h) => s + v * HAND_CLASSES[h].combos, 0) / TOTAL;
  const p = vsOpenParams(f, hero, w);
  const prior = new Float64Array(H).fill(1);
  const { raise, call } = buildResponse(prior, opp, p);
  const t = threeBetSize(f, opener, hero);
  const aggressive: ActionKey = t === null ? 'allin' : 'raise';
  const actions: ActionKey[] = [aggressive, 'call', 'fold'];
  return {
    spot,
    actions,
    freq: finalizeFreq({ [aggressive]: raise, call }, actions),
    prior,
    source: {
      kind: 'approx',
      note:
        `对手（${opener}）开池范围约 ${(w * 100).toFixed(0)}%。按典型频率生成：${t === null ? '全下' : '3-bet'}约 ${(p.R * 100).toFixed(1)}%、跟注约 ${(p.C * 100).toFixed(1)}%；` +
        '价值部分按"对开池范围的精确胜率"排序，跟注部分额外考虑同花/连张的可玩性，诈唬部分取有阻断效果的同花牌并以混合频率出现。不是求解器结果。',
    },
    sizing: `对手开池 ${openSize(f, opener)}bb；${t === null ? `3-bet = 全下 ${f.depth}bb` : `3-bet 到 ${t}bb`}`,
  };
}

// ---------- 面对 3-bet ----------

function vs3betChart(f: Format, hero: Position, threeBettor: Position): Chart {
  const spot = { id: spotId(f.id, 'vs3bet', hero, threeBettor), format: f, type: 'vs3bet' as const, hero, villain: threeBettor };
  const open = openRange(f, hero);
  const prior = Float64Array.from(open);
  const vChart = getChart(spotId(f.id, 'vsOpen', threeBettor, hero));
  const t = threeBetSize(f, hero, threeBettor);
  const opp = vChart.freq[t === null ? 'allin' : 'raise']!;
  const o = openSize(f, hero);
  if (t === null) {
    // 对手全下：跟注/弃牌，用 EV 直接计算
    const eqv = equityVsRange(opp);
    const S = f.depth;
    const inHand = (x: Position) => x === hero || x === threeBettor;
    const deadBlinds = (inHand('SB') ? 0 : 0.5) + (inHand('BB') ? 0 : 1);
    const pot = 2 * S + f.ante + deadBlinds;
    const cost = S - o;
    const call = new Float64Array(H);
    const evCall = new Float64Array(H);
    for (let h = 0; h < H; h++) {
      const ev = eqv[h] * pot - cost;
      evCall[h] = ev;
      call[h] = Math.max(0, Math.min(1, 0.5 + ev / 0.3));
    }
    const actions: ActionKey[] = ['call', 'fold'];
    return {
      spot,
      actions,
      freq: finalizeFreq({ call }, actions),
      prior,
      ev: { call: evCall },
      source: {
        kind: 'approx',
        note: `跟注与否由"对对手全下范围的精确胜率 × 底池 − 跟注额"直接计算（筹码 EV，EV 接近 0 的手牌为混合）；但对手的全下范围本身是近似生成的，所以整体标为近似。底池 ${pot.toFixed(1)}bb，需跟注 ${cost.toFixed(1)}bb，需要胜率 ${((cost / pot) * 100).toFixed(1)}%。`,
      },
      sizing: `你开池 ${o}bb，对手全下 ${S}bb`,
    };
  }
  const posList = positionsOf(f);
  const heroIP = posList.indexOf(hero) > posList.indexOf(threeBettor) || threeBettor === 'SB' || threeBettor === 'BB';
  const K = heroIP ? 0.5 : 0.45; // 继续（跟注 + 4-bet）占开池范围的比例
  const fb = fourBetSize(f, t);
  const aggressive: ActionKey = fb === null ? 'allin' : 'raise';
  const share = fb === null ? 0.35 : 0.25;
  const p: ResponseParams = {
    R: K * share,
    C: K * (1 - share),
    valueFrac: fb === null ? 0.85 : 0.7,
    callBand: 0.06,
    allowOffsuitBluff: false,
  };
  const { raise, call } = buildResponse(prior, opp, p);
  const actions: ActionKey[] = [aggressive, 'call', 'fold'];
  return {
    spot,
    actions,
    freq: finalizeFreq({ [aggressive]: raise, call }, actions),
    prior,
    source: {
      kind: 'approx',
      note: `只包含你开池时会玩的手牌（按开池频率加权）。按典型频率生成：继续约占开池范围的 ${(K * 100).toFixed(0)}%，其中 ${fb === null ? '4-bet 全下' : '4-bet'}约 ${(share * 100).toFixed(0)}%；价值部分按对 3-bet 范围的精确胜率排序。不是求解器结果。`,
    },
    sizing: `你开池 ${o}bb，对手 3-bet 到 ${t}bb；${fb === null ? '4-bet = 全下' : `4-bet 到 ${fb}bb`}`,
  };
}

// ---------- 全下/弃牌（纳什均衡） ----------

const PF_NOTE = (f: Format) =>
  `由本工具自行计算的纳什均衡（筹码 EV）：${f.players} 人、每人 ${f.depth}bb、大盲前注 1bb。` +
  '假设：首个入池者只能全下或弃牌；只考虑一人跟注（不计多人全下）；各家筹码相同；不考虑 ICM。' +
  '胜率来自精确枚举的 169×169 矩阵，牌的去除效应按成对计算。';

function pushChart(f: Format, hero: Position): Chart {
  const res = getPushFold(f.players, f.depth);
  if (!res) throw new Error(`缺少全下数据 ${f.players}-${f.depth}`);
  const idx = positionsOf(f).indexOf(hero);
  const spot = { id: spotId(f.id, 'push', hero), format: f, type: 'push' as const, hero };
  const actions: ActionKey[] = ['allin', 'fold'];
  const allin = Float64Array.from(res.push[idx]);
  return {
    spot,
    actions,
    freq: finalizeFreq({ allin }, actions),
    prior: new Float64Array(H).fill(1),
    ev: { allin: Float64Array.from(res.pushEV[idx]) },
    source: { kind: 'computed', note: PF_NOTE(f) + ` 可被利用度 ≈ ${res.exploitability.toFixed(3)}bb。` },
    sizing: `全下 ${f.depth}bb`,
  };
}

function vsShoveChart(f: Format, hero: Position, pusher: Position): Chart {
  const res = getPushFold(f.players, f.depth);
  if (!res) throw new Error(`缺少全下数据 ${f.players}-${f.depth}`);
  const pos = positionsOf(f);
  const p = pos.indexOf(pusher);
  const j = pos.indexOf(hero);
  const spot = { id: spotId(f.id, 'vsShove', hero, pusher), format: f, type: 'vsShove' as const, hero, villain: pusher };
  const actions: ActionKey[] = ['call', 'fold'];
  const call = Float64Array.from(res.call[p][j]);
  return {
    spot,
    actions,
    freq: finalizeFreq({ call }, actions),
    prior: new Float64Array(H).fill(1),
    ev: { call: Float64Array.from(res.callEV[p][j]) },
    source: { kind: 'computed', note: PF_NOTE(f) },
    sizing: `对手全下 ${f.depth}bb`,
  };
}

// ---------- 入口 ----------

const cache = new Map<string, Chart>();

/** 默认（内置）范围表 */
export function getChart(id: string): Chart {
  const hit = cache.get(id);
  if (hit) return hit;
  const s = parseSpotId(id);
  const f = s.format;
  let c: Chart;
  if (isPushFold(f)) {
    if (s.type === 'push') c = pushChart(f, s.hero);
    else if (s.type === 'vsShove') c = vsShoveChart(f, s.hero, s.villain!);
    else throw new Error(`该格式没有这个场景: ${id}`);
  } else {
    if (s.type === 'rfi') c = rfiChart(f, s.hero);
    else if (s.type === 'vsOpen') c = vsOpenChart(f, s.hero, s.villain!);
    else if (s.type === 'vs3bet') c = vs3betChart(f, s.hero, s.villain!);
    else throw new Error(`该格式没有这个场景: ${id}`);
  }
  cache.set(id, c);
  return c;
}

export function clearChartCache(): void {
  cache.clear();
  openOrderCache = null;
}
