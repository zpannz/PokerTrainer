// AI 对手的风格参数
export type StyleId = 'nit' | 'tag' | 'lag' | 'station' | 'gto';

export interface Style {
  id: StyleId;
  name: string;
  short: string;
  desc: string;
  /** 6 人桌 / 9 人桌的目标 VPIP、PFR（%），用于显示和测试 */
  target: { 6: { vpip: [number, number]; pfr: [number, number] }; 9: { vpip: [number, number]; pfr: [number, number] } };
  pre: {
    /** 继续（加注 + 跟注）的组合数相对范围库的倍数 */
    widen: number;
    /** 加注占继续部分的比例相对范围库的倍数 */
    raiseMult: number;
    /** 范围库外新加入的手牌中加注的比例 */
    newRaise: number;
    /** 首先入池时溜入（limp）代替加注的比例 */
    limp: number;
    /** 全下/弃牌表的宽紧倍数 */
    push: number;
    /** 面对全下时跟注范围的宽紧倍数 */
    callShove: number;
    /** 无范围表可查时（多人底池、4-bet 以上等）的宽紧倍数 */
    loose: number;
    /** 无范围表时的攻击性（0~1） */
    aggr: number;
  };
  post: {
    /** 价值下注的胜率门槛（单挑） */
    valueEq: number;
    /** 无人下注时诈唬的概率 */
    bluff: number;
    /** 翻前加注者在翻牌圈持续下注的额外概率 */
    cbet: number;
    /** 面对下注时，判断跟注所用胜率的加成（跟注站为正） */
    callAdj: number;
    /** 加注价值的胜率门槛 */
    raiseEq: number;
    /** 半诈唬加注的概率 */
    raiseBluff: number;
    /** 下注尺寸（底池比例）候选 */
    sizes: number[];
    /** 匹配到预计算求解结果时：把弃牌改为跟注的比例（跟注站）、把下注/加注改为过牌/跟注的比例（紧弱） */
    solverFoldToCall: number;
    solverPassive: number;
  };
}

export const STYLES: Record<StyleId, Style> = {
  nit: {
    id: 'nit',
    name: '紧弱',
    short: '紧弱',
    desc: '只玩强牌，翻后被动、容易弃牌，很少诈唬',
    target: { 6: { vpip: [9, 17], pfr: [5, 13] }, 9: { vpip: [7, 15], pfr: [4, 11] } },
    pre: { widen: 0.6, raiseMult: 0.9, newRaise: 0.2, limp: 0, push: 0.65, callShove: 0.7, loose: 0.6, aggr: 0.3 },
    post: { valueEq: 0.7, bluff: 0.04, cbet: 0.12, callAdj: -0.06, raiseEq: 0.85, raiseBluff: 0, sizes: [0.5], solverFoldToCall: 0, solverPassive: 0.5 },
  },
  tag: {
    id: 'tag',
    name: '紧凶',
    short: '紧凶',
    desc: '范围偏紧，入池多以加注，翻后积极下注',
    target: { 6: { vpip: [16, 25], pfr: [13, 22] }, 9: { vpip: [12, 21], pfr: [10, 18] } },
    pre: { widen: 0.92, raiseMult: 1.15, newRaise: 0.6, limp: 0, push: 0.95, callShove: 0.95, loose: 0.9, aggr: 0.7 },
    post: { valueEq: 0.6, bluff: 0.14, cbet: 0.35, callAdj: 0, raiseEq: 0.76, raiseBluff: 0.04, sizes: [0.5, 0.75], solverFoldToCall: 0, solverPassive: 0 },
  },
  lag: {
    id: 'lag',
    name: '松凶',
    short: '松凶',
    desc: '入池多、3-bet 多，翻后经常下注和诈唬',
    target: { 6: { vpip: [27, 40], pfr: [21, 34] }, 9: { vpip: [19, 32], pfr: [15, 28] } },
    pre: { widen: 1.45, raiseMult: 1.35, newRaise: 0.7, limp: 0, push: 1.25, callShove: 1.15, loose: 1.4, aggr: 0.85 },
    post: { valueEq: 0.55, bluff: 0.28, cbet: 0.45, callAdj: 0.03, raiseEq: 0.68, raiseBluff: 0.1, sizes: [0.5, 0.75, 1], solverFoldToCall: 0.1, solverPassive: 0 },
  },
  station: {
    id: 'station',
    name: '跟注站',
    short: '跟注站',
    desc: '入池很多但很少加注，翻后什么都跟，很少主动下注',
    target: { 6: { vpip: [35, 60], pfr: [1, 9] }, 9: { vpip: [30, 55], pfr: [1, 8] } },
    pre: { widen: 2.1, raiseMult: 0.2, newRaise: 0.03, limp: 0.92, push: 1.1, callShove: 1.5, loose: 2.2, aggr: 0.1 },
    post: { valueEq: 0.72, bluff: 0.03, cbet: 0.05, callAdj: 0.16, raiseEq: 0.9, raiseBluff: 0, sizes: [0.5], solverFoldToCall: 0.6, solverPassive: 0.6 },
  },
  gto: {
    id: 'gto',
    name: 'GTO 型',
    short: 'GTO',
    desc: '翻前按范围库，翻后有预计算结果时按求解结果，否则按均衡化的胜率/赔率决策',
    target: { 6: { vpip: [17, 28], pfr: [11, 22] }, 9: { vpip: [12, 23], pfr: [8, 19] } },
    pre: { widen: 1, raiseMult: 1, newRaise: 0.4, limp: 0, push: 1, callShove: 1, loose: 1, aggr: 0.6 },
    post: { valueEq: 0.6, bluff: 0.17, cbet: 0.3, callAdj: 0, raiseEq: 0.75, raiseBluff: 0.06, sizes: [0.33, 0.66, 1], solverFoldToCall: 0, solverPassive: 0 },
  },
};

export const STYLE_IDS: StyleId[] = ['nit', 'tag', 'lag', 'station', 'gto'];

/** 对手风格组合预设 */
export const STYLE_MIXES: { id: string; name: string; styles: StyleId[] }[] = [
  { id: 'mixed', name: '混合（各种风格都有）', styles: ['tag', 'station', 'lag', 'nit', 'gto', 'tag', 'station', 'lag'] },
  { id: 'soft', name: '软桌（跟注站、紧弱居多）', styles: ['station', 'nit', 'station', 'tag', 'nit', 'station', 'lag', 'station'] },
  { id: 'tough', name: '强桌（GTO 型、紧凶居多）', styles: ['gto', 'tag', 'gto', 'lag', 'tag', 'gto', 'tag', 'gto'] },
  { id: 'aggro', name: '激进桌（松凶居多）', styles: ['lag', 'lag', 'tag', 'lag', 'gto', 'lag', 'station', 'lag'] },
  { id: 'gto', name: '全部 GTO 型', styles: ['gto', 'gto', 'gto', 'gto', 'gto', 'gto', 'gto', 'gto'] },
];
