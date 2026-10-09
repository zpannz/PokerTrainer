// 牌局格式、位置与场景定义
export type GameType = 'cash' | 'mtt';
export type Position = 'UTG' | 'UTG1' | 'UTG2' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

export const POSITIONS_6: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
export const POSITIONS_9: Position[] = ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const POSITION_NAMES: Record<Position, string> = {
  UTG: '枪口位 (UTG)',
  UTG1: '枪口+1 (UTG+1)',
  UTG2: '中位 (UTG+2 / MP)',
  LJ: '低位 (LJ, Lojack)',
  HJ: '劫持位 (HJ, Hijack)',
  CO: '关煞位 (CO, Cutoff)',
  BTN: '按钮位 (BTN, Button)',
  SB: '小盲位 (SB, Small Blind)',
  BB: '大盲位 (BB, Big Blind)',
};

export const POSITION_SHORT: Record<Position, string> = {
  UTG: 'UTG',
  UTG1: 'UTG+1',
  UTG2: 'MP',
  LJ: 'LJ',
  HJ: 'HJ',
  CO: 'CO',
  BTN: 'BTN',
  SB: 'SB',
  BB: 'BB',
};

export const MTT_DEPTHS = [5, 8, 10, 12, 15, 20, 25, 30, 40, 60] as const;
export const PUSHFOLD_MAX_DEPTH = 20;
/** 有"开池 vs 再全下"精确计算表的深度 */
export const RESHOVE_DEPTHS = [15, 20, 25, 30] as const;
/** 有"跟注全下"精确计算表的深度（≤20 为全下/弃牌格式；25bb 额外提供） */
export const CALLSHOVE_DEPTHS = [5, 8, 10, 12, 15, 20, 25] as const;

export interface Format {
  id: string;
  game: GameType;
  players: 6 | 9;
  depth: number; // 有效筹码（bb）
  ante: number; // 大盲前注（bb），由大盲支付；现金局为 0
  label: string;
}

export function makeFormat(game: GameType, players: 6 | 9, depth: number): Format {
  const id = `${game}${players}-${depth}`;
  const ante = game === 'mtt' ? 1 : 0;
  const label =
    game === 'cash'
      ? `${players} 人桌现金局 ${depth}bb`
      : `${players} 人桌锦标赛 ${depth}bb（大盲前注 1bb）`;
  return { id, game, players, depth, ante, label };
}

export function parseFormatId(id: string): Format {
  const m = /^(cash|mtt)(6|9)-(\d+)$/.exec(id);
  if (!m) return makeFormat('cash', 6, 100);
  return makeFormat(m[1] as GameType, Number(m[2]) as 6 | 9, Number(m[3]));
}

export function allFormats(): Format[] {
  const out = [makeFormat('cash', 6, 100), makeFormat('cash', 9, 100)];
  for (const p of [6, 9] as const) for (const d of MTT_DEPTHS) out.push(makeFormat('mtt', p, d));
  return out;
}

export const positionsOf = (f: Format): Position[] => (f.players === 6 ? POSITIONS_6 : POSITIONS_9);
export const isPushFold = (f: Format): boolean => f.game === 'mtt' && f.depth <= PUSHFOLD_MAX_DEPTH;

/** 开池加注尺度（bb） */
export function openSize(f: Format, pos: Position): number {
  if (f.game === 'cash') return pos === 'SB' ? 3 : 2.5;
  if (pos === 'SB') return f.depth <= 30 ? 2.5 : 3;
  return f.depth <= 30 ? 2 : 2.2;
}

/** 3-bet 尺度（总下注额，bb）；返回 null 表示 3-bet 即全下 */
export function threeBetSize(f: Format, opener: Position, hero: Position): number | null {
  if (f.game === 'mtt' && f.depth <= 25) return null;
  const o = openSize(f, opener);
  const oop = hero === 'SB' || hero === 'BB';
  const mult = f.game === 'cash' ? (oop ? 4 : 3.2) : oop ? 3.8 : 3;
  return Math.round(o * mult * 10) / 10;
}

/** 4-bet 尺度；null 表示 4-bet 即全下 */
export function fourBetSize(f: Format, threeBet: number): number | null {
  if (f.game === 'mtt' && f.depth <= 40) return null;
  return Math.round(threeBet * 2.25 * 10) / 10;
}

// ---- 场景 ----
export type SpotType = 'rfi' | 'vsOpen' | 'vs3bet' | 'push' | 'vsShove' | 'reshove' | 'vsReshove';
export type ActionKey = 'fold' | 'call' | 'raise' | 'allin';

export const SPOT_TYPE_NAMES: Record<SpotType, string> = {
  rfi: '开池 (RFI, Raise First In)',
  vsOpen: '面对加注 (vs Open)',
  vs3bet: '面对 3-bet (vs 3-bet)',
  push: '全下/弃牌 (Push/Fold)',
  vsShove: '面对全下 (Call vs Shove)',
  reshove: '面对开池再全下 (Reshove)',
  vsReshove: '开池后面对再全下 (Call vs Reshove)',
};

export const hasReshove = (f: Format): boolean => f.game === 'mtt' && (RESHOVE_DEPTHS as readonly number[]).includes(f.depth);

/** 训练/范围库中使用的场景分类 */
export type SpotCategory = 'rfi' | 'vsOpen' | 'bbDefense' | 'sbStrategy' | 'vs3bet' | 'push' | 'vsShove' | 'reshove';
export const CATEGORY_NAMES: Record<SpotCategory, string> = {
  rfi: '开池 (RFI)',
  vsOpen: '面对加注 (vs Open)',
  bbDefense: '大盲防守 (BB Defense)',
  sbStrategy: '小盲策略 (SB Strategy)',
  vs3bet: '面对 3-bet (vs 3-bet)',
  push: '全下/弃牌 (Push/Fold)',
  vsShove: '面对全下 (Call vs Shove)',
  reshove: '开池 vs 再全下 (Reshove)',
};

export interface Spot {
  id: string; // `${formatId}/${type}/${hero}/${villain}`
  format: Format;
  type: SpotType;
  hero: Position;
  villain?: Position; // vsOpen：开池者；vs3bet：3-bet 者；vsShove：全下者
}

export function spotId(formatId: string, type: SpotType, hero: Position, villain?: Position): string {
  return `${formatId}/${type}/${hero}/${villain ?? ''}`;
}

export function parseSpotId(id: string): Spot {
  const [fid, type, hero, villain] = id.split('/');
  return { id, format: parseFormatId(fid), type: type as SpotType, hero: hero as Position, villain: (villain || undefined) as Position | undefined };
}

/** 一个场景属于哪些分类（小盲/大盲场景同时属于对应的专项分类） */
export function spotCategories(s: Spot): SpotCategory[] {
  const out: SpotCategory[] = [];
  if (s.type === 'rfi') out.push(s.hero === 'SB' ? 'sbStrategy' : 'rfi');
  if (s.type === 'push') out.push(s.hero === 'SB' ? 'sbStrategy' : 'push');
  if (s.type === 'vsOpen') out.push(s.hero === 'BB' ? 'bbDefense' : s.hero === 'SB' ? 'sbStrategy' : 'vsOpen');
  if (s.type === 'vsShove') out.push(s.hero === 'BB' ? 'bbDefense' : s.hero === 'SB' ? 'sbStrategy' : 'vsShove');
  if (s.type === 'vs3bet') out.push('vs3bet');
  if (s.type === 'reshove' || s.type === 'vsReshove') out.push('reshove');
  return out;
}

/** 某个格式下所有场景 */
export function spotsOf(f: Format): Spot[] {
  const pos = positionsOf(f);
  const out: Spot[] = [];
  const mk = (type: SpotType, hero: Position, villain?: Position) => out.push({ id: spotId(f.id, type, hero, villain), format: f, type, hero, villain });
  const reshove = () => {
    if (!hasReshove(f)) return;
    for (let i = 0; i < pos.length - 1; i++) for (let j = i + 1; j < pos.length; j++) mk('reshove', pos[j], pos[i]);
    for (let i = 0; i < pos.length - 1; i++) for (let j = i + 1; j < pos.length; j++) mk('vsReshove', pos[i], pos[j]);
  };
  if (isPushFold(f)) {
    for (let i = 0; i < pos.length - 1; i++) mk('push', pos[i]);
    for (let i = 0; i < pos.length - 1; i++) for (let j = i + 1; j < pos.length; j++) mk('vsShove', pos[j], pos[i]);
    reshove();
    return out;
  }
  for (let i = 0; i < pos.length - 1; i++) mk('rfi', pos[i]);
  for (let i = 0; i < pos.length - 1; i++) for (let j = i + 1; j < pos.length; j++) mk('vsOpen', pos[j], pos[i]);
  // 3-bet 即全下的深度，"面对 3-bet"由精确计算的"开池后面对再全下"代替
  if (!(hasReshove(f) && threeBetSize(f, pos[0], pos[pos.length - 1]) === null))
    for (let i = 0; i < pos.length - 1; i++) for (let j = i + 1; j < pos.length; j++) mk('vs3bet', pos[i], pos[j]);
  if ((CALLSHOVE_DEPTHS as readonly number[]).includes(f.depth) && f.game === 'mtt')
    for (let i = 0; i < pos.length - 1; i++) for (let j = i + 1; j < pos.length; j++) mk('vsShove', pos[j], pos[i]);
  reshove();
  return out;
}

export function actionLabel(spot: Spot, a: ActionKey): string {
  switch (a) {
    case 'fold':
      return '弃牌 (Fold)';
    case 'call':
      return spot.type === 'vsShove' || spot.type === 'vsReshove' || (spot.type === 'vs3bet' && spot.format.game === 'mtt' && spot.format.depth <= 25) ? '跟注全下 (Call)' : '跟注 (Call)';
    case 'allin':
      return spot.type === 'reshove' ? '再全下 (Reshove)' : '全下 (All-in)';
    case 'raise':
      if (spot.type === 'rfi') return '加注 (Open Raise)';
      if (spot.type === 'vsOpen') return '3-bet';
      return '4-bet';
  }
}

export const ACTION_HOTKEYS: Record<ActionKey, string> = { fold: 'F', call: 'C', raise: 'R', allin: 'A' };

export function describeSpot(s: Spot): string {
  const P = (p?: Position) => (p ? POSITION_SHORT[p] : '');
  const f = s.format;
  switch (s.type) {
    case 'rfi':
      return `前面所有人弃牌，你在 ${P(s.hero)} 首先入池`;
    case 'push':
      return `前面所有人弃牌，你在 ${P(s.hero)}，只能全下或弃牌`;
    case 'vsOpen': {
      const o = openSize(f, s.villain!);
      return `${P(s.villain)} 加注到 ${o}bb，其余弃牌，你在 ${P(s.hero)}`;
    }
    case 'vs3bet': {
      const o = openSize(f, s.hero);
      const t = threeBetSize(f, s.hero, s.villain!);
      return `你在 ${P(s.hero)} 加注到 ${o}bb，${P(s.villain)} ${t === null ? '全下' : `3-bet 到 ${t}bb`}，其余弃牌`;
    }
    case 'vsShove':
      return `${P(s.villain)} 全下 ${f.depth}bb，其余弃牌，你在 ${P(s.hero)}`;
    case 'reshove':
      return `${P(s.villain)} 加注到 ${openSize(f, s.villain!)}bb，其余弃牌，你在 ${P(s.hero)}（只考虑再全下或弃牌）`;
    case 'vsReshove':
      return `你在 ${P(s.hero)} 加注到 ${openSize(f, s.hero)}bb，${P(s.villain)} 全下 ${f.depth}bb，其余弃牌`;
  }
}

export function spotTitle(s: Spot): string {
  const P = (p?: Position) => (p ? POSITION_SHORT[p] : '');
  switch (s.type) {
    case 'rfi':
      return `${P(s.hero)} 开池`;
    case 'push':
      return `${P(s.hero)} 全下/弃牌`;
    case 'vsOpen':
      return `${P(s.hero)} 面对 ${P(s.villain)} 开池`;
    case 'vs3bet':
      return `${P(s.hero)} 开池，面对 ${P(s.villain)} 3-bet`;
    case 'vsShove':
      return `${P(s.hero)} 面对 ${P(s.villain)} 全下`;
    case 'reshove':
      return `${P(s.hero)} 对 ${P(s.villain)} 开池再全下`;
    case 'vsReshove':
      return `${P(s.hero)} 开池，面对 ${P(s.villain)} 再全下`;
  }
}

const CATEGORY_ORDER: SpotCategory[] = ['rfi', 'push', 'vsOpen', 'vsShove', 'bbDefense', 'sbStrategy', 'vs3bet', 'reshove'];
/** 某个格式下实际存在的场景分类（按固定顺序） */
export function categoriesOf(f: Format): SpotCategory[] {
  const set = new Set(spotsOf(f).flatMap(spotCategories));
  return CATEGORY_ORDER.filter((c) => set.has(c));
}
