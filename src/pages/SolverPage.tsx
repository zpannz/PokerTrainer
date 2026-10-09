import { useEffect, useMemo, useRef, useState } from 'react';
import { useFormat } from '../components/FormatContext.tsx';
import { RangeGrid } from '../components/RangeGrid.tsx';
import { CardPicker, CardRow } from '../components/Cards.tsx';
import { SpotExplorer, type NodeSource } from '../components/SpotExplorer.tsx';
import { parseCards, cardToString } from '../lib/cards.ts';
import { NUM_CLASSES, rangeCombos } from '../lib/hands.ts';
import { formatRange, parseRange } from '../lib/rangeText.ts';
import { isPushFold, POSITION_SHORT } from '../lib/formats.ts';
import { SIZE_PRESETS, applyPreset } from '../postflop/presets.ts';
import { scenarioList, scenarioRanges, parseScenarioId, toChips } from '../postflop/scenarios.ts';
import { SolverClient, type Progress } from '../postflop/solverClient.ts';
import { configKey, deleteSolve, getSolve, listSolves, putSolve, type SolveSummary } from '../postflop/cache.ts';
import { cacheSource, collectStreet, liveSource } from '../postflop/sources.ts';
import { CHIPS_PER_BB, type GameInfo, type PlayerSizes, type SolveConfig, type SolvedSpot } from '../postflop/types.ts';
import { activeSchemeName } from '../data/overrides.ts';
import { load, save } from '../lib/storage.ts';

interface Form {
  scenarioId: string;
  title: string;
  players: [string, string];
  oop: string;
  ip: string;
  board: string;
  potBB: number;
  stackBB: number;
  presetId: string;
  sizes: [PlayerSizes, PlayerSizes];
  raiseCap: [number, number, number];
  targetPct: number;
  maxIter: number;
  compress: 'auto' | 'on' | 'off';
}

const STREETS = [
  ['flop', '翻牌'],
  ['turn', '转牌'],
  ['river', '河牌'],
] as const;

/** 浏览器 WebAssembly（32 位）内存上限 4GB；超过 3.2GB 基本无法运行 */
const HARD_LIMIT_MB = 3200;
const WARN_MB = 1500;

function defaultForm(formatId: string): Form {
  const list = scenarioList(formatId);
  const sc = list.find((s) => s.aggressor === 'BTN' && s.caller === 'BB' && s.type === 'srp') ?? list[0];
  const preset = SIZE_PRESETS[0];
  const f: Form = {
    scenarioId: sc?.id ?? '',
    title: sc?.title ?? '自定义局面',
    players: sc ? [POSITION_SHORT[sc.oop], POSITION_SHORT[sc.ip]] : ['OOP', 'IP'],
    oop: '',
    ip: '',
    board: 'Qs8h3d',
    potBB: sc?.potBB ?? 5.5,
    stackBB: sc?.stackBB ?? 97.5,
    presetId: preset.id,
    sizes: [structuredClone(preset.oop), structuredClone(preset.ip)],
    raiseCap: [...preset.raiseCap],
    targetPct: 0.5,
    maxIter: 1000,
    compress: 'auto',
  };
  if (sc) {
    const r = scenarioRanges(sc);
    f.oop = r.oop;
    f.ip = r.ip;
  }
  return f;
}

function readHashConfig(): Partial<Form> | null {
  const q = window.location.hash.split('?')[1];
  if (!q) return null;
  const p = new URLSearchParams(q).get('cfg');
  if (!p) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch {
    return null;
  }
}

/** 生成跳转到求解器并预填配置的链接（复盘页使用） */
export function solverLink(f: Partial<Form>): string {
  return `#/solver?cfg=${btoa(unescape(encodeURIComponent(JSON.stringify(f))))}`;
}

function toConfig(f: Form): SolveConfig {
  return {
    ranges: [f.oop, f.ip],
    board: f.board.replace(/\s+/g, ''),
    pot: toChips(f.potBB),
    stack: toChips(f.stackBB),
    sizes: f.sizes,
    raiseCap: f.raiseCap,
    donkTurn: '',
    donkRiver: '',
  };
}

type Phase = 'edit' | 'ready' | 'solving' | 'done';

export function SolverPage() {
  const { format } = useFormat();
  const [form, setForm] = useState<Form>(() => {
    const fromHash = readHashConfig();
    const base = load<Form | null>('solverForm', null) ?? defaultForm(format.game === 'cash' || !isPushFold(format) ? format.id : 'cash6-100');
    return fromHash ? { ...base, ...fromHash } : base;
  });
  const [phase, setPhase] = useState<Phase>('edit');
  const [info, setInfo] = useState<GameInfo | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Progress & { lastExpl: number | null }>({ iter: 0, expl: null, seconds: 0, memMB: 0, lastExpl: null });
  const [spot, setSpot] = useState<SolvedSpot | null>(null);
  const [source, setSource] = useState<NodeSource | null>(null);
  const [cached, setCached] = useState<SolvedSpot | null>(null);
  const [history, setHistory] = useState<SolveSummary[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [gridEdit, setGridEdit] = useState<0 | 1 | null>(null);
  const clientRef = useRef<SolverClient | null>(null);

  useEffect(() => save('solverForm', form), [form]);
  useEffect(() => {
    void listSolves().then(setHistory);
    return () => clientRef.current?.terminate();
  }, []);

  const cfg = useMemo(() => toConfig(form), [form]);
  const key = useMemo(() => configKey(cfg), [cfg]);
  useEffect(() => {
    let c = false;
    void getSolve(key).then((s) => !c && setCached(s ?? null));
    return () => {
      c = true;
    };
  }, [key]);

  const upd = (p: Partial<Form>) => {
    setForm((f) => ({ ...f, ...p }));
    if (phase === 'ready') setPhase('edit');
  };

  const scenarios = useMemo(() => scenarioList(isPushFold(format) ? 'cash6-100' : format.id), [format.id]);
  const pickScenario = (id: string) => {
    if (!id) {
      upd({ scenarioId: '', title: '自定义局面', players: ['OOP', 'IP'] });
      return;
    }
    const sc = parseScenarioId(id);
    const r = scenarioRanges(sc);
    upd({ scenarioId: id, title: sc.title, players: [POSITION_SHORT[sc.oop], POSITION_SHORT[sc.ip]], oop: r.oop, ip: r.ip, potBB: sc.potBB, stackBB: sc.stackBB });
  };

  const boardCards = useMemo(() => {
    try {
      return parseCards(form.board);
    } catch {
      return null;
    }
  }, [form.board]);

  const combos = (text: string) => {
    const r = parseRange(text);
    return { n: rangeCombos(r.weights), errors: r.errors };
  };
  const oopC = combos(form.oop);
  const ipC = combos(form.ip);

  const killClient = () => {
    clientRef.current?.terminate();
    clientRef.current = null;
  };

  const estimate = async () => {
    setError('');
    setInfo(null);
    if (!boardCards || boardCards.length < 3 || boardCards.length > 5) {
      setError('公共牌需要 3~5 张，例如 Qs8h3d');
      return;
    }
    if (oopC.errors.length || ipC.errors.length) {
      setError(`范围格式有误：${[...oopC.errors, ...ipC.errors].slice(0, 3).join('；')}`);
      return;
    }
    killClient();
    const client = new SolverClient();
    clientRef.current = client;
    try {
      const i = await client.init(cfg);
      setInfo(i);
      setPhase('ready');
    } catch (e) {
      setError((e as Error).message);
      killClient();
    }
  };

  const memMB = info ? info.memory.map((m) => m / 2 ** 20) : [0, 0];
  const useCompress = form.compress === 'on' || (form.compress === 'auto' && memMB[0] > 1000);
  const needMB = useCompress ? memMB[1] : memMB[0];
  const deviceGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  const start = async () => {
    const client = clientRef.current;
    if (!client || !info) return;
    setPhase('solving');
    setError('');
    setProgress({ iter: 0, expl: null, seconds: 0, memMB: 0, lastExpl: null });
    client.onProgress = (p) => setProgress((old) => ({ ...p, lastExpl: p.expl ?? old.lastExpl }));
    try {
      const done = await client.solve(useCompress, form.targetPct, form.maxIter);
      const s: SolvedSpot = {
        key,
        title: `${form.title} · ${form.board}`,
        config: cfg,
        hands: info.hands,
        nodes: {},
        exploitability: done.expl,
        iterations: done.iter,
        seconds: done.seconds,
        memoryMB: done.memMB,
        compressed: useCompress,
        created: Date.now(),
        players: form.players,
        scenario: form.scenarioId || undefined,
      };
      setProgress((p) => ({ ...p, iter: done.iter, seconds: done.seconds, lastExpl: done.expl, memMB: done.memMB }));
      await collectStreet(client, s);
      try {
        await putSolve(s);
      } catch {
        setError('结果无法保存到浏览器缓存（可能是隐私模式或存储空间不足），仍可在本页查看。');
      }
      setSpot(s);
      setSource(liveSource(client, s));
      setPhase('done');
      void listSolves().then(setHistory);
    } catch (e) {
      setError((e as Error).message);
      setPhase('edit');
      killClient();
    }
  };

  const openCached = (s: SolvedSpot) => {
    killClient();
    setSpot(s);
    setSource(cacheSource(s));
    setPhase('done');
    setInfo(null);
  };

  const pct = (x: number | null) => (x === null ? '—' : `${((x / cfg.pot) * 100).toFixed(2)}%`);
  const target = form.targetPct;
  const prog = progress.lastExpl === null ? 0 : Math.min(1, Math.max(0, Math.log(Math.max(progress.lastExpl / cfg.pot * 100, 1e-6) / 50) / Math.log(target / 50)));

  return (
    <div className="page">
      <h1>翻后求解器</h1>
      <p className="muted">
        在浏览器中计算翻后 GTO 策略（Discounted CFR，单线程 WebAssembly）。所有计算都在本机完成，结果缓存在本机浏览器（IndexedDB）。求解引擎：
        <a href="https://github.com/b-inary/postflop-solver" target="_blank" rel="noreferrer">
          postflop-solver
        </a>
        （AGPL-3.0）。
      </p>

      {phase !== 'done' && (
        <div className="card">
          <h3>1. 局面</h3>
          <div className="pf-form">
            <div className="field">
              <label>从翻前范围库选择（当前数据：{activeSchemeName()}）</label>
              <select value={form.scenarioId} onChange={(e) => pickScenario(e.target.value)}>
                <option value="">自定义（手动输入范围）</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}（{s.format.label}）
                  </option>
                ))}
              </select>
              {isPushFold(format) && <p className="muted small">当前格式是全下/弃牌深度，没有翻后；列出的是 6 人桌现金局 100bb 的局面。</p>}
            </div>
            <div className="field">
              <label>公共牌（3~5 张）</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={form.board} onChange={(e) => upd({ board: e.target.value })} placeholder="Qs8h3d" style={{ width: 130 }} />
                {boardCards && <CardRow cards={boardCards} size="sm" />}
                <button className="btn small" onClick={() => setShowPicker(!showPicker)}>
                  选牌
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    const deck = Array.from({ length: 52 }, (_, i) => i);
                    const pick: number[] = [];
                    while (pick.length < 3) {
                      const c = deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
                      pick.push(c);
                    }
                    upd({ board: pick.sort((a, b) => b - a).map(cardToString).join('') });
                  }}
                >
                  随机翻牌
                </button>
              </div>
              {showPicker && (
                <CardPicker
                  selected={boardCards ?? []}
                  disabled={new Set(boardCards && boardCards.length >= 5 ? Array.from({ length: 52 }, (_, i) => i) : [])}
                  onPick={(c) => {
                    const cur = boardCards ?? [];
                    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
                    upd({ board: next.map(cardToString).join('') });
                  }}
                />
              )}
            </div>
            <div className="field">
              <label>底池 / 有效筹码（bb）</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" step="0.5" min="0.5" value={form.potBB} onChange={(e) => upd({ potBB: Number(e.target.value) })} style={{ width: 90 }} />
                <input type="number" step="0.5" min="0.5" value={form.stackBB} onChange={(e) => upd({ stackBB: Number(e.target.value) })} style={{ width: 90 }} />
              </div>
              <p className="muted small">SPR（筹码底池比）≈ {(form.stackBB / Math.max(0.01, form.potBB)).toFixed(1)}</p>
            </div>
          </div>
          <div className="pf-form">
            {([0, 1] as const).map((p) => {
              const c = p === 0 ? oopC : ipC;
              const text = p === 0 ? form.oop : form.ip;
              return (
                <div className="field" key={p}>
                  <label>
                    {p === 0 ? '不在位（OOP，先行动）' : '在位（IP）'}：
                    <input value={form.players[p]} onChange={(e) => upd({ players: (p === 0 ? [e.target.value, form.players[1]] : [form.players[0], e.target.value]) as [string, string] })} style={{ width: 70 }} /> 的范围
                    <span className="muted"> · {c.n.toFixed(0)} 组合（{((c.n / 1326) * 100).toFixed(1)}%）</span>
                    <button className="link" onClick={() => setGridEdit(gridEdit === p ? null : p)}>
                      {gridEdit === p ? '收起格子' : '在格子上编辑'}
                    </button>
                  </label>
                  <textarea rows={4} value={text} onChange={(e) => upd(p === 0 ? { oop: e.target.value } : { ip: e.target.value })} />
                  {c.errors.length > 0 && <p className="msg error">无法识别：{c.errors.slice(0, 3).join('；')}</p>}
                  {gridEdit === p && <GridEditor text={text} onChange={(t) => upd(p === 0 ? { oop: t } : { ip: t })} />}
                </div>
              );
            })}
          </div>

          <h3>2. 下注尺寸</h3>
          <div className="chips">
            {SIZE_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`chip ${form.presetId === p.id ? 'on' : ''}`}
                onClick={() => {
                  const c = applyPreset(cfg, p);
                  upd({ presetId: p.id, sizes: c.sizes, raiseCap: c.raiseCap! });
                }}
              >
                {p.name}
              </button>
            ))}
            <button className={`chip ${form.presetId === 'custom' ? 'on' : ''}`} onClick={() => upd({ presetId: 'custom' })}>
              自定义
            </button>
          </div>
          <p className="muted small">{SIZE_PRESETS.find((p) => p.id === form.presetId)?.desc ?? '在下表中修改尺寸。写法：33% = 底池的 33%，3x = 上一次下注的 3 倍，a = 全下，e = 几何尺寸，多个尺寸用逗号分隔，留空 = 不下注/不加注。'}</p>
          <table className="pf-sizes">
            <thead>
              <tr>
                <th></th>
                {STREETS.map(([k, n]) => (
                  <th key={k}>{n}下注 / 加注</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([0, 1] as const).map((p) => (
                <tr key={p}>
                  <td>{form.players[p]}</td>
                  {STREETS.map(([k]) => (
                    <td key={k}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          value={form.sizes[p][k].bet}
                          placeholder="不下注"
                          onChange={(e) => {
                            const s = structuredClone(form.sizes);
                            s[p][k].bet = e.target.value;
                            upd({ sizes: s, presetId: 'custom' });
                          }}
                        />
                        <input
                          value={form.sizes[p][k].raise}
                          placeholder="不加注"
                          onChange={(e) => {
                            const s = structuredClone(form.sizes);
                            s[p][k].raise = e.target.value;
                            upd({ sizes: s, presetId: 'custom' });
                          }}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td>加注次数上限</td>
                {STREETS.map(([k], i) => (
                  <td key={k}>
                    <input
                      type="number"
                      min={0}
                      max={4}
                      value={form.raiseCap[i]}
                      onChange={(e) => {
                        const c = [...form.raiseCap] as [number, number, number];
                        c[i] = Math.max(0, Math.min(4, Number(e.target.value) || 0));
                        upd({ raiseCap: c, presetId: 'custom' });
                      }}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            翻牌圈 {form.players[0]} 留空表示不领先下注（只过牌）。下注不超过底池 1.5 倍时自动加入全下选项；加注次数上限是防止博弈树爆炸的主要手段。
          </p>

          <h3>3. 精度</h3>
          <div className="pf-form">
            <div className="field">
              <label>目标可被利用度（% 底池）</label>
              <div className="seg">
                {[2, 1, 0.5, 0.3].map((t) => (
                  <button key={t} className={form.targetPct === t ? 'on' : ''} onClick={() => upd({ targetPct: t })}>
                    {t}%
                  </button>
                ))}
              </div>
              <p className="muted small">越小越接近均衡，耗时越长。0.5% 底池已足够学习使用。</p>
            </div>
            <div className="field">
              <label>16 位压缩存储</label>
              <div className="seg">
                {(
                  [
                    ['auto', '自动（>1GB 时开启）'],
                    ['on', '开启'],
                    ['off', '关闭'],
                  ] as const
                ).map(([k, n]) => (
                  <button key={k} className={form.compress === k ? 'on' : ''} onClick={() => upd({ compress: k })}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="muted small">压缩后内存约减半，速度略慢，精度影响很小。</p>
            </div>
          </div>

          {error && <div className="err-box">{error}</div>}
          {cached && phase === 'edit' && (
            <div className="warn-box">
              这个局面已经求解过（{new Date(cached.created).toLocaleString('zh-CN')}，可被利用度 {((cached.exploitability / cached.config.pot) * 100).toFixed(2)}% 底池）。
              <button className="btn small primary" onClick={() => openCached(cached)}>
                直接打开缓存结果
              </button>
            </div>
          )}
          {phase === 'edit' && (
            <button className="btn primary big" onClick={estimate}>
              建树并估算内存
            </button>
          )}
          {phase === 'ready' && info && (
            <div>
              <div className="stat-line">
                <span>
                  {form.players[0]} {info.hands[0].length} 个组合 · {form.players[1]} {info.hands[1].length} 个组合（已去除与公共牌冲突的组合）
                </span>
                <span>
                  预计内存：{memMB[0].toFixed(memMB[0] < 10 ? 1 : 0)}MB（压缩后 {memMB[1].toFixed(memMB[1] < 10 ? 1 : 0)}MB），本次{useCompress ? '使用压缩' : '不压缩'}
                </span>
              </div>
              {needMB > HARD_LIMIT_MB ? (
                <div className="err-box">
                  需要约 {(needMB / 1024).toFixed(1)}GB，超出浏览器（WebAssembly 32 位，最多 4GB）能承受的范围。请简化：减少下注尺寸（尤其是转牌/河牌）、降低加注次数上限、开启压缩，或缩小范围 / 从转牌开始求解。
                </div>
              ) : needMB > WARN_MB || (deviceGB && needMB > deviceGB * 1024 * 0.4) ? (
                <div className="warn-box">
                  需要约 {(needMB / 1024).toFixed(1)}GB 内存{deviceGB ? `（这台设备报告的内存约 ${deviceGB}GB）` : ''}。可能导致浏览器标签页崩溃，建议先简化下注尺寸；如果确定，可以继续。
                </div>
              ) : null}
              <div className="btn-row">
                <button className="btn primary big" disabled={needMB > HARD_LIMIT_MB} onClick={start}>
                  开始求解
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    killClient();
                    setPhase('edit');
                  }}
                >
                  返回修改
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'solving' && (
        <div className="card">
          <h3>求解中…</h3>
          <div className="progress">
            <div style={{ width: `${(prog * 100).toFixed(1)}%` }} />
          </div>
          <div className="stat-line">
            <span>迭代 {progress.iter} 轮</span>
            <span>用时 {progress.seconds.toFixed(0)} 秒</span>
            <span>
              可被利用度 {pct(progress.lastExpl)} 底池（目标 {target}%）
            </span>
            <span>内存 {progress.memMB.toFixed(0)}MB</span>
          </div>
          <p className="muted small">可被利用度 = 对手针对你的策略做最优反应时，平均每手能多赢的筹码，越接近 0 越接近均衡。随时可以停止，停止后使用当前结果。</p>
          <button className="btn danger" onClick={() => clientRef.current?.stop()}>
            停止并查看结果
          </button>
        </div>
      )}

      {phase === 'done' && spot && source && (
        <div className="card">
          <div className="chart-head">
            <h2>{spot.title}</h2>
            <div className="stat-line muted">
              <span>
                底池 {spot.config.pot / CHIPS_PER_BB}bb · 有效筹码 {spot.config.stack / CHIPS_PER_BB}bb
              </span>
              <span>
                {spot.iterations} 轮 · {spot.seconds.toFixed(0)} 秒 · 可被利用度 {((spot.exploitability / spot.config.pot) * 100).toFixed(2)}% 底池
              </span>
              <span>{source.live ? '求解器运行中（可查看任意分支）' : '来自本地缓存'}</span>
            </div>
          </div>
          <div className="btn-row">
            <a className="btn primary" href={`#/postflop-train?solve=${encodeURIComponent(spot.key)}`}>
              在这个局面里练习
            </a>
            <button
              className="btn"
              onClick={() => {
                killClient();
                setSource(null);
                setSpot(null);
                setPhase('edit');
              }}
            >
              新的求解{source.live ? '（释放内存）' : ''}
            </button>
          </div>
          <SpotExplorer
            key={spot.key + String(source.live)}
            source={source}
            onMissing={() => {
              setForm((f) => ({ ...f, oop: spot.config.ranges[0], ip: spot.config.ranges[1], board: spot.config.board, potBB: spot.config.pot / CHIPS_PER_BB, stackBB: spot.config.stack / CHIPS_PER_BB, sizes: spot.config.sizes, raiseCap: spot.config.raiseCap ?? [1, 0, 0], players: spot.players ?? ['OOP', 'IP'], title: spot.title.split(' · ')[0], presetId: 'custom' }));
              setSpot(null);
              setSource(null);
              setPhase('edit');
            }}
          />
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <h3>已缓存的求解结果（本机）</h3>
          <table className="tbl">
            <tbody>
              {history.map((h) => (
                <tr key={h.key}>
                  <td>{h.title}</td>
                  <td className="muted small">{new Date(h.created).toLocaleString('zh-CN')}</td>
                  <td className="mono small">{((h.exploitability / h.pot) * 100).toFixed(2)}%</td>
                  <td>
                    <button
                      className="link"
                      onClick={async () => {
                        const s = await getSolve(h.key);
                        if (s) openCached(s);
                      }}
                    >
                      打开
                    </button>{' '}
                    <a className="link" href={`#/postflop-train?solve=${encodeURIComponent(h.key)}`}>
                      练习
                    </a>{' '}
                    <button
                      className="link"
                      onClick={async () => {
                        await deleteSolve(h.key);
                        setHistory(await listSolves());
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 单个范围的格子编辑器：点击/拖动涂改，频率可调 */
function GridEditor({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [freq, setFreq] = useState(100);
  const w = useMemo(() => parseRange(text).weights, [text]);
  const data = useMemo(() => {
    const fold = new Float64Array(NUM_CLASSES);
    for (let h = 0; h < NUM_CLASSES; h++) fold[h] = 1 - w[h];
    return { actions: ['call', 'fold'] as ('call' | 'fold')[], freq: { call: w, fold } };
  }, [w]);
  return (
    <div>
      <div className="field inline">
        <label>画笔权重 {freq}%</label>
        <input type="range" min={0} max={100} step={5} value={freq} onChange={(e) => setFreq(Number(e.target.value))} />
      </div>
      <RangeGrid
        data={data}
        labels={{ call: '在范围内', fold: '不在范围内' }}
        editable
        compact
        onPaint={(h) => {
          const nw = Float64Array.from(w);
          nw[h] = freq / 100;
          onChange(formatRange(nw));
        }}
      />
    </div>
  );
}
