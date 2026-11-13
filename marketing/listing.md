# Marketplace listing — Capacity Planner Pro (TheTechFreaks)

Ready-to-paste content for the Atlassian Marketplace listing. Screenshots (1840×900) and the 144×144 logo are in this folder.

## Basics

| Field | Value |
|---|---|
| App name | Capacity Planner Pro |
| Partner | TheTechFreaks (partner id 121489259) |
| Forge app id | `ari:cloud:ecosystem::app/718ce7a7-a898-4b1a-a491-be87498142cf` |
| Hosting | Cloud (Forge), Jira |
| Payment model | **Paid via Atlassian** |
| Support contact | support@sportscentral.biz |
| Privacy policy | https://ravee-acharya.github.io/capacity-planner/privacy-policy.html |
| End-user terms | Atlassian standard customizable end-user agreement |
| Logo | `logo-144.png` |

## Tagline (max ~80 characters)

Plan sprint capacity per person and forecast what your team will really deliver.

## Summary (max ~250 characters)

Capacity templates, a day-by-day planning grid, holidays and leave by location, and forecasts learned from your past sprints — measured focus, estimate accuracy and a delivery range — so sprint commitments match reality.

## Highlights

1. **Plan capacity day by day** — Reusable templates with capacity, focus, role and allocation per person; adjust any day, add holidays and leave, and see who is overloaded before the sprint starts.
   Screenshot: `2-capacity-tracking.png`
2. **Forecast from real history** — Learns each team's completion rate, each person's measured focus and estimate accuracy from past sprints, and tells you whether this sprint's commitment is comfortable, a stretch or unlikely.
   Screenshot: `3-forecast.png`
3. **Reports you can share** — Compare up to six sprints by team, sprint, person and role, track resource utilisation from worklogs, save private or public snapshots and export to CSV.
   Screenshot: `4-reports.png`

Additional screenshots: `1-overview.png`, `5-templates.png`.

## Description

Capacity Planner Pro turns Jira sprints into realistic plans.

**Capacity planning**
- Capacity templates per team: capacity per day, focus factor, role, location and allocation % per person.
- Day-by-day planning grid for each sprint with holidays, leave, non-working days and per-day adjustments.
- Company and location-specific holidays (for example India and USA calendars), individual leave.
- Instant view of total, allocated and remaining capacity, balance and utilisation, with overloaded and under-utilised people highlighted.
- Cross-team over-commitment warnings when someone's allocations across overlapping sprints exceed 100%.
- Hours (original estimates) or story points (detected from each board's estimation field).

**Forecasting**
- Capacity-adjusted velocity: a delivery range for this sprint based on what the team actually completed in recent sprints.
- Measured focus per person from worklogs, compared with the focus in your plan — apply it with one click.
- Estimate accuracy per person (time spent vs original estimate) and the likely actual effort of the current commitment.

**Reports**
- Team, sprint, team member, role and resource-utilisation views across up to six sprints.
- Save reports as private or public snapshots; export to CSV.

**Built for trust**
- Reads Jira only with each user's own permissions; never changes your issues.
- Runs on Atlassian Forge with no outbound network access from its backend.
- Shows only people who belong to the sprint's Jira project.

## Pricing (Paid via Atlassian, monthly)

| Users | Price |
|---|---|
| Up to 10 users | USD 5.00 / month flat |
| 11–100 users | USD 0.50 / user / month |
| 101–1,000 users | USD 0.30 / user / month |
| 1,000+ users | USD 0.18 / user / month |

## Scope justifications (asked at submission)

| Scope | Why it is needed |
|---|---|
| `read:jira-work` | Read sprint issues (estimates, time spent, status, assignee) and worklogs to calculate allocation, remaining work, utilisation and forecasts. |
| `read:issue-details:jira` | Read issue fields used in calculations (type, status category, resolution/status-change dates, story points). |
| `read:jql:jira` | Required by the Jira Software sprint-issues API used to list a sprint's issues. |
| `read:project:jira` | List projects the user can see so they can pick one. |
| `read:board-scope:jira-software` | List a project's boards. |
| `read:board-scope.admin:jira-software` | Read the board configuration to find the board's story point (estimation) field. |
| `read:sprint:jira-software` | List sprints and read their dates. |
| `read:jira-user` | Search users for templates, show names/avatars, check project membership (assignable users), check Jira-admin status for settings, and refresh names for personal data reporting. |
| `storage:app` | Store templates, sprint plans, holidays, leave, saved reports, settings and per-user preferences. |

Remote hosts: **none** for the backend (no egress permissions). The front end loads avatar images only from Atlassian (`*.atlassian.net`, `*.atl-paas.net`) and `secure.gravatar.com`, exactly as Jira does; no data is sent other than the standard image request.

## Privacy & Security tab — answers

| Question | Answer |
|---|---|
| Does the app store personal data? | Yes — Atlassian account IDs and display names (templates, plans, leave, saved reports, preferences) and free-text leave notes. |
| Where is data stored? | Atlassian-hosted Forge storage (KVS) for the customer's site. No external storage. |
| Is data shared with third parties? | No. |
| Does the app transfer data outside Atlassian? | No. Backend has no egress; avatar images are loaded by the browser from Atlassian/Gravatar. |
| Personal data reporting (GDPR) | Implemented: weekly scheduled trigger reports all stored account IDs via the Forge privacy API; closed accounts are erased, updated profiles refreshed. |
| Data retention | Until deleted in the app or the app is uninstalled (Forge storage is deleted on uninstall). |
| Logging | Error messages only; no issue content, capacity data or names are logged deliberately. |
| Data residency | Inherits Forge hosting; all data stays in Forge storage. |
| Authentication | Atlassian (Forge); all Jira calls made as the signed-in user. |
| Encryption | Provided by Atlassian Forge (in transit and at rest). |

## Before submitting

- [ ] Replace the privacy-policy contact placeholder and remove its "review before publishing" banner after legal review.
- [ ] Confirm pricing tiers above (the payment model is hard to change later).
- [ ] Partner admin: accept the Marketplace listing terms, complete the security questionnaire and business/payout verification.
- [ ] Test the paid edition in its **development** environment only — production installs are billed.
