import { beforeAll, describe, expect, it } from 'vitest';
import { loadData } from '../src/data/equityData.ts';
import { getChart } from '../src/data/charts.ts';
import { allFormats, isPushFold, positionsOf, spotId, spotsOf } from '../src/lib/formats.ts';
import { classIndex, NUM_CLASSES, rangePercent } from '../src/lib/hands.ts';

beforeAll(async () => {
  await loadData();
});

describe('翻前范围数据', () => {
  it('所有格式的所有场景都能加载，频率合法且每手牌合计为 100%', () => {
    let count = 0;
    for (const f of allFormats()) {
      for (const s of spotsOf(f)) {
        const c = getChart(s.id);
        count++;
        expect(c.source.note.length).toBeGreaterThan(10);
        expect(['computed', 'compiled', 'approx']).toContain(c.source.kind);
        let priorMass = 0;
        for (let h = 0; h < NUM_CLASSES; h++) {
          let sum = 0;
          for (const a of c.actions) {
            const v = c.freq[a]![h];
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            sum += v;
          }
          expect(sum).toBeCloseTo(1, 6);
          priorMass += c.prior[h];
        }
        expect(priorMass).toBeGreaterThan(0);
      }
    }
    // 2 个现金格式 × (5+15+15 / 8+36+36) + 锦标赛
    expect(count).toBeGreaterThan(500);
  });

  it('来源标注：10~20bb 为计算得出，6 人桌现金局开池为公开资料整理，其余为近似', () => {
    expect(getChart('mtt9-15/push/UTG/').source.kind).toBe('computed');
    expect(getChart('mtt6-10/vsShove/BB/BTN').source.kind).toBe('computed');
    expect(getChart('cash6-100/rfi/CO/').source.kind).toBe('compiled');
    expect(getChart('cash6-100/vsOpen/BB/BTN').source.kind).toBe('approx');
    expect(getChart('mtt9-40/rfi/UTG/').source.kind).toBe('approx');
  });

  it('开池范围随位置变宽（每种非全下格式）', () => {
    for (const f of allFormats().filter((x) => !isPushFold(x))) {
      const pos = positionsOf(f).slice(0, -2); // 不含盲注
      const pcts = pos.map((p) => rangePercent(getChart(spotId(f.id, 'rfi', p)).freq.raise!));
      for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    }
  });

  it('6 人桌现金局开池比例在常见范围内', () => {
    const pct = (p: string) => rangePercent(getChart(`cash6-100/rfi/${p}/`).freq.raise!);
    expect(pct('UTG')).toBeGreaterThan(14);
    expect(pct('UTG')).toBeLessThan(20);
    expect(pct('BTN')).toBeGreaterThan(40);
    expect(pct('BTN')).toBeLessThan(52);
  });

  it('AA 永远不弃牌，72o 在前位开池时弃牌', () => {
    const AA = classIndex('AA');
    for (const f of allFormats())
      for (const s of spotsOf(f)) {
        const c = getChart(s.id);
        if (c.prior[AA] > 0) expect(c.freq.fold![AA]).toBe(0);
      }
    expect(getChart('cash6-100/rfi/UTG/').freq.fold![classIndex('72o')]).toBe(1);
    expect(getChart('mtt9-20/push/UTG/').freq.fold![classIndex('72o')]).toBe(1);
  });

  it('面对 3-bet 只包含开池时会玩的手牌', () => {
    const c = getChart('cash6-100/vs3bet/UTG/BTN');
    const open = getChart('cash6-100/rfi/UTG/');
    for (let h = 0; h < NUM_CLASSES; h++) expect(c.prior[h]).toBeCloseTo(open.freq.raise![h], 6);
    expect(c.prior[classIndex('72o')]).toBe(0);
  });

  it('大盲防守比其他位置面对开池更宽，面对按钮比面对枪口更宽', () => {
    const cont = (id: string) => {
      const c = getChart(id);
      return 100 - rangePercent(c.freq.fold!);
    };
    expect(cont('cash6-100/vsOpen/BB/BTN')).toBeGreaterThan(cont('cash6-100/vsOpen/BB/UTG'));
    expect(cont('cash6-100/vsOpen/BB/BTN')).toBeGreaterThan(cont('cash6-100/vsOpen/CO/HJ'));
    expect(cont('mtt9-40/vsOpen/BB/BTN')).toBeGreaterThan(cont('cash9-100/vsOpen/BB/BTN'));
  });
});
