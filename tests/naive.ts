// 测试用的朴素评估器：与 src/lib/evaluator.ts 完全独立的实现
export function naive5(cards: number[]): number[] {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = cards.map((c) => c & 3);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightTop = -1;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightTop = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3) straightTop = 3; // A5432
  }
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const byGroup = groups.map((g) => g[0]);
  if (flush && straightTop >= 0) return [8, straightTop];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightTop >= 0) return [4, straightTop];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...ranks];
}

export function cmpArr(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function naiveBest(cards: number[]): number[] {
  // 7 张牌中去掉 2 张，取 21 种 5 张组合中最大的
  let best: number[] | null = null;
  for (let a = 0; a < cards.length; a++)
    for (let b = a + 1; b < cards.length; b++) {
      const v = naive5(cards.filter((_, i) => i !== a && i !== b));
      if (!best || cmpArr(v, best) > 0) best = v;
    }
  return best!;
}
