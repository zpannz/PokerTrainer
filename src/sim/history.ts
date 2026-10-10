// 导出手牌历史：按 PokerStars 手牌历史的文本结构输出（站点名写作 PokerTrainer，虚拟筹码），
// 可以直接粘贴到本工具的手牌复盘，也便于用其他复盘软件查看
import { cardToString } from '../lib/cards.ts';
import { HAND_CATEGORY_NAMES, handCategory } from '../lib/evaluator.ts';
import { evaluate } from '../lib/evaluator.ts';
import { type CompactHand, LOG_KINDS, type Session } from './session.ts';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI'];

const pad = (n: number) => String(n).padStart(2, '0');

function dateText(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function moneyFn(s: Session): (x: number) => string {
  // 现金桌筹码以"分"为单位（1 个大盲 = 100），显示两位小数；锦标赛显示整数
  return s.config.kind === 'cash' ? (x: number) => (x / 100).toFixed(2) : (x: number) => String(Math.round(x));
}

const cards = (cs: number[]) => cs.map(cardToString).join(' ');

/** 一手牌的文本历史 */
export function exportHand(s: Session, h: CompactHand): string {
  const m = moneyFn(s);
  const name = (seat: number) => s.seats[seat].name;
  const lines: string[] = [];
  const id = `${s.id.slice(1, 9).toUpperCase()}${String(h.no).padStart(4, '0')}`;
  const when = dateText(s.created + h.no * 60_000);
  const c = s.config;
  const max = c.kind === 'ft' ? 6 : c.tableSize;
  if (c.kind === 'cash') lines.push(`PokerTrainer Hand #${id}:  Hold'em No Limit (${m(h.sb)}/${m(h.bb)}) - ${when}`);
  else lines.push(`PokerTrainer Hand #${id}: Tournament #${s.id.slice(1, 9).toUpperCase()}, Hold'em No Limit - Level ${ROMAN[h.level ?? 0] ?? h.level} (${m(h.sb)}/${m(h.bb)}) - ${when}`);
  lines.push(`Table 'Practice ${max}-max' ${max}-max Seat #${h.button + 1} is the button`);
  for (const [seat, stack] of h.p) lines.push(`Seat ${seat + 1}: ${name(seat)} (${m(stack)} in chips)`);
  const log = h.l.map(([street, seat, k, amount, to, allin]) => ({ street, seat, kind: LOG_KINDS[k], amount, to, allin: allin === 1 }));
  for (const e of log) {
    if (e.street !== 0) break;
    if (e.kind === 'ante') lines.push(`${name(e.seat)}: posts the ante ${m(e.amount)}${e.allin ? ' and is all-in' : ''}`);
  }
  for (const e of log) {
    if (e.street !== 0) break;
    if (e.kind === 'sb') lines.push(`${name(e.seat)}: posts small blind ${m(e.amount)}${e.allin ? ' and is all-in' : ''}`);
    if (e.kind === 'bb') lines.push(`${name(e.seat)}: posts big blind ${m(e.amount)}${e.allin ? ' and is all-in' : ''}`);
  }
  lines.push('*** HOLE CARDS ***');
  const hero = h.p.find((p) => p[0] === s.heroSeat);
  if (hero) lines.push(`Dealt to ${name(hero[0])} [${cards([hero[2], hero[3]])}]`);
  let street = 0;
  let currentBet = Math.max(h.bb, ...log.filter((e) => e.street === 0 && (e.kind === 'sb' || e.kind === 'bb')).map((e) => e.to));
  const board = h.b;
  const returned = (st: number) => {
    for (const [seat, amt, rs] of h.r) if (rs === st) lines.push(`Uncalled bet (${m(amt)}) returned to ${name(seat)}`);
  };
  const header = (st: number) => {
    if (st === 1) lines.push(`*** FLOP *** [${cards(board.slice(0, 3))}]`);
    if (st === 2) lines.push(`*** TURN *** [${cards(board.slice(0, 3))}] [${cards(board.slice(3, 4))}]`);
    if (st === 3) lines.push(`*** RIVER *** [${cards(board.slice(0, 4))}] [${cards(board.slice(4, 5))}]`);
  };
  for (const e of log) {
    if (e.kind === 'sb' || e.kind === 'bb' || e.kind === 'ante') continue;
    while (e.street > street) {
      returned(street);
      street++;
      currentBet = 0;
      header(street);
    }
    const ai = e.allin ? ' and is all-in' : '';
    switch (e.kind) {
      case 'fold':
        lines.push(`${name(e.seat)}: folds`);
        break;
      case 'check':
        lines.push(`${name(e.seat)}: checks`);
        break;
      case 'call':
        lines.push(`${name(e.seat)}: calls ${m(e.amount)}${ai}`);
        break;
      case 'bet':
        lines.push(`${name(e.seat)}: bets ${m(e.to)}${ai}`);
        currentBet = e.to;
        break;
      case 'raise':
        lines.push(`${name(e.seat)}: raises ${m(e.to - currentBet)} to ${m(e.to)}${ai}`);
        currentBet = e.to;
        break;
    }
  }
  returned(street);
  // 全下后直接发完的公共牌
  while (street < 3 && board.length > (street === 0 ? 0 : street + 2)) {
    street++;
    header(street);
    returned(street);
  }
  const live = h.p.filter((p) => !log.some((e) => e.seat === p[0] && e.kind === 'fold'));
  if (h.sd) {
    lines.push('*** SHOW DOWN ***');
    for (const p of live) {
      const v = evaluate([p[2], p[3], ...board]);
      const cat = HAND_CATEGORY_NAMES[handCategory(v)].replace(/^.*\((.*)\)$/, '$1');
      lines.push(`${name(p[0])}: shows [${cards([p[2], p[3]])}] (${cat})`);
    }
  }
  const multi = h.pots.length > 1;
  h.pots.forEach(([amount, winners], k) => {
    const share = Math.floor(amount / winners.length);
    let rem = amount - share * winners.length;
    const potName = !multi ? 'pot' : k === 0 ? 'main pot' : `side pot-${k}`;
    for (const w of winners) {
      const x = share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      lines.push(`${name(w)} collected ${m(x)} from ${potName}`);
    }
  });
  lines.push('*** SUMMARY ***');
  const total = h.pots.reduce((a, [x]) => a + x, 0);
  lines.push(`Total pot ${m(total)} | Rake 0`);
  if (board.length) lines.push(`Board [${cards(board)}]`);
  for (const [seat] of h.p) {
    const won = h.w.find(([s2]) => s2 === seat)?.[1] ?? 0;
    const p = h.p.find((x) => x[0] === seat)!;
    const folded = log.find((e) => e.seat === seat && e.kind === 'fold');
    const pos = seat === h.button ? ' (button)' : '';
    if (folded) lines.push(`Seat ${seat + 1}: ${name(seat)}${pos} folded ${['before Flop', 'on the Flop', 'on the Turn', 'on the River'][folded.street]}`);
    else if (h.sd) lines.push(`Seat ${seat + 1}: ${name(seat)}${pos} showed [${cards([p[2], p[3]])}] and ${won > 0 ? `won (${m(won)})` : 'lost'}`);
    else lines.push(`Seat ${seat + 1}: ${name(seat)}${pos} collected (${m(won)})`);
  }
  return lines.join('\n');
}

export function exportSession(s: Session): string {
  return s.history.map((h) => exportHand(s, h)).join('\n\n\n') + '\n';
}

/** 你在这手牌中是否有过主动决策（不只是交盲注） */
export function heroDecided(s: Session, h: CompactHand): boolean {
  return h.l.some(([, seat, k]) => seat === s.heroSeat && k >= 3);
}
