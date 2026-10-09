// 牌的基础表示
// 一张牌用 0..51 的整数表示：rank = card >> 2（0 = 2, 12 = A），suit = card & 3
export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc'; // spades, hearts, diamonds, clubs
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];

export const rankOf = (card: number): number => card >> 2;
export const suitOf = (card: number): number => card & 3;
export const makeCard = (rank: number, suit: number): number => (rank << 2) | suit;

export function cardToString(card: number): string {
  return RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)];
}

export function parseCard(s: string): number {
  if (s.length !== 2) throw new Error(`无效的牌: ${s}`);
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`无效的牌: ${s}`);
  return makeCard(r, su);
}

/** 解析 "AhKd 7c" / "Ah Kd 7c" / "AhKd7c" 等写法 */
export function parseCards(s: string): number[] {
  const clean = s.replace(/[\s,]+/g, '');
  if (clean.length % 2 !== 0) throw new Error(`无法解析牌面: ${s}`);
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const c = parseCard(clean.slice(i, i + 2));
    if (out.includes(c)) throw new Error(`重复的牌: ${cardToString(c)}`);
    out.push(c);
  }
  return out;
}

export function fullDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** 简单的可复现伪随机数（mulberry32），用于测试和预计算脚本 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
