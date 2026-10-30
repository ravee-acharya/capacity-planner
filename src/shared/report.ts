// Report shapes and CSV export shared by backend (saving) and frontend (rendering/export).
import { toCsv } from './csv';
import { round, type CapacityResult, type MemberCapacity } from './engine';
import type { DateStr, SprintInfo, Unit } from './types';

export interface ReportRow {
  /** Remembered so the report form can be reopened; not used in calculations. */
  projectKey?: string;
  boardId: number;
  sprintId: number;
  /** When omitted the sprint's saved plan is used. */
  templateId?: string;
}

export interface ReportParams {
  unit: Unit;
  rows: ReportRow[];
}

export interface WeeklySpent {
  weeks: DateStr[];
  /** accountId -> week start -> { spent hours, capacity hours } */
  byMember: Record<string, Record<DateStr, { spent: number; capacity: number }>>;
  truncated: boolean;
}

export interface SprintReport {
  sprint: SprintInfo;
  boardId: number;
  templateName: string;
  source: 'plan' | 'template';
  result: CapacityResult;
  weekly?: WeeklySpent;
}

export interface Report {
  params: ReportParams;
  unit: Unit;
  generatedAt: string;
  sprints: SprintReport[];
  errors: string[];
}

export interface SavedReport {
  id: string;
  name: string;
  description?: string;
  visibility: 'private' | 'public';
  ownerId: string;
  ownerName: string;
  params: ReportParams;
  snapshot: Report;
  createdAt: string;
  updatedAt: string;
}

export type SavedReportSummary = Omit<SavedReport, 'snapshot'> & { sprintNames: string[] };

/** Drop per-day detail so a saved snapshot stays well inside storage limits. */
export function compactReport(report: Report): Report {
  return {
    ...report,
    sprints: report.sprints.map((s) => ({
      ...s,
      result: {
        ...s.result,
        dates: [],
        members: s.result.members.map((m): MemberCapacity => ({ ...m, days: [] })),
      },
    })),
  };
}

export interface RoleSummary {
  role: string;
  members: number;
  totalCapacity: number;
  allocated: number;
  timeSpent: number;
  remainingCapacity: number;
  balance: number;
}

export function rolesOf(result: CapacityResult): RoleSummary[] {
  const map = new Map<string, RoleSummary>();
  for (const m of result.members) {
    const r = map.get(m.role) ?? { role: m.role, members: 0, totalCapacity: 0, allocated: 0, timeSpent: 0, remainingCapacity: 0, balance: 0 };
    r.members += 1;
    r.totalCapacity += m.totalCapacity;
    r.allocated += m.allocated;
    r.timeSpent += m.timeSpent;
    r.remainingCapacity += m.remainingCapacity;
    r.balance += m.balance;
    map.set(m.role, r);
  }
  return [...map.values()].sort((a, b) => a.role.localeCompare(b.role));
}

const n = (v: number | null) => (v === null ? null : round(v, 2));

export function reportToCsv(report: Report): string {
  const u = report.unit === 'hours' ? 'hours' : 'points';
  const headers = [
    'Sprint', 'Sprint start', 'Sprint end', 'Template', 'Team member', 'Role', 'In template',
    'Available days', `Capacity per day (${u})`, 'Focus', `Total capacity (${u})`, `Allocated work (${u})`,
    'Time spent (hours)', `Remaining capacity (${u})`, `Remaining work (${u})`, `Balance (${u})`,
    'Utilisation %', 'Time-spent utilisation %', 'Status', 'Issues', 'Unestimated issues',
  ];
  const rows = report.sprints.flatMap((s) =>
    s.result.members.map((m) => [
      s.sprint.name, s.result.start, s.result.end, s.templateName, m.displayName, m.role, m.inTemplate ? 'Yes' : 'No',
      m.availableDays, n(m.capacityPerDay), n(m.focus), n(m.totalCapacity), n(m.allocated),
      n(m.timeSpent), n(m.remainingCapacity), n(m.remainingWork), n(m.balance),
      n(m.utilization), n(m.spentUtilization), m.status, m.issueKeys.length, m.unestimatedCount,
    ]),
  );
  return toCsv(headers, rows);
}
