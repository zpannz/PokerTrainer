// ICM（独立筹码模型，Malmuth-Harville 算法）
// 每名玩家获得第 1 名的概率 = 其筹码占比；去掉该玩家后对剩余玩家递归。
// 用子集记忆化：复杂度 O(2^n · n)，支持最多 16 名玩家。

export function icm(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  if (n === 0) return [];
  if (n > 16) throw new Error('ICM 计算最多支持 16 名玩家');
  if (stacks.some((s) => s < 0)) throw new Error('筹码不能为负数');
  const pays = payouts.slice(0, n);
  while (pays.length < n) pays.push(0);
  const full = (1 << n) - 1;
  // prob[mask]：剩余玩家集合恰好为 mask 的概率（按名次从第 1 名开始逐个确定）
  const prob = new Float64Array(1 << n);
  prob[full] = 1;
  const sums = new Float64Array(1 << n);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    const i = 31 - Math.clz32(low);
    sums[m] = sums[m ^ low] + stacks[i];
  }
  const ev = new Array(n).fill(0);
  // 按集合大小从大到小处理
  const byPop: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let m = 1; m <= full; m++) byPop[popcount(m)].push(m);
  for (let size = n; size >= 1; size--) {
    const place = n - size; // 这一步决定第 place+1 名
    for (const m of byPop[size]) {
      const p = prob[m];
      if (p === 0) continue;
      const total = sums[m];
      for (let i = 0; i < n; i++) {
        if (!(m & (1 << i))) continue;
        // 所有人筹码为 0 时均分
        const pi = total > 0 ? stacks[i] / total : 1 / size;
        if (pi === 0) continue;
        ev[i] += p * pi * pays[place];
        prob[m ^ (1 << i)] += p * pi;
      }
    }
  }
  return ev;
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** 用全排列直接计算（仅用于测试核对，n ≤ 7） */
export function icmBruteForce(stacks: number[], payouts: number[]): number[] {
  const n = stacks.length;
  const ev = new Array(n).fill(0);
  const rec = (remaining: number[], place: number, p: number) => {
    if (remaining.length === 0) return;
    const total = remaining.reduce((a, i) => a + stacks[i], 0);
    for (const i of remaining) {
      const pi = total > 0 ? stacks[i] / total : 1 / remaining.length;
      ev[i] += p * pi * (payouts[place] ?? 0);
      rec(
        remaining.filter((x) => x !== i),
        place + 1,
        p * pi,
      );
    }
  };
  rec(
    Array.from({ length: n }, (_, i) => i),
    0,
    1,
  );
  return ev;
}
