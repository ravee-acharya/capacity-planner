// Detects people whose allocations across overlapping sprint plans add up to more than 100%.
import { safeNumber } from './engine';
import type { DateStr, SprintPlan, TemplateConfig } from './types';

export interface OtherCommitment {
  sprintId: number;
  sprintName: string;
  templateName: string;
  allocation: number;
  start: DateStr;
  end: DateStr;
}

const allocationOf = (m: TemplateConfig['members'][number]) => Math.min(100, safeNumber(m.allocation ?? 100, 100));

/** Allocations of each person in other plans whose dates overlap [start, end]. */
export function otherCommitments(plans: SprintPlan[], current: { sprintId: number; start?: DateStr | null; end?: DateStr | null }): Record<string, OtherCommitment[]> {
  const out: Record<string, OtherCommitment[]> = {};
  if (!current.start || !current.end) return out;
  for (const p of plans) {
    if (p.sprintId === current.sprintId || !p.start || !p.end) continue;
    if (p.end < current.start || p.start > current.end) continue;
    for (const m of p.config.members) {
      (out[m.accountId] ??= []).push({ sprintId: p.sprintId, sprintName: p.sprintName, templateName: p.templateName, allocation: allocationOf(m), start: p.start, end: p.end });
    }
  }
  return out;
}

export interface OverCommitment {
  accountId: string;
  displayName: string;
  here: number;
  total: number;
  others: OtherCommitment[];
}

/** People whose allocation in this plan plus overlapping plans exceeds 100%. */
export function overCommitted(config: TemplateConfig, others: Record<string, OtherCommitment[]>): OverCommitment[] {
  return config.members
    .map((m) => {
      const list = others[m.accountId] ?? [];
      const here = allocationOf(m);
      return { accountId: m.accountId, displayName: m.displayName, here, total: here + list.reduce((s, o) => s + o.allocation, 0), others: list };
    })
    .filter((c) => c.others.length > 0 && c.total > 100);
}
