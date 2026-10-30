# Capacity Planner for Jira

Forge Custom UI app for sprint capacity planning: capacity templates, a day-by-day planning grid, holidays and leave, multi-sprint reports, saved public/private reports and CSV export. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the calculation rules, feature inventory and design decisions.

## Layout

```
manifest.yml               Forge app: jira:globalPage + resolver function
src/index.ts               Resolver wiring (Forge entry point)
src/services/api.ts        All resolver logic, written against ports
src/services/ports.ts      Store / JiraClient interfaces
src/forge/                 Forge implementations (Jira REST asUser, KVS)
src/shared/                Engine, dates, validation, CSV, report types (used by UI too)
src/demo/                  Fixture Jira + in-memory store (tests and local demo only)
static/app/                React UI (Vite) -> static/app/dist
test/                      Vitest unit tests
```

## Develop

```bash
npm install
npm run check        # typecheck + tests + production UI build
npm run dev          # UI on http://localhost:3000 - open /?demo for fixture data
```

Demo mode only exists in the dev server (`?demo`); it is compiled out of production builds.

## Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs typecheck, tests and the UI build on every push and pull request. Pushes to `main` then run `forge lint` and `forge deploy -e development`.

One-time setup in GitHub → Settings → Secrets and variables → Actions (or on a `development` environment): add `FORGE_EMAIL` and `FORGE_API_TOKEN` (a Forge CLI API token). Without them the deploy job is skipped with a warning.

The app must be installed on the site once (below). Later deploys update it in place; run `forge install --upgrade` only after changing scopes in `manifest.yml`.

## Deploy manually (development environment)

```bash
forge login
forge register "Capacity Planner for Jira"   # first time only; writes the app id into manifest.yml
npm run deploy                                # build + forge deploy -e development
forge install --site dashtech.atlassian.net --product jira -e development
```

After a scope change in `manifest.yml`, run `forge install --upgrade ...` as well. Open it from Jira's **Apps → Capacity Planner**.
