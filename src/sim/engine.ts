// 无限注德州扑克的单手牌状态机（模拟对战用，虚拟筹码）
//
// - 筹码为整数；盲注、前注（每人前注或大盲前注）、发牌、四条街的下注
// - 最小加注规则：加注额至少等于上一次完整加注的增量；不足额的全下加注不会重新开放已行动玩家的加注权
//   （多次不足额全下累计达到一次完整加注时重新开放，与 TDA 规则一致）
// - 每条街结束时退回无人跟注的部分；按投入额分层计算主池和边池；平分时零头从按钮左侧第一位开始分配
import { evaluate } from '../lib/evaluator.ts';
import { cryptoU32, shuffledDeck, type U32 } from './rng.ts';

export type Street = 0 | 1 | 2 | 3;
export type ActType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type AnteMode = 'none' | 'each' | 'bb';

export interface Act {
  type: ActType;
  /** bet / raise：本街下注到的总额 */
  to?: number;
}

export type LogKind = 'sb' | 'bb' | 'ante' | ActType;

export interface LogEntry {
  street: Street;
  seat: number;
  kind: LogKind;
  /** 这次实际投入的筹码 */
  amount: number;
  /** 行动后该玩家本街的总投入 */
  to: number;
  allin: boolean;
}

export interface HandPlayer {
  seat: number;
  startStack: number;
  stack: number;
  hole: [number, number];
  folded: boolean;
  allin: boolean;
  /** 本街已投入 */
  street: number;
  /** 本手牌总投入（含前注） */
  total: number;
  acted: boolean;
  /** 上次行动时的下注水平（用于判断不足额加注是否重新开放加注权） */
  actedBet: number;
}

export interface Pot {
  amount: number;
  eligible: number[]; // 座位号
  winners: number[];
}

export interface HandResult {
  pots: Pot[];
  /** 每个座位从底池拿回的筹码 */
  won: Record<number, number>;
  /** 每个座位的净输赢 */
  net: Record<number, number>;
  /** 退回的无人跟注筹码 */
  returned: { seat: number; amount: number; street: Street }[];
  showdown: boolean;
  /** 摊牌时各家的牌力值（评估器数值） */
  values: Record<number, number>;
  /** 下注结束时有人全下且公共牌未发完：当时的公共牌张数（用于全下 EV 调整） */
  allinBoard: number | null;
}

export interface HandSetup {
  /** 参与这手牌的玩家（座位号从小到大，沿顺时针方向） */
  seats: { seat: number; stack: number }[];
  button: number; // 座位号
  sb: number;
  bb: number;
  ante: number;
  anteMode: AnteMode;
  /** 指定牌序（测试用）；否则用加密随机数洗牌 */
  deck?: number[];
  rng?: U32;
}

export interface HandState {
  sb: number;
  bb: number;
  ante: number;
  anteMode: AnteMode;
  button: number;
  sbSeat: number;
  bbSeat: number;
  players: HandPlayer[];
  deck: number[];
  deckPos: number;
  board: number[];
  street: Street;
  /** 当前行动者在 players 中的下标；-1 表示无人需要行动 */
  toAct: number;
  currentBet: number;
  /** 最小加注增量 */
  minRaise: number;
  log: LogEntry[];
  returned: HandResult['returned'];
  done: boolean;
  result: HandResult | null;
}

export interface Legal {
  canFold: boolean;
  canCheck: boolean;
  /** 跟注需要投入的筹码（0 = 不需要跟注） */
  call: number;
  canRaise: boolean;
  /** 下注/加注到的最小值、最大值（本街总额）。最大值 = 全下 */
  minTo: number;
  maxTo: number;
  /** 当前是否为首次下注（本街无人下注） */
  isBet: boolean;
}

const canAct = (p: HandPlayer) => !p.folded && !p.allin;

export function startHand(setup: HandSetup): HandState {
  const n = setup.seats.length;
  if (n < 2) throw new Error('至少需要 2 名玩家');
  const players: HandPlayer[] = setup.seats.map((s) => ({
    seat: s.seat,
    startStack: s.stack,
    stack: s.stack,
    hole: [-1, -1],
    folded: false,
    allin: false,
    street: 0,
    total: 0,
    acted: false,
    actedBet: 0,
  }));
  const bi = players.findIndex((p) => p.seat === setup.button);
  if (bi < 0) throw new Error('按钮必须在参与的玩家中');
  const sbi = n === 2 ? bi : (bi + 1) % n;
  const bbi = (sbi + 1) % n;
  const deck = setup.deck ? [...setup.deck] : shuffledDeck(setup.rng ?? cryptoU32());
  const st: HandState = {
    sb: setup.sb,
    bb: setup.bb,
    ante: setup.ante,
    anteMode: setup.ante > 0 ? setup.anteMode : 'none',
    button: setup.button,
    sbSeat: players[sbi].seat,
    bbSeat: players[bbi].seat,
    players,
    deck,
    deckPos: 0,
    board: [],
    street: 0,
    toAct: -1,
    currentBet: 0,
    minRaise: setup.bb,
    log: [],
    returned: [],
    done: false,
    result: null,
  };
  const post = (i: number, amt: number, kind: LogKind, live: boolean) => {
    const p = players[i];
    const a = Math.min(amt, p.stack);
    if (a <= 0) return;
    p.stack -= a;
    p.total += a;
    if (live) p.street += a;
    if (p.stack === 0) p.allin = true;
    st.log.push({ street: 0, seat: p.seat, kind, amount: a, to: p.street, allin: p.allin });
  };
  if (st.anteMode === 'each') for (let k = 0; k < n; k++) post((sbi + k) % n, st.ante, 'ante', false);
  post(sbi, st.sb, 'sb', true);
  post(bbi, st.bb, 'bb', true);
  if (st.anteMode === 'bb') post(bbi, st.ante, 'ante', false);
  st.currentBet = Math.max(st.bb, ...players.map((p) => p.street));
  // 发手牌：从小盲开始，每人一张，发两轮
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < n; k++) {
      const p = players[(sbi + k) % n];
      p.hole[r] = st.deck[st.deckPos++];
    }
  st.toAct = bbi; // advance 从下一位开始找
  advance(st, true);
  return st;
}

export function currentPlayer(st: HandState): HandPlayer | null {
  return st.toAct >= 0 ? st.players[st.toAct] : null;
}

export function legalActions(st: HandState): Legal {
  const p = currentPlayer(st);
  if (!p) throw new Error('没有需要行动的玩家');
  const call = Math.min(Math.max(0, st.currentBet - p.street), p.stack);
  const maxTo = p.street + p.stack;
  // 是否还有其他玩家能对加注作出反应
  const others = st.players.some((q) => q !== p && canAct(q));
  const reopened = !p.acted || st.currentBet - p.actedBet >= st.minRaise;
  const canRaise = others && maxTo > st.currentBet && reopened;
  const minFull = st.currentBet === 0 ? st.bb : st.currentBet + st.minRaise;
  return {
    canFold: call > 0,
    canCheck: call === 0,
    call,
    canRaise,
    minTo: Math.min(minFull, maxTo),
    maxTo,
    isBet: st.currentBet === 0,
  };
}

/** 执行当前行动者的动作；非法金额会被修正到合法范围（低于最小加注 → 最小加注；超过筹码 → 全下） */
export function applyAction(st: HandState, act: Act): void {
  if (st.done) throw new Error('这手牌已经结束');
  const p = currentPlayer(st);
  if (!p) throw new Error('没有需要行动的玩家');
  const L = legalActions(st);
  let type = act.type;
  if (type === 'fold' && !L.canFold) type = 'check';
  if (type === 'check' && !L.canCheck) throw new Error('需要跟注时不能过牌');
  if ((type === 'bet' || type === 'raise') && !L.canRaise) type = L.call > 0 ? 'call' : 'check';
  if (type === 'call' && L.call === 0) type = 'check';
  const entry = (kind: LogKind, amount: number) => st.log.push({ street: st.street, seat: p.seat, kind, amount, to: p.street, allin: p.allin });
  switch (type) {
    case 'fold':
      p.folded = true;
      entry('fold', 0);
      break;
    case 'check':
      entry('check', 0);
      break;
    case 'call': {
      const a = L.call;
      p.stack -= a;
      p.street += a;
      p.total += a;
      if (p.stack === 0) p.allin = true;
      entry('call', a);
      break;
    }
    default: {
      let to = Math.round(act.to ?? L.minTo);
      if (to >= L.maxTo) to = L.maxTo;
      else if (to < L.minTo) to = L.minTo;
      if (to <= st.currentBet) {
        // 全下额不超过当前下注：实际上是跟注
        applyAction(st, { type: 'call' });
        return;
      }
      const a = to - p.street;
      p.stack -= a;
      p.street = to;
      p.total += a;
      if (p.stack === 0) p.allin = true;
      const inc = to - st.currentBet;
      if (inc >= st.minRaise) st.minRaise = inc;
      const kind: LogKind = st.currentBet === 0 ? 'bet' : 'raise';
      st.currentBet = to;
      entry(kind, a);
    }
  }
  p.acted = true;
  p.actedBet = st.currentBet;
  advance(st, false);
}

function nextIndex(st: HandState, from: number, pred: (p: HandPlayer) => boolean): number {
  const n = st.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (pred(st.players[i])) return i;
  }
  return -1;
}

function needsAction(st: HandState, p: HandPlayer): boolean {
  if (!canAct(p)) return false;
  if (p.street < st.currentBet) return true;
  if (p.acted) return false;
  // 没行动过、也不需要跟注：只有还有其他能行动的玩家时才需要行动（否则没有下注的意义）
  return st.players.some((q) => q !== p && canAct(q));
}

function advance(st: HandState, initial: boolean): void {
  const live = st.players.filter((p) => !p.folded);
  if (live.length === 1) {
    returnUncalled(st);
    finish(st, false);
    return;
  }
  const nxt = nextIndex(st, st.toAct, (p) => needsAction(st, p));
  if (nxt >= 0) {
    st.toAct = nxt;
    return;
  }
  void initial;
  // 本街下注结束
  returnUncalled(st);
  st.toAct = -1;
  const actors = st.players.filter(canAct);
  if (st.street === 3) {
    finish(st, true);
    return;
  }
  if (actors.length <= 1) {
    // 全下：发完剩余公共牌后摊牌
    const allinBoard = st.board.length;
    while (st.board.length < 5) st.board.push(st.deck[st.deckPos++]);
    st.street = 3;
    finish(st, true, allinBoard);
    return;
  }
  nextStreet(st);
}

function nextStreet(st: HandState): void {
  st.street = (st.street + 1) as Street;
  const k = st.street === 1 ? 3 : 1;
  for (let i = 0; i < k; i++) st.board.push(st.deck[st.deckPos++]);
  for (const p of st.players) {
    p.street = 0;
    p.acted = false;
    p.actedBet = 0;
  }
  st.currentBet = 0;
  st.minRaise = st.bb;
  const bi = st.players.findIndex((p) => p.seat === st.button);
  st.toAct = bi;
  const nxt = nextIndex(st, bi, (p) => needsAction(st, p));
  st.toAct = nxt;
  if (nxt < 0) advance(st, false);
}

function returnUncalled(st: HandState): void {
  let top = -1;
  let first = 0;
  let second = 0;
  st.players.forEach((p, i) => {
    if (p.street > first) {
      second = first;
      first = p.street;
      top = i;
    } else if (p.street > second) second = p.street;
  });
  if (top < 0 || first <= second) return;
  const p = st.players[top];
  const diff = first - second;
  p.street -= diff;
  p.total -= diff;
  p.stack += diff;
  if (p.stack > 0) p.allin = false;
  st.returned.push({ seat: p.seat, amount: diff, street: st.street });
  if (st.currentBet > p.street) st.currentBet = p.street;
}

/** 按投入额分层计算主池与边池（已弃牌玩家的筹码留在池中，但没有资格赢） */
export function buildPots(players: Pick<HandPlayer, 'seat' | 'total' | 'folded'>[]): Pot[] {
  const levels = [...new Set(players.filter((p) => !p.folded && p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  levels.forEach((lv, k) => {
    const last = k === levels.length - 1;
    let amount = 0;
    for (const p of players) amount += Math.max(0, (last ? p.total : Math.min(p.total, lv)) - prev);
    const eligible = players.filter((p) => !p.folded && p.total >= lv).map((p) => p.seat);
    if (amount > 0) {
      // 只有一人有资格的边池（多出的部分）合并成一个池
      pots.push({ amount, eligible, winners: [] });
    }
    prev = lv;
  });
  return pots;
}

function finish(st: HandState, showdown: boolean, allinBoard: number | null = null): void {
  st.done = true;
  st.toAct = -1;
  const pots = buildPots(st.players);
  const values: Record<number, number> = {};
  const live = st.players.filter((p) => !p.folded);
  if (showdown) for (const p of live) values[p.seat] = evaluate([...p.hole, ...st.board]);
  const won: Record<number, number> = {};
  for (const p of st.players) won[p.seat] = 0;
  // 零头分配顺序：按钮左侧第一位开始
  const n = st.players.length;
  const bi = st.players.findIndex((p) => p.seat === st.button);
  const order = Array.from({ length: n }, (_, k) => st.players[(bi + 1 + k) % n].seat);
  for (const pot of pots) {
    let winners: number[];
    if (!showdown || pot.eligible.length === 1) winners = pot.eligible.length ? pot.eligible : live.map((p) => p.seat);
    else {
      const best = Math.max(...pot.eligible.map((s) => values[s]));
      winners = pot.eligible.filter((s) => values[s] === best);
    }
    winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    pot.winners = winners;
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const w of winners) {
      won[w] += share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
  }
  const net: Record<number, number> = {};
  for (const p of st.players) {
    p.stack += won[p.seat];
    net[p.seat] = p.stack - p.startStack;
  }
  st.result = { pots, won, net, returned: st.returned, showdown, values, allinBoard: showdown && allinBoard !== null && allinBoard < 5 ? allinBoard : null };
}

/** 当前底池（已收进底池的 + 本街下注） */
export function potTotal(st: HandState): number {
  return st.players.reduce((s, p) => s + p.total, 0);
}

/** 本街开始前已收进底池的筹码 */
export function potBeforeStreet(st: HandState): number {
  return st.players.reduce((s, p) => s + p.total - p.street, 0);
}

export function playerBySeat(st: HandState, seat: number): HandPlayer {
  const p = st.players.find((x) => x.seat === seat);
  if (!p) throw new Error(`座位 ${seat} 不在这手牌中`);
  return p;
}
