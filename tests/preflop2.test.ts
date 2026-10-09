import { beforeAll, describe, expect, it } from 'vitest';
import { loadData, getEquityMatrix, getReshove } from '../src/data/equityData.ts';
import { getChart, mttOpenRange } from '../src/data/charts.ts';
import { solveReshove } from '../src/lib/reshove.ts';
import { classIndex, compatTable, HAND_CLASSES, NUM_CLASSES, rangePercent } from '../src/lib/hands.ts';
import { makeFormat, openSize, positionsOf, spotsOf, RESHOVE_DEPTHS, categoriesOf } from '../src/lib/formats.ts';
import { importRanges, fitToSpot } from '../src/lib/rangeImport.ts';
import { createScheme, effectiveChart, setActiveScheme, DEFAULT_SCHEME_ID, toOverride, resetOverrideCache, listSchemes, deleteScheme } from '../src/data/overrides.ts';

beforeAll(async () => {
  await loadData();
});

describe('开池 vs 再全下（精确计算）', () => {
  it('所有表都收敛（可被利用度 < 0.02bb）且合理：AA 总是再全下/跟注，72o 不再全下', () => {
    for (const players of [6, 9])
      for (const depth of RESHOVE_DEPTHS) {
        const n = players;
        for (let i = 0; i < n - 1; i++)
          for (let j = i + 1; j < n; j++) {
            const r = getReshove(players, depth, i, j)!;
            expect(r.exploitability).toBeLessThan(0.02);
            expect(r.shove[classIndex('AA')]).toBe(1);
            expect(r.call[classIndex('AA')]).toBe(1);
            expect(r.shove[classIndex('72o')]).toBe(0);
          }
      }
  });

  it('EV 公式与独立计算一致：BB 用 AKo 对 BTN 开池再全下（20bb，6 人）', () => {
    const f = makeFormat('mtt', 6, 20);
    const pos = positionsOf(f);
    const i = pos.indexOf('BTN');
    const j = pos.indexOf('BB');
    const r = getReshove(6, 20, i, j)!;
    const eq = getEquityMatrix();
    const compat = compatTable();
    const O = mttOpenRange(f, 'BTN');
    const h = classIndex('AKo');
    // 独立计算：BTN 手牌分布 ∝ 互不冲突组合数 × 开池频率
    let mass = 0, callMass = 0, eqCall = 0;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const w = compat[h * NUM_CLASSES + c] * O[c];
      mass += w;
      callMass += w * r.call[c];
      eqCall += w * r.call[c] * eq[h * NUM_CLASSES + c];
    }
    const pot0 = 1 + 0.5 + 1 + openSize(f, 'BTN'); // 前注 + 小盲 + 大盲 + 开池
    const stackBB = 20 - 1; // 大盲交了前注
    const potF = 1 + 0.5 + 2 * stackBB;
    const pc = callMass / mass;
    const ev = (1 - pc) * pot0 + (eqCall / mass) * potF - pc * (stackBB - 1);
    expect(r.shoveEV[h]).toBeCloseTo(ev, 1);
    expect(r.shoveEV[h]).toBeGreaterThan(0);
  });

  it('均衡条件：混合频率的手牌 EV 接近 0；纯全下的手牌 EV ≥ 0，纯弃牌的手牌 EV ≤ 0', () => {
    const r = getReshove(6, 25, positionsOf(makeFormat('mtt', 6, 25)).indexOf('CO'), 5)!;
    for (let h = 0; h < NUM_CLASSES; h++) {
      const s = r.shove[h];
      if (s > 0.05 && s < 0.95) expect(Math.abs(r.shoveEV[h])).toBeLessThan(0.3);
      if (s >= 0.999) expect(r.shoveEV[h]).toBeGreaterThan(-0.05);
      if (s <= 0.001) expect(r.shoveEV[h]).toBeLessThan(0.05);
    }
  });

  it('开池范围越宽，后位再全下越宽', () => {
    const pct = (o: string) => rangePercent(getChart(`mtt6-25/reshove/BB/${o}`).freq.allin!);
    expect(pct('UTG')).toBeLessThan(pct('CO'));
    expect(pct('CO')).toBeLessThan(pct('BTN'));
  });

  it('求解器本身：对手开池范围只有 AA 时，只有 AA 再全下有利', () => {
    const f = makeFormat('mtt', 6, 20);
    const O = new Float64Array(NUM_CLASSES);
    O[classIndex('AA')] = 1;
    const r = solveReshove({ players: 6, opener: 3, shover: 5, stack: 20, ante: 1, open: openSize(f, 'BTN'), openRange: O, eq: getEquityMatrix(), compat: compatTable(), iterations: 500 });
    expect(r.shove[classIndex('AA')]).toBeGreaterThan(0.99);
    expect(rangePercent(r.shove)).toBeLessThan(1);
  });

  it('场景列表：15~30bb 有再全下分类；25bb 的"面对 3-bet"由精确计算的"面对再全下"代替', () => {
    for (const d of [15, 20, 25, 30]) expect(categoriesOf(makeFormat('mtt', 6, d))).toContain('reshove');
    expect(categoriesOf(makeFormat('mtt', 6, 40))).not.toContain('reshove');
    expect(spotsOf(makeFormat('mtt', 6, 25)).some((s) => s.type === 'vs3bet')).toBe(false);
    expect(spotsOf(makeFormat('mtt', 6, 30)).some((s) => s.type === 'vs3bet')).toBe(true);
    expect(spotsOf(makeFormat('mtt', 6, 25)).some((s) => s.type === 'vsShove')).toBe(true);
  });

  it('跟注全下表覆盖 5~25bb', () => {
    for (const d of [5, 8, 10, 12, 15, 20, 25]) {
      const c = getChart(`mtt6-${d}/vsShove/BB/BTN`);
      expect(c.source.kind).toBe('computed');
      expect(c.freq.call![classIndex('AA')]).toBe(1);
    }
    // 筹码越浅跟注越宽
    const pct = (d: number) => rangePercent(getChart(`mtt6-${d}/vsShove/BB/BTN`).freq.call!);
    expect(pct(5)).toBeGreaterThan(pct(10));
    expect(pct(10)).toBeGreaterThan(pct(25));
  });
});

describe('范围批量导入与方案切换', () => {
  const f = makeFormat('cash', 6, 100);
  it('分节文字：按标题和 id 识别局面，支持 Pio / GTO+ 写法', () => {
    const r = importRanges(
      `# BTN 开池\nraise: 22+, A2s+, KQo, AJo:0.5\n\n[cash6-100/vsOpen/BB/BTN]\n3bet: AA-QQ, [50]A5s,A4s[/50]\ncall: JJ-22,\n  AQs-A6s\nfold: 72o`,
      f,
      null,
    );
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.spots).sort()).toEqual(['cash6-100/rfi/BTN/', 'cash6-100/vsOpen/BB/BTN']);
    expect(r.spots['cash6-100/rfi/BTN/'].raise![classIndex('AJo')]).toBe(0.5);
    expect(r.spots['cash6-100/vsOpen/BB/BTN'].raise![classIndex('A5s')]).toBe(0.5);
    expect(r.spots['cash6-100/vsOpen/BB/BTN'].call![classIndex('A6s')]).toBe(1);
  });

  it('CSV：带 spot 列的整套方案，百分比和 0~1 都可以', () => {
    const r = importRanges('spot,hand,raise,call\nBTN 开池,AKs,100%,0\nBB 面对 BTN 开池,AQo,0.25,0.75\n', f, null);
    expect(r.kind).toBe('csv');
    expect(r.errors).toEqual([]);
    expect(r.spots['cash6-100/rfi/BTN/'].raise![classIndex('AKs')]).toBe(1);
    expect(r.spots['cash6-100/vsOpen/BB/BTN'].call![classIndex('AQo')]).toBe(0.75);
  });

  it('JSON 方案与单段范围文字', () => {
    const r = importRanges(JSON.stringify({ type: 'pgto-scheme', spots: { 'cash6-100/rfi/CO/': { raise: 'AA,KK' } } }), f, null);
    expect(r.spots['cash6-100/rfi/CO/'].raise![classIndex('KK')]).toBe(1);
    const s = importRanges('AA, KK:0.5', f, 'cash6-100/rfi/UTG/');
    expect(s.kind).toBe('single');
    expect(s.spots['cash6-100/rfi/UTG/'].raise![classIndex('KK')]).toBe(0.5);
  });

  it('无法识别的局面给出错误；raise 自动对应到全下局面', () => {
    const r = importRanges('# 不存在的局面\nraise: AA', f, null);
    expect(r.errors.length).toBeGreaterThan(0);
    const g = importRanges('[mtt6-20/reshove/BB/BTN]\nraise: AA-TT', makeFormat('mtt', 6, 20), null);
    const fit = fitToSpot('mtt6-20/reshove/BB/BTN', g.spots['mtt6-20/reshove/BB/BTN']);
    expect(fit.freq.allin![classIndex('TT')]).toBe(1);
  });

  it('切换方案后范围随之改变，切回默认恢复', () => {
    resetOverrideCache();
    const id = 'cash6-100/rfi/UTG/';
    const def = effectiveChart(id).freq.raise![classIndex('72o')];
    expect(def).toBe(0);
    const w = new Float64Array(NUM_CLASSES);
    w[classIndex('72o')] = 1;
    const s = createScheme('测试方案', '单元测试', { [id]: toOverride({ raise: w }) });
    setActiveScheme(s.id);
    expect(effectiveChart(id).freq.raise![classIndex('72o')]).toBe(1);
    expect(effectiveChart(id).source.kind).toBe('custom');
    expect(effectiveChart(id).source.note).toContain('测试方案');
    // 方案没有覆盖的局面仍用默认
    expect(effectiveChart('cash6-100/rfi/BTN/').source.kind).toBe('compiled');
    setActiveScheme(DEFAULT_SCHEME_ID);
    expect(effectiveChart(id).freq.raise![classIndex('72o')]).toBe(0);
    for (const x of listSchemes()) deleteScheme(x.id);
    void HAND_CLASSES;
  });
});
