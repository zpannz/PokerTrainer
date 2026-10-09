import { loadStats } from '../lib/trainer.ts';

const CARDS = [
  { href: '#/ranges', title: '翻前范围库', desc: '开池、面对加注、面对 3-bet、盲注防守、锦标赛全下表；13×13 格子显示混合策略。可编辑、导入、导出。' },
  { href: '#/train', title: '翻前训练', desc: '随机出题，立即判分（最佳 / 可接受 / 错误），统计各位置正确率，自动多出你常错的题。' },
  { href: '#/tools/equity', title: '胜率计算器', desc: '手牌对手牌、手牌对范围，最多 3 人，可设公共牌。小计算量精确枚举。' },
  { href: '#/tools/icm', title: 'ICM 计算器', desc: '输入奖金分配和各家筹码，计算每个人的 ICM 价值。' },
  { href: '#/tools/drills', title: '概念练习', desc: '底池赔率、需要的胜率、MDF、诈唬比例、outs 与 2/4 法则。' },
  { href: '#/learn', title: '入门课程', desc: '手牌强度、位置、胜率、范围、锦标赛 ICM 基础，每节配小测验。' },
];

export function HomePage() {
  const stats = loadStats();
  return (
    <div className="page">
      <section className="hero">
        <h1>德州扑克翻前 GTO 学习训练</h1>
        <p>
          面向学习和复盘的工具：查看翻前范围、做针对性训练、用计算器验证你的思路。所有局面都需要手动选择或输入，本工具不读取牌桌、不做实时提示。
        </p>
        {stats.totalAnswered > 0 && (
          <p className="muted">
            你已经回答了 {stats.totalAnswered} 道翻前题，错题本中有 {stats.mistakes.length} 道题。
          </p>
        )}
        <div className="btn-row">
          <a className="btn primary big" href="#/train">
            开始训练
          </a>
          <a className="btn big" href="#/learn">
            从入门课程开始
          </a>
        </div>
      </section>
      <div className="feature-grid">
        {CARDS.map((c) => (
          <a key={c.href} href={c.href} className="card feature">
            <h3>{c.title}</h3>
            <p className="muted">{c.desc}</p>
          </a>
        ))}
      </div>
      <div className="card note">
        <strong>关于数据的可信度：</strong>每张范围表都标注了来源——<span className="src-computed">计算得出</span>（锦标赛 10~20bb 全下/弃牌纳什均衡、胜率、ICM）、
        <span className="src-compiled">公开资料整理</span>（6 人桌现金局开池范围）、<span className="src-approx">近似</span>（其余翻前范围，按典型频率参数化生成）。
        这些都不是商业求解器的精确输出，详见 <a href="#/about">数据说明</a>。
      </div>
    </div>
  );
}
