import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { WasmSolver } from '../src/postflop/wasmSolver.ts';
import { allCanonicalFlops, canonicalFlop, flopTexture, representativeFlops, suitMapping } from '../src/postflop/flops.ts';
import { expandCompact, mapHand, type CompactFile } from '../src/postflop/precomputed.ts';
import { aggregate, gradePostflop, overallFreq } from '../src/postflop/analysis.ts';
import { loadData } from '../src/data/equityData.ts';
import { makeScenario, scenarioList, scenarioRanges } from '../src/postflop/scenarios.ts';
import type { SolveConfig } from '../src/postflop/types.ts';

const wasm = () => WasmSolver.create(readFileSync(new URL('../src/postflop/wasm/pt_solver.wasm', import.meta.url)));

/** 河牌玩具局面：OOP = JT（坚果顺子）+ 65（空气），IP = 88（抓诈唬）；只有 OOP 能下注 */
function toy(bet: string): SolveConfig {
  const none = { bet: '', raise: '' };
  return {
    ranges: ['JT,65', '88'],
    board: 'AsKsQd7c2h',
    pot: 100,
    stack: 1000,
    sizes: [
      { flop: none, turn: none, river: { bet, raise: '' } },
      { flop: none, turn: none, river: none },
    ],
    addAllinThreshold: 0,
    forceAllinThreshold: 0,
    mergingThreshold: 0,
    raiseCap: [0, 0, 0],
  };
}

async function solveToy(bet: string) {
  const s = await wasm();
  const info = s.init(toy(bet));
  s.allocate(false);
  let expl = Infinity;
  for (let i = 0; i < 3000 && expl > 0.001; i++) {
    s.step(i);
    if (i % 10 === 9) expl = s.exploitability();
  }
  s.finalize();
  const root = s.node([]);
  const n0 = info.hands[0].length;
  let air = 0, airW = 0, nut = 0, nutW = 0;
  info.hands[0].forEach((h, i) => {
    const w = root.weights[0][i];
    const b = root.strategy[n0 + i];
    if (h[0] === 'J') { nut += w * b; nutW += w; } else { air += w * b; airW += w; }
  });
  const facing = s.node([1]);
  const n1 = info.hands[1].length;
  let call = 0, tot = 0;
  for (let i = 0; i < n1; i++) { call += facing.weights[1][i] * facing.strategy[n1 + i]; tot += facing.weights[1][i]; }
  return { air: air / airW, nut: nut / nutW, call: call / tot, expl, facing, n1, root, n0 };
}

describe('浏览器求解器（WebAssembly）与理论值核对', () => {
  it('河牌极化 vs 抓诈唬，下注 = 底池：诈唬/价值 = 1/2，跟注 50%', async () => {
    const r = await solveToy('100%');
    expect(r.expl).toBeLessThan(0.05);
    expect(r.nut).toBeCloseTo(1, 2);
    expect(r.air).toBeCloseTo(0.5, 1);
    expect(Math.abs(r.air - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(r.call - 0.5)).toBeLessThan(0.02);
    // 抓诈唬牌在均衡中跟注与弃牌无差别：跟注 EV ≈ 弃牌 EV = 0
    for (let i = 0; i < r.n1; i++) {
      expect(r.facing.actionEv[i]).toBe(0);
      expect(Math.abs(r.facing.actionEv[r.n1 + i])).toBeLessThan(1);
    }
    // 判分：这时跟注和弃牌都应该是"最佳"或"可接受"，EV 损失接近 0
    const g = gradePostflop(r.facing, r.n1, 0, 0);
    expect(g.grade).not.toBe('wrong');
    expect(g.evLoss).toBeLessThan(1);
  });

  it('河牌极化 vs 抓诈唬，下注 = 半池：诈唬/价值 = 1/3，跟注 2/3', async () => {
    const r = await solveToy('50%');
    expect(Math.abs(r.air - 1 / 3)).toBeLessThan(0.02);
    expect(Math.abs(r.call - 2 / 3)).toBeLessThan(0.02);
    // 坚果牌下注 EV 明显高于过牌：选过牌应判错误
    const s = await wasm();
    const nutIdx = s.init(toy('50%')).hands[0].findIndex((h) => h[0] === 'J');
    const g = gradePostflop(r.root, r.n0, nutIdx, 0);
    expect(g.best).toBe(1);
    expect(g.grade).toBe('wrong');
    expect(g.evLoss).toBeGreaterThan(20);
  });

  it('错误的配置返回中文错误信息而不是崩溃', async () => {
    const s = await wasm();
    expect(() => s.init({ ...toy('50%'), board: 'AsAs7c' })).toThrow(/重复/);
    expect(() => s.init({ ...toy('50%'), ranges: ['ZZ', '88'] })).toThrow(/范围/);
    const c = toy('50%');
    s.init(c);
    s.allocate(false);
    s.step(0);
    expect(() => s.node([5])).toThrow(/无效/);
  });
});

describe('翻牌分类与代表性翻牌', () => {
  it('花色同构后共 1755 种翻牌，总数 22100', () => {
    const all = allCanonicalFlops();
    expect(all.length).toBe(1755);
    expect(all.reduce((s, f) => s + f.weight, 0)).toBe(22100);
  });
  it('同构的翻牌得到相同的规范形式，花色映射可以把手牌换算过去', () => {
    expect(canonicalFlop('7d2cAh')).toBe(canonicalFlop('As7h2d'));
    expect(canonicalFlop('KhQh5h')).toBe('KsQs5s');
    const m = suitMapping('7d2cAh');
    expect(canonicalFlop('Ah7d2c')).toBe(`A${m.h}7${m.d}2${m.c}`);
    expect(mapHand('KhKd', { h: 's', d: 'h', s: 'c', c: 'd' })).toBe('KsKh');
  });
  it('选出 50 个互不同构、覆盖各种结构的翻牌', () => {
    const r = representativeFlops(50);
    expect(r.length).toBe(50);
    expect(new Set(r.map((f) => f.flop)).size).toBe(50);
    const t = r.map((f) => f.texture);
    for (const s of ['rainbow', 'twotone', 'mono']) expect(t.some((x) => x.suit === s)).toBe(true);
    expect(t.some((x) => x.pair === 'paired')).toBe(true);
    for (const h of ['A', 'K', 'Q', 'JT', 'low']) expect(t.some((x) => x.high === h)).toBe(true);
    expect(t.some((x) => x.connect === 'connected')).toBe(true);
    expect(t.some((x) => x.connect === 'dry')).toBe(true);
    expect(flopTexture('9s8s7s')).toEqual({ suit: 'mono', pair: 'unpaired', high: 'low', connect: 'connected' });
  });
});

describe('翻前范围 → 翻后局面', () => {
  beforeAll(() => loadData());
  it('BTN 开池 vs BB 跟注：底池 5.5bb，筹码 97.5bb，双方范围非空', () => {
    const s = makeScenario('cash6-100', 'srp', 'BTN', 'BB');
    expect(s.potBB).toBe(5.5);
    expect(s.stackBB).toBe(97.5);
    expect(s.oop).toBe('BB');
    const r = scenarioRanges(s);
    expect(r.ipCombos).toBeGreaterThan(400);
    expect(r.oopCombos).toBeGreaterThan(300);
  });
  it('3-bet 底池与锦标赛前注', () => {
    const s = makeScenario('cash6-100', '3bp', 'CO', 'BTN');
    expect(s.aggressor).toBe('BTN');
    expect(s.oop).toBe('CO');
    expect(s.potBB).toBeCloseTo(8 * 2 + 1.5, 5);
    const m = makeScenario('mtt6-40', 'srp', 'CO', 'BB');
    expect(m.potBB).toBeCloseTo(2.2 * 2 + 0.5 + 1, 5);
    expect(m.stackBB).toBeCloseTo(40 - 2.2 - 1, 5);
    expect(scenarioList('cash6-100').length).toBeGreaterThan(20);
  });
});

describe('预计算牌面库文件', () => {
  const dir = new URL('../public/postflop/', import.meta.url).pathname;
  const files = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => readdirSync(dir + d.name).map((f) => `${dir}${d.name}/${f}`))
    : [];
  it('至少有 2 个已计算的翻牌，格式正确、频率合计为 1', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const spot = expandCompact(JSON.parse(readFileSync(f, 'utf8')) as CompactFile);
      expect(spot.exploitability / spot.config.pot).toBeLessThan(0.01);
      const ipNode = spot.nodes['0'];
      expect(ipNode.kind).toBe('player');
      expect(ipNode.player).toBe(1);
      const n = spot.hands[1].length;
      for (let i = 0; i < n; i += 37) {
        if (ipNode.weights[1][i] <= 0) continue;
        let s = 0;
        for (let a = 0; a < ipNode.actions.length; a++) s += ipNode.strategy[a * n + i];
        expect(s).toBeGreaterThan(0.99);
        expect(s).toBeLessThan(1.01);
      }
      const freq = overallFreq(ipNode, n);
      expect(freq.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
      const agg = aggregate(ipNode, spot.hands[1], 1);
      expect(agg.freq.length).toBe(ipNode.actions.length);
    }
  });
});
