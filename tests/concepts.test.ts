import { describe, expect, it } from 'vitest';
import { CONCEPT_NAMES, exactHitChance, generateConcept, rule24, type ConceptType } from '../src/lib/concepts.ts';
import { mulberry32 } from '../src/lib/cards.ts';

describe('概念练习题', () => {
  it('每种题型都能生成合法题目（选项不重复、答案在选项中）', () => {
    const rand = mulberry32(1);
    for (const t of Object.keys(CONCEPT_NAMES) as ConceptType[])
      for (let i = 0; i < 300; i++) {
        const q = generateConcept(t, rand);
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(new Set(q.options).size).toBe(q.options.length);
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        if (q.hero) expect(new Set([...q.hero, ...(q.board ?? [])]).size).toBe(q.hero.length + (q.board?.length ?? 0));
      }
  });

  it('outs 概率：9 outs 两张牌精确 34.97%，2/4 法则 36%', () => {
    expect(exactHitChance(9, 2)).toBeCloseTo(0.3497, 4);
    expect(exactHitChance(9, 1)).toBeCloseTo(9 / 46, 10);
    expect(rule24(9, 2)).toBeCloseTo(0.36);
    expect(rule24(8, 1)).toBeCloseTo(0.16);
  });
});
