// 全下 EV 调整：下注在公共牌发完之前结束（有人全下）时，按当时各家对每个底池的胜率计算期望收益，代替实际结果
import { evalMasks } from '../lib/evaluator.ts';
import { rankOf, suitOf } from '../lib/cards.ts';
import type { HandState } from './engine.ts';
import { type U32, cryptoU32, randInt } from './rng.ts';

/**
 * 返回每个座位的 EV 调整后净输赢（没有全下摊牌时返回 null）。
 * 剩余 1~2 张牌时精确枚举，翻前全下时蒙特卡洛 samples 次。
 */
export function allinEvNet(st: HandState, samples = 8000, u: U32 = cryptoU32()): Record<number, number> | null {
  const r = st.result;
  if (!r || r.allinBoard === null) return null;
  const k = r.allinBoard;
  const known = st.board.slice(0, k);
  const live = st.players.filter((p) => !p.folded);
  const used = new Uint8Array(52);
  for (const c of known) used[c] = 1;
  for (const p of live) {
    used[p.hole[0]] = 1;
    used[p.hole[1]] = 1;
  }
  // 已弃牌玩家的牌不可见，不从牌堆中去掉（与观察者的信息一致）
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) deck.push(c);
  const need = 5 - k;
  const share = new Map<number, number>(); // 座位 → 期望拿回的筹码
  for (const p of st.players) share.set(p.seat, 0);
  const base = [0, 0, 0, 0];
  for (const c of known) base[suitOf(c)] |= 1 << rankOf(c);
  const hm = live.map((p) => {
    const m = [...base];
    for (const c of p.hole) m[suitOf(c)] |= 1 << rankOf(c);
    return m;
  });
  const vals = new Map<number, number>();
  let total = 0;
  const run = (extra: number[], w: number) => {
    const e = [0, 0, 0, 0];
    for (const c of extra) e[suitOf(c)] |= 1 << rankOf(c);
    live.forEach((p, i) => {
      const m = hm[i];
      vals.set(p.seat, evalMasks(m[0] | e[0], m[1] | e[1], m[2] | e[2], m[3] | e[3]));
    });
    for (const pot of r.pots) {
      let best = -1;
      let cnt = 0;
      for (const s of pot.eligible) {
        const v = vals.get(s)!;
        if (v > best) {
          best = v;
          cnt = 1;
        } else if (v === best) cnt++;
      }
      for (const s of pot.eligible) if (vals.get(s) === best) share.set(s, share.get(s)! + (w * pot.amount) / cnt);
    }
    total += w;
  };
  if (need === 1) for (const c of deck) run([c], 1);
  else if (need === 2) {
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) run([deck[i], deck[j]], 1);
  } else {
    const d = [...deck];
    for (let t = 0; t < samples; t++) {
      // 部分 Fisher-Yates：取前 need 张
      for (let i = 0; i < need; i++) {
        const j = i + randInt(u, d.length - i);
        const x = d[i];
        d[i] = d[j];
        d[j] = x;
      }
      run(d.slice(0, need), 1);
    }
  }
  const out: Record<number, number> = {};
  for (const p of st.players) out[p.seat] = share.get(p.seat)! / total - p.total;
  return out;
}
