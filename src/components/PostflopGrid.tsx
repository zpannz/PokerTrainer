import { useRef, useState } from 'react';
import { HAND_CLASSES, NUM_CLASSES } from '../lib/hands.ts';
import type { ClassAgg } from '../postflop/analysis.ts';
import { CHIPS_PER_BB } from '../postflop/types.ts';

export interface PostflopGridProps {
  agg: ClassAgg;
  /** 动作名称与颜色；没有动作（不是该玩家行动）时只显示范围 */
  actions: { label: string; color: string }[];
  highlight?: number | null;
  onSelect?: (h: number) => void;
  compact?: boolean;
  /** 不显示 EV（例如未求解完） */
  hideEv?: boolean;
}

const fmtBB = (chips: number) => `${chips >= 0 ? '' : '−'}${Math.abs(chips / CHIPS_PER_BB).toFixed(2)}bb`;

function background(agg: ClassAgg, actions: PostflopGridProps['actions'], h: number): string {
  if (actions.length === 0) return 'var(--c-call)';
  const stops: string[] = [];
  let x = 0;
  for (let a = 0; a < actions.length; a++) {
    const f = agg.freq[a][h];
    if (f <= 0.0005) continue;
    const s = x * 100;
    x += f;
    stops.push(`${actions[a].color} ${s.toFixed(1)}% ${Math.min(100, x * 100).toFixed(1)}%`);
  }
  return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : 'var(--c-fold)';
}

export function PostflopHandInfo({ agg, actions, hand, hideEv }: { agg: ClassAgg; actions: PostflopGridProps['actions']; hand: number; hideEv?: boolean }) {
  const c = HAND_CLASSES[hand];
  const w = agg.weight[hand];
  return (
    <div className="hand-info">
      <div className="hand-info-title">
        <strong>{c.name}</strong> <span className="muted">· 范围内 {+w.toFixed(2)} / {c.combos} 个组合</span>
      </div>
      {w <= 0 ? (
        <div className="muted">不在当前范围内</div>
      ) : (
        <>
          {actions.map((a, i) => (
            <div key={i} className="hand-info-row">
              <span className="swatch" style={{ background: a.color }} />
              <span className="hi-label">{a.label}</span>
              <span className="mono">{(agg.freq[i][hand] * 100).toFixed(0)}%</span>
              {!hideEv && <span className="muted mono">EV {fmtBB(agg.actionEv[i][hand])}</span>}
            </div>
          ))}
          <div className="muted small mono">
            胜率 {(agg.equity[hand] * 100).toFixed(1)}%{!hideEv && ` · EV ${fmtBB(agg.ev[hand])}`}
          </div>
        </>
      )}
    </div>
  );
}

export function PostflopGrid({ agg, actions, highlight, onSelect, compact, hideEv }: PostflopGridProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrap} className={`grid-wrap ${compact ? 'compact' : ''}`} onMouseLeave={() => setHover(null)}>
      <div className="range-grid">
        {Array.from({ length: NUM_CLASSES }, (_, h) => {
          const c = HAND_CLASSES[h];
          const frac = agg.weight[h] / c.combos;
          const out = agg.weight[h] <= 0.001;
          return (
            <div
              key={h}
              data-hand={h}
              className={`cell pf-cell ${out ? 'out' : ''} ${highlight === h ? 'hl' : ''}`}
              onMouseEnter={(e) => {
                setHover(h);
                const r = wrap.current?.getBoundingClientRect();
                const cr = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (r) setTip({ x: cr.left - r.left + cr.width / 2, y: cr.top - r.top });
              }}
              onClick={() => onSelect?.(h)}
            >
              {!out && <div className="pf-fill" style={{ height: `${Math.max(12, Math.min(100, frac * 100))}%`, background: background(agg, actions, h) }} />}
              <span>{c.name}</span>
            </div>
          );
        })}
      </div>
      {hover !== null && tip && !compact && (
        <div className="grid-tip" style={{ left: Math.min(Math.max(tip.x, 120), (wrap.current?.clientWidth ?? 400) - 120), top: tip.y }}>
          <PostflopHandInfo agg={agg} actions={actions} hand={hover} hideEv={hideEv} />
        </div>
      )}
    </div>
  );
}
