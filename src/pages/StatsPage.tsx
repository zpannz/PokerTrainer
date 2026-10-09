import { useState } from 'react';
import { type Position, type SpotCategory, CATEGORY_NAMES, POSITION_SHORT, allFormats, parseSpotId, spotTitle } from '../lib/formats.ts';
import { HAND_CLASSES } from '../lib/hands.ts';
import { type Tally, loadStats, resetStats } from '../lib/trainer.ts';
import { exportAll, importAll, load } from '../lib/storage.ts';
import { CONCEPT_NAMES, type ConceptType } from '../lib/concepts.ts';
import { LESSON_TITLES } from './LessonsPage.tsx';
import { NODE_TYPE_NAMES, type NodeType, loadPfStats, resetPfStats } from '../lib/postflopTrainer.ts';

export function StatsPage() {
  const [stats, setStats] = useState(loadStats());
  const [msg, setMsg] = useState('');
  const [pf, setPf] = useState(loadPfStats());
  const formats = allFormats();
  const byFormat = new Map<string, { cat: SpotCategory; pos: Position; t: Tally }[]>();
  for (const [k, t] of Object.entries(stats.tallies)) {
    const [fid, cat, pos] = k.split('|');
    if (!byFormat.has(fid)) byFormat.set(fid, []);
    byFormat.get(fid)!.push({ cat: cat as SpotCategory, pos: pos as Position, t });
  }
  const drill = load<Record<string, { n: number; good: number }>>('drillStats', {});
  const lessons = load<Record<string, { best: number; total: number }>>('lessonProgress', {});

  const download = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'poker-gto-trainer-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = (file: File) => {
    file.text().then((t) => {
      try {
        importAll(JSON.parse(t));
        setStats(loadStats());
        setMsg('已导入，刷新页面后所有数据生效。');
      } catch {
        setMsg('文件格式不正确');
      }
    });
  };

  return (
    <div className="page">
      <h1>学习统计</h1>
      <p className="muted">所有数据只保存在这台设备的浏览器中（localStorage）。共回答 {stats.totalAnswered} 道翻前题。翻后求解结果缓存在 IndexedDB，可在"翻后求解"页面管理。</p>
      {byFormat.size === 0 && <div className="card">还没有训练记录，去"翻前训练"做几题吧。</div>}
      {formats
        .filter((f) => byFormat.has(f.id))
        .map((f) => {
          const rows = byFormat.get(f.id)!;
          const cats = [...new Set(rows.map((r) => r.cat))];
          const poss = [...new Set(rows.map((r) => r.pos))];
          return (
            <div className="card" key={f.id}>
              <h3>{f.label}</h3>
              <div className="tbl-scroll">
                <table className="tbl heat">
                  <thead>
                    <tr>
                      <th>场景 \ 位置</th>
                      {poss.map((p) => (
                        <th key={p}>{POSITION_SHORT[p]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cats.map((c) => (
                      <tr key={c}>
                        <td>{CATEGORY_NAMES[c]}</td>
                        {poss.map((p) => {
                          const r = rows.find((x) => x.cat === c && x.pos === p);
                          if (!r) return <td key={p} className="muted">—</td>;
                          const acc = (r.t.best + r.t.ok) / r.t.n;
                          return (
                            <td key={p} className="mono" style={{ background: `color-mix(in srgb, var(--good) ${Math.round(acc * 45)}%, color-mix(in srgb, var(--bad) ${Math.round((1 - acc) * 45)}%, transparent))` }}>
                              {Math.round(acc * 100)}%<div className="muted small">{r.t.n} 题</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      {stats.mistakes.length > 0 && (
        <div className="card">
          <h3>错题本（{stats.mistakes.length}）</h3>
          <p className="muted small">答错的题会进入错题本，训练时会更多地出现；之后连续答对 2 次自动移除。</p>
          <div className="mistake-list">
            {stats.mistakes
              .slice()
              .reverse()
              .slice(0, 60)
              .map((m, i) => {
                const s = parseSpotId(m.spotId);
                return (
                  <div key={i} className="mistake">
                    <strong>{HAND_CLASSES[m.hand].name}</strong>
                    <span>{spotTitle(s)}</span>
                    <span className="muted small">{s.format.label}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      <div className="card">
        <h3>翻后训练（{pf.total} 题）</h3>
        {Object.keys(pf.tallies).length === 0 ? (
          <p className="muted">还没有翻后训练记录。</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>局面</th>
                <th>决策点</th>
                <th>题数</th>
                <th>正确率</th>
                <th>平均 EV 损失</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pf.tallies).map(([k, t]) => {
                const [g, type] = k.split('|');
                return (
                  <tr key={k}>
                    <td>{g}</td>
                    <td>{NODE_TYPE_NAMES[type as NodeType] ?? type}</td>
                    <td className="mono">{t.n}</td>
                    <td className="mono">{Math.round(((t.best + t.ok) / t.n) * 100)}%</td>
                    <td className="mono">{(t.evLoss / t.n).toFixed(2)}bb</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pf.mistakes.length > 0 && <p className="muted small">翻后错题本：{pf.mistakes.length} 道（训练时约 30% 的题来自错题本，连续答对 2 次后移除）。</p>}
        {pf.total > 0 && (
          <button
            className="btn small danger"
            onClick={() => {
              if (confirm('确定清空翻后训练统计和错题本吗？')) setPf(resetPfStats());
            }}
          >
            清空翻后训练统计
          </button>
        )}
      </div>
      <div className="card">
        <h3>概念练习与课程</h3>
        <ul>
          {Object.entries(drill).map(([k, v]) => (
            <li key={k}>
              {CONCEPT_NAMES[k as ConceptType] ?? k}：{v.good}/{v.n}
            </li>
          ))}
          {Object.entries(lessons).map(([k, v]) => (
            <li key={k}>
              {LESSON_TITLES[k] ?? k} 小测验最好成绩：{v.best}/{v.total}
            </li>
          ))}
          {Object.keys(drill).length + Object.keys(lessons).length === 0 && <li className="muted">暂无记录</li>}
        </ul>
      </div>
      <div className="card">
        <h3>数据管理</h3>
        <div className="btn-row">
          <button className="btn" onClick={download}>
            导出备份
          </button>
          <label className="btn">
            导入备份
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('确定清空所有翻前训练统计和错题本吗？（自定义范围不受影响）')) {
                setStats(resetStats());
                setMsg('已清空');
              }
            }}
          >
            清空训练统计
          </button>
        </div>
        {msg && <p className="msg">{msg}</p>}
      </div>
    </div>
  );
}
