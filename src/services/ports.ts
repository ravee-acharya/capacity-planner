// Interfaces the services depend on. Forge implementations live in src/forge; the in-memory
// and fixture implementations in src/demo are used by tests and the local demo mode.
import type { SprintInfo, WorkItem, WorklogEntry } from '../shared/types';

export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** All values whose key starts with the prefix. */
  list<T>(prefix: string): Promise<T[]>;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrl?: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: string;
  projectKey?: string;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface JiraClient {
  myself(): Promise<JiraUser>;
  isAdmin(): Promise<boolean>;
  searchProjects(query: string): Promise<JiraProject[]>;
  boardsForProject(projectKey: string): Promise<JiraBoard[]>;
  sprintsForBoard(boardId: number): Promise<SprintInfo[]>;
  sprint(sprintId: number): Promise<SprintInfo>;
  /** Story point field id from the board's estimation configuration, if any. */
  boardEstimationField(boardId: number): Promise<string | undefined>;
  sprintIssues(sprintId: number, storyPointsField: string | undefined): Promise<WorkItem[]>;
  /** Worklogs logged within [from, to] on the given issues. `truncated` = not every issue was read. */
  worklogs(issueKeys: string[], from: string, to: string): Promise<{ entries: WorklogEntry[]; truncated: boolean }>;
  searchUsers(query: string, projectKey?: string): Promise<JiraUser[]>;
  /** Key of the project a board belongs to, if Jira reports one. */
  boardProject(boardId: number): Promise<string | undefined>;
  /** Which of the given accounts can be assigned issues in the project (Jira's notion of a project member). */
  projectMembers(projectKey: string, accountIds: string[]): Promise<Set<string>>;
  issueTypes(): Promise<string[]>;
}

export interface Ctx {
  accountId: string;
  jira: JiraClient;
  store: Store;
  /** Injected so tests are deterministic. */
  now: () => Date;
  newId: () => string;
}
