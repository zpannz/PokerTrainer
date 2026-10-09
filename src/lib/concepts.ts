// 概念练习题：底池赔率、需要的胜率、MDF、诈唬比例、outs 与 2/4 法则
import { makeCard, RANK_CHARS } from './cards.ts';

export type ConceptType = 'potOdds' | 'requiredEquity' | 'mdf' | 'bluffRatio' | 'outs' | 'rule24';

export const CONCEPT_NAMES: Record<ConceptType, string> = {
  potOdds: '底池赔率 (Pot Odds)',
  requiredEquity: '需要的胜率 (Required Equity)',
  mdf: '最小防守频率 (MDF)',
  bluffRatio: '诈唬比例 (Bluff Ratio)',
  outs: '数 outs',
  rule24: '2/4 法则 (Rule of 2 and 4)',
};

export interface ConceptQuestion {
  type: ConceptType;
  prompt: string;
  hero?: number[];
  board?: number[];
  options: string[];
  answer: number;
  explain: string;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const BET_FRACS = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2];

function shuffleOptions(correct: string, wrong: string[], rand: () => number): { options: string[]; answer: number } {
  const uniq = [...new Set(wrong.filter((w) => w !== correct))].slice(0, 3);
  const all = [correct, ...uniq];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return { options: all, answer: all.indexOf(correct) };
}

/** 生成数值型干扰项：正确值附近的其他百分比 */
function pctDistractors(correct: number, extra: number[], rand: () => number): string[] {
  const c = Math.round(correct * 100);
  const out = extra.map((x) => Math.round(x * 100)).filter((x) => x !== c && x > 0 && x < 100);
  const deltas = [-15, -10, -7, -5, -3, 3, 5, 7, 10, 15, 20, 25];
  for (let i = deltas.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deltas[i], deltas[j]] = [deltas[j], deltas[i]];
  }
  for (const d of deltas) {
    if (out.length >= 6) break;
    const v = c + d;
    if (v > 0 && v < 100 && v !== c && !out.includes(v)) out.push(v);
  }
  return out.map((v) => `${v}%`);
}

function potAndBet(rand: () => number) {
  const pot = [6, 8, 10, 12, 15, 20, 24, 30, 40, 50, 60, 80, 100][Math.floor(rand() * 13)];
  const frac = BET_FRACS[Math.floor(rand() * BET_FRACS.length)];
  const bet = Math.max(1, Math.round(pot * frac));
  return { pot, bet };
}

// ---- outs 模板 ----
interface OutsTemplate {
  name: string;
  hero: string; // 用 x/y/z/w 表示花色占位
  board: string;
  outs: number;
  why: string;
}

const OUTS_TEMPLATES: OutsTemplate[] = [
  { name: '同花听牌 (Flush Draw)', hero: '8x7x', board: 'Kx4x2y', outs: 9, why: '同花色还剩 13 − 4 = 9 张。' },
  { name: '两头顺子听牌 (OESD)', hero: '9y8z', board: '7x6y2w', outs: 8, why: '两头都能成顺：4 张 T + 4 张 5 = 8 张。' },
  { name: '卡顺 (Gutshot)', hero: '9y8z', board: 'Jx7y2w', outs: 4, why: '只有 T 能成顺，4 张。' },
  { name: '同花 + 两头顺 (Combo Draw)', hero: '9x8x', board: '7x6xKy', outs: 15, why: '9 张同花 + 8 张顺子牌 − 2 张重复（同花色的 T 和 5）= 15 张。' },
  { name: '同花 + 卡顺', hero: '9x8x', board: 'Jx7x2y', outs: 12, why: '9 张同花 + 4 张 T − 1 张重复（同花色的 T）= 12 张。' },
  { name: '双卡顺 (Double Gutshot)', hero: '9y7z', board: 'Jx8w5x', outs: 8, why: 'T 和 6 都能成顺，共 8 张。' },
  { name: '两张高牌 (Overcards)', hero: 'AyKz', board: '9x6w2x', outs: 6, why: '假设对手有一对（如 9x），任意 A 或 K 让你成更大的一对：3 + 3 = 6 张（实际会打折扣）。' },
  { name: '口袋对子中三条 (Set Draw)', hero: '5y5z', board: 'Kx9w2x', outs: 2, why: '对手有顶对时，只有剩下的 2 张 5 能让你中三条。' },
];

function instantiate(t: OutsTemplate, rand: () => number) {
  const suits = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [suits[i], suits[j]] = [suits[j], suits[i]];
  }
  const map: Record<string, number> = { x: suits[0], y: suits[1], z: suits[2], w: suits[3] };
  const parse = (s: string) => {
    const out: number[] = [];
    for (let i = 0; i < s.length; i += 2) out.push(makeCard(RANK_CHARS.indexOf(s[i]), map[s[i + 1]]));
    return out;
  };
  return { hero: parse(t.hero), board: parse(t.board) };
}

function choose2(n: number) {
  return (n * (n - 1)) / 2;
}

export function exactHitChance(outs: number, cardsToCome: 1 | 2): number {
  if (cardsToCome === 1) return outs / 46;
  return 1 - choose2(47 - outs) / choose2(47);
}

export function rule24(outs: number, cardsToCome: 1 | 2): number {
  return (outs * (cardsToCome === 2 ? 4 : 2)) / 100;
}

export function generateConcept(type: ConceptType, rand: () => number): ConceptQuestion {
  switch (type) {
    case 'potOdds': {
      const { pot, bet } = potAndBet(rand);
      const ratio = (pot + bet) / bet;
      const correct = `${ratio.toFixed(1)} : 1`;
      const wrong = [`${(pot / bet).toFixed(1)} : 1`, `${((pot + 2 * bet) / bet).toFixed(1)} : 1`, `${(ratio + 1.5).toFixed(1)} : 1`, `${Math.max(1.1, ratio - 1).toFixed(1)} : 1`];
      const o = shuffleOptions(correct, wrong, rand);
      return {
        type,
        prompt: `底池 ${pot}bb，对手下注 ${bet}bb。你需要跟注 ${bet}bb，你得到的底池赔率是多少？`,
        ...o,
        explain: `跟注后可赢得 底池 + 对手下注 = ${pot} + ${bet} = ${pot + bet}bb，付出 ${bet}bb，所以赔率是 ${pot + bet} : ${bet} ≈ ${correct}。`,
      };
    }
    case 'requiredEquity': {
      const { pot, bet } = potAndBet(rand);
      const req = bet / (pot + 2 * bet);
      const o = shuffleOptions(pct(req), pctDistractors(req, [bet / (pot + bet), bet / pot / 2], rand), rand);
      return {
        type,
        prompt: `底池 ${pot}bb，对手下注 ${bet}bb。你至少需要多少胜率 (equity) 才能跟注不亏？`,
        ...o,
        explain: `需要的胜率 = 跟注额 ÷ 跟注后的总底池 = ${bet} ÷ (${pot} + ${bet} + ${bet}) = ${(req * 100).toFixed(1)}%。`,
      };
    }
    case 'mdf': {
      const { pot, bet } = potAndBet(rand);
      const mdf = pot / (pot + bet);
      const o = shuffleOptions(pct(mdf), pctDistractors(mdf, [1 - bet / (pot + 2 * bet), bet / (pot + bet)], rand), rand);
      return {
        type,
        prompt: `底池 ${pot}bb，对手下注 ${bet}bb（${((bet / pot) * 100).toFixed(0)}% 底池）。为了让对手的任意诈唬不能自动获利，你的最小防守频率 (MDF) 是多少？`,
        ...o,
        explain: `MDF = 底池 ÷ (底池 + 下注) = ${pot} ÷ ${pot + bet} = ${(mdf * 100).toFixed(1)}%。防守低于这个频率，对手用任意两张牌诈唬都能直接盈利。`,
      };
    }
    case 'bluffRatio': {
      const { pot, bet } = potAndBet(rand);
      const r = bet / (pot + 2 * bet);
      const o = shuffleOptions(pct(r), pctDistractors(r, [bet / (pot + bet), pot / (pot + bet)], rand), rand);
      return {
        type,
        prompt: `河牌圈，底池 ${pot}bb，你用极化范围下注 ${bet}bb。理论上你的下注范围中诈唬应占多少比例，才能让对手跟注和弃牌无差别？`,
        ...o,
        explain: `诈唬比例 = 下注 ÷ (底池 + 2 × 下注) = ${bet} ÷ ${pot + 2 * bet} = ${(r * 100).toFixed(1)}%，正好等于对手跟注需要的胜率。约每 ${((1 - r) / r).toFixed(1)} 个价值组合配 1 个诈唬。`,
      };
    }
    case 'outs': {
      const t = OUTS_TEMPLATES[Math.floor(rand() * OUTS_TEMPLATES.length)];
      const { hero, board } = instantiate(t, rand);
      const wrong = [t.outs + 2, t.outs - 2, t.outs + 4, t.outs - 1, t.outs + 1].filter((x) => x > 0).map(String);
      const o = shuffleOptions(String(t.outs), wrong, rand);
      return {
        type,
        prompt: `你的手牌和翻牌如下（${t.name}）。你有多少张 outs（能让你变成最强牌的牌）？`,
        hero,
        board,
        ...o,
        explain: `${t.why} 按 2/4 法则：翻牌圈到河牌约 ${t.outs * 4}%（精确 ${(exactHitChance(t.outs, 2) * 100).toFixed(1)}%），只看下一张约 ${t.outs * 2}%（精确 ${(exactHitChance(t.outs, 1) * 100).toFixed(1)}%）。`,
      };
    }
    case 'rule24': {
      const outs = [2, 4, 6, 8, 9, 12, 15][Math.floor(rand() * 7)];
      const two = rand() < 0.5;
      const est = rule24(outs, two ? 2 : 1);
      const ex = exactHitChance(outs, two ? 2 : 1);
      const o = shuffleOptions(pct(est), pctDistractors(est, [rule24(outs, two ? 1 : 2), outs / 100], rand), rand);
      return {
        type,
        prompt: `你有 ${outs} 张 outs，${two ? '现在是翻牌圈，看到河牌（还有两张牌）' : '现在是转牌圈（还有一张牌）'}。按 2/4 法则估算，你命中的概率约是多少？`,
        ...o,
        explain: `2/4 法则：${two ? '两张牌 ≈ outs × 4' : '一张牌 ≈ outs × 2'} = ${(est * 100).toFixed(0)}%。精确值为 ${(ex * 100).toFixed(1)}%${outs > 8 && two ? '（outs 较多时 ×4 会高估，可用 outs×4 − (outs−8) 修正）' : ''}。`,
      };
    }
  }
}
