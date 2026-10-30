// Jira Cloud REST client. Every call runs asUser, so users only see projects, boards,
// sprints and issues their own Jira permissions allow.
import api, { route } from '@forge/api';
import { toDateStr } from '../shared/dates';
import type { SprintInfo, StatusCategory, WorkItem, WorklogEntry } from '../shared/types';
import type { JiraBoard, JiraClient, JiraProject, JiraUser } from '../services/ports';

type Route = ReturnType<typeof route>;

async function get<T>(path: Route): Promise<T> {
  const res = await api.asUser().requestJira(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join(' ') || body.message || '';
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Jira denied access (${res.status}). ${detail}`.trim());
    if (res.status === 404) throw new Error(`Not found in Jira. ${detail}`.trim());
    throw new Error(`Jira request failed (${res.status}). ${detail}`.trim());
  }
  return (await res.json()) as T;
}

const avatar = (urls?: Record<string, string>) => urls?.['48x48'] ?? urls?.['24x24'];

interface RawSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
}

function mapSprint(s: RawSprint, boardId?: number): SprintInfo {
  return {
    id: s.id,
    boardId: s.originBoardId ?? boardId ?? 0,
    name: s.name,
    state: (['active', 'future', 'closed'].includes(s.state) ? s.state : 'future') as SprintInfo['state'],
    startDate: toDateStr(s.startDate),
    endDate: toDateStr(s.endDate),
    completeDate: toDateStr(s.completeDate),
  };
}

const MAX_ISSUES = 2000;
const MAX_WORKLOG_ISSUES = 150;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const forgeJiraClient: JiraClient = {
  async myself() {
    const me = await get<{ accountId: string; displayName: string; avatarUrls?: Record<string, string> }>(route`/rest/api/3/myself`);
    return { accountId: me.accountId, displayName: me.displayName, avatarUrl: avatar(me.avatarUrls) };
  },

  async isAdmin() {
    const res = await get<{ permissions: Record<string, { havePermission: boolean }> }>(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
    return Boolean(res.permissions?.ADMINISTER?.havePermission);
  },

  async searchProjects(query) {
    const params = new URLSearchParams({ maxResults: '50', orderBy: 'name', query });
    const res = await get<{ values: { id: string; key: string; name: string; avatarUrls?: Record<string, string> }[] }>(route`/rest/api/3/project/search?${params}`);
    return res.values.map((p): JiraProject => ({ id: p.id, key: p.key, name: p.name, avatarUrl: avatar(p.avatarUrls) }));
  },

  async boardsForProject(projectKey) {
    const params = new URLSearchParams({ projectKeyOrId: projectKey, maxResults: '50' });
    const res = await get<{ values: { id: number; name: string; type: string; location?: { projectKey?: string } }[] }>(route`/rest/agile/1.0/board?${params}`);
    // Kanban boards have no sprints.
    return res.values.filter((b) => b.type !== 'kanban').map((b): JiraBoard => ({ id: b.id, name: b.name, type: b.type, projectKey: b.location?.projectKey }));
  },

  async sprintsForBoard(boardId) {
    const all: SprintInfo[] = [];
    for (let startAt = 0; startAt < 1000; startAt += 50) {
      const params = new URLSearchParams({ startAt: String(startAt), maxResults: '50' });
      const res = await get<{ values: RawSprint[]; isLast: boolean }>(route`/rest/agile/1.0/board/${boardId}/sprint?${params}`);
      all.push(...res.values.map((s) => mapSprint(s, boardId)));
      if (res.isLast || res.values.length === 0) break;
    }
    const rank = { active: 0, future: 1, closed: 2 } as const;
    const sorted = all.sort((a, b) => rank[a.state] - rank[b.state] || (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.id - a.id);
    // Keep every open sprint and the 30 most recent closed ones.
    return [...sorted.filter((s) => s.state !== 'closed'), ...sorted.filter((s) => s.state === 'closed').slice(0, 30)];
  },

  async sprint(sprintId) {
    return mapSprint(await get<RawSprint>(route`/rest/agile/1.0/sprint/${sprintId}`));
  },

  async boardEstimationField(boardId) {
    const cfg = await get<{ estimation?: { type?: string; field?: { fieldId?: string } } }>(route`/rest/agile/1.0/board/${boardId}/configuration`);
    const id = cfg.estimation?.field?.fieldId;
    return id && id.startsWith('customfield_') ? id : undefined;
  },

  async sprintIssues(sprintId, storyPointsField) {
    const fields = ['summary', 'assignee', 'status', 'issuetype', 'timeoriginalestimate', 'timeestimate', 'timespent', 'resolutiondate', 'statuscategorychangedate'];
    if (storyPointsField) fields.push(storyPointsField);
    const out: WorkItem[] = [];
    for (let startAt = 0; startAt < MAX_ISSUES; startAt += 100) {
      const params = new URLSearchParams({ startAt: String(startAt), maxResults: '100', fields: fields.join(',') });
      const res = await get<{ issues: { key: string; fields: Record<string, any> }[]; total: number }>(route`/rest/agile/1.0/sprint/${sprintId}/issue?${params}`);
      for (const { key, fields: f } of res.issues) {
        const category = f.status?.statusCategory?.key as string | undefined;
        const statusCategory: StatusCategory = category === 'done' ? 'done' : category === 'indeterminate' ? 'indeterminate' : 'new';
        const sp = storyPointsField ? f[storyPointsField] : null;
        out.push({
          key,
          summary: String(f.summary ?? ''),
          assigneeId: f.assignee?.accountId ?? null,
          assigneeName: f.assignee?.displayName ?? null,
          assigneeAvatar: avatar(f.assignee?.avatarUrls),
          issueType: f.issuetype?.name ?? 'Unknown',
          isSubtask: Boolean(f.issuetype?.subtask),
          status: f.status?.name ?? '',
          statusCategory,
          doneDate: statusCategory === 'done' ? toDateStr(f.resolutiondate ?? f.statuscategorychangedate) : undefined,
          originalEstimateSec: typeof f.timeoriginalestimate === 'number' ? f.timeoriginalestimate : null,
          remainingEstimateSec: typeof f.timeestimate === 'number' ? f.timeestimate : null,
          timeSpentSec: typeof f.timespent === 'number' ? f.timespent : null,
          storyPoints: typeof sp === 'number' && Number.isFinite(sp) ? sp : null,
        });
      }
      if (res.issues.length === 0 || startAt + res.issues.length >= res.total) break;
    }
    return out;
  },

  async worklogs(issueKeys, from, to) {
    const keys = issueKeys.slice(0, MAX_WORKLOG_ISSUES);
    const after = String(Date.parse(`${from}T00:00:00Z`));
    const before = String(Date.parse(`${to}T23:59:59Z`));
    const lists = await mapLimit(keys, 5, async (key) => {
      const params = new URLSearchParams({ startedAfter: after, startedBefore: before, maxResults: '1000' });
      const res = await get<{ worklogs: { author?: { accountId?: string }; started: string; timeSpentSeconds: number }[] }>(route`/rest/api/3/issue/${key}/worklog?${params}`);
      return res.worklogs
        .filter((w) => w.author?.accountId)
        .map((w): WorklogEntry => ({ authorId: w.author!.accountId!, started: toDateStr(w.started)!, timeSpentSec: w.timeSpentSeconds }));
    });
    return { entries: lists.flat(), truncated: issueKeys.length > keys.length };
  },

  async searchUsers(query, projectKey) {
    const params = new URLSearchParams({ query, maxResults: '50' });
    let users: { accountId: string; displayName: string; accountType?: string; active?: boolean; avatarUrls?: Record<string, string> }[];
    if (projectKey) {
      params.set('project', projectKey);
      users = await get(route`/rest/api/3/user/assignable/search?${params}`);
    } else {
      users = await get(route`/rest/api/3/user/search?${params}`);
    }
    return users
      .filter((u) => u.accountType === 'atlassian' && u.active !== false)
      .map((u): JiraUser => ({ accountId: u.accountId, displayName: u.displayName, avatarUrl: avatar(u.avatarUrls) }));
  },

  async issueTypes() {
    const types = await get<{ name: string }[]>(route`/rest/api/3/issuetype`);
    return [...new Set(types.map((t) => t.name))].sort();
  },
};
