import { type Position, type Spot, POSITION_SHORT, openSize, positionsOf, threeBetSize } from '../lib/formats.ts';

interface SeatState {
  committed: number;
  status: string;
  folded: boolean;
}

/** 根据场景推算每个座位的状态和底池 */
export function tableState(spot: Spot): { seats: Map<Position, SeatState>; pot: number } {
  const f = spot.format;
  const pos = positionsOf(f);
  const seats = new Map<Position, SeatState>();
  for (const p of pos) seats.set(p, { committed: 0, status: '', folded: false });
  seats.get('SB')!.committed = 0.5;
  seats.get('SB')!.status = '小盲 0.5';
  seats.get('BB')!.committed = 1;
  seats.get('BB')!.status = f.ante ? '大盲 1 + 前注 1' : '大盲 1';
  const heroIdx = pos.indexOf(spot.hero);
  const villainIdx = spot.villain ? pos.indexOf(spot.villain) : -1;
  const set = (p: Position, committed: number, status: string) => seats.set(p, { committed, status, folded: false });

  switch (spot.type) {
    case 'rfi':
    case 'push':
      pos.forEach((p, i) => {
        if (i < heroIdx) seats.set(p, { committed: 0, status: '弃牌', folded: true });
      });
      break;
    case 'vsOpen':
    case 'reshove':
    case 'vsShove': {
      const amt = spot.type === 'vsShove' ? f.depth : openSize(f, spot.villain!);
      pos.forEach((p, i) => {
        if (i < villainIdx || (i > villainIdx && i < heroIdx)) {
          const s = seats.get(p)!;
          seats.set(p, { committed: s.committed, status: '弃牌', folded: true });
        }
      });
      set(spot.villain!, amt, spot.type === 'vsShove' ? `全下 ${amt}` : `加注 ${amt}`);
      break;
    }
    case 'vsReshove':
    case 'vs3bet': {
      const o = openSize(f, spot.hero);
      const t = spot.type === 'vsReshove' ? null : threeBetSize(f, spot.hero, spot.villain!);
      for (const p of pos) {
        if (p === spot.hero || p === spot.villain) continue;
        const s = seats.get(p)!;
        seats.set(p, { committed: s.committed, status: '弃牌', folded: true });
      }
      set(spot.hero, o, `加注 ${o}`);
      set(spot.villain!, t ?? f.depth, t === null ? `全下 ${f.depth}` : `3-bet ${t}`);
      break;
    }
  }
  let pot = f.ante;
  for (const s of seats.values()) pot += s.committed;
  return { seats, pot: Math.round(pot * 10) / 10 };
}

export function TableView({ spot }: { spot: Spot }) {
  const pos = positionsOf(spot.format);
  const { seats, pot } = tableState(spot);
  const heroIdx = pos.indexOf(spot.hero);
  const n = pos.length;
  return (
    <div className="table-view">
      <div className="felt">
        <div className="pot">
          底池 <strong>{pot}bb</strong>
          <div className="muted small">
            有效筹码 {spot.format.depth}bb
          </div>
        </div>
      </div>
      {pos.map((p, i) => {
        // 英雄坐在正下方，其余座位按行动顺序顺时针排列
        const k = (i - heroIdx + n) % n;
        const angle = Math.PI / 2 + (k * 2 * Math.PI) / n;
        const x = 50 + 44 * Math.cos(angle);
        const y = 50 + 40 * Math.sin(angle);
        const s = seats.get(p)!;
        const isHero = p === spot.hero;
        return (
          <div
            key={p}
            className={`seat ${isHero ? 'hero' : ''} ${s.folded ? 'folded' : ''} ${p === spot.villain ? 'villain' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className="seat-pos">
              {POSITION_SHORT[p]}
              {p === 'BTN' && <span className="dealer">D</span>}
            </div>
            <div className="seat-status">{isHero && !s.status ? '你' : s.status || '—'}</div>
          </div>
        );
      })}
    </div>
  );
}
