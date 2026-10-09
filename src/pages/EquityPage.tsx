import { useEffect, useRef, useState } from 'react';
import { CardPicker, CardRow } from '../components/Cards.tsx';
import { RangeGrid } from '../components/RangeGrid.tsx';
import { cardToString, parseCards } from '../lib/cards.ts';
import type { EquityResult, WeightedCombo } from '../lib/equity.ts';
import { ALL_CLASS_COMBOS, NUM_CLASSES, rangeCombos } from '../lib/hands.ts';
import { parseRange } from '../lib/rangeText.ts';

interface ParsedPlayer {
  kind: 'hand' | 'range';
  combos: WeightedCombo[];
  cards?: number[];
  weights?: Float64Array;
  label: string;
}

/** 解析一位玩家的输入：具体手牌（AhKh）或范围文字（QQ+, AKs / random） */
export function parsePlayer(text: string): ParsedPlayer {
  const t = text.trim();
  if (!t) throw new Error('请输入手牌或范围');
  if (/^([2-9TJQKA][shdc]\s*){2}$/i.test(t)) {
    const cards = parseCards(t);
    return { kind: 'hand', combos: [{ c1: cards[0], c2: cards[1], w: 1 }], cards, label: cards.map(cardToString).join('') };
  }
  let weights: Float64Array;
  if (/^(random|any|任意|随机|100%)$/i.test(t)) weights = new Float64Array(NUM_CLASSES).fill(1);
  else {
    const r = parseRange(t);
    if (r.errors.length) throw new Error(r.errors.join('；'));
    weights = r.weights;
  }
  const combos: WeightedCombo[] = [];
  for (let h = 0; h < NUM_CLASSES; h++) if (weights[h] > 0) for (const [c1, c2] of ALL_CLASS_COMBOS[h]) combos.push({ c1, c2, w: weights[h] });
  if (combos.length === 0) throw new Error('范围为空');
  return { kind: 'range', combos, weights, label: `范围（${rangeCombos(weights).toFixed(0)} 组合）` };
}

const PRESETS: { name: string; players: string[]; board: string }[] = [
  { name: 'AA vs KK', players: ['AsAh', 'KdKc', ''], board: '' },
  { name: 'AKs vs QQ', players: ['AhKh', 'QsQc', ''], board: '' },
  { name: 'AKo vs 22（经典"硬币翻转"）', players: ['AsKd', '2h2c', ''], board: '' },
  { name: 'AKs vs 范围 QQ+, AK', players: ['AhKh', 'QQ+, AK', ''], board: '' },
  { name: '同花听牌 vs 顶对（翻牌）', players: ['8h7h', 'AsKd', ''], board: 'Kh 4h 2c' },
  { name: '三人：AA vs KK vs QQ', players: ['AsAh', 'KdKc', 'QsQh'], board: '' },
];

export function EquityPage() {
  const [inputs, setInputs] = useState<string[]>(['AsAh', 'KdKc', '']);
  const [board, setBoard] = useState('');
  const [picker, setPicker] = useState<number | 'board' | null>(null);
  const [result, setResult] = useState<EquityResult | null>(null);
  const [resultLabels, setResultLabels] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [samples, setSamples] = useState(300000);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const run = () => {
    setError('');
    setResult(null);
    let players: ParsedPlayer[];
    let boardCards: number[];
    try {
      boardCards = board.trim() ? parseCards(board) : [];
      if (![0, 3, 4, 5].includes(boardCards.length)) throw new Error('公共牌应为 0、3、4 或 5 张');
      players = inputs.filter((s) => s.trim()).map(parsePlayer);
      if (players.length < 2) throw new Error('至少需要两名玩家');
      const used = new Set(boardCards);
      for (const p of players)
        if (p.cards)
          for (const c of p.cards) {
            if (used.has(c)) throw new Error(`牌 ${cardToString(c)} 重复使用`);
            used.add(c);
          }
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    workerRef.current?.terminate();
    const w = new Worker(new URL('../workers/equity.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const id = ++reqId.current;
    setRunning(true);
    setProgress(0);
    w.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.progress !== undefined) setProgress(e.data.progress);
      else {
        setRunning(false);
        if (e.data.error) setError(e.data.error);
        else {
          setResult(e.data.result);
          setResultLabels(players.map((p) => p.label));
        }
        w.terminate();
        workerRef.current = null;
      }
    };
    w.postMessage({ id, players: players.map((p) => p.combos), board: boardCards, samples });
  };

  const stop = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  };

  // 选牌器
  const usedCards = new Set<number>();
  const safeCards = (s: string) => {
    try {
      return /^([2-9TJQKA][shdc]\s*)*$/i.test(s.trim()) ? parseCards(s) : [];
    } catch {
      return [];
    }
  };
  inputs.forEach((s) => safeCards(s).forEach((c) => usedCards.add(c)));
  safeCards(board).forEach((c) => usedCards.add(c));
  const pickTarget = picker === null ? null : picker === 'board' ? board : inputs[picker];
  const pickSelected = pickTarget !== null ? safeCards(pickTarget) : [];
  const onPick = (c: number) => {
    if (picker === null) return;
    const max = picker === 'board' ? 5 : 2;
    let sel = pickSelected.includes(c) ? pickSelected.filter((x) => x !== c) : [...pickSelected, c];
    if (sel.length > max) sel = sel.slice(sel.length - max);
    const text = sel.map(cardToString).join(picker === 'board' ? ' ' : '');
    if (picker === 'board') setBoard(text);
    else setInputs(inputs.map((v, i) => (i === picker ? text : v)));
  };

  let preview: Float64Array | null = null;
  for (const s of inputs) {
    try {
      const p = s.trim() ? parsePlayer(s) : null;
      if (p?.weights && !preview) preview = p.weights;
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="page">
      <h1>胜率计算器 (Equity Calculator)</h1>
      <p className="muted">
        支持手牌对手牌、手牌对范围、范围对范围，最多 3 人，可设定公共牌。计算量小时<strong>精确枚举</strong>所有发牌，计算量大时使用<strong>蒙特卡洛</strong>模拟并显示误差。
      </p>
      <div className="card">
        {inputs.map((v, i) => (
          <div className="field inline" key={i}>
            <label>玩家 {i + 1}{i === 2 ? '（可选）' : ''}</label>
            <input value={v} onChange={(e) => setInputs(inputs.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 2 ? '留空 = 两人' : '如 AhKh 或 QQ+, AKs, random'} />
            <button className="btn small" onClick={() => setPicker(picker === i ? null : i)}>
              选牌
            </button>
          </div>
        ))}
        <div className="field inline">
          <label>公共牌</label>
          <input value={board} onChange={(e) => setBoard(e.target.value)} placeholder="如 Kh 4h 2c（可留空）" />
          <button className="btn small" onClick={() => setPicker(picker === 'board' ? null : 'board')}>
            选牌
          </button>
        </div>
        {picker !== null && (
          <div className="picker-wrap">
            <div className="muted small">为{picker === 'board' ? '公共牌' : `玩家 ${picker + 1}`}选牌（再点一次取消）：</div>
            <CardPicker selected={pickSelected} disabled={usedCards} onPick={onPick} />
          </div>
        )}
        <div className="field inline">
          <label>模拟次数</label>
          <select value={samples} onChange={(e) => setSamples(Number(e.target.value))}>
            <option value={100000}>10 万（快）</option>
            <option value={300000}>30 万</option>
            <option value={1000000}>100 万（准）</option>
          </select>
          <span className="muted small">仅在无法精确枚举时使用</span>
        </div>
        <div className="btn-row">
          {!running ? (
            <button className="btn primary" onClick={run}>
              计算
            </button>
          ) : (
            <button className="btn" onClick={stop}>
              停止（{Math.round(progress * 100)}%）
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              setInputs(['', '', '']);
              setBoard('');
              setResult(null);
            }}
          >
            清空
          </button>
        </div>
        <div className="chips">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="chip"
              onClick={() => {
                setInputs(p.players);
                setBoard(p.board);
                setResult(null);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        {error && <p className="msg error">{error}</p>}
      </div>
      {result && (
        <div className="card">
          <h3>结果</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>玩家</th>
                <th>胜率 Equity</th>
                <th>赢 Win</th>
                <th>平 Tie</th>
              </tr>
            </thead>
            <tbody>
              {result.equity.map((e, i) => (
                <tr key={i}>
                  <td>
                    {resultLabels[i]?.startsWith('范围') ? resultLabels[i] : <CardRow cards={safeCards(resultLabels[i] ?? '')} size="sm" />}
                  </td>
                  <td className="mono big-num">{(e * 100).toFixed(2)}%</td>
                  <td className="mono">{(result.win[i] * 100).toFixed(2)}%</td>
                  <td className="mono">{(result.tie[i] * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            {result.exact
              ? `精确枚举：共 ${result.samples.toLocaleString()} 种发牌组合，结果是精确值。`
              : `蒙特卡洛模拟 ${result.samples.toLocaleString()} 次，标准误差约 ±${(result.stdErr * 100).toFixed(2)}%（95% 置信区间约 ±${(result.stdErr * 196).toFixed(2)}%）。`}
            耗时 {result.ms} ms。
          </p>
        </div>
      )}
      {preview && (
        <div className="card">
          <h3>范围预览</h3>
          <RangeGrid data={{ actions: ['raise', 'fold'], freq: { raise: preview, fold: preview.map((v) => 1 - v) } }} labels={{ raise: '在范围内', fold: '不在范围内' }} compact />
        </div>
      )}
    </div>
  );
}
