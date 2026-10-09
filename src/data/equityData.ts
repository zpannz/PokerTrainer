// 预计算数据的加载（169×169 胜率矩阵、全下/弃牌纳什均衡结果）
import type { PushFoldResult } from '../lib/nash.ts';

let EQ: Float64Array | null = null;
let PF: Record<string, PushFoldResult> | null = null;

export interface PushFoldFile {
  note: string;
  results: Record<string, PushFoldResult>;
}

export async function loadData(): Promise<void> {
  if (!EQ) {
    const m = (await import('./generated/equity169.json')).default as { scale: number; eq: number[] };
    EQ = Float64Array.from(m.eq, (v) => v / m.scale);
  }
  if (!PF) {
    const m = (await import('./generated/pushfold.json')).default as unknown as PushFoldFile;
    PF = m.results;
  }
}

export function dataReady(): boolean {
  return EQ !== null && PF !== null;
}

export function getEquityMatrix(): Float64Array {
  if (!EQ) throw new Error('胜率数据尚未加载');
  return EQ;
}

/** key = `${players}-${stack}` */
export function getPushFold(players: number, stack: number): PushFoldResult | undefined {
  if (!PF) throw new Error('全下数据尚未加载');
  return PF[`${players}-${stack}`];
}
