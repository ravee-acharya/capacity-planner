import Resolver from '@forge/resolver';
import { randomUUID } from 'node:crypto';
import { forgeJiraClient } from './forge/jiraClient';
import { forgeStore } from './forge/store';
import { createApi, ForbiddenError, NotFoundError, type ApiName } from './services/api';
import { ValidationError } from './shared/validation';

export type ResolverResult<T = unknown> = { ok: true; data: T } | { ok: false; kind: 'validation' | 'forbidden' | 'notfound' | 'error'; error: string; problems?: string[] };

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
