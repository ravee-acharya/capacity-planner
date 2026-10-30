import { useEffect, useMemo, useState } from 'react';
import { expandRanges } from '../../../../src/shared/dates';
import { calculateCapacity, formatPercent, formatValue } from '../../../../src/shared/engine';
import { rolesOf } from '../../../../src/shared/report';
import { call } from '../bridge';
import { Donut, GroupedBars, PALETTE, UtilisationBars } from '../components/charts';
import { SprintPicker, TemplateSelect } from '../components/pickers';
import { Empty, ErrorMessage, Message, Spinner, Stat, StatusLozenge, UnitBadge, Who } from '../components/ui';
import { formatDate, formatDateTime, useApp, useAsync } from '../hooks';

export function Overview() {
  const { app, navigate, selection: sel, select } = useApp();
  const templateId = sel.templateId;
  const templates = useAsync(() => call('listTemplates'), []);
  const ws = useAsync(() => (sel.boardId && sel.sprintId ? call('getWorkspace', { boardId: sel.boardId, sprintId: sel.sprintId }) : Promise.resolve(undefined)), [sel.boardId, sel.sprintId]);
  const timeOff = useAsync(() => call('upcomingTimeOff', { days: 30 }), []);
  const [loadedAt, setLoadedAt] = useState<Date>();
  useEffect(() => {
    if (ws.data) setLoadedAt(new Date());
  }, [ws.data]);

  const plan = ws.data?.plan;
  const template = templates.data?.find((t) => t.id === templateId);
  const config = plan?.config ?? template;
  const result = useMemo(() => {
    if (!ws.data || !config) return undefined;
    const leaves: Record<string, string[]> = {};
    for (const l of ws.data.leaves) leaves[l.accountId] = [...(leaves[l.accountId] ?? []), ...expandRanges([l])];
    return calculateCapacity({
      unit: config.unit,
      start: ws.data.sprint.startDate ?? plan?.periodStart,
      end: ws.data.sprint.endDate ?? plan?.periodEnd,
      today: app.today,
      config,
      holidays: [...ws.data.holidays.map((h) => h.date), ...(plan?.teamHolidays ?? [])],
      leaves,
      overrides: plan?.overrides,
      items: ws.data.items,
      settings: ws.data.settings,
    });
  }, [ws.data, config, plan, app.today]);

  const unit = result?.unit ?? 'hours';
  const f = (v: number | null) => formatValue(v, unit);
  const s = ws.data?.settings ?? app.settings;
  const health = !result ? undefined : result.totals.overloaded > 0 ? 'danger' : (result.totals.utilization ?? 0) < s.underThreshold ? 'warning' : 'success';

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p>Capacity health for the selected sprint.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('tracking')}>
            Open capacity tracking
          </button>
          <button className="btn" onClick={() => navigate('reports')}>
            Detailed reports
          </button>
        </div>
      </div>

      <div className="toolbar">
        <SprintPicker value={sel} onChange={(v) => select(v, true)} />
        {!plan && <TemplateSelect templates={templates.data ?? []} value={templateId} onChange={(id) => select({ templateId: id })} />}
        <button className="btn subtle" onClick={ws.reload} disabled={!sel.sprintId || ws.loading}>
          ↻ Refresh
        </button>
      </div>
      <ErrorMessage error={ws.error} />

      {!sel.sprintId ? (
        <div className="card">
          <Empty title="Welcome to Capacity Planner" action={<button className="btn primary" onClick={() => navigate('templates')}>Set up a capacity template</button>}>
            Choose a project, board and sprint above. If you are new, start by creating a template with your team's daily capacity.
          </Empty>
        </div>
      ) : ws.loading && !ws.data ? (
        <Spinner label="Loading sprint data from Jira" />
      ) : ws.data && !config ? (
        <div className="card">
          <Empty title="No capacity plan for this sprint" action={<button className="btn primary" onClick={() => navigate('tracking')}>Plan this sprint</button>}>
            Apply a template in Capacity tracking, or pick a template above for a quick estimate.
          </Empty>
        </div>
      ) : result && ws.data ? (
        <>
          <div className="row small muted">
            <UnitBadge unit={unit} />
            <span>
              {ws.data.sprint.name} · {formatDate(result.start)} – {formatDate(result.end)} · {plan ? `sprint plan from “${plan.templateName}”` : `template “${template?.name}” (no saved sprint plan)`}
            </span>
            {loadedAt && <span>· Jira data loaded {formatDateTime(loadedAt.toISOString())}</span>}
          </div>
          {!plan && <Message tone="warning">This sprint has no saved plan, so sprint-specific holidays and day adjustments are not included.</Message>}
          {result.warnings.map((w) => (
            <Message key={w} tone="warning">
              {w}
            </Message>
          ))}
          <div className="stats">
            <Stat label="Team members" value={result.totals.members} hint={`${result.workingDays} working days`} />
            <Stat label="Available capacity" value={f(result.totals.totalCapacity)} />
            <Stat label="Planned (allocated)" value={f(result.totals.allocated)} hint={result.totals.unestimatedCount ? `${result.totals.unestimatedCount} unestimated issues` : `${result.totals.issueCount} issues`} />
            <Stat label="Balance" value={f(result.totals.balance)} tone={result.totals.balance < 0 ? 'danger' : undefined} hint="Capacity − allocated" />
            <Stat label="Remaining capacity" value={f(result.totals.remainingCapacity)} hint="Today to sprint end" />
            <Stat label="Utilisation" value={formatPercent(result.totals.utilization)} tone={health} hint={health === 'danger' ? 'Some people are overloaded' : health === 'warning' ? 'Team is under-utilised' : 'Healthy'} />
            <Stat label="Overloaded" value={result.totals.overloaded} tone={result.totals.overloaded ? 'danger' : undefined} hint={`> ${s.overloadThreshold}% utilised`} />
            <Stat label="Under-utilised" value={result.totals.underutilized} tone={result.totals.underutilized ? 'warning' : undefined} hint={`< ${s.underThreshold}% utilised`} />
          </div>

          <div className="grid-2">
            <div className="card">
              <h3>Team workload</h3>
              <UtilisationBars over={s.overloadThreshold} under={s.underThreshold} rows={result.members.map((m) => ({ label: m.displayName, value: m.utilization }))} />
              <p className="small muted">Dashed line = 100% of available capacity.</p>
            </div>
            <div className="card">
              <h3>Capacity distribution by role</h3>
              <Donut title="Capacity by role" unit={unit} slices={rolesOf(result).map((r, i) => ({ label: r.role, value: r.totalCapacity, color: PALETTE[i % PALETTE.length] }))} />
            </div>
          </div>

          <div className="card">
            <h3>Capacity vs allocated per person</h3>
            <GroupedBars
              title="Capacity versus allocated work per person"
              unit={unit}
              categories={result.members.map((m) => m.displayName)}
              series={[
                { key: 'cap', label: 'Available capacity', color: 'var(--chart-1)' },
                { key: 'alloc', label: 'Allocated work', color: 'var(--chart-4)' },
                { key: 'rem', label: 'Remaining capacity', color: 'var(--chart-5)' },
              ]}
              values={result.members.map((m) => [m.totalCapacity, m.allocated, m.remainingCapacity])}
            />
          </div>

          <div className="grid-2">
            <div className="card">
              <h3>Needs attention</h3>
              {result.members.filter((m) => m.status !== 'ok').length === 0 ? (
                <p className="muted">Everyone is within the balanced range.</p>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {result.members
                    .filter((m) => m.status !== 'ok')
                    .sort((a, b) => a.balance - b.balance)
                    .map((m) => (
                      <div key={m.accountId} className="row between">
                        <Who name={m.displayName} url={m.avatarUrl} />
                        <span className="row">
                          <span className="small muted">
                            {f(m.allocated)} of {f(m.totalCapacity)}
                          </span>
                          <StatusLozenge status={m.status} />
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="card">
              <h3>Upcoming holidays and leave (30 days)</h3>
              {timeOff.loading && !timeOff.data ? (
                <Spinner />
              ) : !timeOff.data || (timeOff.data.holidays.length === 0 && timeOff.data.leaves.length === 0) ? (
                <p className="muted">
                  Nothing scheduled.{' '}
                  <a href="#" onClick={(e) => (e.preventDefault(), navigate('holidays'))}>
                    Add holidays or leave
                  </a>
                </p>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {timeOff.data.holidays.map((h) => (
                    <div key={h.id} className="row between small">
                      <span>
                        <span className="lozenge info">Holiday</span> {h.name}
                      </span>
                      <span>{formatDate(h.date)}</span>
                    </div>
                  ))}
                  {timeOff.data.leaves.map((l) => (
                    <div key={l.id} className="row between small">
                      <span>
                        <span className="lozenge warning">Leave</span> {l.displayName}
                      </span>
                      <span>
                        {formatDate(l.from)} – {formatDate(l.to)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
