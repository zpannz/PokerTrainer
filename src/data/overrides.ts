// 用户自定义范围（覆盖默认数据），保存在浏览器本地
import type { ActionKey } from '../lib/formats.ts';
import { load, save } from '../lib/storage.ts';
import { NUM_CLASSES } from '../lib/hands.ts';
import { type Chart, getChart } from './charts.ts';

export interface OverrideData {
  freq: Partial<Record<ActionKey, number[]>>;
  updated: number;
  note?: string;
}

const KEY = 'overrides';
let cache: Record<string, OverrideData> | null = null;

function all(): Record<string, OverrideData> {
  if (!cache) cache = load<Record<string, OverrideData>>(KEY, {});
  return cache;
}

export function getOverride(id: string): OverrideData | undefined {
  return all()[id];
}

export function setOverride(id: string, freq: Partial<Record<ActionKey, Float64Array | number[]>>, note?: string): void {
  const data: OverrideData = { freq: {}, updated: Date.now(), note };
  for (const [a, arr] of Object.entries(freq)) data.freq[a as ActionKey] = Array.from(arr as ArrayLike<number>, (v) => Math.round(v * 1000) / 1000);
  all()[id] = data;
  save(KEY, all());
}

export function clearOverride(id: string): void {
  delete all()[id];
  save(KEY, all());
}

export function listOverrides(): string[] {
  return Object.keys(all());
}

export function resetOverrideCache(): void {
  cache = null;
}

/** 实际使用的范围表：有自定义时用自定义，否则用默认 */
export function effectiveChart(id: string): Chart {
  const base = getChart(id);
  const ov = getOverride(id);
  if (!ov) return base;
  const freq: Chart['freq'] = {};
  for (const a of base.actions) freq[a] = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    let sum = 0;
    for (const a of base.actions) {
      if (a === 'fold') continue;
      const v = ov.freq[a]?.[h] ?? 0;
      freq[a]![h] = v;
      sum += v;
    }
    if (sum > 1) for (const a of base.actions) if (a !== 'fold') freq[a]![h] /= sum;
    freq.fold![h] = Math.max(0, 1 - Math.min(1, sum));
  }
  return {
    ...base,
    freq,
    ev: undefined,
    source: { kind: 'custom', note: `你在 ${new Date(ov.updated).toLocaleString('zh-CN')} 修改/导入的范围，已替换默认数据（默认来源：${base.source.note}）` },
  };
}
