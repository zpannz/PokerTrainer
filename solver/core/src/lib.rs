//! postflop-solver 的薄封装：从 JSON 配置建树、按历史读取节点数据。
//! 浏览器（wasm）和 GitHub Actions 预计算（precompute）共用这份代码。
//!
//! 求解引擎：postflop-solver（Copyright (C) 2022 Wataru Inariba，AGPL-3.0-or-later）
//! https://github.com/b-inary/postflop-solver
//!
//! 约定：
//! - 筹码单位由调用方决定（网页里 1bb = 100 筹码），这里只处理整数筹码。
//! - 牌用字符串表示（"Ah"、"Td"），手牌组合用 4 个字符（"AhKd"，大牌在前）。
use postflop_solver::*;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StreetSizes {
    /// 下注尺寸，例如 "33%, 75%"（postflop-solver 语法：%、x、c、e、a）
    pub bet: String,
    /// 加注尺寸，例如 "3x" 或 "60%"
    pub raise: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerSizes {
    pub flop: StreetSizes,
    pub turn: StreetSizes,
    pub river: StreetSizes,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SolveConfig {
    /// [OOP, IP] 范围字符串，例如 "AA,AKs:0.5,KQo"
    pub ranges: [String; 2],
    /// 3~5 张公共牌，例如 "Ah7d2c"
    pub board: String,
    pub pot: i32,
    pub stack: i32,
    /// [OOP, IP] 各街下注尺寸
    pub sizes: [PlayerSizes; 2],
    /// OOP 在转牌/河牌的"领先下注"（donk）尺寸；空字符串表示与 OOP 的普通下注尺寸相同
    #[serde(default)]
    pub donk_turn: String,
    #[serde(default)]
    pub donk_river: String,
    /// 最大下注不超过底池的这个倍数时自动加入全下选项
    #[serde(default = "default_add_allin")]
    pub add_allin_threshold: f64,
    /// 跟注后剩余筹码/底池小于该值时强制全下
    #[serde(default = "default_force_allin")]
    pub force_allin_threshold: f64,
    #[serde(default = "default_merging")]
    pub merging_threshold: f64,
    /// 每条街（翻牌、转牌、河牌）最多允许几次加注（不含第一次下注）。超过后只能跟注或弃牌。
    /// 不限制时博弈树会因"加注-再加注"链条迅速膨胀
    #[serde(default = "default_raise_cap")]
    pub raise_cap: [u32; 3],
}

fn default_raise_cap() -> [u32; 3] {
    [2, 1, 1]
}

fn default_add_allin() -> f64 {
    1.5
}
fn default_force_allin() -> f64 {
    0.15
}
fn default_merging() -> f64 {
    0.1
}

pub fn parse_board(board: &str) -> Result<Vec<Card>, String> {
    let s: String = board.chars().filter(|c| !c.is_whitespace() && *c != ',').collect();
    if s.len() % 2 != 0 {
        return Err(format!("无法解析公共牌: {board}"));
    }
    let mut out = Vec::new();
    for i in (0..s.len()).step_by(2) {
        let c = card_from_str(&s[i..i + 2]).map_err(|e| format!("无效的牌 {}: {e}", &s[i..i + 2]))?;
        if out.contains(&c) {
            return Err(format!("重复的牌: {}", &s[i..i + 2]));
        }
        out.push(c);
    }
    if out.len() < 3 || out.len() > 5 {
        return Err("公共牌必须是 3~5 张".into());
    }
    Ok(out)
}

fn sizes(s: &StreetSizes) -> Result<BetSizeOptions, String> {
    BetSizeOptions::try_from((s.bet.as_str(), s.raise.as_str())).map_err(|e| format!("下注尺寸格式错误（{} / {}）: {e}", s.bet, s.raise))
}

fn donk(s: &str) -> Result<Option<DonkSizeOptions>, String> {
    if s.trim().is_empty() {
        return Ok(None);
    }
    DonkSizeOptions::try_from(s).map(Some).map_err(|e| format!("领先下注尺寸格式错误（{s}）: {e}"))
}

/// 按配置建树（尚未分配求解内存）
pub fn build_game(cfg: &SolveConfig) -> Result<PostFlopGame, String> {
    let board = parse_board(&cfg.board)?;
    let oop: Range = cfg.ranges[0].parse().map_err(|e| format!("OOP 范围格式错误: {e}"))?;
    let ip: Range = cfg.ranges[1].parse().map_err(|e| format!("IP 范围格式错误: {e}"))?;
    if oop.is_empty() || ip.is_empty() {
        return Err("范围不能为空".into());
    }
    if cfg.pot <= 0 || cfg.stack <= 0 {
        return Err("底池和有效筹码必须大于 0".into());
    }
    let (turn, river, state) = match board.len() {
        3 => (NOT_DEALT, NOT_DEALT, BoardState::Flop),
        4 => (board[3], NOT_DEALT, BoardState::Turn),
        _ => (board[3], board[4], BoardState::River),
    };
    let card_config = CardConfig {
        range: [oop, ip],
        flop: [board[0], board[1], board[2]],
        turn,
        river,
    };
    let [o, i] = &cfg.sizes;
    let tree_config = TreeConfig {
        initial_state: state,
        starting_pot: cfg.pot,
        effective_stack: cfg.stack,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [sizes(&o.flop)?, sizes(&i.flop)?],
        turn_bet_sizes: [sizes(&o.turn)?, sizes(&i.turn)?],
        river_bet_sizes: [sizes(&o.river)?, sizes(&i.river)?],
        turn_donk_sizes: donk(&cfg.donk_turn)?,
        river_donk_sizes: donk(&cfg.donk_river)?,
        add_allin_threshold: cfg.add_allin_threshold,
        force_allin_threshold: cfg.force_allin_threshold,
        merging_threshold: cfg.merging_threshold,
    };
    let mut tree = ActionTree::new(tree_config)?;
    let first_street = match board.len() {
        3 => 0,
        4 => 1,
        _ => 2,
    };
    apply_raise_cap(&mut tree, cfg.raise_cap, first_street)?;
    PostFlopGame::with_config(card_config, tree)
}

/// 按 history 计算当前街道（0 翻牌 1 转牌 2 河牌）以及本街已有的加注次数、是否已有下注
fn street_state(history: &[Action], first_street: usize) -> (usize, u32, bool) {
    let mut street = first_street;
    let mut raises = 0;
    let mut bet = false;
    let mut prev_check = false;
    for a in history {
        match a {
            Action::Check => {
                if prev_check {
                    street += 1;
                    raises = 0;
                    bet = false;
                    prev_check = false;
                } else {
                    prev_check = true;
                }
            }
            Action::Call => {
                street += 1;
                raises = 0;
                bet = false;
                prev_check = false;
            }
            Action::Bet(_) => {
                bet = true;
                prev_check = false;
            }
            Action::Raise(_) => {
                raises += 1;
                prev_check = false;
            }
            Action::AllIn(_) => {
                if bet {
                    raises += 1;
                } else {
                    bet = true;
                }
                prev_check = false;
            }
            _ => {}
        }
    }
    (street, raises, bet)
}

/// 删除超过加注次数上限的加注选项
pub fn apply_raise_cap(tree: &mut ActionTree, caps: [u32; 3], first_street: usize) -> Result<(), String> {
    fn rec(tree: &mut ActionTree, caps: &[u32; 3], first: usize) -> Result<(), String> {
        if tree.is_terminal_node() {
            return Ok(());
        }
        let (street, raises, bet) = street_state(tree.history(), first);
        if bet && street < 3 && raises >= caps[street] {
            let remove: Vec<Action> = tree
                .available_actions()
                .iter()
                .copied()
                .filter(|a| matches!(a, Action::Raise(_) | Action::AllIn(_)))
                .collect();
            for a in remove {
                tree.remove_action(a)?;
            }
        }
        let actions: Vec<Action> = tree.available_actions().to_vec();
        for a in actions {
            tree.play(a)?;
            rec(tree, caps, first)?;
            tree.undo()?;
        }
        Ok(())
    }
    tree.back_to_root();
    rec(tree, &caps, first_street)?;
    tree.back_to_root();
    Ok(())
}

pub fn card_str(c: Card) -> String {
    card_to_string(c).unwrap_or_else(|_| "??".into())
}

/// 手牌组合字符串，大牌在前（例如 "AhKd"）
pub fn hand_str(h: (Card, Card)) -> String {
    let (a, b) = if h.0 >= h.1 { (h.0, h.1) } else { (h.1, h.0) };
    format!("{}{}", card_str(a), card_str(b))
}

pub fn action_str(a: &Action) -> String {
    match a {
        Action::Fold => "F".into(),
        Action::Check => "X".into(),
        Action::Call => "C".into(),
        Action::Bet(x) => format!("B{x}"),
        Action::Raise(x) => format!("R{x}"),
        Action::AllIn(x) => format!("A{x}"),
        Action::Chance(c) => format!("D{}", card_str(*c)),
        Action::None => "-".into(),
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub hands: [Vec<String>; 2],
    /// 预计内存（字节）：[32 位浮点, 16 位压缩]
    pub memory: [u64; 2],
}

pub fn game_info(game: &PostFlopGame) -> GameInfo {
    let (m, mc) = game.memory_usage();
    GameInfo {
        hands: [
            game.private_cards(0).iter().map(|&h| hand_str(h)).collect(),
            game.private_cards(1).iter().map(|&h| hand_str(h)).collect(),
        ],
        memory: [m, mc],
    }
}

/// 一个节点的全部数据。数组按 GameInfo.hands 的顺序；strategy / actionEv 为"动作 × 手牌"展开
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeData {
    /// "player" | "chance" | "terminal"
    pub kind: &'static str,
    pub player: usize,
    pub history: Vec<usize>,
    pub board: Vec<String>,
    /// 当前底池（含本街已下注）
    pub pot: i32,
    /// 双方累计投入（相对起始底池）
    pub bets: [i32; 2],
    pub actions: Vec<String>,
    /// 发牌节点：可发的牌
    pub cards: Vec<String>,
    /// 到达本节点的概率（每个组合 0~1，= 翻前范围权重 × 之前各动作的频率）[OOP, IP]
    pub weights: [Vec<f32>; 2],
    /// 归一化权重（再乘以与对手范围不冲突的组合数，用于计算整体比例/胜率/EV）
    pub norm_weights: [Vec<f32>; 2],
    pub equity: [Vec<f32>; 2],
    pub ev: [Vec<f32>; 2],
    pub strategy: Vec<f32>,
    pub action_ev: Vec<f32>,
}

fn round_vec(v: Vec<f32>, scale: f32) -> Vec<f32> {
    v.into_iter().map(|x| if x.is_finite() { (x * scale).round() / scale } else { 0.0 }).collect()
}

/// 检查一段历史能否从根节点走通（避免 postflop-solver 内部 panic）
pub fn validate_history(game: &mut PostFlopGame, history: &[usize]) -> Result<(), String> {
    game.back_to_root();
    for (i, &a) in history.iter().enumerate() {
        if game.is_terminal_node() {
            return Err(format!("第 {} 步：已经是终局节点", i + 1));
        }
        if game.is_chance_node() {
            if a >= 52 || game.possible_cards() & (1u64 << a) == 0 {
                return Err(format!("第 {} 步：这张牌不能发出", i + 1));
            }
        } else if a >= game.available_actions().len() {
            return Err(format!("第 {} 步：无效的动作", i + 1));
        }
        game.play(a);
    }
    Ok(())
}

/// 读取某个节点的数据。solved = false 时只返回结构（不含 EV）
pub fn node_data(game: &mut PostFlopGame, history: &[usize], solved: bool) -> Result<NodeData, String> {
    validate_history(game, history)?;
    let terminal = game.is_terminal_node();
    let chance = !terminal && game.is_chance_node();
    let kind = if terminal {
        "terminal"
    } else if chance {
        "chance"
    } else {
        "player"
    };
    let bets = game.total_bet_amount();
    let pot = game.tree_config().starting_pot + bets[0] + bets[1];
    let mut out = NodeData {
        kind,
        player: if terminal || chance { 0 } else { game.current_player() },
        history: history.to_vec(),
        board: game.current_board().into_iter().map(card_str).collect(),
        pot,
        bets,
        actions: if terminal || chance { vec![] } else { game.available_actions().iter().map(action_str).collect() },
        cards: vec![],
        weights: [vec![], vec![]],
        norm_weights: [vec![], vec![]],
        equity: [vec![], vec![]],
        ev: [vec![], vec![]],
        strategy: vec![],
        action_ev: vec![],
    };
    if chance {
        let mask = game.possible_cards();
        out.cards = (0..52u8).filter(|&c| mask & (1u64 << c) != 0).map(card_str).collect();
    }
    game.cache_normalized_weights();
    for p in 0..2 {
        out.weights[p] = round_vec(game.weights(p).to_vec(), 1e4);
        out.norm_weights[p] = round_vec(game.normalized_weights(p).to_vec(), 1e2);
        if !terminal {
            out.equity[p] = round_vec(game.equity(p), 1e4);
        }
        if solved {
            out.ev[p] = round_vec(game.expected_values(p), 10.0);
        }
    }
    if !terminal && !chance {
        out.strategy = round_vec(game.strategy(), 1e4);
        if solved {
            out.action_ev = round_vec(game.expected_values_detail(game.current_player()), 10.0);
        }
    }
    Ok(out)
}

/// 本街（不经过发牌）可以到达的所有行动节点的历史，按广度优先顺序，最多 max_depth 个动作
pub fn street_histories(game: &mut PostFlopGame, base: &[usize], max_depth: usize) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut queue = vec![base.to_vec()];
    while let Some(h) = queue.first().cloned() {
        queue.remove(0);
        game.apply_history(&h);
        if game.is_terminal_node() || game.is_chance_node() {
            continue;
        }
        out.push(h.clone());
        if h.len() - base.len() >= max_depth {
            continue;
        }
        let n = game.available_actions().len();
        for a in 0..n {
            let mut nh = h.clone();
            nh.push(a);
            queue.push(nh);
        }
    }
    game.back_to_root();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn river_toy(bet: &str) -> SolveConfig {
        // 河牌"极化范围 vs 抓诈唬范围"玩具局面：
        // 公共牌 As Ks Qd 7c 2h；OOP：JT（坚果顺子，16 组合）+ 65（空气，16 组合）；IP：88（抓诈唬，6 组合）
        // 只有 OOP 可以下注（一个尺寸），IP 只能跟注/弃牌
        SolveConfig {
            ranges: ["JT,65".into(), "88".into()],
            board: "AsKsQd7c2h".into(),
            pot: 100,
            stack: 1000,
            sizes: [
                PlayerSizes { river: StreetSizes { bet: bet.into(), raise: "".into() }, ..Default::default() },
                PlayerSizes::default(),
            ],
            donk_turn: String::new(),
            donk_river: String::new(),
            add_allin_threshold: 0.0,
            force_allin_threshold: 0.0,
            merging_threshold: 0.0,
            raise_cap: [2, 2, 2],
        }
    }

    /// 返回 (OOP 空气下注频率, OOP 坚果下注频率, IP 跟注频率)
    fn solve_toy(bet: &str) -> (f64, f64, f64) {
        let mut game = build_game(&river_toy(bet)).unwrap();
        game.allocate_memory(false);
        let expl = solve(&mut game, 3000, 0.001, false);
        assert!(expl < 0.05, "exploitability {expl}");
        let root = node_data(&mut game, &[], true).unwrap();
        assert_eq!(root.actions, vec!["X".to_string(), format!("B{}", (bet.trim_end_matches('%').parse::<f64>().unwrap()) as i32)]);
        let hands = game_info(&game).hands;
        let n = hands[0].len();
        let (mut air, mut nut, mut air_n, mut nut_n) = (0.0, 0.0, 0.0, 0.0);
        for (i, h) in hands[0].iter().enumerate() {
            let w = root.weights[0][i] as f64;
            let b = root.strategy[n + i] as f64;
            if h.starts_with('J') {
                nut += w * b;
                nut_n += w;
            } else {
                air += w * b;
                air_n += w;
            }
        }
        let bet_node = node_data(&mut game, &[1], true).unwrap();
        assert_eq!(bet_node.actions[0], "F");
        let m = bet_node.weights[1].len();
        let (mut call, mut tot) = (0.0, 0.0);
        for i in 0..m {
            let w = bet_node.weights[1][i] as f64;
            call += w * bet_node.strategy[m + i] as f64;
            tot += w;
        }
        (air / air_n, nut / nut_n, call / tot)
    }

    #[test]
    fn river_polarized_vs_bluffcatcher_pot_bet() {
        // 下注 = 底池：诈唬:价值 = B/(P+B) = 1/2 → 空气下注 50%；跟注频率 = P/(P+B) = 50%
        let (air, nut, call) = solve_toy("100%");
        assert!((nut - 1.0).abs() < 0.01, "nut {nut}");
        assert!((air - 0.5).abs() < 0.02, "air {air}");
        assert!((call - 0.5).abs() < 0.02, "call {call}");
    }

    #[test]
    fn river_polarized_vs_bluffcatcher_half_pot() {
        // 下注 = 半池：诈唬:价值 = 50/150 = 1/3 → 空气下注 33.3%；跟注频率 = 100/150 = 66.7%
        let (air, nut, call) = solve_toy("50%");
        assert!((nut - 1.0).abs() < 0.01, "nut {nut}");
        assert!((air - 1.0 / 3.0).abs() < 0.02, "air {air}");
        assert!((call - 2.0 / 3.0).abs() < 0.02, "call {call}");
    }

    #[test]
    fn bad_config_is_error() {
        let mut c = river_toy("50%");
        c.board = "AsAs7c".into();
        assert!(build_game(&c).is_err());
        c.board = "AsKs".into();
        assert!(build_game(&c).is_err());
        let mut c = river_toy("50%");
        c.ranges[0] = "XYZ".into();
        assert!(build_game(&c).is_err());
    }
}
