// 求解结果的数据来源：正在运行的求解器（可以读取任意节点）或已缓存的结果
import type { NodeSource } from '../components/SpotExplorer.tsx';
import { putSolve } from './cache.ts';
import type { SolverClient } from './solverClient.ts';
import { historyKey, type NodeData, type SolvedSpot } from './types.ts';

export function cacheSource(spot: SolvedSpot): NodeSource {
  return {
    hands: spot.hands,
    live: false,
    players: spot.players ?? ['OOP', 'IP'],
    getNode: async (h) => spot.nodes[historyKey(h)] ?? null,
  };
}

/** 从求解器读取节点，并把读过的节点追加到缓存（防抖保存到 IndexedDB） */
export function liveSource(client: SolverClient, spot: SolvedSpot, persist = true): NodeSource {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Map<string, Promise<NodeData>>();
  return {
    hands: spot.hands,
    live: true,
    players: spot.players ?? ['OOP', 'IP'],
    getNode: async (h) => {
      const k = historyKey(h);
      if (spot.nodes[k]) return spot.nodes[k];
      let p = inflight.get(k);
      if (!p) {
        p = client.node(h);
        inflight.set(k, p);
      }
      const n = await p;
      inflight.delete(k);
      spot.nodes[k] = n;
      if (persist) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void putSolve(spot).catch(() => undefined), 1500);
      }
      return n;
    },
  };
}

/** 求解完成后收集起点所在街道的全部决策点（翻牌圈），保证缓存后可以离线浏览和练习 */
export async function collectStreet(client: SolverClient, spot: SolvedSpot, depth = 6): Promise<void> {
  const list = await client.streetNodes([], depth);
  const all = [[] as number[], ...list];
  const get = async (h: number[]) => {
    const k = historyKey(h);
    if (!spot.nodes[k]) spot.nodes[k] = await client.node(h);
    return spot.nodes[k];
  };
  for (const h of all) {
    const n = await get(h);
    // 也保存每个动作之后的节点（发牌、终局），这样缓存中的面包屑和"跟注后"的范围也能查看
    if (n.kind === 'player') for (let a = 0; a < n.actions.length; a++) await get([...h, a]);
  }
}
