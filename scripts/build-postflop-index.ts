// 扫描 public/postflop/ 下的预计算结果，生成 index.json（网站据此列出可用的局面和翻牌）
// 用法：npx vite-node scripts/build-postflop-index.ts
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flopTexture, representativeFlops } from '../src/postflop/flops.ts';

const root = new URL('../public/postflop/', import.meta.url).pathname;
const weights = new Map(representativeFlops(50).map((f) => [f.flop, f.weight]));
const scenarios: unknown[] = [];
let count = 0;
for (const dir of readdirSync(root).sort()) {
  const p = join(root, dir);
  if (!statSync(p).isDirectory()) continue;
  const flops: { flop: string; texture: ReturnType<typeof flopTexture>; weight: number; expl: number; iter: number; size: number }[] = [];
  let head: { scenario: string; title: string; players: string[]; meta: { pot: number; stack: number; sizes: unknown; raiseCap: unknown } } | null = null;
  for (const f of readdirSync(p).filter((x) => x.endsWith('.json')).sort()) {
    const text = readFileSync(join(p, f), 'utf8');
    const j = JSON.parse(text);
    head ??= j;
    flops.push({ flop: j.flop, texture: flopTexture(j.flop), weight: weights.get(j.flop) ?? 1, expl: Math.round((j.expl / j.meta.pot) * 10000) / 100, iter: j.iter, size: text.length });
    count++;
  }
  if (!head) continue;
  scenarios.push({ id: head.scenario, dir, title: head.title, players: head.players, pot: head.meta.pot, stack: head.meta.stack, sizes: head.meta.sizes, raiseCap: head.meta.raiseCap, flops });
}
writeFileSync(join(root, 'index.json'), JSON.stringify({ generated: new Date().toISOString(), scenarios }, null, 1));
console.log(`index.json：${scenarios.length} 个局面，${count} 个翻牌`);
