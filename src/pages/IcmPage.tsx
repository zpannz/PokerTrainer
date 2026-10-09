import { useMemo, useState } from 'react';
import { icm } from '../lib/icm.ts';
import { load, save } from '../lib/storage.ts';

interface IcmState {
  stacks: string[];
  payouts: string[];
}

const DEFAULT: IcmState = { stacks: ['5000', '3000', '2000'], payouts: ['50', '30', '20'] };

export function IcmPage() {
  const [st, setSt] = useState<IcmState>(() => load('icmInputs', DEFAULT));
  const update = (s: IcmState) => {
    setSt(s);
    save('icmInputs', s);
  };
  const stacks = st.stacks.map((v) => Math.max(0, Number(v) || 0));
  const payouts = st.payouts.map((v) => Math.max(0, Number(v) || 0));
  const result = useMemo(() => {
    try {
      return { ev: icm(stacks, payouts), error: '' };
    } catch (e) {
      return { ev: [] as number[], error: (e as Error).message };
    }
  }, [st]);
  const totalChips = stacks.reduce((a, b) => a + b, 0);
  const totalPrize = payouts.slice(0, stacks.length).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <h1>ICM 计算器</h1>
      <p className="muted">
        ICM（独立筹码模型，Independent Chip Model）把锦标赛筹码换算成奖金期望：每名玩家拿第 1 名的概率等于他的筹码占比，然后在剩下的玩家中递归计算后面的名次（Malmuth-Harville 算法，精确计算）。
      </p>
      <div className="icm-grid">
        <div className="card">
          <h3>奖池分配 (Payouts)</h3>
          {st.payouts.map((p, i) => (
            <div className="field inline" key={i}>
              <label>第 {i + 1} 名</label>
              <input type="number" min={0} value={p} onChange={(e) => update({ ...st, payouts: st.payouts.map((x, j) => (j === i ? e.target.value : x)) })} />
            </div>
          ))}
          <div className="btn-row">
            <button className="btn small" onClick={() => update({ ...st, payouts: [...st.payouts, '0'] })}>
              + 名次
            </button>
            {st.payouts.length > 1 && (
              <button className="btn small" onClick={() => update({ ...st, payouts: st.payouts.slice(0, -1) })}>
                − 名次
              </button>
            )}
          </div>
        </div>
        <div className="card">
          <h3>各家筹码 (Stacks)</h3>
          {st.stacks.map((p, i) => (
            <div className="field inline" key={i}>
              <label>玩家 {i + 1}</label>
              <input type="number" min={0} value={p} onChange={(e) => update({ ...st, stacks: st.stacks.map((x, j) => (j === i ? e.target.value : x)) })} />
            </div>
          ))}
          <div className="btn-row">
            {st.stacks.length < 12 && (
              <button className="btn small" onClick={() => update({ ...st, stacks: [...st.stacks, '1000'] })}>
                + 玩家
              </button>
            )}
            {st.stacks.length > 2 && (
              <button className="btn small" onClick={() => update({ ...st, stacks: st.stacks.slice(0, -1) })}>
                − 玩家
              </button>
            )}
            <button className="btn small" onClick={() => update(DEFAULT)}>
              示例
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>结果</h3>
        {result.error ? (
          <p className="msg error">{result.error}</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>玩家</th>
                <th>筹码</th>
                <th>筹码占比</th>
                <th>ICM 价值</th>
                <th>占奖池</th>
                <th>ICM 与筹码之比</th>
              </tr>
            </thead>
            <tbody>
              {stacks.map((s, i) => {
                const chipPct = totalChips ? s / totalChips : 0;
                const icmPct = totalPrize ? result.ev[i] / totalPrize : 0;
                return (
                  <tr key={i}>
                    <td>玩家 {i + 1}</td>
                    <td className="mono">{s.toLocaleString()}</td>
                    <td className="mono">{(chipPct * 100).toFixed(2)}%</td>
                    <td className="mono big-num">{result.ev[i]?.toFixed(2)}</td>
                    <td className="mono">{(icmPct * 100).toFixed(2)}%</td>
                    <td className="mono">{chipPct > 0 ? (icmPct / chipPct).toFixed(3) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">
          规律：大筹码的 ICM 价值低于其筹码占比（比值 &lt; 1），短筹码高于其筹码占比。这就是为什么锦标赛后期大筹码可以施压、而中等筹码要避免与大筹码冲突。
        </p>
      </div>
    </div>
  );
}
