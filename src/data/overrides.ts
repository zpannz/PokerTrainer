// 范围方案：在默认数据之外，可以有多套用户导入/修改的范围方案，并随时切换
// 每套方案只包含它覆盖的局面，其余局面沿用默认数据。保存在浏览器本地（localStorage）。
import type { ActionKey } from '../lib/formats.ts';
import { load, save, remove } from '../lib/storage.ts';
import { NUM_CLASSES } from '../lib/hands.ts';
import { type Chart, getChart } from './charts.ts';

export interface OverrideData {
  freq: Partial<Record<ActionKey, number[]>>;
  updated: number;
  note?: string;
}

export interface Scheme {
  id: string;
  name: string;
  /** 数据来源与可信度说明（导入时填写） */
  note: string;
  created: number;
  spots: Record<string, OverrideData>;
}

export const DEFAULT_SCHEME_ID = 'default';
export const DEFAULT_SCHEME_NAME = '默认数据（计算 + 整理 + 近似）';

const SCHEMES_KEY = 'schemes';
const ACTIVE_KEY = 'activeScheme';
const LEGACY_KEY = 'overrides';

let cache: Record<string, Scheme> | null = null;
let active: string | null = null;

function schemes(): Record<string, Scheme> {
  if (!cache) {
    cache = load<Record<string, Scheme>>(SCHEMES_KEY, {});
    // 迁移第一期的单一自定义层
    const legacy = load<Record<string, OverrideData> | null>(LEGACY_KEY, null);
    if (legacy && Object.keys(legacy).length > 0 && !cache.mine) {
      cache.mine = { id: 'mine', name: '我的修改', note: '第一期范围编辑器中修改/导入的范围', created: Date.now(), spots: legacy };
      save(SCHEMES_KEY, cache);
      save(ACTIVE_KEY, 'mine');
      remove(LEGACY_KEY);
    }
  }
  return cache;
}

function persist() {
  save(SCHEMES_KEY, schemes());
}

export function listSchemes(): Scheme[] {
  return Object.values(schemes()).sort((a, b) => a.created - b.created);
}

export function activeSchemeId(): string {
  if (active === null) {
    schemes();
    active = load<string>(ACTIVE_KEY, DEFAULT_SCHEME_ID);
    if (active !== DEFAULT_SCHEME_ID && !schemes()[active]) active = DEFAULT_SCHEME_ID;
  }
  return active;
}

export function activeScheme(): Scheme | null {
  const id = activeSchemeId();
  return id === DEFAULT_SCHEME_ID ? null : schemes()[id] ?? null;
}

export function activeSchemeName(): string {
  return activeScheme()?.name ?? DEFAULT_SCHEME_NAME;
}

export function setActiveScheme(id: string): void {
  active = id === DEFAULT_SCHEME_ID || schemes()[id] ? id : DEFAULT_SCHEME_ID;
  save(ACTIVE_KEY, active);
}

export function createScheme(name: string, note: string, spots: Record<string, OverrideData> = {}): Scheme {
  const all = schemes();
  let id = 's' + Date.now().toString(36);
  while (all[id]) id += 'x';
  const s: Scheme = { id, name: name.trim() || '未命名方案', note, created: Date.now(), spots };
  all[id] = s;
  persist();
  return s;
}

export function renameScheme(id: string, name: string, note?: string): void {
  const s = schemes()[id];
  if (!s) return;
  s.name = name.trim() || s.name;
  if (note !== undefined) s.note = note;
  persist();
}

export function deleteScheme(id: string): void {
  delete schemes()[id];
  if (activeSchemeId() === id) setActiveScheme(DEFAULT_SCHEME_ID);
  persist();
}

/** 把局面写入某套方案（合并） */
export function mergeIntoScheme(id: string, spots: Record<string, OverrideData>): void {
  const s = schemes()[id];
  if (!s) return;
  Object.assign(s.spots, spots);
  persist();
}

export function getOverride(id: string): OverrideData | undefined {
  return activeScheme()?.spots[id];
}

export function toOverride(freq: Partial<Record<ActionKey, Float64Array | number[]>>, note?: string): OverrideData {
  const data: OverrideData = { freq: {}, updated: Date.now(), note };
  for (const [a, arr] of Object.entries(freq)) data.freq[a as ActionKey] = Array.from(arr as ArrayLike<number>, (v) => Math.round(v * 1000) / 1000);
  return data;
}

/** 保存一个局面的修改。当前使用默认数据时，自动建立"我的修改"方案并切换过去 */
export function setOverride(id: string, freq: Partial<Record<ActionKey, Float64Array | number[]>>, note?: string): void {
  let s = activeScheme();
  if (!s) {
    s = schemes().mine ?? null;
    if (!s) {
      s = { id: 'mine', name: '我的修改', note: '在范围编辑器中修改的范围', created: Date.now(), spots: {} };
      schemes().mine = s;
    }
    setActiveScheme(s.id);
  }
  s.spots[id] = toOverride(freq, note);
  persist();
}

export function clearOverride(id: string): void {
  const s = activeScheme();
  if (!s) return;
  delete s.spots[id];
  persist();
}

export function listOverrides(): string[] {
  return Object.keys(activeScheme()?.spots ?? {});
}

export function resetOverrideCache(): void {
  cache = null;
  active = null;
}

/** 由覆盖数据和默认表合成范围表（各动作频率合计为 1） */
export function chartFromOverride(base: Chart, ov: OverrideData, scheme: Pick<Scheme, 'name' | 'note'>): Chart {
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
    source: {
      kind: 'custom',
      note: `方案「${scheme.name}」${scheme.note ? `（${scheme.note}）` : ''}，${new Date(ov.updated).toLocaleString('zh-CN')} 导入/修改，已替换默认数据。可信度取决于你导入的数据来源。默认数据来源：${base.source.note}`,
    },
  };
}

/** 实际使用的范围表：当前方案覆盖了这个局面时用方案数据，否则用默认 */
export function effectiveChart(id: string): Chart {
  const base = getChart(id);
  const s = activeScheme();
  const ov = s?.spots[id];
  if (!ov || !s) return base;
  return chartFromOverride(base, ov, s);
}
