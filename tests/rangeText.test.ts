import { describe, expect, it } from 'vitest';
import { formatRange, parseRange } from '../src/lib/rangeText.ts';
import { classIndex, rangeCombos, NUM_CLASSES } from '../src/lib/hands.ts';

const combos = (s: string) => rangeCombos(parseRange(s).weights);

describe('范围文字解析', () => {
  it('常见写法的组合数', () => {
    expect(combos('AA-22')).toBe(78);
    expect(combos('22+')).toBe(78);
    expect(combos('TT+')).toBe(30);
    expect(combos('A2s+')).toBe(48);
    expect(combos('KTo+')).toBe(36);
    expect(combos('AK')).toBe(16);
    expect(combos('QJs-Q9s')).toBe(12);
    expect(combos('Q9s-QJs')).toBe(12);
    expect(combos('88-55')).toBe(24);
    expect(combos('AA-22, A2s+, KTo+')).toBe(78 + 48 + 36);
  });

  it('权重：AKs:0.5、AKs:50%、[50]...[/50]', () => {
    const a = parseRange('AKs:0.5, QQ:75%, [25]JJ,TT[/25], 99');
    expect(a.errors).toEqual([]);
    expect(a.weights[classIndex('AKs')]).toBe(0.5);
    expect(a.weights[classIndex('QQ')]).toBe(0.75);
    expect(a.weights[classIndex('JJ')]).toBe(0.25);
    expect(a.weights[classIndex('TT')]).toBe(0.25);
    expect(a.weights[classIndex('99')]).toBe(1);
  });

  it('具体组合按比例计入类别', () => {
    const r = parseRange('AhKh, AsKs');
    expect(r.weights[classIndex('AKs')]).toBeCloseTo(0.5);
  });

  it('错误输入给出提示而不崩溃', () => {
    const r = parseRange('AA, XYZ, KQs');
    expect(r.errors.length).toBe(1);
    expect(r.weights[classIndex('AA')]).toBe(1);
    expect(r.weights[classIndex('KQs')]).toBe(1);
  });

  it('导出后再导入结果不变（两种格式）', () => {
    const src = parseRange('55+, 44:0.75, A2s+, A5o:0.4, KTs+, K9s:0.6, QJo, T9s:0.85, 76s:0.3').weights;
    for (const style of ['pio', 'bracket'] as const) {
      const text = formatRange(src, style);
      const back = parseRange(text);
      expect(back.errors).toEqual([]);
      for (let h = 0; h < NUM_CLASSES; h++) expect(back.weights[h]).toBeCloseTo(src[h], 6);
    }
    expect(formatRange(parseRange('AA-22, A2s+, KTo+').weights)).toBe('22+,A2s+,KTo+');
  });
});
