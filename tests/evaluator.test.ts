import { describe, expect, it } from 'vitest';
import { evaluate, evalMasks } from '../src/lib/evaluator.ts';
import { mulberry32 } from '../src/lib/cards.ts';
import { cmpArr, naive5, naiveBest } from './naive.ts';

describe('牌力评估器', () => {
  it('全部 C(52,5) = 2,598,960 种 5 张牌的牌型分布与公认数值一致', () => {
    const expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
    const counts = new Array(9).fill(0);
    const bit = (c: number) => 1 << (c >> 2);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              const m = [0, 0, 0, 0];
              for (const x of [a, b, c, d, e]) m[x & 3] |= bit(x);
              counts[evalMasks(m[0], m[1], m[2], m[3]) >> 20]++;
            }
    expect(counts).toEqual(expected);
  });

  it('5 张牌：与独立的朴素实现比较大小关系（2 万对随机牌）', () => {
    const rand = mulberry32(7);
    const deal = (n: number) => {
      const s = new Set<number>();
      while (s.size < n) s.add(Math.floor(rand() * 52));
      return [...s];
    };
    for (let i = 0; i < 20000; i++) {
      const x = deal(10);
      const a = x.slice(0, 5);
      const b = x.slice(5);
      expect(Math.sign(evaluate(a) - evaluate(b))).toBe(cmpArr(naive5(a), naive5(b)));
    }
  });

  it('7 张牌：同一公共牌下两手牌的比较结果与朴素实现一致（1 万次）', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 10000; i++) {
      const s = new Set<number>();
      while (s.size < 9) s.add(Math.floor(rand() * 52));
      const x = [...s];
      const board = x.slice(0, 5);
      const h1 = [...board, x[5], x[6]];
      const h2 = [...board, x[7], x[8]];
      expect(Math.sign(evaluate(h1) - evaluate(h2))).toBe(cmpArr(naiveBest(h1), naiveBest(h2)));
    }
  });

  it('边界情况：A2345 顺子小于 23456，同花顺最大', () => {
    const p = (s: string) => s.match(/../g)!.map((t) => '23456789TJQKA'.indexOf(t[0]) * 4 + 'shdc'.indexOf(t[1]));
    expect(evaluate(p('As2d3h4c5s'))).toBeLessThan(evaluate(p('2d3h4c5s6s')));
    expect(evaluate(p('AsKsQsJsTs'))).toBeGreaterThan(evaluate(p('AhAdAcAsKs')));
    // 7 张牌中三条 + 三条 = 葫芦
    expect(evaluate(p('AsAdAhKsKdKh2c')) >> 20).toBe(6);
    // 三对：取最大两对 + 最大踢脚
    expect(evaluate(p('AsAdKsKdQsQd2c'))).toBeGreaterThan(evaluate(p('AsAdKsKdJsJdTc')));
  });
});
