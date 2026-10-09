import { useEffect, useState } from 'react';
import { CardRow } from '../components/Cards.tsx';
import { type ConceptQuestion, type ConceptType, CONCEPT_NAMES, generateConcept } from '../lib/concepts.ts';
import { load, save } from '../lib/storage.ts';

const TYPES = Object.keys(CONCEPT_NAMES) as ConceptType[];
type DrillStats = Record<string, { n: number; good: number }>;

const FORMULAS: Record<ConceptType, string> = {
  potOdds: '底池赔率 = (底池 + 对手下注) : 跟注额',
  requiredEquity: '需要的胜率 = 跟注额 ÷ (底池 + 对手下注 + 跟注额)',
  mdf: 'MDF = 底池 ÷ (底池 + 下注)',
  bluffRatio: '诈唬比例 = 下注 ÷ (底池 + 2 × 下注)',
  outs: 'outs：能让你从落后变成领先的剩余牌张数',
  rule24: '翻牌圈看两张：outs × 4；转牌圈看一张：outs × 2',
};

export function DrillsPage() {
  const [selected, setSelected] = useState<ConceptType[]>(() => load('drillTypes', TYPES));
  const [q, setQ] = useState<ConceptQuestion | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [stats, setStats] = useState<DrillStats>(() => load('drillStats', {}));
  const [streak, setStreak] = useState(0);

  const newQ = (types = selected) => {
    const list = types.length ? types : TYPES;
    setQ(generateConcept(list[Math.floor(Math.random() * list.length)], Math.random));
    setPicked(null);
  };

  useEffect(() => {
    newQ();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return;
      if (picked === null && /^[1-4]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < q.options.length) choose(i);
      } else if (picked !== null && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        newQ();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const choose = (i: number) => {
    if (!q || picked !== null) return;
    setPicked(i);
    const good = i === q.answer;
    setStreak(good ? streak + 1 : 0);
    const s = { ...stats };
    const t = (s[q.type] = { ...(s[q.type] ?? { n: 0, good: 0 }) });
    t.n++;
    if (good) t.good++;
    setStats(s);
    save('drillStats', s);
  };

  const toggle = (t: ConceptType) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    setSelected(next);
    save('drillTypes', next);
    newQ(next);
  };

  return (
    <div className="page">
      <h1>概念练习</h1>
      <div className="chips">
        {TYPES.map((t) => (
          <button key={t} className={`chip ${selected.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>
            {CONCEPT_NAMES[t]}
            {stats[t] && (
              <span className="muted small">
                {' '}
                {stats[t].good}/{stats[t].n}
              </span>
            )}
          </button>
        ))}
      </div>
      {q && (
        <div className="card drill">
          <div className="drill-head">
            <span className="tag">{CONCEPT_NAMES[q.type]}</span>
            <span className="muted small">连续答对 {streak}</span>
          </div>
          <p className="drill-prompt">{q.prompt}</p>
          {q.hero && (
            <div className="drill-cards">
              <div>
                <div className="muted small">手牌</div>
                <CardRow cards={q.hero} />
              </div>
              {q.board && (
                <div>
                  <div className="muted small">公共牌</div>
                  <CardRow cards={q.board} />
                </div>
              )}
            </div>
          )}
          <div className="options">
            {q.options.map((o, i) => (
              <button
                key={i}
                className={`option ${picked !== null && i === q.answer ? 'right' : ''} ${picked === i && i !== q.answer ? 'wrong' : ''}`}
                disabled={picked !== null}
                onClick={() => choose(i)}
              >
                <kbd>{i + 1}</kbd> {o}
              </button>
            ))}
          </div>
          {picked !== null && (
            <div className="explain">
              <strong>{picked === q.answer ? '✓ 正确' : '✗ 错误'}</strong>
              <p>{q.explain}</p>
              <p className="muted small">公式：{FORMULAS[q.type]}</p>
              <button className="btn primary" onClick={() => newQ()}>
                下一题（空格）
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
