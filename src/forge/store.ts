import { kvs, WhereConditions } from '@forge/kvs';
import type { Store } from '../services/ports';

async function query<T>(prefix: string): Promise<[string, T][]> {
  const out: [string, T][] = [];
  let cursor: string | undefined;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany<T>();
    out.push(...page.results.map((r): [string, T] => [r.key, r.value]));
    cursor = page.nextCursor;
  } while (cursor && out.length < 5000);
  return out;
}

export const forgeStore: Store = {
  async get<T>(key: string) {
    return (await kvs.get<T>(key)) ?? undefined;
  },
  async set<T>(key: string, value: T) {
    await kvs.set(key, value);
  },
  async delete(key: string) {
    await kvs.delete(key);
  },
  async list<T>(prefix: string) {
    return (await query<T>(prefix)).map(([, value]) => value);
  },
  entries: query,
};
