//! 预计算牌面库：批量求解代表性翻牌，输出压缩的 JSON（在 GitHub Actions 上运行，多线程）
//!
//! 用法：pt-precompute <jobs.json> <输出目录> [--shard i/n]
//! jobs.json 由 scripts/gen-postflop-jobs.ts 生成：
//! { "scenarios": [{ "id", "dir", "title", "players", "ranges", "pot", "stack" }],
//!   "flops": ["AsJhTd", ...], "sizes": [OOP, IP], "raiseCap": [1,0,0],
//!   "targetPct": 0.3, "maxIter": 1000, "depth": 4 }
//!
//! 每个 (局面, 翻牌) 输出 <输出目录>/<dir>/<flop>.json，只保存翻牌圈的决策点。
//! 已存在且配置相同的文件会跳过（方便增量扩充）。
use postflop_solver::*;
use pt_solver_core::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    id: String,
    dir: String,
    title: String,
    players: [String; 2],
    ranges: [String; 2],
    pot: i32,
    stack: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Jobs {
    scenarios: Vec<Scenario>,
    flops: Vec<String>,
    sizes: [PlayerSizes; 2],
    raise_cap: [u32; 3],
    target_pct: f32,
    max_iter: u32,
    #[serde(default = "default_depth")]
    depth: usize,
}

fn default_depth() -> usize {
    4
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    ranges: [String; 2],
    pot: i32,
    stack: i32,
    sizes: [PlayerSizes; 2],
    raise_cap: [u32; 3],
    target_pct: f32,
}

fn ints(v: &[f32], scale: f32) -> Vec<i64> {
    v.iter().map(|&x| if x.is_finite() { (x * scale).round() as i64 } else { 0 }).collect()
}

/// 节点的紧凑表示：频率为千分比，EV 为筹码整数，权重/胜率为千分比
fn compact(n: &NodeData) -> Value {
    let mut o = json!({
        "k": n.kind,
        "p": n.player,
        "pot": n.pot,
        "b": n.bets,
        "a": n.actions,
        "w": [ints(&n.weights[0], 1000.0), ints(&n.weights[1], 1000.0)],
        "nw": [ints(&n.norm_weights[0], 10.0), ints(&n.norm_weights[1], 10.0)],
        "q": [ints(&n.equity[0], 1000.0), ints(&n.equity[1], 1000.0)],
        "v": [ints(&n.ev[0], 1.0), ints(&n.ev[1], 1.0)],
    });
    if !n.strategy.is_empty() {
        o["s"] = json!(ints(&n.strategy, 1000.0));
        o["e"] = json!(ints(&n.action_ev, 1.0));
    }
    o
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("用法: pt-precompute <jobs.json> <输出目录> [--shard i/n]");
        std::process::exit(2);
    }
    let jobs: Jobs = serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("无法读取 jobs.json")).expect("jobs.json 格式错误");
    let out_dir = std::path::PathBuf::from(&args[2]);
    let (shard, shards) = match args.iter().position(|a| a == "--shard") {
        Some(i) => {
            let s: Vec<usize> = args[i + 1].split('/').map(|x| x.parse().unwrap()).collect();
            (s[0], s[1])
        }
        None => (0, 1),
    };
    println!("线程数: {}", rayon::current_num_threads());

    let mut tasks = Vec::new();
    for sc in &jobs.scenarios {
        for flop in &jobs.flops {
            tasks.push((sc.clone(), flop.clone()));
        }
    }
    let total = tasks.len();
    let mut failed = 0;
    for (idx, (sc, flop)) in tasks.into_iter().enumerate() {
        if idx % shards != shard {
            continue;
        }
        let meta = Meta {
            ranges: sc.ranges.clone(),
            pot: sc.pot,
            stack: sc.stack,
            sizes: jobs.sizes.clone(),
            raise_cap: jobs.raise_cap,
            target_pct: jobs.target_pct,
        };
        let meta_v = serde_json::to_value(&meta).unwrap();
        let dir = out_dir.join(&sc.dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{flop}.json"));
        if let Ok(old) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&old) {
                if v.get("meta") == Some(&meta_v) {
                    println!("[{}/{}] {} {} 已存在，跳过", idx + 1, total, sc.id, flop);
                    continue;
                }
            }
        }
        let cfg = SolveConfig {
            ranges: sc.ranges.clone(),
            board: flop.clone(),
            pot: sc.pot,
            stack: sc.stack,
            sizes: jobs.sizes.clone(),
            donk_turn: String::new(),
            donk_river: String::new(),
            add_allin_threshold: 1.5,
            force_allin_threshold: 0.15,
            merging_threshold: 0.1,
            raise_cap: jobs.raise_cap,
        };
        let t0 = Instant::now();
        let mut game = match build_game(&cfg) {
            Ok(g) => g,
            Err(e) => {
                eprintln!("{} {} 建树失败: {e}", sc.id, flop);
                failed += 1;
                continue;
            }
        };
        let (mem, mem_c) = game.memory_usage();
        // 超过 6GB 时使用 16 位压缩（GitHub Actions 标准机器 16GB 内存）
        let compress = mem > 6 * (1 << 30);
        game.allocate_memory(compress);
        let target = sc.pot as f32 * jobs.target_pct / 100.0;
        let mut expl = f32::INFINITY;
        let mut iter = 0;
        while iter < jobs.max_iter {
            solve_step(&game, iter);
            iter += 1;
            if iter % 10 == 0 {
                expl = compute_exploitability(&game);
                if expl <= target {
                    break;
                }
            }
        }
        if iter % 10 != 0 {
            expl = compute_exploitability(&game);
        }
        finalize(&mut game);
        let info = game_info(&game);
        let mut nodes = serde_json::Map::new();
        for h in street_histories(&mut game, &[], jobs.depth) {
            let n = node_data(&mut game, &h, true).unwrap();
            let key = h.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",");
            nodes.insert(key, compact(&n));
        }
        let secs = t0.elapsed().as_secs_f64();
        let out = json!({
            "v": 1,
            "scenario": sc.id,
            "title": sc.title,
            "players": sc.players,
            "flop": flop,
            "meta": meta_v,
            "hands": [info.hands[0].join(" "), info.hands[1].join(" ")],
            "expl": expl,
            "iter": iter,
            "seconds": (secs * 10.0).round() / 10.0,
            "memoryMB": ((if compress { mem_c } else { mem }) >> 20),
            "compressed": compress,
            "nodes": nodes,
        });
        std::fs::write(&path, serde_json::to_string(&out).unwrap()).unwrap();
        println!(
            "[{}/{}] {} {}: {} 轮，{:.1} 秒，内存 {}MB{}，可被利用度 {:.3}% 底池",
            idx + 1,
            total,
            sc.id,
            flop,
            iter,
            secs,
            (if compress { mem_c } else { mem }) >> 20,
            if compress { "（压缩）" } else { "" },
            expl / sc.pot as f32 * 100.0
        );
    }
    if failed > 0 {
        eprintln!("{failed} 个局面失败");
        std::process::exit(1);
    }
}
