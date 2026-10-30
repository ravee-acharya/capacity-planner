// Fixture Jira data for unit tests and the local DEMO mode only. Never used in the deployed app.
import { addDays, weekStart } from '../shared/dates';
import type { SprintInfo, WorkItem, WorklogEntry } from '../shared/types';
import type { JiraClient, JiraUser } from '../services/ports';

export const DEMO_USERS: JiraUser[] = [
  { accountId: 'u-asha', displayName: 'Asha Rao' },
  { accountId: 'u-ben', displayName: 'Ben Carter' },
  { accountId: 'u-chen', displayName: 'Chen Wei' },
  { accountId: 'u-dana', displayName: 'Dana Ortiz' },
  { accountId: 'u-eli', displayName: 'Eli Novak' },
];

const H = 3600;

function item(key: string, assignee: JiraUser | null, est: number | null, spent: number, remaining: number | null, sp: number | null, cat: WorkItem['statusCategory'] = 'indeterminate', type = 'Story'): WorkItem {
  return {
    key,
    summary: `${type} ${key}`,
    assigneeId: assignee?.accountId ?? null,
    assigneeName: assignee?.displayName ?? null,
    issueType: type,
    isSubtask: type === 'Sub-task',
    status: cat === 'done' ? 'Done' : cat === 'new' ? 'To Do' : 'In Progress',
    statusCategory: cat,
    originalEstimateSec: est === null ? null : est * H,
    remainingEstimateSec: remaining === null ? null : remaining * H,
    timeSpentSec: spent * H,
    storyPoints: sp,
  };
}

/** Builds fixture data with sprint dates relative to `today` so demo screens always look current. */
export function fixtureJira(today: string, me: JiraUser = DEMO_USERS[0], admin = true): JiraClient {
  const [asha, ben, chen, dana, eli] = DEMO_USERS;
  const monday = weekStart(today);
  const sprints: SprintInfo[] = [
    { id: 101, boardId: 1, name: 'APP Sprint 12', state: 'closed', startDate: addDays(monday, -14), endDate: addDays(monday, -3) },
    { id: 102, boardId: 1, name: 'APP Sprint 13', state: 'active', startDate: monday, endDate: addDays(monday, 11) },
    { id: 103, boardId: 1, name: 'APP Sprint 14', state: 'future' },
  ];
  const issues: Record<number, WorkItem[]> = {
    101: [item('APP-1', asha, 30, 32, 0, 5, 'done'), item('APP-2', ben, 40, 38, 0, 8, 'done'), item('APP-3', chen, 20, 22, 0, 3, 'done')],
    102: [
      item('APP-10', asha, 24, 10, 14, 5),
      item('APP-11', asha, 40, 6, 34, 8),
      item('APP-12', ben, 16, 16, 0, 3, 'done'),
      item('APP-13', ben, 12, 2, 10, 2),
      item('APP-14', chen, 90, 12, 78, 13),
      item('APP-15', dana, 8, 0, 8, 1, 'new'),
      item('APP-16', eli, null, 0, null, null, 'new', 'Bug'),
      item('APP-17', null, 10, 0, 10, 2, 'new'),
      item('APP-18', { accountId: 'u-guest', displayName: 'Gita Sharma' }, 6, 1, 5, 1),
    ],
    103: [],
  };
  return {
    myself: async () => me,
    isAdmin: async () => admin,
    searchProjects: async (q) => [{ id: '1', key: 'APP', name: 'Mobile App' }, { id: '2', key: 'WEB', name: 'Web Platform' }].filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())),
    boardsForProject: async (key) => (key === 'APP' ? [{ id: 1, name: 'APP board', type: 'scrum', projectKey: 'APP' }] : []),
    sprintsForBoard: async (boardId) => (boardId === 1 ? sprints : []),
    sprint: async (id) => {
      const s = sprints.find((x) => x.id === id);
      if (!s) throw new Error('Not found in Jira.');
      return s;
    },
    boardEstimationField: async () => 'customfield_10016',
    sprintIssues: async (id) => structuredClone(issues[id] ?? []),
    worklogs: async (keys, from) => {
      const all = Object.values(issues).flat().filter((i) => keys.includes(i.key) && i.assigneeId);
      const entries: WorklogEntry[] = all.flatMap((i) => {
        const spent = i.timeSpentSec ?? 0;
        return [
          { authorId: i.assigneeId!, started: from, timeSpentSec: Math.round(spent / 2) },
          { authorId: i.assigneeId!, started: addDays(from, 7), timeSpentSec: spent - Math.round(spent / 2) },
        ];
      });
      return { entries, truncated: false };
    },
    searchUsers: async (q) => DEMO_USERS.filter((u) => u.displayName.toLowerCase().includes(q.toLowerCase())),
    issueTypes: async () => ['Bug', 'Story', 'Sub-task', 'Task'],
  };
}
