import { useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  color: string; // CSS 颜色（使用 --series-* 变量）
  values: number[]; // 从第 1 手开始的累计值
  dashed?: boolean;
}

/** 盈利曲线：x = 手数，y = 累计盈亏（bb 或筹码）。悬停显示十字线和数值 */
export function ProfitChart({ series, unit, height = 260 }: { series: Series[]; unit: string; height?: number }) {
  const W = 760;
  const H = height;
  const pad = { l: 52, r: 76, t: 14, b: 28 };
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const span = hi - lo || 1;
  const y0 = lo - span * 0.06;
  const y1 = hi + span * 0.06;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const ticks = useMemo(() => niceTicks(y0, y1, 5), [y0, y1]);
  const xTicks = useMemo(() => niceTicks(1, n, 6).filter((t) => t >= 1 && t <= n && Number.isInteger(t)), [n]);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const path = (vals: number[]) => {
    // 点太多时抽样（保留每段的最大最小值）
    const step = Math.max(1, Math.floor(vals.length / 600));
    let d = '';
    for (let i = 0; i < vals.length; i += step) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`;
    const last = vals.length - 1;
    if (last >= 0 && last % step !== 0) d += `L${x(last).toFixed(1)},${y(vals[last]).toFixed(1)}`;
    return d;
  };
  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}`;
  // 曲线末端的直接标签，避免重叠
  const ends = series.map((s) => ({ s, v: s.values[s.values.length - 1] ?? 0 }));
  const labelY = ends.map((e) => y(e.v));
  if (labelY.length === 2 && Math.abs(labelY[0] - labelY[1]) < 14) {
    const mid = (labelY[0] + labelY[1]) / 2;
    const up = labelY[0] <= labelY[1] ? 0 : 1;
    labelY[up] = mid - 7;
    labelY[1 - up] = mid + 7;
  }
  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color, opacity: s.dashed ? 0.85 : 1 }} className={s.dashed ? 'dashed' : ''} /> {s.name}
          </span>
        ))}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="profit-chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`盈利曲线（${unit}）`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis-zero' : 'grid'} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
              {Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t - 1)} y={H - 8} textAnchor="middle" className="tick">
            {t}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '6 4' : undefined} strokeLinejoin="round" />
        ))}
        {ends.map((e, k) => (
          <text key={e.s.name} x={W - pad.r + 6} y={labelY[k] + 4} className="end-label">
            {fmt(e.v)}
          </text>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />
            {series.map((s) =>
              s.values[hover] === undefined ? null : <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />,
            )}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="muted">第 {hover + 1} 手</div>
          {series.map((s) => (
            <div key={s.name}>
              <i style={{ background: s.color }} /> {s.name}：<strong>{fmt(s.values[hover] ?? 0)}</strong> {unit}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
