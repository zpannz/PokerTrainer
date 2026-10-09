import { describe, expect, it } from 'vitest';
import { calcEquity, type WeightedCombo } from '../src/lib/equity.ts';
import { parseCards } from '../src/lib/cards.ts';
import { ALL_CLASS_COMBOS, classIndex, NUM_CLASSES } from '../src/lib/hands.ts';
import { parseRange } from '../src/lib/rangeText.ts';
import { loadData, getEquityMatrix } from '../src/data/equityData.ts';
import { equityVsRange } from '../src/data/charts.ts';
import { cmpArr, naiveBest } from './naive.ts';

const hand = (s: string): WeightedCombo[] => {
  const [c1, c2] = parseCards(s);
  return [{ c1, c2, w: 1 }];
};
const range = (s: string): WeightedCombo[] => {
  const w = parseRange(s).weights;
  const out: WeightedCombo[] = [];
  for (let h = 0; h < NUM_CLASSES; h++) if (w[h] > 0) for (const [c1, c2] of ALL_CLASS_COMBOS[h]) out.push({ c1, c2, w: w[h] });
  return out;
};

describe('胜率计算', () => {
  it('翻前 AsAh vs KsKh 精确枚举：与 169 矩阵中 AA vs KK 的同花色构型一致，两者之和为 100%', async () => {
    const r = calcEquity([hand('AsAh'), hand('KsKh')], []);
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(1712304);
    expect(r.equity[0] + r.equity[1]).toBeCloseTo(1, 10);
    // 公认值：AA 对 KK 约 81~83%
    expect(r.equity[0]).toBeGreaterThan(0.81);
    expect(r.equity[0]).toBeLessThan(0.83);
  });

  it('169×169 矩阵与公认的 PokerStove 数值一致', async () => {
    await loadData();
    const eq = getEquityMatrix();
    const m = (a: string, b: string) => eq[classIndex(a) * NUM_CLASSES + classIndex(b)];
    expect(m('AA', 'KK')).toBeCloseTo(0.8195, 3);
    expect(m('AKs', 'QQ')).toBeCloseTo(0.4605, 3);
    expect(m('AKo', '22')).toBeCloseTo(0.4735, 3);
    const all = new Float64Array(NUM_CLASSES).fill(1);
    const vr = equityVsRange(all);
    // 对随机手牌：AA 85.20%、KK 82.40%、AKs 67.04%、AKo 65.32%、72o 34.58%、32o 32.30%
    expect(vr[classIndex('AA')]).toBeCloseTo(0.852, 3);
    expect(vr[classIndex('KK')]).toBeCloseTo(0.824, 3);
    expect(vr[classIndex('AKs')]).toBeCloseTo(0.6704, 3);
    expect(vr[classIndex('AKo')]).toBeCloseTo(0.6532, 3);
    expect(vr[classIndex('72o')]).toBeCloseTo(0.3458, 3);
    expect(vr[classIndex('32o')]).toBeCloseTo(0.323, 3);
  });

  it('计算器精确枚举 AKs 范围 vs QQ 范围（全部组合对），与独立预计算的矩阵值一致', async () => {
    await loadData();
    // 把 AKs 对 QQ 的所有组合对精确算一遍取平均，应等于矩阵值
    const r = calcEquity([range('AKs'), range('QQ')], [], { maxExact: 1e9 });
    expect(r.exact).toBe(true);
    expect(r.equity[0]).toBeCloseTo(getEquityMatrix()[classIndex('AKs') * NUM_CLASSES + classIndex('QQ')], 4);
  });

  it('翻牌后：精确结果与朴素评估器逐一枚举的结果完全相同', () => {
    const h1 = parseCards('8h7h');
    const h2 = parseCards('AsKd');
    const board = parseCards('Kh4h2c');
    const r = calcEquity([hand('8h7h'), hand('AsKd')], board);
    const used = new Set([...h1, ...h2, ...board]);
    let s = 0;
    let n = 0;
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++) {
        if (used.has(a) || used.has(b)) continue;
        const c = cmpArr(naiveBest([...h1, ...board, a, b]), naiveBest([...h2, ...board, a, b]));
        s += c > 0 ? 1 : c === 0 ? 0.5 : 0;
        n++;
      }
    expect(r.exact).toBe(true);
    expect(r.samples).toBe(n);
    expect(r.equity[0]).toBeCloseTo(s / n, 12);
  });

  it('三人：AA vs KK vs QQ 精确枚举，三者之和为 100%，且与蒙特卡洛结果在误差范围内一致', () => {
    const players = [hand('AsAh'), hand('KdKc'), hand('QsQh')];
    const ex = calcEquity(players, []);
    expect(ex.exact).toBe(true);
    expect(ex.equity.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const mc = calcEquity(players, [], { maxExact: 0, mcSamples: 200000, seed: 42 });
    expect(mc.exact).toBe(false);
    for (let i = 0; i < 3; i++) expect(Math.abs(mc.equity[i] - ex.equity[i])).toBeLessThan(4 * mc.stdErr + 1e-3);
  });

  it('手牌对范围：精确与蒙特卡洛一致', () => {
    const p = [hand('AhKh'), range('QQ+, AKo')];
    const board = parseCards('Qh7h2s');
    const ex = calcEquity(p, board);
    expect(ex.exact).toBe(true);
    const mc = calcEquity(p, board, { maxExact: 0, mcSamples: 200000, seed: 1 });
    expect(Math.abs(mc.equity[0] - ex.equity[0])).toBeLessThan(4 * mc.stdErr + 1e-3);
  });

  it('冲突的手牌会报错', () => {
    expect(() => calcEquity([hand('AhKh'), hand('KsKh')], [])).toThrow();
  });
});
