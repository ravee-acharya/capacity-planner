import { useMemo, useState } from 'react';
import { formatValue } from '../../../../src/shared/engine';
import type { Unit } from '../../../../src/shared/types';
import { call } from '../bridge';
import { Empty, ErrorMessage, Spinner, Who } from '../components/ui';
import { formatDate, useApp, useAsync } from '../hooks';

interface Row {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  memberships: { template: string; unit: Unit; role?: string; perDay: number; focus: number }[];
}

/** Directory of everyone in any template, with their roles, capacity and upcoming leave. */
export function TeamMembers() {
  const { app, navigate } = useApp();
  const templates = useAsync(() => call('listTemplates'), []);
  const leaves = useAsync(() => call('listLeaves'), []);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const t of templates.data ?? []) {
      for (const m of t.members) {
        const r = map.get(m.accountId) ?? { accountId: m.accountId, displayName: m.displayName, avatarUrl: m.avatarUrl, memberships: [] };
        r.memberships.push({ template: t.name, unit: t.unit, role: m.role, perDay: m.capacityPerDay ?? t.defaultCapacityPerDay, focus: m.focus ?? t.defaultFocus });
        map.set(m.accountId, r);
      }
    }
    const needle = q.trim().toLowerCase();
    return [...map.values()]
      .filter((r) => !needle || r.displayName.toLowerCase().includes(needle) || r.memberships.some((m) => m.role?.toLowerCase().includes(needle)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [templates.data, q]);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Team members</h1>
          <p>Everyone included in a capacity template, with their roles, daily capacity and upcoming leave.</p>
        </div>
        <div className="row">
          <input className="input" placeholder="Search name or role" aria-label="Search team members" value={q} onChange={(e) => setQ(e.target.value)} />
          {app.canEditTemplates && (
            <button className="btn" onClick={() => navigate('templates')}>
              Manage in templates
            </button>
          )}
        </div>
      </div>
      <ErrorMessage error={templates.error ?? leaves.error} />
      {templates.loading && !templates.data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty title={q ? 'No matches' : 'No team members yet'}>{q ? 'Try another search.' : 'Add people to a capacity template to see them here.'}</Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Team member</th>
                <th>Template</th>
                <th>Role</th>
                <th className="num">Capacity / day</th>
                <th className="num">Focus</th>
                <th className="num">Effective / day</th>
                <th>Upcoming leave</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const upcoming = (leaves.data ?? []).filter((l) => l.accountId === r.accountId && l.to >= app.today);
                return r.memberships.map((m, i) => (
                  <tr key={`${r.accountId}-${i}`}>
                    {i === 0 && (
                      <td rowSpan={r.memberships.length}>
                        <Who name={r.displayName} url={r.avatarUrl} />
                      </td>
                    )}
                    <td>{m.template}</td>
                    <td>{m.role || <span className="muted">—</span>}</td>
                    <td className="num">{formatValue(m.perDay, m.unit)}</td>
                    <td className="num">{m.focus}</td>
                    <td className="num">{formatValue(m.perDay * m.focus, m.unit)}</td>
                    {i === 0 && (
                      <td rowSpan={r.memberships.length} className="small">
                        {upcoming.length === 0 ? <span className="muted">None</span> : upcoming.map((l) => <div key={l.id}>{`${formatDate(l.from)} – ${formatDate(l.to)}`}</div>)}
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
