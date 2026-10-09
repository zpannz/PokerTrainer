// 预计算锦标赛"开池 vs 再全下"均衡（6/9 人桌，15/20/25/30bb，大盲前注 1bb）
// 用法：npx vite-node scripts/gen-reshove.ts
import { writeFileSync } from 'node:fs';
import { loadData, getEquityMatrix } from '../src/data/equityData.ts';
import { mttOpenRange } from '../src/data/charts.ts';
import { makeFormat, openSize, positionsOf, RESHOVE_DEPTHS } from '../src/lib/formats.ts';
import { compatTable, rangePercent } from '../src/lib/hands.ts';
import { solveReshove, type ReshoveResult } from '../src/lib/reshove.ts';

await loadData();
const eq = getEquityMatrix();
const compat = compatTable();
const iterations = Number(process.env.ITER ?? 3000);
const results: Record<string, ReshoveResult> = {};
let worst = 0;
for (const players of [6, 9] as const) {
  for (const depth of RESHOVE_DEPTHS) {
    const f = makeFormat('mtt', players, depth);
    const pos = positionsOf(f);
    const t0 = Date.now();
    for (let i = 0; i < pos.length - 1; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const r = solveReshove({ players, opener: i, shover: j, stack: depth, ante: f.ante, open: openSize(f, pos[i]), openRange: mttOpenRange(f, pos[i]), eq, compat, iterations });
        results[`${players}-${depth}-${i}-${j}`] = r;
        worst = Math.max(worst, r.exploitability);
        if (pos[j] === 'BB') console.log(`  ${players} 人 ${depth}bb ${pos[i]} 开池 vs BB：BB 再全下 ${rangePercent(r.shove).toFixed(1)}%，可被利用度 ${r.exploitability.toFixed(4)}bb`);
      }
    console.log(`${players} 人 ${depth}bb：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
writeFileSync(new URL('../src/data/generated/reshove.json', import.meta.url), JSON.stringify({
  note: '开池 vs 再全下均衡（筹码 EV），由 scripts/gen-reshove.ts 计算。key = 人数-筹码-开池者座位-全下者座位；shove/call 为 169 类别频率。',
  results,
}));
console.log(`完成，最大可被利用度 ${worst.toFixed(4)}bb`);
