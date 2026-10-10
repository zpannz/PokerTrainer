// 翻后匹配预计算牌面库：单挑、单一加注或 3-bet 底池、翻牌与库中某个翻牌花色同构、筹码底池比接近时，
// 沿实际行动走博弈树，AI 按求解结果行动
import { cardToString } from '../lib/cards.ts';
import { matchAction, solverHand } from '../lib/handReview.ts';
import type { HAction } from '../lib/handHistory.ts';
import { makeScenario } from '../postflop/scenarios.ts';
import { findPrecomputed } from '../postflop/precomputed.ts';
import { CHIPS_PER_BB, historyKey, type SolvedSpot } from '../postflop/types.ts';
import { type HandState, potBeforeStreet } from './engine.ts';
import { type GameKind, chartFormat, effectiveBB, seatPositions } from './preflop.ts';
import type { SolverView } from './ai.ts';
import { positionsOf as formatPositions } from '../lib/formats.ts';

export type SpotProvider = (scenarioId: string, flop: string) => Promise<{ spot: SolvedSpot; map: Record<string, string> } | null>;

export const defaultProvider: SpotProvider = (id, flop) => findPrecomputed(id, flop).catch(() => null);

interface Tracker {
  status: 'loading' | 'ready' | 'off';
  promise?: Promise<void>;
  spot?: SolvedSpot;
  map?: Record<string, string>;
  potScale: number;
  seats: [number, number]; // [OOP, IP]
  history: number[];
  processed: number;
  scenarioId?: string;
}

const trackers = new WeakMap<HandState, Tracker>();

/** 翻牌圈开始时调用：查找可匹配的预计算结果（异步加载） */
export function ensureSolver(st: HandState, game: GameKind, provider: SpotProvider = defaultProvider): Promise<void> | null {
  if (st.street === 0 || st.board.length < 3) return null;
  let t = trackers.get(st);
  if (t) return t.status === 'loading' ? t.promise! : null;
  t = { status: 'off', potScale: 1, seats: [-1, -1], history: [], processed: 0 };
  trackers.set(st, t);
  const live = st.players.filter((p) => !p.folded);
  if (live.length !== 2) return null;
  // 翻前：加注者
  const pre = st.log.filter((e) => e.street === 0 && (e.kind === 'raise' || e.kind === 'bet' || e.kind === 'call'));
  const raisers = pre.filter((e) => e.kind === 'raise' || e.kind === 'bet').map((e) => e.seat);
  if (raisers.length < 1 || raisers.length > 2) return null;
  if (pre.some((e) => e.kind === 'call' && raisers.indexOf(e.seat) < 0 && !live.some((p) => p.seat === e.seat))) return null; // 有人跟注后弃牌（多人）
  const n = st.players.length;
  const eff = Math.min(effectiveBB(st, live[0].seat), effectiveBB(st, live[1].seat));
  const f = chartFormat(game, n, eff);
  const pos = seatPositions(st);
  const order = formatPositions(f);
  const [a, b] = live.map((p) => p.seat).sort((x, y) => order.indexOf(pos.get(x)!) - order.indexOf(pos.get(y)!));
  if (raisers[0] !== a) return null;
  let sc;
  try {
    sc = makeScenario(f.id, raisers.length === 1 ? 'srp' : '3bp', pos.get(a)!, pos.get(b)!);
  } catch {
    return null;
  }
  const flop = st.board.slice(0, 3).map(cardToString).join('');
  const realPotBB = potBeforeStreet(st) / st.bb;
  const stackLeftBB = Math.min(...live.map((p) => p.stack + p.street)) / st.bb;
  const tr = t;
  tr.status = 'loading';
  tr.scenarioId = sc.id;
  tr.seats = sc.oop === pos.get(a) ? [a, b] : [b, a];
  tr.promise = provider(sc.id, flop)
    .then((res) => {
      if (!res) {
        tr.status = 'off';
        return;
      }
      const cfg = res.spot.config;
      const treeSpr = cfg.stack / cfg.pot;
      const realSpr = stackLeftBB / realPotBB;
      if (Math.abs(Math.log(realSpr / treeSpr)) > 0.3) {
        tr.status = 'off';
        return;
      }
      tr.spot = res.spot;
      tr.map = res.map;
      tr.potScale = cfg.pot / (realPotBB * CHIPS_PER_BB);
      tr.status = 'ready';
    })
    .catch(() => {
      tr.status = 'off';
    });
  return tr.promise;
}

/** 把新的翻后行动同步到博弈树上的位置 */
function sync(st: HandState, t: Tracker): void {
  if (t.status !== 'ready' || !t.spot) return;
  const post = st.log.filter((e) => e.street > 0);
  for (; t.processed < post.length; t.processed++) {
    const e = post[t.processed];
    if (e.street !== 1) {
      t.status = 'off';
      return;
    }
    const node = t.spot.nodes[historyKey(t.history)];
    if (!node || node.kind !== 'player') {
      t.status = 'off';
      return;
    }
    const seatIdx = t.seats.indexOf(e.seat);
    if (node.player !== seatIdx) {
      t.status = 'off';
      return;
    }
    const kind = e.kind as HAction['kind'];
    const amount = e.kind === 'bet' || e.kind === 'raise' ? e.to / st.bb : e.amount / st.bb;
    const m = matchAction(node, { street: 1, pos: 'BB', kind, amount, allin: e.allin }, t.potScale);
    if (m.index < 0) {
      t.status = 'off';
      return;
    }
    t.history.push(m.index);
  }
}

/** 当前行动者在求解树中的视图（没有匹配时返回 null） */
export function solverView(st: HandState, seat: number): SolverView | null {
  const t = trackers.get(st);
  if (!t || t.status !== 'ready' || !t.spot || st.street !== 1) return null;
  sync(st, t);
  if (t.status !== 'ready') return null;
  const node = t.spot.nodes[historyKey(t.history)];
  const seatIdx = t.seats.indexOf(seat);
  if (!node || node.kind !== 'player' || node.player !== seatIdx) return null;
  const p = st.players.find((x) => x.seat === seat)!;
  const hands = t.spot.hands[seatIdx];
  const hand = solverHand(p.hole, t.map);
  const scale = t.potScale;
  return {
    node,
    hands,
    handIndex: node.weights[seatIdx][hands.indexOf(hand)] > 0 ? hands.indexOf(hand) : -1,
    toReal: (chips) => (chips / scale / CHIPS_PER_BB) * st.bb,
  };
}

export function solverStatus(st: HandState): { scenario?: string; status: Tracker['status'] } | null {
  const t = trackers.get(st);
  return t ? { scenario: t.scenarioId, status: t.status } : null;
}
