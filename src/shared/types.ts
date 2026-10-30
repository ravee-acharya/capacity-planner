// Domain types shared by the Forge backend and the Custom UI frontend.

/** Capacity unit. Hours and story points are never mixed in one calculation. */
export type Unit = 'hours' | 'points';

/** Calendar date in YYYY-MM-DD form. All date maths is done on these, in UTC. */
export type DateStr = string;

/** 0 = Sunday ... 6 = Saturday (JavaScript getUTCDay convention). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TemplateMember {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  role?: string;
  /** Capacity per working day in the template's unit. null = use the template default. */
  capacityPerDay: number | null;
  /** Fraction of the day spent on sprint work (0..1). null = use the template default. */
  focus: number | null;
}

export interface TemplateConfig {
  unit: Unit;
  defaultCapacityPerDay: number;
  defaultFocus: number;
  workingDays: Weekday[];
  members: TemplateMember[];
}

export interface Template extends TemplateConfig {
  id: string;
  name: string;
  description?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Holiday {
  id: string;
  date: DateStr;
  name: string;
}

export interface Leave {
  id: string;
  accountId: string;
  displayName: string;
  from: DateStr;
  to: DateStr;
  note?: string;
}

/**
 * Capacity plan for one sprint. Holds a snapshot of the template taken when it was applied,
 * so later template edits never silently rewrite a past plan.
 */
export interface SprintPlan {
  sprintId: number;
  boardId: number;
  sprintName: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  config: TemplateConfig;
  /** Holidays specific to this sprint's team, on top of the global holiday calendar. */
  teamHolidays: DateStr[];
  /** Planned capacity for a member on a specific working day, overriding capacityPerDay * focus. */
  overrides: Record<string, Record<DateStr, number>>;
  /** Used when the sprint has no start/end dates (future sprints). */
  periodStart?: DateStr;
  periodEnd?: DateStr;
  updatedAt: string;
  updatedBy: string;
}

export type RemainingMode = 'remaining' | 'original';

export interface Settings {
  /** Issue type names counted towards allocation. Empty = all types. */
  issueTypes: string[];
  excludeSubtasksDoneBeforeStart: boolean;
  zeroRemainingOnDone: boolean;
  /** 'remaining' = Jira remaining estimate; 'original' = original estimate - time spent. */
  remainingMode: RemainingMode;
  /** Utilisation (%) above which a member is overloaded. */
  overloadThreshold: number;
  /** Utilisation (%) below which a member is under-utilised. */
  underThreshold: number;
  restrictTemplatesToAdmins: boolean;
  /** Optional story point field id; when empty the board's estimation field is used. */
  storyPointsFieldId?: string;
}

export type StatusCategory = 'new' | 'indeterminate' | 'done';

/** A Jira issue reduced to what capacity calculations need. */
export interface WorkItem {
  key: string;
  summary: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar?: string;
  issueType: string;
  isSubtask: boolean;
  status: string;
  statusCategory: StatusCategory;
  doneDate?: DateStr;
  originalEstimateSec: number | null;
  remainingEstimateSec: number | null;
  timeSpentSec: number | null;
  storyPoints: number | null;
}

export interface SprintInfo {
  id: number;
  boardId: number;
  name: string;
  state: 'active' | 'future' | 'closed';
  startDate?: DateStr;
  endDate?: DateStr;
  completeDate?: DateStr;
}

export interface WorklogEntry {
  authorId: string;
  started: DateStr;
  timeSpentSec: number;
}
