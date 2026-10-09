// 下注尺寸预设
//
// 内存参考（BTN 开池 vs BB 跟注，100bb，翻牌 Qs8h3d，双方各约 650 个组合）：
//   快速 ≈ 0.9GB（16 位压缩 ≈ 0.47GB）；标准 ≈ 1.5GB（压缩 ≈ 0.78GB）；多尺寸 ≈ 5GB（压缩 ≈ 2.6GB）
// 不限制加注次数时，"加注-再加注"链条会让博弈树膨胀到几十 GB，所以每条街都设了加注次数上限。
import type { PlayerSizes, SolveConfig } from './types.ts';

export interface SizePreset {
  id: string;
  name: string;
  desc: string;
  oop: PlayerSizes;
  ip: PlayerSizes;
  raiseCap: [number, number, number];
}

function mk(flopIP: string, turn: string, river: string, raise: string): { oop: PlayerSizes; ip: PlayerSizes } {
  const ip: PlayerSizes = { flop: { bet: flopIP, raise }, turn: { bet: turn, raise }, river: { bet: river, raise } };
  // OOP 翻牌圈不领先下注（只过牌/过牌加注），转牌、河牌与 IP 使用相同尺寸
  const oop: PlayerSizes = { flop: { bet: '', raise }, turn: { bet: turn, raise }, river: { bet: river, raise } };
  return { oop, ip };
}

export const SIZE_PRESETS: SizePreset[] = [
  {
    id: 'simple',
    name: '快速（单一尺寸）',
    desc: '翻牌 33%，转牌 66%，河牌 75%，加注 3 倍；翻牌圈可以加注 1 次，转牌/河牌不加注。典型翻牌约 1~2 分钟、约 0.5~0.9GB 内存。',
    ...mk('33%', '66%', '75%', '3x'),
    raiseCap: [1, 0, 0],
  },
  {
    id: 'standard',
    name: '标准（翻牌两种尺寸）',
    desc: '翻牌 33%/75%，转牌 66%，河牌 75%，加注 3 倍；翻牌圈可加注 1 次。与预计算牌面库使用同一套尺寸。典型翻牌约 2~4 分钟、约 0.8~1.5GB 内存。',
    ...mk('33%, 75%', '66%', '75%', '3x'),
    raiseCap: [1, 0, 0],
  },
  {
    id: 'deep',
    name: '多尺寸（只适合窄范围/转牌以后）',
    desc: '翻牌 33%/75%，转牌 50%/100%，河牌 50%/100%，河牌可加注 1 次。完整翻牌局面通常需要 3~5GB，超出浏览器上限；适合 3-bet 底池、窄范围或从转牌/河牌开始求解。',
    ...mk('33%, 75%', '50%, 100%', '50%, 100%', '3x'),
    raiseCap: [1, 0, 1],
  },
];

/** 预计算牌面库使用的尺寸（= 标准预设） */
export function precomputePreset(): SizePreset {
  return SIZE_PRESETS.find((x) => x.id === 'standard')!;
}

export function applyPreset(cfg: SolveConfig, preset: SizePreset): SolveConfig {
  return { ...cfg, sizes: [structuredClone(preset.oop), structuredClone(preset.ip)], raiseCap: [...preset.raiseCap], donkTurn: '', donkRiver: '' };
}
