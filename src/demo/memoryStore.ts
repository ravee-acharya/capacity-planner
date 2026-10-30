import type { Store } from '../services/ports';

/** In-memory Store. Values are deep-copied so callers can't mutate stored state by reference. */
export function memoryStore(seed: Record<string, unknown> = {}): Store & { dump(): Record<string, unknown> } {
  const data = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get<T>(key: string) {
      const v = data.get(key);
      return v === undefined ? undefined : (JSON.parse(v) as T);
    },
    async set(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async delete(key) {
      data.delete(key);
    },
    async list<T>(prefix: string) {
      return [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as T);
    },
    dump() {
      return Object.fromEntries([...data.entries()].map(([k, v]) => [k, JSON.parse(v)]));
    },
  };
}
