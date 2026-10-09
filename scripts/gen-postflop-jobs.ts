// 生成预计算任务（jobs.json）：局面的双方范围取自翻前范围库的默认数据，翻牌按牌面结构分层选取
// 用法：npx vite-node scripts/gen-postflop-jobs.ts -- [--scenarios id1,id2] [--flops 50] [--flop-list AsJhTd,...] [--limit 3] [--target 0.3] [--out jobs.json]
import { writeFileSync } from 'node:fs';
import { loadData } from '../src/data/equityData.ts';
import { parseScenarioId, scenarioRanges, toChips } from '../src/postflop/scenarios.ts';
import { representativeFlops, canonicalFlop } from '../src/postflop/flops.ts';
import { precomputePreset } from '../src/postflop/presets.ts';
import { scenarioDir } from '../src/postflop/precomputed.ts';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};

await loadData();
const scenarioIds = arg('scenarios', 'cash6-100/srp/BTN/BB,cash6-100/srp/CO/BB').split(',').filter(Boolean);
const flopList = arg('flop-list', '');
let flops = flopList ? flopList.split(',').map((f) => canonicalFlop(f.trim())) : representativeFlops(Number(arg('flops', '50'))).map((f) => f.flop);
const limit = Number(arg('limit', '0'));
if (limit > 0) flops = flops.slice(0, limit);
const preset = precomputePreset();
const scenarios = scenarioIds.map((id) => {
  const s = parseScenarioId(id);
  const r = scenarioRanges(s);
  return { id: s.id, dir: scenarioDir(s.id), title: s.title, players: [s.oop, s.ip], ranges: [r.oop, r.ip], pot: toChips(s.potBB), stack: toChips(s.stackBB) };
});
const jobs = {
  scenarios,
  flops,
  sizes: [preset.oop, preset.ip],
  raiseCap: preset.raiseCap,
  targetPct: Number(arg('target', '0.3')),
  maxIter: Number(arg('max-iter', '1000')),
  depth: 4,
};
writeFileSync(arg('out', 'jobs.json'), JSON.stringify(jobs, null, 1));
console.log(`${scenarios.length} 个局面 × ${flops.length} 个翻牌 = ${scenarios.length * flops.length} 个任务`);
for (const s of scenarios) console.log(`  ${s.id}：底池 ${s.pot / 100}bb，筹码 ${s.stack / 100}bb`);
console.log(`  翻牌：${flops.join(' ')}`);
