import { useRef, useState, type CSSProperties } from 'react';
import type { ActionKey } from '../lib/formats.ts';
import { HAND_CLASSES, NUM_CLASSES } from '../lib/hands.ts';

export const ACTION_COLORS: Record<ActionKey, string> = {
  allin: 'var(--c-allin)',
  raise: 'var(--c-raise)',
  call: 'var(--c-call)',
  fold: 'var(--c-fold)',
};

export interface GridData {
  actions: ActionKey[];
  freq: Partial<Record<ActionKey, ArrayLike<number>>>;
  prior?: ArrayLike<number>;
  ev?: Partial<Record<ActionKey, ArrayLike<number>>>;
}

interface Props {
  data: GridData;
  labels?: Partial<Record<ActionKey, string>>;
  highlight?: number | null;
  editable?: boolean;
  onPaint?: (hand: number) => void;
  onSelect?: (hand: number) => void;
  compact?: boolean;
}

function cellBackground(data: GridData, h: number): string {
  const stops: string[] = [];
  let x = 0;
  for (const a of data.actions) {
    const f = data.freq[a]?.[h] ?? 0;
    if (f <= 0) continue;
    const start = x * 100;
    x += f;
    const end = Math.min(100, x * 100);
    stops.push(`${ACTION_COLORS[a]} ${start.toFixed(1)}% ${end.toFixed(1)}%`);
  }
  if (stops.length === 0) return ACTION_COLORS.fold;
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function HandInfo({ data, hand, labels }: { data: GridData; hand: number; labels?: Partial<Record<ActionKey, string>> }) {
  const c = HAND_CLASSES[hand];
  const prior = data.prior?.[hand] ?? 1;
  return (
    <div className="hand-info">
      <div className="hand-info-title">
        <strong>{c.name}</strong> <span className="muted">· {c.combos} 个组合</span>
        {prior < 1 && <span className="muted">（到达此局面的频率 {Math.round(prior * 100)}%）</span>}
      </div>
      {prior <= 0 ? (
        <div className="muted">不在本局面的范围内</div>
      ) : (
        data.actions.map((a) => {
          const f = data.freq[a]?.[hand] ?? 0;
          const ev = data.ev?.[a]?.[hand];
          return (
            <div key={a} className="hand-info-row">
              <span className="swatch" style={{ background: ACTION_COLORS[a] }} />
              <span className="hi-label">{labels?.[a] ?? a}</span>
              <span className="mono">{(f * 100).toFixed(0)}%</span>
              <span className="muted mono">{(f * c.combos * prior).toFixed(1)} 组合</span>
              {ev !== undefined && <span className="muted mono">EV {ev >= 0 ? '+' : ''}{ev.toFixed(2)}bb</span>}
            </div>
          );
        })
      )}
    </div>
  );
}

export function RangeGrid({ data, labels, highlight, editable, onPaint, onSelect, compact }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  const painting = useRef(false);
  const lastPainted = useRef<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const paint = (h: number) => {
    if (!editable || !onPaint) return;
    if (lastPainted.current === h) return;
    lastPainted.current = h;
    onPaint(h);
  };

  const handFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const v = el?.dataset?.hand;
    return v === undefined ? null : Number(v);
  };

  return (
    <div
      ref={wrap}
      className={`grid-wrap ${compact ? 'compact' : ''}`}
      onMouseLeave={() => {
        setHover(null);
        painting.current = false;
      }}
      onMouseUp={() => {
        painting.current = false;
        lastPainted.current = null;
      }}
      onTouchMove={(e) => {
        if (!editable || !painting.current) return;
        const t = e.touches[0];
        const h = handFromPoint(t.clientX, t.clientY);
        if (h !== null) paint(h);
      }}
      onTouchEnd={() => {
        painting.current = false;
        lastPainted.current = null;
      }}
    >
      <div className={`range-grid ${editable ? 'editable' : ''}`} style={editable ? ({ touchAction: 'none' } as CSSProperties) : undefined}>
        {Array.from({ length: NUM_CLASSES }, (_, h) => {
          const c = HAND_CLASSES[h];
          const out = (data.prior?.[h] ?? 1) <= 0;
          return (
            <div
              key={h}
              data-hand={h}
              className={`cell ${out ? 'out' : ''} ${highlight === h ? 'hl' : ''} ${c.kind}`}
              style={{ background: out ? undefined : cellBackground(data, h) }}
              onMouseEnter={(e) => {
                setHover(h);
                const r = wrap.current?.getBoundingClientRect();
                const cr = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (r) setTipPos({ x: cr.left - r.left + cr.width / 2, y: cr.top - r.top });
                if (painting.current) paint(h);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                painting.current = true;
                lastPainted.current = null;
                paint(h);
              }}
              onTouchStart={() => {
                if (editable) {
                  painting.current = true;
                  lastPainted.current = null;
                  paint(h);
                }
              }}
              onClick={() => onSelect?.(h)}
            >
              <span>{c.name}</span>
            </div>
          );
        })}
      </div>
      {hover !== null && tipPos && !compact && (
        <div
          className="grid-tip"
          style={{
            left: Math.min(Math.max(tipPos.x, 110), (wrap.current?.clientWidth ?? 400) - 110),
            top: tipPos.y,
          }}
        >
          <HandInfo data={data} hand={hover} labels={labels} />
        </div>
      )}
    </div>
  );
}

/** 各动作占全部组合的比例 */
export function ActionSummary({ data, labels }: { data: GridData; labels?: Partial<Record<ActionKey, string>> }) {
  let total = 0;
  const sums: Partial<Record<ActionKey, number>> = {};
  for (let h = 0; h < NUM_CLASSES; h++) {
    const m = (data.prior?.[h] ?? 1) * HAND_CLASSES[h].combos;
    total += m;
    for (const a of data.actions) sums[a] = (sums[a] ?? 0) + (data.freq[a]?.[h] ?? 0) * m;
  }
  return (
    <div className="legend">
      {data.actions.map((a) => (
        <span key={a} className="legend-item">
          <span className="swatch" style={{ background: ACTION_COLORS[a] }} />
          {labels?.[a] ?? a}
          <span className="mono muted">
            {total > 0 ? (((sums[a] ?? 0) / total) * 100).toFixed(1) : '0'}% · {(sums[a] ?? 0).toFixed(0)} 组合
          </span>
        </span>
      ))}
    </div>
  );
}
