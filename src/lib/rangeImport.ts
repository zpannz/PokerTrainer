// 批量导入范围方案：支持
// 1. 本工具导出的方案 JSON（{"type":"pgto-scheme", "spots": {局面id: {raise: "范围文字", call: "..."}}}）以及单个局面的 JSON
// 2. 分节文字：每节以 [局面] 或 # 局面 开头，下面每行 "动作: 范围文字"（范围文字为 PioSolver / GTO+ 风格，如 AKs:0.5、[50]A5s[/50]）
// 3. CSV：表头含 hand/手牌 列和各动作列（raise/call/allin/fold 或中文），可选 spot/局面 列；数值为 0~1 或百分比
import { type ActionKey, type Format, type Spot, spotTitle, spotsOf, parseSpotId } from './formats.ts';
import { NUM_CLASSES, classIndex } from './hands.ts';
import { parseRange } from './rangeText.ts';
import { getChart } from '../data/charts.ts';

export type SpotFreq = Partial<Record<ActionKey, Float64Array>>;

export interface ImportResult {
  spots: Record<string, SpotFreq>;
  errors: string[];
  /** 识别出的格式 */
  kind: 'json' | 'sections' | 'csv' | 'single';
}

const ACTION_ALIASES: Record<string, ActionKey> = {
  raise: 'raise',
  r: 'raise',
  open: 'raise',
  rfi: 'raise',
  '3bet': 'raise',
  '3-bet': 'raise',
  '4bet': 'raise',
  '4-bet': 'raise',
  bet: 'raise',
  加注: 'raise',
  开池: 'raise',
  call: 'call',
  c: 'call',
  flat: 'call',
  跟注: 'call',
  allin: 'allin',
  'all-in': 'allin',
  shove: 'allin',
  jam: 'allin',
  push: 'allin',
  全下: 'allin',
  fold: 'fold',
  f: 'fold',
  弃牌: 'fold',
};

export function actionAlias(name: string): ActionKey | undefined {
  return ACTION_ALIASES[name.trim().toLowerCase().replace(/\s+/g, '')];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_()（）·:：]/g, '')
    .replace(/rfi|open/g, '开池')
    .replace(/vs/g, '面对')
    .replace(/utg\+1/g, 'utg1')
    .replace(/utg\+2|mp/g, 'utg2');

/** 由标题或 id 找到局面（在给定格式内找标题，id 可以跨格式） */
export function resolveSpot(header: string, format: Format): Spot | null {
  const h = header.trim();
  if (/^(cash|mtt)\d+-\d+\//.test(h)) {
    const id = h.endsWith('/') || h.split('/').length === 4 ? h : `${h}/`;
    try {
      const s = parseSpotId(id);
      getChart(s.id);
      return s;
    } catch {
      return null;
    }
  }
  const target = norm(h);
  const spots = spotsOf(format);
  return spots.find((s) => norm(spotTitle(s)) === target) ?? spots.find((s) => norm(s.id) === target) ?? null;
}

/** 把导入的各动作权重适配到局面的动作集合：raise ↔ allin 互相替代；合计超过 1 时按比例缩放 */
export function fitToSpot(spotId: string, freq: SpotFreq): { freq: SpotFreq; warn?: string } {
  const chart = getChart(spotId);
  const out: SpotFreq = {};
  let warn: string | undefined;
  for (const [a, arr] of Object.entries(freq) as [ActionKey, Float64Array][]) {
    if (a === 'fold') continue;
    let key: ActionKey | undefined = a;
    if (!chart.actions.includes(a)) {
      if (a === 'raise' && chart.actions.includes('allin')) key = 'allin';
      else if (a === 'allin' && chart.actions.includes('raise')) key = 'raise';
      else {
        warn = `局面没有"${a}"这个动作，已忽略`;
        key = undefined;
      }
    }
    if (!key) continue;
    out[key] = Float64Array.from(arr);
  }
  let over = 0;
  for (let h = 0; h < NUM_CLASSES; h++) {
    let s = 0;
    for (const arr of Object.values(out)) s += arr![h];
    if (s > 1.0001) {
      over++;
      for (const arr of Object.values(out)) arr![h] /= s;
    }
  }
  if (over) warn = `${over} 手牌各动作合计超过 100%，已按比例缩放`;
  return { freq: out, warn };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t' || ch === ';') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseNum(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  const pct = s.endsWith('%');
  const x = parseFloat(pct ? s.slice(0, -1) : s);
  if (!Number.isFinite(x)) throw new Error(`无效的数值: ${v}`);
  return Math.max(0, Math.min(1, pct || x > 1 ? x / 100 : x));
}

function importCsv(text: string, format: Format, currentSpot: string | null, res: ImportResult) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = parseCsvLine(lines[0]).map((x) => x.toLowerCase());
  const handCol = head.findIndex((x) => x === 'hand' || x === '手牌' || x === 'combo');
  const spotCol = head.findIndex((x) => x === 'spot' || x === '局面' || x === 'scenario');
  const actCols = head.map((x, i) => ({ i, a: actionAlias(x) })).filter((x) => x.a && x.i !== handCol && x.i !== spotCol) as { i: number; a: ActionKey }[];
  if (handCol < 0 || actCols.length === 0) {
    res.errors.push('CSV 需要有 hand（或"手牌"）列和至少一个动作列（raise / call / allin，或中文"加注/跟注/全下"）');
    return;
  }
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    let sid = currentSpot;
    if (spotCol >= 0) {
      const sp = resolveSpot(cells[spotCol] ?? '', format);
      if (!sp) {
        res.errors.push(`第 ${li + 1} 行：无法识别局面"${cells[spotCol]}"`);
        continue;
      }
      sid = sp.id;
    }
    if (!sid) {
      res.errors.push('CSV 没有 spot 列，请在范围库中先选择要导入的局面');
      return;
    }
    let h: number;
    try {
      h = classIndex(cells[handCol]);
    } catch {
      res.errors.push(`第 ${li + 1} 行：无效的手牌"${cells[handCol]}"`);
      continue;
    }
    const spot = (res.spots[sid] ??= {});
    for (const { i, a } of actCols) {
      try {
        (spot[a] ??= new Float64Array(NUM_CLASSES))[h] = parseNum(cells[i] ?? '');
      } catch (e) {
        res.errors.push(`第 ${li + 1} 行：${(e as Error).message}`);
      }
    }
  }
}

function addRange(spot: SpotFreq, a: ActionKey, text: string, res: ImportResult, where: string) {
  const r = parseRange(text);
  res.errors.push(...r.errors.map((e) => `${where}：${e}`));
  const arr = (spot[a] ??= new Float64Array(NUM_CLASSES));
  for (let h = 0; h < NUM_CLASSES; h++) arr[h] = Math.max(arr[h], r.weights[h]);
}

function importJson(data: unknown, format: Format, res: ImportResult) {
  const d = data as { spots?: Record<string, Record<string, string>>; spot?: string; actions?: Record<string, string> };
  const entries: [string, Record<string, string>][] = d.spots ? Object.entries(d.spots) : d.spot && d.actions ? [[d.spot, d.actions]] : [];
  if (entries.length === 0) {
    res.errors.push('JSON 中没有 spots 字段（应为本工具导出的方案文件）');
    return;
  }
  for (const [key, acts] of entries) {
    const sp = resolveSpot(key, format);
    if (!sp) {
      res.errors.push(`无法识别局面"${key}"`);
      continue;
    }
    const spot = (res.spots[sp.id] ??= {});
    for (const [an, text] of Object.entries(acts)) {
      const a = actionAlias(an);
      if (!a) {
        res.errors.push(`${key}：无法识别动作"${an}"`);
        continue;
      }
      if (a !== 'fold') addRange(spot, a, String(text), res, key);
    }
  }
}

function importSections(text: string, format: Format, currentSpot: string | null, res: ImportResult) {
  let sid: string | null = null;
  let curAction: ActionKey | null = null;
  let buf = '';
  let sawHeader = false;
  const flush = () => {
    if (sid && curAction && buf.trim() && curAction !== 'fold') addRange((res.spots[sid] ??= {}), curAction, buf, res, sid);
    buf = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const header = /^\[(.+)\]$/.exec(line) ?? /^#+\s*(.+)$/.exec(line) ?? /^={2,}\s*(.+?)\s*=*$/.exec(line);
    // "[50]AKs,AQs[/50]" 是 GTO+ 的权重写法，不是标题
    if (header && !/^\[\d+(\.\d+)?\]/.test(line)) {
      flush();
      sawHeader = true;
      const sp = resolveSpot(header[1], format);
      if (!sp) res.errors.push(`无法识别局面"${header[1]}"（可以写局面 id，如 cash6-100/rfi/BTN/，或范围库里显示的标题，如"BTN 开池"）`);
      sid = sp?.id ?? null;
      curAction = null;
      continue;
    }
    const m = /^([A-Za-z0-9一-龥][\w\-一-龥 ]*?)\s*[:：=]\s*(.*)$/.exec(line);
    const a = m ? actionAlias(m[1]) : undefined;
    if (m && a) {
      flush();
      if (!sid) {
        if (!sawHeader && currentSpot) sid = currentSpot;
        else {
          res.errors.push(`"${line.slice(0, 30)}"前面没有局面标题`);
          continue;
        }
      }
      curAction = a;
      buf = m[2];
    } else buf += ',' + line;
  }
  flush();
}

/** 自动识别格式并导入。currentSpot：没有写局面时导入到哪个局面 */
export function importRanges(text: string, format: Format, currentSpot: string | null): ImportResult {
  const res: ImportResult = { spots: {}, errors: [], kind: 'sections' };
  const t = text.trim();
  if (!t) return res;
  if (t.startsWith('{')) {
    res.kind = 'json';
    try {
      importJson(JSON.parse(t), format, res);
    } catch (e) {
      res.errors.push(`JSON 格式错误：${(e as Error).message}`);
    }
    return res;
  }
  const first = t.split(/\r?\n/)[0].toLowerCase();
  if (/(^|[,;\t])\s*(hand|手牌|combo)\s*([,;\t]|$)/.test(first)) {
    res.kind = 'csv';
    importCsv(t, format, currentSpot, res);
    return res;
  }
  importSections(t, format, currentSpot, res);
  if (Object.keys(res.spots).length === 0 && currentSpot && res.errors.length === 0) {
    // 只有一段范围文字：作为当前局面的主要动作
    res.kind = 'single';
    const chart = getChart(currentSpot);
    const main = chart.actions.find((a) => a !== 'fold')!;
    addRange((res.spots[currentSpot] = {}), main, t, res, '范围');
  }
  return res;
}

/** 导出一套方案为 JSON 文本 */
export function exportScheme(name: string, note: string, spots: Record<string, Partial<Record<ActionKey, ArrayLike<number>>>>, fmt: (w: ArrayLike<number>) => string): string {
  const out: Record<string, Record<string, string>> = {};
  for (const [id, f] of Object.entries(spots)) {
    out[id] = {};
    for (const [a, arr] of Object.entries(f)) if (a !== 'fold' && arr) out[id][a] = fmt(arr);
  }
  return JSON.stringify({ type: 'pgto-scheme', version: 1, name, note, spots: out }, null, 1);
}
