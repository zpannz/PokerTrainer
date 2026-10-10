// 模拟对战的一局（现金桌 / 单桌 SNG / 决赛桌残局）：座位、盲注级别、换手、结算、统计、手牌记录
import { type AnteMode, type HandState, type LogKind, type Street, currentPlayer, startHand } from './engine.ts';
import { type PlayerStats, recordStats } from './stats.ts';
import { allinEvNet } from './allinEv.ts';
import { type StyleId } from './styles.ts';
import { type U32, cryptoU32, randInt, toUnit } from './rng.ts';

export type SessionKind = 'cash' | 'sng' | 'ft';

export interface CashConfig {
  kind: 'cash';
  tableSize: 6 | 9;
  sb: number;
  bb: number;
  buyinBB: number;
  styles: StyleId[]; // 对手（按座位顺序）
  hands: number;
  /** 每手开始前把自己的筹码补到买入额 */
  autoTopUp: boolean;
}

export type Structure = 'fast' | 'standard';

export interface TourneyConfig {
  kind: 'sng' | 'ft';
  tableSize: 6 | 9;
  /** 起始筹码（SNG）；决赛桌残局为平均筹码对应的大盲数 */
  startStack: number;
  structure: Structure;
  anteMode: AnteMode;
  /** 奖金（虚拟），按名次 */
  payouts: number[];
  styles: StyleId[];
  /** 决赛桌残局：剩余人数与筹码深度 */
  ftPlayers?: number;
  ftDepth?: 'short' | 'medium' | 'deep';
}

export type SessionConfig = CashConfig | TourneyConfig;

export interface SeatInfo {
  seat: number;
  name: string;
  style: StyleId | null; // null = 你
  isHero: boolean;
  stack: number;
  /** 现金桌：累计买入 */
  bought: number;
  busted: boolean;
  /** 锦标赛名次 */
  place?: number;
  prize?: number;
}

/** 紧凑的手牌记录（保存到本地） */
export interface CompactHand {
  no: number;
  button: number;
  sb: number;
  bb: number;
  ante: number;
  am: AnteMode;
  level?: number;
  /** [座位, 起始筹码, 手牌1, 手牌2] */
  p: [number, number, number, number][];
  b: number[];
  /** [街, 座位, 动作, 投入, 本街总额, 全下 0/1] */
  l: [number, number, number, number, number, number][];
  /** [座位, 赢得筹码] */
  w: [number, number][];
  /** 退回：[座位, 筹码, 街] */
  r: [number, number, number][];
  /** 底池：[金额, 赢家座位...] */
  pots: [number, number[]][];
  sd: 0 | 1;
  /** 你的净输赢、EV 调整后的净输赢（筹码） */
  net: number;
  ev: number;
  /** 下注结束时公共牌张数（全下） */
  ai: number | null;
}

export const LOG_KINDS: LogKind[] = ['sb', 'bb', 'ante', 'fold', 'check', 'call', 'bet', 'raise'];

export interface CurvePoint {
  net: number; // 累计（筹码）
  ev: number;
}

export interface Session {
  version: 1;
  id: string;
  created: number;
  updated: number;
  config: SessionConfig;
  seats: SeatInfo[];
  heroSeat: number;
  handNo: number;
  button: number;
  level: number;
  /** 起始盲注级别（决赛桌残局不从第 1 级开始） */
  levelStart: number;
  current: HandState | null;
  history: CompactHand[];
  stats: Record<number, PlayerStats>;
  curve: CurvePoint[];
  finished: boolean;
  endNote?: string;
  /** 本局开始时的奖金/筹码信息（决赛桌残局用来显示起始局面） */
  startStacks: number[];
}

const NAMES = ['Alex', 'Ben', 'Chen', 'Dana', 'Eli', 'Fay', 'Gus', 'Hana'];

// ---------- 盲注结构 ----------

const LEVEL_MULT = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500];

function nice(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  let best = steps[0] * p;
  for (const s of steps) if (Math.abs(s * p - x) < Math.abs(best - x)) best = s * p;
  let v = Math.round(best);
  if (v % 2) v++;
  return Math.max(2, v);
}

export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
}

export function blindLevels(startStack: number, anteMode: AnteMode): BlindLevel[] {
  const base = startStack / 75;
  return LEVEL_MULT.map((m) => {
    const bb = nice(base * m);
    const ante = anteMode === 'bb' ? bb : anteMode === 'each' ? Math.max(1, Math.round(bb / 8)) : 0;
    return { sb: bb / 2, bb, ante };
  });
}

export const handsPerLevel = (s: Structure) => (s === 'fast' ? 6 : 12);

export const DEFAULT_PAYOUTS: Record<string, number[]> = {
  sng6: [65, 35],
  sng9: [50, 30, 20],
  ft: [3000, 2000, 1450, 1100, 850, 650],
};

// ---------- 创建 ----------

function sessionId(): string {
  return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

export function newSession(config: SessionConfig, u: U32 = cryptoU32()): Session {
  const n = config.kind === 'ft' ? Math.max(3, Math.min(6, config.ftPlayers ?? 6)) : config.tableSize;
  // 你坐在随机座位上，按钮从随机座位开始
  const heroSeat = randInt(u, n);
  const seats: SeatInfo[] = [];
  let ai = 0;
  for (let s = 0; s < n; s++) {
    if (s === heroSeat) seats.push({ seat: s, name: 'Hero', style: null, isHero: true, stack: 0, bought: 0, busted: false });
    else {
      seats.push({ seat: s, name: NAMES[ai], style: config.styles[ai % config.styles.length], isHero: false, stack: 0, bought: 0, busted: false });
      ai++;
    }
  }
  let level = 0;
  if (config.kind === 'cash') {
    for (const s of seats) {
      s.stack = config.buyinBB * config.bb;
      s.bought = s.stack;
    }
  } else if (config.kind === 'sng') {
    for (const s of seats) s.stack = config.startStack;
  } else {
    // 决赛桌残局：大盲固定从 100/200 级别开始（起始筹码 1500 的结构），筹码深浅不一
    const levels = blindLevels(1500, config.anteMode);
    level = levels.findIndex((l) => l.bb >= 200);
    const bb = levels[level].bb;
    const avg = config.ftDepth === 'short' ? 12 : config.ftDepth === 'deep' ? 35 : 20;
    const r = toUnit(u);
    const w = seats.map(() => 0.25 + Math.pow(r(), 1.3) * 1.75);
    const sum = w.reduce((a, b) => a + b, 0);
    const total = avg * bb * n;
    for (let i = 0; i < n; i++) seats[i].stack = Math.max(3 * bb, Math.round(((w[i] / sum) * total) / 50) * 50);
  }
  return {
    version: 1,
    id: sessionId(),
    created: Date.now(),
    updated: Date.now(),
    config,
    seats,
    heroSeat,
    handNo: 0,
    button: randInt(u, n),
    level,
    levelStart: level,
    current: null,
    history: [],
    stats: {},
    curve: [],
    finished: false,
    startStacks: seats.map((s) => s.stack),
  };
}

export function currentBlinds(s: Session): BlindLevel {
  const c = s.config;
  if (c.kind === 'cash') return { sb: c.sb, bb: c.bb, ante: 0 };
  const levels = blindLevels(c.kind === 'ft' ? 1500 : c.startStack, c.anteMode);
  return levels[Math.min(s.level, levels.length - 1)];
}

export function heroInfo(s: Session): SeatInfo {
  return s.seats[s.heroSeat];
}

/** 开始新的一手牌 */
export function beginHand(s: Session, u: U32 = cryptoU32()): HandState {
  if (s.finished) throw new Error('这一局已经结束');
  if (s.current && !s.current.done) return s.current;
  const c = s.config;
  if (c.kind === 'cash') {
    for (const p of s.seats) {
      const buyin = c.buyinBB * c.bb;
      const topUp = p.isHero ? c.autoTopUp || p.stack === 0 : p.stack < buyin * 0.4;
      if (topUp && p.stack < buyin) {
        p.bought += buyin - p.stack;
        p.stack = buyin;
      }
    }
  } else {
    // 升盲
    s.level = s.levelStart + Math.floor(s.handNo / handsPerLevel(c.structure));
  }
  const live = s.seats.filter((p) => !p.busted && p.stack > 0);
  // 按钮移到下一位在场玩家
  const n = s.seats.length;
  if (s.handNo > 0 || s.seats[s.button].busted) {
    for (let k = 1; k <= n; k++) {
      const seat = (s.button + k) % n;
      if (!s.seats[seat].busted && s.seats[seat].stack > 0) {
        s.button = seat;
        break;
      }
    }
  }
  const bl = currentBlinds(s);
  const st = startHand({
    seats: live.map((p) => ({ seat: p.seat, stack: p.stack })),
    button: s.button,
    sb: bl.sb,
    bb: bl.bb,
    ante: bl.ante,
    anteMode: c.kind === 'cash' ? 'none' : c.anteMode,
    rng: u,
  });
  s.current = st;
  s.updated = Date.now();
  return st;
}

/** 一手牌结束后的结算 */
export function finishHand(s: Session, u: U32 = cryptoU32()): CompactHand {
  const st = s.current;
  if (!st || !st.done || !st.result) throw new Error('这手牌还没有结束');
  const r = st.result;
  s.handNo++;
  for (const p of st.players) s.seats[p.seat].stack = p.stack;
  recordStats(s.stats, st);
  const heroP = st.players.find((p) => p.seat === s.heroSeat);
  const evAll = allinEvNet(st, 8000, u);
  const net = heroP ? r.net[s.heroSeat] : 0;
  const ev = heroP ? (evAll ? evAll[s.heroSeat] : net) : 0;
  const prev = s.curve[s.curve.length - 1] ?? { net: 0, ev: 0 };
  s.curve.push({ net: prev.net + net, ev: prev.ev + ev });
  const ch: CompactHand = {
    no: s.handNo,
    button: st.button,
    sb: st.sb,
    bb: st.bb,
    ante: st.ante,
    am: st.anteMode,
    level: s.config.kind === 'cash' ? undefined : s.level,
    p: st.players.map((p) => [p.seat, p.startStack, p.hole[0], p.hole[1]]),
    b: [...st.board],
    l: st.log.map((e) => [e.street, e.seat, LOG_KINDS.indexOf(e.kind), e.amount, e.to, e.allin ? 1 : 0]),
    w: Object.entries(r.won).map(([k, v]) => [Number(k), v]),
    r: r.returned.map((x) => [x.seat, x.amount, x.street]),
    pots: r.pots.map((p) => [p.amount, p.winners]),
    sd: r.showdown ? 1 : 0,
    net,
    ev,
    ai: r.allinBoard,
  };
  s.history.push(ch);
  // 淘汰与名次
  if (s.config.kind !== 'cash') {
    const remainingBefore = s.seats.filter((p) => !p.busted).length;
    const out = st.players.filter((p) => p.stack === 0).sort((a, b) => b.startStack - a.startStack);
    // 同一手牌被淘汰的玩家，起始筹码多的名次靠前
    out.forEach((p, i) => {
      const seat = s.seats[p.seat];
      seat.busted = true;
      seat.place = remainingBefore - (out.length - 1 - i);
      seat.prize = s.config.kind === 'cash' ? 0 : (s.config as TourneyConfig).payouts[seat.place - 1] ?? 0;
    });
    const alive = s.seats.filter((p) => !p.busted);
    if (alive.length === 1) {
      alive[0].place = 1;
      alive[0].prize = (s.config as TourneyConfig).payouts[0] ?? 0;
      s.finished = true;
      s.endNote = alive[0].isHero ? '你赢得了冠军！' : `比赛结束，你获得第 ${heroInfo(s).place} 名`;
    } else if (heroInfo(s).busted) {
      s.finished = true;
      s.endNote = `你被淘汰，获得第 ${heroInfo(s).place} 名`;
    }
  } else if (s.handNo >= s.config.hands) {
    s.finished = true;
    s.endNote = `已打完设定的 ${s.config.hands} 手`;
  }
  s.current = null;
  s.updated = Date.now();
  return ch;
}

export function isHeroTurn(s: Session): boolean {
  const st = s.current;
  if (!st || st.done) return false;
  return currentPlayer(st)?.seat === s.heroSeat;
}

/** 现金桌：总盈亏（筹码） */
export function cashProfit(s: Session): number {
  const h = heroInfo(s);
  return h.stack - h.bought;
}

/** bb/100 */
export function bbPer100(s: Session, field: 'net' | 'ev' = 'net'): number {
  if (s.history.length === 0) return 0;
  let tot = 0;
  for (const h of s.history) tot += (field === 'net' ? h.net : h.ev) / h.bb;
  return (tot / s.history.length) * 100;
}

export type { Street };
