// 翻后求解相关的数据类型
// 筹码单位：求解器内部使用整数筹码，1bb = CHIPS_PER_BB

export const CHIPS_PER_BB = 100;

export interface StreetSizes {
  bet: string; // 例如 "33%, 75%"
  raise: string; // 例如 "3x"
}

export interface PlayerSizes {
  flop: StreetSizes;
  turn: StreetSizes;
  river: StreetSizes;
}

/** 传给 Rust 的配置（与 solver/core/src/lib.rs 的 SolveConfig 对应） */
export interface SolveConfig {
  ranges: [string, string]; // [OOP, IP]
  board: string; // "Ah7d2c"
  pot: number; // 筹码
  stack: number; // 筹码
  sizes: [PlayerSizes, PlayerSizes];
  /** 每条街最多加注次数（不含首次下注）[翻牌, 转牌, 河牌] */
  raiseCap?: [number, number, number];
  /** OOP 在转牌/河牌领先下注（donk）的尺寸，空 = 与普通下注尺寸相同 */
  donkTurn?: string;
  donkRiver?: string;
  addAllinThreshold?: number;
  forceAllinThreshold?: number;
  mergingThreshold?: number;
}

export interface GameInfo {
  hands: [string[], string[]];
  memory: [number, number]; // 字节：[32 位, 16 位压缩]
}

export type NodeKind = 'player' | 'chance' | 'terminal';

/** 一个节点的数据（与 Rust 的 NodeData 对应） */
export interface NodeData {
  kind: NodeKind;
  player: number; // 0 = OOP, 1 = IP
  history: number[];
  board: string[];
  pot: number;
  bets: [number, number];
  actions: string[]; // "X" "C" "F" "B330" "R990" "A9750"
  cards: string[]; // 发牌节点可发的牌
  weights: [number[], number[]];
  normWeights: [number[], number[]];
  equity: [number[], number[]];
  ev: [number[], number[]];
  strategy: number[]; // 动作 × 手牌
  actionEv: number[]; // 动作 × 手牌
}

/** 求解结果（缓存到 IndexedDB / 预计算文件的格式） */
export interface SolvedSpot {
  key: string;
  title: string;
  config: SolveConfig;
  hands: [string[], string[]];
  /** key = history.join(',')（发牌节点之后的数字为求解器的牌编号，见 solverCardId） */
  nodes: Record<string, NodeData>;
  exploitability: number; // 筹码
  iterations: number;
  seconds: number;
  memoryMB: number;
  compressed: boolean;
  created: number;
  /** 预计算数据的场景 id（如 "cash6-100/BTN-BB"） */
  scenario?: string;
  /** 每位玩家的标签 */
  players?: [string, string];
}

/** 求解器里的牌编号（postflop-solver：4 × 点数 + 花色，花色 c=0 d=1 h=2 s=3） */
export function solverCardId(card: string): number {
  const r = '23456789TJQKA'.indexOf(card[0].toUpperCase());
  const s = 'cdhs'.indexOf(card[1].toLowerCase());
  if (r < 0 || s < 0) throw new Error(`无效的牌: ${card}`);
  return r * 4 + s;
}

export interface ActionInfo {
  code: string;
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  amount: number; // 下注/加注到的总额（本街，筹码）
}

export function parseAction(code: string): ActionInfo {
  const t = code[0];
  const amount = Number(code.slice(1)) || 0;
  if (t === 'F') return { code, kind: 'fold', amount: 0 };
  if (t === 'X') return { code, kind: 'check', amount: 0 };
  if (t === 'C') return { code, kind: 'call', amount: 0 };
  if (t === 'B') return { code, kind: 'bet', amount };
  if (t === 'R') return { code, kind: 'raise', amount };
  return { code, kind: 'allin', amount };
}

export const bb = (chips: number) => chips / CHIPS_PER_BB;
export const fmtBB = (chips: number, digits = 1) => `${(chips / CHIPS_PER_BB).toFixed(digits).replace(/\.0+$/, '')}bb`;

/** 动作的中文说明。potBefore：本街开始前的底池；streetBet：行动方在本街已投入；facing：要跟的额度 */
export function actionLabel(code: string, node: Pick<NodeData, 'pot' | 'bets' | 'player'>, streetStartPot: number): string {
  const a = parseAction(code);
  switch (a.kind) {
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return `跟注 ${fmtBB(Math.abs(node.bets[0] - node.bets[1]))}`;
    case 'bet': {
      const pct = Math.round((a.amount / node.pot) * 100);
      return `下注 ${fmtBB(a.amount)}（${pct}% 底池）`;
    }
    case 'raise': {
      // 加注到本街 a.amount；streetStartPot 用于估算
      void streetStartPot;
      return `加注到 ${fmtBB(a.amount)}`;
    }
    case 'allin':
      return `全下 ${fmtBB(a.amount)}`;
  }
}

export function historyKey(h: (number | string)[]): string {
  return h.join(',');
}
