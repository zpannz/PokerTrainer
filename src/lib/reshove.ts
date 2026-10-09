// 锦标赛"开池 vs 再全下"（open vs reshove）均衡 —— 筹码 EV，含大盲前注
//
// 模型：
// - 各家筹码相同（发牌前 stack 个大盲），大盲先交前注 ante（死钱），小盲 0.5bb、大盲 1bb。
// - 开池者 p 以给定的范围（来自范围库，不参与求解）加注到 open bb，中间玩家都弃牌。
// - 后面的玩家 j 只能再全下或弃牌（不考虑平跟）；j 全下后，j 之后的其他玩家都弃牌，开池者跟注或弃牌。
//   （j 之后的玩家面对"加注 + 全下"时几乎只用极强的牌跟注，忽略这部分会让 j 的全下范围略宽。）
// - 牌的去除效应：对手手牌的分布以自己的手牌为条件（成对计算）。
// - 用虚拟博弈（fictitious play）求两人子博弈的均衡，输出可被利用度作为收敛指标。
import { HAND_CLASSES, NUM_CLASSES } from './hands.ts';

export interface ReshoveParams {
  players: number;
  opener: number; // 座位序号（0 = UTG … N-2 = SB，N-1 = BB）
  shover: number;
  stack: number;
  ante: number;
  open: number; // 开池加注到多少（bb，总额）
  openRange: ArrayLike<number>; // 169 类别的开池频率
  iterations?: number;
  eq: ArrayLike<number>;
  compat: ArrayLike<number>;
}

export interface ReshoveResult {
  shove: number[]; // 再全下频率（169）
  call: number[]; // 开池者面对全下的跟注频率（169，以开池为前提）
  shoveEV: number[]; // 全下相对弃牌的 EV（bb）
  callEV: number[]; // 跟注相对弃牌的 EV（bb）
  exploitability: number; // bb
  pot: number; // 开池后、全下前的底池
  cost: { shove: number; call: number }; // 全下需要投入 / 跟注需要投入（bb）
}

export function solveReshove(p: ReshoveParams): ReshoveResult {
  const H = NUM_CLASSES;
  const N = p.players;
  const sbPos = N - 2;
  const bbPos = N - 1;
  const SB = 0.5;
  const BB = 1;
  const posted = (i: number) => (i === sbPos ? SB : i === bbPos ? BB : 0);
  const live = (i: number) => (i === bbPos ? p.stack - p.ante : p.stack);
  const { eq, compat } = p;
  const iters = p.iterations ?? 3000;

  // 开池后的底池：前注 + 两个盲注 + 开池者超出自己盲注的部分
  const pot0 = p.ante + SB + BB + p.open - posted(p.opener);
  const m = Math.min(live(p.opener), live(p.shover));
  // 跟注后的最终底池：双方各 m，加上其他人的死钱
  let others = p.ante;
  if (sbPos !== p.opener && sbPos !== p.shover) others += SB;
  if (bbPos !== p.opener && bbPos !== p.shover) others += BB;
  const potF = others + 2 * m;

  const cond = new Float64Array(H * H);
  for (let h = 0; h < H; h++) {
    const tot = HAND_CLASSES[h].combos * 1225;
    for (let c = 0; c < H; c++) cond[h * H + c] = compat[h * H + c] / tot;
  }
  const O = p.openRange;
  const shove = new Float64Array(H).fill(0.3);
  const call = new Float64Array(H).fill(0.5);
  const shoveEV = new Float64Array(H);
  const callEV = new Float64Array(H);

  // 全下 EV（相对弃牌）：对手弃牌赢 pot0；对手跟注时 eq × potF − m + 已下的盲注
  const computeShove = () => {
    for (let h = 0; h < H; h++) {
      let mass = 0;
      let callMass = 0;
      let eqCall = 0;
      const base = h * H;
      for (let c = 0; c < H; c++) {
        const w = cond[base + c] * O[c];
        if (w === 0) continue;
        mass += w;
        const wc = w * call[c];
        callMass += wc;
        eqCall += wc * eq[base + c];
      }
      if (mass <= 0) {
        shoveEV[h] = pot0;
        continue;
      }
      const pc = callMass / mass;
      shoveEV[h] = (1 - pc) * pot0 + (eqCall / mass) * potF - pc * (m - posted(p.shover));
    }
  };
  // 跟注 EV（相对弃牌）：eq × potF − m + 已投入的开池额
  const computeCall = () => {
    for (let c = 0; c < H; c++) {
      let mass = 0;
      let eqs = 0;
      const base = c * H;
      for (let h = 0; h < H; h++) {
        const w = cond[base + h] * shove[h];
        if (w === 0) continue;
        mass += w;
        eqs += w * eq[base + h];
      }
      callEV[c] = mass > 1e-12 ? (eqs / mass) * potF - (m - p.open) : -(m - p.open);
    }
  };

  for (let t = 1; t <= iters; t++) {
    const lr = 1 / (t + 1);
    computeCall();
    for (let c = 0; c < H; c++) call[c] += ((callEV[c] > 0 ? 1 : 0) - call[c]) * lr;
    computeShove();
    for (let h = 0; h < H; h++) shove[h] += ((shoveEV[h] > 0 ? 1 : 0) - shove[h]) * lr;
  }
  computeCall();
  computeShove();

  // 可被利用度：两位玩家各自偏离到最优反应能多赢多少（bb/手，以到达该决策点为条件）
  const prior = HAND_CLASSES.map((x) => x.combos / 1326);
  let g1 = 0;
  for (let h = 0; h < H; h++) g1 += prior[h] * (Math.max(shoveEV[h], 0) - shove[h] * shoveEV[h]);
  let g2 = 0;
  let mass2 = 0;
  for (let c = 0; c < H; c++) {
    let mm = 0;
    for (let h = 0; h < H; h++) mm += cond[c * H + h] * shove[h];
    const w = prior[c] * O[c] * mm;
    mass2 += w;
    g2 += w * (Math.max(callEV[c], 0) - call[c] * callEV[c]);
  }
  const expl = Math.max(g1, mass2 > 0 ? g2 / mass2 : 0);

  const r3 = (a: Float64Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
  const r2 = (a: Float64Array) => Array.from(a, (v) => Math.round(v * 100) / 100);
  return {
    shove: r3(shove),
    call: Array.from(call, (v, c) => (O[c] > 0 ? Math.round(v * 1000) / 1000 : 0)),
    shoveEV: r2(shoveEV),
    callEV: r2(callEV),
    exploitability: expl,
    pot: Math.round(pot0 * 100) / 100,
    cost: { shove: Math.round((live(p.shover) - posted(p.shover)) * 100) / 100, call: Math.round((m - p.open) * 100) / 100 },
  };
}
