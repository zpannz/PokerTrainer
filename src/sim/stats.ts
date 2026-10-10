// 玩家统计：VPIP、PFR、3-bet、翻后激进度（AF）、摊牌率等
import type { HandState } from './engine.ts';

export interface PlayerStats {
  hands: number;
  vpip: number;
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  /** 翻后下注 + 加注、跟注次数（AF = 前者 / 后者） */
  postAggr: number;
  postCall: number;
  sawFlop: number;
  wtsd: number;
  wsd: number;
}

export const emptyStats = (): PlayerStats => ({ hands: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0, postAggr: 0, postCall: 0, sawFlop: 0, wtsd: 0, wsd: 0 });

export function addStats(a: PlayerStats, b: PlayerStats): PlayerStats {
  const out = emptyStats();
  for (const k of Object.keys(out) as (keyof PlayerStats)[]) out[k] = a[k] + b[k];
  return out;
}

/** 把一手已结束的牌计入统计 */
export function recordStats(stats: Record<number, PlayerStats>, st: HandState): void {
  if (!st.result) return;
  const pre = st.log.filter((e) => e.street === 0 && e.kind !== 'sb' && e.kind !== 'bb' && e.kind !== 'ante');
  // 大盲白拿盲注（所有人弃牌到大盲）不计入大盲的手数
  const walk = pre.every((e) => e.kind === 'fold') && !st.log.some((e) => e.street > 0);
  for (const p of st.players) {
    const s = (stats[p.seat] ??= emptyStats());
    if (walk && p.seat === st.bbSeat) continue;
    s.hands++;
    let raisesBefore = 0;
    let vp = false;
    let pr = false;
    let opp3 = false;
    let did3 = false;
    for (const e of pre) {
      if (e.seat === p.seat) {
        if (raisesBefore === 1 && !opp3) {
          opp3 = true;
          if (e.kind === 'raise') did3 = true;
        }
        if (e.kind === 'call' || e.kind === 'raise' || e.kind === 'bet') vp = true;
        if (e.kind === 'raise' || e.kind === 'bet') pr = true;
      }
      if (e.kind === 'raise' || e.kind === 'bet') raisesBefore++;
    }
    if (vp) s.vpip++;
    if (pr) s.pfr++;
    if (opp3) s.threeBetOpp++;
    if (did3) s.threeBet++;
    // 看到翻牌：有翻牌且翻前没有弃牌（翻前全下后直接发完公共牌也算）
    const sawFlop = st.board.length >= 3 && !pre.some((e) => e.seat === p.seat && e.kind === 'fold');
    if (sawFlop) s.sawFlop++;
    for (const e of st.log) {
      if (e.street === 0 || e.seat !== p.seat) continue;
      if (e.kind === 'bet' || e.kind === 'raise') s.postAggr++;
      if (e.kind === 'call') s.postCall++;
    }
    if (st.result.showdown && !p.folded && sawFlop) {
      s.wtsd++;
      if (st.result.won[p.seat] > 0) s.wsd++;
    }
  }
}

export const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export function statLine(s: PlayerStats) {
  return {
    vpip: pct(s.vpip, s.hands),
    pfr: pct(s.pfr, s.hands),
    threeBet: pct(s.threeBet, s.threeBetOpp),
    af: s.postCall > 0 ? s.postAggr / s.postCall : s.postAggr > 0 ? Infinity : 0,
    wtsd: pct(s.wtsd, s.sawFlop),
    wsd: pct(s.wsd, s.wtsd),
  };
}
