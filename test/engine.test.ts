import { describe, expect, it } from 'vitest';
import { calculateCapacity, DEFAULT_SETTINGS, formatPercent, formatValue, percent, type CapacityInput } from '../src/shared/engine';
import { eachDate, expandRanges, weekStart } from '../src/shared/dates';
import type { TemplateConfig, WorkItem } from '../src/shared/types';

// Mon 2026-11-02 .. Fri 2026-11-13: 12 calendar days, 10 weekdays.
const START = '2026-11-02';
const END = '2026-11-13';

const config = (over: Partial<TemplateConfig> = {}): TemplateConfig => ({
  unit: 'hours',
  defaultCapacityPerDay: 8,
  defaultFocus: 1,
  workingDays: [1, 2, 3, 4, 5],
  members: [
    { accountId: 'a', displayName: 'Ann', role: 'Dev', capacityPerDay: null, focus: null },
    { accountId: 'b', displayName: 'Bo', role: 'QA', capacityPerDay: 6, focus: 0.5 },
  ],
  ...over,
});

const issue = (key: string, assigneeId: string | null, estH: number | null, extra: Partial<WorkItem> = {}): WorkItem => ({
  key,
  summary: key,
  assigneeId,
  assigneeName: assigneeId,
  issueType: 'Story',
  isSubtask: false,
  status: 'In Progress',
  statusCategory: 'indeterminate',
  originalEstimateSec: estH === null ? null : estH * 3600,
  remainingEstimateSec: estH === null ? null : estH * 3600,
  timeSpentSec: 0,
  storyPoints: null,
  ...extra,
});

const run = (over: Partial<CapacityInput> = {}) =>
  calculateCapacity({
    unit: 'hours',
    start: START,
    end: END,
    today: '2026-11-01',
    config: config(),
    holidays: [],
    leaves: {},
    items: [],
    settings: DEFAULT_SETTINGS,
    ...over,
  });

const member = (r: ReturnType<typeof run>, id: string) => r.members.find((m) => m.accountId === id)!;

describe('available capacity', () => {
  it('sums capacity per day * focus over working days', () => {
    const r = run();
    expect(r.workingDays).toBe(10);
    expect(member(r, 'a').totalCapacity).toBe(80);
    expect(member(r, 'b').totalCapacity).toBe(30); // part-time: 6h * 0.5 focus * 10 days
    expect(r.totals.totalCapacity).toBe(110);
  });

  it('removes sprint holidays for everyone', () => {
    const r = run({ holidays: ['2026-11-04'] });
    expect(r.workingDays).toBe(9);
    expect(member(r, 'a').totalCapacity).toBe(72);
    expect(member(r, 'a').days.find((d) => d.date === '2026-11-04')?.kind).toBe('holiday');
  });

  it('removes leave for one member only', () => {
    const r = run({ leaves: { a: expandRanges([{ from: '2026-11-05', to: '2026-11-06' }]) } });
    expect(member(r, 'a').totalCapacity).toBe(64);
    expect(member(r, 'a').availableDays).toBe(8);
    expect(member(r, 'b').totalCapacity).toBe(30);
  });

  it('does not double count a holiday that is also leave or a weekend', () => {
    const r = run({
      holidays: ['2026-11-04', '2026-11-07', '2026-11-04'],
      leaves: { a: ['2026-11-04', '2026-11-07', '2026-11-08'] },
    });
    expect(member(r, 'a').totalCapacity).toBe(72);
    expect(member(r, 'a').days.find((d) => d.date === '2026-11-07')?.kind).toBe('nonworking');
  });

  it('applies reduced-hours overrides on working days only', () => {
    const r = run({ overrides: { a: { '2026-11-03': 4, '2026-11-07': 8 } } });
    expect(member(r, 'a').totalCapacity).toBe(76);
    expect(member(r, 'a').days.find((d) => d.date === '2026-11-03')).toMatchObject({ capacity: 4, overridden: true });
  });

  it('ignores overrides on holidays', () => {
    const r = run({ holidays: ['2026-11-03'], overrides: { a: { '2026-11-03': 4 } } });
    expect(member(r, 'a').totalCapacity).toBe(72);
  });

  it('handles a member with no assigned capacity', () => {
    const r = run({ config: config({ members: [{ accountId: 'z', displayName: 'Zed', capacityPerDay: 0, focus: null }] }) });
    expect(member(r, 'z').totalCapacity).toBe(0);
    expect(member(r, 'z').utilization).toBeNull();
    expect(member(r, 'z').status).toBe('nocapacity');
  });

  it('handles a period with zero working days', () => {
    const r = run({ start: '2026-11-07', end: '2026-11-08' });
    expect(r.workingDays).toBe(0);
    expect(r.totals.totalCapacity).toBe(0);
    expect(r.totals.utilization).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/no working days/);
  });

  it('handles a sprint without dates', () => {
    const r = run({ start: undefined, end: undefined, items: [issue('X-1', 'a', 5)] });
    expect(r.dates).toEqual([]);
    expect(member(r, 'a').status).toBe('over');
    expect(r.warnings.join(' ')).toMatch(/no start\/end dates/);
  });

  it('clamps invalid template numbers instead of producing NaN', () => {
    const r = run({ config: config({ defaultCapacityPerDay: Number.NaN, members: [{ accountId: 'a', displayName: 'Ann', capacityPerDay: -5, focus: 3 }] }) });
    expect(member(r, 'a').totalCapacity).toBe(0);
    expect(Number.isNaN(r.totals.totalCapacity)).toBe(false);
  });
});

describe('allocation and utilisation', () => {
  it('uses original estimate as allocated work', () => {
    const r = run({ items: [issue('X-1', 'a', 40), issue('X-2', 'a', 20)] });
    expect(member(r, 'a').allocated).toBe(60);
    expect(member(r, 'a').balance).toBe(20);
    expect(member(r, 'a').utilization).toBe(75);
    expect(member(r, 'a').status).toBe('ok');
  });

  it('treats exactly-full capacity as balanced despite float drift (8h x 0.8 focus)', () => {
    const r = run({
      config: config({ members: [{ accountId: 'a', displayName: 'Ann', capacityPerDay: 8, focus: 0.8 }] }),
      items: [issue('X-1', 'a', 64)],
    });
    expect(member(r, 'a').totalCapacity).toBe(64);
    expect(member(r, 'a').balance).toBe(0);
    expect(member(r, 'a').status).toBe('ok');
  });

  it('flags over-allocation', () => {
    const r = run({ items: [issue('X-1', 'b', 45)] });
    expect(member(r, 'b').utilization).toBe(150);
    expect(member(r, 'b').balance).toBe(-15);
    expect(member(r, 'b').status).toBe('over');
    expect(r.totals.overloaded).toBe(1);
  });

  it('counts issues without estimates but allocates nothing', () => {
    const r = run({ items: [issue('X-1', 'a', null)] });
    expect(member(r, 'a').allocated).toBe(0);
    expect(member(r, 'a').unestimatedCount).toBe(1);
    expect(r.totals.unestimatedCount).toBe(1);
  });

  it('handles a sprint with no issues', () => {
    const r = run({ items: [] });
    expect(r.totals.allocated).toBe(0);
    expect(r.totals.utilization).toBe(0);
    expect(member(r, 'a').status).toBe('idle');
    expect(r.totals.underutilized).toBe(2);
  });

  it('reports unassigned work separately', () => {
    const r = run({ items: [issue('X-1', null, 8)] });
    expect(r.totals.unassignedAllocated).toBe(8);
    expect(r.totals.allocated).toBe(0);
  });

  it('adds assignees outside the template with zero capacity', () => {
    const r = run({ items: [issue('X-1', 'stranger', 8)] });
    const s = member(r, 'stranger');
    expect(s.inTemplate).toBe(false);
    expect(s.totalCapacity).toBe(0);
    expect(s.status).toBe('over');
  });

  it('filters by configured issue types and completed subtasks', () => {
    const items = [
      issue('X-1', 'a', 8, { issueType: 'Bug' }),
      issue('X-2', 'a', 8, { issueType: 'Sub-task', isSubtask: true, statusCategory: 'done', doneDate: '2026-10-30' }),
      issue('X-3', 'a', 8),
    ];
    const r = run({ items, settings: { ...DEFAULT_SETTINGS, issueTypes: ['Story', 'Sub-task'] } });
    expect(member(r, 'a').allocated).toBe(8);
  });

  it('computes remaining work using both documented modes', () => {
    const items = [
      issue('X-1', 'a', 10, { timeSpentSec: 4 * 3600, remainingEstimateSec: 7 * 3600 }),
      issue('X-2', 'a', 5, { statusCategory: 'done', remainingEstimateSec: 2 * 3600 }),
    ];
    expect(member(run({ items }), 'a').remainingWork).toBe(7);
    expect(member(run({ items, settings: { ...DEFAULT_SETTINGS, remainingMode: 'original' } }), 'a').remainingWork).toBe(6);
    expect(member(run({ items, settings: { ...DEFAULT_SETTINGS, zeroRemainingOnDone: false } }), 'a').remainingWork).toBe(9);
  });

  it('remaining capacity counts only days from today', () => {
    expect(member(run({ today: '2026-11-09' }), 'a').remainingCapacity).toBe(40);
    expect(member(run({ today: '2026-11-20' }), 'a').remainingCapacity).toBe(0);
    expect(member(run({ today: '2026-10-01' }), 'a').remainingCapacity).toBe(80);
  });

  it('computes time-spent utilisation for resource utilisation', () => {
    const r = run({ items: [issue('X-1', 'a', 10, { timeSpentSec: 20 * 3600 })] });
    expect(member(r, 'a').timeSpent).toBe(20);
    expect(member(r, 'a').spentUtilization).toBe(25);
  });
});

describe('story points', () => {
  const pointsConfig = config({ unit: 'points', defaultCapacityPerDay: 1, members: [{ accountId: 'a', displayName: 'Ann', capacityPerDay: null, focus: null }] });

  it('uses story points and never hours', () => {
    const items = [issue('X-1', 'a', 100, { storyPoints: 5 }), issue('X-2', 'a', 100, { storyPoints: 3, statusCategory: 'done' })];
    const r = run({ unit: 'points', config: pointsConfig, items, today: '2026-11-09' });
    const a = member(r, 'a');
    expect(a.totalCapacity).toBe(10);
    expect(a.allocated).toBe(8);
    expect(a.remainingWork).toBe(5);
    expect(a.actualProgress).toBe(3);
    expect(a.expectedProgress).toBe(4); // half the capacity days have elapsed
    expect(a.spentUtilization).toBeNull();
  });

  it('refuses to apply an hours template to a points report', () => {
    const r = run({ unit: 'points', items: [issue('X-1', 'a', 8, { storyPoints: 2 })] });
    expect(r.totals.totalCapacity).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/cannot be used for points/);
  });
});

describe('formatting and helpers', () => {
  it('never shows NaN or Infinity', () => {
    expect(percent(5, 0)).toBeNull();
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatValue(Number.NaN, 'hours')).toBe('—');
  });

  it('formats hours and points', () => {
    expect(formatValue(12.5, 'hours')).toBe('12h 30m');
    expect(formatValue(-3, 'hours')).toBe('-3h');
    expect(formatValue(4.25, 'points')).toBe('4.3 pts');
  });

  it('date helpers', () => {
    expect(eachDate('2026-11-13', '2026-11-02')).toEqual([]);
    expect(eachDate('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
  });
});
