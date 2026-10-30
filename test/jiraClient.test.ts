import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake Jira: serves `total` projects/boards in pages of 50, like the real REST API.
const requests: string[] = [];
let total = 0;

vi.mock('@forge/api', () => {
  const route = (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce((s, part, i) => s + part + (i < values.length ? String(values[i]) : ''), '');
  const requestJira = async (path: string) => {
    requests.push(path);
    const url = new URL(path, 'https://jira.test');
    const startAt = Number(url.searchParams.get('startAt') ?? 0);
    const n = Math.max(0, Math.min(50, total - startAt));
    const values = url.pathname.includes('/board')
      ? Array.from({ length: n }, (_, i) => ({ id: startAt + i, name: `Board ${startAt + i}`, type: 'scrum' }))
      : Array.from({ length: n }, (_, i) => ({ id: String(startAt + i), key: `P${startAt + i}`, name: `Project ${startAt + i}` }));
    return { ok: true, status: 200, json: async () => ({ values, isLast: startAt + n >= total }) };
  };
  return { default: { asUser: () => ({ requestJira }) }, route };
});

const { forgeJiraClient } = await import('../src/forge/jiraClient');

describe('Jira pagination', () => {
  beforeEach(() => {
    requests.length = 0;
  });

  it('returns every project, not just the first page of 50', async () => {
    total = 120;
    const projects = await forgeJiraClient.searchProjects('');
    expect(projects).toHaveLength(120);
    expect(projects.at(-1)?.key).toBe('P119');
    expect(requests).toHaveLength(3);
  });

  it('stops after one request when everything fits on a page', async () => {
    total = 7;
    expect(await forgeJiraClient.searchProjects('')).toHaveLength(7);
    expect(requests).toHaveLength(1);
  });

  it('pages through boards too', async () => {
    total = 60;
    expect(await forgeJiraClient.boardsForProject('ROCK')).toHaveLength(60);
    expect(requests).toHaveLength(2);
  });
});
