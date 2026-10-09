import { useState } from 'react';
import type { Format } from '../lib/formats.ts';
import { spotTitle, parseSpotId } from '../lib/formats.ts';
import { exportScheme, fitToSpot, importRanges } from '../lib/rangeImport.ts';
import { formatRange } from '../lib/rangeText.ts';
import {
  DEFAULT_SCHEME_ID,
  DEFAULT_SCHEME_NAME,
  activeScheme,
  activeSchemeId,
  createScheme,
  deleteScheme,
  listSchemes,
  mergeIntoScheme,
  renameScheme,
  setActiveScheme,
  toOverride,
  type OverrideData,
} from '../data/overrides.ts';

/** 页面顶部的一行：当前使用的数据方案与可信度 */
export function SchemeBar({ onManage }: { onManage?: () => void }) {
  const s = activeScheme();
  return (
    <div className="scheme-bar">
      <span>
        当前数据方案：<strong>{s ? s.name : DEFAULT_SCHEME_NAME}</strong>
      </span>
      <span className="muted">
        {s
          ? `${Object.keys(s.spots).length} 个局面使用该方案（${s.note || '未填写来源'}，可信度取决于来源），其余局面使用默认数据`
          : '每张表单独标注可信度：计算得出 ✓ / 公开资料整理 / 近似 ≈'}
      </span>
      {onManage ? (
        <button className="link" onClick={onManage}>
          切换 / 导入方案
        </button>
      ) : (
        <a href="#/ranges">切换 / 导入方案</a>
      )}
    </div>
  );
}

const SAMPLE = `# 示例：每节以 # 局面 开头（局面写范围库里的标题或 id），下面每行"动作: 范围"
# BTN 开池
raise: 22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 98s, A8o+, KTo+, QJo, A5o:0.5

# BB 面对 BTN 开池
3bet: AA-QQ, AKs, A5s:0.5, A4s:0.5, AKo
call: JJ-22, AQs-A6s, KQo, [50]K9o,Q9o[/50]`;

export function SchemePanel({ format, currentSpot, onChange }: { format: Format; currentSpot: string | null; onChange: () => void }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState<'new' | 'active'>('new');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [, force] = useState(0);
  const refresh = () => {
    force((x) => x + 1);
    onChange();
  };
  const schemes = listSchemes();
  const active = activeSchemeId();

  const doImport = () => {
    const r = importRanges(text, format, currentSpot);
    const warns: string[] = [...r.errors];
    const spots: Record<string, OverrideData> = {};
    for (const [id, f] of Object.entries(r.spots)) {
      const fit = fitToSpot(id, f);
      if (fit.warn) warns.push(`${spotTitle(parseSpotId(id))}：${fit.warn}`);
      spots[id] = toOverride(fit.freq, `批量导入（${r.kind}）`);
    }
    const n = Object.keys(spots).length;
    setErrors(warns.slice(0, 20));
    if (n === 0) {
      setMsg('没有导入任何局面。');
      return;
    }
    if (target === 'new' || active === DEFAULT_SCHEME_ID) {
      const s = createScheme(name || `导入的方案 ${new Date().toLocaleDateString('zh-CN')}`, note, spots);
      setActiveScheme(s.id);
      setMsg(`已新建方案「${s.name}」并切换过去，包含 ${n} 个局面：${Object.keys(spots).slice(0, 6).map((id) => spotTitle(parseSpotId(id))).join('、')}${n > 6 ? ' 等' : ''}。`);
    } else {
      mergeIntoScheme(active, spots);
      setMsg(`已把 ${n} 个局面写入当前方案。`);
    }
    refresh();
  };

  const loadFile = (f: File) => void f.text().then((t) => setText(t));

  const download = (id: string) => {
    const s = schemes.find((x) => x.id === id);
    if (!s) return;
    const blob = new Blob([exportScheme(s.name, s.note, Object.fromEntries(Object.entries(s.spots).map(([k, v]) => [k, v.freq])), (w) => formatRange(w))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card">
      <h3>范围方案</h3>
      <p className="muted small">
        可以保存多套范围方案（例如"默认数据"和"我从某个求解器导入的版本"），随时切换。方案只需要包含它覆盖的局面，其余局面自动使用默认数据。训练、范围库、翻后求解器的范围都使用当前方案。
      </p>
      <table className="tbl">
        <tbody>
          <tr>
            <td>
              <label className="check">
                <input type="radio" checked={active === DEFAULT_SCHEME_ID} onChange={() => (setActiveScheme(DEFAULT_SCHEME_ID), refresh())} /> {DEFAULT_SCHEME_NAME}
              </label>
            </td>
            <td className="muted small">内置，每张表单独标注可信度</td>
            <td></td>
          </tr>
          {schemes.map((s) => (
            <tr key={s.id}>
              <td>
                <label className="check">
                  <input type="radio" checked={active === s.id} onChange={() => (setActiveScheme(s.id), refresh())} /> {s.name}
                </label>
              </td>
              <td className="muted small">
                {Object.keys(s.spots).length} 个局面 · {s.note || '未填写来源'}
              </td>
              <td>
                <button
                  className="link"
                  onClick={() => {
                    const n = prompt('方案名称', s.name);
                    if (n === null) return;
                    const d = prompt('数据来源 / 可信度说明', s.note);
                    renameScheme(s.id, n, d ?? undefined);
                    refresh();
                  }}
                >
                  改名
                </button>{' '}
                <button className="link" onClick={() => download(s.id)}>
                  导出
                </button>{' '}
                <button
                  className="link"
                  onClick={() => {
                    if (confirm(`删除方案「${s.name}」？`)) {
                      deleteScheme(s.id);
                      refresh();
                    }
                  }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>批量导入</h3>
      <p className="muted small">
        支持：① 分节文字（每节"# 局面"开头，下面"动作: 范围"，范围为 PioSolver / GTO+ 写法，如 AKs:0.5、[50]A5s,A4s[/50]）；② CSV（表头含 hand 列和 raise / call / allin 等动作列，可加 spot 列，数值 0~1 或百分比）；③ 本工具导出的方案 JSON。
        没有写局面时导入到当前选中的局面{currentSpot ? `（${spotTitle(parseSpotId(currentSpot))}）` : ''}。局面标题按当前格式（{format.label}）匹配，也可以写局面 id（如 cash6-100/rfi/BTN/）。
      </p>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12 }} />
      <div className="btn-row">
        <label className="btn small">
          从文件读取（.txt / .csv / .json）
          <input type="file" accept=".txt,.csv,.json,.rng,text/plain,application/json" hidden onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
        </label>
        <button className="btn small" onClick={() => setText(SAMPLE)}>
          填入示例
        </button>
      </div>
      <div className="pf-form">
        <div className="field">
          <label>导入到</label>
          <div className="seg">
            <button className={target === 'new' ? 'on' : ''} onClick={() => setTarget('new')}>
              新方案
            </button>
            <button className={target === 'active' ? 'on' : ''} disabled={active === DEFAULT_SCHEME_ID} onClick={() => setTarget('active')}>
              当前方案
            </button>
          </div>
        </div>
        {target === 'new' && (
          <>
            <div className="field">
              <label>方案名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：某求解器 100bb 导出" />
            </div>
            <div className="field">
              <label>来源 / 可信度说明</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：GTO Wizard 截图手工录入，约 ±5%" />
            </div>
          </>
        )}
      </div>
      <button className="btn primary" onClick={doImport} disabled={!text.trim()}>
        导入
      </button>
      {msg && <p className="msg">{msg}</p>}
      {errors.length > 0 && (
        <div className="warn-box small">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
