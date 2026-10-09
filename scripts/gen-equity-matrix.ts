// 预计算 169×169 起手牌类别之间的翻前胜率矩阵（精确枚举全部 C(48,5) 公共牌，按花色同构归并）
// 输出 src/data/generated/equity169.json：eq[a*169+b] = a 对 b 的胜率 × 100000（平局计一半）
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { NUM_CLASSES } from '../src/lib/hands.ts';
import { evalMasks } from '../src/lib/evaluator.ts';
import { groupsFor } from './iso.ts';

const bit = (c: number) => 1 << (c >> 2);

function exactHU(x1: number, x2: number, y1: number, y2: number): number {
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (c !== x1 && c !== x2 && c !== y1 && c !== y2) deck.push(c);
  const hm = [0, 0, 0, 0], vm = [0, 0, 0, 0];
  hm[x1 & 3] |= bit(x1); hm[x2 & 3] |= bit(x2);
  vm[y1 & 3] |= bit(y1); vm[y2 & 3] |= bit(y2);
  let score = 0, n = 0;
  const m = [0, 0, 0, 0];
  const L = deck.length;
  for (let a = 0; a < L - 4; a++) { const ca = deck[a]; m[ca & 3] ^= bit(ca);
  for (let b = a + 1; b < L - 3; b++) { const cb = deck[b]; m[cb & 3] ^= bit(cb);
  for (let c = b + 1; c < L - 2; c++) { const cc = deck[c]; m[cc & 3] ^= bit(cc);
  for (let d = c + 1; d < L - 1; d++) { const cd = deck[d]; m[cd & 3] ^= bit(cd);
  for (let e = d + 1; e < L; e++) { const ce = deck[e]; const s = ce & 3; const bb = bit(ce);
    const b0 = m[0] | (s === 0 ? bb : 0), b1 = m[1] | (s === 1 ? bb : 0), b2 = m[2] | (s === 2 ? bb : 0), b3 = m[3] | (s === 3 ? bb : 0);
    const h = evalMasks(hm[0] | b0, hm[1] | b1, hm[2] | b2, hm[3] | b3);
    const v = evalMasks(vm[0] | b0, vm[1] | b1, vm[2] | b2, vm[3] | b3);
    score += h > v ? 2 : h === v ? 1 : 0; n++;
  }
  m[cd & 3] ^= bit(cd); }
  m[cc & 3] ^= bit(cc); }
  m[cb & 3] ^= bit(cb); }
  m[ca & 3] ^= bit(ca); }
  return score / (2 * n);
}

if (isMainThread) {
  const jobs: [number, number][] = [];
  for (let a = 0; a < NUM_CLASSES; a++) for (let b = a; b < NUM_CLASSES; b++) jobs.push([a, b]);
  const eq = new Float64Array(NUM_CLASSES * NUM_CLASSES);
  const nw = cpus().length;
  let done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: nw }, (_, w) => new Promise<void>((resolve) => {
    const mine = jobs.filter((_, i) => i % nw === w);
    const worker = new Worker(new URL(import.meta.url), { workerData: mine });
    worker.on('message', (msg: [number, number, number]) => {
      const [a, b, v] = msg;
      eq[a * NUM_CLASSES + b] = v;
      eq[b * NUM_CLASSES + a] = 1 - v;
      done++;
      if (done % 500 === 0) console.log(`${done}/${jobs.length} ${(Date.now() - t0) / 1000}s`);
    });
    worker.on('exit', () => resolve());
  })));
  const ints = Array.from(eq, (v) => Math.round(v * 100000));
  writeFileSync(new URL('../src/data/generated/equity169.json', import.meta.url), JSON.stringify({
    note: '169×169 翻前胜率矩阵：对每一对起手牌类别，枚举所有互不冲突的具体组合（按花色同构归并）和全部 C(48,5) 公共牌精确计算。值 = 胜率×100000，平局计一半。',
    scale: 100000,
    eq: ints,
  }));
  console.log('完成', (Date.now() - t0) / 1000, 's');
} else {
  for (const [a, b] of workerData as [number, number][]) {
    if (a === b) {
      // 同类别对同类别：对称，胜率恰为 0.5
      parentPort!.postMessage([a, b, 0.5]);
      continue;
    }
    const gs = groupsFor(a, b);
    let tot = 0, cnt = 0;
    for (const g of gs) { tot += exactHU(g.rep[0], g.rep[1], g.rep[2], g.rep[3]) * g.count; cnt += g.count; }
    parentPort!.postMessage([a, b, tot / cnt]);
  }
}
