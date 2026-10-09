// 由翻前范围库生成翻后局面的双方范围、底池和有效筹码
import { type Format, type Position, POSITION_SHORT, openSize, parseFormatId, positionsOf, spotId, threeBetSize } from '../lib/formats.ts';
import { NUM_CLASSES, rangeCombos } from '../lib/hands.ts';
import { formatRange } from '../lib/rangeText.ts';
import { effectiveChart } from '../data/overrides.ts';
import { CHIPS_PER_BB } from './types.ts';

export type PotType = 'srp' | '3bp';

export interface Scenario {
  id: string; // 例如 "cash6-100/srp/BTN/BB"
  format: Format;
  type: PotType;
  /** 翻前加注者（单挑底池中的开池者；3-bet 底池中的 3-bet 者） */
  aggressor: Position;
  caller: Position;
  oop: Position;
  ip: Position;
  title: string;
  potBB: number;
  stackBB: number;
}

/** 翻后谁先行动：盲注最先，其余按座位顺序 */
function postflopOrder(f: Format, p: Position): number {
  if (p === 'SB') return -2;
  if (p === 'BB') return -1;
  return positionsOf(f).indexOf(p);
}

export function makeScenario(formatId: string, type: PotType, opener: Position, other: Position): Scenario {
  const f = parseFormatId(formatId);
  const pos = positionsOf(f);
  if (pos.indexOf(opener) >= pos.indexOf(other)) throw new Error('开池者必须在另一位玩家之前行动');
  const open = openSize(f, opener);
  let invested: number;
  let aggressor: Position;
  let caller: Position;
  if (type === 'srp') {
    invested = open;
    aggressor = opener;
    caller = other;
  } else {
    const t = threeBetSize(f, opener, other);
    if (t === null) throw new Error('该筹码深度下 3-bet 即全下，没有翻后');
    invested = t;
    aggressor = other;
    caller = opener;
  }
  const inHand = (x: Position) => x === opener || x === other;
  const dead = (inHand('SB') ? 0 : 0.5) + (inHand('BB') ? 0 : 1) + f.ante;
  const potBB = Math.round((invested * 2 + dead) * 100) / 100;
  // 锦标赛前注由大盲支付：大盲在局中时有效筹码再少 1 个前注
  const stackBB = Math.round((f.depth - invested - (inHand('BB') ? f.ante : 0)) * 100) / 100;
  const [oop, ip] = postflopOrder(f, opener) < postflopOrder(f, other) ? [opener, other] : [other, opener];
  const P = (x: Position) => POSITION_SHORT[x];
  const title = type === 'srp' ? `${P(opener)} 开池 vs ${P(other)} 跟注` : `${P(opener)} 开池，${P(other)} 3-bet，${P(opener)} 跟注`;
  return { id: `${f.id}/${type}/${opener}/${other}`, format: f, type, aggressor, caller, oop, ip, title, potBB, stackBB };
}

export function parseScenarioId(id: string): Scenario {
  const [fid, type, a, b] = id.split('/');
  return makeScenario(fid, type as PotType, a as Position, b as Position);
}

/** 某位玩家在这个局面下的翻前范围（169 类别权重） */
export function scenarioRange(s: Scenario, who: Position): Float64Array {
  const f = s.format;
  const opener = s.type === 'srp' ? s.aggressor : s.caller;
  const other = s.type === 'srp' ? s.caller : s.aggressor;
  const out = new Float64Array(NUM_CLASSES);
  if (s.type === 'srp') {
    if (who === opener) {
      const c = effectiveChart(spotId(f.id, 'rfi', opener));
      out.set(c.freq.raise!);
    } else {
      const c = effectiveChart(spotId(f.id, 'vsOpen', other, opener));
      out.set(c.freq.call!);
    }
  } else if (who === other) {
    const c = effectiveChart(spotId(f.id, 'vsOpen', other, opener));
    out.set(c.freq.raise ?? new Float64Array(NUM_CLASSES));
  } else {
    const c = effectiveChart(spotId(f.id, 'vs3bet', opener, other));
    for (let h = 0; h < NUM_CLASSES; h++) out[h] = c.prior[h] * (c.freq.call?.[h] ?? 0);
  }
  return out;
}

export interface ScenarioRanges {
  oop: string;
  ip: string;
  oopCombos: number;
  ipCombos: number;
}

export function scenarioRanges(s: Scenario): ScenarioRanges {
  const o = scenarioRange(s, s.oop);
  const i = scenarioRange(s, s.ip);
  return { oop: formatRange(o), ip: formatRange(i), oopCombos: rangeCombos(o), ipCombos: rangeCombos(i) };
}

/** 可选的预设局面（现金局 100bb） */
export function scenarioList(formatId: string): Scenario[] {
  const f = parseFormatId(formatId);
  const pos = positionsOf(f);
  const out: Scenario[] = [];
  for (let i = 0; i < pos.length - 1; i++)
    for (let j = i + 1; j < pos.length; j++) {
      try {
        out.push(makeScenario(f.id, 'srp', pos[i], pos[j]));
      } catch {
        /* 忽略 */
      }
    }
  for (let i = 0; i < pos.length - 1; i++)
    for (let j = i + 1; j < pos.length; j++) {
      try {
        out.push(makeScenario(f.id, '3bp', pos[i], pos[j]));
      } catch {
        /* 3-bet 即全下 */
      }
    }
  return out;
}

export const toChips = (bbv: number) => Math.round(bbv * CHIPS_PER_BB);
