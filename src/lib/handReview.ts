// 手牌复盘：逐个决策点对照翻前范围和翻后求解结果
import { cardToString } from './cards.ts';
import { type ActionKey, type Format, type Position, MTT_DEPTHS, POSITION_SHORT, actionLabel, hasReshove, isPushFold, makeFormat, spotId, spotTitle, parseSpotId, positionsOf } from './formats.ts';
import { comboToClass, HAND_CLASSES } from './hands.ts';
import { gradeAction, type Grade } from './trainer.ts';
import type { HAction, HandRecord, Street } from './handHistory.ts';
import { STREET_NAMES } from './handHistory.ts';
import { effectiveChart } from '../data/overrides.ts';
import { getChart } from '../data/charts.ts';
import { describeAction, gradePostflop } from '../postflop/analysis.ts';
import { makeScenario, type Scenario } from '../postflop/scenarios.ts';
import { CHIPS_PER_BB, type NodeData, parseAction, solverCardId } from '../postflop/types.ts';

export interface ReviewStep {
  street: Street;
  title: string;
  heroAction: string;
  grade?: Grade;
  freqs: { label: string; freq: number; ev?: number; chosen?: boolean }[];
  evLoss?: number; // bb
  note?: string;
  source?: string;
}

/** 选择与这手牌最接近的翻前格式 */
export function formatFor(rec: HandRecord): { format: Format; note?: string } {
  if (rec.game === 'cash') {
    const f = makeFormat('cash', rec.players, 100);
    const note = Math.abs(rec.stackBB - 100) > 30 ? `有效筹码约 ${rec.stackBB.toFixed(0)}bb，范围表按 100bb 计算，深度差别较大，仅供参考` : undefined;
    return { format: f, note };
  }
  let best: number = MTT_DEPTHS[0];
  for (const d of MTT_DEPTHS) if (Math.abs(d - rec.stackBB) < Math.abs(best - rec.stackBB)) best = d;
  const f = makeFormat('mtt', rec.players, best);
  const note = Math.abs(best - rec.stackBB) > 1 ? `有效筹码约 ${rec.stackBB.toFixed(1)}bb，按最接近的 ${best}bb 范围表对照` : undefined;
  return { format: f, note };
}

const handClassOf = (rec: HandRecord) => comboToClass(rec.heroCards[0], rec.heroCards[1]);

interface PreState {
  raises: { pos: Position; amount: number; allin: boolean }[];
  callers: Position[];
  heroActed: boolean;
}

/** 翻前：对照范围库 */
export function reviewPreflop(rec: HandRecord): { steps: ReviewStep[]; format: Format; note?: string } {
  const { format, note } = formatFor(rec);
  const steps: ReviewStep[] = [];
  const st: PreState = { raises: [], callers: [], heroActed: false };
  const h = handClassOf(rec);
  const allinLike = (a: HAction) => a.allin || a.amount >= (rec.stacks[a.pos] ?? rec.stackBB) * 0.85;
  for (const a of rec.actions.filter((x) => x.street === 0)) {
    if (a.pos === rec.hero) {
      const step = preflopStep(rec, format, st, a, h, allinLike(a));
      steps.push(step);
      st.heroActed = true;
    }
    if (a.kind === 'raise' || a.kind === 'bet') st.raises.push({ pos: a.pos, amount: a.amount, allin: allinLike(a) });
    else if (a.kind === 'call') st.callers.push(a.pos);
  }
  return { steps, format, note };
}

function preflopStep(rec: HandRecord, f: Format, st: PreState, a: HAction, h: number, heroAllin: boolean): ReviewStep {
  const did = a.kind === 'fold' ? '弃牌' : a.kind === 'check' ? '过牌' : a.kind === 'call' ? `跟注` : heroAllin ? `全下 ${a.amount}bb` : `加注到 ${a.amount}bb`;
  let sid: string | null = null;
  let why = '';
  const R = st.raises.length;
  if (R === 0 && st.callers.length === 0) {
    sid = spotId(f.id, isPushFold(f) ? 'push' : 'rfi', rec.hero);
  } else if (R === 1 && st.callers.length === 0 && !st.heroActed) {
    const r = st.raises[0];
    if (r.allin && (getChartSafe(spotId(f.id, 'vsShove', rec.hero, r.pos)))) sid = spotId(f.id, 'vsShove', rec.hero, r.pos);
    else if (!r.allin && hasReshove(f) && (heroAllin || a.kind === 'fold') && getChartSafe(spotId(f.id, 'reshove', rec.hero, r.pos))) sid = spotId(f.id, 'reshove', rec.hero, r.pos);
    else if (!r.allin && !isPushFold(f)) sid = spotId(f.id, 'vsOpen', rec.hero, r.pos);
    else why = '对手的加注在这个深度的范围表里没有对应（全下/弃牌深度只有全下）';
  } else if (R === 2 && st.callers.length === 0 && st.raises[0].pos === rec.hero) {
    const t = st.raises[1];
    if (t.allin && hasReshove(f) && getChartSafe(spotId(f.id, 'vsReshove', rec.hero, t.pos))) sid = spotId(f.id, 'vsReshove', rec.hero, t.pos);
    else if (getChartSafe(spotId(f.id, 'vs3bet', rec.hero, t.pos))) sid = spotId(f.id, 'vs3bet', rec.hero, t.pos);
    else why = '没有对应的"面对 3-bet"表';
  } else {
    why = st.callers.length > 0 ? '前面有人跟注/溜入（多人底池），范围库没有对应的表' : '4-bet 以上或更复杂的翻前行动，范围库没有对应的表';
  }
  if (!sid) return { street: 0, title: '翻前', heroAction: did, freqs: [], note: why };
  const chart = effectiveChart(sid);
  const spot = parseSpotId(sid);
  let key: ActionKey = a.kind === 'fold' ? 'fold' : a.kind === 'call' ? 'call' : heroAllin ? 'allin' : 'raise';
  if (!chart.actions.includes(key)) {
    if (key === 'raise' && chart.actions.includes('allin')) key = 'allin';
    else if (key === 'allin' && chart.actions.includes('raise')) key = 'raise';
  }
  const labels = (x: ActionKey) => actionLabel(spot, x);
  if (chart.prior[h] <= 0)
    return {
      street: 0,
      title: spotTitle(spot),
      heroAction: did,
      freqs: [],
      note: `${HAND_CLASSES[h].name} 不在这个局面的范围内（按范围表，你开池时不会玩这手牌），无法对照`,
      source: chart.source.note,
    };
  if (!chart.actions.includes(key))
    return { street: 0, title: spotTitle(spot), heroAction: did, freqs: chart.actions.map((x) => ({ label: labels(x), freq: chart.freq[x]![h] })), note: `范围表中没有"${did}"这个选项（例如溜入），按表中各选项的比例参考`, source: chart.source.note };
  const g = gradeAction(chart, h, key);
  return {
    street: 0,
    title: spotTitle(spot),
    heroAction: did,
    grade: g.grade,
    freqs: chart.actions.map((x) => ({ label: labels(x), freq: chart.freq[x]![h], ev: chart.ev?.[x]?.[h], chosen: x === key })),
    source: `${chart.source.kind === 'computed' ? '计算得出' : chart.source.kind === 'compiled' ? '公开资料整理' : chart.source.kind === 'approx' ? '近似' : '用户方案'}：${f.label}`,
  };
}

function getChartSafe(id: string): boolean {
  try {
    getChart(id);
    return true;
  } catch {
    return false;
  }
}

// ---------- 翻后 ----------

export interface PostflopSetup {
  scenario: Scenario;
  /** 实际翻牌圈开始时的底池、有效筹码（bb） */
  potBB: number;
  stackBB: number;
  heroSeat: 0 | 1; // 0 = OOP
  flopActions: HAction[]; // 翻牌及之后的全部行动
}

/** 判断这手牌翻后能否对照：单挑、单一加注或 3-bet 底池 */
export function postflopSetup(rec: HandRecord, format: Format): { setup?: PostflopSetup; reason?: string } {
  if (rec.board.length < 3) return { reason: '没有翻牌' };
  const pre = rec.actions.filter((a) => a.street === 0);
  const contributed = new Map<Position, number>();
  const pos = positionsOf(format);
  contributed.set('SB', 0.5);
  contributed.set('BB', 1);
  const folded = new Set<Position>();
  const raisers: Position[] = [];
  for (const a of pre) {
    if (a.kind === 'fold') folded.add(a.pos);
    if (a.kind === 'call') contributed.set(a.pos, (contributed.get(a.pos) ?? 0) + a.amount);
    if (a.kind === 'raise' || a.kind === 'bet') {
      contributed.set(a.pos, a.amount);
      raisers.push(a.pos);
    }
  }
  const inHand = pos.filter((p) => !folded.has(p) && (contributed.has(p) || pre.some((a) => a.pos === p)));
  if (inHand.length !== 2) return { reason: `翻牌圈有 ${inHand.length} 名玩家，翻后求解只支持单挑底池` };
  if (!inHand.includes(rec.hero)) return { reason: '你在翻前已弃牌' };
  if (raisers.length === 0) return { reason: '溜入底池（没有翻前加注），没有对应的翻前范围' };
  if (raisers.length > 2) return { reason: '4-bet 以上的底池，翻前范围库没有对应的范围' };
  const [a, b] = inHand.sort((x, y) => pos.indexOf(x) - pos.indexOf(y));
  let scenario: Scenario;
  try {
    scenario = makeScenario(format.id, raisers.length === 1 ? 'srp' : '3bp', a, b);
  } catch (e) {
    return { reason: (e as Error).message };
  }
  if (raisers.length === 1 && raisers[0] !== a) return { reason: '翻前加注者不是先行动的玩家（例如溜入后再加注），没有对应的范围' };
  // 底池 = 所有人翻前投入（含已弃牌玩家的盲注）+ 前注
  let pot = rec.game === 'mtt' ? Math.max(format.ante, rec.antePerPlayer * rec.players) : 0;
  for (const [, v] of contributed) pot += v;
  const inv = Math.max(contributed.get(a) ?? 0, contributed.get(b) ?? 0);
  const stackBB = Math.max(0.5, Math.min(rec.stacks[a] ?? rec.stackBB, rec.stacks[b] ?? rec.stackBB) - inv - (rec.game === 'mtt' ? rec.antePerPlayer : 0));
  return {
    setup: {
      scenario,
      potBB: Math.round(pot * 100) / 100,
      stackBB: Math.round(stackBB * 100) / 100,
      heroSeat: scenario.oop === rec.hero ? 0 : 1,
      flopActions: rec.actions.filter((x) => x.street > 0),
    },
  };
}

/** 求解器里的手牌写法（大牌编号在前，编号 = 4 × 点数 + 花色 c<d<h<s） */
export function solverHand(cards: [number, number], suitMap?: Record<string, string>): string {
  const s = cards.map((c) => {
    const t = cardToString(c);
    return t[0] + (suitMap ? suitMap[t[1]] : t[1]);
  });
  const id = (x: string) => solverCardId(x);
  return id(s[0]) > id(s[1]) ? s[0] + s[1] : s[1] + s[0];
}

export interface WalkSource {
  hands: [string[], string[]];
  getNode(history: number[]): Promise<NodeData | null>;
  label: string;
  /** 精确度说明 */
  expl?: string;
}

/**
 * 沿实际行动走博弈树：下注尺寸映射到树中最接近的尺寸；主角的每个决策给出点评。
 * potScale = 树的起始底池 / 实际起始底池（筹码单位换算）
 */
export async function reviewPostflop(
  rec: HandRecord,
  setup: PostflopSetup,
  src: WalkSource,
  opts: { suitMap?: Record<string, string>; potScale: number; boardLimit?: number },
): Promise<ReviewStep[]> {
  const steps: ReviewStep[] = [];
  const history: number[] = [];
  const heroSeat = setup.heroSeat;
  const heroHand = solverHand(rec.heroCards, opts.suitMap);
  const hi = src.hands[heroSeat].indexOf(heroHand);
  const seatOf = (p: Position) => (p === setup.scenario.oop ? 0 : 1);
  const mapCard = (c: number) => {
    const t = cardToString(c);
    return t[0] + (opts.suitMap ? opts.suitMap[t[1]] : t[1]);
  };
  let street: Street = 1;
  let pendingNote = '';
  for (const a of setup.flopActions) {
    let node = await src.getNode(history);
    // 发牌节点：发出实际的转牌/河牌
    while (node && node.kind === 'chance') {
      const boardIdx = node.board.length;
      const real = rec.board[boardIdx];
      if (real === undefined) return steps;
      const card = mapCard(real);
      if (!node.cards.includes(card)) {
        steps.push({ street: a.street, title: STREET_NAMES[a.street], heroAction: '', freqs: [], note: `无法在求解结果中发出 ${card}` });
        return steps;
      }
      history.push(solverCardId(card));
      node = await src.getNode(history);
    }
    if (!node) {
      steps.push({ street: a.street, title: STREET_NAMES[a.street], heroAction: '', freqs: [], note: `${src.label}中没有${STREET_NAMES[a.street]}之后的数据${src.label.includes('预计算') ? '（预计算只包含翻牌圈）' : ''}，可以用浏览器求解器继续分析` });
      return steps;
    }
    if (node.kind === 'terminal') return steps;
    street = a.street;
    const seat = seatOf(a.pos);
    if (node.player !== seat) {
      steps.push({ street, title: STREET_NAMES[street], heroAction: '', freqs: [], note: `行动顺序与求解树不一致（${POSITION_SHORT[a.pos]} 的行动），停止对照` });
      return steps;
    }
    const idx = matchAction(node, a, opts.potScale);
    if (idx.index < 0) {
      steps.push({ street, title: STREET_NAMES[street], heroAction: '', freqs: [], note: `${POSITION_SHORT[a.pos]} 的实际行动（${describeH(a)}）在简化博弈树中没有对应选项（${node.actions.map((x) => describeAction(x, node!)).join(' / ')}），之后无法对照` });
      return steps;
    }
    if (seat === heroSeat) {
      const n = src.hands[heroSeat].length;
      if (hi < 0 || node.weights[heroSeat][hi] <= 0) {
        steps.push({ street, title: `${STREET_NAMES[street]}：${node.board.join(' ')}`, heroAction: describeH(a), freqs: [], note: '按求解结果，你的手牌在这一步之前已经不会走到这里（不在当前范围内），无法给出点评' });
      } else {
        const g = gradePostflop(node, n, hi, idx.index);
        steps.push({
          street,
          title: `${STREET_NAMES[street]}：${node.board.join(' ')} · 底池 ${+(node.pot / CHIPS_PER_BB / opts.potScale).toFixed(1)}bb`,
          heroAction: describeH(a) + (idx.approx ? `（按最接近的"${describeAction(node.actions[idx.index], node)}"对照）` : ''),
          grade: g.grade,
          evLoss: g.evLoss / CHIPS_PER_BB / opts.potScale,
          freqs: node.actions.map((c, k) => ({ label: describeAction(c, node!), freq: g.freqs[k], ev: g.evs[k] / CHIPS_PER_BB / opts.potScale, chosen: k === idx.index })),
          source: src.label + (src.expl ? `（${src.expl}）` : ''),
          note: pendingNote || undefined,
        });
      }
      pendingNote = '';
    } else if (idx.approx) {
      pendingNote = `对手的${describeH(a)}在简化博弈树中按最接近的"${describeAction(node.actions[idx.index], node)}"处理。`;
    }
    history.push(idx.index);
  }
  return steps;
}

function describeH(a: HAction): string {
  switch (a.kind) {
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return `跟注 ${a.amount}bb`;
    case 'bet':
      return `下注 ${a.amount}bb${a.allin ? '（全下）' : ''}`;
    case 'raise':
      return `加注到 ${a.amount}bb${a.allin ? '（全下）' : ''}`;
  }
}

/** 实际行动 → 树中的动作序号 */
export function matchAction(node: NodeData, a: HAction, potScale: number): { index: number; approx: boolean } {
  const kinds = node.actions.map((c) => parseAction(c));
  const find = (k: string) => kinds.findIndex((x) => x.kind === k);
  if (a.kind === 'fold') return { index: find('fold'), approx: false };
  if (a.kind === 'check') return { index: find('check'), approx: false };
  if (a.kind === 'call') return { index: find('call'), approx: false };
  // 下注/加注：比较下注额（换算到树的筹码）
  const target = a.amount * CHIPS_PER_BB * potScale;
  let best = -1;
  let bestD = Infinity;
  kinds.forEach((x, i) => {
    if (x.kind !== 'bet' && x.kind !== 'raise' && x.kind !== 'allin') return;
    if (a.allin && x.kind === 'allin') {
      best = i;
      bestD = -1;
      return;
    }
    if (bestD < 0) return;
    const d = Math.abs(Math.log(Math.max(1, x.amount) / Math.max(1, target)));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return { index: best, approx: best >= 0 && bestD > 0.08 };
}

