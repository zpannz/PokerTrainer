// 胜率计算放在 Web Worker 中运行，避免阻塞页面
import { calcEquity, type WeightedCombo } from '../lib/equity.ts';

interface Req {
  id: number;
  players: WeightedCombo[][];
  board: number[];
  samples: number;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, players, board, samples } = e.data;
  try {
    const res = calcEquity(players, board, {
      maxExact: 6e6,
      mcSamples: samples,
      onProgress: (p) => (self as unknown as Worker).postMessage({ id, progress: p }),
    });
    (self as unknown as Worker).postMessage({ id, result: res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
