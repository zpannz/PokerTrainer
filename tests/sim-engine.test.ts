import { describe, expect, it } from 'vitest';
import { parseCard, parseCards } from '../src/lib/cards.ts';
import { evaluate, handCategory } from '../src/lib/evaluator.ts';
import { applyAction, buildPots, legalActions, startHand, currentPlayer, type HandSetup, type HandState } from '../src/sim/engine.ts';
import { randInt, seededU32, shuffledDeck, cryptoU32 } from '../src/sim/rng.ts';
import { naiveBest, cmpArr } from './naive.ts';

/** 按发牌顺序（从小盲开始，每人一张发两轮）构造牌序；holes 按小盲开始的顺序 */
function deckFor(holes: string[], board: string): number[] {
  const hs = holes.map((h) => parseCards(h));
  const n = hs.length;
  const out: number[] = [];
  for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) out.push(hs[k][r]);
  out.push(...parseCards(board));
  for (let c = 0; c < 52; c++) if (!out.includes(c)) out.push(c);
  return out;
}

const setup = (stacks: number[], holes: string[], board: string, extra: Partial<HandSetup> = {}): HandState => {
  // 座位 0..n-1，按钮在最后一个座位 → 小盲为座位 0（单挑时按钮 = 小盲）
  const n = stacks.length;
  const button = n === 2 ? 0 : n - 1;
  return startHand({ seats: stacks.map((s, i) => ({ seat: i, stack: s })), button, sb: 5, bb: 10, ante: 0, anteMode: 'none', deck: deckFor(holes, board), ...extra });
};

const totalChips = (st: HandState) => st.players.reduce((s, p) => s + p.stack, 0);

describe('发牌随机性', () => {
  it('洗牌是 52 张不重复的牌', () => {
    const u = cryptoU32();
    for (let i = 0; i < 50; i++) {
      const d = shuffledDeck(u);
      expect(new Set(d).size).toBe(52);
    }
  });
  it('每张牌出现在每个位置的频率均匀（卡方检验）', () => {
    const u = cryptoU32();
    const N = 20000;
    // 统计第 0 个位置（第一张手牌）和第 10 个位置的牌
    for (const pos of [0, 10, 51]) {
      const cnt = new Array(52).fill(0);
      for (let i = 0; i < N; i++) cnt[shuffledDeck(u)[pos]]++;
      const exp = N / 52;
      const chi = cnt.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
      // 自由度 51，p=0.0005 临界值约 92
      expect(chi).toBeLessThan(92);
    }
  });
  it('起手牌类型的频率符合理论值（对子 5.88%，同花 23.5%）', () => {
    const u = seededU32(7);
    const N = 60000;
    let pair = 0;
    let suited = 0;
    for (let i = 0; i < N; i++) {
      const d = shuffledDeck(u);
      if (d[0] >> 2 === d[1] >> 2) pair++;
      else if ((d[0] & 3) === (d[1] & 3)) suited++;
    }
    expect(Math.abs(pair / N - 78 / 1326)).toBeLessThan(0.006);
    expect(Math.abs(suited / N - 312 / 1326)).toBeLessThan(0.01);
  });
  it('拒绝采样的随机整数无偏', () => {
    const u = seededU32(3);
    const cnt = new Array(7).fill(0);
    for (let i = 0; i < 70000; i++) cnt[randInt(u, 7)]++;
    for (const c of cnt) expect(Math.abs(c - 10000)).toBeLessThan(450);
  });
  it('相邻两张牌之间没有相关性（连续两张同花的概率 12/51）', () => {
    const u = cryptoU32();
    let same = 0;
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const d = shuffledDeck(u);
      if ((d[20] & 3) === (d[21] & 3)) same++;
    }
    expect(Math.abs(same / N - 12 / 51)).toBeLessThan(0.012);
  });
});

describe('牌型判定', () => {
  it('评估器与朴素实现在 2 万手随机 7 张牌上完全一致', () => {
    const u = seededU32(11);
    const hands: { v: number; n: number[] }[] = [];
    for (let i = 0; i < 20000; i++) {
      const cards = shuffledDeck(u).slice(0, 7);
      hands.push({ v: evaluate(cards), n: naiveBest(cards) });
    }
    for (let i = 1; i < hands.length; i++) {
      const a = hands[i - 1];
      const b = hands[i];
      expect(Math.sign(a.v - b.v)).toBe(cmpArr(a.n, b.n));
    }
  });
  it('各牌型的识别', () => {
    const cat = (s: string) => handCategory(evaluate(parseCards(s)));
    expect(cat('AsKsQsJsTs2d3c')).toBe(8);
    expect(cat('As2s3s4s5s9d9c')).toBe(8); // 最小同花顺
    expect(cat('9s9h9d9cKs2d3c')).toBe(7);
    expect(cat('9s9h9dKcKs2d3c')).toBe(6);
    expect(cat('9s9h9dKcKsKd3c')).toBe(6); // 两个三条 = 葫芦
    expect(cat('As9s7s4s2sKdKc')).toBe(5);
    expect(cat('Ad2s3c4h5s9d9c')).toBe(4); // A2345
    expect(cat('9s9h9d2c5s7dKc')).toBe(3);
    expect(cat('9s9h2d2c5s5dKc')).toBe(2); // 三个对子取最大两对
    expect(cat('9s9h2d4c5s7dKc')).toBe(1);
    expect(cat('As9h2d4c5s7dKc')).toBe(0);
  });
});

describe('下注流程', () => {
  it('翻前行动顺序：枪口位先行动，大盲最后，有过牌权', () => {
    const st = setup([1000, 1000, 1000, 1000], ['AsAh', 'KsKh', 'QsQh', 'JsJh'], ' 2c3d4h5s7c');
    // 座位 3 为按钮，0 小盲，1 大盲，2 枪口
    expect(st.sbSeat).toBe(0);
    expect(st.bbSeat).toBe(1);
    expect(currentPlayer(st)!.seat).toBe(2);
    applyAction(st, { type: 'call' });
    applyAction(st, { type: 'call' }); // 按钮
    applyAction(st, { type: 'call' }); // 小盲补齐
    expect(currentPlayer(st)!.seat).toBe(1);
    expect(legalActions(st).canCheck).toBe(true);
    applyAction(st, { type: 'check' });
    expect(st.street).toBe(1);
    expect(st.board.length).toBe(3);
    // 翻后小盲先行动
    expect(currentPlayer(st)!.seat).toBe(0);
  });
  it('单挑：按钮是小盲，翻前先行动、翻后后行动', () => {
    const st = setup([1000, 1000], ['AsAh', 'KsKh'], '2c3d4h5s7c');
    expect(st.sbSeat).toBe(0);
    expect(currentPlayer(st)!.seat).toBe(0);
    applyAction(st, { type: 'call' });
    applyAction(st, { type: 'check' });
    expect(currentPlayer(st)!.seat).toBe(1);
  });
  it('最小加注：加注额至少等于上一次加注的增量', () => {
    const st = setup([1000, 1000, 1000], ['AsAh', 'KsKh', 'QsQh'], '2c3d4h5s7c');
    // 按钮（座位 2）先行动
    let L = legalActions(st);
    expect(L.minTo).toBe(20);
    applyAction(st, { type: 'raise', to: 35 }); // 增量 25
    L = legalActions(st);
    expect(L.minTo).toBe(60);
    applyAction(st, { type: 'raise', to: 40 }); // 不足最小加注 → 修正为 60
    expect(st.currentBet).toBe(60);
  });
  it('不足额的全下加注不重新开放加注权', () => {
    // 座位 0 小盲 只有 130；按钮（座位 2）开池 100，小盲全下 130（增量 30 < 90），大盲跟注，按钮只能跟注或弃牌
    const st = setup([130, 1000, 1000], ['AsAh', 'KsKh', 'QsQh'], '2c3d4h5s7c');
    applyAction(st, { type: 'raise', to: 100 });
    applyAction(st, { type: 'raise', to: 1000 }); // 小盲全下（只有 130）
    expect(st.players[0].allin).toBe(true);
    expect(st.currentBet).toBe(130);
    const L1 = legalActions(st); // 大盲没行动过，可以加注
    expect(L1.canRaise).toBe(true);
    applyAction(st, { type: 'call' });
    const L2 = legalActions(st); // 按钮
    expect(currentPlayer(st)!.seat).toBe(2);
    expect(L2.canRaise).toBe(false);
    expect(L2.call).toBe(30);
  });
  it('多次不足额全下累计达到完整加注时重新开放', () => {
    // 4 人：按钮 3，小盲 0，大盲 1，枪口 2。枪口开池 100，按钮全下 150，小盲全下 210，大盲弃牌 → 枪口面对 210（增量 110 ≥ 90）可以再加注
    const st = setup([210, 1000, 1000, 150], ['AsAh', 'KsKh', 'QsQh', 'JsJh'], '2c3d4h5s7c');
    applyAction(st, { type: 'raise', to: 100 });
    applyAction(st, { type: 'raise', to: 150 });
    applyAction(st, { type: 'raise', to: 210 });
    applyAction(st, { type: 'fold' });
    expect(currentPlayer(st)!.seat).toBe(2);
    expect(legalActions(st).canRaise).toBe(false); // 其余玩家都已全下，加注没有意义
    expect(legalActions(st).call).toBe(110);
  });
  it('无人跟注的下注退回', () => {
    const st = setup([1000, 1000, 1000], ['AsAh', 'KsKh', 'QsQh'], '2c3d4h5s7c');
    applyAction(st, { type: 'raise', to: 300 });
    applyAction(st, { type: 'fold' });
    applyAction(st, { type: 'fold' });
    expect(st.done).toBe(true);
    expect(st.result!.returned[0]).toEqual({ seat: 2, amount: 290, street: 0 });
    expect(st.result!.net[2]).toBe(15);
    expect(st.result!.net[0]).toBe(-5);
    expect(st.result!.net[1]).toBe(-10);
    expect(totalChips(st)).toBe(3000);
  });
  it('大盲前注与每人前注', () => {
    const st = startHand({ seats: [0, 1, 2].map((i) => ({ seat: i, stack: 1000 })), button: 2, sb: 50, bb: 100, ante: 100, anteMode: 'bb' });
    expect(st.players[1].total).toBe(200);
    expect(st.players[1].street).toBe(100);
    const st2 = startHand({ seats: [0, 1, 2].map((i) => ({ seat: i, stack: 1000 })), button: 2, sb: 50, bb: 100, ante: 10, anteMode: 'each' });
    expect(st2.players.map((p) => p.total)).toEqual([60, 110, 10]);
  });
  it('大盲筹码不足一个大盲时全下，其他人仍需跟注完整大盲', () => {
    const st = startHand({ seats: [0, 1, 2].map((i) => ({ seat: i, stack: i === 1 ? 40 : 1000 })), button: 2, sb: 50, bb: 100, ante: 0, anteMode: 'none', deck: deckFor(['AsAh', 'KsKh', 'QsQh'], '2c3d4h5s7c') });
    expect(st.players[1].allin).toBe(true);
    expect(legalActions(st).call).toBe(100);
  });
});

describe('边池与多人全下', () => {
  it('三人不同筹码全下：主池与两个边池分别比牌', () => {
    // 小盲 座位 0：100 筹码 AA；大盲 座位 1：300 筹码 KK；按钮 座位 2：1000 筹码 QQ
    const st = setup([100, 300, 1000], ['AsAh', 'KsKh', 'QsQh'], '2c3d8h9sJc');
    applyAction(st, { type: 'raise', to: 1000 }); // 按钮全下
    applyAction(st, { type: 'call' }); // 小盲跟注全下 100
    applyAction(st, { type: 'call' }); // 大盲跟注全下 300
    expect(st.done).toBe(true);
    const r = st.result!;
    expect(r.returned).toEqual([{ seat: 2, amount: 700, street: 0 }]);
    expect(r.pots.map((p) => p.amount)).toEqual([300, 400]);
    expect(r.pots[0].winners).toEqual([0]);
    expect(r.pots[1].winners).toEqual([1]);
    expect(r.won).toEqual({ 0: 300, 1: 400, 2: 0 });
    expect(st.players.map((p) => p.stack)).toEqual([300, 400, 700]);
    expect(r.allinBoard).toBe(0);
  });
  it('短筹码赢主池，大筹码之间比边池', () => {
    const st = setup([100, 300, 1000], ['AsAh', 'QsQh', 'KsKh'], '2c3d8h9sJc');
    applyAction(st, { type: 'raise', to: 1000 });
    applyAction(st, { type: 'call' });
    applyAction(st, { type: 'call' });
    expect(st.result!.won).toEqual({ 0: 300, 1: 0, 2: 400 });
    expect(st.players.map((p) => p.stack)).toEqual([300, 0, 1100]);
  });
  it('已弃牌玩家的筹码留在池中，平分时零头给按钮左侧第一位', () => {
    // 4 人：按钮 3，小盲 0，大盲 1，枪口 2。公共牌是同花顺 → 所有人平分
    const st = setup([1000, 1000, 1000, 1000], ['2h3h', '4d4c', '5d6c', '7d8c'], 'AsKsQsJsTs');
    applyAction(st, { type: 'raise', to: 25 }); // 枪口
    applyAction(st, { type: 'fold' }); // 按钮
    applyAction(st, { type: 'call' }); // 小盲
    applyAction(st, { type: 'fold' }); // 大盲（投入 10）
    // 底池 = 25 + 25 + 10 = 60，小盲和枪口平分 → 各 30
    while (!st.done) applyAction(st, { type: 'check' });
    expect(st.result!.pots.length).toBe(1);
    expect(st.result!.won[0]).toBe(30);
    expect(st.result!.won[2]).toBe(30);
    // 奇数底池
    const st2 = setup([1000, 1000, 1000], ['2h3h', '4d4c', '5d6c'], 'AsKsQsJsTs');
    applyAction(st2, { type: 'call' }); // 按钮 10
    applyAction(st2, { type: 'raise', to: 21 }); // 小盲
    applyAction(st2, { type: 'fold' }); // 大盲 10 留在池中
    applyAction(st2, { type: 'call' }); // 按钮
    while (!st2.done) applyAction(st2, { type: 'check' });
    // 底池 21 + 21 + 10 = 52 → 平分 26/26
    expect(st2.result!.won[0]).toBe(26);
    expect(st2.result!.won[0] + st2.result!.won[2]).toBe(52);
  });
  it('奇数筹码的零头给按钮左侧第一位赢家', () => {
    const st = startHand({ seats: [0, 1, 2].map((i) => ({ seat: i, stack: 1000 })), button: 2, sb: 5, bb: 10, ante: 1, anteMode: 'each', deck: deckFor(['2h3h', '4d4c', '5d6c'], 'AsKsQsJsTs') });
    applyAction(st, { type: 'call' }); // 按钮
    applyAction(st, { type: 'raise', to: 20 }); // 小盲
    applyAction(st, { type: 'fold' }); // 大盲（10 留在池中）
    applyAction(st, { type: 'call' }); // 按钮
    while (!st.done) applyAction(st, { type: 'check' });
    // 底池 = 3 前注 + 20 + 20 + 10 = 53 → 小盲（按钮左侧第一位）27，按钮 26
    expect(st.result!.won[0]).toBe(27);
    expect(st.result!.won[2]).toBe(26);
  });
  it('四人多层全下，筹码守恒且每个池由有资格的最强牌赢得', () => {
    const u = seededU32(99);
    for (let t = 0; t < 3000; t++) {
      const n = 2 + randInt(u, 8);
      const stacks = Array.from({ length: n }, () => 20 + randInt(u, 980));
      const st = startHand({ seats: stacks.map((s, i) => ({ seat: i, stack: s })), button: randInt(u, n), sb: 5, bb: 10, ante: randInt(u, 3), anteMode: (['none', 'each', 'bb'] as const)[randInt(u, 3)], rng: u });
      const before = stacks.reduce((a, b) => a + b, 0);
      let guard = 0;
      while (!st.done) {
        const L = legalActions(st);
        const r = randInt(u, 10);
        if (r < 2 && L.canFold) applyAction(st, { type: 'fold' });
        else if (r < 5 && L.canRaise) applyAction(st, { type: 'raise', to: L.minTo + randInt(u, Math.max(1, L.maxTo - L.minTo + 1)) });
        else if (r < 6 && L.canRaise) applyAction(st, { type: 'raise', to: L.maxTo });
        else applyAction(st, { type: L.call > 0 ? 'call' : 'check' });
        if (++guard > 500) throw new Error('死循环');
      }
      const r = st.result!;
      expect(totalChips(st)).toBe(before);
      expect(st.players.every((p) => p.stack >= 0)).toBe(true);
      const potSum = r.pots.reduce((s, p) => s + p.amount, 0);
      expect(potSum).toBe(st.players.reduce((s, p) => s + p.total, 0));
      if (r.showdown) {
        expect(st.board.length).toBe(5);
        for (const pot of r.pots) {
          const best = Math.max(...pot.eligible.map((s) => r.values[s]));
          for (const w of pot.winners) expect(r.values[w]).toBe(best);
          for (const s of pot.eligible) if (!pot.winners.includes(s)) expect(r.values[s]).toBeLessThan(best);
          // 与独立的朴素实现核对赢家
          const naive = pot.eligible.map((s) => naiveBest([...st.players.find((p) => p.seat === s)!.hole, ...st.board]));
          const top = naive.reduce((a, b) => (cmpArr(a, b) >= 0 ? a : b));
          pot.eligible.forEach((s, k) => expect(pot.winners.includes(s)).toBe(cmpArr(naive[k], top) === 0));
        }
      }
      // 每名玩家拿回的筹码不超过他有资格的池
      for (const p of st.players) {
        const cap = r.pots.filter((x) => x.eligible.includes(p.seat)).reduce((s, x) => s + x.amount, 0);
        expect(r.won[p.seat]).toBeLessThanOrEqual(cap);
        if (p.folded) expect(r.won[p.seat]).toBe(0);
      }
    }
  });
  it('边池分层（直接计算）', () => {
    const pots = buildPots([
      { seat: 0, total: 50, folded: false },
      { seat: 1, total: 200, folded: false },
      { seat: 2, total: 200, folded: true },
      { seat: 3, total: 500, folded: false },
      { seat: 4, total: 500, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 250, eligible: [0, 1, 3, 4], winners: [] },
      { amount: 600, eligible: [1, 3, 4], winners: [] },
      { amount: 600, eligible: [3, 4], winners: [] },
    ]);
  });
  it('牌的分配：手牌按小盲开始依次发出', () => {
    const st = setup([1000, 1000, 1000], ['AsAh', 'KsKh', 'QsQh'], '2c3d4h5s7c');
    expect(st.players[0].hole).toEqual([parseCard('As'), parseCard('Ah')]);
    expect(st.players[2].hole).toEqual([parseCard('Qs'), parseCard('Qh')]);
  });
});
