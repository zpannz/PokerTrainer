// 推进牌局：轮到 AI 时按风格决策；可选让"你"的座位也由 AI 自动打（测试用）
import { aiDecide, type AiDecision } from './ai.ts';
import { applyAction, currentPlayer, type Act } from './engine.ts';
import { type Session, beginHand, finishHand } from './session.ts';
import { STYLES, type Style } from './styles.ts';
import { type SpotProvider, ensureSolver, solverView } from './solver.ts';
import { type U32, cryptoU32, toUnit } from './rng.ts';

export interface DriverOptions {
  u?: U32;
  samples?: number;
  /** 你的座位由 AI 代打（测试用） */
  heroAuto?: Style;
  /** 预计算牌面库；null = 不使用 */
  provider?: SpotProvider | null;
}

export const gameKind = (s: Session) => (s.config.kind === 'cash' ? 'cash' : 'mtt') as 'cash' | 'mtt';

function styleOf(s: Session, seat: number, opts: DriverOptions): Style {
  const info = s.seats[seat];
  if (info.isHero) return opts.heroAuto ?? STYLES.gto;
  return STYLES[info.style ?? 'gto'];
}

/** 让当前行动的 AI 行动一次；返回动作，若轮到你（且不代打）或没有人需要行动则返回 null */
export function aiAct(s: Session, opts: DriverOptions = {}): (Act & { seat: number; basis: AiDecision['basis'] }) | null {
  const st = s.current;
  if (!st || st.done) return null;
  const p = currentPlayer(st);
  if (!p) return null;
  if (p.seat === s.heroSeat && !opts.heroAuto) return null;
  const u = opts.u ?? cryptoU32();
  const d = aiDecide({
    st,
    seat: p.seat,
    style: styleOf(s, p.seat, opts),
    game: gameKind(s),
    scheme: s.config.rangeScheme,
    rand: toUnit(u),
    solver: opts.provider === null ? null : solverView(st, p.seat),
    samples: opts.samples,
  });
  applyAction(st, d);
  return { ...d, seat: p.seat };
}

/** 翻牌圈开始时等待预计算结果加载 */
export async function prepareStreet(s: Session, opts: DriverOptions = {}): Promise<void> {
  const st = s.current;
  if (!st || st.done || opts.provider === null) return;
  const p = ensureSolver(st, gameKind(s), opts.provider);
  if (p) await p;
}

/** 同步打完一整手（所有座位都由 AI 决策；测试和快速模拟用，不使用预计算牌面库） */
export function playHandSync(s: Session, opts: DriverOptions): void {
  const u = opts.u ?? cryptoU32();
  beginHand(s, u);
  let guard = 0;
  while (s.current && !s.current.done) {
    if (!aiAct(s, { ...opts, provider: null, u })) throw new Error('需要代打你的座位（heroAuto）');
    if (++guard > 1000) throw new Error('死循环');
  }
  finishHand(s, u);
}

/** 异步打完一整手（可使用预计算牌面库） */
export async function playHandAsync(s: Session, opts: DriverOptions): Promise<void> {
  const u = opts.u ?? cryptoU32();
  beginHand(s, u);
  let guard = 0;
  while (s.current && !s.current.done) {
    await prepareStreet(s, opts);
    if (!aiAct(s, { ...opts, u })) throw new Error('需要代打你的座位（heroAuto）');
    if (++guard > 1000) throw new Error('死循环');
  }
  finishHand(s, u);
}
