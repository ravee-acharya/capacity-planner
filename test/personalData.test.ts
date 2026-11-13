import { describe, expect, it } from 'vitest';
import { fixtureJira } from '../src/demo/fixtureJira';
import { memoryStore } from '../src/demo/memoryStore';
import { createApi } from '../src/services/api';
import { collectAccounts, runPersonalDataReport, type AccountReport } from '../src/services/personalData';
import type { SavedReport } from '../src/shared/report';
import type { Leave, SprintPlan, Template } from '../src/shared/types';

const TODAY = '2026-11-04';

async function seeded() {
  const store = memoryStore();
  let n = 0;
  const mk = (accountId: string) => createApi({ accountId, jira: fixtureJira(TODAY), store, now: () => new Date(`${TODAY}T10:00:00Z`), newId: () => `id${++n}` });
  const asha = mk('u-asha');
  const t = await asha.createTemplate({
    name: 'Core',
    config: {
      unit: 'hours',
      defaultCapacityPerDay: 8,
      defaultFocus: 1,
      workingDays: [1, 2, 3, 4, 5],
      members: [
        { accountId: 'u-asha', displayName: 'Asha Rao', capacityPerDay: null, focus: null },
        { accountId: 'u-ben', displayName: 'Ben Carter', capacityPerDay: null, focus: null },
      ],
    },
  });
  const plan = await asha.applyTemplate({ boardId: 1, sprintId: 102, templateId: t.id });
  await asha.savePlan({ plan: { ...plan, overrides: { 'u-ben': { '2026-11-03': 4 } } } });
  await asha.saveLeave({ accountId: 'u-ben', displayName: 'Ben Carter', from: '2026-11-05', to: '2026-11-06' });
  await asha.savePreferences({ projectKey: 'APP' });
  const report = await asha.computeReport({ unit: 'hours', rows: [{ boardId: 1, sprintId: 102 }] });
  await asha.saveReport({ name: 'Shared', visibility: 'public', report });
  const ben = mk('u-ben');
  await ben.saveReport({ name: 'Ben private', visibility: 'private', report });
  await ben.savePreferences({ projectKey: 'APP' });
  return store;
}

describe('personal data reporting', () => {
  it('finds every stored account id', async () => {
    const store = await seeded();
    const ids = [...(await collectAccounts(store, '2026-01-01T00:00:00Z')).keys()];
    // Template/plan members, leave, report owners and snapshot members (incl. people outside the template), preferences.
    expect(ids).toEqual(expect.arrayContaining(['u-asha', 'u-ben', 'u-chen', 'u-guest']));
  });

  it('erases closed accounts everywhere and refreshes renamed ones', async () => {
    const store = await seeded();
    let reported: AccountReport[] = [];
    const result = await runPersonalDataReport({
      store,
      report: async (accounts) => {
        reported = accounts;
        return [
          { accountId: 'u-ben', status: 'closed' },
          { accountId: 'u-asha', status: 'updated' },
        ];
      },
      lookupUser: async (id) => (id === 'u-asha' ? { displayName: 'Asha Rao-Mehta' } : undefined),
      now: () => new Date(`${TODAY}T12:00:00Z`),
    });
    expect(reported.length).toBeGreaterThanOrEqual(4);
    expect(result).toMatchObject({ closed: 1, updated: 1 });

    const dump = JSON.stringify((store as ReturnType<typeof memoryStore>).dump());
    expect(dump).not.toContain('u-ben');
    expect(dump).not.toContain('Ben Carter');

    const [tpl] = await store.list<Template>('tpl:');
    expect(tpl.members.map((m) => m.displayName)).toEqual(['Asha Rao-Mehta']);
    const [plan] = await store.list<SprintPlan>('plan:');
    expect(Object.keys(plan.overrides)).toEqual([]);
    expect(await store.list<Leave>('leave:')).toEqual([]);

    const reports = await store.list<SavedReport>('report:');
    expect(reports.map((r) => r.name)).toEqual(['Shared']); // Ben's private report is gone
    const names = reports[0].snapshot.sprints[0].result.members.map((m) => m.displayName);
    expect(names).toContain('Former user');
    expect(names).toContain('Asha Rao-Mehta');
    expect(await store.get('pref:u-ben')).toBeUndefined();
    expect(await store.get('pref:u-asha')).toBeDefined();
  });

  it('does nothing harmful when Atlassian reports no changes', async () => {
    const store = await seeded();
    const before = JSON.stringify((store as ReturnType<typeof memoryStore>).dump());
    await runPersonalDataReport({ store, report: async () => [], lookupUser: async () => undefined, now: () => new Date() });
    const after = (store as ReturnType<typeof memoryStore>).dump();
    delete (after as Record<string, unknown>)['privacy:lastRun'];
    expect(JSON.stringify(after)).toBe(before);
  });
});
