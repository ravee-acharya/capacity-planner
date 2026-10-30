import { Fragment, useMemo, useState } from 'react';
import { formatPercent, formatValue, percent, type MemberCapacity } from '../../../../src/shared/engine';
import { rolesOf, type Report } from '../../../../src/shared/report';
import { formatDate, useApp } from '../hooks';
import { Donut, GroupedBars, PALETTE, UtilisationBars } from './charts';
import { Empty, Message, Meter, StatusLozenge, Tabs, UnitBadge, Who } from './ui';

type Tab = 'team' | 'sprint' | 'member' | 'roles' | 'utilisation';

interface Aggregate {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  role: string;
  rows: { sprint: string; m: MemberCapacity }[];
  totalCapacity: number;
  allocated: number;
  timeSpent: number;
  remainingCapacity: number;
  remainingWork: number;
}

function aggregate(report: Report): Aggregate[] {
  const map = new Map<string, Aggregate>();
  for (const s of report.sprints) {
    for (const m of s.result.members) {
      const a = map.get(m.accountId) ?? { accountId: m.accountId, displayName: m.displayName, avatarUrl: m.avatarUrl, role: m.role, rows: [], totalCapacity: 0, allocated: 0, timeSpent: 0, remainingCapacity: 0, remainingWork: 0 };
      a.rows.push({ sprint: s.sprint.name, m });
      a.totalCapacity += m.totalCapacity;
      a.allocated += m.allocated;
      a.timeSpent += m.timeSpent;
      a.remainingCapacity += m.remainingCapacity;
      a.remainingWork += m.remainingWork;
      map.set(m.accountId, a);
    }
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function ReportView({ report }: { report: Report }) {
  const { app } = useApp();
  const [tab, setTab] = useState<Tab>('team');
  const unit = report.unit;
  const f = (v: number | null) => formatValue(v, unit);
  const members = useMemo(() => aggregate(report), [report]);
  const [memberId, setMemberId] = useState<string>();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const multi = report.sprints.length > 1;

  if (report.sprints.length === 0) {
    return (
      <div className="stack">
        {report.errors.map((e) => (
          <Message key={e} tone="error">
            {e}
          </Message>
        ))}
        <Empty title="No sprint data">Add a sprint with a capacity plan or template and run the report.</Empty>
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ['team', 'Team'],
    ['sprint', 'Sprint'],
    ['member', 'Team member'],
    ['roles', 'Roles'],
    ['utilisation', 'Resource utilisation'],
  ];
  const selected = members.find((m) => m.accountId === memberId) ?? members[0];
  const warnings = [...new Set(report.sprints.flatMap((s) => s.result.warnings.map((w) => `${s.sprint.name}: ${w}`)))];

  return (
    <div className="stack">
      {report.errors.map((e) => (
        <Message key={e} tone="error">
          {e}
        </Message>
      ))}
      {warnings.length > 0 && (
        <Message tone="warning" title="Check these before relying on the numbers">
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Message>
      )}
      <div className="row between">
        <div className="row small muted">
          <UnitBadge unit={unit} /> Generated {new Date(report.generatedAt).toLocaleString()}
        </div>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Report views" />

      {tab === 'team' && (
        <div className="stack">
          <div className="card">
            <h3>Capacity vs allocated work</h3>
            <GroupedBars
              title="Capacity versus allocated work per team member"
              unit={unit}
              categories={members.map((m) => m.displayName)}
              series={[
                { key: 'cap', label: 'Total capacity', color: 'var(--chart-1)' },
                { key: 'alloc', label: 'Allocated work', color: 'var(--chart-4)' },
                ...(unit === 'hours' ? [{ key: 'spent', label: 'Time spent', color: 'var(--chart-2)' }] : []),
              ]}
              values={members.map((m) => [m.totalCapacity, m.allocated, ...(unit === 'hours' ? [m.timeSpent] : [])])}
            />
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Role</th>
                  <th className="num">Total capacity</th>
                  <th className="num">Allocated work</th>
                  {unit === 'hours' && <th className="num">Time spent</th>}
                  <th className="num">Remaining capacity</th>
                  <th className="num">Remaining work</th>
                  <th className="num">Balance</th>
                  <th>Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {members.map((a) => {
                  const u = percent(a.allocated, a.totalCapacity);
                  const open = expanded[a.accountId] ?? !multi;
                  return (
                    <Fragment key={a.accountId}>
                      <tr className={multi ? 'group' : undefined}>
                        <td>
                          {multi && (
                            <button className="btn subtle small" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${a.displayName}`} onClick={() => setExpanded({ ...expanded, [a.accountId]: !open })}>
                              {open ? '▾' : '▸'}
                            </button>
                          )}
                          <Who name={a.displayName} url={a.avatarUrl} note={a.rows.some((r) => !r.m.inTemplate) ? <span className="lozenge neutral">Not in template</span> : undefined} />
                        </td>
                        <td>{a.role}</td>
                        <td className="num">{f(a.totalCapacity)}</td>
                        <td className="num">{f(a.allocated)}</td>
                        {unit === 'hours' && <td className="num">{f(a.timeSpent)}</td>}
                        <td className="num">{f(a.remainingCapacity)}</td>
                        <td className="num">{f(a.remainingWork)}</td>
                        <td className="num" style={{ color: a.totalCapacity - a.allocated < 0 ? 'var(--danger-text)' : undefined }}>
                          {f(a.totalCapacity - a.allocated)}
                        </td>
                        <td>
                          <div className="cell-meter">
                            <Meter value={u} />
                            <span className="small num">{formatPercent(u)}</span>
                          </div>
                        </td>
                      </tr>
                      {multi &&
                        open &&
                        a.rows.map(({ sprint, m }) => (
                          <tr key={sprint}>
                            <td style={{ paddingLeft: 48 }}>{sprint}</td>
                            <td>
                              <StatusLozenge status={m.status} />
                            </td>
                            <td className="num">{f(m.totalCapacity)}</td>
                            <td className="num">{f(m.allocated)}</td>
                            {unit === 'hours' && <td className="num">{f(m.timeSpent)}</td>}
                            <td className="num">{f(m.remainingCapacity)}</td>
                            <td className="num">{f(m.remainingWork)}</td>
                            <td className="num">{f(m.balance)}</td>
                            <td className="small num">{formatPercent(m.utilization)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sprint' && (
        <div className="stack">
          <div className="card">
            <h3>Capacity by sprint</h3>
            <GroupedBars
              title="Capacity and allocation per sprint"
              unit={unit}
              categories={report.sprints.map((s) => s.sprint.name)}
              series={[
                { key: 'cap', label: 'Total capacity', color: 'var(--chart-1)' },
                { key: 'alloc', label: 'Allocated work', color: 'var(--chart-4)' },
                { key: 'rem', label: 'Remaining capacity', color: 'var(--chart-5)' },
              ]}
              values={report.sprints.map((s) => [s.result.totals.totalCapacity, s.result.totals.allocated, s.result.totals.remainingCapacity])}
            />
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th>Dates</th>
                  <th>Template</th>
                  <th className="num">Working days</th>
                  <th className="num">Members</th>
                  <th className="num">Total capacity</th>
                  <th className="num">Allocated</th>
                  <th className="num">Remaining capacity</th>
                  <th className="num">Unassigned work</th>
                  <th className="num">Utilisation</th>
                  <th className="num">Overloaded</th>
                </tr>
              </thead>
              <tbody>
                {report.sprints.map((s) => (
                  <tr key={s.sprint.id}>
                    <td>
                      {s.sprint.name} <span className="lozenge neutral">{s.sprint.state}</span>
                    </td>
                    <td className="nowrap">
                      {formatDate(s.result.start)} – {formatDate(s.result.end)}
                    </td>
                    <td>
                      {s.templateName} <span className="small muted">({s.source === 'plan' ? 'sprint plan' : 'template'})</span>
                    </td>
                    <td className="num">{s.result.workingDays}</td>
                    <td className="num">{s.result.totals.members}</td>
                    <td className="num">{f(s.result.totals.totalCapacity)}</td>
                    <td className="num">{f(s.result.totals.allocated)}</td>
                    <td className="num">{f(s.result.totals.remainingCapacity)}</td>
                    <td className="num">
                      {f(s.result.totals.unassignedAllocated)} <span className="small muted">({s.result.totals.unassignedCount})</span>
                    </td>
                    <td className="num">{formatPercent(s.result.totals.utilization)}</td>
                    <td className="num">{s.result.totals.overloaded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'member' && selected && (
        <div className="stack">
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="member-pick">Team member</label>
            <select id="member-pick" className="select" value={selected.accountId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.accountId} value={m.accountId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th className="num">Available days</th>
                  <th className="num">Capacity / day</th>
                  <th className="num">Focus</th>
                  <th className="num">Total capacity</th>
                  <th className="num">Allocated</th>
                  {unit === 'hours' && <th className="num">Time spent</th>}
                  <th className="num">Remaining capacity</th>
                  <th className="num">Remaining work</th>
                  {unit === 'points' && <th className="num">Expected / actual progress</th>}
                  <th>Status</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {selected.rows.map(({ sprint, m }) => (
                  <tr key={sprint}>
                    <td>{sprint}</td>
                    <td className="num">{m.availableDays}</td>
                    <td className="num">{f(m.capacityPerDay)}</td>
                    <td className="num">{m.focus}</td>
                    <td className="num">{f(m.totalCapacity)}</td>
                    <td className="num">{f(m.allocated)}</td>
                    {unit === 'hours' && <td className="num">{f(m.timeSpent)}</td>}
                    <td className="num">{f(m.remainingCapacity)}</td>
                    <td className="num">{f(m.remainingWork)}</td>
                    {unit === 'points' && (
                      <td className="num">
                        {f(m.expectedProgress)} / {f(m.actualProgress)}
                      </td>
                    )}
                    <td>
                      <StatusLozenge status={m.status} />
                    </td>
                    <td className="small">
                      {m.issueKeys.length ? m.issueKeys.join(', ') : <span className="muted">None</span>}
                      {m.unestimatedCount > 0 && <div className="muted">{m.unestimatedCount} without estimate</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="stack">
          {report.sprints.map((s) => {
            const roles = rolesOf(s.result);
            return (
              <div className="card" key={s.sprint.id}>
                <h3>{s.sprint.name}</h3>
                <div className="grid-2">
                  <Donut title={`Capacity by role for ${s.sprint.name}`} unit={unit} slices={roles.map((r, i) => ({ label: r.role, value: r.totalCapacity, color: PALETTE[i % PALETTE.length] }))} />
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>Role</th>
                          <th className="num">Members</th>
                          <th className="num">Capacity</th>
                          <th className="num">Allocated</th>
                          <th className="num">Balance</th>
                          <th className="num">Utilisation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roles.map((r) => (
                          <tr key={r.role}>
                            <td>{r.role}</td>
                            <td className="num">{r.members}</td>
                            <td className="num">{f(r.totalCapacity)}</td>
                            <td className="num">{f(r.allocated)}</td>
                            <td className="num">{f(r.balance)}</td>
                            <td className="num">{formatPercent(percent(r.allocated, r.totalCapacity))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'utilisation' &&
        (unit !== 'hours' ? (
          <Message>Resource utilisation compares logged time with capacity, so it is only available for hour-based reports.</Message>
        ) : (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Utilisation rate = time spent on assigned sprint issues ÷ total capacity. Weekly columns use worklogs recorded by each person during the sprint.
            </p>
            {report.sprints.map((s) => (
              <div className="card stack" key={s.sprint.id}>
                <h3>{s.sprint.name}</h3>
                {s.weekly?.truncated && <Message tone="warning">This sprint has many issues with logged time; weekly figures include only the first 150.</Message>}
                <UtilisationBars over={app.settings.overloadThreshold} under={app.settings.underThreshold} rows={s.result.members.map((m) => ({ label: m.displayName, value: m.spentUtilization }))} />
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Team member</th>
                        <th className="num">Total capacity</th>
                        <th className="num">Time spent</th>
                        <th className="num">Utilisation rate</th>
                        {s.weekly?.weeks.map((w) => (
                          <th key={w} className="num">
                            Week of {formatDate(w)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.result.members.map((m) => (
                        <tr key={m.accountId}>
                          <td>
                            <Who name={m.displayName} url={m.avatarUrl} />
                          </td>
                          <td className="num">{f(m.totalCapacity)}</td>
                          <td className="num">{f(m.timeSpent)}</td>
                          <td className="num">{formatPercent(m.spentUtilization)}</td>
                          {s.weekly?.weeks.map((w) => {
                            const cell = s.weekly!.byMember[m.accountId]?.[w];
                            return (
                              <td key={w} className="num" title={cell ? `${f(cell.spent)} logged of ${f(cell.capacity)}` : undefined}>
                                {cell ? formatPercent(percent(cell.spent, cell.capacity)) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
