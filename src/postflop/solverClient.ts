// 主线程使用的求解器客户端：封装 Worker 消息
import type { SolverRequest, SolverResponse } from '../workers/solver.worker.ts';
import type { GameInfo, NodeData, SolveConfig } from './types.ts';

export interface Progress {
  iter: number;
  expl: number | null;
  seconds: number;
  memMB: number;
}

export interface DoneInfo {
  iter: number;
  expl: number;
  seconds: number;
  stopped: boolean;
  memMB: number;
}

export class SolverClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initWaiter: { resolve: (v: GameInfo) => void; reject: (e: Error) => void } | null = null;
  private solveWaiter: { resolve: (v: DoneInfo) => void; reject: (e: Error) => void } | null = null;
  onProgress: ((p: Progress) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<SolverResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.failAll(new Error(e.message || '求解器 Worker 出错'));
  }

  private failAll(err: Error) {
    this.initWaiter?.reject(err);
    this.solveWaiter?.reject(err);
    this.initWaiter = this.solveWaiter = null;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private handle(m: SolverResponse) {
    switch (m.type) {
      case 'info':
        this.initWaiter?.resolve(m.info);
        this.initWaiter = null;
        break;
      case 'progress':
        this.onProgress?.(m);
        break;
      case 'done':
        this.solveWaiter?.resolve(m);
        this.solveWaiter = null;
        break;
      case 'node':
        this.pending.get(m.id)?.resolve(m.node);
        this.pending.delete(m.id);
        break;
      case 'streetNodes':
        this.pending.get(m.id)?.resolve(m.list);
        this.pending.delete(m.id);
        break;
      case 'error': {
        const err = new Error(m.message);
        if (m.id !== undefined && this.pending.has(m.id)) {
          this.pending.get(m.id)!.reject(err);
          this.pending.delete(m.id);
        } else this.failAll(err);
      }
    }
  }

  private send(m: SolverRequest) {
    this.worker.postMessage(m);
  }

  init(cfg: SolveConfig): Promise<GameInfo> {
    return new Promise((resolve, reject) => {
      this.initWaiter = { resolve, reject };
      this.send({ type: 'init', cfg });
    });
  }

  solve(compress: boolean, targetPct: number, maxIter: number): Promise<DoneInfo> {
    return new Promise((resolve, reject) => {
      this.solveWaiter = { resolve, reject };
      this.send({ type: 'solve', compress, targetPct, maxIter });
    });
  }

  stop() {
    this.send({ type: 'stop' });
  }

  node(history: number[]): Promise<NodeData> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'node', id, history });
    });
  }

  streetNodes(history: number[], depth: number): Promise<number[][]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'streetNodes', id, history, depth });
    });
  }

  /** 结束 Worker，释放全部内存（WebAssembly 内存只增不减，只能这样释放） */
  terminate() {
    this.worker.terminate();
    this.failAll(new Error('求解器已关闭'));
  }
}
