# Capacity Planner for Jira — requirements, decisions and assumptions

## Sources reviewed (2026-10-30)

| Source | Access | Used for |
|---|---|---|
| RVS Confluence "Capacity Planner" (page 409272335) | Read (anonymous) | Feature list, navigation, workflow |
| RVS Confluence "How Capacity is calculated?" (414056451) | Read | Calculation rules |
| RVS Confluence User Settings / Global Settings / FAQ child pages | Read | Settings, column definitions, focus, template copy |
| Screenshots on page 409272335 (tracking, resource utilisation) | Viewed | Layout: selector rows, capacity type, working-day toggles, tabs, stacked bars + table |
| rvssoftek.com/products/capacity-planner-for-jira, rvsoftwares.in/cp | Not opened | Marketing pages; the functional docs and screenshots were sufficient. No vendor assets or code were reused. |

## Calculation rules implemented (documented behaviour takes precedence)

- Period = sprint start/end dates (UTC calendar dates). Future sprints without dates use a planning period set on the plan.
- Per-day capacity = capacity/day × focus; blank member values fall back to the template defaults (focus defaults to 1).
- Non-working weekdays, team holidays (company calendar + sprint-specific) and member leave are removed. Each date is classified once with precedence non-working > holiday > leave > day override, so nothing is double-counted.
- **Allocated work** = sum of Original Estimates (hours) or Story Points (points) of sprint issues assigned to the person.
- **Time spent** = sum of time spent on those issues. **Remaining work** = Jira remaining estimate, or original − spent (setting); zero when done (setting).
- **Remaining capacity** = per-day capacity summed from today to sprint end (vendor FAQ definition).
- **Balance** = total capacity − allocated (negative = over-allocated). Added because the brief defines "remaining = available − allocated"; both are shown and labelled.
- **Utilisation** = allocated ÷ capacity × 100; **resource utilisation** = time spent ÷ capacity × 100 (hours only). Zero capacity → shown as "—", never NaN/Infinity.
- Points: expected progress = allocated × elapsed-capacity share; actual = points of done issues.
- Hours and points are never mixed: a template has one unit; a report row whose template unit differs is rejected with a warning.
- Status: Overloaded > overload threshold (default 100%), Under-utilised < under threshold (default 70%), "No work" when nothing is allocated, "No capacity" when capacity is 0. Values are rounded to 6 dp before comparison so float drift (e.g. 8 × 0.8 × 10) doesn't flag exactly-full people.
- Sprint work assigned to people outside the template appears as a zero-capacity "Not in template" row; unassigned work is reported separately.

## Feature inventory and acceptance criteria

| Area | Acceptance criteria | Status |
|---|---|---|
| Overview | KPIs (members, capacity, allocated, balance, remaining, utilisation, overloaded, under-utilised), workload bars, role distribution, capacity-vs-allocated chart, needs-attention list, 30-day holidays/leave, empty states, data-loaded timestamp, warning when no saved plan | Done |
| Templates | Create/edit/duplicate/delete; Jira user picker; per-member role, capacity/day, focus; working days; unit; validation; timestamps; version number; admin-only restriction setting | Done |
| Template history | Applying a template snapshots it into the sprint plan; later edits bump the version and show a "re-apply" notice instead of rewriting old plans | Done |
| Capacity tracking | Project → board → sprint selection; apply template; daily grid with editable working days; holidays/leave/non-working shading; team holidays; per-sprint working days; planning period for undated sprints; totals; filter/sort/conflicts-only; keyboard navigation; save/discard; issue list | Done |
| Holidays & leave | Company holidays (date + name, duplicate-date check) and per-person leave ranges, applied to all plans | Done |
| Team members | Directory across templates with role, capacity, focus and upcoming leave | Done |
| Reports | Up to 6 sprints; tabs Team, Sprint, Team member, Roles, Resource utilisation (weekly worklog columns); per-row errors don't fail the report | Done |
| Saved reports | Save private/public snapshot (re-computed server-side), list visible reports, open, refresh snapshot, toggle visibility, delete (owner/admin only) | Done |
| CSV export | RFC 4180 with formula-injection guard; download with copy fallback if the iframe blocks downloads | Done (download path to verify in Jira) |
| Settings | Issue types counted, exclude completed sub-tasks, zero remaining on done, remaining-work mode, story point field override, thresholds, template permission; admin-only | Done |
| Jira writes | None. The app never edits Jira issues. | By design |

## Architecture

- **Forge** `jira:globalPage` (Apps menu → Capacity Planner, matching the vendor docs) with **Custom UI** (React 19 + Vite + TypeScript). In-app sidebar provides the eight sections, so there is one entry point.
- **Backend**: one resolver function; each resolver name maps to a method in `src/services/api.ts`. Services depend only on the `Store` and `JiraClient` ports (`src/services/ports.ts`), so the same code runs in Forge, unit tests and the local demo.
- **Calculation engine**: `src/shared/engine.ts`, pure functions shared by backend and frontend (the tracking grid recalculates live in the browser).
- **Storage**: Forge KVS (`@forge/kvs`). Keys: `tpl:`, `plan:{sprintId}`, `hol:`, `leave:`, `report:`, `settings`, `pref:{accountId}`. Saved report snapshots drop per-day detail and are capped at 200 KB.
- **Jira access**: all REST calls use `asUser()`, so people only see projects/boards/sprints/issues they're allowed to see. Story points field comes from the board's estimation configuration unless overridden in Settings.
- **Charts**: hand-written SVG (no charting dependency), each with an accessible label and legend.
- **Styling**: Atlassian design tokens with light fallbacks; `view.theme.enable()` follows Jira light/dark mode.

## Limits and assumptions

- Dates are UTC calendar dates; sprint timestamps are truncated to their UTC date.
- Up to 2,000 issues per sprint; weekly worklog breakdown reads worklogs for at most 150 issues with time logged (a warning is shown when truncated).
- Leave and holidays are global (not per project). Per-template working days and per-plan team holidays cover team-specific calendars.
- The "Search by: Sprint" mode is implemented; the vendor's fix-version search mode is not (not described in the functional docs).
- The original brief arrived truncated at section 5.5 ("Do not assume story points use the same custom field ID in every Jira…"); later sections were not available.
