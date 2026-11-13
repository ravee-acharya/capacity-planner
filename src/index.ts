import api, { privacy, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { randomUUID } from 'node:crypto';
import { forgeJiraClient } from './forge/jiraClient';
import { forgeStore } from './forge/store';
import { createApi, ForbiddenError, NotFoundError, type ApiName } from './services/api';
import { isLicenceBlocked, LICENCE_MESSAGE, type LicenceInfo } from './services/licence';
import { runPersonalDataReport } from './services/personalData';
import { ValidationError } from './shared/validation';

export type ResolverResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; kind: 'validation' | 'forbidden' | 'notfound' | 'unlicensed' | 'error'; error: string; problems?: string[] };

export function toFailure(e: unknown): ResolverResult<never> {
  if (e instanceof ValidationError) return { ok: false, kind: 'validation', error: e.message, problems: e.problems };
  if (e instanceof ForbiddenError) return { ok: false, kind: 'forbidden', error: e.message };
  if (e instanceof NotFoundError) return { ok: false, kind: 'notfound', error: e.message };
  console.error(e);
  return { ok: false, kind: 'error', error: e instanceof Error ? e.message : 'Unexpected error.' };
}

const resolver = new Resolver();
const names = Object.keys(createApi({} as never)) as ApiName[];

for (const name of names) {
  resolver.define(name, async ({ payload, context }) => {
    const accountId = context.accountId as string | undefined;
    if (!accountId) return { ok: false, kind: 'forbidden', error: 'Sign in to Jira to use Capacity Planner.' };
    if (isLicenceBlocked((context as { license?: LicenceInfo }).license)) return { ok: false, kind: 'unlicensed', error: LICENCE_MESSAGE };
    const api = createApi({ accountId, jira: forgeJiraClient, store: forgeStore, now: () => new Date(), newId: randomUUID });
    try {
      const fn = api[name] as (p: unknown) => Promise<unknown>;
      return { ok: true, data: await fn(payload ?? {}) };
    } catch (e) {
      return toFailure(e);
    }
  });
}

export const handler = resolver.getDefinitions();

/** Weekly scheduled trigger: Atlassian personal data reporting for every stored account. */
export async function privacyHandler() {
  const result = await runPersonalDataReport({
    store: forgeStore,
    report: (accounts) => privacy.reportPersonalData(accounts),
    lookupUser: async (accountId) => {
      const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return undefined;
      const u = (await res.json()) as { displayName?: string; avatarUrls?: Record<string, string> };
      return u.displayName ? { displayName: u.displayName, avatarUrl: u.avatarUrls?.['48x48'] } : undefined;
    },
    now: () => new Date(),
  });
  console.log(`Personal data report: ${result.reported} account(s) reported, ${result.closed} erased, ${result.updated} refreshed.`);
}
