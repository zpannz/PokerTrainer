import { beforeAll, describe, expect, it } from 'vitest';
import { loadData } from '../src/data/equityData.ts';
import { getChart, type Chart } from '../src/data/charts.ts';
import { buildPool, gradeAction, nextQuestion, recordAnswer, type TrainingStats } from '../src/lib/trainer.ts';
import { makeFormat, parseSpotId, spotCategories } from '../src/lib/formats.ts';
import { classIndex, comboToClass, NUM_CLASSES } from '../src/lib/hands.ts';
import { mulberry32 } from '../src/lib/cards.ts';

beforeAll(async () => {
  await loadData();
});

const emptyStats = (): TrainingStats => ({ tallies: {}, mistakes: [], totalAnswered: 0 });

function fakeChart(freqRaise: number, freqCall: number): Chart {
  const base = getChart('cash6-100/vsOpen/BTN/CO');
  const raise = new Float64Array(NUM_CLASSES).fill(freqRaise);
  const call = new Float64Array(NUM_CLASSES).fill(freqCall);
  const fold = new Float64Array(NUM_CLASSES).fill(1 - freqRaise - freqCall);
  return { ...base, freq: { raise, call, fold } };
}

describe('训练判分', () => {
  it('最高频率动作 = 最佳；≥10% 的低频动作 = 可接受；<10% = 错误', () => {
    const c = fakeChart(0.6, 0.35);
    expect(gradeAction(c, 0, 'raise').grade).toBe('best');
    expect(gradeAction(c, 0, 'call').grade).toBe('ok');
    expect(gradeAction(c, 0, 'fold').grade).toBe('wrong'); // 5%
    const d = fakeChart(0.5, 0.48);
    expect(gradeAction(d, 0, 'call').grade).toBe('best'); // 与最高频率相差不超过 5%
  });

  it('真实数据：UTG 开池 AA 加注为最佳，72o 加注为错误', () => {
    const c = getChart('cash6-100/rfi/UTG/');
    expect(gradeAction(c, classIndex('AA'), 'raise').grade).toBe('best');
    expect(gradeAction(c, classIndex('72o'), 'raise').grade).toBe('wrong');
    expect(gradeAction(c, classIndex('72o'), 'fold').grade).toBe('best');
  });
});

describe('出题', () => {
  it('题目都来自所选场景，手牌在范围内，牌与手牌类别一致', () => {
    const f = makeFormat('cash', 6, 100);
    const pool = buildPool(f, ['vs3bet', 'bbDefense'], null);
    const rand = mulberry32(5);
    const stats = emptyStats();
    for (let i = 0; i < 500; i++) {
      const q = nextQuestion(pool, stats, getChart, rand);
      expect(spotCategories(q.spot).some((c) => c === 'vs3bet' || c === 'bbDefense')).toBe(true);
      expect(q.chart.prior[q.hand]).toBeGreaterThan(0);
      expect(comboToClass(q.cards[0], q.cards[1])).toBe(q.hand);
    }
  });

  it('按位置筛选', () => {
    const pool = buildPool(makeFormat('mtt', 9, 15), ['push', 'vsShove', 'bbDefense', 'sbStrategy'], ['BB']);
    expect(pool.length).toBe(8);
    expect(pool.every((s) => s.hero === 'BB')).toBe(true);
  });

  it('出题偏向有决策意义的手牌（BTN 开池题中，弃牌的手牌不超过 35%）', () => {
    const pool = buildPool(makeFormat('cash', 6, 100), ['rfi'], ['BTN']);
    const rand = mulberry32(9);
    let folds = 0;
    for (let i = 0; i < 2000; i++) {
      const q = nextQuestion(pool, emptyStats(), getChart, rand);
      if (q.chart.freq.fold![q.hand] > 0.95) folds++;
    }
    expect(folds / 2000).toBeLessThan(0.35);
  });

  it('错题会更多地出现，答对两次后移出错题本', () => {
    const f = makeFormat('cash', 6, 100);
    const pool = buildPool(f, ['rfi'], null);
    const stats = emptyStats();
    const spot = parseSpotId('cash6-100/rfi/CO/');
    const hand = classIndex('K9o');
    recordAnswer(stats, spot, hand, 'fold', 'wrong');
    expect(stats.mistakes.length).toBe(1);
    const rand = mulberry32(2);
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      const q = nextQuestion(pool, stats, getChart, rand, 0.3);
      if (q.spot.id === spot.id && q.hand === hand) hits++;
    }
    expect(hits).toBeGreaterThan(200); // 约 30%
    recordAnswer(stats, spot, hand, 'raise', 'best');
    expect(stats.mistakes.length).toBe(1);
    recordAnswer(stats, spot, hand, 'raise', 'best');
    expect(stats.mistakes.length).toBe(0);
    const t = stats.tallies['cash6-100|rfi|CO'];
    expect(t).toEqual({ n: 3, best: 2, ok: 0, wrong: 1 });
  });

  it('统计中错误率高的场景出现得更多', () => {
    const f = makeFormat('cash', 6, 100);
    const pool = buildPool(f, ['rfi'], null);
    const stats = emptyStats();
    for (let i = 0; i < 30; i++) recordAnswer(stats, parseSpotId('cash6-100/rfi/HJ/'), classIndex('AA'), 'fold', 'wrong');
    for (let i = 0; i < 30; i++) recordAnswer(stats, parseSpotId('cash6-100/rfi/UTG/'), classIndex('AA'), 'raise', 'best');
    stats.mistakes = [];
    const rand = mulberry32(4);
    const cnt: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const q = nextQuestion(pool, stats, getChart, rand, 0);
      cnt[q.spot.hero] = (cnt[q.spot.hero] ?? 0) + 1;
    }
    expect(cnt.HJ).toBeGreaterThan(cnt.UTG * 2);
  });
});
