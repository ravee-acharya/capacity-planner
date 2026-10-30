// DEMO MODE ONLY (dev server + ?demo). Runs the real service layer against fixture Jira data
// with an in-memory store that resets on reload.
import { fixtureJira } from '../../../src/demo/fixtureJira';
import { memoryStore } from '../../../src/demo/memoryStore';
import { createApi } from '../../../src/services/api';

export function createDemoApi() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const store = memoryStore({
    'tpl:demo-core': {
      id: 'demo-core',
      name: 'Core team (demo)',
      description: 'Sample template for the local demo.',
      unit: 'hours',
      defaultCapacityPerDay: 8,
      defaultFocus: 0.8,
      workingDays: [1, 2, 3, 4, 5],
      members: [
        { accountId: 'u-asha', displayName: 'Asha Rao', role: 'Developer', capacityPerDay: null, focus: null },
        { accountId: 'u-ben', displayName: 'Ben Carter', role: 'Developer', capacityPerDay: 8, focus: 0.5 },
        { accountId: 'u-chen', displayName: 'Chen Wei', role: 'QA', capacityPerDay: 6, focus: null },
        { accountId: 'u-dana', displayName: 'Dana Ortiz', role: 'Designer', capacityPerDay: null, focus: null },
        { accountId: 'u-eli', displayName: 'Eli Novak', role: 'QA', capacityPerDay: 4, focus: 1 },
      ],
      version: 1,
      createdAt: now,
      createdBy: 'u-asha',
      updatedAt: now,
      updatedBy: 'u-asha',
    },
  });
  let n = 0;
  return createApi({ accountId: 'u-asha', jira: fixtureJira(today), store, now: () => new Date(), newId: () => `demo-${Date.now()}-${++n}` });
}
