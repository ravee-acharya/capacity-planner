// DEMO MODE ONLY (dev server + ?demo). Runs the real service layer against fixture Jira data
// with an in-memory store that resets on reload.
import { fixtureJira } from '../../../src/demo/fixtureJira';
import { memoryStore } from '../../../src/demo/memoryStore';
import { createApi } from '../../../src/services/api';
import { addDays, weekStart } from '../../../src/shared/dates';

export function createDemoApi() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const monday = weekStart(today);
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
        { accountId: 'u-asha', displayName: 'Asha Rao', role: 'Developer', capacityPerDay: null, focus: null, location: 'India' },
        { accountId: 'u-ben', displayName: 'Ben Carter', role: 'Developer', capacityPerDay: 8, focus: 0.5, allocation: 60, location: 'USA' },
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
    // Another team's plan for the same fortnight that also uses Ben at 60%, to show over-commitment.
    'plan:900': {
      sprintId: 900,
      boardId: 2,
      sprintName: 'WEB Sprint 7',
      templateId: 'demo-web',
      templateName: 'Web team (demo)',
      templateVersion: 1,
      config: {
        unit: 'hours',
        defaultCapacityPerDay: 8,
        defaultFocus: 0.8,
        workingDays: [1, 2, 3, 4, 5],
        members: [{ accountId: 'u-ben', displayName: 'Ben Carter', role: 'Developer', capacityPerDay: 8, focus: 0.8, allocation: 60 }],
      },
      teamHolidays: [],
      overrides: {},
      start: monday,
      end: addDays(monday, 11),
      updatedAt: now,
      updatedBy: 'u-ben',
    },
    'hol:demo-diwali': { id: 'demo-diwali', date: addDays(monday, 3), name: 'Regional festival', location: 'India' },
  });
  let n = 0;
  return createApi({ accountId: 'u-asha', jira: fixtureJira(today), store, now: () => new Date(), newId: () => `demo-${Date.now()}-${++n}` });
}
