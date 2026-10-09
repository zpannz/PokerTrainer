// 求解结果缓存：保存在浏览器 IndexedDB 中（只在本机）
import type { SolveConfig, SolvedSpot } from './types.ts';

const DB_NAME = 'pgto-postflop';
const STORE = 'solves';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('浏览器不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('无法打开 IndexedDB'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** 同一局面（范围、公共牌、底池、筹码、尺寸都相同）得到同一个键 */
export function configKey(cfg: SolveConfig): string {
  const norm = {
    r: cfg.ranges.map((r) => r.replace(/\s+/g, '')),
    b: cfg.board,
    p: cfg.pot,
    s: cfg.stack,
    z: cfg.sizes,
    c: cfg.raiseCap ?? null,
    d: [cfg.donkTurn ?? '', cfg.donkRiver ?? ''],
  };
  const text = JSON.stringify(norm);
  // FNV-1a 64 位（两个 32 位）哈希
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${cfg.board}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function getSolve(key: string): Promise<SolvedSpot | undefined> {
  try {
    return (await tx<SolvedSpot | undefined>('readonly', (s) => s.get(key) as IDBRequest<SolvedSpot | undefined>)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function putSolve(spot: SolvedSpot): Promise<void> {
  await tx('readwrite', (s) => s.put(spot));
}

export async function deleteSolve(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key));
}

export interface SolveSummary {
  key: string;
  title: string;
  board: string;
  created: number;
  nodes: number;
  exploitability: number;
  pot: number;
}

export async function listSolves(): Promise<SolveSummary[]> {
  try {
    const all = await tx<SolvedSpot[]>('readonly', (s) => s.getAll() as IDBRequest<SolvedSpot[]>);
    return all
      .map((x) => ({ key: x.key, title: x.title, board: x.config.board, created: x.created, nodes: Object.keys(x.nodes).length, exploitability: x.exploitability, pot: x.config.pot }))
      .sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}
