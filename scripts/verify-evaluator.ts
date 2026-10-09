// 用全部 C(52,7) = 133,784,560 种 7 张牌组合核对牌型分布（与公认数值比较）
import { evalMasks } from '../src/lib/evaluator.ts';

const EXPECTED7 = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];
const counts = new Array(9).fill(0);
const t0 = Date.now();
const bit = (c: number) => 1 << (c >> 2);
function rec(start: number, left: number, m0: number, m1: number, m2: number, m3: number) {
  if (left === 0) {
    counts[evalMasks(m0, m1, m2, m3) >> 20]++;
    return;
  }
  for (let c = start; c <= 52 - left; c++) {
    const b = bit(c);
    switch (c & 3) {
      case 0: rec(c + 1, left - 1, m0 | b, m1, m2, m3); break;
      case 1: rec(c + 1, left - 1, m0, m1 | b, m2, m3); break;
      case 2: rec(c + 1, left - 1, m0, m1, m2 | b, m3); break;
      default: rec(c + 1, left - 1, m0, m1, m2, m3 | b);
    }
  }
}
rec(0, 7, 0, 0, 0, 0);
const ms = Date.now() - t0;
let ok = true;
counts.forEach((c, i) => {
  const good = c === EXPECTED7[i];
  ok &&= good;
  console.log(`牌型 ${i}: ${c} ${good ? '✓' : '✗ 期望 ' + EXPECTED7[i]}`);
});
console.log(`耗时 ${ms} ms，约 ${(133784560 / ms / 1000).toFixed(1)} M 次/秒`);
if (!ok) process.exit(1);
