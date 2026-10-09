import { describe, expect, it } from 'vitest';
import { icm, icmBruteForce } from '../src/lib/icm.ts';
import { mulberry32 } from '../src/lib/cards.ts';

describe('ICM', () => {
  it('经典例子：5000/3000/2000，奖金 50/30/20', () => {
    const r = icm([5000, 3000, 2000], [50, 30, 20]);
    expect(r[0]).toBeCloseTo(38.39, 2);
    expect(r[1]).toBeCloseTo(32.75, 2);
    expect(r[2]).toBeCloseTo(28.86, 2);
  });

  it('与全排列暴力计算一致（随机 200 组）', () => {
    const rand = mulberry32(3);
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(rand() * 6);
      const stacks = Array.from({ length: n }, () => Math.floor(rand() * 10000) + 1);
      const k = 1 + Math.floor(rand() * n);
      const pays = Array.from({ length: k }, () => Math.floor(rand() * 100)).sort((a, b) => b - a);
      const a = icm(stacks, pays);
      const b = icmBruteForce(stacks, pays);
      for (let i = 0; i < n; i++) expect(a[i]).toBeCloseTo(b[i], 8);
    }
  });

  it('筹码相同则价值相同；总价值等于奖池；赢家通吃时等于筹码占比', () => {
    const eq = icm([1000, 1000, 1000, 1000], [50, 30, 20]);
    for (const v of eq) expect(v).toBeCloseTo(25, 10);
    const r = icm([7000, 2000, 1000, 500], [40, 25, 15, 10]);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(90, 8);
    const wta = icm([6000, 3000, 1000], [100]);
    expect(wta[0]).toBeCloseTo(60, 10);
  });

  it('支持 12 人', () => {
    const r = icm(Array.from({ length: 12 }, (_, i) => 1000 + i * 100), [30, 20, 15, 10, 8, 7, 5, 5]);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
});
