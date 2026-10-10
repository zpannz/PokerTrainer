// 打完复盘：把每手牌导出为手牌历史，再用手牌复盘工具的同一套逻辑对照范围库与预计算求解结果，
// 列出所有偏离的决策并按 EV 损失排序
import { parseHandHistory } from '../lib/handHistory.ts';
import { type ReviewStep, type WalkSource, postflopSetup, reviewPostflop, reviewPreflop } from '../lib/handReview.ts';
import { cardToString } from '../lib/cards.ts';
import { findPrecomputed } from '../postflop/precomputed.ts';
import { toChips } from '../postflop/scenarios.ts';
import { historyKey, type SolvedSpot } from '../postflop/types.ts';
import { type CompactHand, LOG_KINDS, type Session } from './session.ts';
import { exportHand, heroDecided } from './history.ts';
import type { SpotProvider } from './solver.ts';

export interface Deviation {
  handNo: number;
  step: ReviewStep;
  /** EV 损失（bb） */
  evLoss: number;
  /** true = 来自计算得出的 EV（纳什表 / 求解结果）；false = 按频率差估算 */
  exact: boolean;
}

export interface SessionReview {
  deviations: Deviation[];
  /** 能对照的决策数、其中"最佳"的数量 */
  graded: number;
  best: number;
  ok: number;
  wrong: number;
  /** 你有决策的手数 */
  hands: number;
  postflopMatched: number;
}

/** 你第 k 次翻前主动决策之前的底池与需要跟注的额度（bb） */
function preflopContext(s: Session, h: CompactHand, k: number): { pot: number; toCall: number } {
  let pot = 0;
  const street = new Map<number, number>();
  let currentBet = 0;
  let seen = 0;
  for (const [st, seat, kind, amount, to] of h.l) {
    if (st !== 0) break;
    const kd = LOG_KINDS[kind];
    if (seat === s.heroSeat && kind >= 3) {
      if (seen === k) return { pot: pot / h.bb, toCall: Math.max(0, currentBet - (street.get(seat) ?? 0)) / h.bb };
      seen++;
    }
    pot += amount;
    if (kd !== 'ante') street.set(seat, to);
    currentBet = Math.max(currentBet, kd === 'ante' ? 0 : to);
  }
  return { pot: pot / h.bb, toCall: 0 };
}

function evLossOf(step: ReviewStep, ctx: { pot: number; toCall: number }): { loss: number; exact: boolean } {
  if (step.evLoss !== undefined) return { loss: step.evLoss, exact: true };
  const chosen = step.freqs.find((f) => f.chosen) ?? { freq: 0, ev: undefined };
  const hasEv = step.freqs.some((f) => f.ev !== undefined);
  if (hasEv) {
    // 计算得出的表：EV 为相对弃牌的 EV（弃牌 = 0）
    const evs = step.freqs.map((f) => f.ev ?? 0);
    const max = Math.max(...evs);
    return { loss: Math.max(0, max - (chosen.ev ?? 0)), exact: true };
  }
  const maxF = Math.max(...step.freqs.map((f) => f.freq));
  const gap = Math.max(0, maxF - chosen.freq);
  return { loss: gap * 0.5 * (ctx.pot + ctx.toCall), exact: false };
}

export async function reviewSession(s: Session, opts: { provider?: SpotProvider | null; onProgress?: (done: number, total: number) => void } = {}): Promise<SessionReview> {
  const provider = opts.provider === undefined ? (id: string, flop: string) => findPrecomputed(id, flop).catch(() => null) : opts.provider;
  const out: SessionReview = { deviations: [], graded: 0, best: 0, ok: 0, wrong: 0, hands: 0, postflopMatched: 0 };
  const list = s.history.filter((h) => heroDecided(s, h));
  out.hands = list.length;
  let i = 0;
  for (const h of list) {
    i++;
    if (opts.onProgress && i % 25 === 0) {
      opts.onProgress(i, list.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    let rec;
    try {
      rec = parseHandHistory(exportHand(s, h));
    } catch {
      continue;
    }
    const steps: ReviewStep[] = [];
    const pre = reviewPreflop(rec);
    pre.steps.forEach((st0, k) => {
      let st = st0;
      // 范围表中没有你的选项（例如首先入池时溜入）：按错误计，EV 损失按"表中最高频率 × 底池"估算
      if (!st.grade && st.freqs.length > 0 && !st.freqs.some((f) => f.chosen)) st = { ...st, grade: 'wrong', note: `${st.note ?? ''}（范围表中没有这个选项，按错误计）` };
      steps.push(st);
      if (!st.grade) return;
      const { loss, exact } = evLossOf(st, preflopContext(s, h, k));
      record(out, h.no, st, loss, exact);
    });
    if (provider && rec.board.length >= 3) {
      const pf = postflopSetup(rec, pre.format);
      if (pf.setup) {
        const flop = rec.board.slice(0, 3).map(cardToString).join('');
        const found = await provider(pf.setup.scenario.id, flop);
        if (found) {
          const sp: SolvedSpot = found.spot;
          const src: WalkSource = { hands: sp.hands, getNode: async (hist) => sp.nodes[historyKey(hist)] ?? null, label: '预计算牌面库', expl: `可被利用度 ${((sp.exploitability / sp.config.pot) * 100).toFixed(2)}% 底池` };
          const potScale = sp.config.pot / toChips(pf.setup.potBB);
          const post = await reviewPostflop(rec, pf.setup, src, { suitMap: found.map, potScale });
          let any = false;
          for (const st of post) {
            if (!st.grade) continue;
            any = true;
            record(out, h.no, st, st.evLoss ?? 0, true);
          }
          if (any) out.postflopMatched++;
        }
      }
    }
  }
  out.deviations.sort((a, b) => b.evLoss - a.evLoss || a.handNo - b.handNo);
  return out;
}

function record(out: SessionReview, handNo: number, step: ReviewStep, loss: number, exact: boolean) {
  out.graded++;
  if (step.grade === 'best') out.best++;
  else {
    if (step.grade === 'ok') out.ok++;
    else out.wrong++;
    out.deviations.push({ handNo, step, evLoss: loss, exact });
  }
}
