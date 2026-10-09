import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data/equityData.ts';
import { parseHandHistory, type HandRecord } from '../src/lib/handHistory.ts';
import { postflopSetup, reviewPostflop, reviewPreflop, solverHand, matchAction, type WalkSource } from '../src/lib/handReview.ts';
import { parseCards } from '../src/lib/cards.ts';
import { expandCompact, mapHand, type CompactFile } from '../src/postflop/precomputed.ts';
import { suitMapping } from '../src/postflop/flops.ts';
import { historyKey } from '../src/postflop/types.ts';
import { SAMPLE_HH } from '../src/pages/ReviewPage.tsx';

beforeAll(() => loadData());

const GG = `Poker Hand #RC1234567890: Hold'em No Limit ($0.1/$0.2) - 2026/03/01 12:00:00
Table 'RushAndCash123' 6-max Seat #1 is the button
Seat 1: aaa ($20.00 in chips)
Seat 2: bbb ($25.40 in chips)
Seat 3: Hero ($20.00 in chips)
Seat 4: ddd ($18.00 in chips)
Seat 5: eee ($20.00 in chips)
Seat 6: fff ($40.00 in chips)
bbb: posts small blind $0.1
Hero: posts big blind $0.2
*** HOLE CARDS ***
Dealt to Hero [Kd Ks]
ddd: raises $0.3 to $0.5
eee: folds
fff: folds
aaa: folds
bbb: folds
Hero: raises $1.5 to $2
ddd: calls $1.5
*** FLOP *** [7c 4d 2s]
Hero: bets $1.5
ddd: raises $3 to $4.5
Hero: raises $13.5 to $18 and is all-in
ddd: calls $11.5 and is all-in
*** TURN *** [7c 4d 2s] [9h]
*** RIVER *** [7c 4d 2s 9h] [Ac]
*** SHOWDOWN ***`;

const MTT = `PokerStars Hand #250001: Tournament #3000, $10+$1 USD Hold'em No Limit - Level V (100/200) - 2026/02/01
Table '3000 1' 9-max Seat #5 is the button
Seat 1: p1 (4000 in chips)
Seat 2: p2 (4000 in chips)
Seat 3: p3 (4000 in chips)
Seat 4: p4 (4000 in chips)
Seat 5: p5 (4000 in chips)
Seat 6: p6 (4000 in chips)
Seat 7: Hero (4000 in chips)
Seat 8: p8 (4000 in chips)
Seat 9: p9 (4000 in chips)
p1: posts the ante 25
p2: posts the ante 25
p6: posts small blind 100
Hero: posts big blind 200
*** HOLE CARDS ***
Dealt to Hero [Ah 9h]
p8: folds
p9: folds
p1: folds
p2: folds
p3: folds
p4: folds
p5: raises 200 to 400
p6: folds
Hero: raises 3550 to 3950 and is all-in
p5: folds`;

describe('手牌历史解析', () => {
  it('PokerStars 现金局：位置、手牌、行动、金额（bb）', () => {
    const r = parseHandHistory(SAMPLE_HH);
    expect(r.game).toBe('cash');
    expect(r.players).toBe(6);
    expect(r.hero).toBe('BTN');
    expect(r.heroCards).toEqual(parseCards('AhJd'));
    expect(r.board).toEqual(parseCards('Qs8h3d2c7s'));
    expect(r.stackBB).toBe(100);
    const pre = r.actions.filter((a) => a.street === 0);
    expect(pre.map((a) => `${a.pos}:${a.kind}:${a.amount}`)).toEqual(['UTG:fold:0', 'HJ:fold:0', 'CO:fold:0', 'BTN:raise:2.5', 'SB:fold:0', 'BB:call:1.5']);
    expect(r.actions.find((a) => a.street === 1 && a.kind === 'bet')!.amount).toBe(1.82);
    expect(r.actions.at(-1)).toMatchObject({ street: 3, pos: 'BTN', kind: 'fold' });
  });

  it('GGPoker 格式与全下标记', () => {
    const r = parseHandHistory(GG);
    expect(r.source).toContain('GGPoker');
    expect(r.hero).toBe('BB');
    expect(r.stacks.UTG).toBe(90); // $18 / $0.2
    expect(r.stacks.CO).toBe(200);
    const flop = r.actions.filter((a) => a.street === 1);
    expect(flop.map((a) => `${a.pos}:${a.kind}:${a.amount}${a.allin ? '!' : ''}`)).toEqual(['BB:bet:7.5', 'UTG:raise:22.5', 'BB:raise:90!', 'UTG:call:57.5!']);
  });

  it('锦标赛：识别前注，9 人桌位置', () => {
    const r = parseHandHistory(MTT);
    expect(r.game).toBe('mtt');
    expect(r.players).toBe(9);
    expect(r.hero).toBe('BB');
    expect(r.stackBB).toBe(20);
    expect(r.antePerPlayer).toBeCloseTo(0.125, 5);
    expect(r.actions.find((a) => a.pos === 'BTN')!.kind).toBe('raise');
  });

  it('无法识别的文本给出中文错误', () => {
    expect(() => parseHandHistory('hello')).toThrow(/Hand #/);
  });
});

describe('复盘：翻前对照范围库', () => {
  it('BTN 用 AJo 开池：最佳；BB 用 KK 对 UTG 开池 3-bet：最佳', () => {
    const a = reviewPreflop(parseHandHistory(SAMPLE_HH));
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0].title).toContain('BTN 开池');
    expect(a.steps[0].grade).toBe('best');
    const b = reviewPreflop(parseHandHistory(GG));
    expect(b.steps[0].title).toContain('BB 面对 UTG 开池');
    expect(b.steps[0].grade).toBe('best');
  });

  it('锦标赛 20bb：BB 用 A9s 对 BTN 开池再全下 → 对照精确计算的再全下表', () => {
    const r = reviewPreflop(parseHandHistory(MTT));
    expect(r.format.id).toBe('mtt9-20');
    expect(r.steps[0].title).toContain('再全下');
    expect(r.steps[0].grade).toBe('best');
    expect(r.steps[0].source).toContain('计算得出');
  });

  it('明显的错误：UTG 用 72o 开池判为错误', () => {
    const rec: HandRecord = { game: 'cash', players: 6, stacks: {}, stackBB: 100, antePerPlayer: 0, hero: 'UTG', heroCards: [parseCards('7h2c')[0], parseCards('7h2c')[1]], board: [], actions: [{ street: 0, pos: 'UTG', kind: 'raise', amount: 2.5 }], warnings: [] };
    expect(reviewPreflop(rec).steps[0].grade).toBe('wrong');
  });
});

describe('复盘：翻后对照预计算结果', () => {
  it('BTN vs BB 单挑底池，Qs8h3d：翻牌 33% 持续下注被正确映射并给出点评，转牌提示需要浏览器求解', async () => {
    const rec = parseHandHistory(SAMPLE_HH);
    const { format } = reviewPreflop(rec);
    const { setup, reason } = postflopSetup(rec, format);
    expect(reason).toBeUndefined();
    expect(setup!.scenario.id).toBe('cash6-100/srp/BTN/BB');
    expect(setup!.potBB).toBe(5.5);
    expect(setup!.stackBB).toBe(97.5);
    expect(setup!.heroSeat).toBe(1);
    const spot = expandCompact(JSON.parse(readFileSync(new URL('../public/postflop/cash6-100_srp_BTN_BB/Qs8h3d.json', import.meta.url), 'utf8')) as CompactFile);
    const src: WalkSource = { hands: spot.hands, getNode: async (h) => spot.nodes[historyKey(h)] ?? null, label: '预计算牌面库' };
    const steps = await reviewPostflop(rec, setup!, src, { suitMap: suitMapping('Qs8h3d'), potScale: 1 });
    expect(steps[0].title).toContain('翻牌');
    expect(steps[0].heroAction).toContain('下注 1.82bb');
    expect(steps[0].grade).toBeDefined();
    const chosen = steps[0].freqs.find((f) => f.chosen)!;
    expect(chosen.label).toContain('33%');
    expect(steps.at(-1)!.note).toMatch(/预计算只包含翻牌圈/);
  });

  it('花色同构映射与求解器手牌写法', () => {
    const m = suitMapping('Qh8s3c');
    expect(solverHand([parseCards('Ah')[0], parseCards('Jd')[0]])).toBe('AhJd');
    expect(solverHand([parseCards('Jd')[0], parseCards('Ah')[0]])).toBe('AhJd');
    expect(solverHand(parseCards('AhJd') as [number, number], m)).toBe(mapHand('AhJd', m));
  });

  it('下注额映射到最接近的尺寸', () => {
    const node = { actions: ['X', 'B182', 'B413'], pot: 550, bets: [0, 0] } as never;
    expect(matchAction(node, { street: 1, pos: 'BTN', kind: 'bet', amount: 2 }, 1)).toEqual({ index: 1, approx: true });
    expect(matchAction(node, { street: 1, pos: 'BTN', kind: 'bet', amount: 4 }, 1).index).toBe(2);
    expect(matchAction(node, { street: 1, pos: 'BTN', kind: 'check', amount: 0 }, 1).index).toBe(0);
  });
});
