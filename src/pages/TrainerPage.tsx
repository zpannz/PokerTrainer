import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormatPicker, useFormat } from '../components/FormatContext.tsx';
import { TableView } from '../components/TableView.tsx';
import { CardRow } from '../components/Cards.tsx';
import { HandInfo, RangeGrid, ActionSummary, ACTION_COLORS } from '../components/RangeGrid.tsx';
import { SourceBadge } from '../components/SourceBadge.tsx';
import {
  type ActionKey,
  type Position,
  type SpotCategory,
  ACTION_HOTKEYS,
  CATEGORY_NAMES,
  POSITION_SHORT,
  actionLabel,
  describeSpot,
  isPushFold,
  parseSpotId,
  positionsOf,
  spotCategories,
  spotTitle,
} from '../lib/formats.ts';
import { HAND_CLASSES } from '../lib/hands.ts';
import {
  type Grade,
  type Question,
  GRADE_NAMES,
  buildPool,
  gradeAction,
  loadStats,
  nextQuestion,
  randomCombo,
  recordAnswer,
  saveStats,
} from '../lib/trainer.ts';
import { effectiveChart } from '../data/overrides.ts';
import { load, save } from '../lib/storage.ts';

interface Answer {
  q: Question;
  chosen: ActionKey;
  grade: Grade;
  freq: number;
}

type Phase = 'setup' | 'question' | 'feedback' | 'summary';

interface Settings {
  categories: SpotCategory[];
  positions: Position[];
  rounds: number;
  mistakeBias: boolean;
}

const DEFAULT_SETTINGS: Settings = { categories: ['rfi'], positions: [], rounds: 20, mistakeBias: true };

export function TrainerPage() {
  const { format } = useFormat();
  const pf = isPushFold(format);
  const availableCats: SpotCategory[] = pf ? ['push', 'vsShove', 'bbDefense', 'sbStrategy'] : ['rfi', 'vsOpen', 'bbDefense', 'sbStrategy', 'vs3bet'];
  const [settings, setSettings] = useState<Settings>(() => load('trainerSettings', DEFAULT_SETTINGS));
  const cats = settings.categories.filter((c) => availableCats.includes(c));
  const effectiveCats = cats.length ? cats : [availableCats[0]];
  const positions = settings.positions.filter((p) => positionsOf(format).includes(p));

  const [phase, setPhase] = useState<Phase>('setup');
  const [q, setQ] = useState<Question | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [retryQueue, setRetryQueue] = useState<Question[] | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const statsRef = useRef(loadStats());

  const pool = useMemo(() => buildPool(format, effectiveCats, positions), [format, effectiveCats.join(), positions.join()]);

  useEffect(() => save('trainerSettings', settings), [settings]);
  useEffect(() => {
    setPhase('setup');
  }, [format.id]);

  const total = retryQueue ? retryQueue.length : settings.rounds;

  const deal = useCallback(
    (prevAnswers: Answer[]) => {
      if (retryQueue) {
        const next = retryQueue[prevAnswers.length];
        if (!next) {
          setPhase('summary');
          return;
        }
        const chart = effectiveChart(next.spot.id);
        setQ({ ...next, chart, cards: randomCombo(next.hand, Math.random), fromMistakes: true });
        setPhase('question');
        return;
      }
      if (prevAnswers.length >= settings.rounds) {
        setPhase('summary');
        return;
      }
      const last = prevAnswers[prevAnswers.length - 1];
      const nq = nextQuestion(pool, statsRef.current, effectiveChart, Math.random, settings.mistakeBias ? 0.3 : 0, last ? { spotId: last.q.spot.id, hand: last.q.hand } : undefined);
      setQ(nq);
      setPhase('question');
    },
    [pool, settings, retryQueue],
  );

  const start = (retry: Question[] | null = null) => {
    statsRef.current = loadStats();
    setAnswers([]);
    setRetryQueue(retry);
    if (retry) {
      const first = retry[0];
      setQ({ ...first, chart: effectiveChart(first.spot.id), cards: randomCombo(first.hand, Math.random) });
      setPhase('question');
    } else {
      const nq = nextQuestion(pool, statsRef.current, effectiveChart, Math.random, settings.mistakeBias ? 0.3 : 0);
      setQ(nq);
      setPhase('question');
    }
  };

  const answer = useCallback(
    (a: ActionKey) => {
      if (!q || phase !== 'question') return;
      if (!q.chart.actions.includes(a)) return;
      const g = gradeAction(q.chart, q.hand, a);
      recordAnswer(statsRef.current, q.spot, q.hand, a, g.grade);
      saveStats(statsRef.current);
      setAnswers((prev) => [...prev, { q, chosen: a, grade: g.grade, freq: g.freq }]);
      setPhase('feedback');
    },
    [q, phase],
  );

  const next = useCallback(() => deal(answers), [deal, answers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (phase === 'question' && q) {
        const byHotkey = q.chart.actions.find((a) => ACTION_HOTKEYS[a] === k);
        const order = displayOrder(q.chart.actions);
        const byNum = /^[1-4]$/.test(k) ? order[Number(k) - 1] : undefined;
        const a = byHotkey ?? byNum;
        if (a) {
          e.preventDefault();
          answer(a);
        }
      } else if (phase === 'feedback' && (k === ' ' || k === 'ENTER' || k === 'N')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, q, answer, next]);

  if (phase === 'setup') {
    const toggleCat = (c: SpotCategory) => {
      const has = cats.includes(c);
      const list = has ? cats.filter((x) => x !== c) : [...cats, c];
      setSettings({ ...settings, categories: [...settings.categories.filter((x) => !availableCats.includes(x)), ...list] });
    };
    const togglePos = (p: Position) => {
      const has = settings.positions.includes(p);
      setSettings({ ...settings, positions: has ? settings.positions.filter((x) => x !== p) : [...settings.positions, p] });
    };
    const mistakesInPool = statsRef.current.mistakes.filter((m) => pool.some((s) => s.id === m.spotId)).length;
    return (
      <div className="page">
        <h1>翻前训练</h1>
        <FormatPicker />
        <div className="card">
          <h3>场景</h3>
          <div className="chips">
            {availableCats.map((c) => (
              <button key={c} className={`chip ${cats.includes(c) ? 'on' : ''}`} onClick={() => toggleCat(c)}>
                {CATEGORY_NAMES[c]}
              </button>
            ))}
          </div>
          <h3>你的位置（不选 = 全部）</h3>
          <div className="chips">
            {positionsOf(format).map((p) => (
              <button key={p} className={`chip ${settings.positions.includes(p) ? 'on' : ''}`} onClick={() => togglePos(p)}>
                {POSITION_SHORT[p]}
              </button>
            ))}
          </div>
          <h3>每轮题数</h3>
          <div className="seg">
            {[10, 20, 50, 100].map((n) => (
              <button key={n} className={settings.rounds === n ? 'on' : ''} onClick={() => setSettings({ ...settings, rounds: n })}>
                {n}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.mistakeBias} onChange={(e) => setSettings({ ...settings, mistakeBias: e.target.checked })} />
            多出我常错的题（约 30% 的题来自错题本，并按各场景错误率加权）
          </label>
          <p className="muted small">
            当前题库：{pool.length} 个局面{mistakesInPool ? `，错题本中有 ${mistakesInPool} 道相关题` : ''}。快捷键：F 弃牌、C 跟注、R 加注（开池/3-bet/4-bet）、A 全下，也可按 1~4；回答后按空格或回车进入下一题。
          </p>
          <button className="btn primary big" disabled={pool.length === 0} onClick={() => start()}>
            开始训练
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'summary') return <Summary answers={answers} onAgain={() => start()} onRetry={(qs) => start(qs)} onSetup={() => setPhase('setup')} />;

  if (!q) return null;
  const labels = Object.fromEntries(q.chart.actions.map((a) => [a, actionLabel(q.spot, a)])) as Partial<Record<ActionKey, string>>;
  const last = answers[answers.length - 1];
  const correctSoFar = answers.filter((a) => a.grade !== 'wrong').length;

  return (
    <div className="page trainer">
      <div className="trainer-top">
        <span>
          第 <strong>{Math.min(answers.length + (phase === 'question' ? 1 : 0), total)}</strong> / {total} 题
        </span>
        <span className="muted">
          {format.label} · 正确 {correctSoFar}/{answers.length}
        </span>
        <button className="link" onClick={() => setPhase('summary')}>
          结束本轮
        </button>
      </div>
      <div className="trainer-layout">
        <div className="trainer-main">
          <div className="spot-desc">
            <span className="tag">{CATEGORY_NAMES[spotCategories(q.spot)[0]]}</span>
            {q.fromMistakes && <span className="tag warn">错题重练</span>}
            <div>{describeSpot(q.spot)}</div>
            <div className="muted small">{q.chart.sizing}</div>
          </div>
          <TableView spot={q.spot} />
          <div className="hero-hand">
            <CardRow cards={q.cards} size="lg" />
            <span className="muted">{HAND_CLASSES[q.hand].name}</span>
          </div>
          <div className="action-bar">
            {displayOrder(q.chart.actions).map((a, i) => (
              <button
                key={a}
                className={`act act-${a} ${phase === 'feedback' && last?.chosen === a ? 'chosen' : ''}`}
                disabled={phase !== 'question'}
                onClick={() => answer(a)}
              >
                {labels[a]}
                <kbd>
                  {ACTION_HOTKEYS[a]} / {i + 1}
                </kbd>
              </button>
            ))}
          </div>
        </div>
        {phase === 'feedback' && last && (
          <div className="trainer-feedback">
            <div className={`grade grade-${last.grade}`}>
              {last.grade === 'best' ? '✓ ' : last.grade === 'ok' ? '≈ ' : '✗ '}
              {GRADE_NAMES[last.grade]}
              <div className="small">
                你选择了「{labels[last.chosen]}」，该手牌在此局面的频率为 {(last.freq * 100).toFixed(0)}%
              </div>
            </div>
            <div className="card">
              <HandInfo data={q.chart} hand={q.hand} labels={labels} />
              <SourceBadge source={q.chart.source} collapsed />
            </div>
            <button className="btn primary big" onClick={next}>
              下一题（空格 / 回车）
            </button>
            <label className="check small">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> 显示完整范围
            </label>
            {showGrid && (
              <>
                <RangeGrid data={q.chart} labels={labels} highlight={q.hand} compact />
                <ActionSummary data={q.chart} labels={labels} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 按钮顺序：弃牌、跟注、加注、全下（与常见软件一致） */
function displayOrder(actions: ActionKey[]): ActionKey[] {
  const order: ActionKey[] = ['fold', 'call', 'raise', 'allin'];
  return order.filter((a) => actions.includes(a));
}

function Summary({ answers, onAgain, onRetry, onSetup }: { answers: Answer[]; onAgain: () => void; onRetry: (qs: Question[]) => void; onSetup: () => void }) {
  const n = answers.length;
  const best = answers.filter((a) => a.grade === 'best').length;
  const ok = answers.filter((a) => a.grade === 'ok').length;
  const wrong = answers.filter((a) => a.grade === 'wrong');
  const byCat = new Map<SpotCategory, { n: number; good: number }>();
  for (const a of answers) {
    const c = spotCategories(a.q.spot)[0];
    const t = byCat.get(c) ?? { n: 0, good: 0 };
    t.n++;
    if (a.grade !== 'wrong') t.good++;
    byCat.set(c, t);
  }
  return (
    <div className="page">
      <h1>本轮总结</h1>
      <div className="stat-tiles">
        <div className="tile">
          <div className="tile-num">{n ? Math.round(((best + ok) / n) * 100) : 0}%</div>
          <div className="muted">正确率（最佳 + 可接受）</div>
        </div>
        <div className="tile">
          <div className="tile-num" style={{ color: 'var(--good)' }}>{best}</div>
          <div className="muted">最佳</div>
        </div>
        <div className="tile">
          <div className="tile-num" style={{ color: 'var(--ok)' }}>{ok}</div>
          <div className="muted">可接受</div>
        </div>
        <div className="tile">
          <div className="tile-num" style={{ color: 'var(--bad)' }}>{wrong.length}</div>
          <div className="muted">错误</div>
        </div>
      </div>
      <div className="card">
        <h3>各场景</h3>
        <table className="tbl">
          <tbody>
            {[...byCat.entries()].map(([c, t]) => (
              <tr key={c}>
                <td>{CATEGORY_NAMES[c]}</td>
                <td className="mono">
                  {t.good}/{t.n}
                </td>
                <td className="mono">{Math.round((t.good / t.n) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn primary" onClick={onAgain}>
          再来一轮
        </button>
        {wrong.length > 0 && (
          <button className="btn" onClick={() => onRetry(wrong.map((w) => w.q))}>
            只练本轮错题（{wrong.length}）
          </button>
        )}
        <button className="btn" onClick={onSetup}>
          修改设置
        </button>
      </div>
      {wrong.length > 0 && (
        <div className="card">
          <h3>错题回顾</h3>
          <div className="review-list">
            {wrong.map((w, i) => {
              const spot = parseSpotId(w.q.spot.id);
              const labels = Object.fromEntries(w.q.chart.actions.map((a) => [a, actionLabel(spot, a)])) as Partial<Record<ActionKey, string>>;
              return (
                <div key={i} className="review-item">
                  <div className="review-head">
                    <CardRow cards={w.q.cards} size="sm" />
                    <div>
                      <strong>{spotTitle(spot)}</strong>
                      <div className="muted small">{describeSpot(spot)}</div>
                    </div>
                  </div>
                  <div className="small">
                    你选择了「{labels[w.chosen]}」（频率 {(w.freq * 100).toFixed(0)}%），正确比例：
                    {w.q.chart.actions.map((a) => (
                      <span key={a} className="freq-pill" style={{ borderColor: ACTION_COLORS[a] }}>
                        {labels[a]} {((w.q.chart.freq[a]?.[w.q.hand] ?? 0) * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
