// Every resolver the frontend can invoke. Pure business logic over the Ctx ports, so the
// same code runs in Forge, in unit tests and in the local demo.
import { otherCommitments, type OtherCommitment } from '../shared/commitments';
import { addDays, eachDate, expandRanges, isDateStr, toDateStr, weekStart } from '../shared/dates';
import { allocatedOf, calculateCapacity, DEFAULT_SETTINGS, holidayInputs, isCounted, locationKey, round } from '../shared/engine';
import { calibrateMember, velocityForecast, type HistorySprint, type MemberCalibration, type MemberSample, type VelocityForecast } from '../shared/forecast';
import { compactReport, type Report, type ReportParams, type SavedReport, type SavedReportSummary, type SprintReport, type WeeklySpent } from '../shared/report';
import type { DateStr, Holiday, Leave, Settings, SprintInfo, SprintPlan, Template, TemplateConfig, TemplateMember, Unit, WorkItem } from '../shared/types';
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
const DEFAULT_CONFIG: TemplateConfig = { unit: 'hours', defaultCapacityPerDay: 8, defaultFocus: 1, workingDays: [1, 2, 3, 4, 5], members: [] };
/** Days after a sprint's planned end that still count as finished in that sprint. */
const SPRINT_CLOSE_GRACE_DAYS = 3;
/** A sprint completing more than 2× its capacity is treated as bad data, not velocity. */
const MAX_PLAUSIBLE_RATE = 2;
/** Per past sprint; keeps a 6-sprint forecast well inside the resolver time limit. */
const MAX_FORECAST_WORKLOG_ISSUES = 60;
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
  /** Other sprint plans overlapping this sprint, per person (for over-commitment warnings). */
  commitments: Record<string, OtherCommitment[]>;
  /** Project the sprint's board belongs to. */
  projectKey?: string;
  /** Template members (of the plan, or of `templateId` when there is no plan) who are not in the project. */
  hiddenMembers: { accountId: string; displayName: string }[];
}

export interface ForecastMember extends MemberCalibration {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  configuredFocus: number;
  totalCapacity: number;
  allocated: number;
  /** Allocated work scaled by the person's estimate bias (hours only). */
  riskAdjusted: number | null;
}

export interface Forecast {
  unit: Unit;
  generatedAt: string;
  history: HistorySprint[];
  velocity: VelocityForecast | null;
  capacity: number;
  committed: number;
  members: ForecastMember[];
  warnings: string[];
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
      allocation: m.allocation ?? null,
      location: m.location ? String(m.location).trim().slice(0, 40) || undefined : undefined,
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

  /**
   * Limit a template's people to members of the sprint's Jira project (people who can be assigned
   * issues there). A template can be reused across projects, but a project's report should only
   * show that project's people. If Jira can't be asked, everyone is kept.
   */
  const membershipCache = new Map<string, Promise<Set<string>>>();
  async function scopeToProject(boardId: number, config: TemplateConfig, projectHint?: string) {
    const projectKey = (await ctx.jira.boardProject(boardId).catch(() => undefined)) ?? projectHint;
    if (!projectKey || config.members.length === 0) return { config, hidden: [] as TemplateMember[], projectKey };
    const ids = config.members.map((m) => m.accountId);
    const cacheKey = `${projectKey}|${[...ids].sort().join(',')}`;
    let lookup = membershipCache.get(cacheKey);
    if (!lookup) {
      lookup = ctx.jira.projectMembers(projectKey, ids);
      membershipCache.set(cacheKey, lookup);
    }
    const members = await lookup.catch(() => undefined);
    if (!members) return { config, hidden: [] as TemplateMember[], projectKey };
    return {
      config: { ...config, members: config.members.filter((m) => members.has(m.accountId)) },
      hidden: config.members.filter((m) => !members.has(m.accountId)),
      projectKey,
    };
  }

  function hiddenNotice(hidden: TemplateMember[], projectKey?: string) {
    const names = hidden.map((m) => m.displayName);
    const list = names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ');
    return `${hidden.length} template member(s) are not part of ${projectKey ?? 'this project'} in Jira and are not shown: ${list}.`;
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

  async function sprintReport(row: { boardId: number; sprintId: number; templateId?: string; projectKey?: string }, unit: ReportParams['unit'], settings: Settings, holidays: Holiday[], leaves: Record<string, DateStr[]>): Promise<SprintReport> {
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
    // Never mix units: an hours report over a story-point plan would show zero capacity.
    if (config.unit !== unit) {
      const planned = config.unit === 'hours' ? 'hours' : 'story points';
      throw new ValidationError([`${sprint.name}: “${templateName}” is planned in ${planned}. Switch Capacity type to ${planned === 'hours' ? 'Hours' : 'Story points'} to report on it.`]);
    }
    const spField = unit === 'points' ? await storyPointsField(row.boardId, settings) : undefined;
    if (unit === 'points' && !spField) throw new ValidationError([`${sprint.name}: no story point field is configured for this board.`]);
    const [items, scope] = await Promise.all([ctx.jira.sprintIssues(row.sprintId, spField), scopeToProject(row.boardId, config, row.projectKey)]);
    const result = calculateCapacity({
      unit,
      start: usePlan ? (sprint.startDate ?? plan.periodStart) : sprint.startDate,
      end: usePlan ? (sprint.endDate ?? plan.periodEnd) : sprint.endDate,
      today: today(),
      config: scope.config,
      ...holidayInputs(holidays, usePlan ? plan.teamHolidays : []),
      leaves,
      overrides: usePlan ? plan.overrides : undefined,
      items,
      settings,
    });
    if (scope.hidden.length) result.warnings.push(hiddenNotice(scope.hidden, scope.projectKey));
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

  /**
   * Forecast for a sprint from the board's recently closed sprints: capacity-adjusted velocity,
   * plus per-person measured focus and estimate bias. Uses each past sprint's own plan when it
   * has one, otherwise the current configuration.
   */
  async function getForecast(p: { boardId: number; sprintId: number; templateId?: string; sprints?: number }): Promise<Forecast> {
    const boardId = Number(p.boardId);
    const sprintId = Number(p.sprintId);
    const want = Math.min(Math.max(Number(p.sprints) || 6, 2), 8);
    const settings = await getSettings();
    const [sprint, plan, allSprints, holidays, leaves, spField] = await Promise.all([
      ctx.jira.sprint(sprintId),
      ctx.store.get<SprintPlan>(K.plan(sprintId)),
      ctx.jira.sprintsForBoard(boardId),
      ctx.store.list<Holiday>('hol:'),
      leavesByMember(),
      storyPointsField(boardId, settings),
    ]);
    const chosen: TemplateConfig | undefined = plan?.config ?? (p.templateId ? await getTemplate(p.templateId) : undefined);
    if (!chosen) throw new ValidationError(['Apply a template to this sprint (or choose one) before forecasting.']);
    const scope = await scopeToProject(boardId, chosen);
    const config = scope.config;
    const unit = config.unit;
    const warnings: string[] = [];
    if (unit === 'points' && !spField) throw new ValidationError(['No story point field is configured for this board.']);

    const past = allSprints
      .filter((s) => s.state === 'closed' && s.id !== sprintId && s.startDate && s.endDate)
      .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))
      .slice(0, want);
    if (past.length === 0) warnings.push('This board has no closed sprints with dates yet, so there is no history to learn from.');

    if (scope.hidden.length) warnings.push(hiddenNotice(scope.hidden, scope.projectKey));
    const memberIds = new Set(config.members.map((m) => m.accountId));
    const samples = new Map<string, MemberSample[]>();
    const history: HistorySprint[] = [];
    let usedFallbackConfig = 0;
    let truncatedWorklogs = 0;
    let excludedDone = 0;

    // Three sprints at a time keeps well inside the resolver time limit.
    for (let i = 0; i < past.length; i += 3) {
      const batch = past.slice(i, i + 3);
      const loaded = await Promise.all(
        batch.map(async (s) => {
          const items = await ctx.jira.sprintIssues(s.id, spField);
          // Hours logged *during the sprint* by each person. Issue "time spent" can't be used:
          // it includes everything ever logged on the issue, often across many sprints.
          const logged = unit === 'hours' ? items.filter((it) => (it.timeSpentSec ?? 0) > 0).map((it) => it.key) : [];
          const keys = logged.slice(0, MAX_FORECAST_WORKLOG_ISSUES);
          const wl = keys.length ? await ctx.jira.worklogs(keys, s.startDate!, s.endDate!) : { entries: [], truncated: false };
          const byAuthor = new Map<string, number>();
          for (const e of wl.entries) byAuthor.set(e.authorId, (byAuthor.get(e.authorId) ?? 0) + e.timeSpentSec / 3600);
          if (wl.truncated || logged.length > keys.length) truncatedWorklogs += 1;
          return { s, items, byAuthor, own: await ctx.store.get<SprintPlan>(K.plan(s.id)) };
        }),
      );
      for (const { s, items, byAuthor, own } of loaded) {
        const ownUsable = own && own.config.unit === unit;
        const histConfig: TemplateConfig = ownUsable ? (await scopeToProject(boardId, own.config)).config : config;
        if (!ownUsable) usedFallbackConfig += 1;
        const result = calculateCapacity({
          unit,
          start: s.startDate,
          end: s.endDate,
          today: s.endDate!,
          config: histConfig,
          ...holidayInputs(holidays, own?.teamHolidays),
          leaves,
          overrides: own?.overrides,
          items,
          settings,
        });
        // Delivery = finished *during* the sprint: from its start to its planned end (plus a few
        // days' grace for late closing). Sprints are sometimes closed months late, and issues
        // already finished before the start are often carried in; neither is this sprint's output.
        const finishedBy = addDays(s.endDate!, SPRINT_CLOSE_GRACE_DAYS);
        const sum = (list: WorkItem[]) => list.reduce((acc, it) => acc + (allocatedOf(it, unit) ?? 0), 0);
        const doneBeforeStart = (it: WorkItem) => it.statusCategory === 'done' && !!it.doneDate && it.doneDate < s.startDate!;
        const isDone = (it: WorkItem) => it.statusCategory === 'done' && (!it.doneDate || (it.doneDate >= s.startDate! && it.doneDate <= finishedBy));
        const allCounted = items.filter((it) => isCounted(it, s.startDate, settings) && !doneBeforeStart(it));
        // Only the template's people: capacity is theirs, so work done by others (people who
        // left, other teams, unassigned) would inflate the completion rate.
        const counted = allCounted.filter((it) => it.assigneeId && memberIds.has(it.assigneeId));
        const done = counted.filter(isDone);
        excludedDone += sum(allCounted.filter(isDone)) - sum(done);
        const capacity = result.totals.totalCapacity;
        const rate = capacity > 0 ? sum(done) / capacity : null;
        const outlier = rate !== null && rate > MAX_PLAUSIBLE_RATE;
        history.push({
          id: s.id,
          name: s.name,
          start: s.startDate!,
          end: s.endDate!,
          capacity,
          completed: sum(done),
          committed: sum(counted),
          rate: outlier ? null : rate,
          note: outlier ? `Excluded: ${Math.round(rate! * 100)}% of capacity is not plausible (bulk-closed issues or inflated estimates?)` : undefined,
        });
        for (const m of result.members) {
          if (!memberIds.has(m.accountId)) continue;
          const mine = done.filter((it) => it.assigneeId === m.accountId && (it.originalEstimateSec ?? 0) > 0 && (it.timeSpentSec ?? 0) > 0);
          const list = samples.get(m.accountId) ?? [];
          list.push({
            rawCapacityHours: unit === 'hours' ? m.rawCapacity : 0,
            spentHours: byAuthor.get(m.accountId) ?? 0,
            estimatedSec: mine.reduce((acc, it) => acc + (it.originalEstimateSec ?? 0), 0),
            spentOnEstimatedSec: mine.reduce((acc, it) => acc + (it.timeSpentSec ?? 0), 0),
            estimatedIssues: mine.length,
          });
          samples.set(m.accountId, list);
        }
      }
    }
    if (usedFallbackConfig > 0 && past.length > 0) {
      warnings.push(`${usedFallbackConfig} of ${past.length} past sprints had no saved plan, so today's template was used for their capacity.`);
    }
    if (unit === 'points') warnings.push('Measured focus needs hour-based capacity, so it is only shown for hours templates.');
    if (excludedDone > 0) {
      const amount = unit === 'hours' ? `${Math.round(excludedDone)}h of estimates` : `${round(excludedDone, 1)} points`;
      warnings.push(`${amount} completed in past sprints by people outside this template (or unassigned) is not counted, so the forecast reflects this team only.`);
    }
    if (truncatedWorklogs > 0) {
      warnings.push(`${truncatedWorklogs} past sprint(s) had more than ${MAX_FORECAST_WORKLOG_ISSUES} issues with logged time; measured focus uses the first ${MAX_FORECAST_WORKLOG_ISSUES} and may be understated.`);
    }

    // This sprint, as planned now.
    const items = await ctx.jira.sprintIssues(sprintId, spField);
    const current = calculateCapacity({
      unit,
      start: sprint.startDate ?? plan?.periodStart,
      end: sprint.endDate ?? plan?.periodEnd,
      today: today(),
      config,
      ...holidayInputs(holidays, plan?.teamHolidays),
      leaves,
      overrides: plan?.overrides,
      items,
      settings,
    });
    const committed = current.totals.allocated + current.totals.unassignedAllocated;

    const members = current.members
      .filter((m) => m.inTemplate)
      .map((m): ForecastMember => {
        const cal = calibrateMember(samples.get(m.accountId) ?? []);
        const bias = unit === 'hours' ? cal.estimateBias : null;
        return {
          accountId: m.accountId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
          configuredFocus: m.focus,
          ...cal,
          totalCapacity: m.totalCapacity,
          allocated: m.allocated,
          riskAdjusted: bias !== null ? m.allocated * bias : null,
        };
      });

    return {
      unit,
      generatedAt: nowIso(),
      history: history.sort((a, b) => a.end.localeCompare(b.end)),
      velocity: velocityForecast(history, current.totals.totalCapacity, committed),
      capacity: current.totals.totalCapacity,
      committed,
      members,
      warnings,
    };
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
    async getWorkspace(p: { boardId: number; sprintId: number; templateId?: string }): Promise<Workspace> {
      const settings = await getSettings();
      const [sprint, plan, holidays, leaves, spField] = await Promise.all([
        ctx.jira.sprint(Number(p.sprintId)),
        ctx.store.get<SprintPlan>(K.plan(Number(p.sprintId))),
        ctx.store.list<Holiday>('hol:'),
        ctx.store.list<Leave>('leave:'),
        storyPointsField(Number(p.boardId), settings),
      ]);
      const [items, tpl, plans] = await Promise.all([
        ctx.jira.sprintIssues(sprint.id, spField),
        plan ? ctx.store.get<Template>(K.template(plan.templateId)) : Promise.resolve(undefined),
        ctx.store.list<SprintPlan>('plan:'),
      ]);
      const commitments = otherCommitments(plans, { sprintId: sprint.id, start: sprint.startDate ?? plan?.periodStart, end: sprint.endDate ?? plan?.periodEnd });
      // Members of the plan, plus the chosen template (Overview estimates from a template when there is no plan).
      const extra = !plan && p.templateId ? await ctx.store.get<Template>(K.template(p.templateId)) : undefined;
      const people = [...(plan?.config.members ?? []), ...(extra?.members ?? [])];
      const scope = await scopeToProject(Number(p.boardId), { ...(plan?.config ?? extra ?? DEFAULT_CONFIG), members: people });
      return {
        sprint,
        plan: plan ?? null,
        items,
        holidays,
        leaves,
        settings,
        storyPointsField: spField,
        templateVersion: tpl?.version,
        commitments,
        projectKey: scope.projectKey,
        hiddenMembers: scope.hidden.map((m) => ({ accountId: m.accountId, displayName: m.displayName })),
      };
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
        start: sprint.startDate ?? existing?.periodStart,
        end: sprint.endDate ?? existing?.periodEnd,
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
      const sprint = await ctx.jira.sprint(existing.sprintId).catch(() => undefined);
      const plan: SprintPlan = {
        ...existing,
        config: sanitiseConfig(config),
        teamHolidays: [...new Set(holidays)].sort(),
        overrides,
        periodStart: input.periodStart || undefined,
        periodEnd: input.periodEnd || undefined,
        start: sprint?.startDate ?? (input.periodStart || undefined),
        end: sprint?.endDate ?? (input.periodEnd || undefined),
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
    async saveHoliday(p: { id?: string; date: string; name: string; location?: string }) {
      const problems: string[] = [];
      if (!isDateStr(p?.date)) problems.push('Enter a valid holiday date.');
      const name = String(p?.name ?? '').trim();
      if (!name) problems.push('Holiday name is required.');
      if (name.length > 80) problems.push('Holiday name must be 80 characters or fewer.');
      const location = String(p?.location ?? '').trim() || undefined;
      if (location && location.length > 40) problems.push('Location must be 40 characters or fewer.');
      if (problems.length) throw new ValidationError(problems);
      const existing = await ctx.store.list<Holiday>('hol:');
      const clash = existing.find((h) => h.date === p.date && h.id !== p.id && locationKey(h.location) === locationKey(location));
      if (clash) throw new ValidationError([`There is already a${location ? ` ${location}` : ' company-wide'} holiday on ${p.date}.`]);
      const h: Holiday = { id: p.id || ctx.newId(), date: p.date, name, location };
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

    // ---- Forecast ----
    getForecast,

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
