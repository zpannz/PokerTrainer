import { beforeAll, describe, expect, it } from 'vitest';
import { loadData, getEquityMatrix, getPushFold } from '../src/data/equityData.ts';
import { solvePushFold } from '../src/lib/nash.ts';
import { classIndex, compatTable, HAND_CLASSES, NUM_CLASSES, rangePercent } from '../src/lib/hands.ts';

beforeAll(async () => {
  await loadData();
});

describe('全下/弃牌纳什均衡', () => {
  it('预计算结果收敛（可被利用度 < 0.01bb）', () => {
    for (const p of [6, 9]) for (const s of [5, 8, 10, 12, 15, 20]) expect(getPushFold(p, s)!.exploitability).toBeLessThan(0.01);
    for (const p of [6, 9]) expect(getPushFold(p, 25)!.exploitability).toBeLessThan(0.02);
  });

  it('越靠后的位置全下越宽；筹码越深全下越紧', () => {
    for (const p of [6, 9]) {
      const bySize = [10, 15, 20].map((s) => getPushFold(p, s)!.push.map((r) => rangePercent(r)));
      for (const row of bySize) for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1] - 0.6);
      for (let pos = 0; pos < p - 1; pos++) {
        expect(bySize[0][pos]).toBeGreaterThan(bySize[1][pos]);
        expect(bySize[1][pos]).toBeGreaterThan(bySize[2][pos]);
      }
    }
  });

  it('合理性：AA/KK 永远全下和跟注；72o 前位不全下；跟注范围比全下范围紧', () => {
    for (const p of [6, 9])
      for (const s of [10, 15, 20]) {
        const r = getPushFold(p, s)!;
        for (const row of r.push) {
          expect(row[classIndex('AA')]).toBe(1);
          expect(row[classIndex('KK')]).toBe(1);
        }
        expect(r.push[0][classIndex('72o')]).toBe(0);
        for (let i = 0; i < p - 1; i++)
          for (let j = i + 1; j < p; j++) {
            expect(r.call[i][j][classIndex('AA')]).toBe(1);
            expect(rangePercent(r.call[i][j])).toBeLessThan(rangePercent(r.push[i]) + 1);
          }
      }
  });

  it('6 人 10bb：小盲全下范围在 55%~75% 之间，按钮在 35%~50% 之间', () => {
    const r = getPushFold(6, 10)!;
    const sb = rangePercent(r.push[4]);
    const btn = rangePercent(r.push[3]);
    expect(sb).toBeGreaterThan(55);
    expect(sb).toBeLessThan(75);
    expect(btn).toBeGreaterThan(35);
    expect(btn).toBeLessThan(50);
  });

  it('单挑 10bb 无前注：收敛，范围结构与常见 HU 纳什图表一致', () => {
    const r = solvePushFold({ players: 2, stack: 10, ante: 0, eq: getEquityMatrix(), compat: compatTable(), iterations: 2000 });
    expect(r.exploitability).toBeLessThan(0.002);
    const push = r.push[0];
    const call = r.call[0][1];
    for (const h of ['22', 'A2o', 'K2s', 'Q9o', 'T9s', '54s']) expect(push[classIndex(h)]).toBeGreaterThan(0.9);
    for (const h of ['72o', '32o', '82o', 'J2o']) expect(push[classIndex(h)]).toBeLessThan(0.1);
    for (const h of ['22', 'A2o', 'KTo', 'QJs']) expect(call[classIndex(h)]).toBeGreaterThan(0.9);
    for (const h of ['T9s', '76s', 'J8o']) expect(call[classIndex(h)]).toBeLessThan(0.1);
    expect(rangePercent(push)).toBeGreaterThan(40);
    expect(rangePercent(push)).toBeLessThan(60);
  });

  it('最优反应检验：给定对手策略，表中全下的手牌 EV ≥ 0，弃牌的手牌 EV ≤ 0（允许混合边界）', () => {
    const r = getPushFold(9, 15)!;
    for (let p = 0; p < 8; p++)
      for (let h = 0; h < NUM_CLASSES; h++) {
        const f = r.push[p][h];
        const ev = r.pushEV[p][h];
        if (f > 0.95) expect(ev).toBeGreaterThan(-0.05);
        if (f < 0.05) expect(ev).toBeLessThan(0.05);
      }
    void HAND_CLASSES;
  });
});
