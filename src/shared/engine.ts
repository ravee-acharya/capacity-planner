/**
 * Capacity calculation engine. Pure functions only: no Jira, storage or UI access,
 * so the same code runs in the Forge backend, the browser and the unit tests.
 *
 * Rules follow the vendor documentation "How Capacity is calculated":
 *  - the sprint start/end dates bound the period;
 *  - per-day capacity = template capacity/day * focus (member value, else template default);
 *  - non-working weekdays, team holidays and member leave are removed (each date counted once);
 *  - allocated work = sum of Original Estimates (hours) or Story Points (points) of the
 *    sprint issues assigned to the member;
 *  - remaining capacity = per-day capacity summed over the sprint days from today onwards;
 *  - resource utilisation = time spent / total capacity.
 * In addition, "balance" = total capacity - allocated work (negative = over-allocated).
 */
import { eachDate, weekday } from './dates';
import type { DateStr, Settings, TemplateConfig, TemplateMember, Unit, WorkItem } from './types';

export type DayKind = 'working' | 'nonworking' | 'holiday' | 'leave';

export interface DayCapacity {
  date: DateStr;
  kind: DayKind;
  capacity: number;
  overridden: boolean;
}

export type MemberStatus = 'over' | 'under' | 'ok' | 'nocapacity' | 'idle';

export interface MemberCapacity {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  role: string;
  inTemplate: boolean;
  capacityPerDay: number;
  focus: number;
  days: DayCapacity[];
  availableDays: number;
  totalCapacity: number;
  remainingCapacity: number;
  allocated: number;
  timeSpent: number;
  remainingWork: number;
  balance: number;
  /** allocated / totalCapacity * 100, or null when there is no capacity. */
  utilization: number | null;
  /** timeSpent / totalCapacity * 100 (hours only), or null. */
  spentUtilization: number | null;
  expectedProgress: number | null;
  actualProgress: number | null;
  status: MemberStatus;
  issueKeys: string[];
  unestimatedCount: number;
}

export interface CapacityTotals {
  members: number;
  totalCapacity: number;
  remainingCapacity: number;
  allocated: number;
  timeSpent: number;
  remainingWork: number;
  balance: number;
  utilization: number | null;
  overloaded: number;
  underutilized: number;
  unassignedAllocated: number;
  unassignedCount: number;
  unestimatedCount: number;
  issueCount: number;
}

export interface CapacityResult {
  unit: Unit;
  start: DateStr | null;
  end: DateStr | null;
  dates: DateStr[];
  /** Team-level working days (weekday filter minus holidays). */
  workingDays: number;
  holidays: DateStr[];
  members: MemberCapacity[];
  totals: CapacityTotals;
  warnings: string[];
}

export interface CapacityInput {
  unit: Unit;
  start: DateStr | null | undefined;
  end: DateStr | null | undefined;
  today: DateStr;
  config: TemplateConfig;
  holidays: Iterable<DateStr>;
  /** accountId -> dates on leave */
  leaves: Record<string, Iterable<DateStr>>;
  overrides?: Record<string, Record<DateStr, number>>;
  items: WorkItem[];
  settings: Pick<
    Settings,
    | 'issueTypes'
    | 'excludeSubtasksDoneBeforeStart'
    | 'zeroRemainingOnDone'
    | 'remainingMode'
    | 'overloadThreshold'
    | 'underThreshold'
  >;
}

export const DEFAULT_SETTINGS: Settings = {
  issueTypes: [],
  excludeSubtasksDoneBeforeStart: true,
  zeroRemainingOnDone: true,
  remainingMode: 'remaining',
  overloadThreshold: 100,
  underThreshold: 70,
  restrictTemplatesToAdmins: false,
};

const HOUR = 3600;

/** Coerce to a finite, non-negative number. */
export function safeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Percentage that never yields NaN/Infinity: null when the denominator is zero. */
export function percent(numerator: number, denominator: number): number | null {
  if (!(denominator > 0) || !Number.isFinite(numerator)) return null;
  return (numerator / denominator) * 100;
}

export function effectivePerDay(member: TemplateMember, config: TemplateConfig) {
  const capacityPerDay = safeNumber(member.capacityPerDay ?? config.defaultCapacityPerDay);
  const focus = Math.min(1, safeNumber(member.focus ?? config.defaultFocus, 1));
  return { capacityPerDay, focus, perDay: capacityPerDay * focus };
}

/** Per-day capacity for one member. Precedence: non-working > holiday > leave > override > default. */
export function memberDays(
  dates: DateStr[],
  workingDays: number[],
  holidays: Set<DateStr>,
  leave: Set<DateStr>,
  perDay: number,
  overrides: Record<DateStr, number> | undefined,
): DayCapacity[] {
  const working = new Set(workingDays);
  return dates.map((date) => {
    if (!working.has(weekday(date))) return { date, kind: 'nonworking', capacity: 0, overridden: false };
    if (holidays.has(date)) return { date, kind: 'holiday', capacity: 0, overridden: false };
    if (leave.has(date)) return { date, kind: 'leave', capacity: 0, overridden: false };
    const o = overrides?.[date];
    if (o !== undefined && o !== null && Number.isFinite(Number(o))) {
      return { date, kind: 'working', capacity: safeNumber(o), overridden: true };
    }
    return { date, kind: 'working', capacity: perDay, overridden: false };
  });
}

/** Whether an issue counts towards capacity under the configured settings. */
export function isCounted(item: WorkItem, start: DateStr | null | undefined, settings: CapacityInput['settings']) {
  if (settings.issueTypes.length > 0 && !settings.issueTypes.includes(item.issueType)) return false;
  if (
    settings.excludeSubtasksDoneBeforeStart &&
    item.isSubtask &&
    item.statusCategory === 'done' &&
    start &&
    item.doneDate &&
    item.doneDate < start
  ) {
    return false;
  }
  return true;
}

/** Allocated work of an issue in the given unit; null when the issue has no estimate. */
export function allocatedOf(item: WorkItem, unit: Unit): number | null {
  if (unit === 'points') return item.storyPoints === null ? null : safeNumber(item.storyPoints);
  return item.originalEstimateSec === null ? null : safeNumber(item.originalEstimateSec) / HOUR;
}

export function timeSpentOf(item: WorkItem): number {
  return safeNumber(item.timeSpentSec) / HOUR;
}

export function remainingWorkOf(item: WorkItem, unit: Unit, settings: CapacityInput['settings']): number {
  const done = item.statusCategory === 'done';
  if (unit === 'points') return done ? 0 : safeNumber(item.storyPoints);
  if (done && settings.zeroRemainingOnDone) return 0;
  if (settings.remainingMode === 'original') {
    return Math.max(0, safeNumber(item.originalEstimateSec) - safeNumber(item.timeSpentSec)) / HOUR;
  }
  return safeNumber(item.remainingEstimateSec) / HOUR;
}

function statusOf(m: Pick<MemberCapacity, 'totalCapacity' | 'allocated' | 'utilization'>, s: CapacityInput['settings']): MemberStatus {
  if (m.totalCapacity <= 0) return m.allocated > 0 ? 'over' : 'nocapacity';
  const u = round(m.utilization ?? 0, 2);
  if (u > s.overloadThreshold) return 'over';
  if (m.allocated === 0) return 'idle';
  if (u < s.underThreshold) return 'under';
  return 'ok';
}

export function calculateCapacity(input: CapacityInput): CapacityResult {
  const { unit, config, settings, today } = input;
  const warnings: string[] = [];
  const start = input.start ?? null;
  const end = input.end ?? null;
  if (!start || !end) warnings.push('The sprint has no start/end dates; set a planning period to calculate capacity.');
  else if (end < start) warnings.push('The planning period ends before it starts.');
  if (config.unit !== unit) warnings.push(`The template is defined in ${config.unit}; it cannot be used for ${unit}.`);

  const dates = start && end ? eachDate(start, end) : [];
  const holidays = new Set<DateStr>();
  for (const h of input.holidays) if (!start || !end || (h >= start && h <= end)) holidays.add(h);
  const workingSet = new Set<number>(config.workingDays);
  const teamWorkingDays = dates.filter((d) => workingSet.has(weekday(d)) && !holidays.has(d)).length;
  if (dates.length > 0 && teamWorkingDays === 0) warnings.push('The planning period contains no working days.');

  const counted = input.items.filter((i) => isCounted(i, start, settings));
  const byAssignee = new Map<string, WorkItem[]>();
  let unassignedAllocated = 0;
  let unassignedCount = 0;
  let unestimatedTotal = 0;
  for (const item of counted) {
    if (allocatedOf(item, unit) === null) unestimatedTotal += 1;
    if (!item.assigneeId) {
      unassignedAllocated += allocatedOf(item, unit) ?? 0;
      unassignedCount += 1;
      continue;
    }
    const list = byAssignee.get(item.assigneeId) ?? [];
    list.push(item);
    byAssignee.set(item.assigneeId, list);
  }

  const unitMismatch = config.unit !== unit;
  const members: MemberCapacity[] = [];
  const build = (member: TemplateMember, inTemplate: boolean) => {
    const eff = inTemplate && !unitMismatch ? effectivePerDay(member, config) : { capacityPerDay: 0, focus: 1, perDay: 0 };
    const leave = new Set<DateStr>(input.leaves[member.accountId] ?? []);
    const days = memberDays(dates, config.workingDays, holidays, leave, eff.perDay, input.overrides?.[member.accountId]);
    // Rounded to remove float drift (8 * 0.8 summed ten times is 63.999…), which would
    // otherwise flag exactly-full people as overloaded.
    const totalCapacity = round(days.reduce((s, d) => s + d.capacity, 0), 6);
    const remainingCapacity = round(days.filter((d) => d.date >= today).reduce((s, d) => s + d.capacity, 0), 6);
    const elapsedCapacity = totalCapacity - remainingCapacity;
    const items = byAssignee.get(member.accountId) ?? [];
    let allocated = 0;
    let timeSpent = 0;
    let remainingWork = 0;
    let unestimatedCount = 0;
    let donePoints = 0;
    for (const item of items) {
      const a = allocatedOf(item, unit);
      if (a === null) unestimatedCount += 1;
      allocated += a ?? 0;
      timeSpent += timeSpentOf(item);
      remainingWork += remainingWorkOf(item, unit, settings);
      if (item.statusCategory === 'done') donePoints += safeNumber(item.storyPoints);
    }
    allocated = round(allocated, 6);
    timeSpent = round(timeSpent, 6);
    remainingWork = round(remainingWork, 6);
    const utilization = percent(allocated, totalCapacity);
    const m: MemberCapacity = {
      accountId: member.accountId,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      role: member.role?.trim() || 'Unassigned role',
      inTemplate,
      capacityPerDay: eff.capacityPerDay,
      focus: eff.focus,
      days,
      availableDays: days.filter((d) => d.kind === 'working' && d.capacity > 0).length,
      totalCapacity,
      remainingCapacity,
      allocated,
      timeSpent,
      remainingWork,
      balance: totalCapacity - allocated,
      utilization,
      spentUtilization: unit === 'hours' ? percent(timeSpent, totalCapacity) : null,
      expectedProgress: unit === 'points' ? (totalCapacity > 0 ? (allocated * elapsedCapacity) / totalCapacity : 0) : null,
      actualProgress: unit === 'points' ? donePoints : null,
      status: 'ok',
      issueKeys: items.map((i) => i.key),
      unestimatedCount,
    };
    m.status = statusOf(m, settings);
    members.push(m);
  };

  const inTemplate = new Set<string>();
  for (const member of config.members) {
    if (inTemplate.has(member.accountId)) continue;
    inTemplate.add(member.accountId);
    build(member, true);
  }
  // Assignees with sprint work who are not in the template: zero capacity, so their work is visible.
  for (const [accountId, items] of byAssignee) {
    if (inTemplate.has(accountId)) continue;
    build({ accountId, displayName: items[0].assigneeName ?? accountId, avatarUrl: items[0].assigneeAvatar, capacityPerDay: 0, focus: 1 }, false);
  }
  if (members.some((m) => !m.inTemplate)) warnings.push('Some sprint work is assigned to people who are not in the template.');

  const sum = (f: (m: MemberCapacity) => number) => members.reduce((s, m) => s + f(m), 0);
  const totalCapacity = sum((m) => m.totalCapacity);
  const allocated = sum((m) => m.allocated);
  return {
    unit,
    start,
    end,
    dates,
    workingDays: teamWorkingDays,
    holidays: [...holidays].sort(),
    members,
    totals: {
      members: members.length,
      totalCapacity,
      remainingCapacity: sum((m) => m.remainingCapacity),
      allocated,
      timeSpent: sum((m) => m.timeSpent),
      remainingWork: sum((m) => m.remainingWork),
      balance: totalCapacity - allocated,
      utilization: percent(allocated, totalCapacity),
      overloaded: members.filter((m) => m.status === 'over').length,
      underutilized: members.filter((m) => m.status === 'under' || m.status === 'idle').length,
      unassignedAllocated,
      unassignedCount,
      unestimatedCount: unestimatedTotal,
      issueCount: counted.length,
    },
    warnings,
  };
}

/** Format a value in the unit for display. Hours are shown as "12h 30m". */
export function formatValue(value: number | null | undefined, unit: Unit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'points') return `${round(value, 1)} pts`;
  const sign = value < 0 ? '-' : '';
  const totalMinutes = Math.round(Math.abs(value) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${round(value, 1)}%`;
}
