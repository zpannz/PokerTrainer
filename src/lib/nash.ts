// 全下/弃牌（Push/Fold）纳什均衡求解器 —— 筹码 EV（chip EV），含大盲前注
//
// 模型（简化，与常见 push/fold 图表的假设一致）：
// - N 名玩家筹码相同（发牌前 stack 个大盲）。大盲先交前注 ante（死钱），再交 1bb；小盲 0.5bb。
// - 第一个入池的玩家只能全下或弃牌；后面的玩家只能跟注或弃牌。
// - 只考虑"一人全下、最多一人跟注"：有人跟注后，其余玩家全部弃牌（忽略多人全下，现实中频率很低）。
// - 牌的去除效应：对手手牌的分布以"我的手牌"为条件（成对计算），对手之间视为相互独立。
// - 用虚拟博弈（fictitious play）迭代求解，平均策略即为近似均衡；输出可被利用度作为收敛指标。
import { HAND_CLASSES, NUM_CLASSES } from './hands.ts';

export interface PushFoldParams {
  players: number;
  stack: number; // 单位：bb
  ante: number; // 大盲前注（bb），由大盲支付
  sb?: number;
  bb?: number;
  iterations?: number;
  eq: ArrayLike<number>; // 169×169 胜率（0~1）
  compat: ArrayLike<number>; // 169×169 互不冲突组合对数量
}

export interface PushFoldResult {
  players: number;
  stack: number;
  ante: number;
  push: number[][]; // push[p][h]：位置 p 首先入池时全下的频率（p = 0..N-2）
  call: number[][][]; // call[p][j][h]：位置 j 面对 p 的全下时跟注的频率（j > p）
  pushEV: number[][]; // 全下相对弃牌的 EV（bb）
  callEV: number[][][];
  exploitability: number; // 所有决策点中，单个玩家通过偏离能获得的最大收益（bb/手）
  iterations: number;
}

export function solvePushFold(params: PushFoldParams): PushFoldResult {
  const N = params.players;
  const S = params.stack;
  const A = params.ante;
  const SB = params.sb ?? 0.5;
  const BB = params.bb ?? 1;
  const iters = params.iterations ?? 1500;
  const { eq, compat } = params;
  const H = NUM_CLASSES;
  const sbPos = N - 2;
  const bbPos = N - 1;
  const post = (i: number) => (i === sbPos ? SB : i === bbPos ? BB : 0);
  const live = (i: number) => (i === bbPos ? S - A : S); // 可投入的筹码（含已下的盲注）
  const dead0 = A + SB + BB;

  // P(对手是 c | 我是 h)
  const cond = new Float64Array(H * H);
  for (let h = 0; h < H; h++) {
    const tot = HAND_CLASSES[h].combos * 1225;
    for (let c = 0; c < H; c++) cond[h * H + c] = compat[h * H + c] / tot;
  }
  const prior = HAND_CLASSES.map((h) => h.combos / 1326);

  const push: Float64Array[] = Array.from({ length: N - 1 }, () => new Float64Array(H).fill(0.5));
  const call: Float64Array[][] = Array.from({ length: N - 1 }, (_, p) =>
    Array.from({ length: N }, (_, j) => (j > p ? new Float64Array(H).fill(0.3) : new Float64Array(0))),
  );

  const matched = (p: number, j: number) => Math.min(live(p), live(j));
  const potOf = (p: number, j: number) => {
    let others = A;
    if (sbPos !== p && sbPos !== j) others += SB;
    if (bbPos !== p && bbPos !== j) others += BB;
    return others + 2 * matched(p, j);
  };

  const pushEVs = Array.from({ length: N - 1 }, () => new Float64Array(H));
  const callEVs = Array.from({ length: N - 1 }, (_, p) => Array.from({ length: N }, (_, j) => new Float64Array(j > p ? H : 0)));

  const computePushEV = (p: number) => {
    const out = pushEVs[p];
    for (let h = 0; h < H; h++) {
      let survive = 1;
      let ev = 0;
      for (let j = p + 1; j < N; j++) {
        const cs = call[p][j];
        let callP = 0;
        let eqC = 0;
        const base = h * H;
        for (let c = 0; c < H; c++) {
          const w = cond[base + c] * cs[c];
          if (w === 0) continue;
          callP += w;
          eqC += w * eq[base + c];
        }
        const m = matched(p, j);
        ev += survive * (eqC * potOf(p, j) - callP * (m - post(p)));
        survive *= 1 - callP;
      }
      ev += survive * (dead0 - post(p));
      out[h] = ev;
    }
  };

  const computeCallEV = (p: number, j: number) => {
    const out = callEVs[p][j];
    const ps = push[p];
    const pot = potOf(p, j);
    const cost = matched(p, j) - post(j);
    for (let c = 0; c < H; c++) {
      let mass = 0;
      let eqSum = 0;
      const base = c * H;
      for (let h = 0; h < H; h++) {
        const w = cond[base + h] * ps[h];
        if (w === 0) continue;
        mass += w;
        eqSum += w * eq[base + h]; // eq[c][h]：跟注者的胜率
      }
      out[c] = mass > 1e-12 ? (eqSum / mass) * pot - cost : -cost;
    }
  };

  let t = 0;
  for (t = 1; t <= iters; t++) {
    const lr = 1 / (t + 1);
    // 先更新跟注策略，再更新全下策略（Gauss-Seidel 式的虚拟博弈）
    for (let p = 0; p < N - 1; p++)
      for (let j = p + 1; j < N; j++) {
        computeCallEV(p, j);
        const cs = call[p][j];
        const ev = callEVs[p][j];
        for (let c = 0; c < H; c++) cs[c] += ((ev[c] > 0 ? 1 : 0) - cs[c]) * lr;
      }
    for (let p = 0; p < N - 1; p++) {
      computePushEV(p);
      const ps = push[p];
      const ev = pushEVs[p];
      for (let h = 0; h < H; h++) ps[h] += ((ev[h] > 0 ? 1 : 0) - ps[h]) * lr;
    }
  }

  // 收敛指标：针对平均策略的最优反应收益
  let expl = 0;
  for (let p = 0; p < N - 1; p++) {
    computePushEV(p);
    let gain = 0;
    for (let h = 0; h < H; h++) {
      const ev = pushEVs[p][h];
      gain += prior[h] * (Math.max(ev, 0) - push[p][h] * ev);
    }
    expl = Math.max(expl, gain);
    for (let j = p + 1; j < N; j++) {
      computeCallEV(p, j);
      let g = 0;
      let mass = 0;
      for (let c = 0; c < H; c++) {
        // 跟注者手牌的边际分布（近似用先验 × 对手全下的概率）
        let m = 0;
        for (let h = 0; h < H; h++) m += cond[c * H + h] * push[p][h];
        const w = prior[c] * m;
        mass += w;
        const ev = callEVs[p][j][c];
        g += w * (Math.max(ev, 0) - call[p][j][c] * ev);
      }
      if (mass > 0) expl = Math.max(expl, g / mass); // 以"面对这次全下"为条件
    }
  }

  const round = (a: Float64Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
  return {
    players: N,
    stack: S,
    ante: A,
    push: push.map(round),
    call: call.map((row) => row.map(round)),
    pushEV: pushEVs.map((a) => Array.from(a, (v) => Math.round(v * 1000) / 1000)),
    callEV: callEVs.map((row) => row.map((a) => Array.from(a, (v) => Math.round(v * 1000) / 1000))),
    exploitability: expl,
    iterations: t - 1,
  };
}
