// 浏览器本地存储（localStorage）封装：所有读写都容错，存储不可用时退回内存
const PREFIX = 'pgto.';
const memory = new Map<string, string>();

export function load<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFIX + key);
  } catch {
    raw = memory.get(key) ?? null;
  }
  if (raw === null) raw = memory.get(key) ?? null;
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    localStorage.setItem(PREFIX + key, raw);
  } catch {
    /* 存储不可用（隐私模式等），只保留在内存中 */
  }
}

export function remove(key: string): void {
  memory.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** 导出全部本地数据（备份用） */
export function exportAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k) ?? 'null');
    }
  } catch {
    for (const [k, v] of memory) out[k] = JSON.parse(v);
  }
  return out;
}

export function importAll(data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) save(k, v);
}
