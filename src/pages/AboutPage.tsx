export function AboutPage() {
  return (
    <div className="page prose-page">
      <h1>数据说明</h1>
      <div className="card prose">
        <h2>可信度分级</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>标注</th>
              <th>内容</th>
              <th>方法</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="src-computed">计算得出</span>
              </td>
              <td>锦标赛 10/15/20bb 的全下/弃牌表、面对全下的跟注表；胜率计算器；ICM 计算器；课程中的胜率数字</td>
              <td>本工具自己计算（见下文），在说明的模型假设下是精确或可验证收敛的结果</td>
            </tr>
            <tr>
              <td>
                <span className="src-compiled">公开资料整理</span>
              </td>
              <td>6 人桌现金局 100bb 开池（RFI）范围；9 人桌 LJ 及之后位置的开池范围沿用 6 人桌同距离位置</td>
              <td>按公开的求解器开池图表的典型结构整理，不是任何求解器的原始导出；单手牌频率可能有 10~20 个百分点偏差</td>
            </tr>
            <tr>
              <td>
                <span className="src-approx">近似</span>
              </td>
              <td>面对加注、面对 3-bet、盲注防守、9 人桌前位开池、锦标赛 25~60bb 的全部范围</td>
              <td>参数化生成：用精确胜率矩阵计算每手牌对对手范围的胜率，再按公开图表的典型频率（3-bet 比例、防守比例等）分配动作。结构合理，但不是求解器结果</td>
            </tr>
            <tr>
              <td>
                <span className="src-custom">用户自定义</span>
              </td>
              <td>你在范围编辑器中修改或导入的范围</td>
              <td>只保存在你的浏览器中</td>
            </tr>
          </tbody>
        </table>

        <h2>计算方法</h2>
        <h3>169×169 胜率矩阵</h3>
        <p>
          对每一对起手牌类别，枚举所有互不冲突的具体组合（按花色同构归并成约 4.7 万个代表），对每个代表枚举全部 C(48,5) = 1,712,304 种公共牌，精确计算。结果与公认数值一致：AA 对随机手牌 85.20%、72o 34.58%、AA 对 KK 81.95%。
        </p>
        <h3>全下/弃牌纳什均衡</h3>
        <ul>
          <li>筹码 EV（chip EV），所有玩家筹码相同，大盲前注 1bb（由大盲支付）+ 盲注 0.5/1bb。</li>
          <li>首个入池者只能全下或弃牌；其后玩家只能跟注或弃牌；只考虑一人跟注（忽略多人全下，频率很低）。</li>
          <li>牌的去除效应：对手手牌分布以自己的手牌为条件。</li>
          <li>用虚拟博弈 (fictitious play) 迭代 4000 轮求解，并给出"可被利用度"作为收敛指标（每张表都有标注）。</li>
          <li>不考虑 ICM：接近钱圈或决赛桌时，跟注范围应比表中更紧。</li>
        </ul>
        <h3>胜率计算器</h3>
        <p>
          位运算牌力评估器（已用全部 133,784,560 种 7 张牌组合核对牌型分布）。总计算量不超过约 600 万种发牌时精确枚举，否则蒙特卡洛模拟并显示标准误差。
        </p>
        <h3>ICM</h3>
        <p>Malmuth-Harville 算法，用子集记忆化精确计算（与全排列暴力计算结果一致）。</p>

        <h2>与 LibreGTO 的关系</h2>
        <p>
          本项目参考了开源项目 <a href="https://github.com/rdpharr/libregto" target="_blank" rel="noreferrer">LibreGTO</a>（rdpharr/libregto）的功能划分（课程 + 训练 + 范围格子）。
          该仓库的 README 末尾写着 "License: MIT"，但仓库中<strong>没有 LICENSE 许可证文件</strong>（MIT 要求随代码保留版权和许可声明，没有许可文本时授权条款不明确）。
          为稳妥起见，本项目<strong>没有复制它的代码或数据</strong>，只参考思路、全部自行实现。
        </p>
        <p>
          LibreGTO 的翻前范围数据来源：其代码注释与"方法论"页面说明，范围是综合 GTO Wizard（求解器）、PokerCoaching.com（Jonathan Little）、Upswing Poker、Red Chip Poker 等公开资料的"共识范围"手工整理，混合策略被简化为单一动作；注释中提到的研究文档 docs/gto-range-research.md 并不在仓库中。其"对随机手牌胜率"表也标注为近似值。
        </p>

        <h2>使用范围</h2>
        <p>本工具只用于学习与复盘：所有局面都由你手动选择或输入，不读取牌桌、不截屏识别、没有悬浮窗或实时提示。</p>
      </div>
    </div>
  );
}
