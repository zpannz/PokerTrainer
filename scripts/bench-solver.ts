// 测量浏览器求解器（wasm，单线程）求解一个典型翻牌局面的耗时与内存
// 用法：npx vite-node scripts/bench-solver.ts [翻牌] [预设 id] [目标可被利用度 % 底池]
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data/equityData.ts';
import { WasmSolver } from '../src/postflop/wasmSolver.ts';
import { makeScenario, scenarioRanges, toChips } from '../src/postflop/scenarios.ts';
import { SIZE_PRESETS } from '../src/postflop/presets.ts';

await loadData();
const flop = process.argv[2] ?? 'Qs8h3d';
const preset = SIZE_PRESETS.find((p) => p.id === (process.argv[3] ?? 'standard'))!;
const target = Number(process.argv[4] ?? 0.5);
const compress = process.env.COMPRESS === '1';
const sc = makeScenario('cash6-100', 'srp', 'BTN', 'BB');
const r = scenarioRanges(sc);
const s = await WasmSolver.create(readFileSync(new URL('../src/postflop/wasm/pt_solver.wasm', import.meta.url)));
const pot = toChips(sc.potBB);
const sizes = structuredClone([preset.oop, preset.ip]);
if (process.env.NODONK) sizes[0].flop.bet = '';
for (const [k, st] of [['FLOP', 'flop'], ['TURN', 'turn'], ['RIVER', 'river']] as const)
  if (process.env[k]) for (const p of sizes) p[st].bet = process.env[k]!;
if (process.env.IPFLOP) sizes[1].flop.bet = process.env.IPFLOP;
const raiseCap = (process.env.CAPS ?? '2,1,1').split(',').map(Number) as [number, number, number];
const info = s.init({ ranges: [r.oop, r.ip], board: flop, pot, stack: toChips(sc.stackBB), sizes, raiseCap } as never);
console.log(`${sc.title} ${flop} 预设 ${preset.name}：OOP ${info.hands[0].length} 组合，IP ${info.hands[1].length} 组合；预计内存 ${(info.memory[0] / 2 ** 20).toFixed(0)}MB（压缩 ${(info.memory[1] / 2 ** 20).toFixed(0)}MB）`);
if (process.env.INFO_ONLY) process.exit(0);
const t0 = Date.now();
s.allocate(compress);
let it = 0;
let expl = Infinity;
while (it < 1000) {
  s.step(it++);
  if (it % 10 === 0) {
    expl = s.exploitability();
    console.log(`  ${it} 轮 ${((Date.now() - t0) / 1000).toFixed(1)}s 可被利用度 ${((expl / pot) * 100).toFixed(2)}% 底池`);
    if ((expl / pot) * 100 <= target) break;
  }
}
s.finalize();
console.log(`完成：${it} 轮，${((Date.now() - t0) / 1000).toFixed(1)} 秒，wasm 内存 ${(s.memoryBytes() / 2 ** 20).toFixed(0)}MB`);
