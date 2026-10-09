import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardRow } from '../components/Cards.tsx';
import { PostflopGrid } from '../components/PostflopGrid.tsx';
import { parseCard, parseCards } from '../lib/cards.ts';
import { weightedPick } from '../lib/trainer.ts';
import { load, save } from '../lib/storage.ts';
import {
  type NodeType,
  type PfQuestion,
  type PfStats,
  NODE_TYPE_NAMES,
  describeLine,
  nodeType,
  gradeQuestion,
  loadPfStats,
  questionFromSpot,
  recordPf,
  savePfStats,
} from '../lib/postflopTrainer.ts';
import { actionColor, aggregate, describeAction, type PostflopGrade, shortAction } from '../postflop/analysis.ts';
import { type IndexScenario, type PostflopIndex, loadIndex, loadPrecomputed } from '../postflop/precomputed.ts';
import { getSolve, listSolves, type SolveSummary } from '../postflop/cache.ts';
import { HIGH_NAMES, PAIR_NAMES, SUIT_NAMES, flopTexture, textureLabel, type HighTexture, type SuitTexture } from '../postflop/flops.ts';
import { CHIPS_PER_BB, parseAction, type SolvedSpot } from '../postflop/types.ts';

const GRADE_NAMES: Record<PostflopGrade, string> = { best: '最佳', ok: '可接受', wrong: '错误' };

interface Settings {
  source: 'pre' | 'solve';
  scenarios: string[];
  suits: SuitTexture[];
  highs: HighTexture[];
  paired: boolean | null;
  types: NodeType[];
  solves: string[];
  rounds: number;
  mistakeBias: boolean;
}

const DEFAULTS: Settings = { source: 'pre', scenarios: [], suits: [], highs: [], paired: null, types: ['vsCheck', 'vsBet'], solves: [], rounds: 20, mistakeBias: true };

interface Answer {
  q: PfQuestion;
  chosen: number;
  grade: PostflopGrade;
  freq: number;
  evLoss: number; // 筹码
}

function querySolveKey(): string | null {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('solve') : null;
}

const bb = (chips: number, d = 2) => `${+(chips / CHIPS_PER_BB).toFixed(d)}bb`;

export function PostflopTrainerPage() {
  const [settings, setSettings] = useState<Settings>(() => {
    const s = { ...DEFAULTS, ...load<Partial<Settings>>('pfTrainerSettings', {}) };
    const k = querySolveKey();
    return k ? { ...s, source: 'solve', solves: [k] } : s;
  });
  const [index, setIndex] = useState<PostflopIndex | null>(null);
  const [indexErr, setIndexErr] = useState('');
  const [solves, setSolves] = useState<SolveSummary[]>([]);
  const [phase, setPhase] = useState<'setup' | 'loading' | 'question' | 'feedback' | 'summary'>('setup');
  const [q, setQ] = useState<PfQuestion | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [retry, setRetry] = useState<PfQuestion[] | null>(null);
  const [err, setErr] = useState('');
  const statsRef = useRef<PfStats>(loadPfStats());

  useEffect(() => save('pfTrainerSettings', { ...settings, solves: settings.source === 'solve' ? settings.solves : [] }), [settings]);
  useEffect(() => {
    loadIndex()
      .then(setIndex)
      .catch((e) => setIndexErr((e as Error).message));
    void listSolves().then(setSolves);
  }, []);

  const scenarios: IndexScenario[] = index?.scenarios ?? [];
  const activeScenarios = scenarios.filter((s) => settings.scenarios.length === 0 || settings.scenarios.includes(s.id));
  const flopPool = useMemo(() => {
    const out: { sc: IndexScenario; flop: string; weight: number }[] = [];
    for (const sc of activeScenarios)
      for (const f of sc.flops) {
        if (settings.suits.length && !settings.suits.includes(f.texture.suit)) continue;
        if (settings.highs.length && !settings.highs.includes(f.texture.high)) continue;
        if (settings.paired !== null && (f.texture.pair !== 'unpaired') !== settings.paired) continue;
        out.push({ sc, flop: f.flop, weight: f.weight });
      }
    return out;
  }, [activeScenarios, settings]);

  const loadRef = async (ref: string): Promise<{ spot: SolvedSpot; group: string } | null> => {
    if (ref.startsWith('pre:')) {
      const [dir, flop] = ref.slice(4).split('/');
      const spot = await loadPrecomputed(dir, flop);
      return { spot, group: spot.title.split(' · ')[0] };
    }
    const spot = await getSolve(ref.slice(6));
    return spot ? { spot, group: '我的求解' } : null;
  };

  const makeQuestion = useCallback(async (): Promise<PfQuestion> => {
    const stats = statsRef.current;
    const rand = Math.random;
    const refs =
      settings.source === 'pre'
        ? new Set(flopPool.map((f) => `pre:${f.sc.dir}/${f.flop}`))
        : new Set(settings.solves.map((k) => `solve:${k}`));
    // 错题重练
    const relevant = stats.mistakes.filter((m) => refs.has(m.ref));
    if (settings.mistakeBias && relevant.length && rand() < 0.3) {
      const m = relevant[Math.floor(rand() * relevant.length)];
      const r = await loadRef(m.ref);
      const node = r?.spot.nodes[m.history.join(',')];
      if (r && node) {
        const hi = r.spot.hands[node.player].indexOf(m.hand);
        if (hi >= 0 && node.weights[node.player][hi] > 0)
          return { ref: m.ref, spot: r.spot, history: m.history, node, type: nodeType(r.spot, m.history), handIndex: hi, hand: m.hand, group: r.group, fromMistakes: true };
      }
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      let ref: string;
      if (settings.source === 'pre') {
        if (flopPool.length === 0) throw new Error('没有符合筛选条件的翻牌');
        const f = flopPool[weightedPick(flopPool.map((x) => x.weight), rand)];
        ref = `pre:${f.sc.dir}/${f.flop}`;
      } else {
        if (settings.solves.length === 0) throw new Error('请至少选择一个求解结果');
        ref = `solve:${settings.solves[Math.floor(rand() * settings.solves.length)]}`;
      }
      const r = await loadRef(ref);
      if (!r) continue;
      const qq = questionFromSpot(r.spot, ref, r.group, settings.types, stats, rand);
      if (qq) return qq;
    }
    throw new Error('在所选的局面里找不到符合条件的决策点（可以放宽"决策点类型"）');
  }, [settings, flopPool]);

  const total = retry ? retry.length : settings.rounds;

  const deal = useCallback(
    async (prev: Answer[]) => {
      setErr('');
      if (retry) {
        const nq = retry[prev.length];
        if (!nq) return setPhase('summary');
        setQ({ ...nq, fromMistakes: true });
        return setPhase('question');
      }
      if (prev.length >= settings.rounds) return setPhase('summary');
      setPhase('loading');
      try {
        setQ(await makeQuestion());
        setPhase('question');
      } catch (e) {
        setErr((e as Error).message);
        setPhase('setup');
      }
    },
    [retry, settings.rounds, makeQuestion],
  );

  const start = (r: PfQuestion[] | null = null) => {
    statsRef.current = loadPfStats();
    setAnswers([]);
    setRetry(r);
    if (r) {
      setQ(r[0]);
      setPhase('question');
    } else {
      void (async () => {
        setPhase('loading');
        try {
          setQ(await makeQuestion());
          setPhase('question');
        } catch (e) {
          setErr((e as Error).message);
          setPhase('setup');
        }
      })();
    }
  };

  const answer = useCallback(
    (a: number) => {
      if (!q || phase !== 'question' || a < 0 || a >= q.node.actions.length) return;
      const g = gradeQuestion(q, a);
      recordPf(statsRef.current, { ref: q.ref, history: q.history, hand: q.hand, group: q.group, type: q.type, title: q.spot.title }, a, g.grade, g.evLoss / CHIPS_PER_BB);
      savePfStats(statsRef.current);
      setAnswers((p) => [...p, { q, chosen: a, grade: g.grade, freq: g.freq, evLoss: g.evLoss }]);
      setPhase('feedback');
    },
    [q, phase],
  );

  const next = useCallback(() => void deal(answers), [deal, answers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (phase === 'question' && q) {
        let a = -1;
        if (/^[1-9]$/.test(k)) a = Number(k) - 1;
        else {
          const kinds = q.node.actions.map((c) => parseAction(c).kind);
          if (k === 'F') a = kinds.indexOf('fold');
          if (k === 'X') a = kinds.indexOf('check');
          if (k === 'C') a = kinds.indexOf('call');
          if (k === 'A') a = kinds.indexOf('allin');
          if (k === 'R') a = kinds.findIndex((x) => x === 'raise' || x === 'allin');
          if (k === 'B') a = kinds.indexOf('bet');
        }
        if (a >= 0 && a < q.node.actions.length) {
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

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  if (phase === 'setup') {
    return (
      <div className="page">
        <h1>翻后训练</h1>
        <p className="muted">随机给出局面、翻牌、手牌和前面的行动，你选择动作，按求解结果判分（最佳 / 可接受 / 错误）并显示 EV 损失。只练翻牌圈的决策点。</p>
        <div className="card">
          <h3>题目来源</h3>
          <div className="seg">
            <button className={settings.source === 'pre' ? 'on' : ''} onClick={() => setSettings({ ...settings, source: 'pre' })}>
              预计算牌面库
            </button>
            <button className={settings.source === 'solve' ? 'on' : ''} onClick={() => setSettings({ ...settings, source: 'solve' })}>
              我求解的局面
            </button>
          </div>
          {settings.source === 'pre' ? (
            <>
              {indexErr && <div className="err-box">{indexErr}</div>}
              <h3>局面（不选 = 全部）</h3>
              <div className="chips">
                {scenarios.map((s) => (
                  <button key={s.id} className={`chip ${settings.scenarios.includes(s.id) ? 'on' : ''}`} onClick={() => setSettings({ ...settings, scenarios: toggle(settings.scenarios, s.id) })}>
                    {s.title}（{s.flops.length} 个翻牌）
                  </button>
                ))}
              </div>
              <h3>牌面结构筛选（不选 = 全部）</h3>
              <div className="chips">
                {(Object.keys(SUIT_NAMES) as SuitTexture[]).map((s) => (
                  <button key={s} className={`chip ${settings.suits.includes(s) ? 'on' : ''}`} onClick={() => setSettings({ ...settings, suits: toggle(settings.suits, s) })}>
                    {SUIT_NAMES[s]}
                  </button>
                ))}
                {(Object.keys(HIGH_NAMES) as HighTexture[]).map((h) => (
                  <button key={h} className={`chip ${settings.highs.includes(h) ? 'on' : ''}`} onClick={() => setSettings({ ...settings, highs: toggle(settings.highs, h) })}>
                    {HIGH_NAMES[h]}
                  </button>
                ))}
                <button className={`chip ${settings.paired === true ? 'on' : ''}`} onClick={() => setSettings({ ...settings, paired: settings.paired === true ? null : true })}>
                  只要{PAIR_NAMES.paired}
                </button>
                <button className={`chip ${settings.paired === false ? 'on' : ''}`} onClick={() => setSettings({ ...settings, paired: settings.paired === false ? null : false })}>
                  不要对子面
                </button>
              </div>
              <p className="muted small">符合条件：{flopPool.length} 个（局面 × 翻牌）。出题时按翻牌在实战中的出现概率加权。</p>
            </>
          ) : (
            <>
              <h3>选择求解结果</h3>
              {solves.length === 0 && (
                <p className="muted">
                  还没有缓存的求解结果。先去 <a href="#/solver">翻后求解器</a> 求解一个局面。
                </p>
              )}
              <div className="chips">
                {solves.map((s) => (
                  <button key={s.key} className={`chip ${settings.solves.includes(s.key) ? 'on' : ''}`} onClick={() => setSettings({ ...settings, solves: toggle(settings.solves, s.key) })}>
                    {s.title}
                  </button>
                ))}
              </div>
              <p className="muted small">只能在缓存过的节点（翻牌圈全部决策点 + 你浏览过的节点）里出题。</p>
            </>
          )}
          <h3>决策点类型</h3>
          <div className="chips">
            {(Object.keys(NODE_TYPE_NAMES) as NodeType[]).map((t) => (
              <button key={t} className={`chip ${settings.types.includes(t) ? 'on' : ''}`} onClick={() => setSettings({ ...settings, types: toggle(settings.types, t) })}>
                {NODE_TYPE_NAMES[t]}
              </button>
            ))}
          </div>
          <h3>每轮题数</h3>
          <div className="seg">
            {[10, 20, 50].map((n) => (
              <button key={n} className={settings.rounds === n ? 'on' : ''} onClick={() => setSettings({ ...settings, rounds: n })}>
                {n}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.mistakeBias} onChange={(e) => setSettings({ ...settings, mistakeBias: e.target.checked })} />
            多出我常错的题（约 30% 来自错题本，并按各类决策点的错误率加权）
          </label>
          <p className="muted small">
            判分：频率与最高频率相差 5% 以内为"最佳"；频率 ≥10% 或 EV 损失 ≤1% 底池为"可接受"；其余为"错误"。快捷键：数字 1~{9} 按顺序选择，F 弃牌、X 过牌、C 跟注、B 下注、R 加注、A 全下；空格/回车下一题。
          </p>
          {err && <div className="err-box">{err}</div>}
          <button className="btn primary big" onClick={() => start()} disabled={settings.source === 'pre' ? flopPool.length === 0 : settings.solves.length === 0}>
            开始训练
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'summary') return <Summary answers={answers} onAgain={() => start()} onRetry={(r) => start(r)} onSetup={() => setPhase('setup')} />;

  if (phase === 'loading' || !q) return <div className="card">正在出题…</div>;

  const node = q.node;
  const players = q.spot.players ?? ['OOP', 'IP'];
  const me = node.player;
  const n = q.spot.hands[me].length;
  const last = answers[answers.length - 1];
  const g = phase === 'feedback' && last ? gradeQuestion(q, last.chosen) : null;
  const correct = answers.filter((a) => a.grade !== 'wrong').length;
  const line = describeLine(q.spot, q.history);
  const handCards = [parseCard(q.hand.slice(0, 2)), parseCard(q.hand.slice(2))];

  return (
    <div className="page trainer">
      <div className="trainer-top">
        <span>
          第 <strong>{Math.min(answers.length + (phase === 'question' ? 1 : 0), total)}</strong> / {total} 题
        </span>
        <span className="muted">
          正确 {correct}/{answers.length} · 累计 EV 损失 {bb(answers.reduce((s, a) => s + a.evLoss, 0))}
        </span>
        <button className="link" onClick={() => setPhase('summary')}>
          结束本轮
        </button>
      </div>
      <div className="trainer-layout">
        <div className="trainer-main">
          <div className="spot-desc">
            <span className="tag">{NODE_TYPE_NAMES[q.type]}</span>
            {q.fromMistakes && <span className="tag warn">错题重练</span>}
            <div>
              <strong>{q.spot.title.split(' · ')[0]}</strong>，有效筹码 {bb(q.spot.config.stack, 1)}
            </div>
            <div className="muted small">{textureLabel(flopTexture(q.spot.config.board))}</div>
          </div>
          <div className="hero-hand">
            <span className="muted">翻牌</span> <CardRow cards={parseCards(q.spot.config.board)} size="lg" />
          </div>
          <div className="stat-line">
            <span>底池 {bb(node.pot, 1)}（含本街已下注）</span>
            <span>行动：{line || '翻牌圈第一个行动'}</span>
          </div>
          <div className="hero-hand">
            <span>
              你是 <strong>{players[me]}</strong>（{me === 0 ? '不在位' : '在位'}）
            </span>
            <CardRow cards={handCards} size="lg" />
          </div>
          <div className="action-bar">
            {node.actions.map((c, i) => (
              <button
                key={i}
                className={`act ${phase === 'feedback' && last?.chosen === i ? 'chosen' : ''}`}
                style={{ background: actionColor(c, node), color: '#fff' }}
                disabled={phase !== 'question'}
                onClick={() => answer(i)}
              >
                {describeAction(c, node)}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
        {phase === 'feedback' && last && g && (
          <div className="trainer-feedback">
            <div className={`grade grade-${last.grade}`}>
              {last.grade === 'best' ? '✓ ' : last.grade === 'ok' ? '≈ ' : '✗ '}
              {GRADE_NAMES[last.grade]}
              <div className="small">
                你选择了「{describeAction(node.actions[last.chosen], node)}」，求解器频率 {(last.freq * 100).toFixed(0)}%，EV 损失 {bb(last.evLoss)}（{((last.evLoss / node.pot) * 100).toFixed(1)}% 底池）
              </div>
            </div>
            <div className="card">
              <table className="combo-table">
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>频率</th>
                    <th>EV</th>
                  </tr>
                </thead>
                <tbody>
                  {node.actions.map((c, a) => (
                    <tr key={a} style={a === g.best ? { fontWeight: 700 } : undefined}>
                      <td>
                        <span className="swatch" style={{ background: actionColor(c, node) }} /> {describeAction(c, node)}
                      </td>
                      <td className="mono">{(g.freqs[a] * 100).toFixed(0)}%</td>
                      <td className="mono">{bb(g.evs[a])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                EV 为这手牌采取该动作后的期望收益（相对弃牌）。求解精度：可被利用度 {((q.spot.exploitability / q.spot.config.pot) * 100).toFixed(2)}% 底池；尺寸只有 {q.spot.config.sizes[1].flop.bet || '—'} 等少数选项，结论只在这个简化博弈树内成立。
              </p>
            </div>
            <button className="btn primary big" onClick={next}>
              下一题（空格 / 回车）
            </button>
            <PostflopGrid
              agg={aggregate(node, q.spot.hands[me], me)}
              actions={node.actions.map((c) => ({ label: shortAction(c, node), color: actionColor(c, node) }))}
              highlight={null}
              compact
            />
            <p className="muted small">
              {players[me]} 在这个节点的整体策略（{n} 个组合）。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ answers, onAgain, onRetry, onSetup }: { answers: Answer[]; onAgain: () => void; onRetry: (q: PfQuestion[]) => void; onSetup: () => void }) {
  const n = answers.length;
  const best = answers.filter((a) => a.grade === 'best').length;
  const ok = answers.filter((a) => a.grade === 'ok').length;
  const wrong = answers.filter((a) => a.grade === 'wrong');
  const loss = answers.reduce((s, a) => s + a.evLoss, 0);
  return (
    <div className="page">
      <h1>本轮总结（翻后）</h1>
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
        <div className="tile">
          <div className="tile-num">{n ? bb(loss / n) : '0'}</div>
          <div className="muted">平均每题 EV 损失</div>
        </div>
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
              const node = w.q.node;
              const g = gradeQuestion(w.q, w.chosen);
              return (
                <div key={i} className="review-item">
                  <div className="review-head">
                    <CardRow cards={[parseCard(w.q.hand.slice(0, 2)), parseCard(w.q.hand.slice(2))]} size="sm" />
                    <CardRow cards={parseCards(w.q.spot.config.board)} size="sm" />
                    <div>
                      <strong>{w.q.spot.title.split(' · ')[0]}</strong>
                      <div className="muted small">{describeLine(w.q.spot, w.q.history) || '翻牌圈第一个行动'}</div>
                    </div>
                  </div>
                  <div className="small">
                    你选择了「{describeAction(node.actions[w.chosen], node)}」（EV 损失 {bb(w.evLoss)}），求解器：
                    {node.actions.map((c, a) => (
                      <span key={a} className="freq-pill" style={{ borderColor: actionColor(c, node) }}>
                        {shortAction(c, node)} {(g.freqs[a] * 100).toFixed(0)}%
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
