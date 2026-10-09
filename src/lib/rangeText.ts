// 范围文字的解析与导出
// 支持："AA-22, A2s+, KTo+, AK, QJs-Q9s"、带权重 "AKs:0.5" / "AKs:50%"、
// 括号写法 "[50]AQs, AJs[/50]"（GTO+ / Flopzilla 风格）以及具体组合 "AhKh"
import { RANK_CHARS } from './cards.ts';
import { GRID_RANKS, HAND_CLASSES, NUM_CLASSES, classCombos, comboToClass } from './hands.ts';
import { parseCard } from './cards.ts';

const gi = (ch: string): number => {
  const i = GRID_RANKS.indexOf(ch.toUpperCase());
  if (i < 0) throw new Error(`无效的点数: ${ch}`);
  return i;
};

const cell = (row: number, col: number) => row * 13 + col;
/** 高牌 hi、低牌 lo（格子序号，hi < lo），同花/不同花 */
const nonPairCell = (hi: number, lo: number, suited: boolean) => (suited ? cell(hi, lo) : cell(lo, hi));

function expandToken(tok: string): { classes: number[]; comboWeight?: number } {
  const t = tok.trim();
  if (!t) return { classes: [] };
  // 具体组合，例如 AhKh
  if (/^[2-9TJQKA][shdc][2-9TJQKA][shdc]$/i.test(t)) {
    const c1 = parseCard(t.slice(0, 2));
    const c2 = parseCard(t.slice(2, 4));
    if (c1 === c2) throw new Error(`无效的组合: ${t}`);
    const idx = comboToClass(c1, c2);
    return { classes: [idx], comboWeight: 1 / classCombos(idx).length };
  }
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)(\+?)(?:-([2-9TJQKA])([2-9TJQKA])([so]?))?$/i.exec(t);
  if (!m) throw new Error(`无法识别: "${t}"`);
  const [, a1, b1, s1raw, plus, a2, b2, s2raw] = m;
  const s1 = s1raw.toLowerCase();
  const s2 = (s2raw || '').toLowerCase();
  let h1 = gi(a1);
  let l1 = gi(b1);
  if (h1 > l1) [h1, l1] = [l1, h1];
  const suitedOpts = (s: string) => (s === 's' ? [true] : s === 'o' ? [false] : [true, false]);
  const out: number[] = [];
  if (h1 === l1) {
    if (s1) throw new Error(`对子不能带 s/o: ${t}`);
    // 对子
    if (a2) {
      const h2 = gi(a2);
      if (gi(b2) !== h2) throw new Error(`对子区间写法错误: ${t}`);
      const [from, to] = h1 < h2 ? [h1, h2] : [h2, h1];
      for (let r = from; r <= to; r++) out.push(cell(r, r));
    } else if (plus) {
      for (let r = 0; r <= h1; r++) out.push(cell(r, r));
    } else out.push(cell(h1, h1));
    return { classes: out };
  }
  if (a2) {
    let h2 = gi(a2);
    let l2 = gi(b2);
    if (h2 > l2) [h2, l2] = [l2, h2];
    if (h2 !== h1) throw new Error(`区间两端的高牌必须相同: ${t}`);
    if (s2 && s2 !== s1) throw new Error(`区间两端的 s/o 必须一致: ${t}`);
    const [from, to] = l1 < l2 ? [l1, l2] : [l2, l1];
    for (const su of suitedOpts(s1)) for (let l = from; l <= to; l++) out.push(nonPairCell(h1, l, su));
    return { classes: out };
  }
  if (plus) {
    for (const su of suitedOpts(s1)) for (let l = h1 + 1; l <= l1; l++) out.push(nonPairCell(h1, l, su));
    return { classes: out };
  }
  for (const su of suitedOpts(s1)) out.push(nonPairCell(h1, l1, su));
  return { classes: out };
}

function parseWeight(w: string): number {
  const s = w.trim();
  const pct = s.endsWith('%');
  const v = parseFloat(pct ? s.slice(0, -1) : s);
  if (!Number.isFinite(v) || v < 0) throw new Error(`无效的权重: ${w}`);
  if (pct || v > 1) return Math.min(1, v / 100);
  return v;
}

export interface ParseResult {
  weights: Float64Array;
  errors: string[];
}

export function parseRange(text: string): ParseResult {
  const weights = new Float64Array(NUM_CLASSES);
  const errors: string[] = [];
  // 先把 [50]...[/50] 展开成带权重的 token
  const tokens: { tok: string; w: number }[] = [];
  const re = /\[(\d+(?:\.\d+)?)\]([\s\S]*?)\[\/\d+(?:\.\d+)?\]/g;
  let last = 0;
  let mm: RegExpExecArray | null;
  const pushPlain = (s: string, w: number | null) => {
    for (const raw of s.split(/[,\s;]+/)) {
      const t = raw.trim();
      if (!t) continue;
      const colon = t.indexOf(':');
      if (colon >= 0) {
        try {
          tokens.push({ tok: t.slice(0, colon), w: parseWeight(t.slice(colon + 1)) });
        } catch (e) {
          errors.push((e as Error).message);
        }
      } else tokens.push({ tok: t, w: w ?? 1 });
    }
  };
  while ((mm = re.exec(text))) {
    pushPlain(text.slice(last, mm.index), null);
    pushPlain(mm[2], Math.min(1, parseFloat(mm[1]) / 100));
    last = re.lastIndex;
  }
  pushPlain(text.slice(last), null);

  for (const { tok, w } of tokens) {
    try {
      const { classes, comboWeight } = expandToken(tok);
      for (const c of classes) {
        if (comboWeight !== undefined) weights[c] = Math.min(1, weights[c] + comboWeight * w);
        else weights[c] = w;
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { weights, errors };
}

/** 把一组同权重的类别压缩成标准写法 */
function compress(set: Set<number>): string[] {
  const parts: string[] = [];
  // 对子
  const pairs: number[] = [];
  for (let r = 0; r < 13; r++) if (set.has(cell(r, r))) pairs.push(r);
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1] === pairs[j] + 1) j++;
    const top = pairs[i];
    const bot = pairs[j];
    const n = (r: number) => GRID_RANKS[r] + GRID_RANKS[r];
    if (top === 0 && j > i) parts.push(n(bot) + '+');
    else if (j > i) parts.push(`${n(top)}-${n(bot)}`);
    else parts.push(n(top));
    i = j + 1;
  }
  for (const suited of [true, false]) {
    const suf = suited ? 's' : 'o';
    for (let h = 0; h < 13; h++) {
      const los: number[] = [];
      for (let l = h + 1; l < 13; l++) if (set.has(nonPairCell(h, l, suited))) los.push(l);
      for (let i = 0; i < los.length; ) {
        let j = i;
        while (j + 1 < los.length && los[j + 1] === los[j] + 1) j++;
        const H = GRID_RANKS[h];
        const name = (l: number) => H + GRID_RANKS[l] + suf;
        if (los[i] === h + 1 && j > i) parts.push(name(los[j]) + '+');
        else if (j > i) parts.push(`${name(los[i])}-${name(los[j])}`);
        else parts.push(name(los[i]));
        i = j + 1;
      }
    }
  }
  return parts;
}

const fmtW = (w: number) => String(Math.round(w * 1000) / 1000);

/** 导出为文字。style = 'pio'：AKs:0.5；'bracket'：[50]AKs[/50] */
export function formatRange(weights: ArrayLike<number>, style: 'pio' | 'bracket' = 'pio'): string {
  const groups = new Map<number, Set<number>>();
  for (let i = 0; i < NUM_CLASSES; i++) {
    const w = Math.round(weights[i] * 1000) / 1000;
    if (w <= 0) continue;
    if (!groups.has(w)) groups.set(w, new Set());
    groups.get(w)!.add(i);
  }
  const ws = [...groups.keys()].sort((a, b) => b - a);
  const out: string[] = [];
  for (const w of ws) {
    const parts = compress(groups.get(w)!);
    if (w >= 1) out.push(...parts);
    else if (style === 'pio') out.push(...parts.map((p) => `${p}:${fmtW(w)}`));
    else out.push(`[${Math.round(w * 1000) / 10}]${parts.join(',')}[/${Math.round(w * 1000) / 10}]`);
  }
  return out.join(',');
}

export function className(i: number): string {
  return HAND_CLASSES[i].name;
}

export { RANK_CHARS };
