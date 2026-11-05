import { describe, expect, it } from 'vitest';
import { otherCommitments, overCommitted } from '../src/shared/commitments';
import { calculateCapacity, DEFAULT_SETTINGS, holidayInputs } from '../src/shared/engine';
import { calibrateMember, quantile, velocityForecast, type HistorySprint } from '../src/shared/forecast';
import type { SprintPlan, TemplateConfig } from '../src/shared/types';
import { fixtureJira } from '../src/demo/fixtureJira';
import { memoryStore } from '../src/demo/memoryStore';
import { createApi } from '../src/services/api';

const hist = (rates: (number | null)[]): HistorySprint[] =>
  rates.map((r, i) => ({ id: i, name: `S${i}`, start: '2026-01-01', end: '2026-01-14', capacity: 100, completed: (r ?? 0) * 100, committed: 100, rate: r }));

describe('velocity forecast', () => {
  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.2)).toBeCloseTo(1.8);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('needs at least two usable sprints', () => {
    expect(velocityForecast(hist([0.5]), 100, 10)).toBeNull();
    expect(velocityForecast(hist([0.5, null]), 100, 10)).toBeNull();
  });

  it('uses min–max with few sprints and scales by this sprint’s capacity', () => {
    const f = velocityForecast(hist([0.4, 0.5, 0.6]), 80, 45)!;
    expect([f.low, f.median, f.high]).toEqual([32, 40, 48]);
    expect(f.verdict).toBe('stretch');
    expect(f.lowConfidence).toBe(false);
  });

  it('uses P20–P80 with five or more sprints', () => {
    const f = velocityForecast(hist([0.1, 0.4, 0.5, 0.6, 0.9]), 100, 30)!;
    expect(f.low).toBeCloseTo(34);
    expect(f.high).toBeCloseTo(66);
    expect(f.verdict).toBe('comfortable');
  });

  it('flags commitments beyond anything delivered before', () => {
    expect(velocityForecast(hist([0.4, 0.5]), 100, 51)!.verdict).toBe('unlikely');
    expect(velocityForecast(hist([0.4, 0.5]), 100, 45)!.verdict).toBe('likely');
    expect(velocityForecast(hist([0.4, 0.5]), 100, 45)!.lowConfidence).toBe(true);
  });
});

describe('member calibration', () => {
  const s = (raw: number, spent: number, est = 0, spentEst = 0, n = 0) => ({ rawCapacityHours: raw, spentHours: spent, estimatedSec: est, spentOnEstimatedSec: spentEst, estimatedIssues: n });

  it('measures focus as logged ÷ available hours across sprints', () => {
    expect(calibrateMember([s(80, 40), s(80, 56)]).measuredFocus).toBe(0.6);
  });

  it('ignores sprints where nothing was logged instead of suggesting near-zero focus', () => {
    expect(calibrateMember([s(80, 0), s(80, 0), s(80, 3)])).toMatchObject({ measuredFocus: null, focusSprints: 1 });
    expect(calibrateMember([s(80, 0), s(80, 40), s(80, 56)]).measuredFocus).toBe(0.6);
  });

  it('withholds suggestions without enough history', () => {
    const c = calibrateMember([s(80, 40, 3600, 7200, 4)]);
    expect(c.measuredFocus).toBeNull();
    expect(c.estimateBias).toBeNull();
    expect(c.biasIssues).toBe(4);
  });

  it('measures estimate bias on finished issues', () => {
    expect(calibrateMember([s(0, 0, 10 * 3600, 13 * 3600, 5)]).estimateBias).toBe(1.3);
  });
});

const base = (over: Partial<TemplateConfig> = {}): TemplateConfig => ({
  unit: 'hours',
  defaultCapacityPerDay: 8,
  defaultFocus: 1,
  workingDays: [1, 2, 3, 4, 5],
  members: [
    { accountId: 'in', displayName: 'Isha', capacityPerDay: null, focus: null, location: 'India' },
    { accountId: 'us', displayName: 'Sam', capacityPerDay: null, focus: null, location: 'USA', allocation: 50 },
  ],
  ...over,
});

describe('allocation and locations', () => {
  const run = (holidays: { date: string; location?: string }[]) =>
    calculateCapacity({ unit: 'hours', start: '2026-11-02', end: '2026-11-06', today: '2026-11-01', config: base(), ...holidayInputs(holidays), leaves: {}, items: [], settings: DEFAULT_SETTINGS });

  it('scales capacity by allocation %', () => {
    const r = run([]);
    expect(r.members.find((m) => m.accountId === 'us')).toMatchObject({ totalCapacity: 20, rawCapacity: 20, allocation: 50 });
  });

  it('applies location holidays only to that location (case-insensitive)', () => {
    const r = run([{ date: '2026-11-04', location: 'india ' }, { date: '2026-11-05' }]);
    expect(r.members.find((m) => m.accountId === 'in')?.totalCapacity).toBe(24);
    expect(r.members.find((m) => m.accountId === 'us')?.totalCapacity).toBe(16);
    expect(r.workingDays).toBe(4); // team-level count only removes company-wide holidays
  });
});

describe('over-commitment across teams', () => {
  const plan = (sprintId: number, start: string, end: string, allocation: number | null): SprintPlan => ({
    sprintId,
    boardId: 1,
    sprintName: `Sprint ${sprintId}`,
    templateId: 't',
    templateName: 'Other team',
    templateVersion: 1,
    config: base({ members: [{ accountId: 'us', displayName: 'Sam', capacityPerDay: null, focus: null, allocation }] }),
    teamHolidays: [],
    overrides: {},
    start,
    end,
    updatedAt: '',
    updatedBy: '',
  });

  it('sums allocations in overlapping plans and ignores the rest', () => {
    const others = otherCommitments([plan(1, '2026-11-02', '2026-11-13', 60), plan(2, '2026-12-01', '2026-12-12', 100), plan(9, '2026-11-02', '2026-11-13', 100)], {
      sprintId: 9,
      start: '2026-11-09',
      end: '2026-11-20',
    });
    expect(others.us.map((o) => o.sprintId)).toEqual([1]);
    const over = overCommitted(base(), others);
    expect(over).toEqual([expect.objectContaining({ accountId: 'us', here: 50, total: 110 })]);
  });

  it('treats a missing allocation as 100%', () => {
    const over = overCommitted(base(), otherCommitments([plan(1, '2026-11-02', '2026-11-13', null)], { sprintId: 9, start: '2026-11-02', end: '2026-11-13' }));
    expect(over[0].total).toBe(150);
  });
});

describe('forecast service (fixture history)', () => {
  const TODAY = '2026-11-04';
  const setup = () => {
    let n = 0;
    return createApi({ accountId: 'u-asha', jira: fixtureJira(TODAY), store: memoryStore(), now: () => new Date(`${TODAY}T10:00:00Z`), newId: () => `id${++n}` });
  };
  const template = {
    name: 'Core',
    config: {
      unit: 'hours' as const,
      defaultCapacityPerDay: 8,
      defaultFocus: 1,
      workingDays: [1, 2, 3, 4, 5] as TemplateConfig['workingDays'],
      members: [
        { accountId: 'u-asha', displayName: 'Asha Rao', capacityPerDay: null, focus: null },
        { accountId: 'u-ben', displayName: 'Ben Carter', capacityPerDay: 8, focus: 0.5 },
        { accountId: 'u-chen', displayName: 'Chen Wei', capacityPerDay: 6, focus: null },
      ],
    },
  };

  it('learns velocity, focus and estimate bias from closed sprints', async () => {
    const api = setup();
    const t = await api.createTemplate(template);
    const f = await api.getForecast({ boardId: 1, sprintId: 102, templateId: t.id });

    // Each past sprint: 180h capacity; completed 78h, 72h, 90h of estimates.
    expect(f.history.map((h) => h.completed)).toEqual([78, 72, 90]);
    expect(f.capacity).toBe(180);
    expect(f.velocity).toMatchObject({ sprints: 3, low: 72, high: 90, verdict: 'unlikely' });
    expect(f.velocity!.median).toBeCloseTo(78);
    expect(f.committed).toBe(206);

    const asha = f.members.find((m) => m.accountId === 'u-asha')!;
    expect(asha.measuredFocus).toBe(0.45); // 107h logged of 240h available
    expect(asha.estimateBias).toBe(1.22); // 107h spent on 88h of estimates
    expect(asha.riskAdjusted).toBeCloseTo(78.08);
    const chen = f.members.find((m) => m.accountId === 'u-chen')!;
    expect(chen.estimateBias).toBeNull(); // only 3 finished issues
    expect(chen.biasIssues).toBe(3);
    expect(f.warnings.join(' ')).toMatch(/3 of 3 past sprints had no saved plan/);
  });

  it('measures focus from worklogs inside the sprint, not lifetime issue time spent', async () => {
    // Jira only returns worklogs started within the requested dates; simulate half the time
    // having been logged before the sprint started.
    const jira = fixtureJira(TODAY);
    const inSprint: typeof jira.worklogs = async (keys, from, to) => {
      const all = await fixtureJira(TODAY).worklogs(keys, from, to);
      return { ...all, entries: all.entries.filter((e) => e.started !== from) };
    };
    let n = 0;
    const api = createApi({ accountId: 'u-asha', jira: { ...jira, worklogs: inSprint }, store: memoryStore(), now: () => new Date(`${TODAY}T10:00:00Z`), newId: () => `id${++n}` });
    const t = await api.createTemplate(template);
    const f = await api.getForecast({ boardId: 1, sprintId: 102, templateId: t.id });
    const asha = f.members.find((m) => m.accountId === 'u-asha')!;
    expect(asha.measuredFocus).toBeCloseTo(0.22, 2); // ~53.5h of 240h, not 107h
    expect(asha.estimateBias).toBe(1.22); // bias still uses each finished issue's total time
  });

  it('records plan dates and reports overlapping commitments in the workspace', async () => {
    const api = setup();
    const t = await api.createTemplate(template);
    const p = await api.applyTemplate({ boardId: 1, sprintId: 102, templateId: t.id });
    expect([p.start, p.end]).toEqual(['2026-11-02', '2026-11-13']);
    const ws = await api.getWorkspace({ boardId: 1, sprintId: 102 });
    expect(ws.commitments).toEqual({});
  });

  it('requires a plan or template', async () => {
    await expect(setup().getForecast({ boardId: 1, sprintId: 102 })).rejects.toThrow(/Apply a template/);
  });
});
