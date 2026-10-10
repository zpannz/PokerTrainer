import { useCallback, useState } from 'react';
import { load, remove, save } from '../lib/storage.ts';
import type { AnteMode } from '../sim/engine.ts';
import { type CashConfig, DEFAULT_PAYOUTS, type Session, type SessionConfig, type TourneyConfig, bbPer100, cashProfit, heroInfo, newSession } from '../sim/session.ts';
import { STYLES, STYLE_IDS, STYLE_MIXES, type StyleId } from '../sim/styles.ts';
import { SimTable, type TableSettings } from '../components/sim/SimTable.tsx';
import { SimResults, sessionTitle } from '../components/sim/SimResults.tsx';
import { SchemeBar } from '../components/SchemePanel.tsx';

const SESSION_KEY = 'sim.session';
const LAST_KEY = 'sim.last';
const RESULTS_KEY = 'sim.results';
const SETTINGS_KEY = 'sim.settings';
const TABLE_KEY = 'sim.table';

interface ResultSummary {
  id: string;
  title: string;
  date: number;
  hands: number;
  text: string;
}

type Mode = 'cash' | 'sng' | 'ft';

interface LobbySettings {
  mode: Mode;
  cash: { tableSize: 6 | 9; stakes: number; buyinBB: number; hands: number; autoTopUp: boolean };
  sng: { tableSize: 6 | 9; startStack: number; structure: 'fast' | 'standard'; anteMode: AnteMode; buyin: number; payouts6: string; payouts9: string };
  ft: { players: number; depth: 'short' | 'medium' | 'deep'; structure: 'fast' | 'standard'; anteMode: AnteMode; payouts: string };
  mix: string;
  custom: StyleId[];
}

const DEFAULTS: LobbySettings = {
  mode: 'cash',
  cash: { tableSize: 6, stakes: 100, buyinBB: 100, hands: 200, autoTopUp: true },
  sng: { tableSize: 6, startStack: 1500, structure: 'standard', anteMode: 'bb', buyin: 100, payouts6: '65, 35', payouts9: '50, 30, 20' },
  ft: { players: 6, depth: 'medium', structure: 'standard', anteMode: 'bb', payouts: DEFAULT_PAYOUTS.ft.join(', ') },
  mix: 'mixed',
  custom: ['tag', 'station', 'lag', 'nit', 'gto', 'tag', 'station', 'lag'],
};

const STAKES = [
  { bb: 100, label: '0.5 / 1' },
  { bb: 200, label: '1 / 2' },
  { bb: 500, label: '2.5 / 5' },
];

function parseNums(t: string): number[] {
  return t
    .split(/[\s,，、/]+/)
    .map(Number)
    .filter((x) => Number.isFinite(x) && x > 0);
}

function styleList(s: LobbySettings): StyleId[] {
  if (s.mix === 'custom') return s.custom;
  return STYLE_MIXES.find((m) => m.id === s.mix)?.styles ?? STYLE_MIXES[0].styles;
}

export function makeConfig(s: LobbySettings): SessionConfig {
  const styles = styleList(s);
  if (s.mode === 'cash') {
    const c: CashConfig = { kind: 'cash', tableSize: s.cash.tableSize, sb: s.cash.stakes / 2, bb: s.cash.stakes, buyinBB: s.cash.buyinBB, styles, hands: s.cash.hands, autoTopUp: s.cash.autoTopUp };
    return c;
  }
  if (s.mode === 'sng') {
    const pct = parseNums(s.sng.tableSize === 6 ? s.sng.payouts6 : s.sng.payouts9);
    const pool = s.sng.buyin * s.sng.tableSize;
    const sum = pct.reduce((a, b) => a + b, 0) || 1;
    const payouts = pct.slice(0, s.sng.tableSize).map((p) => Math.round((p / sum) * pool));
    const c: TourneyConfig = { kind: 'sng', tableSize: s.sng.tableSize, startStack: s.sng.startStack, structure: s.sng.structure, anteMode: s.sng.anteMode, payouts, styles };
    return c;
  }
  const payouts = parseNums(s.ft.payouts).slice(0, s.ft.players);
  while (payouts.length < s.ft.players) payouts.push(0);
  payouts.sort((a, b) => b - a);
  const c: TourneyConfig = { kind: 'ft', tableSize: 6, startStack: 1500, structure: s.ft.structure, anteMode: s.ft.anteMode, payouts, styles, ftPlayers: s.ft.players, ftDepth: s.ft.depth };
  return c;
}

function summaryText(s: Session): string {
  if (s.config.kind === 'cash') return `${s.history.length} 手，盈亏 ${(cashProfit(s) / s.config.bb).toFixed(1)}bb，${bbPer100(s).toFixed(1)} bb/100（EV 调整后 ${bbPer100(s, 'ev').toFixed(1)}）`;
  const h = heroInfo(s);
  return `${s.history.length} 手，第 ${h.place ?? '?'} 名，奖金 ${h.prize ?? 0}`;
}

export function PlayPage() {
  const [session, setSession] = useState<Session | null>(() => load<Session | null>(SESSION_KEY, null));
  const [view, setView] = useState<'lobby' | 'table' | 'results'>('lobby');
  const [settings, setSettingsState] = useState<LobbySettings>(() => ({ ...DEFAULTS, ...load<Partial<LobbySettings>>(SETTINGS_KEY, {}) }));
  const [tableSettings, setTableSettingsState] = useState<TableSettings>(() => load<TableSettings>(TABLE_KEY, { fast: false, showStyles: true }));
  const [results, setResults] = useState<ResultSummary[]>(() => load<ResultSummary[]>(RESULTS_KEY, []));
  const [lastSession, setLastSession] = useState<Session | null>(null);
  const setSettings = (s: LobbySettings) => {
    setSettingsState(s);
    save(SETTINGS_KEY, s);
  };
  const setTableSettings = (s: TableSettings) => {
    setTableSettingsState(s);
    save(TABLE_KEY, s);
  };
  const onSave = useCallback(() => {
    if (session && !session.finished) save(SESSION_KEY, session);
  }, [session]);
  const onFinished = useCallback(() => {
    if (!session) return;
    remove(SESSION_KEY);
    save(LAST_KEY, session);
    const r: ResultSummary = { id: session.id, title: sessionTitle(session), date: Date.now(), hands: session.history.length, text: summaryText(session) };
    const list = [r, ...load<ResultSummary[]>(RESULTS_KEY, []).filter((x) => x.id !== session.id)].slice(0, 30);
    save(RESULTS_KEY, list);
    setResults(list);
    setLastSession(session);
    setSession(null);
    setView('results');
  }, [session]);

  if (view === 'table' && session) return <SimTable key={session.id} session={session} settings={tableSettings} setSettings={setTableSettings} onSave={onSave} onExit={() => setView('lobby')} onFinished={onFinished} />;
  if (view === 'results') {
    const s = lastSession ?? load<Session | null>(LAST_KEY, null);
    if (s) return <SimResults session={s} onBack={() => setView('lobby')} />;
  }

  const start = () => {
    const s = newSession(makeConfig(settings));
    save(SESSION_KEY, s);
    setSession(s);
    setView('table');
  };
  const u = (p: Partial<LobbySettings>) => setSettings({ ...settings, ...p });
  const nOpp = settings.mode === 'cash' ? settings.cash.tableSize - 1 : settings.mode === 'sng' ? settings.sng.tableSize - 1 : settings.ft.players - 1;
  const styles = styleList(settings).slice(0, nOpp);
  const hasLast = !!load<Session | null>(LAST_KEY, null);
  return (
    <div className="page">
      <h1>模拟对战</h1>
      <p className="muted">和 AI 对手打完整的牌局（虚拟筹码，仅用于练习）。打完后列出偏离范围/求解结果的决策，并可以一键送进手牌复盘。进度保存在本机浏览器，可以随时暂停、下次接着打。</p>
      {session && !session.finished && (
        <div className="card resume">
          <div>
            <strong>未打完的牌局：</strong>
            {sessionTitle(session)} · 已打 {session.handNo} 手{session.config.kind === 'cash' ? ` / ${session.config.hands}` : ''}
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={() => setView('table')}>
              继续
            </button>
            <button
              className="btn"
              onClick={() => {
                session.finished = true;
                session.endNote = '提前结束';
                onFinished();
              }}
            >
              结束并结算
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (!confirm('放弃这局牌（不保存结果）？')) return;
                remove(SESSION_KEY);
                setSession(null);
              }}
            >
              放弃
            </button>
          </div>
        </div>
      )}
      <div className="tabs">
        {(
          [
            ['cash', '现金桌'],
            ['sng', '单桌 SNG'],
            ['ft', '决赛桌残局'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={settings.mode === m ? 'on' : ''} onClick={() => u({ mode: m })}>
            {label}
          </button>
        ))}
      </div>
      <div className="card">
        {settings.mode === 'cash' && <CashForm s={settings} u={u} />}
        {settings.mode === 'sng' && <SngForm s={settings} u={u} />}
        {settings.mode === 'ft' && <FtForm s={settings} u={u} />}
        <h3>对手风格</h3>
        <div className="seg wrap">
          {STYLE_MIXES.map((m) => (
            <button key={m.id} className={settings.mix === m.id ? 'on' : ''} onClick={() => u({ mix: m.id })}>
              {m.name}
            </button>
          ))}
          <button className={settings.mix === 'custom' ? 'on' : ''} onClick={() => u({ mix: 'custom', custom: styleList(settings) })}>
            自定义
          </button>
        </div>
        <div className="opp-list">
          {styles.map((id, i) =>
            settings.mix === 'custom' ? (
              <select key={i} value={id} onChange={(e) => u({ custom: settings.custom.map((x, k) => (k === i ? (e.target.value as StyleId) : x)) })}>
                {STYLE_IDS.map((sid) => (
                  <option key={sid} value={sid}>
                    对手 {i + 1}：{STYLES[sid].name}
                  </option>
                ))}
              </select>
            ) : (
              <span key={i} className={`style-tag st-${id}`}>
                {STYLES[id].name}
              </span>
            ),
          )}
        </div>
        <details className="small">
          <summary>各风格说明</summary>
          <ul>
            {STYLE_IDS.map((id) => {
              const st = STYLES[id];
              return (
                <li key={id}>
                  <span className={`style-tag st-${id}`}>{st.name}</span> {st.desc}（6 人桌目标 VPIP {st.target[6].vpip.join('~')}%，PFR {st.target[6].pfr.join('~')}%）
                </li>
              );
            })}
          </ul>
          <p className="muted">
            翻前：能对应到范围库场景（开池、面对加注、面对 3-bet、全下/弃牌、面对全下、再全下）时，按风格调整宽紧后的范围表行动；锦标赛 20bb 以下首先入池只用全下/弃牌表。多人底池、4-bet 以上等没有表的局面按翻前牌力和风格参数决策。翻后：单挑底池且翻牌能匹配预计算牌面库时按求解结果行动（非 GTO 风格有少量偏移），否则按对估计范围的胜率、底池赔率和风格参数决策。AI 使用默认范围数据。
          </p>
        </details>
        <div className="btn-row">
          <button className="btn primary big" onClick={start}>
            {session && !session.finished ? '开始新的一局（覆盖未打完的）' : '开始'}
          </button>
        </div>
      </div>
      <SchemeBar />
      <div className="card">
        <h3>最近的结果</h3>
        {hasLast && (
          <button className="btn small" onClick={() => setView('results')}>
            查看上一局的结算与复盘
          </button>
        )}
        {results.length === 0 && <p className="muted">还没有打完的牌局。</p>}
        <ul className="small">
          {results.map((r) => (
            <li key={r.id}>
              {new Date(r.date).toLocaleString('zh-CN')} · {r.title} · {r.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type FormProps = { s: LobbySettings; u: (p: Partial<LobbySettings>) => void };

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function CashForm({ s, u }: FormProps) {
  const c = s.cash;
  const set = (p: Partial<LobbySettings['cash']>) => u({ cash: { ...c, ...p } });
  return (
    <div className="pf-form">
      <div className="field">
        <label>人数</label>
        <Seg value={c.tableSize} options={[[6, '6 人桌'], [9, '9 人桌']]} onChange={(v) => set({ tableSize: v })} />
      </div>
      <div className="field">
        <label>盲注级别（虚拟筹码）</label>
        <Seg value={c.stakes} options={STAKES.map((x) => [x.bb, x.label] as [number, string])} onChange={(v) => set({ stakes: v })} />
      </div>
      <div className="field">
        <label>买入（大盲数）</label>
        <Seg value={c.buyinBB} options={[[40, '40bb'], [100, '100bb'], [200, '200bb']]} onChange={(v) => set({ buyinBB: v })} />
      </div>
      <div className="field">
        <label>手数</label>
        <Seg value={c.hands} options={[[100, '100'], [200, '200'], [500, '500'], [1000, '1000']]} onChange={(v) => set({ hands: v })} />
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={c.autoTopUp} onChange={(e) => set({ autoTopUp: e.target.checked })} /> 每手自动补码到买入额（输光时总会重新买入）
        </label>
      </div>
      <p className="muted small">翻前范围按 100bb 现金局表；买入 40bb 时有效筹码较浅，AI 改用接近深度的锦标赛表（无前注差异），复盘对照也会提示深度差别。</p>
    </div>
  );
}

function SngForm({ s, u }: FormProps) {
  const c = s.sng;
  const set = (p: Partial<LobbySettings['sng']>) => u({ sng: { ...c, ...p } });
  return (
    <div className="pf-form">
      <div className="field">
        <label>人数</label>
        <Seg value={c.tableSize} options={[[6, '6 人'], [9, '9 人']]} onChange={(v) => set({ tableSize: v })} />
      </div>
      <div className="field">
        <label>起始筹码（第 1 级盲注 = 起始筹码 / 75）</label>
        <Seg value={c.startStack} options={[[1500, '1500'], [3000, '3000'], [5000, '5000'], [10000, '10000']]} onChange={(v) => set({ startStack: v })} />
      </div>
      <div className="field">
        <label>盲注结构</label>
        <Seg value={c.structure} options={[['fast', '快速（每 6 手升盲）'], ['standard', '标准（每 12 手升盲）']]} onChange={(v) => set({ structure: v })} />
      </div>
      <div className="field">
        <label>前注</label>
        <Seg value={c.anteMode} options={[['bb', '大盲前注（= 1 个大盲）'], ['each', '每人前注（1/8 大盲）'], ['none', '无前注']]} onChange={(v) => set({ anteMode: v })} />
      </div>
      <div className="field">
        <label>买入（虚拟，奖池 = 买入 × 人数）</label>
        <input type="number" min={1} value={c.buyin} onChange={(e) => set({ buyin: Math.max(1, Number(e.target.value)) })} />
      </div>
      <div className="field">
        <label>奖金分配（% ，按名次，逗号分隔）</label>
        <input value={c.tableSize === 6 ? c.payouts6 : c.payouts9} onChange={(e) => set(c.tableSize === 6 ? { payouts6: e.target.value } : { payouts9: e.target.value })} />
      </div>
      <p className="muted small">范围库的锦标赛表按"大盲前注 1bb"计算；选择其他前注时 AI 仍用这些表，复盘时会有偏差提示。显示的 ICM 价值按当前筹码和奖金分配计算。</p>
    </div>
  );
}

function FtForm({ s, u }: FormProps) {
  const c = s.ft;
  const set = (p: Partial<LobbySettings['ft']>) => u({ ft: { ...c, ...p } });
  return (
    <div className="pf-form">
      <div className="field">
        <label>剩余人数</label>
        <Seg value={c.players} options={[[3, '3 人'], [4, '4 人'], [5, '5 人'], [6, '6 人']]} onChange={(v) => set({ players: v })} />
      </div>
      <div className="field">
        <label>平均筹码（每人筹码随机、深浅不一）</label>
        <Seg value={c.depth} options={[['short', '浅（约 12bb）'], ['medium', '中（约 20bb）'], ['deep', '深（约 35bb）']]} onChange={(v) => set({ depth: v })} />
      </div>
      <div className="field">
        <label>盲注结构</label>
        <Seg value={c.structure} options={[['fast', '快速'], ['standard', '标准']]} onChange={(v) => set({ structure: v })} />
      </div>
      <div className="field">
        <label>前注</label>
        <Seg value={c.anteMode} options={[['bb', '大盲前注'], ['each', '每人前注'], ['none', '无']]} onChange={(v) => set({ anteMode: v })} />
      </div>
      <div className="field">
        <label>剩余名次的奖金（第 1 名起，逗号分隔）</label>
        <input value={c.payouts} onChange={(e) => set({ payouts: e.target.value })} />
      </div>
      <p className="muted small">从盲注 100/200 开始；只取前 {c.players} 个奖金。适合练习 ICM 压力下的全下/弃牌和跟注决策。</p>
    </div>
  );
}
