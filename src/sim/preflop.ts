// 翻前局面识别：座位 → 位置、选择对应的范围表格式、把实际行动对应到范围库的场景
import { type Format, type Position, MTT_DEPTHS, POSITIONS_6, POSITIONS_9, hasReshove, isPushFold, makeFormat, spotId } from '../lib/formats.ts';
import { HAND_CLASSES, NUM_CLASSES } from '../lib/hands.ts';
import { type Chart, getChart } from '../data/charts.ts';
import type { HandState } from './engine.ts';
import type { Style } from './styles.ts';
import { preflopStrength } from './ranges.ts';

export type GameKind = 'cash' | 'mtt';

/** 按"从小盲开始"的顺序给参与这手牌的玩家分配位置（与手牌历史解析的规则一致） */
export function seatPositions(st: Pick<HandState, 'players' | 'sbSeat' | 'button'>): Map<number, Position> {
  const n = st.players.length;
  const out = new Map<number, Position>();
  if (n === 2) {
    out.set(st.button, 'SB');
    out.set(st.players.find((p) => p.seat !== st.button)!.seat, 'BB');
    return out;
  }
  const list = n <= 6 ? POSITIONS_6 : POSITIONS_9;
  const order = list.slice(list.length - n); // ... BTN SB BB
  const si = st.players.findIndex((p) => p.seat === st.sbSeat);
  for (let k = 0; k < n; k++) {
    const seat = st.players[(si + k) % n].seat;
    out.set(seat, k === 0 ? 'SB' : k === 1 ? 'BB' : order[k - 2]);
  }
  return out;
}

/** 有效筹码（bb）：自己的起始筹码与其他未弃牌玩家中最多的起始筹码取较小者 */
export function effectiveBB(st: HandState, seat: number): number {
  const me = st.players.find((p) => p.seat === seat)!;
  let other = 0;
  for (const p of st.players) if (p.seat !== seat && !p.folded) other = Math.max(other, p.startStack);
  return Math.min(me.startStack, other) / st.bb;
}

/** 选择范围表格式：现金局 40bb 以上用 100bb 表；锦标赛（或很浅的现金局）用最接近深度的锦标赛表 */
export function chartFormat(game: GameKind, n: number, effBB: number): Format {
  const players = n <= 6 ? 6 : 9;
  if (game === 'cash' && effBB >= 40) return makeFormat('cash', players, 100);
  let best: number = MTT_DEPTHS[0];
  for (const d of MTT_DEPTHS) if (Math.abs(d - effBB) < Math.abs(best - effBB)) best = d;
  if (game === 'cash') best = Math.min(best, 30);
  return makeFormat('mtt', players, best);
}

export interface PreRaise {
  seat: number;
  to: number;
  allin: boolean;
}

export interface PreflopSituation {
  positions: Map<number, Position>;
  format: Format;
  pos: Position;
  raises: PreRaise[];
  /** 最后一次加注之前/之后跟注（或溜入）的玩家 */
  limpers: number[];
  callersAfterRaise: number[];
  actedBefore: boolean;
  /** 对应的范围库场景（没有对应时为 null） */
  spotId: string | null;
  /** 场景说明（没有对应时的原因） */
  kind: 'rfi' | 'push' | 'vsOpen' | 'vsShove' | 'reshove' | 'vs3bet' | 'vsReshove' | 'iso' | 'squeeze' | 'limped' | 'multi' | 'deep';
}

export function chartExists(id: string): boolean {
  try {
    getChart(id);
    return true;
  } catch {
    return false;
  }
}

/** 当前行动者的翻前局面 */
export function preflopSituation(st: HandState, seat: number, game: GameKind): PreflopSituation {
  const positions = seatPositions(st);
  const pos = positions.get(seat)!;
  const format = chartFormat(game, st.players.length, effectiveBB(st, seat));
  const raises: PreRaise[] = [];
  const limpers: number[] = [];
  const callersAfterRaise: number[] = [];
  let actedBefore = false;
  for (const e of st.log) {
    if (e.street !== 0) continue;
    if (e.seat === seat && (e.kind === 'call' || e.kind === 'raise' || e.kind === 'bet' || e.kind === 'check')) actedBefore = true;
    if (e.kind === 'raise' || e.kind === 'bet') {
      raises.push({ seat: e.seat, to: e.to, allin: e.allin });
      callersAfterRaise.length = 0;
    } else if (e.kind === 'call') {
      if (raises.length === 0) limpers.push(e.seat);
      else callersAfterRaise.push(e.seat);
    }
  }
  const base = { positions, format, pos, raises, limpers, callersAfterRaise, actedBefore };
  const f = format;
  const R = raises.length;
  const P = (s: number) => positions.get(s)!;
  if (R === 0 && limpers.length === 0) {
    const id = spotId(f.id, isPushFold(f) ? 'push' : 'rfi', pos);
    if (pos !== 'BB' && chartExists(id)) return { ...base, spotId: id, kind: isPushFold(f) ? 'push' : 'rfi' };
  }
  if (R === 0) {
    // 前面有人溜入：没溜入过的玩家按自己位置的开池表决定是否加注隔离（ISO）
    const id = spotId(f.id, 'rfi', pos);
    if (!actedBefore && pos !== 'BB' && !isPushFold(f) && chartExists(id)) return { ...base, spotId: id, kind: 'iso' };
    return { ...base, spotId: null, kind: 'limped' };
  }
  if (R === 1 && limpers.length === 0 && callersAfterRaise.length > 0 && !actedBefore && !raises[0].allin && !isPushFold(f)) {
    // 开池后已有人跟注：按面对开池的表（挤压 squeeze / 跟注）
    const id = spotId(f.id, 'vsOpen', pos, P(raises[0].seat));
    if (chartExists(id)) return { ...base, spotId: id, kind: 'squeeze' };
  }
  if (R === 1 && limpers.length === 0 && callersAfterRaise.length === 0 && !actedBefore) {
    const r = raises[0];
    const opener = P(r.seat);
    const shoveLike = r.allin || r.to >= 0.85 * (st.players.find((p) => p.seat === r.seat)!.startStack);
    if (shoveLike) {
      const id = spotId(f.id, 'vsShove', pos, opener);
      if (chartExists(id)) return { ...base, spotId: id, kind: 'vsShove' };
      return { ...base, spotId: null, kind: 'deep' };
    }
    if (isPushFold(f)) {
      const id = spotId(f.id, hasReshove(f) ? 'reshove' : 'vsShove', pos, opener);
      if (chartExists(id)) return { ...base, spotId: id, kind: hasReshove(f) ? 'reshove' : 'vsShove' };
    } else {
      const id = spotId(f.id, 'vsOpen', pos, opener);
      if (chartExists(id)) return { ...base, spotId: id, kind: 'vsOpen' };
    }
    return { ...base, spotId: null, kind: 'multi' };
  }
  if (R === 2 && limpers.length === 0 && callersAfterRaise.length === 0 && raises[0].seat === seat) {
    const t = raises[1];
    const tb = P(t.seat);
    const shoveLike = t.allin || t.to >= 0.85 * st.players.find((p) => p.seat === t.seat)!.startStack;
    if (shoveLike && hasReshove(f)) {
      const id = spotId(f.id, 'vsReshove', pos, tb);
      if (chartExists(id)) return { ...base, spotId: id, kind: 'vsReshove' };
    }
    const id = spotId(f.id, 'vs3bet', pos, tb);
    if (chartExists(id)) return { ...base, spotId: id, kind: 'vs3bet' };
  }
  return { ...base, spotId: null, kind: 'multi' };
}

// ---------- 按风格调整范围表 ----------

export interface StyledFreq {
  aggressive: 'raise' | 'allin' | null;
  /** 每个类别：加注（或全下）、跟注（溜入）的频率；其余为弃牌 */
  raise: Float64Array;
  call: Float64Array;
}

const styledCache = new Map<string, StyledFreq>();

export function clearStyledCache(): void {
  styledCache.clear();
}

/**
 * 按风格调整范围表：
 * 1. 继续（加注 + 跟注）的组合数 = 范围库 × widen；按"范围库继续频率 + 翻前牌力"的顺序重新分配（收紧时去掉最弱/混合的手牌，放宽时加入次强的手牌）
 * 2. 继续部分中加注的比例 × raiseMult（最强的 4% 手牌保持范围库的加注比例）；首先入池时按 limp 比例改为溜入
 */
export function styledChart(chart: Chart, style: Style, schemeKey = ''): StyledFreq {
  const key = `${style.id}|${schemeKey}|${chart.spot.id}`;
  const hit = styledCache.get(key);
  if (hit) return hit;
  const actions = chart.actions;
  const aggressive = actions.includes('raise') ? 'raise' : actions.includes('allin') ? 'allin' : null;
  const str = preflopStrength();
  const H = NUM_CLASSES;
  const isRfi = chart.spot.type === 'rfi';
  const isPush = chart.spot.type === 'push' || chart.spot.type === 'reshove';
  const isCallOnly = !aggressive;
  const coldSpot = chart.spot.type === 'vsOpen' && chart.spot.hero !== 'BB';
  const widen = isPush
    ? style.pre.push
    : isCallOnly || chart.spot.type === 'vsReshove'
      ? style.pre.callShove
      : isRfi
        ? style.pre.widen * style.pre.rfi
        : chart.spot.type === 'vsOpen' && chart.spot.hero === 'BB'
          ? style.pre.widen * style.pre.bbDefend
          : style.pre.widen;
  const widen9 = chart.spot.format.players === 9 && !isPush && !isCallOnly ? style.pre.wide9 : 1;
  const cont = new Float64Array(H);
  let baseMass = 0;
  let maxMass = 0;
  for (let h = 0; h < H; h++) {
    const w = chart.prior[h] * HAND_CLASSES[h].combos;
    cont[h] = 1 - (chart.freq.fold?.[h] ?? 0);
    baseMass += w * cont[h];
    maxMass += w;
  }
  const target = Math.min(maxMass * 0.97, baseMass * widen * widen9);
  const score = Float64Array.from(cont, (c, h) => c + 0.6 * str[h]);
  const order = Array.from({ length: H }, (_, i) => i).sort((a, b) => score[b] - score[a]);
  const newCont = new Float64Array(H);
  const band = 0.02 * maxMass;
  let cum = 0;
  for (const h of order) {
    const w = chart.prior[h] * HAND_CLASSES[h].combos;
    if (w <= 0) continue;
    const mid = cum + w / 2;
    newCont[h] = Math.max(0, Math.min(1, 0.5 + (target - mid) / band));
    cum += w;
  }
  const raise = new Float64Array(H);
  const call = new Float64Array(H);
  for (let h = 0; h < H; h++) {
    const c = newCont[h];
    if (c <= 0) continue;
    const r0 = aggressive ? chart.freq[aggressive]![h] : 0;
    const k0 = chart.freq.call?.[h] ?? 0;
    let share: number;
    if (isCallOnly) share = 0;
    else if (isRfi || isPush) share = 1;
    else share = r0 + k0 > 0.001 ? r0 / (r0 + k0) : style.pre.newRaise;
    const premium = str[h] > 0.96;
    if (isRfi) {
      share = premium ? 1 : 1 - style.pre.limp;
    } else if (!isPush && !isCallOnly) {
      const s2 = Math.min(1, share * style.pre.raiseMult);
      share = premium ? Math.max(share, s2) : s2;
    }
    let r = c * share;
    let k = c * (1 - share);
    if (coldSpot && style.pre.coldCall < 1) {
      // 非大盲面对开池：减少平跟，其中一部分改为 3-bet，其余弃牌
      const moved = k * (1 - style.pre.coldCall);
      k -= moved;
      r += moved * style.pre.coldToRaise;
    }
    raise[h] = r;
    call[h] = k;
  }
  const out = { aggressive: aggressive as StyledFreq['aggressive'], raise, call };
  styledCache.set(key, out);
  return out;
}
