import { useState, type ReactNode } from 'react';
import { RangeGrid } from '../components/RangeGrid.tsx';
import { getEquityMatrix } from '../data/equityData.ts';
import { equityVsRange } from '../data/charts.ts';
import { effectiveChart } from '../data/overrides.ts';
import { classIndex, NUM_CLASSES, rangeCombos, rangePercent } from '../lib/hands.ts';
import { parseRange } from '../lib/rangeText.ts';
import { spotId } from '../lib/formats.ts';
import { icm } from '../lib/icm.ts';
import { load, save } from '../lib/storage.ts';

interface QuizQ {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

interface Lesson {
  id: string;
  title: string;
  summary: string;
  body: () => ReactNode;
  quiz: QuizQ[];
}

// ---------- 小组件 ----------

function Matchups({ pairs }: { pairs: [string, string][] }) {
  const eq = getEquityMatrix();
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>对抗</th>
          <th>胜率</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map(([a, b]) => {
          const v = eq[classIndex(a) * NUM_CLASSES + classIndex(b)];
          return (
            <tr key={a + b}>
              <td>
                {a} vs {b}
              </td>
              <td className="mono">
                {(v * 100).toFixed(1)}% : {((1 - v) * 100).toFixed(1)}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VsRandom({ hands }: { hands: string[] }) {
  const all = new Float64Array(NUM_CLASSES).fill(1);
  const ev = equityVsRange(all);
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>手牌</th>
          <th>对随机手牌的胜率</th>
        </tr>
      </thead>
      <tbody>
        {hands.map((h) => (
          <tr key={h}>
            <td>{h}</td>
            <td className="mono">{(ev[classIndex(h)] * 100).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RangeDemo({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const r = parseRange(text);
  return (
    <div className="demo">
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <div className="muted small">
        {rangeCombos(r.weights).toFixed(0)} 个组合，占全部 1326 个组合的 {rangePercent(r.weights).toFixed(1)}%
        {r.errors.length > 0 && <span className="error"> · {r.errors[0]}</span>}
      </div>
      <RangeGrid data={{ actions: ['raise', 'fold'], freq: { raise: r.weights, fold: r.weights.map((v) => 1 - v) } }} labels={{ raise: '在范围内', fold: '不在范围内' }} compact />
    </div>
  );
}

function ChartDemo({ id }: { id: string }) {
  const c = effectiveChart(id);
  return (
    <div className="demo">
      <RangeGrid data={c} compact />
      <div className="muted small">开池比例 {rangePercent(c.freq.raise ?? c.freq.allin!).toFixed(1)}%</div>
    </div>
  );
}

// ---------- 课程内容 ----------

const LESSONS: Lesson[] = [
  {
    id: 'hand-strength',
    title: '第 1 课：手牌强度 (Hand Strength)',
    summary: '169 种起手牌、组合数、什么让一手牌更强',
    body: () => (
      <>
        <p>
          德州扑克一共有 <strong>1326</strong> 种两张牌的具体组合，按点数和是否同花归为 <strong>169</strong> 类起手牌，正好排成 13×13 的格子：
        </p>
        <ul>
          <li>
            <strong>对子 (Pocket Pair)</strong>（对角线，如 77）：每类 <strong>6</strong> 个组合。
          </li>
          <li>
            <strong>同花 (Suited, s)</strong>（右上，如 AKs）：每类 <strong>4</strong> 个组合。
          </li>
          <li>
            <strong>不同花 (Offsuit, o)</strong>（左下，如 AKo）：每类 <strong>12</strong> 个组合。
          </li>
        </ul>
        <p>这就是为什么 AKo 比 AKs 常见得多：拿到 AKo 的概率是 AKs 的 3 倍。</p>
        <h3>对随机手牌的胜率</h3>
        <p>下面的数值由本工具精确枚举计算（全部 C(48,5) 种公共牌）：</p>
        <VsRandom hands={['AA', 'KK', 'QQ', 'AKs', 'AKo', 'JTs', '22', '72o', '32o']} />
        <h3>影响手牌强度的因素</h3>
        <ul>
          <li>
            <strong>高牌</strong>：A、K 这样的大牌在摊牌时更容易赢。
          </li>
          <li>
            <strong>同花</strong>：同花平均只比不同花多 <strong>约 2~3 个百分点</strong> 的胜率，但同花听牌让它更容易在翻牌后继续（可玩性）。
          </li>
          <li>
            <strong>连张 (Connected)</strong>：如 98s，容易成顺子。
          </li>
          <li>
            <strong>压制 (Domination)</strong>：同一张大牌、踢脚更小的牌处于严重劣势，例如 AQ 对 AK。
          </li>
        </ul>
        <Matchups pairs={[['AKo', 'AQo'], ['KQo', 'AKo'], ['AKs', 'AKo'], ['JTs', 'AKo']]} />
      </>
    ),
    quiz: [
      { q: 'AKo 有多少种具体组合？', options: ['4', '6', '12', '16'], answer: 2, explain: 'A 有 4 种花色、K 有 4 种花色，共 16 种，其中 4 种同花，所以不同花为 12 种。' },
      { q: '一个口袋对子（如 77）有多少种组合？', options: ['4', '6', '12', '3'], answer: 1, explain: '从 4 张 7 中选 2 张：C(4,2) = 6。' },
      { q: '两张起手牌一共有多少种具体组合？', options: ['169', '1326', '2652', '52'], answer: 1, explain: 'C(52,2) = 1326；169 是按点数和同花归类后的类别数。' },
      { q: 'AQo 对 AKo（被压制）的胜率大约是？', options: ['约 25%', '约 45%', '约 50%', '约 60%'], answer: 0, explain: '共用一张 A，AQ 只能靠 Q 赢，胜率约 25%。这就是"被压制"。' },
      { q: '同花手牌比相同点数的不同花手牌，对随机手牌的胜率平均高多少？', options: ['约 2~3 个百分点', '约 10 个百分点', '约 20 个百分点', '完全一样'], answer: 0, explain: '同花的价值主要体现在可玩性，胜率本身只多 2~3 个百分点左右。' },
    ],
  },
  {
    id: 'position',
    title: '第 2 课：位置 (Position)',
    summary: '行动顺序、为什么位置越靠后范围越宽',
    body: () => (
      <>
        <p>
          翻前从大盲左边开始行动：<strong>UTG（枪口）→ … → HJ（劫持位）→ CO（关煞位）→ BTN（按钮）→ SB（小盲）→ BB（大盲）</strong>。翻牌之后则从小盲开始行动，按钮最后行动。
        </p>
        <h3>位置的价值</h3>
        <ul>
          <li>
            <strong>信息</strong>：后行动的人先看到对手的动作再做决定。
          </li>
          <li>
            <strong>实现胜率 (Equity Realization)</strong>：有位置时更容易用中等牌摊牌、用听牌免费看牌，实际赢到的比"纸面胜率"更多。
          </li>
          <li>
            <strong>控制底池</strong>：可以选择过牌控制底池或下注扩大底池。
          </li>
        </ul>
        <h3>开池范围随位置变宽</h3>
        <p>越靠后，身后还没行动的玩家越少，遇到强牌的概率越低，所以开池 (RFI) 范围越宽。对比 6 人桌 100bb 的 UTG 与 BTN：</p>
        <div className="demo-row">
          <div>
            <strong>UTG 开池</strong>
            <ChartDemo id={spotId('cash6-100', 'rfi', 'UTG')} />
          </div>
          <div>
            <strong>BTN 开池</strong>
            <ChartDemo id={spotId('cash6-100', 'rfi', 'BTN')} />
          </div>
        </div>
        <h3>盲注位置</h3>
        <p>
          大盲已经投入 1bb，面对加注时获得很好的<strong>底池赔率 (Pot Odds)</strong>，所以防守范围很宽；但翻牌后没有位置，要多弃掉难以实现胜率的牌。小盲翻后位置最差，现代策略中面对加注多用 3-bet 或弃牌，较少平跟。
        </p>
      </>
    ),
    quiz: [
      { q: '翻前第一个行动的位置是？', options: ['小盲 (SB)', '枪口 (UTG)', '按钮 (BTN)', '大盲 (BB)'], answer: 1, explain: '翻前从大盲左边的 UTG 开始，盲注最后行动。' },
      { q: '翻牌之后最后行动（位置最好）的是？', options: ['BB', 'SB', 'BTN', 'UTG'], answer: 2, explain: '翻牌后从小盲开始行动，按钮永远最后行动。' },
      { q: '6 人桌 100bb，按钮位 (BTN) 的开池比例大约是？', options: ['约 15%', '约 25%', '约 45%', '约 80%'], answer: 2, explain: 'BTN 身后只有两个盲注，开池约 40~50% 的手牌。UTG 只有约 15~18%。' },
      { q: '为什么后位的开池范围更宽？', options: ['后位牌更好', '身后未行动的玩家更少，且翻后有位置', '后位的盲注更小', '规则规定'], answer: 1, explain: '遇到强牌的概率更低，翻后又有位置优势，所以可以用更多手牌盈利地开池。' },
      { q: '大盲防守范围很宽的主要原因是？', options: ['大盲翻后有位置', '大盲已投入 1bb，跟注获得较好的底池赔率', '大盲的牌通常更好', '对手总在诈唬'], answer: 1, explain: '已投入的盲注让跟注的价格变便宜，需要的胜率更低。' },
    ],
  },
  {
    id: 'equity',
    title: '第 3 课：胜率与底池赔率 (Equity & Pot Odds)',
    summary: '胜率的含义、常见对抗、跟注需要多少胜率',
    body: () => (
      <>
        <p>
          <strong>胜率 (Equity)</strong>：如果现在所有人摊牌并发完公共牌，你平均能分到底池的比例（平局按人数平分）。
        </p>
        <h3>常见的翻前对抗（精确计算）</h3>
        <Matchups
          pairs={[
            ['AA', 'KK'],
            ['KK', '77'],
            ['22', 'AKo'],
            ['QQ', 'AKs'],
            ['AKo', 'KQo'],
            ['T9s', 'AKo'],
          ]}
        />
        <ul>
          <li>大对子 vs 小对子：约 80% : 20%。</li>
          <li>对子 vs 两张高牌：接近 50:50（"硬币翻转"，对子略占优）。</li>
          <li>被压制的手牌：约 25~30%。</li>
        </ul>
        <h3>底池赔率 (Pot Odds) 与需要的胜率</h3>
        <p>
          对手下注后，你跟注需要的最低胜率 = <strong>跟注额 ÷ (跟注后的总底池)</strong>。例如底池 100，对手下注 50：你跟 50 去赢 200，需要 50 ÷ 200 = <strong>25%</strong> 的胜率。
        </p>
        <h3>Outs 与 2/4 法则</h3>
        <p>
          <strong>Outs</strong> 是能让你变成领先的牌。粗略估算：翻牌圈看到河牌（两张牌）命中率 ≈ outs × 4%；转牌圈只看一张 ≈ outs × 2%。例如同花听牌 9 outs，翻牌圈约 36%（精确 35.0%）。
        </p>
        <p className="muted">到"工具 → 胜率计算"可以自己验证任意对抗；到"概念练习"做更多计算题。</p>
      </>
    ),
    quiz: [
      { q: '22 对 AKo，翻前胜率大约是？', options: ['22 约 52%', '22 约 80%', '22 约 30%', 'AKo 约 70%'], answer: 0, explain: '对子 vs 两张高牌接近硬币翻转，小对子略占优（约 52.6% : 47.4%）。' },
      { q: 'KK 对 77 的胜率大约是？', options: ['约 55%', '约 65%', '约 80%', '约 95%'], answer: 2, explain: '大对子对小对子约 80% : 20%，小对子主要靠中三条。' },
      { q: '底池 100，对手下注 50。你跟注需要至少多少胜率？', options: ['25%', '33%', '50%', '20%'], answer: 0, explain: '50 ÷ (100 + 50 + 50) = 25%。' },
      { q: '翻牌圈同花听牌（9 outs），到河牌的命中率约是？', options: ['约 18%', '约 36%', '约 50%', '约 9%'], answer: 1, explain: '2/4 法则：9 × 4 = 36%，精确值 35.0%。' },
      { q: '"胜率 (Equity)" 的含义是？', options: ['赢下这手牌的次数', '摊牌时平均能分到底池的比例', '对手弃牌的概率', '手牌的排名'], answer: 1, explain: '胜率包含平局时的平分部分，是"如果直接摊牌"的平均份额。' },
    ],
  },
  {
    id: 'ranges',
    title: '第 4 课：范围 (Ranges)',
    summary: '用范围而不是单手牌思考；范围写法；混合策略',
    body: () => (
      <>
        <p>
          对手不会亮牌，所以我们要考虑他在这个局面下<strong>可能持有的所有手牌</strong>——这就是<strong>范围 (Range)</strong>。GTO 策略也是以范围为单位制定的。
        </p>
        <h3>范围写法</h3>
        <ul>
          <li>
            <code>TT+</code>：TT、JJ、QQ、KK、AA。
          </li>
          <li>
            <code>A2s+</code>：A2s 到 AKs 的所有同花 A。
          </li>
          <li>
            <code>KTo+</code>：KTo、KJo、KQo。
          </li>
          <li>
            <code>QJs-Q9s</code>：QJs、QTs、Q9s。
          </li>
          <li>
            <code>AK</code>：不写 s/o 表示同花和不同花都包括（16 个组合）。
          </li>
          <li>
            <code>A5s:0.5</code> 或 <code>[50]A5s[/50]</code>：50% 的频率。
          </li>
        </ul>
        <p>试着修改下面的范围文字：</p>
        <RangeDemo initial="TT+, AJs+, KQs, AQo+" />
        <h3>混合策略 (Mixed Strategy)</h3>
        <p>
          求解器的结果经常是"某手牌 60% 加注、40% 弃牌"。这表示两个动作的期望值几乎一样，按比例随机选择可以让对手无法针对你。在训练中，选择混合策略里的低频动作（≥10%）会判为"可接受"。
        </p>
        <h3>线性范围与极化范围</h3>
        <ul>
          <li>
            <strong>线性 (Linear/Merged)</strong>：从最强的牌往下连续取，例如开池范围。
          </li>
          <li>
            <strong>极化 (Polarized)</strong>：由很强的价值牌和诈唬牌组成，中等牌更多用跟注，例如很多 3-bet 范围。
          </li>
        </ul>
        <h3>最小防守频率 (MDF)</h3>
        <p>
          面对下注，如果你防守的频率低于 <strong>底池 ÷ (底池 + 下注)</strong>，对手用任意两张牌诈唬都能获利。例如对手下注半个底池，MDF = 1 ÷ 1.5 ≈ 67%。
        </p>
      </>
    ),
    quiz: [
      { q: '"TT+" 一共包含多少个组合？', options: ['5', '20', '30', '36'], answer: 2, explain: 'TT、JJ、QQ、KK、AA 共 5 个对子，每个 6 个组合，共 30 个。' },
      { q: '"A2s+" 表示？', options: ['A2s 到 AKs 的所有同花 A', '所有带 A 的手牌', 'A2s 和 A2o', 'AA 和 A2s'], answer: 0, explain: '"+" 表示把小牌一直升到比大牌小一级。' },
      { q: '"KQ"（不带 s/o）包含多少个组合？', options: ['4', '12', '16', '6'], answer: 2, explain: '4 个同花 + 12 个不同花 = 16。' },
      { q: '"AJo 加注 60%、弃牌 40%" 的意思是？', options: ['AJo 赢的概率是 60%', '每次拿到 AJo，按 60% 的频率加注、40% 弃牌', '对手有 60% 会弃牌', '60% 的时候 AJo 是最强牌'], answer: 1, explain: '这是混合策略：两种动作期望值接近，按频率随机化。' },
      { q: '对手下注一个底池（pot-size bet），你的 MDF 是？', options: ['33%', '50%', '67%', '75%'], answer: 1, explain: 'MDF = 1 ÷ (1 + 1) = 50%。' },
    ],
  },
  {
    id: 'icm',
    title: '第 5 课：锦标赛与 ICM 基础',
    summary: '筹码 ≠ 奖金；ICM；短筹码全下/弃牌',
    body: () => {
      const ex = icm([5000, 3000, 2000], [50, 30, 20]);
      return (
        <>
          <p>
            现金局的筹码就是钱；锦标赛不是。你赢得的筹码越多，<strong>每个筹码的奖金价值越低</strong>，因为第一名的奖金是封顶的，而输光就出局。
          </p>
          <h3>ICM（独立筹码模型）</h3>
          <p>
            ICM 假设每名玩家拿第一名的概率等于他的筹码占比，然后递归计算其他名次，从而把筹码换算成奖金期望。例：3 人剩余，筹码 5000/3000/2000，奖金 50/30/20：
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>筹码</th>
                <th>筹码占比</th>
                <th>ICM 价值</th>
              </tr>
            </thead>
            <tbody>
              {[5000, 3000, 2000].map((s, i) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td>{(s / 100).toFixed(0)}%</td>
                  <td className="mono">{ex[i].toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>大筹码拥有 50% 的筹码，却只有约 38% 的奖金价值；短筹码 20% 的筹码对应约 29% 的奖金价值。</p>
          <h3>对策略的影响</h3>
          <ul>
            <li>
              <strong>风险溢价 (Risk Premium)</strong>：在 ICM 压力下（例如钱圈泡沫期），跟注全下需要比筹码 EV 计算更高的胜率。
            </li>
            <li>大筹码可以对中等筹码施压；中等筹码要避免和大筹码冲突。</li>
            <li>本工具的全下/弃牌表使用<strong>筹码 EV</strong>（不含 ICM），适合锦标赛早中期；接近钱圈时应比表中更紧地跟注。</li>
          </ul>
          <h3>前注与短筹码</h3>
          <ul>
            <li>前注 (Ante) 让底池变大，偷盲更有利可图：开池和防守范围都比现金局更宽。</li>
            <li>筹码在 15bb 左右及以下时，加注后再面对全下就很难弃牌，所以"全下或弃牌 (Push/Fold)"策略接近最优。</li>
          </ul>
          <p className="muted">到"工具 → ICM"可以计算任意局面；到"范围库"选择锦标赛 10~20bb 查看计算得出的纳什全下表。</p>
        </>
      );
    },
    quiz: [
      { q: '在 ICM 模型中，一名玩家获得第一名的概率是？', options: ['1 / 人数', '等于他的筹码占比', '取决于他的手牌', '和筹码无关'], answer: 1, explain: 'ICM 的核心假设：拿第一名的概率 = 筹码 ÷ 总筹码。' },
      {
        q: '3 人剩余，筹码 5000/3000/2000，奖金 50/30/20。最大筹码的 ICM 价值约是？',
        options: ['50', '45', '38.4', '30'],
        answer: 2,
        explain: '用 Malmuth-Harville 算法计算约为 38.39，小于筹码占比对应的 50。',
      },
      { q: '为什么锦标赛中跟注全下往往需要比筹码 EV 更高的胜率？', options: ['因为有前注', '输掉的筹码比赢到的筹码价值更高（ICM 风险溢价）', '因为盲注会上涨', '因为对手更紧'], answer: 1, explain: '筹码的奖金价值是递减的，输掉的损失大于赢到的收益。' },
      { q: '前注 (Ante) 对翻前范围的影响是？', options: ['范围变紧', '范围变宽', '没有影响', '只影响大盲'], answer: 1, explain: '底池中的死钱更多，偷盲收益更高，开池和防守都更宽。' },
      { q: '有效筹码约 10bb 时，首个入池通常采用？', options: ['平跟 (limp)', '小加注', '全下或弃牌', '总是弃牌'], answer: 2, explain: '筹码太短时加注后面对全下很难弃牌，直接全下或弃牌更好。' },
    ],
  },
];

export const LESSON_TITLES: Record<string, string> = Object.fromEntries(LESSONS.map((l) => [l.id, l.title]));

function Quiz({ lesson }: { lesson: Lesson }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => lesson.quiz.map(() => null));
  const done = answers.every((a) => a !== null);
  const score = answers.filter((a, i) => a === lesson.quiz[i].answer).length;
  const pick = (qi: number, oi: number) => {
    if (answers[qi] !== null) return;
    const next = answers.map((a, i) => (i === qi ? oi : a));
    setAnswers(next);
    if (next.every((a) => a !== null)) {
      const s = next.filter((a, i) => a === lesson.quiz[i].answer).length;
      const prog = load<Record<string, { best: number; total: number }>>('lessonProgress', {});
      const prev = prog[lesson.id]?.best ?? 0;
      prog[lesson.id] = { best: Math.max(prev, s), total: lesson.quiz.length };
      save('lessonProgress', prog);
    }
  };
  return (
    <div className="card quiz">
      <h3>小测验</h3>
      {lesson.quiz.map((q, qi) => (
        <div key={qi} className="quiz-q">
          <p>
            <strong>{qi + 1}.</strong> {q.q}
          </p>
          <div className="options">
            {q.options.map((o, oi) => (
              <button
                key={oi}
                disabled={answers[qi] !== null}
                className={`option ${answers[qi] !== null && oi === q.answer ? 'right' : ''} ${answers[qi] === oi && oi !== q.answer ? 'wrong' : ''}`}
                onClick={() => pick(qi, oi)}
              >
                {o}
              </button>
            ))}
          </div>
          {answers[qi] !== null && <p className="muted small">{q.explain}</p>}
        </div>
      ))}
      {done && (
        <div className="quiz-result">
          得分 {score} / {lesson.quiz.length}
          <button className="btn small" onClick={() => setAnswers(lesson.quiz.map(() => null))}>
            重新测验
          </button>
        </div>
      )}
    </div>
  );
}

export function LessonsPage({ route }: { route: string }) {
  const id = route.split('/')[2];
  const lesson = LESSONS.find((l) => l.id === id);
  const prog = load<Record<string, { best: number; total: number }>>('lessonProgress', {});
  if (!lesson)
    return (
      <div className="page">
        <h1>入门课程</h1>
        <p className="muted">五节基础课，每节配小测验。课程中的胜率数字都由本工具精确计算。</p>
        <div className="lesson-list">
          {LESSONS.map((l) => (
            <a key={l.id} href={`#/learn/${l.id}`} className="card lesson-card">
              <h3>{l.title}</h3>
              <p className="muted">{l.summary}</p>
              {prog[l.id] && (
                <span className="tag">
                  测验最好成绩 {prog[l.id].best}/{prog[l.id].total}
                </span>
              )}
            </a>
          ))}
        </div>
      </div>
    );
  const idx = LESSONS.indexOf(lesson);
  return (
    <div className="page lesson">
      <a href="#/learn" className="link">
        ← 课程列表
      </a>
      <h1>{lesson.title}</h1>
      <div className="card prose">{lesson.body()}</div>
      <Quiz key={lesson.id} lesson={lesson} />
      <div className="btn-row">
        {idx > 0 && (
          <a className="btn" href={`#/learn/${LESSONS[idx - 1].id}`}>
            上一课
          </a>
        )}
        {idx < LESSONS.length - 1 && (
          <a className="btn primary" href={`#/learn/${LESSONS[idx + 1].id}`}>
            下一课
          </a>
        )}
      </div>
    </div>
  );
}
