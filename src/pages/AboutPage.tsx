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
              <td>锦标赛 5~20bb 的全下/弃牌表，5~25bb 面对全下的跟注表，15~30bb 开池 vs 再全下表；胜率计算器；ICM 计算器；课程中的胜率数字；翻后求解结果（在所设的简化博弈树内）</td>
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
              <td>你在范围编辑器中修改、或批量导入的范围方案（可有多套，随时切换）</td>
              <td>只保存在你的浏览器中；可信度取决于你导入的数据来源（导入时可以填写来源说明，会显示在每张表上）</td>
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
          <li>用虚拟博弈 (fictitious play) 迭代 6000 轮求解，并给出"可被利用度"作为收敛指标（每张表都有标注，均小于 0.02bb）。</li>
          <li>不考虑 ICM：接近钱圈或决赛桌时，跟注范围应比表中更紧。</li>
        </ul>
        <h3>开池 vs 再全下（15~30bb）</h3>
        <ul>
          <li>两人子博弈的均衡：开池者按范围库的开池范围加注（开池范围是近似数据，不参与求解），后位玩家只能再全下或弃牌，开池者面对全下跟注或弃牌。</li>
          <li>假设再全下之后其余玩家都弃牌；不考虑平跟（实战中大盲会平跟很多牌，所以表中的再全下范围比"可以平跟"时更宽）；筹码 EV，不考虑 ICM。</li>
          <li>同样用虚拟博弈求解，牌的去除效应按成对计算；每张表标注可被利用度（均小于 0.02bb）。25bb 时 3-bet 即全下，"面对 3-bet"改用这里的精确表。</li>
        </ul>
        <h3>翻后求解器</h3>
        <ul>
          <li>
            引擎为开源的 <a href="https://github.com/b-inary/postflop-solver" target="_blank" rel="noreferrer">postflop-solver</a>（Wataru Inariba，AGPL-3.0），算法为 Discounted CFR，不做牌的抽象（只合并花色同构的发牌）。本项目把它编译成 WebAssembly，在浏览器的 Web Worker 里单线程运行。
          </li>
          <li>精度用"可被利用度"表示：对手针对你的策略做最优反应时每手能多赢多少，以底池百分比计。默认目标 0.5% 底池。</li>
          <li>
            简化：下注尺寸只有预设的几种（实际下注会映射到最接近的尺寸）；每条街限制加注次数；不计抽水；双方范围取自翻前范围库（翻前范围本身多为近似数据）。结果是"这个简化博弈的均衡"，与商业求解器在更丰富尺寸下的结果会有差别。
          </li>
          <li>内存：浏览器中的 WebAssembly 最多 4GB。完整翻牌局面（双方约 650 个组合）在"快速"预设下约 0.9GB（16 位压缩 0.47GB），"标准"约 1.5GB；尺寸更多时可能超出，页面会先估算并提醒。</li>
        </ul>
        <h3>预计算牌面库</h3>
        <ul>
          <li>
            用 GitHub Actions（4 核机器，原生多线程）批量求解：6 人桌 100bb 单挑底池 BTN vs BB、CO vs BB，按花色结构（彩虹/双花/单色）、对子、最高牌、连接程度分层选取约 50 个代表性翻牌，各用"标准"尺寸，目标可被利用度 0.3% 底池。只保存翻牌圈的决策点。
          </li>
          <li>工作流可手动触发，填写局面和翻牌数量即可扩充；当前已计算的翻牌数量见"翻后训练"页面。</li>
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

        <h2>许可证与源代码</h2>
        <p>
          本项目以 GNU AGPL-3.0-or-later 发布（因为包含 AGPL 许可的 postflop-solver），完整源代码：
          <a href="https://github.com/zpannz/PokerTrainer" target="_blank" rel="noreferrer">github.com/zpannz/PokerTrainer</a>。网站上运行的 WebAssembly 由部署流程从该仓库源码重新编译。第三方组件与署名见仓库中的 NOTICE.md。
        </p>

        <h2>使用范围</h2>
        <p>本工具只用于学习与复盘：所有局面都由你手动选择或输入，不读取牌桌、不截屏识别、没有悬浮窗或实时提示。</p>
      </div>
    </div>
  );
}
