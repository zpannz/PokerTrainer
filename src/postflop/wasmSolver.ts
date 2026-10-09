// WebAssembly 求解器的 JS 胶水代码（对应 solver/wasm/src/lib.rs 导出的函数）
// 浏览器 Worker 和 Node（测试）都可以使用
import type { GameInfo, NodeData, SolveConfig } from './types.ts';

interface Exports {
  memory: WebAssembly.Memory;
  pt_alloc(len: number): number;
  pt_free(ptr: number, len: number): void;
  pt_out_ptr(): number;
  pt_out_len(): number;
  pt_init(ptr: number, len: number): number;
  pt_allocate(compress: number): number;
  pt_solve_step(iteration: number): void;
  pt_exploitability(): number;
  pt_finalize(): void;
  pt_node(ptr: number, len: number): number;
  pt_street_nodes(ptr: number, len: number, maxDepth: number): number;
  pt_reset(): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class WasmSolver {
  private constructor(private ex: Exports) {}

  static async create(source: BufferSource | Response | Promise<Response>): Promise<WasmSolver> {
    let instance: WebAssembly.Instance;
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      instance = (await WebAssembly.instantiate(source, {})).instance;
    } else {
      const resp = await source;
      try {
        instance = (await WebAssembly.instantiateStreaming(resp.clone(), {})).instance;
      } catch {
        instance = (await WebAssembly.instantiate(await resp.arrayBuffer(), {})).instance;
      }
    }
    return new WasmSolver(instance.exports as unknown as Exports);
  }

  /** 当前 WebAssembly 内存大小（字节） */
  memoryBytes(): number {
    return this.ex.memory.buffer.byteLength;
  }

  private out(): string {
    const p = this.ex.pt_out_ptr();
    const n = this.ex.pt_out_len();
    return dec.decode(new Uint8Array(this.ex.memory.buffer, p, n));
  }

  private call(fn: (ptr: number, len: number) => number, arg: string): string {
    const bytes = enc.encode(arg);
    const ptr = this.ex.pt_alloc(bytes.length);
    new Uint8Array(this.ex.memory.buffer, ptr, bytes.length).set(bytes);
    const code = fn(ptr, bytes.length);
    this.ex.pt_free(ptr, bytes.length);
    const text = this.out();
    if (code !== 0) throw new Error(text);
    return text;
  }

  init(cfg: SolveConfig): GameInfo {
    return JSON.parse(this.call((p, n) => this.ex.pt_init(p, n), JSON.stringify(cfg)));
  }

  allocate(compress: boolean): void {
    if (this.ex.pt_allocate(compress ? 1 : 0) !== 0) throw new Error(this.out());
  }

  step(iteration: number): void {
    this.ex.pt_solve_step(iteration);
  }

  exploitability(): number {
    return this.ex.pt_exploitability();
  }

  finalize(): void {
    this.ex.pt_finalize();
  }

  node(history: number[]): NodeData {
    return JSON.parse(this.call((p, n) => this.ex.pt_node(p, n), JSON.stringify(history)));
  }

  streetNodes(history: number[], maxDepth: number): number[][] {
    return JSON.parse(this.call((p, n) => this.ex.pt_street_nodes(p, n, maxDepth), JSON.stringify(history)));
  }

  reset(): void {
    this.ex.pt_reset();
  }
}
