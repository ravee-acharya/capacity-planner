import { describe, expect, it } from 'vitest';
import { fixtureJira } from '../src/demo/fixtureJira';
import { memoryStore } from '../src/demo/memoryStore';
import { createApi, type TemplateInput } from '../src/services/api';
import { toCsv } from '../src/shared/csv';
import { reportToCsv } from '../src/shared/report';

const TODAY = '2026-11-04'; // Wednesday; fixture active sprint starts Monday 2026-11-02

function setup(opts: { accountId?: string; admin?: boolean; store?: ReturnType<typeof memoryStore> } = {}) {
  const store = opts.store ?? memoryStore();
  let n = 0;
  const api = createApi({
    accountId: opts.accountId ?? 'u-asha',
    jira: fixtureJira(TODAY, undefined, opts.admin ?? true),
    store,
    now: () => new Date(`${TODAY}T10:00:00Z`),
    newId: () => `id${++n}`,
  });
  return { api, store };
}

const template = (over: Partial<TemplateInput['config']> = {}): TemplateInput => ({
  name: 'Core team',
  config: {
    unit: 'hours',
    defaultCapacityPerDay: 8,
    defaultFocus: 1,
    workingDays: [1, 2, 3, 4, 5],
    members: [
      { accountId: 'u-asha', displayName: 'Asha Rao', role: 'Developer', capacityPerDay: null, focus: null },
      { accountId: 'u-ben', displayName: 'Ben Carter', role: 'Developer', capacityPerDay: 8, focus: 0.5 },
      { accountId: 'u-chen', displayName: 'Chen Wei', role: 'QA', capacityPerDay: 6, focus: null },
    ],
    ...over,
  },
});

describe('templates', () => {
  it('creates, edits (versioned), duplicates and deletes', async () => {
    const { api } = setup();
    const t = await api.createTemplate(template());
    expect(t.version).toBe(1);
    const u = await api.updateTemplate({ id: t.id, ...template({ defaultCapacityPerDay: 7 }) });
    expect(u.version).toBe(2);
    expect(u.defaultCapacityPerDay).toBe(7);
    const copy = await api.duplicateTemplate({ id: t.id, name: 'Core team (copy)' });
    expect(copy.members).toHaveLength(3);
    expect((await api.listTemplates()).map((x) => x.name)).toEqual(['Core team', 'Core team (copy)']);
    await api.deleteTemplate({ id: copy.id });
    expect(await api.listTemplates()).toHaveLength(1);
  });

  it('rejects invalid configuration', async () => {
    const { api } = setup();
    await expect(api.createTemplate({ ...template({ defaultCapacityPerDay: 30, workingDays: [] }), name: ' ' })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    const dup = template();
    dup.config.members.push({ ...dup.config.members[0] });
    await expect(api.createTemplate(dup)).rejects.toThrow(/more than once/);
  });

  it('enforces the admin-only restriction', async () => {
    const store = memoryStore({ settings: { restrictTemplatesToAdmins: true } });
    const { api } = setup({ admin: false, store });
    await expect(api.createTemplate(template())).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect((await api.getContext()).canEditTemplates).toBe(false);
  });
});

describe('sprint plans', () => {
  it('snapshots the template so later edits do not rewrite the plan', async () => {
    const { api } = setup();
    const t = await api.createTemplate(template());
    const plan = await api.applyTemplate({ boardId: 1, sprintId: 102, templateId: t.id });
    await api.updateTemplate({ id: t.id, ...template({ defaultCapacityPerDay: 4 }) });
    const ws = await api.getWorkspace({ boardId: 1, sprintId: 102 });
    expect(ws.plan?.config.defaultCapacityPerDay).toBe(8);
    expect(ws.plan?.templateVersion).toBe(plan.templateVersion);
    expect(ws.templateVersion).toBe(2);
  });

  it('saves holidays and daily overrides and validates them', async () => {
    const { api } = setup();
    const t = await api.createTemplate(template());
    const plan = await api.applyTemplate({ boardId: 1, sprintId: 102, templateId: t.id });
    const saved = await api.savePlan({ plan: { ...plan, teamHolidays: ['2026-11-05'], overrides: { 'u-asha': { '2026-11-03': 4 } } } });
    expect(saved.teamHolidays).toEqual(['2026-11-05']);
    await expect(api.savePlan({ plan: { ...plan, overrides: { 'u-asha': { '2026-11-03': 99 } } } })).rejects.toThrow(/between 0 and 24/);
    await expect(api.savePlan({ plan: { ...plan, config: { ...plan.config, unit: 'points' } } })).resolves.toMatchObject({ config: { unit: 'hours' } });
  });
});

describe('reports', () => {
  it('computes a report from the sprint plan with holidays and leave', async () => {
    const { api } = setup();
    const t = await api.createTemplate(template());
    const plan = await api.applyTemplate({ boardId: 1, sprintId: 102, templateId: t.id });
    await api.savePlan({ plan: { ...plan, teamHolidays: ['2026-11-05'] } });
    await api.saveHoliday({ date: '2026-11-06', name: 'Company day' });
    await api.saveLeave({ accountId: 'u-asha', displayName: 'Asha Rao', from: '2026-11-09', to: '2026-11-10' });

    const report = await api.computeReport({ unit: 'hours', rows: [{ boardId: 1, sprintId: 102 }] });
    expect(report.errors).toEqual([]);
    const s = report.sprints[0];
    expect(s.source).toBe('plan');
    expect(s.result.workingDays).toBe(8); // 10 weekdays - 2 holidays
    const asha = s.result.members.find((m) => m.accountId === 'u-asha')!;
    expect(asha.totalCapacity).toBe(48); // 8 days - 2 leave = 6 * 8h
    expect(asha.allocated).toBe(64);
    expect(asha.status).toBe('over');
    const ben = s.result.members.find((m) => m.accountId === 'u-ben')!;
    expect(ben.totalCapacity).toBe(32);
    // Outside-template assignee and unassigned work are surfaced.
    expect(s.result.members.some((m) => m.accountId === 'u-guest' && !m.inTemplate)).toBe(true);
    expect(s.result.totals.unassignedAllocated).toBe(10);
    expect(s.weekly?.weeks).toEqual(['2026-11-02', '2026-11-09']);
    expect(s.weekly?.byMember['u-asha']['2026-11-02'].spent).toBe(8);
  });

  it('reports per-row errors without failing the whole report', async () => {
    const { api } = setup();
    const t = await api.createTemplate(template());
    const report = await api.computeReport({ unit: 'hours', rows: [{ boardId: 1, sprintId: 101, templateId: t.id }, { boardId: 1, sprintId: 103 }] });
    expect(report.sprints).toHaveLength(1);
    expect(report.errors[0]).toMatch(/choose a template/);
  });

  it('saves private and public reports with correct visibility', async () => {
    const store = memoryStore();
    const { api } = setup({ store });
    const t = await api.createTemplate(template());
    const report = await api.computeReport({ unit: 'hours', rows: [{ boardId: 1, sprintId: 102, templateId: t.id }] });
    const priv = await api.saveReport({ name: 'Mine', visibility: 'private', report });
    await api.saveReport({ name: 'Shared', visibility: 'public', report });

    const other = setup({ accountId: 'u-ben', admin: false, store }).api;
    expect((await other.listSavedReports()).map((r) => r.name)).toEqual(['Shared']);
    await expect(other.getSavedReport({ id: priv.id })).rejects.toMatchObject({ name: 'NotFoundError' });
    const shared = (await other.listSavedReports())[0];
    await expect(other.deleteSavedReport({ id: shared.id })).rejects.toMatchObject({ name: 'ForbiddenError' });

    const full = await api.getSavedReport({ id: priv.id });
    expect(full.snapshot.sprints[0].result.members[0].days).toEqual([]);
    expect(reportToCsv(full.snapshot).split('\r\n')[0]).toMatch(/^Sprint,Sprint start/);
  });

  it('only admins change settings', async () => {
    await expect(setup({ admin: false }).api.saveSettings({ overloadThreshold: 90 })).rejects.toMatchObject({ name: 'ForbiddenError' });
    const { api } = setup();
    const s = await api.saveSettings({ overloadThreshold: 90, underThreshold: 50 });
    expect(s.overloadThreshold).toBe(90);
    await expect(api.saveSettings({ underThreshold: 95 })).rejects.toThrow(/below the overload/);
  });
});

describe('csv', () => {
  it('escapes quotes, commas, newlines and formula prefixes', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['=SUM(A1)', 5], [null, -2]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),5\r\n,-2');
  });
});
