import { useEffect, useMemo, useState } from 'react';
import { CardRow } from '../Cards.tsx';
import { save } from '../../lib/storage.ts';
import { type Session, bbPer100, cashProfit, heroInfo, type TourneyConfig } from '../../sim/session.ts';
import { type PlayerStats, emptyStats, statLine } from '../../sim/stats.ts';
import { STYLES } from '../../sim/styles.ts';
import { exportHand, exportSession, heroDecided } from '../../sim/history.ts';
import { type SessionReview, reviewSession } from '../../sim/review.ts';
import { ProfitChart } from './ProfitChart.tsx';
import { fmtBB } from './SimTable.tsx';

const GRADE: Record<string, string> = { best: '✓ 最佳', ok: '≈ 可接受', wrong: '✗ 错误' };

/** 把一手牌送进手牌复盘工具 */
export function sendToReview(text: string): void {
  save('reviewImport', text);
  window.location.hash = '#/review';
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function sessionTitle(s: Session): string {
  const c = s.config;
  if (c.kind === 'cash') return `现金桌 ${c.tableSize} 人 · 盲注 ${c.sb / 100}/${c.bb / 100} · 买入 ${c.buyinBB}bb`;
  if (c.kind === 'sng') return `${c.tableSize} 人 SNG · 起始 ${c.startStack} · ${c.structure === 'fast' ? '快速' : '标准'}结构`;
  return `决赛桌残局 · ${s.seats.length} 人`;
}

export function SimResults({ session, onBack }: { session: Session; onBack: () => void }) {
  const s = session;
  const c = s.config;
  const cash = c.kind === 'cash';
  const hero = heroInfo(s);
  const bbUnit = cash ? c.bb : 1;
  // 盈利曲线：现金桌按 bb，锦标赛按筹码
  const net = s.history.map((_, i) => s.curve[i].net / (cash ? bbUnit : 1));
  const ev = s.history.map((_, i) => s.curve[i].ev / (cash ? bbUnit : 1));
  const hs = s.stats[s.heroSeat] ?? emptyStats();
  const L = statLine(hs);
  const [review, setReview] = useState<SessionReview | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'decided' | 'dev'>('dev');
  useEffect(() => {
    let cancel = false;
    setProgress('正在对照范围库与预计算牌面…');
    reviewSession(s, { onProgress: (d, t) => !cancel && setProgress(`正在复盘 ${d}/${t} 手…`) })
      .then((r) => {
        if (!cancel) {
          setReview(r);
          setProgress('');
        }
      })
      .catch((e) => setProgress(`复盘失败：${e}`));
    return () => {
      cancel = true;
    };
  }, [s]);
  const devHands = useMemo(() => new Set(review?.deviations.map((d) => d.handNo) ?? []), [review]);
  const hands = s.history.filter((h) => (filter === 'all' ? true : filter === 'decided' ? heroDecided(s, h) : devHands.has(h.no)));
  return (
    <div className="page">
      <div className="btn-row">
        <button className="btn" onClick={onBack}>
          ← 返回
        </button>
        <button className="btn" onClick={() => download(`pokertrainer-${s.id}.txt`, exportSession(s))}>
          导出这一局的手牌历史（.txt）
        </button>
      </div>
      <h1>结算 · {sessionTitle(s)}</h1>
      {s.endNote && <p>{s.endNote}</p>}
      <div className="stat-tiles">
        <Tile label="手数" value={String(s.history.length)} />
        {cash ? (
          <>
            <Tile label="总盈亏" value={`${cashProfit(s) >= 0 ? '+' : ''}${fmtBB(cashProfit(s), c.bb)}`} sub={`${(cashProfit(s) / 100).toFixed(2)} 虚拟筹码`} />
            <Tile label="bb/100" value={bbPer100(s).toFixed(1)} />
            <Tile label="全下 EV 调整后 bb/100" value={bbPer100(s, 'ev').toFixed(1)} sub={`运气 ${(net[net.length - 1] - ev[ev.length - 1] || 0) >= 0 ? '+' : ''}${(net[net.length - 1] - ev[ev.length - 1] || 0).toFixed(1)}bb`} />
          </>
        ) : (
          <>
            <Tile label="名次" value={hero.place ? `第 ${hero.place} 名` : '—'} sub={`共 ${s.seats.length} 人`} />
            <Tile label="奖金" value={String(hero.prize ?? 0)} sub={`奖池 ${(c as TourneyConfig).payouts.reduce((a, b) => a + b, 0)}`} />
          </>
        )}
        <Tile label="VPIP / PFR" value={`${L.vpip.toFixed(1)} / ${L.pfr.toFixed(1)}`} />
        <Tile label="3-bet" value={`${L.threeBet.toFixed(1)}%`} />
        <Tile label="AF" value={Number.isFinite(L.af) ? L.af.toFixed(2) : '∞'} />
        <Tile label="WTSD / W$SD" value={`${L.wtsd.toFixed(0)}% / ${L.wsd.toFixed(0)}%`} />
      </div>
      {s.history.length > 1 && (
        <div className="card">
          <h3>盈利曲线（{cash ? 'bb' : '筹码'}）</h3>
          <ProfitChart
            unit={cash ? 'bb' : '筹码'}
            series={[
              { name: '实际盈亏', color: 'var(--series-1)', values: net },
              { name: '全下 EV 调整后', color: 'var(--series-2)', values: ev, dashed: true },
            ]}
          />
          <p className="muted small">全下 EV 调整：下注在公共牌发完之前结束（有人全下）时，按当时各家对每个底池的胜率计算期望收益，代替实际的发牌结果。两条线的差距就是这段时间的运气。</p>
        </div>
      )}
      <div className="card">
        <h3>各玩家数据</h3>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>玩家</th>
                <th>风格</th>
                <th>手数</th>
                <th>VPIP</th>
                <th>PFR</th>
                <th>3-bet</th>
                <th>AF</th>
                <th>WTSD</th>
                <th>{cash ? '盈亏' : '名次'}</th>
              </tr>
            </thead>
            <tbody>
              {s.seats.map((p) => {
                const st: PlayerStats = s.stats[p.seat] ?? emptyStats();
                const l = statLine(st);
                const style = p.style ? STYLES[p.style] : null;
                return (
                  <tr key={p.seat} className={p.isHero ? 'hero-row' : ''}>
                    <td>{p.isHero ? '你' : p.name}</td>
                    <td>{style ? <span className={`style-tag st-${style.id}`}>{style.name}</span> : '—'}</td>
                    <td>{st.hands}</td>
                    <td>{l.vpip.toFixed(1)}</td>
                    <td>{l.pfr.toFixed(1)}</td>
                    <td>{l.threeBet.toFixed(1)}</td>
                    <td>{Number.isFinite(l.af) ? l.af.toFixed(2) : '∞'}</td>
                    <td>{l.wtsd.toFixed(0)}%</td>
                    <td>{cash ? fmtBB(p.stack - p.bought, c.bb) : p.place ? `第 ${p.place} 名` : '在场'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>复盘：偏离范围或求解结果的决策（按 EV 损失从大到小）</h3>
        {progress && <p className="muted">{progress}</p>}
        {review && (
          <>
            <p className="small">
              共对照 {review.graded} 个决策（{review.hands} 手有你的决策）：最佳 {review.best}、可接受 {review.ok}、错误 {review.wrong}
              {review.postflopMatched > 0 ? `；其中 ${review.postflopMatched} 手翻牌圈匹配到预计算牌面库` : '；翻后没有匹配到预计算牌面库（库中目前只有少量翻牌，可在"翻后求解"里求解后送进手牌复盘逐手分析）'}。
            </p>
            <p className="muted small">
              翻前对照当前范围方案；EV 损失标"精确"的来自全下/弃牌纳什表或翻后求解结果，标"估算"的来自近似范围表（按频率差 × 底池估算，只用于排序参考）。
            </p>
            {review.deviations.length === 0 && <p>没有偏离范围的决策。</p>}
            <div className="dev-list">
              {review.deviations.slice(0, 200).map((d, i) => {
                const h = s.history.find((x) => x.no === d.handNo)!;
                const hp = h.p.find((p) => p[0] === s.heroSeat);
                return (
                  <div key={i} className={`review-step ${d.step.grade}`}>
                    <div>
                      <strong>第 {d.handNo} 手</strong> {hp && <CardRow cards={[hp[2], hp[3]]} size="sm" />} · {d.step.title} · 你：{d.step.heroAction}{' '}
                      <span className={`tag grade-${d.step.grade}`}>{GRADE[d.step.grade!]}</span>{' '}
                      <span className="small">
                        EV 损失 <strong>{d.evLoss.toFixed(2)}bb</strong>（{d.exact ? '精确' : '估算'}）
                      </span>
                    </div>
                    <div className="small">
                      {d.step.freqs.map((f, k) => (
                        <span key={k} className="freq-pill" style={f.chosen ? { borderColor: 'var(--accent)', fontWeight: 700 } : undefined}>
                          {f.label} {(f.freq * 100).toFixed(0)}%{f.ev !== undefined ? ` · EV ${f.ev.toFixed(2)}bb` : ''}
                        </span>
                      ))}
                    </div>
                    {d.step.source && <div className="muted small">依据：{d.step.source}</div>}
                    <div className="btn-row">
                      <button className="link small" onClick={() => sendToReview(exportHand(s, h))}>
                        送进手牌复盘 →
                      </button>
                      <button className="link small" onClick={() => setOpen(open === h.no ? null : h.no)}>
                        {open === h.no ? '收起' : '查看'}手牌历史
                      </button>
                    </div>
                    {open === h.no && <pre className="hh-text">{exportHand(s, h)}</pre>}
                  </div>
                );
              })}
            </div>
            {review.deviations.length > 200 && <p className="muted small">只显示 EV 损失最大的 200 个。</p>}
          </>
        )}
      </div>
      <div className="card">
        <h3>手牌列表</h3>
        <div className="seg">
          {(
            [
              ['dev', '有偏离的'],
              ['decided', '我有决策的'],
              ['all', '全部'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="hand-list">
          {hands.slice(-300).reverse().map((h) => {
            const hp = h.p.find((p) => p[0] === s.heroSeat);
            return (
              <div key={h.no} className="hand-row">
                <span className="mono">#{h.no}</span>
                {hp ? <CardRow cards={[hp[2], hp[3]]} size="sm" /> : <span className="muted small">未参与</span>}
                <CardRow cards={h.b} size="sm" />
                <span className={`mono ${h.net > 0 ? 'pos' : h.net < 0 ? 'neg' : ''}`}>{h.net > 0 ? '+' : ''}{fmtBB(h.net, h.bb)}</span>
                {h.ai !== null && h.ev !== h.net && <span className="muted small">EV {h.ev > 0 ? '+' : ''}{fmtBB(Math.round(h.ev), h.bb)}</span>}
                <button className="link small" onClick={() => sendToReview(exportHand(s, h))}>
                  送进复盘
                </button>
                <button className="link small" onClick={() => setOpen(open === -h.no ? null : -h.no)}>
                  历史
                </button>
                {open === -h.no && <pre className="hh-text">{exportHand(s, h)}</pre>}
              </div>
            );
          })}
          {hands.length === 0 && <p className="muted">没有符合条件的手牌。</p>}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="muted small">{label}</div>
      <div className="tile-num">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}
