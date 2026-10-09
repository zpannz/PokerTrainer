# 许可证与第三方署名

## 本项目

PokerTrainer（德州扑克 GTO 学习训练工具）
Copyright (C) 2026 PokerTrainer 贡献者

本程序是自由软件：你可以依据自由软件基金会发布的 GNU Affero 通用公共许可证（AGPL）第 3 版或（由你选择）任何更新的版本，重新发布和/或修改它。
发布本程序是希望它有用，但**没有任何担保**；甚至没有适销性或特定用途适用性的默示担保。详见 [LICENSE](LICENSE)（GNU AGPL v3 全文）。

**为什么整个项目使用 AGPL-3.0：** 第二期的翻后求解器把 postflop-solver（AGPL-3.0-or-later）编译成 WebAssembly，并随网页一起分发给浏览器运行。
AGPL 要求包含它的整体作品以相同许可证发布，并且通过网络向用户提供服务时，要让用户能获取**对应的完整源代码**（第 13 条）。因此：

- 整个仓库（网页、脚本、Rust 封装）以 AGPL-3.0-or-later 发布；
- 网站页脚和"数据说明"页提供源代码仓库链接；部署工作流从本仓库源码重新编译 WebAssembly，保证线上运行的二进制与源码对应；
- 修改后再部署（包括只在网上提供服务）时，也需要公开你修改后的源代码。

## 第三方组件

### postflop-solver（翻后求解引擎）

- 作者：Wataru Inariba
- 仓库：https://github.com/b-inary/postflop-solver （使用提交 `9d1509fe5077d019825f833eed04b16d342dfda1`）
- 许可证：GNU Affero General Public License v3.0 or later
- Copyright (C) 2022 Wataru Inariba
- 使用方式：作为 Cargo 依赖（未修改源码），由 `solver/core` 封装；浏览器端编译为 `src/postflop/wasm/pt_solver.wasm`，预计算端编译为原生程序。
  浏览器接口的设计参考了同一作者的 [WASM Postflop](https://github.com/b-inary/wasm-postflop)（AGPL-3.0），但胶水代码为本项目自行编写（不使用 wasm-bindgen）。
- 算法：Discounted CFR（Brown & Sandholm, 2019）

### Rust 依赖（编译进 WebAssembly / 预计算程序）

| 组件 | 许可证 |
| --- | --- |
| serde, serde_json | MIT OR Apache-2.0 |
| regex, once_cell（postflop-solver 依赖） | MIT OR Apache-2.0 |
| rayon（仅预计算程序） | MIT OR Apache-2.0 |

### 前端依赖

| 组件 | 许可证 |
| --- | --- |
| React, React DOM | MIT |
| Vite, Vitest, TypeScript（仅开发） | MIT / Apache-2.0 |

### LibreGTO

只参考了功能划分，没有复制代码或数据（其仓库没有 LICENSE 文件，见 README）。
