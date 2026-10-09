//! 浏览器端求解器：编译成 wasm32-unknown-unknown，在 Web Worker 里单线程运行。
//! 不依赖 wasm-bindgen，导出几个 C ABI 函数，由 src/solver/wasmSolver.ts 手写胶水代码调用：
//! 字符串参数由 JS 写入 pt_alloc 分配的内存；返回的 JSON 存放在 OUT 缓冲区，JS 通过 pt_out_ptr/pt_out_len 读取。
//!
//! 求解引擎：postflop-solver（Copyright (C) 2022 Wataru Inariba，AGPL-3.0-or-later）
use pt_solver_core::*;
use std::cell::RefCell;

thread_local! {
    static GAME: RefCell<Option<postflop_solver::PostFlopGame>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SOLVED: RefCell<bool> = const { RefCell::new(false) };
}

fn set_out(s: String) {
    OUT.with(|o| *o.borrow_mut() = s.into_bytes());
}

fn ok<T: serde::Serialize>(v: &T) -> i32 {
    set_out(serde_json::to_string(v).unwrap_or_else(|_| "null".into()));
    0
}

fn err(msg: String) -> i32 {
    set_out(msg);
    1
}

unsafe fn read_str(ptr: *const u8, len: usize) -> String {
    let bytes = std::slice::from_raw_parts(ptr, len);
    String::from_utf8_lossy(bytes).into_owned()
}

#[no_mangle]
pub extern "C" fn pt_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// ptr 必须来自 pt_alloc(len)
#[no_mangle]
pub unsafe extern "C" fn pt_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

#[no_mangle]
pub extern "C" fn pt_out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn pt_out_len() -> usize {
    OUT.with(|o| o.borrow().len())
}

/// 建树。参数为 SolveConfig 的 JSON。成功返回 0，OUT = GameInfo JSON；失败返回 1，OUT = 错误信息
///
/// # Safety
/// ptr/len 指向有效的 UTF-8 字节
#[no_mangle]
pub unsafe extern "C" fn pt_init(ptr: *const u8, len: usize) -> i32 {
    let text = read_str(ptr, len);
    let cfg: SolveConfig = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(e) => return err(format!("配置格式错误: {e}")),
    };
    GAME.with(|g| *g.borrow_mut() = None);
    SOLVED.with(|s| *s.borrow_mut() = false);
    match build_game(&cfg) {
        Ok(game) => {
            let info = game_info(&game);
            GAME.with(|g| *g.borrow_mut() = Some(game));
            ok(&info)
        }
        Err(e) => err(e),
    }
}

/// 分配求解所需内存。compress = 1 时用 16 位整数存储（内存约减半，精度略降）
#[no_mangle]
pub extern "C" fn pt_allocate(compress: i32) -> i32 {
    GAME.with(|g| match g.borrow_mut().as_mut() {
        Some(game) => {
            game.allocate_memory(compress != 0);
            0
        }
        None => err("尚未建树".into()),
    })
}

/// 迭代一轮（Discounted CFR）
#[no_mangle]
pub extern "C" fn pt_solve_step(iteration: u32) {
    GAME.with(|g| {
        if let Some(game) = g.borrow().as_ref() {
            postflop_solver::solve_step(game, iteration);
        }
    })
}

/// 当前可被利用度（筹码）
#[no_mangle]
pub extern "C" fn pt_exploitability() -> f32 {
    GAME.with(|g| match g.borrow().as_ref() {
        Some(game) => postflop_solver::compute_exploitability(game),
        None => -1.0,
    })
}

/// 结束求解（把累计策略归一化，之后才能读取 EV）
#[no_mangle]
pub extern "C" fn pt_finalize() {
    GAME.with(|g| {
        if let Some(game) = g.borrow_mut().as_mut() {
            postflop_solver::finalize(game);
            SOLVED.with(|s| *s.borrow_mut() = true);
        }
    })
}

fn parse_history(text: &str) -> Result<Vec<usize>, String> {
    serde_json::from_str::<Vec<usize>>(text).map_err(|e| format!("历史格式错误: {e}"))
}

/// 读取节点。参数为动作序号数组的 JSON（发牌节点用牌的编号，见 postflop-solver 的 Card）
///
/// # Safety
/// ptr/len 指向有效的 UTF-8 字节
#[no_mangle]
pub unsafe extern "C" fn pt_node(ptr: *const u8, len: usize) -> i32 {
    let history = match parse_history(&read_str(ptr, len)) {
        Ok(h) => h,
        Err(e) => return err(e),
    };
    let solved = SOLVED.with(|s| *s.borrow());
    GAME.with(|g| match g.borrow_mut().as_mut() {
        Some(game) => match node_data(game, &history, solved) {
            Ok(n) => ok(&n),
            Err(e) => err(e),
        },
        None => err("尚未建树".into()),
    })
}

/// 本街可到达的行动节点历史（用于缓存翻牌圈的全部决策点）
///
/// # Safety
/// ptr/len 指向有效的 UTF-8 字节
#[no_mangle]
pub unsafe extern "C" fn pt_street_nodes(ptr: *const u8, len: usize, max_depth: u32) -> i32 {
    let history = match parse_history(&read_str(ptr, len)) {
        Ok(h) => h,
        Err(e) => return err(e),
    };
    GAME.with(|g| match g.borrow_mut().as_mut() {
        Some(game) => {
            if let Err(e) = validate_history(game, &history) {
                return err(e);
            }
            let list = street_histories(game, &history, max_depth as usize);
            ok(&list)
        }
        None => err("尚未建树".into()),
    })
}

/// 释放整棵树（求解结束后可以让 JS 直接结束 Worker，这个函数用于同一 Worker 中重新求解）
#[no_mangle]
pub extern "C" fn pt_reset() {
    GAME.with(|g| *g.borrow_mut() = None);
    SOLVED.with(|s| *s.borrow_mut() = false);
}
