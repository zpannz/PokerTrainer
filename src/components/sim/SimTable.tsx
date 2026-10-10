import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayingCard } from '../Cards.tsx';
import { cardToString } from '../../lib/cards.ts';
import { type Position, POSITION_SHORT } from '../../lib/formats.ts';
import { HAND_CATEGORY_NAMES, handCategory } from '../../lib/evaluator.ts';
import { icm } from '../../lib/icm.ts';
import { type Act, type HandState, type LogEntry, applyAction, currentPlayer, legalActions, potBeforeStreet, potTotal } from '../../sim/engine.ts';
import { type Session, beginHand, bbPer100, cashProfit, currentBlinds, finishHand, handsPerLevel, isHeroTurn, type TourneyConfig } from '../../sim/session.ts';
import { aiAct, prepareStreet } from '../../sim/driver.ts';
import { seatPositions } from '../../sim/preflop.ts';
import { STYLES } from '../../sim/styles.ts';
import { solverStatus } from '../../sim/solver.ts';
import { DEFAULT_SCHEME_ID, schemeName } from '../../data/overrides.ts';

export interface TableSettings {
  fast: boolean;
  showStyles: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const fmtBB = (chips: number, bb: number) => `${+(chips / bb).toFixed(chips % bb === 0 ? 0 : 1)}bb`;

const STREET = ['翻前', '翻牌', '转牌', '河牌'];

function actionText(e: LogEntry, bb: number): string {
  const b = (x: number) => fmtBB(x, bb);
  const ai = e.allin ? '（全下）' : '';
  switch (e.kind) {
    case 'sb':
      return `小盲 ${b(e.amount)}${ai}`;
    case 'bb':
      return `大盲 ${b(e.amount)}${ai}`;
    case 'ante':
      return `前注 ${b(e.amount)}${ai}`;
    case 'fold':
      return '弃牌';
    case 'check':
      return '过牌';
    case 'call':
      return `跟注 ${b(e.amount)}${ai}`;
    case 'bet':
      return `下注 ${b(e.to)}${ai}`;
    case 'raise':
      return `加注到 ${b(e.to)}${ai}`;
  }
}

/** 每个座位在本街的最后一个动作（显示在座位上） */
function lastActions(st: HandState): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of st.log) {
    if (e.street !== st.street && !(st.done && e.kind === 'fold')) continue;
    if (e.kind === 'ante') continue;
    out.set(e.seat, actionText(e, st.bb));
  }
  return out;
}

export function SimTable({ session, settings, setSettings, onSave, onExit, onFinished }: { session: Session; settings: TableSettings; setSettings: (s: TableSettings) => void; onSave: () => void; onExit: () => void; onFinished: () => void }) {
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const lastRef = useRef<HandState | null>(session.current);
  const running = useRef(false);
  const paused = useRef(false);
  const fastRef = useRef(settings.fast);
  fastRef.current = settings.fast;
  const [err, setErr] = useState('');

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let cnt = 0;
    try {
      while (!paused.current) {
        const s = session;
        if (s.finished) {
          onFinished();
          break;
        }
        if (!s.current) {
          beginHand(s);
          lastRef.current = s.current;
          bump();
          if (!fastRef.current) await sleep(350);
          continue;
        }
        const st = s.current;
        if (st.done) {
          const heroShow = st.result?.showdown && st.players.some((p) => p.seat === s.heroSeat && !p.folded);
          finishHand(s);
          onSave();
          bump();
          await sleep(fastRef.current ? (heroShow ? 900 : 60) : heroShow ? 2200 : 1300);
          continue;
        }
        if (isHeroTurn(s)) {
          onSave();
          bump();
          break;
        }
        await prepareStreet(s);
        if (paused.current) break;
        aiAct(s);
        if (!fastRef.current) {
          bump();
          await sleep(550);
        } else if (++cnt % 30 === 0) {
          bump();
          await sleep(0);
        }
      }
    } catch (e) {
      setErr(String((e as Error).stack ?? e));
    } finally {
      running.current = false;
      bump();
    }
  }, [session, bump, onSave, onFinished]);

  useEffect(() => {
    paused.current = false;
    void run();
    const save = () => onSave();
    window.addEventListener('beforeunload', save);
    return () => {
      paused.current = true;
      window.removeEventListener('beforeunload', save);
      onSave();
    };
  }, [run, onSave]);

  const heroAct = (a: Act) => {
    const st = session.current;
    if (!st || !isHeroTurn(session)) return;
    applyAction(st, a);
    bump();
    void run();
  };

  const view = session.current ?? lastRef.current;
  const heroTurn = isHeroTurn(session) && !running.current;
  return (
    <div className="sim-layout">
      <div className="sim-main">
        <TableTop session={session} st={view} settings={settings} />
        {err && <div className="err-box small" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}
        {heroTurn && session.current ? <ActionBar st={session.current} onAct={heroAct} /> : <div className="action-bar waiting muted">{session.finished ? '这一局已经结束' : 'AI 行动中…'}</div>}
        <div className="btn-row">
          <label className="check">
            <input type="checkbox" checked={settings.fast} onChange={(e) => setSettings({ ...settings, fast: e.target.checked })} /> 快速模式（AI 行动不等待动画）
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.showStyles} onChange={(e) => setSettings({ ...settings, showStyles: e.target.checked })} /> 显示对手风格标签
          </label>
          <button
            className="btn small"
            onClick={() => {
              paused.current = true;
              onSave();
              onExit();
            }}
          >
            暂停并返回（进度已保存）
          </button>
        </div>
      </div>
      <aside className="sim-side">
        <SessionInfo session={session} />
        {view && <HandLog st={view} session={session} />}
      </aside>
    </div>
  );
}

function TableTop({ session, st, settings }: { session: Session; st: HandState | null; settings: TableSettings }) {
  const n = session.seats.length;
  const heroIdx = session.heroSeat;
  const pos: Map<number, Position> = st ? seatPositions(st) : new Map();
  const acts = st ? lastActions(st) : new Map<number, string>();
  const toAct = st && !st.done ? currentPlayer(st)?.seat : undefined;
  const bb = st?.bb ?? currentBlinds(session).bb;
  const tourney = session.config.kind !== 'cash';
  // ICM（按这手牌开始前的筹码）
  const icmMap = new Map<number, number>();
  if (tourney) {
    const alive = session.seats.filter((p) => !p.busted && p.stack > 0);
    const pays = (session.config as TourneyConfig).payouts;
    const ev = icm(
      alive.map((p) => p.stack),
      pays.slice(0, alive.length),
    );
    alive.forEach((p, i) => icmMap.set(p.seat, ev[i]));
  }
  const winners = new Set(st?.done && st.result ? st.result.pots.flatMap((p) => p.winners) : []);
  const sd = st?.done && st.result?.showdown;
  return (
    <div className="sim-table">
      <div className="sim-felt">
        <div className="sim-center">
          <div className="sim-board">
            {st && st.board.length > 0 ? st.board.map((c) => <PlayingCard key={c} card={c} size="md" />) : <span className="muted small">{st ? STREET[st.street] : '准备发牌'}</span>}
          </div>
          {st && (
            <div className="sim-pot">
              底池 <strong>{fmtBB(potTotal(st), bb)}</strong>
              {!st.done && st.street > 0 && potTotal(st) !== potBeforeStreet(st) && <span className="muted small">（本街前 {fmtBB(potBeforeStreet(st), bb)}）</span>}
            </div>
          )}
          {st?.done && st.result && (
            <div className="sim-result small">
              {st.result.pots.map((p, i) => (
                <div key={i}>
                  {st.result!.pots.length > 1 ? (i === 0 ? '主池' : `边池 ${i}`) : '底池'} {fmtBB(p.amount, bb)} →{' '}
                  {p.winners.map((w) => (session.seats[w].isHero ? '你' : session.seats[w].name)).join('、')}
                  {sd && p.winners.length > 0 && `（${HAND_CATEGORY_NAMES[handCategory(st.result!.values[p.winners[0]])].split(' ')[0]}）`}
                </div>
              ))}
            </div>
          )}
          <div className="muted small">
            第 {session.handNo + (session.current ? 1 : 0)} 手 · 盲注 {st ? `${st.sb}/${st.bb}` : `${currentBlinds(session).sb}/${currentBlinds(session).bb}`}
            {st && st.ante > 0 ? ` · ${st.anteMode === 'bb' ? '大盲前注' : '前注'} ${st.ante}` : ''}
          </div>
        </div>
      </div>
      {session.seats.map((info) => {
        const k = (info.seat - heroIdx + n) % n;
        const angle = Math.PI / 2 + (k * 2 * Math.PI) / n;
        const x = 50 + 43 * Math.cos(angle);
        const y = 48 + 41 * Math.sin(angle);
        const p = st?.players.find((q) => q.seat === info.seat);
        const stack = p ? p.stack : info.stack;
        const style = info.style ? STYLES[info.style] : null;
        const showCards = p && (info.isHero || (sd && !p.folded));
        return (
          <div
            key={info.seat}
            className={`sim-seat ${info.isHero ? 'hero' : ''} ${p?.folded ? 'folded' : ''} ${!p ? 'out' : ''} ${toAct === info.seat ? 'acting' : ''} ${winners.has(info.seat) ? 'winner' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className="sim-cards">
              {p && showCards ? p.hole.map((c) => <PlayingCard key={c} card={c} size="sm" />) : p && !p.folded ? (
                <>
                  <span className="pcard sm back" />
                  <span className="pcard sm back" />
                </>
              ) : null}
            </div>
            <div className="sim-name">
              {info.isHero ? '你' : info.name}
              {st && info.seat === st.button && <span className="dealer">D</span>}
              {p && pos.get(info.seat) && <span className="muted small"> {POSITION_SHORT[pos.get(info.seat)!]}</span>}
            </div>
            {!info.isHero && <div className={`style-tag ${settings.showStyles && style ? `st-${style.id}` : 'hidden'}`}>{settings.showStyles && style ? style.short : '风格隐藏'}</div>}
            <div className="sim-stack mono">
              {info.busted ? `第 ${info.place} 名` : fmtBB(stack, bb)}
              {tourney && icmMap.has(info.seat) && <span className="muted"> · ICM {icmMap.get(info.seat)!.toFixed(1)}</span>}
            </div>
            {acts.get(info.seat) && <div className="sim-act small">{acts.get(info.seat)}</div>}
            {p && !st!.done && p.street > 0 && <div className="sim-bet mono">{fmtBB(p.street, bb)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ActionBar({ st, onAct }: { st: HandState; onAct: (a: Act) => void }) {
  const L = legalActions(st);
  const bb = st.bb;
  const pot = potTotal(st);
  const [amt, setAmt] = useState(L.minTo);
  const key = `${st.log.length}`;
  useEffect(() => setAmt(L.minTo), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (v: number) => Math.max(L.minTo, Math.min(L.maxTo, Math.round(v)));
  const presets: { label: string; to: number }[] = [];
  if (st.street === 0) {
    if (st.currentBet <= bb) for (const m of [2, 2.5, 3, 4]) presets.push({ label: `${m}bb`, to: m * bb });
    else for (const m of [2.5, 3, 4]) presets.push({ label: `${m}倍`, to: st.currentBet * m });
  } else {
    for (const f of [0.33, 0.5, 0.75, 1, 1.5]) presets.push({ label: `${Math.round(f * 100)}%`, to: L.isBet ? f * pot : st.currentBet + f * (pot + L.call) });
  }
  const raiseLabel = L.isBet ? '下注' : '加注到';
  const fire = (a: Act) => onAct(a);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // 正在输入数字/文字时不响应快捷键
      if (t && ((t.tagName === 'INPUT' && ['text', 'number', 'search'].includes((t as HTMLInputElement).type)) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && L.canFold) fire({ type: 'fold' });
      else if (k === 'c' || k === 'x' || (k === 'f' && !L.canFold)) fire({ type: L.call > 0 ? 'call' : 'check' });
      else if ((k === 'r' || k === 'enter' || k === 'b') && L.canRaise) fire({ type: L.isBet ? 'bet' : 'raise', to: amt });
      else if (k === 'a' && L.canRaise) fire({ type: L.isBet ? 'bet' : 'raise', to: L.maxTo });
      else if (/^[1-5]$/.test(k) && L.canRaise) {
        const p = presets[Number(k) - 1];
        if (p) setAmt(clamp(p.to));
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  return (
    <div className="action-bar">
      <div className="ab-buttons">
        {L.canFold && (
          <button className="btn act-fold" onClick={() => fire({ type: 'fold' })}>
            弃牌 <kbd>F</kbd>
          </button>
        )}
        <button className="btn act-call" onClick={() => fire({ type: L.call > 0 ? 'call' : 'check' })}>
          {L.call > 0 ? `跟注 ${fmtBB(L.call, bb)}` : '过牌'} <kbd>C</kbd>
        </button>
        {L.canRaise && (
          <>
            <button className="btn act-raise" onClick={() => fire({ type: L.isBet ? 'bet' : 'raise', to: amt })}>
              {amt >= L.maxTo ? '全下' : raiseLabel} {fmtBB(amt, bb)} <kbd>R</kbd>
            </button>
            <button className="btn act-allin" onClick={() => fire({ type: L.isBet ? 'bet' : 'raise', to: L.maxTo })}>
              全下 {fmtBB(L.maxTo, bb)} <kbd>A</kbd>
            </button>
          </>
        )}
      </div>
      {L.canRaise && L.maxTo > L.minTo && (
        <div className="ab-sizes">
          {presets.map((p, i) => (
            <button key={p.label} className="btn small" onClick={() => setAmt(clamp(p.to))}>
              {p.label} <kbd>{i + 1}</kbd>
            </button>
          ))}
          <input type="range" min={L.minTo} max={L.maxTo} step={Math.max(1, Math.round(bb / 10))} value={amt} onChange={(e) => setAmt(clamp(Number(e.target.value)))} />
          <input type="number" className="ab-num" min={+(L.minTo / bb).toFixed(1)} max={+(L.maxTo / bb).toFixed(1)} step={0.5} value={+(amt / bb).toFixed(2)} onChange={(e) => setAmt(clamp(Number(e.target.value) * bb))} />
          <span className="muted small">bb</span>
        </div>
      )}
      <div className="muted small">快捷键：F 弃牌 · C 过牌/跟注 · R 或 Enter 下注/加注 · A 全下 · 1~{presets.length} 选尺寸</div>
    </div>
  );
}

function SessionInfo({ session }: { session: Session }) {
  const c = session.config;
  const bl = currentBlinds(session);
  if (c.kind === 'cash') {
    const profit = cashProfit(session);
    return (
      <div className="card compact">
        <div className="stat-line small">
          <span>
            第 {session.handNo}/{c.hands} 手
          </span>
          <span>
            盈亏 <strong className={profit >= 0 ? 'pos' : 'neg'}>{fmtBB(profit, c.bb)}</strong>
          </span>
          <span>{bbPer100(session).toFixed(1)} bb/100</span>
        </div>
        <div className="small muted">AI 范围方案：{schemeName(c.rangeScheme ?? DEFAULT_SCHEME_ID)}</div>
      </div>
    );
  }
  const alive = session.seats.filter((p) => !p.busted).length;
  const left = handsPerLevel(c.structure) - (session.handNo % handsPerLevel(c.structure));
  return (
    <div className="card compact">
      <div className="stat-line small">
        <span>级别 {session.level + 1}：{bl.sb}/{bl.bb}{bl.ante ? `，前注 ${bl.ante}` : ''}</span>
        <span>{left} 手后升盲</span>
        <span>剩余 {alive} 人</span>
      </div>
      <div className="small muted">
        奖金：{c.payouts.map((p, i) => `第 ${i + 1} 名 ${p}`).join(' · ')}
      </div>
      <div className="small muted">AI 范围方案：{schemeName(c.rangeScheme ?? DEFAULT_SCHEME_ID)}</div>
    </div>
  );
}

function HandLog({ st, session }: { st: HandState; session: Session }) {
  const name = (seat: number) => (session.seats[seat].isHero ? '你' : session.seats[seat].name);
  const lines: { street: number; text: string }[] = [];
  let street = -1;
  for (const e of st.log) {
    if (e.street !== street) {
      street = e.street;
      const b = st.board.slice(0, street === 0 ? 0 : street + 2);
      lines.push({ street, text: `— ${STREET[street]}${b.length ? '：' + b.map(cardToString).join(' ') : ''} —` });
    }
    if (e.kind === 'ante') continue;
    lines.push({ street, text: `${name(e.seat)} ${actionText(e, st.bb)}` });
  }
  const sv = solverStatus(st);
  return (
    <div className="card compact hand-log">
      <h3>本手牌</h3>
      {sv?.status === 'ready' && <div className="tag small">翻牌圈匹配预计算牌面库（{sv.scenario}），AI 按求解结果行动</div>}
      <div className="log-lines small">
        {lines.map((l, i) => (
          <div key={i} className={l.text.startsWith('—') ? 'muted' : ''}>
            {l.text}
          </div>
        ))}
        {st.done &&
          st.result &&
          Object.entries(st.result.net)
            .filter(([, v]) => v > 0)
            .map(([s, v]) => (
              <div key={s}>
                <strong>{name(Number(s))}</strong> 赢得 {fmtBB(v, st.bb)}（净）
              </div>
            ))}
      </div>
    </div>
  );
}
