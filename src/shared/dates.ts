import type { DateStr, Weekday } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isDateStr(value: unknown): value is DateStr {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Date part of an ISO timestamp, in UTC. Returns undefined for missing/invalid input. */
export function toDateStr(value: string | number | Date | null | undefined): DateStr | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function weekday(date: DateStr): Weekday {
  return new Date(`${date}T00:00:00Z`).getUTCDay() as Weekday;
}

export function addDays(date: DateStr, days: number): DateStr {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of dates from start to end. Empty when end is before start. Capped at ~2 years. */
export function eachDate(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  if (!isDateStr(start) || !isDateStr(end) || end < start) return out;
  for (let d = start; d <= end && out.length < 750; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing the date. */
export function weekStart(date: DateStr): DateStr {
  const dow = weekday(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** Expand inclusive from/to ranges into a set of dates. */
export function expandRanges(ranges: { from: DateStr; to: DateStr }[]): Set<DateStr> {
  const out = new Set<DateStr>();
  for (const r of ranges) for (const d of eachDate(r.from, r.to)) out.add(d);
  return out;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
