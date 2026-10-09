// 翻牌的花色同构归并、牌面结构分类与代表性翻牌的选取
import { RANK_CHARS } from '../lib/cards.ts';

export type SuitTexture = 'rainbow' | 'twotone' | 'mono';
export type PairTexture = 'unpaired' | 'paired' | 'trips';
export type HighTexture = 'A' | 'K' | 'Q' | 'JT' | 'low';
export type ConnectTexture = 'connected' | 'semi' | 'dry';

export interface FlopTexture {
  suit: SuitTexture;
  pair: PairTexture;
  high: HighTexture;
  connect: ConnectTexture;
}

export const SUIT_NAMES: Record<SuitTexture, string> = { rainbow: '彩虹面', twotone: '双花面', mono: '单色面' };
export const PAIR_NAMES: Record<PairTexture, string> = { unpaired: '无对子', paired: '对子面', trips: '三条面' };
export const HIGH_NAMES: Record<HighTexture, string> = { A: 'A 高', K: 'K 高', Q: 'Q 高', JT: 'J/T 高', low: '9 及以下' };
export const CONNECT_NAMES: Record<ConnectTexture, string> = { connected: '连接（可成顺）', semi: '半连接', dry: '干燥' };

/** 解析 "Ah7d2c" → [{r, s}]（r: 0=2 … 12=A，s: 0..3 按 shdc） */
function parse(flop: string): { r: number; s: string }[] {
  const out: { r: number; s: string }[] = [];
  for (let i = 0; i < flop.length; i += 2) out.push({ r: RANK_CHARS.indexOf(flop[i].toUpperCase()), s: flop[i + 1].toLowerCase() });
  return out;
}

export function flopTexture(flop: string): FlopTexture {
  const cs = parse(flop.slice(0, 6));
  const suits = new Set(cs.map((c) => c.s)).size;
  const ranks = cs.map((c) => c.r).sort((a, b) => b - a);
  const distinct = [...new Set(ranks)];
  const pair: PairTexture = distinct.length === 3 ? 'unpaired' : distinct.length === 2 ? 'paired' : 'trips';
  const hi = ranks[0];
  const high: HighTexture = hi === 12 ? 'A' : hi === 11 ? 'K' : hi === 10 ? 'Q' : hi >= 8 ? 'JT' : 'low';
  // 连接程度：三张不同点数落在 5 张的跨度内 → 存在两张手牌成顺的可能
  const withWheel = (rs: number[]) => {
    const out = [rs];
    if (rs.includes(12)) out.push(rs.map((r) => (r === 12 ? -1 : r)));
    return out;
  };
  let connect: ConnectTexture = 'dry';
  for (const rs of withWheel(distinct)) {
    const s = [...rs].sort((a, b) => a - b);
    if (s.length === 3 && s[2] - s[0] <= 4) connect = 'connected';
    else if (connect !== 'connected') {
      for (let i = 0; i + 1 < s.length; i++) if (s[i + 1] - s[i] <= 2) connect = 'semi';
    }
  }
  return { suit: suits === 3 ? 'rainbow' : suits === 2 ? 'twotone' : 'mono', pair, high, connect };
}

export function textureLabel(t: FlopTexture): string {
  return [HIGH_NAMES[t.high], SUIT_NAMES[t.suit], t.pair !== 'unpaired' ? PAIR_NAMES[t.pair] : CONNECT_NAMES[t.connect]].join(' · ');
}

const SUITS = 'shdc';

/**
 * 花色同构的规范形式：点数从大到小排列，花色按首次出现的顺序重命名为 s、h、d、c，
 * 同点数的牌按花色排序消除顺序差异。返回规范字符串（例如 "AsKs7h"）。
 */
export function canonicalFlop(flop: string): string {
  const cs = parse(flop.slice(0, 6));
  let best: string | null = null;
  // 尝试同点数牌的所有排列，取字典序最小的结果（保证唯一）
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const p of perms) {
    const arr = p.map((i) => cs[i]);
    if (arr[0].r < arr[1].r || arr[1].r < arr[2].r) continue;
    const map = new Map<string, string>();
    let s = '';
    for (const c of arr) {
      if (!map.has(c.s)) map.set(c.s, SUITS[map.size]);
      s += RANK_CHARS[c.r] + map.get(c.s);
    }
    if (best === null || s < best) best = s;
  }
  return best!;
}

/** 把一个翻牌映射到规范形式时使用的花色置换（原花色 → 规范花色） */
export function suitMapping(flop: string): Record<string, string> {
  const canon = canonicalFlop(flop);
  const cs = parse(flop.slice(0, 6));
  const target = parse(canon);
  // 在 6 种排列里找到能匹配规范形式的花色映射
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const p of perms) {
    const map: Record<string, string> = {};
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      const c = cs[p[k]];
      if (c.r !== target[k].r) ok = false;
      else if (map[c.s] === undefined) {
        if (Object.values(map).includes(target[k].s)) ok = false;
        else map[c.s] = target[k].s;
      } else if (map[c.s] !== target[k].s) ok = false;
    }
    if (ok) {
      // 补全未出现的花色
      const free = SUITS.split('').filter((x) => !Object.values(map).includes(x));
      for (const s of SUITS) if (map[s] === undefined) map[s] = free.shift()!;
      return map;
    }
  }
  throw new Error('无法映射花色');
}

/** 全部 1755 种花色同构的翻牌，以及每种对应的具体翻牌数（权重） */
export function allCanonicalFlops(): { flop: string; weight: number }[] {
  const counts = new Map<string, number>();
  const cards: string[] = [];
  for (const r of RANK_CHARS) for (const s of SUITS) cards.push(r + s);
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++) {
        const k = canonicalFlop(cards[a] + cards[b] + cards[c]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
  return [...counts.entries()].map(([flop, weight]) => ({ flop, weight })).sort((x, y) => (x.flop < y.flop ? -1 : 1));
}

const rankSum = (flop: string) => parse(flop).reduce((s, c) => s + c.r, 0);

/** 按权重把 n 个名额分给各组（最大余数法），min 为各组的最少名额 */
function apportion<T extends { w: number; key: string }>(groups: T[], n: number, min: (g: T) => number = () => 0): Map<string, number> {
  const out = new Map<string, number>();
  let rest = n;
  for (const g of groups) {
    const m = Math.min(min(g), rest);
    out.set(g.key, m);
    rest -= m;
  }
  const total = groups.reduce((s, g) => s + g.w, 0);
  const rows = groups.map((g) => ({ g, exact: total > 0 ? (g.w / total) * rest : 0 }));
  let used = 0;
  for (const r of rows) {
    const f = Math.floor(r.exact);
    out.set(r.g.key, out.get(r.g.key)! + f);
    used += f;
  }
  rows
    .slice()
    .sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || b.g.w - a.g.w || (a.g.key < b.g.key ? -1 : 1))
    .forEach((r) => {
      if (used < rest) {
        out.set(r.g.key, out.get(r.g.key)! + 1);
        used++;
      }
    });
  return out;
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

export interface RepresentativeFlop {
  flop: string;
  /** 代表的具体翻牌数（用于按真实出现概率加权） */
  weight: number;
  texture: FlopTexture;
}

/**
 * 选取 n 个代表性翻牌。分层按出现概率分配名额：
 * 先按花色结构（彩虹/双花/单色，单色至少 4 个），再按是否有对子，最后按（最高牌, 连接程度）细分；
 * 每组内取点数和分布均匀的翻牌。
 */
export function representativeFlops(n: number): RepresentativeFlop[] {
  type F = { flop: string; weight: number; t: FlopTexture };
  const all: F[] = allCanonicalFlops().map((f) => ({ ...f, t: flopTexture(f.flop) }));
  const out: RepresentativeFlop[] = [];
  const mk = (key: string, list: F[]) => ({ key, list, w: list.reduce((s, f) => s + f.weight, 0) });
  const bySuit = [...groupBy(all, (f) => f.t.suit)].map(([k, l]) => mk(k, l));
  const suitSlots = apportion(bySuit, n, (g) => (g.key === 'mono' ? Math.min(4, Math.ceil(n / 12)) : 0));
  for (const sg of bySuit) {
    const byPair = [...groupBy(sg.list, (f) => f.t.pair)].map(([k, l]) => mk(k, l));
    const pairSlots = apportion(byPair, suitSlots.get(sg.key)!);
    for (const pg of byPair) {
      const sub = [...groupBy(pg.list, (f) => `${f.t.high}|${pg.key === 'unpaired' ? f.t.connect : '-'}`)].map(([k, l]) => mk(k, l));
      const subSlots = apportion(sub, pairSlots.get(pg.key)!);
      for (const g of sub) {
        const slots = subSlots.get(g.key)!;
        if (slots === 0) continue;
        const sorted = g.list.slice().sort((a, b) => rankSum(a.flop) - rankSum(b.flop) || (a.flop < b.flop ? -1 : 1));
        for (let k = 0; k < slots; k++) {
          const f = sorted[Math.min(sorted.length - 1, Math.floor(((k + 0.5) / slots) * sorted.length))];
          if (out.some((o) => o.flop === f.flop)) continue;
          out.push({ flop: f.flop, weight: g.w / slots, texture: f.t });
        }
      }
    }
  }
  return out.sort((a, b) => rankSum(b.flop) - rankSum(a.flop) || (a.flop < b.flop ? -1 : 1));
}
