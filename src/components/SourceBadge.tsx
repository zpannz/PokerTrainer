import { useState } from 'react';
import { type ChartSource, SOURCE_LABELS } from '../data/charts.ts';

export function SourceBadge({ source, collapsed = false }: { source: ChartSource; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div className={`source source-${source.kind}`}>
      <button className="source-tag" onClick={() => setOpen(!open)} title="点击展开/收起说明">
        来源：{SOURCE_LABELS[source.kind]}
        {source.kind === 'computed' ? ' ✓' : source.kind === 'approx' ? ' ≈' : ''}
      </button>
      {open && <span className="source-note">{source.note}</span>}
    </div>
  );
}
