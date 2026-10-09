// 预计算锦标赛全下/弃牌纳什均衡（6/9 人桌，10/15/20bb，大盲前注 1bb）
import { readFileSync, writeFileSync } from 'node:fs';
import { solvePushFold, type PushFoldResult } from '../src/lib/nash.ts';
import { compatTable, rangePercent } from '../src/lib/hands.ts';

const eqFile = JSON.parse(readFileSync(new URL('../src/data/generated/equity169.json', import.meta.url), 'utf8'));
const eq = Float64Array.from(eqFile.eq as number[], (v) => v / eqFile.scale);
const compat = compatTable();
const iterations = Number(process.env.ITER ?? 3000);
const results: Record<string, PushFoldResult> = {};
for (const players of [6, 9]) {
  for (const stack of [10, 15, 20]) {
    const t0 = Date.now();
    const r = solvePushFold({ players, stack, ante: 1, eq, compat, iterations });
    // EV 只保留到 0.01bb，减小文件体积
    r.pushEV = r.pushEV.map((a) => a.map((v) => Math.round(v * 100) / 100));
    r.callEV = r.callEV.map((row) => row.map((a) => a.map((v) => Math.round(v * 100) / 100)));
    results[`${players}-${stack}`] = r;
    console.log(`${players} 人 ${stack}bb: ${(Date.now() - t0) / 1000}s，可被利用度 ${r.exploitability.toFixed(4)}bb，全下比例`,
      r.push.map((p) => rangePercent(p).toFixed(1) + '%').join(' '));
  }
}
writeFileSync(new URL('../src/data/generated/pushfold.json', import.meta.url), JSON.stringify({
  note: '全下/弃牌纳什均衡（筹码 EV），由 scripts/gen-pushfold.ts 计算。push[p][h]、call[p][j][h] 为频率，h 为 169 类别序号（13×13 格子行优先）。',
  results,
}));
