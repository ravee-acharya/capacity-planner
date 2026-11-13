// Atlassian personal data reporting (GDPR) for the account IDs this app stores.
//
// Weekly, every stored Atlassian account is reported with the time its data was last updated.
// Atlassian answers per account:
//   closed  -> the account was deleted: erase it everywhere the app stored it;
//   updated -> the profile changed since then: refresh the display names the app keeps a copy of.
import type { SavedReport } from '../shared/report';
import type { Leave, SprintPlan, Template } from '../shared/types';
import type { Store } from './ports';

export interface AccountReport {
  accountId: string;
  updatedAt: string;
}

export interface AccountUpdate {
  accountId: string;
  status: 'updated' | 'closed';
}

export interface PersonalDataDeps {
  store: Store;
  report: (accounts: AccountReport[]) => Promise<AccountUpdate[]>;
  /** Current display name (and avatar) of an account, or undefined if it can't be read. */
  lookupUser: (accountId: string) => Promise<{ displayName: string; avatarUrl?: string } | undefined>;
  now: () => Date;
}

const ERASED_ID = 'erased';
const ERASED_NAME = 'Former user';
const LAST_RUN_KEY = 'privacy:lastRun';

/** Every account ID the app stores, with the latest time its data was written. */
export async function collectAccounts(store: Store, fallback: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const add = (id: string | undefined, at?: string) => {
    if (!id || id === ERASED_ID) return;
    const t = at || fallback;
    const prev = seen.get(id);
    if (!prev || t > prev) seen.set(id, t);
  };
  for (const t of await store.list<Template>('tpl:')) {
    t.members.forEach((m) => add(m.accountId, t.updatedAt));
    add(t.createdBy, t.createdAt);
    add(t.updatedBy, t.updatedAt);
  }
  for (const p of await store.list<SprintPlan>('plan:')) {
    p.config.members.forEach((m) => add(m.accountId, p.updatedAt));
    Object.keys(p.overrides ?? {}).forEach((id) => add(id, p.updatedAt));
    add(p.updatedBy, p.updatedAt);
  }
  for (const l of await store.list<Leave>('leave:')) add(l.accountId);
  for (const r of await store.list<SavedReport>('report:')) {
    add(r.ownerId, r.updatedAt);
    r.snapshot.sprints.forEach((s) => s.result.members.forEach((m) => add(m.accountId, r.updatedAt)));
  }
  for (const [key] of await store.entries('pref:')) add(key.slice('pref:'.length));
  return seen;
}

/** Remove closed accounts' personal data, and refresh names for updated ones. */
export async function applyUpdates(store: Store, closed: Set<string>, renamed: Map<string, { displayName: string; avatarUrl?: string }>, nowIso: string) {
  const touches = (id: string | undefined) => !!id && (closed.has(id) || renamed.has(id));
  const fix = <T extends { accountId: string; displayName: string; avatarUrl?: string }>(m: T): T => {
    const r = renamed.get(m.accountId);
    return r ? { ...m, displayName: r.displayName, avatarUrl: r.avatarUrl ?? m.avatarUrl } : m;
  };

  for (const [key, t] of await store.entries<Template>('tpl:')) {
    if (!t.members.some((m) => touches(m.accountId)) && !closed.has(t.createdBy) && !closed.has(t.updatedBy)) continue;
    await store.set(key, {
      ...t,
      members: t.members.filter((m) => !closed.has(m.accountId)).map(fix),
      createdBy: closed.has(t.createdBy) ? ERASED_ID : t.createdBy,
      updatedBy: closed.has(t.updatedBy) ? ERASED_ID : t.updatedBy,
    });
  }

  for (const [key, p] of await store.entries<SprintPlan>('plan:')) {
    const overrideIds = Object.keys(p.overrides ?? {});
    if (!p.config.members.some((m) => touches(m.accountId)) && !overrideIds.some((id) => closed.has(id)) && !closed.has(p.updatedBy)) continue;
    const overrides = Object.fromEntries(Object.entries(p.overrides ?? {}).filter(([id]) => !closed.has(id)));
    await store.set(key, {
      ...p,
      config: { ...p.config, members: p.config.members.filter((m) => !closed.has(m.accountId)).map(fix) },
      overrides,
      updatedBy: closed.has(p.updatedBy) ? ERASED_ID : p.updatedBy,
    });
  }

  for (const [key, l] of await store.entries<Leave>('leave:')) {
    if (closed.has(l.accountId)) await store.delete(key);
    else if (renamed.has(l.accountId)) await store.set(key, { ...l, displayName: renamed.get(l.accountId)!.displayName });
  }

  for (const [key, r] of await store.entries<SavedReport>('report:')) {
    const members = r.snapshot.sprints.flatMap((s) => s.result.members);
    if (!touches(r.ownerId) && !members.some((m) => touches(m.accountId))) continue;
    if (closed.has(r.ownerId) && r.visibility === 'private') {
      // Nobody else can see or manage a private report, so it goes with its owner.
      await store.delete(key);
      continue;
    }
    let n = 0;
    const scrub = new Map<string, string>(); // closed accountId -> placeholder unique within the report
    const sprints = r.snapshot.sprints.map((s) => ({
      ...s,
      result: {
        ...s.result,
        members: s.result.members.map((m) => {
          if (closed.has(m.accountId)) {
            if (!scrub.has(m.accountId)) scrub.set(m.accountId, `${ERASED_ID}-${++n}`);
            return { ...m, accountId: scrub.get(m.accountId)!, displayName: ERASED_NAME, avatarUrl: undefined };
          }
          return fix(m);
        }),
      },
      weekly: s.weekly && {
        ...s.weekly,
        byMember: Object.fromEntries(Object.entries(s.weekly.byMember).map(([id, v]) => [scrub.get(id) ?? (closed.has(id) ? ERASED_ID : id), v])),
      },
    }));
    const ownerClosed = closed.has(r.ownerId);
    await store.set(key, {
      ...r,
      ownerId: ownerClosed ? ERASED_ID : r.ownerId,
      ownerName: ownerClosed ? ERASED_NAME : renamed.get(r.ownerId)?.displayName ?? r.ownerName,
      snapshot: { ...r.snapshot, sprints },
      updatedAt: nowIso,
    });
  }

  for (const id of closed) await store.delete(`pref:${id}`);
}

/** One reporting cycle. Returns counts for logging. */
export async function runPersonalDataReport(deps: PersonalDataDeps) {
  const nowIso = deps.now().toISOString();
  const lastRun = (await deps.store.get<string>(LAST_RUN_KEY)) ?? nowIso;
  const accounts = await collectAccounts(deps.store, lastRun);
  const updates = accounts.size ? await deps.report([...accounts].map(([accountId, updatedAt]) => ({ accountId, updatedAt }))) : [];

  const closed = new Set(updates.filter((u) => u.status === 'closed').map((u) => u.accountId));
  const renamed = new Map<string, { displayName: string; avatarUrl?: string }>();
  for (const u of updates.filter((x) => x.status === 'updated')) {
    const user = await deps.lookupUser(u.accountId).catch(() => undefined);
    if (user) renamed.set(u.accountId, user);
  }
  if (closed.size || renamed.size) await applyUpdates(deps.store, closed, renamed, nowIso);
  await deps.store.set(LAST_RUN_KEY, nowIso);
  return { reported: accounts.size, closed: closed.size, updated: renamed.size };
}
