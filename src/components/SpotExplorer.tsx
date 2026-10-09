import { useEffect, useMemo, useState } from 'react';
import { PostflopGrid, PostflopHandInfo } from './PostflopGrid.tsx';
import { CardRow } from './Cards.tsx';
import { parseCard, parseCards } from '../lib/cards.ts';
import { HAND_CLASSES } from '../lib/hands.ts';
import { actionColor, aggregate, comboClass, describeAction, overallFreq, rangeEquity, rangeEv, rangeSize, shortAction } from '../postflop/analysis.ts';
import { CHIPS_PER_BB, type NodeData, solverCardId } from '../postflop/types.ts';

export interface NodeSource {
  hands: [string[], string[]];
  /** 返回 null 表示该节点不可用（缓存里没有） */
  getNode(history: number[]): Promise<NodeData | null>;
  live: boolean;
  players: [string, string];
}

const SOLVER_CARD = (id: number) => '23456789TJQKA'[id >> 2] + 'cdhs'[id & 3];
const bb = (x: number) => `${+(x / CHIPS_PER_BB).toFixed(2)}bb`;

interface Step {
  history: number[];
  label: string;
}

export function SpotExplorer({ source, onMissing, initialHistory }: { source: NodeSource; onMissing?: () => void; initialHistory?: number[] }) {
  const [history, setHistory] = useState<number[]>(initialHistory ?? []);
  const [node, setNode] = useState<NodeData | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<number | null>(null); // 查看哪位玩家的范围（null = 行动者）
  const [selected, setSelected] = useState<number | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError('');
    source
      .getNode(history)
      .then((n) => {
        if (cancel) return;
        setNode(n);
        setMissing(n === null);
      })
      .catch((e) => !cancel && setError(String((e as Error).message ?? e)))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [source, history.join(',')]);

  // 面包屑：逐步重建每一步的标签
  useEffect(() => {
    let cancel = false;
    (async () => {
      const out: Step[] = [];
      for (let i = 0; i < history.length; i++) {
        const h = history.slice(0, i);
        const n = await source.getNode(h);
        if (!n) {
          out.push({ history: history.slice(0, i + 1), label: '?' });
          continue;
        }
        const a = history[i];
        const label = n.kind === 'chance' ? `发 ${SOLVER_CARD(a)}` : `${source.players[n.player]} ${shortAction(n.actions[a], n)}`;
        out.push({ history: history.slice(0, i + 1), label });
      }
      if (!cancel) setSteps(out);
    })();
    return () => {
      cancel = true;
    };
  }, [source, history.join(',')]);

  const viewer = node ? (view ?? (node.kind === 'player' ? node.player : 0)) : 0;
  const n = source.hands[viewer].length;
  const agg = useMemo(() => (node ? aggregate(node, source.hands[viewer], viewer) : null), [node, viewer, source]);
  const isActor = node?.kind === 'player' && node.player === viewer;
  const actions = isActor && node ? node.actions.map((c) => ({ label: shortAction(c, node), color: actionColor(c, node) })) : [];
  const hideEv = !node || node.ev[viewer].length === 0;

  const go = (h: number[]) => {
    setHistory(h);
    setSelected(null);
    setView(null);
  };

  return (
    <div className="explorer">
      <div className="breadcrumb">
        <button className={history.length === 0 ? 'cur' : ''} onClick={() => go([])}>
          起点
        </button>
        {steps.map((s, i) => (
          <button key={i} className={i === steps.length - 1 ? 'cur' : ''} onClick={() => go(s.history)}>
            {s.label}
          </button>
        ))}
        {history.length > 0 && (
          <button onClick={() => go(history.slice(0, -1))} title="后退一步">
            ← 后退
          </button>
        )}
      </div>
      {error && <div className="err-box">{error}</div>}
      {loading && !node && <p className="muted">读取中…</p>}
      {missing && (
        <div className="warn-box">
          这个分支不在本地缓存中（缓存只保存翻牌圈的决策点和你看过的节点）。
          {onMissing ? (
            <button className="link" onClick={onMissing}>
              重新求解以查看
            </button>
          ) : (
            '请重新求解这个局面。'
          )}
        </div>
      )}
      {node && (
        <>
          <div className="stat-line">
            <span>
              公共牌 <CardRow cards={parseCards(node.board.join(''))} size="sm" />
            </span>
            <span>底池 {bb(node.pot)}</span>
            <span>
              投入 {source.players[0]} {bb(node.bets[0])} / {source.players[1]} {bb(node.bets[1])}
            </span>
          </div>
          {node.kind === 'player' && (
            <>
              <h3>
                {source.players[node.player]} 行动 <span className="muted small">（{node.player === 0 ? '不在位 OOP' : '在位 IP'}）</span>
              </h3>
              <div className="node-actions">
                {node.actions.map((c, i) => {
                  const f = overallFreq(node, source.hands[node.player].length)[i];
                  return (
                    <button key={i} style={{ background: actionColor(c, node) }} onClick={() => go([...history, i])} title="沿这个动作继续">
                      {describeAction(c, node)} · {(f * 100).toFixed(1)}%
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {node.kind === 'chance' && (
            <div>
              <h3>发{node.board.length === 3 ? '转牌' : '河牌'}：选择一张牌继续</h3>
              <div className="deal-cards">
                {'AKQJT98765432'.split('').map((r) =>
                  'shdc'.split('').map((s) => {
                    const card = r + s;
                    const ok = node.cards.includes(card);
                    return (
                      <button key={card} disabled={!ok} className={`suit-${s}`} onClick={() => go([...history, solverCardId(card)])}>
                        {r}
                        {'♠♥♦♣'['shdc'.indexOf(s)]}
                      </button>
                    );
                  }),
                )}
              </div>
              <button
                className="btn small"
                onClick={() => {
                  const c = node.cards[Math.floor(Math.random() * node.cards.length)];
                  go([...history, solverCardId(c)]);
                }}
              >
                随机发一张
              </button>
            </div>
          )}
          {node.kind === 'terminal' && <p className="muted">这一手牌在这里结束（弃牌、摊牌或全下后跟注）。</p>}

          <div className="seg" style={{ margin: '8px 0' }}>
            {[0, 1].map((p) => (
              <button key={p} className={viewer === p ? 'on' : ''} onClick={() => setView(p)}>
                {source.players[p]} 的范围
              </button>
            ))}
          </div>
          <div className="stat-line muted">
            <span>{rangeSize(node, viewer).toFixed(1)} 个组合</span>
            {node.kind !== 'terminal' && <span>整体胜率 {(rangeEquity(node, viewer) * 100).toFixed(1)}%</span>}
            {!hideEv && <span>整体 EV {bb(rangeEv(node, viewer))}</span>}
          </div>
          {isActor && (
            <div className="legend">
              {node.actions.map((c, i) => (
                <span key={i} className="legend-item">
                  <span className="swatch" style={{ background: actionColor(c, node) }} />
                  {describeAction(c, node)}
                  <span className="mono muted">{(overallFreq(node, n)[i] * 100).toFixed(1)}%</span>
                </span>
              ))}
            </div>
          )}
          {agg && (
            <div className="pf-layout">
              <div>
                <PostflopGrid agg={agg} actions={actions} onSelect={setSelected} highlight={selected} hideEv={hideEv} />
                <p className="muted small">格子填充高度 = 该手牌在当前范围中的比例；颜色 = 各动作比例。点击格子查看具体组合。</p>
              </div>
              <div>
                {selected !== null && (
                  <div className="card">
                    <PostflopHandInfo agg={agg} actions={actions} hand={selected} hideEv={hideEv} />
                    <ComboTable node={node} hands={source.hands[viewer]} player={viewer} cls={selected} />
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ComboTable({ node, hands, player, cls }: { node: NodeData; hands: string[]; player: number; cls: number }) {
  const n = hands.length;
  const isActor = node.kind === 'player' && node.player === player;
  const rows = hands.map((h, i) => ({ h, i })).filter((x) => comboClass(x.h) === cls && node.weights[player][x.i] > 0);
  if (rows.length === 0) return <p className="muted small">{HAND_CLASSES[cls].name} 的组合都不在范围内（或与公共牌冲突）。</p>;
  const hasEv = node.ev[player].length > 0;
  return (
    <table className="combo-table">
      <thead>
        <tr>
          <th>组合</th>
          <th>权重</th>
          <th>胜率</th>
          {hasEv && <th>EV</th>}
          {isActor && node.actions.map((c, a) => <th key={a}>{shortAction(c, node)}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ h, i }) => (
          <tr key={h}>
            <td>
              <CardRow cards={[parseCard(h.slice(0, 2)), parseCard(h.slice(2))]} size="sm" />
            </td>
            <td className="mono">{node.weights[player][i].toFixed(2)}</td>
            <td className="mono">{((node.equity[player][i] ?? 0) * 100).toFixed(1)}%</td>
            {hasEv && <td className="mono">{bb(node.ev[player][i])}</td>}
            {isActor &&
              node.actions.map((_, a) => (
                <td key={a} className="mono">
                  {(node.strategy[a * n + i] * 100).toFixed(0)}%
                  {hasEv && <div className="muted">{bb(node.actionEv[a * n + i])}</div>}
                </td>
              ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
