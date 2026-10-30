// Typed access to the backend resolvers. Inside Jira this calls Forge `invoke`. When the dev
// server is opened with ?demo, it runs the real service code against fixture data instead,
// so screens can be checked locally. Demo code is excluded from production builds.
import type { Api, ApiName } from '../../../src/services/api';

// Imported lazily: @forge/bridge throws at import time when not running inside Jira.
const forgeBridge = () => import('@forge/bridge');

type Result<T> = { ok: true; data: T } | { ok: false; kind: string; error: string; problems?: string[] };
type Payload<N extends ApiName> = Parameters<Api[N]>[0];
type Data<N extends ApiName> = Awaited<ReturnType<Api[N]>>;

export class ApiError extends Error {
  constructor(public kind: string, message: string, public problems: string[] = []) {
    super(message);
  }
}

export const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');

let demoApi: Promise<Api> | undefined;

async function callDemo<N extends ApiName>(name: N, payload: unknown): Promise<Result<Data<N>>> {
  demoApi ??= import('./demoBackend').then((m) => m.createDemoApi());
  const api = await demoApi;
  try {
    const fn = api[name] as (p: unknown) => Promise<Data<N>>;
    return { ok: true, data: structuredClone(await fn(payload ?? {})) };
  } catch (e) {
    const err = e as Error & { problems?: string[] };
    const kind = err.name === 'ValidationError' ? 'validation' : err.name === 'ForbiddenError' ? 'forbidden' : err.name === 'NotFoundError' ? 'notfound' : 'error';
    return { ok: false, kind, error: err.message, problems: err.problems };
  }
}

export async function call<N extends ApiName>(name: N, ...args: Payload<N> extends undefined ? [] : [Payload<N>]): Promise<Data<N>> {
  const payload = args[0] as unknown;
  const res = DEMO ? await callDemo(name, payload) : ((await (await forgeBridge()).invoke(name, (payload ?? {}) as Record<string, unknown>)) as Result<Data<N>>);
  if (!res || typeof res !== 'object') throw new ApiError('error', 'No response from Capacity Planner.');
  if (!res.ok) throw new ApiError(res.kind, res.error, res.problems);
  return res.data;
}
