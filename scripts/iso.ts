import { ALL_CLASS_COMBOS, NUM_CLASSES } from '../src/lib/hands.ts';
const PERMS: number[][] = [];
const perm = (a: number[], k: number) => { if (k === a.length) { PERMS.push([...a]); return; } for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; perm(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
perm([0, 1, 2, 3], 0);
export function canonKey(x1: number, x2: number, y1: number, y2: number): string {
  let best = '';
  for (const p of PERMS) {
    const m = (c: number) => (c & ~3) | p[c & 3];
    let a = m(x1), b = m(x2), c = m(y1), d = m(y2);
    if (a < b) [a, b] = [b, a];
    if (c < d) [c, d] = [d, c];
    const k = a + ',' + b + ',' + c + ',' + d;
    if (best === '' || k < best) best = k;
  }
  return best;
}
export function groupsFor(a: number, b: number) {
  const g = new Map<string, { rep: number[]; count: number }>();
  for (const [x1, x2] of ALL_CLASS_COMBOS[a]) for (const [y1, y2] of ALL_CLASS_COMBOS[b]) {
    if (x1 === y1 || x1 === y2 || x2 === y1 || x2 === y2) continue;
    const k = canonKey(x1, x2, y1, y2);
    const e = g.get(k);
    if (e) e.count++; else g.set(k, { rep: [x1, x2, y1, y2], count: 1 });
  }
  return [...g.values()];
}
if (process.argv[1]?.endsWith('iso.ts') && process.argv[2] === 'count') {
  let total = 0, pairs = 0;
  for (let a = 0; a < NUM_CLASSES; a++) for (let b = a; b < NUM_CLASSES; b++) { total += groupsFor(a, b).length; pairs++; }
  console.log(pairs, total);
}
