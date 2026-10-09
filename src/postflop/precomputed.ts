// 预计算牌面库（GitHub Actions 生成，放在网站的 postflop/ 目录下）
import type { FlopTexture } from './flops.ts';
import { canonicalFlop, suitMapping } from './flops.ts';
import type { NodeData, SolvedSpot } from './types.ts';

export interface IndexFlop {
  flop: string;
  texture: FlopTexture;
  weight: number;
  expl: number; // % 底池
  iter: number;
  size: number;
}

export interface IndexScenario {
  id: string;
  dir: string;
  title: string;
  players: [string, string];
  pot: number;
  stack: number;
  flops: IndexFlop[];
}

export interface PostflopIndex {
  generated: string;
  scenarios: IndexScenario[];
}

export const scenarioDir = (id: string) => id.replace(/\//g, '_');

const base = () => {
  const env = (import.meta as { env?: { BASE_URL?: string } }).env;
  return (env?.BASE_URL ?? './') + 'postflop/';
};

let indexPromise: Promise<PostflopIndex> | null = null;
export function loadIndex(): Promise<PostflopIndex> {
  indexPromise ??= fetch(base() + 'index.json')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PostflopIndex>;
    })
    .catch((e) => {
      indexPromise = null;
      throw new Error(`预计算牌面库加载失败：${(e as Error).message}`);
    });
  return indexPromise;
}

interface CompactNode {
  k: NodeData['kind'];
  p: number;
  pot: number;
  b: [number, number];
  a: string[];
  w: [number[], number[]];
  nw: [number[], number[]];
  q: [number[], number[]];
  v: [number[], number[]];
  s?: number[];
  e?: number[];
}

export interface CompactFile {
  v: number;
  scenario: string;
  title: string;
  players: [string, string];
  flop: string;
  meta: { ranges: [string, string]; pot: number; stack: number; sizes: SolvedSpot['config']['sizes']; raiseCap: [number, number, number]; targetPct: number };
  hands: [string, string];
  expl: number;
  iter: number;
  seconds: number;
  memoryMB: number;
  compressed: boolean;
  nodes: Record<string, CompactNode>;
}

/** 把紧凑格式展开成与浏览器求解结果相同的结构 */
export function expandCompact(f: CompactFile): SolvedSpot {
  const board = [f.flop.slice(0, 2), f.flop.slice(2, 4), f.flop.slice(4, 6)];
  const nodes: Record<string, NodeData> = {};
  const div = (a: number[], d: number) => a.map((x) => x / d);
  for (const [k, n] of Object.entries(f.nodes)) {
    nodes[k] = {
      kind: n.k,
      player: n.p,
      history: k === '' ? [] : k.split(',').map(Number),
      board,
      pot: n.pot,
      bets: n.b,
      actions: n.a,
      cards: [],
      weights: [div(n.w[0], 1000), div(n.w[1], 1000)],
      normWeights: [div(n.nw[0], 10), div(n.nw[1], 10)],
      equity: [div(n.q[0], 1000), div(n.q[1], 1000)],
      ev: [n.v[0], n.v[1]],
      strategy: n.s ? div(n.s, 1000) : [],
      actionEv: n.e ?? [],
    };
  }
  return {
    key: `pre:${f.scenario}:${f.flop}`,
    title: `${f.title} · ${f.flop}`,
    config: { ranges: f.meta.ranges, board: f.flop, pot: f.meta.pot, stack: f.meta.stack, sizes: f.meta.sizes, raiseCap: f.meta.raiseCap },
    hands: [f.hands[0].split(' '), f.hands[1].split(' ')],
    nodes,
    exploitability: f.expl,
    iterations: f.iter,
    seconds: f.seconds,
    memoryMB: f.memoryMB,
    compressed: f.compressed,
    created: 0,
    scenario: f.scenario,
    players: f.players,
  };
}

const flopCache = new Map<string, Promise<SolvedSpot>>();
export function loadPrecomputed(dir: string, flop: string): Promise<SolvedSpot> {
  const k = `${dir}/${flop}`;
  let p = flopCache.get(k);
  if (!p) {
    p = fetch(`${base()}${dir}/${flop}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CompactFile>;
      })
      .then(expandCompact);
    p.catch(() => flopCache.delete(k));
    flopCache.set(k, p);
  }
  return p;
}

/** 查找与某个具体翻牌同构的预计算结果；返回花色映射（实际花色 → 库中花色） */
export async function findPrecomputed(scenarioId: string, flop: string): Promise<{ spot: SolvedSpot; map: Record<string, string> } | null> {
  let idx: PostflopIndex;
  try {
    idx = await loadIndex();
  } catch {
    return null;
  }
  const sc = idx.scenarios.find((s) => s.id === scenarioId);
  if (!sc) return null;
  const canon = canonicalFlop(flop);
  if (!sc.flops.some((f) => f.flop === canon)) return null;
  const spot = await loadPrecomputed(sc.dir, canon);
  return { spot, map: suitMapping(flop) };
}

/** 按花色映射转换一手牌（"AhKd" → 库中的写法，大牌在前） */
export function mapHand(hand: string, map: Record<string, string>): string {
  const a = hand[0] + map[hand[1]];
  const b = hand[2] + map[hand[3]];
  const R = '23456789TJQKA';
  const ra = R.indexOf(a[0]);
  const rb = R.indexOf(b[0]);
  if (ra > rb) return a + b;
  if (rb > ra) return b + a;
  // 对子：花色按求解器的顺序（s > h > d > c）
  const S = 'cdhs';
  return S.indexOf(a[1]) > S.indexOf(b[1]) ? a + b : b + a;
}
