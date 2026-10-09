import { useEffect, useMemo, useState } from 'react';
import { FormatPicker, useFormat } from '../components/FormatContext.tsx';
import { ActionSummary, HandInfo, RangeGrid, ACTION_COLORS } from '../components/RangeGrid.tsx';
import { SourceBadge } from '../components/SourceBadge.tsx';
import { SchemeBar, SchemePanel } from '../components/SchemePanel.tsx';
import {
  type ActionKey,
  type Spot,
  type SpotCategory,
  CATEGORY_NAMES,
  actionLabel,
  describeSpot,
  categoriesOf,
  spotCategories,
  spotTitle,
  spotsOf,
} from '../lib/formats.ts';
import { NUM_CLASSES } from '../lib/hands.ts';
import { formatRange, parseRange } from '../lib/rangeText.ts';
import { clearOverride, effectiveChart, getOverride, setOverride } from '../data/overrides.ts';
import type { Chart } from '../data/charts.ts';

type Draft = Partial<Record<ActionKey, Float64Array>>;

function draftFrom(chart: Chart): Draft {
  const d: Draft = {};
  for (const a of chart.actions) d[a] = Float64Array.from(chart.freq[a]!);
  return d;
}

export function RangesPage() {
  const { format } = useFormat();
  const cats = categoriesOf(format);
  const [cat, setCat] = useState<SpotCategory>(cats[0]);
  const activeCat = cats.includes(cat) ? cat : cats[0];
  const spots = useMemo(() => spotsOf(format).filter((s) => spotCategories(s).includes(activeCat)), [format, activeCat]);
  const [spotId, setSpotId] = useState<string>('');
  const spot: Spot = spots.find((s) => s.id === spotId) ?? spots[0];
  const [version, setVersion] = useState(0);
  const chart = useMemo(() => effectiveChart(spot.id), [spot.id, version]);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [brush, setBrush] = useState<ActionKey>(chart.actions[0]);
  const [brushFreq, setBrushFreq] = useState(100);
  const [importText, setImportText] = useState<Partial<Record<ActionKey, string>>>({});
  const [msg, setMsg] = useState<string>('');
  const [showSchemes, setShowSchemes] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setSelected(null);
    setMsg('');
    setImportText({});
  }, [spot.id]);
  useEffect(() => {
    if (!chart.actions.includes(brush)) setBrush(chart.actions[0]);
  }, [chart, brush]);

  const labels = Object.fromEntries(chart.actions.map((a) => [a, actionLabel(spot, a)])) as Partial<Record<ActionKey, string>>;
  const shown = editing && draft ? { ...chart, freq: draft } : chart;

  const startEdit = () => {
    setDraft(draftFrom(chart));
    setEditing(true);
    const t: Partial<Record<ActionKey, string>> = {};
    for (const a of chart.actions) if (a !== 'fold') t[a] = formatRange(chart.freq[a]!);
    setImportText(t);
  };

  const paint = (h: number) => {
    if (!draft) return;
    const f = brushFreq / 100;
    const d: Draft = { ...draft };
    for (const a of chart.actions) {
      d[a] = Float64Array.from(d[a]!);
      d[a]![h] = 0;
    }
    if (brush === 'fold') d.fold![h] = 1;
    else {
      d[brush]![h] = f;
      d.fold![h] = 1 - f;
    }
    setDraft(d);
  };

  const applyImport = () => {
    const d: Draft = {};
    const errs: string[] = [];
    for (const a of chart.actions) d[a] = new Float64Array(NUM_CLASSES);
    for (const a of chart.actions) {
      if (a === 'fold') continue;
      const r = parseRange(importText[a] ?? '');
      errs.push(...r.errors.map((e) => `${labels[a]}: ${e}`));
      d[a] = r.weights;
    }
    let over = 0;
    for (let h = 0; h < NUM_CLASSES; h++) {
      let s = 0;
      for (const a of chart.actions) if (a !== 'fold') s += d[a]![h];
      if (s > 1.0001) {
        over++;
        for (const a of chart.actions) if (a !== 'fold') d[a]![h] /= s;
        s = 1;
      }
      d.fold![h] = 1 - s;
    }
    setDraft(d);
    setMsg(errs.length ? `导入时有 ${errs.length} 处无法识别：${errs.slice(0, 5).join('；')}` : `已导入${over ? `（${over} 手牌各动作合计超过 100%，已按比例缩放）` : ''}，请检查后点"保存"。`);
  };

  const saveDraft = () => {
    if (!draft) return;
    const f: Draft = {};
    for (const a of chart.actions) if (a !== 'fold') f[a] = draft[a];
    setOverride(spot.id, f);
    setEditing(false);
    setDraft(null);
    setVersion((v) => v + 1);
    setMsg('已保存。训练中这个局面会使用你的范围。');
  };

  const resetDefault = () => {
    clearOverride(spot.id);
    setEditing(false);
    setDraft(null);
    setVersion((v) => v + 1);
    setMsg('已恢复默认数据。');
  };

  const exportJson = () => {
    const obj = {
      spot: spot.id,
      title: spotTitle(spot),
      format: format.label,
      source: chart.source,
      actions: Object.fromEntries(chart.actions.filter((a) => a !== 'fold').map((a) => [a, formatRange(shown.freq[a]!)])),
    };
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = `${spot.id.replace(/\//g, '_')}.json`;
    el.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('已复制到剪贴板');
    } catch {
      setMsg('复制失败，请手动选择文字复制');
    }
  };

  return (
    <div className="page">
      <h1>翻前范围库</h1>
      <FormatPicker />
      <SchemeBar onManage={() => setShowSchemes(!showSchemes)} />
      {showSchemes && <SchemePanel format={format} currentSpot={spot.id} onChange={() => setVersion((v) => v + 1)} />}
      <div className="tabs">
        {cats.map((c) => (
          <button key={c} className={c === activeCat ? 'on' : ''} onClick={() => setCat(c)}>
            {CATEGORY_NAMES[c]}
          </button>
        ))}
      </div>
      <div className="spot-list">
        {spots.map((s) => (
          <button key={s.id} className={s.id === spot.id ? 'on' : ''} onClick={() => setSpotId(s.id)}>
            {spotTitle(s)}
            {getOverride(s.id) && <span className="dot" title="已自定义" />}
          </button>
        ))}
      </div>

      <div className="range-layout">
        <div className="range-main">
          <div className="chart-head">
            <h2>{spotTitle(spot)}</h2>
            <div className="muted">
              {describeSpot(spot)} · {chart.sizing}
            </div>
            <SourceBadge source={chart.source} />
          </div>
          <RangeGrid data={shown} labels={labels} editable={editing} onPaint={paint} onSelect={(h) => setSelected(h)} highlight={selected} />
          <ActionSummary data={shown} labels={labels} />
          {spot.type === 'vs3bet' && <p className="muted small">灰色格子：开池时不会玩的手牌。比例按开池范围计算。</p>}
        </div>
        <aside className="range-side">
          {selected !== null && (
            <div className="card">
              <HandInfo data={shown} hand={selected} labels={labels} />
            </div>
          )}
          <div className="card">
            <h3>范围编辑器</h3>
            {!editing ? (
              <>
                <p className="muted small">可以在格子上涂改，或粘贴通用格式的范围文字导入，保存后替换默认数据（只保存在本机）。</p>
                <div className="btn-row">
                  <button className="btn primary" onClick={startEdit}>
                    编辑 / 导入
                  </button>
                  {getOverride(spot.id) && (
                    <button className="btn" onClick={resetDefault}>
                      恢复默认
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label>画笔动作</label>
                  <div className="seg">
                    {chart.actions.map((a) => (
                      <button key={a} className={brush === a ? 'on' : ''} onClick={() => setBrush(a)}>
                        <span className="swatch" style={{ background: ACTION_COLORS[a] }} /> {labels[a]}
                      </button>
                    ))}
                  </div>
                </div>
                {brush !== 'fold' && (
                  <div className="field">
                    <label>
                      频率 {brushFreq}%（其余为弃牌）
                    </label>
                    <input type="range" min={0} max={100} step={5} value={brushFreq} onChange={(e) => setBrushFreq(Number(e.target.value))} />
                  </div>
                )}
                <p className="muted small">在格子上点击或拖动即可涂改。</p>
                {chart.actions
                  .filter((a) => a !== 'fold')
                  .map((a) => (
                    <div className="field" key={a}>
                      <label>{labels[a]} 范围文字</label>
                      <textarea
                        rows={3}
                        value={importText[a] ?? ''}
                        onChange={(e) => setImportText({ ...importText, [a]: e.target.value })}
                        placeholder="例如：AA-22, A2s+, KTo+, AKs:0.5, [50]A5s,A4s[/50]"
                      />
                    </div>
                  ))}
                <div className="btn-row">
                  <button className="btn" onClick={applyImport}>
                    从文字导入
                  </button>
                  <button className="btn primary" onClick={saveDraft}>
                    保存
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setEditing(false);
                      setDraft(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </>
            )}
            {msg && <p className="msg">{msg}</p>}
          </div>
          <div className="card">
            <h3>导出</h3>
            {chart.actions
              .filter((a) => a !== 'fold')
              .map((a) => {
                const text = formatRange(shown.freq[a]!);
                return (
                  <div key={a} className="field">
                    <label>
                      {labels[a]}
                      <button className="link" onClick={() => copy(text)}>
                        复制
                      </button>
                    </label>
                    <textarea readOnly rows={3} value={text || '（空）'} />
                  </div>
                );
              })}
            <button className="btn" onClick={exportJson}>
              下载 JSON
            </button>
            <p className="muted small">文字格式与 PioSolver / GTO+ 等常用工具兼容：带比例的手牌写作 "AKs:0.5"。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
