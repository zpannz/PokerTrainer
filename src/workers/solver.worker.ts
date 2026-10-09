// 翻后求解器 Worker：在独立线程中运行 WebAssembly 求解器，不阻塞页面
import { WasmSolver } from '../postflop/wasmSolver.ts';
import type { SolveConfig } from '../postflop/types.ts';

export type SolverRequest =
  | { type: 'init'; cfg: SolveConfig }
  | { type: 'solve'; compress: boolean; targetPct: number; maxIter: number }
  | { type: 'stop' }
  | { type: 'node'; id: number; history: number[] }
  | { type: 'streetNodes'; id: number; history: number[]; depth: number };

export type SolverResponse =
  | { type: 'info'; info: import('../postflop/types.ts').GameInfo }
  | { type: 'progress'; iter: number; expl: number | null; seconds: number; memMB: number }
  | { type: 'done'; iter: number; expl: number; seconds: number; stopped: boolean; memMB: number }
  | { type: 'node'; id: number; node: import('../postflop/types.ts').NodeData }
  | { type: 'streetNodes'; id: number; list: number[][] }
  | { type: 'error'; message: string; id?: number };

const post = (m: SolverResponse) => (self as unknown as Worker).postMessage(m);

let solver: WasmSolver | null = null;
let pot = 1;
let stopFlag = false;
let running = false;

async function getSolver(): Promise<WasmSolver> {
  if (!solver) solver = await WasmSolver.create(fetch(new URL('../postflop/wasm/pt_solver.wasm', import.meta.url)));
  return solver;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function solve(compress: boolean, targetPct: number, maxIter: number) {
  const s = await getSolver();
  running = true;
  stopFlag = false;
  const t0 = performance.now();
  s.allocate(compress);
  const mem = () => s.memoryBytes() / 2 ** 20;
  let it = 0;
  let expl = Infinity;
  // 计算可被利用度的开销约等于一轮迭代，前期每 5 轮算一次，之后每 10 轮
  while (it < maxIter) {
    s.step(it);
    it++;
    let e: number | null = null;
    if ((it <= 50 && it % 5 === 0) || it % 10 === 0) {
      expl = s.exploitability();
      e = expl;
    }
    post({ type: 'progress', iter: it, expl: e, seconds: (performance.now() - t0) / 1000, memMB: mem() });
    if (e !== null && (e / pot) * 100 <= targetPct) break;
    await tick();
    if (stopFlag) break;
  }
  if (!Number.isFinite(expl) || it % 10 !== 0) expl = s.exploitability();
  s.finalize();
  running = false;
  post({ type: 'done', iter: it, expl, seconds: (performance.now() - t0) / 1000, stopped: stopFlag, memMB: mem() });
}

self.onmessage = async (e: MessageEvent<SolverRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const s = await getSolver();
      pot = m.cfg.pot;
      post({ type: 'info', info: s.init(m.cfg) });
    } else if (m.type === 'solve') {
      if (running) return;
      await solve(m.compress, m.targetPct, m.maxIter);
    } else if (m.type === 'stop') {
      stopFlag = true;
    } else if (m.type === 'node') {
      post({ type: 'node', id: m.id, node: (await getSolver()).node(m.history) });
    } else if (m.type === 'streetNodes') {
      post({ type: 'streetNodes', id: m.id, list: (await getSolver()).streetNodes(m.history, m.depth) });
    }
  } catch (err) {
    running = false;
    const msg = (err as Error).message || String(err);
    post({ type: 'error', message: /unreachable|memory/i.test(msg) ? `求解器出错（可能是内存不足）：${msg}` : msg, id: 'id' in m ? m.id : undefined });
  }
};
