import { useEffect, useRef, useState } from 'react';
import { CardRow } from '../components/Cards.tsx';
import { parseCards, cardToString } from '../lib/cards.ts';
import { type Position, POSITION_SHORT, makeFormat, positionsOf } from '../lib/formats.ts';
import { type HAction, type HKind, type HandRecord, type Street, STREET_NAMES, parseHandHistory } from '../lib/handHistory.ts';
import { type PostflopSetup, type ReviewStep, type WalkSource, postflopSetup, reviewPostflop, reviewPreflop } from '../lib/handReview.ts';
import { SchemeBar } from '../components/SchemePanel.tsx';
import { findPrecomputed } from '../postflop/precomputed.ts';
import { scenarioRanges, toChips } from '../postflop/scenarios.ts';
import { SIZE_PRESETS } from '../postflop/presets.ts';
import { SolverClient } from '../postflop/solverClient.ts';
import { configKey, getSolve, putSolve } from '../postflop/cache.ts';
import { collectStreet, liveSource } from '../postflop/sources.ts';
import { historyKey, type SolveConfig, type SolvedSpot } from '../postflop/types.ts';
import { solverLink } from './SolverPage.tsx';
import { load, save } from '../lib/storage.ts';

const GRADE: Record<string, string> = { best: '✓ 最佳', ok: '≈ 可接受', wrong: '✗ 错误' };

export const SAMPLE_HH = `PokerStars Hand #250000000001:  Hold'em No Limit ($0.50/$1.00 USD) - 2026/01/15 21:00:00 ET
Table 'Example' 6-max Seat #4 is the button
Seat 1: PlayerA ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
Seat 4: Hero ($100 in chips)
Seat 5: PlayerE ($100 in chips)
Seat 6: PlayerF ($100 in chips)
PlayerE: posts small blind $0.50
PlayerF: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Jd]
PlayerA: folds
PlayerB: folds
PlayerC: folds
Hero: raises $1.50 to $2.50
PlayerE: folds
PlayerF: calls $1.50
*** FLOP *** [Qs 8h 3d]
PlayerF: checks
Hero: bets $1.82
PlayerF: calls $1.82
*** TURN *** [Qs 8h 3d] [2c]
PlayerF: checks
Hero: checks
*** RIVER *** [Qs 8h 3d 2c] [7s]
PlayerF: bets $6
Hero: folds
Uncalled bet ($6) returned to PlayerF
PlayerF collected $14.14 from pot
*** SUMMARY ***
Total pot $14.14 | Rake $0
Board [Qs 8h 3d 2c 7s]`;

interface Manual {
  game: 'cash' | 'mtt';
  players: 6 | 9;
  stackBB: number;
  hero: Position;
  cards: string;
  board: string;
  actions: HAction[];
}

const DEFAULT_MANUAL: Manual = {
  game: 'cash',
  players: 6,
  stackBB: 100,
  hero: 'BTN',
  cards: 'AhJd',
  board: 'Qs8h3d2c7s',
  actions: [
    { street: 0, pos: 'BTN', kind: 'raise', amount: 2.5 },
    { street: 0, pos: 'BB', kind: 'call', amount: 1.5 },
    { street: 1, pos: 'BB', kind: 'check', amount: 0 },
    { street: 1, pos: 'BTN', kind: 'bet', amount: 1.8 },
    { street: 1, pos: 'BB', kind: 'call', amount: 1.8 },
  ],
};

function manualToRecord(m: Manual): HandRecord {
  const cards = parseCards(m.cards);
  if (cards.length !== 2) throw new Error('手牌需要 2 张，例如 AhJd');
  const board = m.board.trim() ? parseCards(m.board) : [];
  if (board.length > 5 || (board.length > 0 && board.length < 3)) throw new Error('公共牌需要 0 或 3~5 张');
  if (board.some((c) => cards.includes(c))) throw new Error('公共牌与手牌重复');
  return {
    game: m.game,
    players: m.players,
    stacks: {},
    stackBB: m.stackBB,
    antePerPlayer: m.game === 'mtt' ? 1 / m.players : 0,
    hero: m.hero,
    heroCards: [cards[0], cards[1]],
    board,
    actions: m.actions,
    source: '手动输入',
    warnings: [],
  };
}

export function ReviewPage() {
  const [mode, setMode] = useState<'manual' | 'hh'>('manual');
  const [manual, setManual] = useState<Manual>(() => load('reviewManual', DEFAULT_MANUAL));
  const [hh, setHh] = useState('');
  const [rec, setRec] = useState<HandRecord | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => save('reviewManual', manual), [manual]);

  const run = () => {
    setErr('');
    try {
      setRec(mode === 'manual' ? manualToRecord(manual) : parseHandHistory(hh));
    } catch (e) {
      setRec(null);
      setErr((e as Error).message);
    }
  };

  return (
    <div className="page">
      <h1>手牌复盘</h1>
      <p className="muted">输入一手已经结束的牌，逐个决策点对照翻前范围和翻后求解结果。只用于牌局结束后的复盘，不读取牌桌、不做实时提示。</p>
      <SchemeBar />
      <div className="tabs">
        <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>
          手动输入
        </button>
        <button className={mode === 'hh' ? 'on' : ''} onClick={() => setMode('hh')}>
          粘贴手牌历史
        </button>
      </div>
      <div className="card">
        {mode === 'manual' ? (
          <ManualForm m={manual} set={setManual} />
        ) : (
          <>
            <p className="muted small">支持 PokerStars 格式，以及结构相同的 GGPoker / Natural8 等（第一行含 "Hand #"）。只读取行动和金额；玩家名称不会保存或上传。</p>
            <textarea rows={14} value={hh} onChange={(e) => setHh(e.target.value)} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12 }} placeholder="粘贴一手牌的完整历史文本…" />
            <button className="btn small" onClick={() => setHh(SAMPLE_HH)}>
              填入示例
            </button>
          </>
        )}
        {err && <div className="err-box">{err}</div>}
        <div className="btn-row">
          <button className="btn primary big" onClick={run}>
            开始复盘
          </button>
        </div>
      </div>
      {rec && <ReviewResult key={JSON.stringify(rec)} rec={rec} />}
    </div>
  );
}

function ManualForm({ m, set }: { m: Manual; set: (m: Manual) => void }) {
  const f = makeFormat(m.game, m.players, m.game === 'cash' ? 100 : 20);
  const pos = positionsOf(f);
  const upd = (p: Partial<Manual>) => set({ ...m, ...p });
  const setAction = (i: number, p: Partial<HAction>) => upd({ actions: m.actions.map((a, k) => (k === i ? { ...a, ...p } : a)) });
  let boardCards: number[] = [];
  try {
    boardCards = m.board.trim() ? parseCards(m.board) : [];
  } catch {
    /* 输入中 */
  }
  return (
    <div>
      <div className="pf-form">
        <div className="field">
          <label>牌局</label>
          <div className="seg">
            <button className={m.game === 'cash' ? 'on' : ''} onClick={() => upd({ game: 'cash', stackBB: 100 })}>
              现金局
            </button>
            <button className={m.game === 'mtt' ? 'on' : ''} onClick={() => upd({ game: 'mtt', stackBB: 20 })}>
              锦标赛（大盲前注 1bb）
            </button>
          </div>
          <div className="seg" style={{ marginTop: 4 }}>
            {([6, 9] as const).map((p) => (
              <button key={p} className={m.players === p ? 'on' : ''} onClick={() => upd({ players: p, hero: positionsOf(makeFormat(m.game, p, 100)).includes(m.hero) ? m.hero : 'BTN' })}>
                {p} 人桌
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>有效筹码（bb）</label>
          <input type="number" min={1} step={1} value={m.stackBB} onChange={(e) => upd({ stackBB: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>你的位置 / 手牌</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={m.hero} onChange={(e) => upd({ hero: e.target.value as Position })}>
              {pos.map((p) => (
                <option key={p} value={p}>
                  {POSITION_SHORT[p]}
                </option>
              ))}
            </select>
            <input value={m.cards} onChange={(e) => upd({ cards: e.target.value })} style={{ width: 90 }} placeholder="AhJd" />
          </div>
        </div>
        <div className="field">
          <label>公共牌（0~5 张）</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={m.board} onChange={(e) => upd({ board: e.target.value })} style={{ width: 140 }} placeholder="Qs8h3d2c7s" />
            <CardRow cards={boardCards} size="sm" />
          </div>
        </div>
      </div>
      <h3>行动（按顺序；金额单位 bb）</h3>
      <p className="muted small">翻前没有列出的玩家视为弃牌。加注/下注填"到多少"（本街总额），跟注填本次投入的额度。</p>
      <div className="action-rows">
        {([0, 1, 2, 3] as Street[]).map((st) => (
          <div key={st}>
            <strong className="small">{STREET_NAMES[st]}</strong>
            {m.actions.map((a, i) =>
              a.street !== st ? null : (
                <div className="row" key={i}>
                  <select value={a.pos} onChange={(e) => setAction(i, { pos: e.target.value as Position })}>
                    {pos.map((p) => (
                      <option key={p} value={p}>
                        {POSITION_SHORT[p]}
                        {p === m.hero ? '（你）' : ''}
                      </option>
                    ))}
                  </select>
                  <select value={a.kind} onChange={(e) => setAction(i, { kind: e.target.value as HKind })}>
                    <option value="fold">弃牌</option>
                    <option value="check">过牌</option>
                    <option value="call">跟注</option>
                    <option value="bet">下注</option>
                    <option value="raise">加注到</option>
                  </select>
                  {(a.kind === 'call' || a.kind === 'bet' || a.kind === 'raise') && (
                    <input type="number" min={0} step={0.1} value={a.amount} onChange={(e) => setAction(i, { amount: Number(e.target.value) })} />
                  )}
                  {(a.kind === 'bet' || a.kind === 'raise') && (
                    <label className="check small">
                      <input type="checkbox" checked={!!a.allin} onChange={(e) => setAction(i, { allin: e.target.checked || undefined })} /> 全下
                    </label>
                  )}
                  <button className="link" onClick={() => upd({ actions: m.actions.filter((_, k) => k !== i) })}>
                    删除
                  </button>
                </div>
              ),
            )}
            <button
              className="link small"
              onClick={() => {
                const last = [...m.actions].reverse().find((x) => x.street === st);
                const actions = [...m.actions];
                // 插在这条街最后一个行动之后
                let at = actions.length;
                for (let k = actions.length - 1; k >= 0; k--)
                  if (actions[k].street <= st) {
                    at = k + 1;
                    break;
                  }
                if (!actions.some((x) => x.street <= st)) at = 0;
                actions.splice(at, 0, { street: st, pos: last?.pos ?? m.hero, kind: 'check', amount: 0 });
                upd({ actions });
              }}
            >
              + 添加{STREET_NAMES[st]}行动
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepView({ s }: { s: ReviewStep }) {
  return (
    <div className={`review-step ${s.grade ?? ''}`}>
      <div>
        <strong>{s.title}</strong> · 你：{s.heroAction || '—'} {s.grade && <span className={`tag grade-${s.grade}`}>{GRADE[s.grade]}</span>}
        {s.evLoss !== undefined && s.evLoss > 0.005 && <span className="muted small"> EV 损失 {s.evLoss.toFixed(2)}bb</span>}
      </div>
      {s.freqs.length > 0 && (
        <div className="small">
          {s.freqs.map((f, i) => (
            <span key={i} className="freq-pill" style={f.chosen ? { borderColor: 'var(--accent)', fontWeight: 700 } : undefined}>
              {f.label} {(f.freq * 100).toFixed(0)}%{f.ev !== undefined ? ` · EV ${f.ev.toFixed(2)}bb` : ''}
            </span>
          ))}
        </div>
      )}
      {s.note && <div className="muted small">{s.note}</div>}
      {s.source && <div className="muted small">依据：{s.source}</div>}
    </div>
  );
}

function ReviewResult({ rec }: { rec: HandRecord }) {
  const pre = reviewPreflop(rec);
  const pf = postflopSetup(rec, pre.format);
  return (
    <div className="card">
      <h2>复盘结果</h2>
      <div className="stat-line">
        <span>{rec.source}</span>
        <span>{pre.format.label}</span>
        <span>
          你在 {POSITION_SHORT[rec.hero]} <CardRow cards={rec.heroCards} size="sm" />
        </span>
        {rec.board.length > 0 && (
          <span>
            公共牌 <CardRow cards={rec.board} size="sm" />
          </span>
        )}
      </div>
      {[...rec.warnings, ...(pre.note ? [pre.note] : [])].map((w, i) => (
        <div key={i} className="warn-box small">
          {w}
        </div>
      ))}
      <h3>翻前</h3>
      {pre.steps.length === 0 && <p className="muted">翻前没有你的决策（例如大盲位前面全部弃牌）。</p>}
      {pre.steps.map((s, i) => (
        <StepView key={i} s={s} />
      ))}
      <h3>翻后</h3>
      {pf.reason ? <p className="muted">{pf.reason}，无法对照翻后求解结果。</p> : pf.setup && <PostflopReview rec={rec} setup={pf.setup} />}
    </div>
  );
}

function reviewConfig(setup: PostflopSetup, board: string, presetId: string): SolveConfig {
  const r = scenarioRanges(setup.scenario);
  const p = SIZE_PRESETS.find((x) => x.id === presetId)!;
  return {
    ranges: [r.oop, r.ip],
    board,
    pot: toChips(setup.potBB),
    stack: toChips(setup.stackBB),
    sizes: [structuredClone(p.oop), structuredClone(p.ip)],
    raiseCap: [...p.raiseCap],
    donkTurn: '',
    donkRiver: '',
  };
}

function PostflopReview({ rec, setup }: { rec: HandRecord; setup: PostflopSetup }) {
  const flop = rec.board.slice(0, 3).map(cardToString).join('');
  const [steps, setSteps] = useState<ReviewStep[] | null>(null);
  const [srcLabel, setSrcLabel] = useState('');
  const [solving, setSolving] = useState<{ iter: number; expl: number | null; sec: number } | null>(null);
  const [err, setErr] = useState('');
  const [preset, setPreset] = useState('simple');
  const clientRef = useRef<SolverClient | null>(null);
  useEffect(() => () => clientRef.current?.terminate(), []);

  const cfg = reviewConfig(setup, flop, preset);
  const players: [string, string] = [POSITION_SHORT[setup.scenario.oop], POSITION_SHORT[setup.scenario.ip]];

  // 自动：先找预计算牌面库，再找本地缓存
  useEffect(() => {
    let cancel = false;
    (async () => {
      const cached = await getSolve(configKey(cfg));
      if (cached && !cancel) {
        const src: WalkSource = { hands: cached.hands, getNode: async (h) => cached.nodes[historyKey(h)] ?? null, label: '本地缓存的求解结果', expl: `可被利用度 ${((cached.exploitability / cached.config.pot) * 100).toFixed(2)}% 底池` };
        setSteps(await reviewPostflop(rec, setup, src, { potScale: 1 }));
        setSrcLabel('本地缓存的求解结果（只包含翻牌圈和看过的节点）');
        return;
      }
      const pre = await findPrecomputed(setup.scenario.id, flop);
      if (pre && !cancel) {
        const sp = pre.spot;
        const src: WalkSource = { hands: sp.hands, getNode: async (h) => sp.nodes[historyKey(h)] ?? null, label: '预计算牌面库', expl: `可被利用度 ${((sp.exploitability / sp.config.pot) * 100).toFixed(2)}% 底池` };
        const potScale = sp.config.pot / toChips(setup.potBB);
        setSteps(await reviewPostflop(rec, setup, src, { suitMap: pre.map, potScale }));
        setSrcLabel(`预计算牌面库（与 ${sp.config.board} 花色同构；只包含翻牌圈）`);
      }
    })().catch((e) => setErr(String(e)));
    return () => {
      cancel = true;
    };
  }, [preset]);

  const solve = async () => {
    setErr('');
    clientRef.current?.terminate();
    const client = new SolverClient();
    clientRef.current = client;
    try {
      const info = await client.init(cfg);
      const need = info.memory[0] > 1000 * 2 ** 20 ? info.memory[1] : info.memory[0];
      if (need > 3200 * 2 ** 20) throw new Error(`需要约 ${(need / 2 ** 30).toFixed(1)}GB 内存，超出浏览器上限，请换"快速"预设`);
      setSolving({ iter: 0, expl: null, sec: 0 });
      client.onProgress = (p) => setSolving((o) => ({ iter: p.iter, expl: p.expl ?? o?.expl ?? null, sec: p.seconds }));
      const done = await client.solve(info.memory[0] > 1000 * 2 ** 20, 1, 600);
      const spot: SolvedSpot = {
        key: configKey(cfg),
        title: `${setup.scenario.title} · ${flop}（复盘）`,
        config: cfg,
        hands: info.hands,
        nodes: {},
        exploitability: done.expl,
        iterations: done.iter,
        seconds: done.seconds,
        memoryMB: done.memMB,
        compressed: info.memory[0] > 1000 * 2 ** 20,
        created: Date.now(),
        players,
        scenario: setup.scenario.id,
      };
      await collectStreet(client, spot);
      void putSolve(spot).catch(() => undefined);
      const live = liveSource(client, spot);
      const src: WalkSource = { hands: info.hands, getNode: live.getNode, label: '浏览器求解', expl: `可被利用度 ${((done.expl / cfg.pot) * 100).toFixed(2)}% 底池` };
      setSteps(await reviewPostflop(rec, setup, src, { potScale: 1 }));
      setSrcLabel(`浏览器求解（${SIZE_PRESETS.find((x) => x.id === preset)!.name}，${done.iter} 轮，${done.seconds.toFixed(0)} 秒）`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSolving(null);
    }
  };

  return (
    <div>
      <p className="muted small">
        局面：{setup.scenario.title}，翻牌圈底池 {setup.potBB}bb，有效筹码 {setup.stackBB}bb。双方翻前范围取自当前范围方案；翻后博弈树是简化的（下注尺寸有限），实际下注额会映射到最接近的尺寸。
      </p>
      {srcLabel && <p className="small">数据来源：{srcLabel}</p>}
      {steps?.map((s, i) => <StepView key={i} s={s} />)}
      {steps && steps.length === 0 && <p className="muted">翻后没有你的决策可以对照。</p>}
      {err && <div className="err-box">{err}</div>}
      {solving ? (
        <div className="warn-box">
          求解中… {solving.iter} 轮，{solving.sec.toFixed(0)} 秒，可被利用度 {solving.expl === null ? '—' : `${((solving.expl / cfg.pot) * 100).toFixed(2)}%`} 底池（目标 1%）
          <button className="link" onClick={() => clientRef.current?.stop()}>
            停止并使用当前结果
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <div className="seg">
            {SIZE_PRESETS.slice(0, 2).map((p) => (
              <button key={p.id} className={preset === p.id ? 'on' : ''} onClick={() => setPreset(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={solve}>
            用浏览器求解器分析翻后（含转牌、河牌，约 1~3 分钟）
          </button>
          <a
            className="btn"
            href={solverLink({ scenarioId: setup.scenario.id, title: setup.scenario.title, players, oop: cfg.ranges[0], ip: cfg.ranges[1], board: flop, potBB: setup.potBB, stackBB: setup.stackBB, presetId: preset, sizes: cfg.sizes, raiseCap: cfg.raiseCap })}
          >
            在求解器中打开
          </a>
        </div>
      )}
    </div>
  );
}
