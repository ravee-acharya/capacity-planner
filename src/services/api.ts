// Every resolver the frontend can invoke. Pure business logic over the Ctx ports, so the
// same code runs in Forge, in unit tests and in the local demo.
import { eachDate, expandRanges, isDateStr, toDateStr, weekStart } from '../shared/dates';
import { calculateCapacity, DEFAULT_SETTINGS } from '../shared/engine';
import { compactReport, type Report, type ReportParams, type SavedReport, type SavedReportSummary, type SprintReport, type WeeklySpent } from '../shared/report';
import type { DateStr, Holiday, Leave, Settings, SprintInfo, SprintPlan, Template, TemplateConfig, WorkItem } from '../shared/types';
import { normaliseWorkingDays, validateDateRange, validateSettings, validateTemplateInput, ValidationError } from '../shared/validation';
import type { Ctx } from './ports';

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const K = {
  settings: 'settings',
  template: (id: string) => `tpl:${id}`,
  plan: (sprintId: number) => `plan:${sprintId}`,
  holiday: (id: string) => `hol:${id}`,
  leave: (id: string) => `leave:${id}`,
  report: (id: string) => `report:${id}`,
  pref: (accountId: string) => `pref:${accountId}`,
};

const MAX_REPORT_ROWS = 6;
const MAX_SNAPSHOT_CHARS = 200_000;

export interface Preferences {
  projectKey?: string;
  boardId?: number;
  sprintId?: number;
  templateId?: string;
}

export interface Workspace {
  sprint: SprintInfo;
  plan: SprintPlan | null;
  items: WorkItem[];
  holidays: Holiday[];
  leaves: Leave[];
  settings: Settings;
  storyPointsField?: string;
  templateVersion?: number;
}

export interface TemplateInput {
  name: string;
  description?: string;
  config: TemplateConfig;
}

function sanitiseConfig(config: TemplateConfig): TemplateConfig {
  return {
    unit: config.unit,
    defaultCapacityPerDay: config.defaultCapacityPerDay,
    defaultFocus: config.defaultFocus,
    workingDays: normaliseWorkingDays(config.workingDays),
    members: config.members.map((m) => ({
      accountId: m.accountId,
      displayName: String(m.displayName ?? m.accountId).slice(0, 120),
      avatarUrl: typeof m.avatarUrl === 'string' ? m.avatarUrl : undefined,
      role: m.role ? String(m.role).trim().slice(0, 60) : undefined,
      capacityPerDay: m.capacityPerDay ?? null,
      focus: m.focus ?? null,
    })),
  };
}

export function createApi(ctx: Ctx) {
  let adminCache: Promise<boolean> | undefined;
  const isAdmin = () => (adminCache ??= ctx.jira.isAdmin().catch(() => false));
  const nowIso = () => ctx.now().toISOString();
  const today = () => ctx.now().toISOString().slice(0, 10);

  async function getSettings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...((await ctx.store.get<Partial<Settings>>(K.settings)) ?? {}) };
  }

  async function assertCanEditTemplates() {
    const settings = await getSettings();
    if (settings.restrictTemplatesToAdmins && !(await isAdmin())) {
      throw new ForbiddenError('Only Jira administrators can change capacity templates on this site.');
    }
  }

  async function getTemplate(id: string): Promise<Template> {
    const t = await ctx.store.get<Template>(K.template(id));
    if (!t) throw new NotFoundError('That capacity template no longer exists.');
    return t;
  }

  function checkTemplate(input: TemplateInput) {
    const problems = validateTemplateInput({ name: input?.name, description: input?.description, ...(input?.config ?? {}) });
    if (problems.length) throw new ValidationError(problems);
  }

  async function storyPointsField(boardId: number, settings: Settings) {
    if (settings.storyPointsFieldId) return settings.storyPointsFieldId;
    return ctx.jira.boardEstimationField(boardId).catch(() => undefined);
  }

  async function leavesByMember(): Promise<Record<string, DateStr[]>> {
    const leaves = await ctx.store.list<Leave>('leave:');
    const out: Record<string, DateStr[]> = {};
    for (const l of leaves) out[l.accountId] = [...(out[l.accountId] ?? []), ...expandRanges([l])];
    return out;
  }

  async function weekly(result: SprintReport['result'], items: WorkItem[]): Promise<WeeklySpent | undefined> {
    if (result.unit !== 'hours' || !result.start || !result.end) return undefined;
    const keys = items.filter((i) => (i.timeSpentSec ?? 0) > 0).map((i) => i.key);
    const { entries, truncated } = keys.length ? await ctx.jira.worklogs(keys, result.start, result.end) : { entries: [], truncated: false };
    const weeks = [...new Set(result.dates.map(weekStart))];
    const byMember: WeeklySpent['byMember'] = {};
    for (const m of result.members) {
      const row: Record<DateStr, { spent: number; capacity: number }> = {};
      for (const w of weeks) row[w] = { spent: 0, capacity: 0 };
      for (const d of m.days) row[weekStart(d.date)].capacity += d.capacity;
      byMember[m.accountId] = row;
    }
    for (const e of entries) {
      const row = byMember[e.authorId];
      const w = weekStart(e.started);
      if (row?.[w]) row[w].spent += e.timeSpentSec / 3600;
    }
    return { weeks, byMember, truncated };
  }

  async function sprintReport(row: { boardId: number; sprintId: number; templateId?: string }, unit: ReportParams['unit'], settings: Settings, holidays: Holiday[], leaves: Record<string, DateStr[]>): Promise<SprintReport> {
    const [sprint, plan] = await Promise.all([ctx.jira.sprint(row.sprintId), ctx.store.get<SprintPlan>(K.plan(row.sprintId))]);
    const usePlan = plan && (!row.templateId || row.templateId === plan.templateId);
    let config: TemplateConfig;
    let templateName: string;
    if (usePlan) {
      config = plan.config;
      templateName = plan.templateName;
    } else {
      if (!row.templateId) throw new ValidationError([`${sprint.name}: choose a template or create a capacity plan for this sprint first.`]);
      const t = await getTemplate(row.templateId);
      config = t;
      templateName = t.name;
    }
    const spField = unit === 'points' ? await storyPointsField(row.boardId, settings) : undefined;
    if (unit === 'points' && !spField) throw new ValidationError([`${sprint.name}: no story point field is configured for this board.`]);
    const items = await ctx.jira.sprintIssues(row.sprintId, spField);
    const result = calculateCapacity({
      unit,
      start: usePlan ? (sprint.startDate ?? plan.periodStart) : sprint.startDate,
      end: usePlan ? (sprint.endDate ?? plan.periodEnd) : sprint.endDate,
      today: today(),
      config,
      holidays: [...holidays.map((h) => h.date), ...(usePlan ? plan.teamHolidays : [])],
      leaves,
      overrides: usePlan ? plan.overrides : undefined,
      items,
      settings,
    });
    return { sprint, boardId: row.boardId, templateName, source: usePlan ? 'plan' : 'template', result, weekly: await weekly(result, items) };
  }

  async function computeReport(params: ReportParams): Promise<Report> {
    if (params?.unit !== 'hours' && params?.unit !== 'points') throw new ValidationError(['Choose hours or story points.']);
    const rows = (Array.isArray(params.rows) ? params.rows : [])
      .filter((r) => Number.isInteger(r?.sprintId) && Number.isInteger(r?.boardId))
      .map((r) => ({
        projectKey: typeof r.projectKey === 'string' ? r.projectKey.slice(0, 40) : undefined,
        boardId: r.boardId,
        sprintId: r.sprintId,
        templateId: typeof r.templateId === 'string' && r.templateId ? r.templateId.slice(0, 64) : undefined,
      }));
    if (rows.length === 0) throw new ValidationError(['Add at least one sprint to the report.']);
    if (rows.length > MAX_REPORT_ROWS) throw new ValidationError([`A report can compare at most ${MAX_REPORT_ROWS} sprints.`]);
    const [settings, holidays, leaves] = await Promise.all([getSettings(), ctx.store.list<Holiday>('hol:'), leavesByMember()]);
    const sprints: SprintReport[] = [];
    const errors: string[] = [];
    for (const row of rows) {
      try {
        sprints.push(await sprintReport(row, params.unit, settings, holidays, leaves));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return { params: { unit: params.unit, rows }, unit: params.unit, generatedAt: nowIso(), sprints, errors };
  }

  function summarise(r: SavedReport): SavedReportSummary {
    const { snapshot, ...rest } = r;
    return { ...rest, sprintNames: snapshot.sprints.map((s) => s.sprint.name) };
  }

  async function getSavedReport(id: string): Promise<SavedReport> {
    const r = await ctx.store.get<SavedReport>(K.report(id));
    if (!r || (r.visibility === 'private' && r.ownerId !== ctx.accountId)) throw new NotFoundError('That report does not exist or is private.');
    return r;
  }

  async function assertOwnsReport(r: SavedReport) {
    if (r.ownerId !== ctx.accountId && !(await isAdmin())) throw new ForbiddenError('Only the report owner can change it.');
  }

  return {
    async getContext() {
      const [me, admin, settings] = await Promise.all([ctx.jira.myself(), isAdmin(), getSettings()]);
      return {
        user: me,
        isAdmin: admin,
        canEditTemplates: !settings.restrictTemplatesToAdmins || admin,
        settings,
        today: today(),
        preferences: (await ctx.store.get<Preferences>(K.pref(ctx.accountId))) ?? {},
      };
    },

    async savePreferences(p: Preferences) {
      const clean: Preferences = {
        projectKey: typeof p?.projectKey === 'string' ? p.projectKey.slice(0, 40) : undefined,
        boardId: Number.isInteger(p?.boardId) ? p.boardId : undefined,
        sprintId: Number.isInteger(p?.sprintId) ? p.sprintId : undefined,
        templateId: typeof p?.templateId === 'string' ? p.templateId.slice(0, 64) : undefined,
      };
      await ctx.store.set(K.pref(ctx.accountId), clean);
      return clean;
    },

    // ---- Jira lookups ----
    searchProjects: (p: { query?: string }) => ctx.jira.searchProjects(String(p?.query ?? '').slice(0, 100)),
    getBoards: (p: { projectKey: string }) => ctx.jira.boardsForProject(String(p.projectKey)),
    getSprints: (p: { boardId: number }) => ctx.jira.sprintsForBoard(Number(p.boardId)),
    searchUsers: (p: { query?: string; projectKey?: string }) => ctx.jira.searchUsers(String(p?.query ?? '').slice(0, 100), p?.projectKey),
    getIssueTypes: () => ctx.jira.issueTypes(),

    // ---- Templates ----
    async listTemplates() {
      const list = await ctx.store.list<Template>('tpl:');
      return list.sort((a, b) => a.name.localeCompare(b.name));
    },
    getTemplate: (p: { id: string }) => getTemplate(p.id),
    async createTemplate(input: TemplateInput) {
      await assertCanEditTemplates();
      checkTemplate(input);
      const ts = nowIso();
      const t: Template = {
        ...sanitiseConfig(input.config),
        id: ctx.newId(),
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        version: 1,
        createdAt: ts,
        createdBy: ctx.accountId,
        updatedAt: ts,
        updatedBy: ctx.accountId,
      };
      await ctx.store.set(K.template(t.id), t);
      return t;
    },
    async updateTemplate(p: { id: string } & TemplateInput) {
      await assertCanEditTemplates();
      checkTemplate(p);
      const existing = await getTemplate(p.id);
      const t: Template = {
        ...existing,
        ...sanitiseConfig(p.config),
        name: p.name.trim(),
        description: p.description?.trim() || undefined,
        version: existing.version + 1,
        updatedAt: nowIso(),
        updatedBy: ctx.accountId,
      };
      await ctx.store.set(K.template(t.id), t);
      return t;
    },
    async duplicateTemplate(p: { id: string; name: string }) {
      await assertCanEditTemplates();
      const src = await getTemplate(p.id);
      const name = String(p.name ?? '').trim() || `Copy of ${src.name}`;
      const ts = nowIso();
      const t: Template = { ...src, id: ctx.newId(), name: name.slice(0, 80), version: 1, createdAt: ts, createdBy: ctx.accountId, updatedAt: ts, updatedBy: ctx.accountId };
      await ctx.store.set(K.template(t.id), t);
      return t;
    },
    async deleteTemplate(p: { id: string }) {
      await assertCanEditTemplates();
      await getTemplate(p.id);
      await ctx.store.delete(K.template(p.id));
      return { deleted: p.id };
    },

    // ---- Sprint plans (capacity tracking) ----
    async getWorkspace(p: { boardId: number; sprintId: number }): Promise<Workspace> {
      const settings = await getSettings();
      const [sprint, plan, holidays, leaves, spField] = await Promise.all([
        ctx.jira.sprint(Number(p.sprintId)),
        ctx.store.get<SprintPlan>(K.plan(Number(p.sprintId))),
        ctx.store.list<Holiday>('hol:'),
        ctx.store.list<Leave>('leave:'),
        storyPointsField(Number(p.boardId), settings),
      ]);
      const items = await ctx.jira.sprintIssues(sprint.id, spField);
      const tpl = plan ? await ctx.store.get<Template>(K.template(plan.templateId)) : undefined;
      return { sprint, plan: plan ?? null, items, holidays, leaves, settings, storyPointsField: spField, templateVersion: tpl?.version };
    },

    async applyTemplate(p: { boardId: number; sprintId: number; templateId: string }) {
      const [t, sprint, existing] = await Promise.all([getTemplate(p.templateId), ctx.jira.sprint(Number(p.sprintId)), ctx.store.get<SprintPlan>(K.plan(Number(p.sprintId)))]);
      const memberIds = new Set(t.members.map((m) => m.accountId));
      const overrides = Object.fromEntries(Object.entries(existing?.overrides ?? {}).filter(([id]) => memberIds.has(id)));
      const plan: SprintPlan = {
        sprintId: sprint.id,
        boardId: Number(p.boardId),
        sprintName: sprint.name,
        templateId: t.id,
        templateName: t.name,
        templateVersion: t.version,
        config: sanitiseConfig(t),
        teamHolidays: existing?.teamHolidays ?? [],
        overrides,
        periodStart: existing?.periodStart,
        periodEnd: existing?.periodEnd,
        updatedAt: nowIso(),
        updatedBy: ctx.accountId,
      };
      await ctx.store.set(K.plan(plan.sprintId), plan);
      return plan;
    },

    async savePlan(p: { plan: SprintPlan }) {
      const input = p?.plan;
      const existing = input ? await ctx.store.get<SprintPlan>(K.plan(Number(input.sprintId))) : undefined;
      if (!existing) throw new NotFoundError('Apply a template to this sprint before saving a plan.');
      // The unit is fixed by the template that was applied; switching units would mix estimates.
      const config: TemplateConfig = { ...existing.config, ...(input.config ?? {}), unit: existing.config.unit };
      const problems = validateTemplateInput({ name: existing.templateName, ...config });
      const holidays = Array.isArray(input.teamHolidays) ? input.teamHolidays : [];
      if (holidays.some((d) => !isDateStr(d))) problems.push('Team holidays contain an invalid date.');
      if ((input.periodStart || input.periodEnd) && validateDateRange(input.periodStart, input.periodEnd, 'Planning period').length) {
        problems.push(...validateDateRange(input.periodStart, input.periodEnd, 'Planning period'));
      }
      const max = config.unit === 'points' ? 100 : 24;
      const overrides: SprintPlan['overrides'] = {};
      for (const [accountId, days] of Object.entries(input.overrides ?? {})) {
        for (const [date, value] of Object.entries(days ?? {})) {
          if (!isDateStr(date)) problems.push('An override has an invalid date.');
          else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) problems.push(`Planned capacity on ${date} must be between 0 and ${max}.`);
          else (overrides[accountId] ??= {})[date] = value;
        }
      }
      if (problems.length) throw new ValidationError([...new Set(problems)]);
      const plan: SprintPlan = {
        ...existing,
        config: sanitiseConfig(config),
        teamHolidays: [...new Set(holidays)].sort(),
        overrides,
        periodStart: input.periodStart || undefined,
        periodEnd: input.periodEnd || undefined,
        updatedAt: nowIso(),
        updatedBy: ctx.accountId,
      };
      await ctx.store.set(K.plan(plan.sprintId), plan);
      return plan;
    },

    async deletePlan(p: { sprintId: number }) {
      await ctx.store.delete(K.plan(Number(p.sprintId)));
      return { deleted: p.sprintId };
    },

    // ---- Holidays and leave ----
    async listHolidays() {
      return (await ctx.store.list<Holiday>('hol:')).sort((a, b) => a.date.localeCompare(b.date));
    },
    async saveHoliday(p: { id?: string; date: string; name: string }) {
      const problems: string[] = [];
      if (!isDateStr(p?.date)) problems.push('Enter a valid holiday date.');
      const name = String(p?.name ?? '').trim();
      if (!name) problems.push('Holiday name is required.');
      if (name.length > 80) problems.push('Holiday name must be 80 characters or fewer.');
      if (problems.length) throw new ValidationError(problems);
      const existing = await ctx.store.list<Holiday>('hol:');
      if (existing.some((h) => h.date === p.date && h.id !== p.id)) throw new ValidationError([`There is already a holiday on ${p.date}.`]);
      const h: Holiday = { id: p.id || ctx.newId(), date: p.date, name };
      await ctx.store.set(K.holiday(h.id), h);
      return h;
    },
    async deleteHoliday(p: { id: string }) {
      await ctx.store.delete(K.holiday(p.id));
      return { deleted: p.id };
    },
    async listLeaves() {
      return (await ctx.store.list<Leave>('leave:')).sort((a, b) => a.from.localeCompare(b.from));
    },
    async saveLeave(p: Partial<Leave>) {
      const problems = validateDateRange(p?.from, p?.to, 'Leave');
      if (!p?.accountId) problems.push('Choose a team member.');
      if (p?.note && p.note.length > 200) problems.push('Note must be 200 characters or fewer.');
      if (isDateStr(p?.from) && isDateStr(p?.to) && eachDate(p.from, p.to).length > 366) problems.push('Leave can span at most one year.');
      if (problems.length) throw new ValidationError(problems);
      const l: Leave = {
        id: p.id || ctx.newId(),
        accountId: p.accountId!,
        displayName: String(p.displayName ?? p.accountId).slice(0, 120),
        from: p.from!,
        to: p.to!,
        note: p.note?.trim() || undefined,
      };
      await ctx.store.set(K.leave(l.id), l);
      return l;
    },
    async deleteLeave(p: { id: string }) {
      await ctx.store.delete(K.leave(p.id));
      return { deleted: p.id };
    },

    // ---- Settings ----
    getSettings,
    async saveSettings(p: Partial<Settings>) {
      if (!(await isAdmin())) throw new ForbiddenError('Only Jira administrators can change Capacity Planner settings.');
      const merged = { ...(await getSettings()), ...p };
      const problems = validateSettings(merged);
      if (problems.length) throw new ValidationError(problems);
      const clean: Settings = {
        issueTypes: merged.issueTypes.map(String),
        excludeSubtasksDoneBeforeStart: Boolean(merged.excludeSubtasksDoneBeforeStart),
        zeroRemainingOnDone: Boolean(merged.zeroRemainingOnDone),
        remainingMode: merged.remainingMode,
        overloadThreshold: merged.overloadThreshold,
        underThreshold: merged.underThreshold,
        restrictTemplatesToAdmins: Boolean(merged.restrictTemplatesToAdmins),
        storyPointsFieldId: merged.storyPointsFieldId || undefined,
      };
      await ctx.store.set(K.settings, clean);
      return clean;
    },

    // ---- Reports ----
    computeReport,
    async listSavedReports(): Promise<SavedReportSummary[]> {
      const all = await ctx.store.list<SavedReport>('report:');
      return all
        .filter((r) => r.visibility === 'public' || r.ownerId === ctx.accountId)
        .map(summarise)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    getSavedReport: (p: { id: string }) => getSavedReport(p.id),
    async saveReport(p: { name: string; description?: string; visibility: 'private' | 'public'; report: Report }) {
      const name = String(p?.name ?? '').trim();
      const problems: string[] = [];
      if (!name) problems.push('Report name is required.');
      if (name.length > 80) problems.push('Report name must be 80 characters or fewer.');
      if (p?.visibility !== 'private' && p?.visibility !== 'public') problems.push('Choose private or public visibility.');
      if (!p?.report?.sprints?.length) problems.push('Run the report before saving it.');
      if (problems.length) throw new ValidationError(problems);
      // Re-compute on the server so a saved snapshot always reflects real data, not client input.
      const fresh = compactReport(await computeReport(p.report.params));
      if (JSON.stringify(fresh).length > MAX_SNAPSHOT_CHARS) throw new ValidationError(['This report is too large to save. Compare fewer sprints.']);
      const me = await ctx.jira.myself();
      const ts = nowIso();
      const saved: SavedReport = {
        id: ctx.newId(),
        name,
        description: p.description?.trim().slice(0, 300) || undefined,
        visibility: p.visibility,
        ownerId: ctx.accountId,
        ownerName: me.displayName,
        params: fresh.params,
        snapshot: fresh,
        createdAt: ts,
        updatedAt: ts,
      };
      await ctx.store.set(K.report(saved.id), saved);
      return summarise(saved);
    },
    async updateSavedReport(p: { id: string; name?: string; visibility?: 'private' | 'public'; refresh?: boolean }) {
      const r = await getSavedReport(p.id);
      await assertOwnsReport(r);
      if (p.name !== undefined) {
        const name = String(p.name).trim();
        if (!name || name.length > 80) throw new ValidationError(['Report name must be 1-80 characters.']);
        r.name = name;
      }
      if (p.visibility !== undefined) {
        if (p.visibility !== 'private' && p.visibility !== 'public') throw new ValidationError(['Choose private or public visibility.']);
        r.visibility = p.visibility;
      }
      if (p.refresh) {
        r.snapshot = compactReport(await computeReport(r.params));
        if (JSON.stringify(r.snapshot).length > MAX_SNAPSHOT_CHARS) throw new ValidationError(['This report is too large to save.']);
      }
      r.updatedAt = nowIso();
      await ctx.store.set(K.report(r.id), r);
      return r;
    },
    async deleteSavedReport(p: { id: string }) {
      const r = await getSavedReport(p.id);
      await assertOwnsReport(r);
      await ctx.store.delete(K.report(r.id));
      return { deleted: r.id };
    },

    // ---- Overview helpers ----
    async upcomingTimeOff(p: { days?: number }) {
      const from = today();
      const to = toDateStr(ctx.now().getTime() + Math.min(Math.max(Number(p?.days) || 30, 1), 180) * 86_400_000)!;
      const [holidays, leaves] = await Promise.all([ctx.store.list<Holiday>('hol:'), ctx.store.list<Leave>('leave:')]);
      return {
        holidays: holidays.filter((h) => h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date)),
        leaves: leaves.filter((l) => l.to >= from && l.from <= to).sort((a, b) => a.from.localeCompare(b.from)),
      };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
export type ApiName = keyof Api;
