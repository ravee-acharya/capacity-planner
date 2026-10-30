import { isDateStr } from './dates';
import type { Settings, TemplateConfig, TemplateMember, Unit, Weekday } from './types';

export class ValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'ValidationError';
  }
}

export const MAX_PER_DAY: Record<Unit, number> = { hours: 24, points: 100 };

function checkNumber(problems: string[], label: string, value: unknown, min: number, max: number, nullable = false) {
  if (nullable && (value === null || value === undefined)) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    problems.push(`${label} must be a number between ${min} and ${max}.`);
  }
}

export function validateTemplateInput(input: { name?: unknown; description?: unknown } & Partial<TemplateConfig>): string[] {
  const problems: string[] = [];
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) problems.push('Template name is required.');
  if (name.length > 80) problems.push('Template name must be 80 characters or fewer.');
  if (typeof input.description === 'string' && input.description.length > 500) problems.push('Description must be 500 characters or fewer.');
  if (input.unit !== 'hours' && input.unit !== 'points') problems.push('Unit must be hours or story points.');
  const unit: Unit = input.unit === 'points' ? 'points' : 'hours';
  checkNumber(problems, 'Default capacity per day', input.defaultCapacityPerDay, 0, MAX_PER_DAY[unit]);
  checkNumber(problems, 'Default focus', input.defaultFocus, 0, 1);
  const days = input.workingDays ?? [];
  if (!Array.isArray(days) || days.length === 0) problems.push('Select at least one working day.');
  else if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) problems.push('Working days are invalid.');
  const members = input.members ?? [];
  if (!Array.isArray(members)) problems.push('Members are invalid.');
  else {
    if (members.length > 200) problems.push('A template can have at most 200 members.');
    const seen = new Set<string>();
    members.forEach((m: TemplateMember) => {
      const label = m?.displayName || m?.accountId || 'member';
      if (!m || typeof m.accountId !== 'string' || !m.accountId) problems.push('Every member needs a Jira account.');
      else if (seen.has(m.accountId)) problems.push(`${label} is listed more than once.`);
      else seen.add(m.accountId);
      checkNumber(problems, `Capacity per day for ${label}`, m?.capacityPerDay, 0, MAX_PER_DAY[unit], true);
      checkNumber(problems, `Focus for ${label}`, m?.focus, 0, 1, true);
      if (m?.role && String(m.role).length > 60) problems.push(`Role for ${label} must be 60 characters or fewer.`);
    });
  }
  return problems;
}

export function normaliseWorkingDays(days: number[]): Weekday[] {
  return [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() as Weekday[];
}

export function validateSettings(s: Partial<Settings>): string[] {
  const problems: string[] = [];
  if (s.issueTypes !== undefined && (!Array.isArray(s.issueTypes) || s.issueTypes.some((t) => typeof t !== 'string'))) {
    problems.push('Issue types are invalid.');
  }
  if (s.remainingMode !== undefined && s.remainingMode !== 'remaining' && s.remainingMode !== 'original') {
    problems.push('Remaining work mode is invalid.');
  }
  checkNumber(problems, 'Overload threshold', s.overloadThreshold, 1, 1000);
  checkNumber(problems, 'Under-utilisation threshold', s.underThreshold, 0, 1000);
  if ((s.underThreshold ?? 0) >= (s.overloadThreshold ?? 100)) problems.push('Under-utilisation threshold must be below the overload threshold.');
  if (s.storyPointsFieldId && !/^customfield_\d+$/.test(s.storyPointsFieldId)) problems.push('Story points field must look like customfield_10016.');
  return problems;
}

export function validateDateRange(from: unknown, to: unknown, label: string): string[] {
  if (!isDateStr(from) || !isDateStr(to)) return [`${label}: enter valid dates.`];
  if (to < from) return [`${label}: the end date is before the start date.`];
  return [];
}
