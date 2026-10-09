// 手牌记录：手动输入的数据结构，以及常见平台手牌历史文本的解析（仅用于牌局结束后的复盘）
// 支持 PokerStars 格式，以及与之相同结构的 GGPoker / Natural8 等（"Poker Hand #..."），现金局和锦标赛。
import { parseCard, cardToString } from './cards.ts';
import type { Position } from './formats.ts';

export type Street = 0 | 1 | 2 | 3; // 翻前 翻牌 转牌 河牌
export const STREET_NAMES = ['翻前', '翻牌', '转牌', '河牌'];

export type HKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface HAction {
  street: Street;
  pos: Position;
  kind: HKind;
  /** bet/raise：本街下注到的总额（bb）；call：本次跟注投入的额度（bb） */
  amount: number;
  allin?: boolean;
}

export interface HandRecord {
  game: 'cash' | 'mtt';
  players: 6 | 9;
  /** 发牌前各位置的筹码（bb）；没有时用 stackBB */
  stacks: Partial<Record<Position, number>>;
  stackBB: number;
  /** 每人前注（bb）。本工具的锦标赛模型为大盲前注 1bb（= 每人 1/人数 bb） */
  antePerPlayer: number;
  hero: Position;
  heroCards: [number, number];
  board: number[];
  actions: HAction[];
  /** 来源说明，例如 "PokerStars 手牌 #123" */
  source?: string;
  warnings: string[];
}

const SEAT_ORDER_6: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const SEAT_ORDER_9: Position[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** 按"从按钮开始的顺时针座位"分配位置。n = 实际在局人数 */
export function assignPositions(n: number): { players: 6 | 9; order: Position[] } {
  if (n <= 2) return { players: 6, order: ['SB', 'BB'] };
  const players: 6 | 9 = n <= 6 ? 6 : 9;
  const all = players === 6 ? SEAT_ORDER_6 : SEAT_ORDER_9;
  // 去掉最前面的位置（人少时没有 UTG 等）
  return { players, order: all.slice(all.length - n) };
}

const money = (s: string) => parseFloat(s.replace(/[$€£¥,]/g, ''));

export function parseHandHistory(text: string): HandRecord {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const warnings: string[] = [];
  const head = lines[0] ?? '';
  if (!/hand\s*#/i.test(head)) throw new Error('无法识别手牌历史：第一行应包含 "Hand #"（支持 PokerStars / GGPoker 格式）');
  const isTourney = /tournament|锦标赛|\bT\d+/i.test(head) || lines.some((l) => /posts the ante|posts ante/i.test(l));
  const btnMatch = lines.map((l) => /Seat #(\d+) is the button/i.exec(l)).find(Boolean);
  if (!btnMatch) throw new Error('找不到按钮位置（"Seat #N is the button"）');
  const btnSeat = Number(btnMatch[1]);
  const seats: { seat: number; name: string; chips: number }[] = [];
  for (const l of lines) {
    const m = /^Seat (\d+): (.+?) \(([$€£¥]?[\d,.]+)(?: in chips)?[^)]*\)(?!.*(sitting out|out of hand))/i.exec(l);
    if (m && !/\*\*\* SUMMARY/.test(l)) {
      if (seats.some((s) => s.seat === Number(m[1]))) continue;
      seats.push({ seat: Number(m[1]), name: m[2], chips: money(m[3]) });
    }
    if (/^\*\*\* HOLE CARDS/i.test(l)) break;
  }
  if (seats.length < 2) throw new Error('找不到座位信息');
  // 大盲金额
  let bbAmt = 0;
  for (const l of lines) {
    const m = /posts (?:the )?big blind ([$€£¥]?[\d,.]+)/i.exec(l);
    if (m) {
      bbAmt = money(m[1]);
      break;
    }
  }
  if (!bbAmt) {
    const m = /\(([$€£¥]?[\d,.]+)\/([$€£¥]?[\d,.]+)/.exec(head) ?? /Level \w+ \(([\d,.]+)\/([\d,.]+)/i.exec(head);
    if (m) bbAmt = money(m[2]);
  }
  if (!bbAmt) throw new Error('找不到大盲金额');
  // 座位 → 位置：从按钮下一位（小盲）开始
  seats.sort((a, b) => a.seat - b.seat);
  const btnIdx = seats.findIndex((s) => s.seat === btnSeat);
  const n = seats.length;
  const { players, order } = assignPositions(n);
  const posOf = new Map<string, Position>();
  if (n === 2) {
    // 单挑：按钮是小盲
    posOf.set(seats[btnIdx].name, 'SB');
    posOf.set(seats[(btnIdx + 1) % n].name, 'BB');
    warnings.push('单挑牌局：按钮 = 小盲，翻前按 6 人桌小盲 vs 大盲对照，仅供参考');
  } else {
    // order 以 UTG… BTN SB BB 排列；按钮在 order 中的位置为 n-3
    for (let k = 0; k < n; k++) {
      const seat = seats[(btnIdx + 1 + k) % n]; // 小盲、大盲、UTG…按钮
      const pos = k === 0 ? 'SB' : k === 1 ? 'BB' : order[k - 2];
      posOf.set(seat.name, pos as Position);
    }
  }
  // 主角与手牌
  let hero = '';
  let heroCards: [number, number] | null = null;
  for (const l of lines) {
    const m = /^Dealt to (.+?) \[(\w\w) (\w\w)\]/i.exec(l);
    if (m) {
      hero = m[1];
      heroCards = [parseCard(m[2]), parseCard(m[3])];
      break;
    }
  }
  if (!heroCards) throw new Error('找不到你的手牌（"Dealt to 名字 [Ah Kd]"）');
  let ante = 0;
  for (const l of lines) {
    const m = /posts (?:the )?ante ([$€£¥]?[\d,.]+)/i.exec(l);
    if (m) {
      ante = money(m[1]) / bbAmt;
      break;
    }
  }
  // 行动
  const actions: HAction[] = [];
  let street: Street = 0;
  let board: number[] = [];
  const streetBet = new Map<string, number>(); // 本街已投入（bb）
  // 盲注计入翻前投入
  for (const l of lines) {
    const m = /^(.+?): posts (small|big) blind ([$€£¥]?[\d,.]+)/i.exec(l);
    if (m) streetBet.set(m[1], money(m[3]) / bbAmt);
    if (/^\*\*\* HOLE CARDS/i.test(l)) break;
  }
  let started = false;
  for (const l of lines) {
    if (/^\*\*\* HOLE CARDS/i.test(l)) {
      started = true;
      continue;
    }
    if (!started) continue;
    const st = /^\*\*\* (FLOP|TURN|RIVER) \*\*\*(.*)$/i.exec(l);
    if (st) {
      street = (st[1].toUpperCase() === 'FLOP' ? 1 : st[1].toUpperCase() === 'TURN' ? 2 : 3) as Street;
      const cards = [...st[2].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1]).join(' ');
      board = cards.split(/\s+/).filter(Boolean).map(parseCard);
      streetBet.clear();
      continue;
    }
    if (/^\*\*\* (SHOW ?DOWN|SUMMARY)/i.test(l)) break;
    const m = /^(.+?): (folds|checks|calls|bets|raises)(?: ([$€£¥]?[\d,.]+))?(?: to ([$€£¥]?[\d,.]+))?(.*)$/i.exec(l);
    if (!m) continue;
    const name = m[1];
    const pos = posOf.get(name);
    if (!pos) continue;
    const verb = m[2].toLowerCase();
    const allin = /all-in/i.test(m[5] ?? '');
    const prev = streetBet.get(name) ?? 0;
    let kind: HKind;
    let amount = 0;
    if (verb === 'folds') kind = 'fold';
    else if (verb === 'checks') kind = 'check';
    else if (verb === 'calls') {
      kind = 'call';
      amount = money(m[3]) / bbAmt;
      streetBet.set(name, prev + amount);
    } else if (verb === 'bets') {
      kind = 'bet';
      amount = money(m[3]) / bbAmt;
      streetBet.set(name, prev + amount);
    } else {
      kind = 'raise';
      amount = money(m[4] ?? m[3]) / bbAmt;
      streetBet.set(name, amount);
    }
    actions.push({ street, pos, kind, amount: Math.round(amount * 100) / 100, allin: allin || undefined });
  }
  const stacks: Partial<Record<Position, number>> = {};
  for (const s of seats) {
    const p = posOf.get(s.name);
    if (p) stacks[p] = Math.round((s.chips / bbAmt) * 100) / 100;
  }
  const heroPos = posOf.get(hero)!;
  // 有效筹码：主角与筹码最多的对手中较小者
  const others = Object.entries(stacks).filter(([p]) => p !== heroPos).map(([, v]) => v!);
  const eff = Math.min(stacks[heroPos] ?? 100, Math.max(...others));
  if (isTourney && ante > 0) {
    const totalAnte = ante * n;
    if (Math.abs(totalAnte - 1) > 0.3) warnings.push(`这手牌的前注合计约 ${totalAnte.toFixed(2)}bb，本工具的锦标赛范围按"大盲前注 1bb"计算，会有偏差`);
  }
  const idm = /hand #\s*([\w-]+)/i.exec(head);
  return {
    game: isTourney ? 'mtt' : 'cash',
    players,
    stacks,
    stackBB: Math.round(eff * 100) / 100,
    antePerPlayer: ante,
    hero: heroPos,
    heroCards,
    board,
    actions,
    source: `${/GG|Poker Hand #(RC|HD|TM)/i.test(head) ? 'GGPoker' : /PokerStars/i.test(head) ? 'PokerStars' : '手牌历史'} #${idm?.[1] ?? ''}`,
    warnings,
  };
}

export function cardsText(cards: number[]): string {
  return cards.map(cardToString).join(' ');
}
