import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { expandRanges, isDateStr, weekday, WEEKDAY_SHORT } from '../../../../src/shared/dates';
import { allocatedOf, calculateCapacity, formatPercent, formatValue, isCounted, type MemberCapacity } from '../../../../src/shared/engine';
import type { SprintPlan } from '../../../../src/shared/types';
import { MAX_PER_DAY } from '../../../../src/shared/validation';
import { call } from '../bridge';
import { SprintPicker, TemplateSelect } from '../components/pickers';
import { Empty, ErrorMessage, Field, Message, Meter, Spinner, Stat, StatusLozenge, UnitBadge, Who } from '../components/ui';
import { formatDate, useApp, useAsync } from '../hooks';
import { WorkingDays } from './Templates';

type SortKey = 'name' | 'utilization' | 'balance' | 'role';

export function Tracking() {
  const { app, navState, toast, navigate, selection: sel, select } = useApp();
  const nav = (navState ?? {}) as { templateId?: string };
  const templates = useAsync(() => call('listTemplates'), []);
  const templateId = sel.templateId;
  const setTemplateId = (id?: string) => select({ templateId: id });
  useEffect(() => {
    if (nav.templateId) select({ templateId: nav.templateId });
  }, [nav.templateId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ws = useAsync(() => (sel.boardId && sel.sprintId ? call('getWorkspace', { boardId: sel.boardId, sprintId: sel.sprintId }) : Promise.resolve(undefined)), [sel.boardId, sel.sprintId]);
  const [draft, setDraft] = useState<SprintPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState('');
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [sort, setSort] = useState<SortKey>('name');
  const [newHoliday, setNewHoliday] = useState('');

  useEffect(() => setDraft(ws.data?.plan ? structuredClone(ws.data.plan) : null), [ws.data]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(ws.data?.plan ?? null), [draft, ws.data]);

  const result = useMemo(() => {
    if (!ws.data || !draft) return undefined;
    const { sprint, items, holidays, leaves, settings } = ws.data;
    const byMember: Record<string, string[]> = {};
    for (const l of leaves) byMember[l.accountId] = [...(byMember[l.accountId] ?? []), ...expandRanges([l])];
    return calculateCapacity({
      unit: draft.config.unit,
      start: sprint.startDate ?? draft.periodStart,
      end: sprint.endDate ?? draft.periodEnd,
      today: app.today,
      config: draft.config,
      holidays: [...holidays.map((h) => h.date), ...draft.teamHolidays],
      leaves: byMember,
      overrides: draft.overrides,
      items,
      settings,
    });
  }, [ws.data, draft, app.today]);

  const holidayNames = useMemo(() => {
    const m = new Map<string, string>();
    ws.data?.holidays.forEach((h) => m.set(h.date, h.name));
    draft?.teamHolidays.forEach((d) => m.set(d, m.get(d) ?? 'Team holiday'));
    return m;
  }, [ws.data, draft]);

  const rows = useMemo(() => {
    if (!result) return [];
    const q = filter.trim().toLowerCase();
    const list = result.members.filter((m) => (!q || m.displayName.toLowerCase().includes(q)) && (!role || m.role === role) && (!onlyConflicts || m.status === 'over' || m.status === 'under' || m.status === 'idle' || !m.inTemplate));
    const cmp: Record<SortKey, (a: MemberCapacity, b: MemberCapacity) => number> = {
      name: (a, b) => a.displayName.localeCompare(b.displayName),
      role: (a, b) => a.role.localeCompare(b.role) || a.displayName.localeCompare(b.displayName),
      utilization: (a, b) => (b.utilization ?? -1) - (a.utilization ?? -1),
      balance: (a, b) => a.balance - b.balance,
    };
    return [...list].sort(cmp[sort]);
  }, [result, filter, role, onlyConflicts, sort]);

  const apply = async (id = templateId) => {
    if (!sel.boardId || !sel.sprintId || !id) return;
    setBusy(true);
    setError(undefined);
    try {
      await call('applyTemplate', { boardId: sel.boardId, sprintId: sel.sprintId, templateId: id });
      toast('Template applied to the sprint');
      ws.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(undefined);
    try {
      const plan = await call('savePlan', { plan: draft });
      ws.setData({ ...ws.data!, plan });
      toast('Capacity plan saved');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const setOverride = (accountId: string, date: string, raw: string, perDay: number) => {
    if (!draft) return;
    const overrides = structuredClone(draft.overrides);
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value) || Math.abs(value - perDay) < 1e-9) delete overrides[accountId]?.[date];
    else (overrides[accountId] ??= {})[date] = Math.max(0, Math.min(MAX_PER_DAY[draft.config.unit], value));
    if (overrides[accountId] && Object.keys(overrides[accountId]).length === 0) delete overrides[accountId];
    setDraft({ ...draft, overrides });
  };

  const gridKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] };
    if (e.altKey || e.ctrlKey) Object.assign(moves, { ArrowLeft: [0, -1], ArrowRight: [0, 1] });
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    for (let step = 1; step < 60; step++) {
      const next = document.querySelector<HTMLInputElement>(`input[data-r="${r + mv[0] * step}"][data-c="${c + mv[1] * step}"]`);
      if (next) {
        next.focus();
        next.select();
        return;
      }
      if (mv[1] === 0) return;
    }
  };

  const unit = draft?.config.unit ?? 'hours';
  const f = (v: number | null) => formatValue(v, unit);
  const tpl = templates.data?.find((t) => t.id === draft?.templateId);
  const sprint = ws.data?.sprint;
  const hasDates = Boolean(sprint?.startDate && sprint?.endDate);
  const roles = [...new Set(result?.members.map((m) => m.role) ?? [])].sort();
  const counted = ws.data && draft ? ws.data.items.filter((i) => isCounted(i, result?.start, ws.data!.settings)) : [];

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Capacity tracking</h1>
          <p>Plan each person's capacity day by day for a sprint and compare it with the work assigned in Jira.</p>
        </div>
        {draft && (
          <div className="row">
            {dirty && <span className="lozenge warning">Unsaved changes</span>}
            <button className="btn" disabled={!dirty || busy} onClick={() => setDraft(ws.data?.plan ? structuredClone(ws.data.plan) : null)}>
              Discard
            </button>
            <button className="btn primary" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        )}
      </div>

      <div className="toolbar">
        <SprintPicker value={sel} onChange={(v) => select(v, true)} />
        <button className="btn subtle" onClick={ws.reload} disabled={!sel.sprintId || ws.loading} title="Reload Jira data">
          ↻ Refresh
        </button>
      </div>

      <ErrorMessage error={error ?? ws.error} />

      {!sel.sprintId ? (
        <div className="card">
          <Empty title="Choose a sprint">Select a project, board and sprint to plan capacity.</Empty>
        </div>
      ) : ws.loading && !ws.data ? (
        <Spinner label="Loading sprint data from Jira" />
      ) : !ws.data ? null : !draft ? (
        <div className="card stack">
          <h3>Apply a capacity template to {sprint?.name}</h3>
          <p className="muted" style={{ margin: 0 }}>
            The template's members and capacity are copied into this sprint's plan. You can then adjust holidays and individual days.
          </p>
          {templates.data?.length === 0 ? (
            <Empty title="No templates yet" action={<button className="btn primary" onClick={() => navigate('templates')}>Create a template</button>} />
          ) : (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <TemplateSelect templates={templates.data ?? []} value={templateId} onChange={setTemplateId} />
              <button className="btn primary" disabled={!templateId || busy} onClick={() => void apply()}>
                Apply template
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="card stack">
            <div className="row between">
              <div className="row">
                <UnitBadge unit={unit} />
                <span>
                  Template <strong>{draft.templateName}</strong> <span className="muted">(v{draft.templateVersion})</span>
                </span>
                {sprint && <span className="muted">{hasDates ? `${formatDate(sprint.startDate)} – ${formatDate(sprint.endDate)}` : 'Sprint has no dates'}</span>}
              </div>
              <div className="row">
                <TemplateSelect templates={templates.data ?? []} value={templateId ?? draft.templateId} onChange={setTemplateId} label="Switch / re-apply template" />
                <button
                  className="btn"
                  style={{ alignSelf: 'flex-end' }}
                  disabled={busy || dirty}
                  title={dirty ? 'Save or discard your changes first' : 'Copy the latest template into this sprint plan'}
                  onClick={() => void apply(templateId ?? draft.templateId)}
                >
                  Re-apply
                </button>
              </div>
            </div>
            {ws.data.templateVersion !== undefined && ws.data.templateVersion > draft.templateVersion && (
              <Message tone="warning">
                “{draft.templateName}” has changed since it was applied (v{draft.templateVersion} → v{ws.data.templateVersion}). This plan still uses the earlier snapshot; re-apply to pick up the changes. Daily overrides for remaining members are kept.
              </Message>
            )}
            {!tpl && templates.data && <Message tone="warning">The template this plan came from has been deleted. The plan keeps its own copy.</Message>}
            {unit === 'points' && !ws.data.storyPointsField && <Message tone="warning">No story point field was found for this board. Set one in Settings so allocations can be calculated.</Message>}
            <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
              <div className="field">
                <span className="label">Working days</span>
                <WorkingDays value={draft.config.workingDays} onChange={(workingDays) => setDraft({ ...draft, config: { ...draft.config, workingDays } })} />
              </div>
              <div className="field">
                <span className="label">Team holidays for this sprint</span>
                <div className="row">
                  <input
                    type="date"
                    className="input"
                    aria-label="Team holiday date"
                    value={newHoliday}
                    min={result?.start ?? undefined}
                    max={result?.end ?? undefined}
                    onChange={(e) => setNewHoliday(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={!isDateStr(newHoliday) || draft.teamHolidays.includes(newHoliday)}
                    onClick={() => {
                      setDraft({ ...draft, teamHolidays: [...draft.teamHolidays, newHoliday].sort() });
                      setNewHoliday('');
                    }}
                  >
                    Add
                  </button>
                </div>
                <div className="chips">
                  {draft.teamHolidays.map((d) => (
                    <span className="chip" key={d}>
                      {formatDate(d)}
                      <button aria-label={`Remove holiday ${d}`} onClick={() => setDraft({ ...draft, teamHolidays: draft.teamHolidays.filter((x) => x !== d) })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              {!hasDates && (
                <>
                  <Field label="Planning period start" htmlFor="ps">
                    <input id="ps" type="date" className="input" value={draft.periodStart ?? ''} onChange={(e) => setDraft({ ...draft, periodStart: e.target.value || undefined })} />
                  </Field>
                  <Field label="Planning period end" htmlFor="pe">
                    <input id="pe" type="date" className="input" value={draft.periodEnd ?? ''} onChange={(e) => setDraft({ ...draft, periodEnd: e.target.value || undefined })} />
                  </Field>
                </>
              )}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Company-wide holidays and individual leave are managed under{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), navigate('holidays'))}>
                Holidays &amp; leave
              </a>{' '}
              and apply automatically.
            </p>
          </div>

          {result && (
            <>
              <div className="stats">
                <Stat label="Total capacity" value={f(result.totals.totalCapacity)} hint={`${result.workingDays} working days`} />
                <Stat label="Allocated work" value={f(result.totals.allocated)} hint={`${result.totals.issueCount} issues counted`} />
                <Stat label="Balance" value={f(result.totals.balance)} tone={result.totals.balance < 0 ? 'danger' : 'success'} hint="Capacity − allocated" />
                <Stat label="Remaining capacity" value={f(result.totals.remainingCapacity)} hint="From today to sprint end" />
                <Stat label="Utilisation" value={formatPercent(result.totals.utilization)} tone={(result.totals.utilization ?? 0) > ws.data.settings.overloadThreshold ? 'danger' : undefined} />
                <Stat label="Overloaded" value={result.totals.overloaded} tone={result.totals.overloaded ? 'danger' : undefined} hint={`${result.totals.underutilized} under-utilised`} />
              </div>
              {result.warnings.map((w) => (
                <Message key={w} tone="warning">
                  {w}
                </Message>
              ))}
              {(result.totals.unassignedCount > 0 || result.totals.unestimatedCount > 0) && (
                <Message>
                  {result.totals.unassignedCount > 0 && `${result.totals.unassignedCount} issue(s) totalling ${f(result.totals.unassignedAllocated)} are unassigned. `}
                  {result.totals.unestimatedCount > 0 && `${result.totals.unestimatedCount} issue(s) have no ${unit === 'hours' ? 'original estimate' : 'story points'} and count as zero.`}
                </Message>
              )}

              <div className="row between">
                <div className="row">
                  <input className="input" placeholder="Filter by name" aria-label="Filter team members" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <select className="select" aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">All roles</option>
                    {roles.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <select className="select" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    <option value="name">Sort: name</option>
                    <option value="role">Sort: role</option>
                    <option value="utilization">Sort: utilisation (high first)</option>
                    <option value="balance">Sort: balance (most over first)</option>
                  </select>
                  <label className="check">
                    <input type="checkbox" checked={onlyConflicts} onChange={(e) => setOnlyConflicts(e.target.checked)} /> Only conflicts
                  </label>
                </div>
                <div className="legend">
                  <span><i style={{ background: 'var(--bg)' }} />Planned</span>
                  <span><i style={{ background: 'var(--info)' }} />Adjusted day</span>
                  <span><i style={{ background: 'var(--discovery)' }} />Holiday</span>
                  <span><i style={{ background: 'var(--warning)' }} />Leave</span>
                  <span><i className="nonworking" style={{ background: 'repeating-linear-gradient(135deg, var(--hatch) 0 3px, transparent 3px 6px)' }} />Non-working</span>
                </div>
              </div>

              {result.dates.length === 0 ? (
                <div className="card">
                  <Empty title="No planning period">{hasDates ? 'The sprint dates are invalid.' : 'This sprint has no dates yet. Set a planning period above.'}</Empty>
                </div>
              ) : (
                <div className="table-wrap" style={{ maxHeight: '70vh' }}>
                  <table className="t grid-plan">
                    <thead>
                      <tr>
                        <th className="sticky">Team member</th>
                        <th>Role</th>
                        {result.dates.map((d) => (
                          <th key={d} className={`day${holidayNames.has(d) ? ' holiday' : ''}${d === app.today ? ' today' : ''}`} title={holidayNames.get(d)}>
                            {d.slice(8)}/{d.slice(5, 7)}
                            <span className="dow">{WEEKDAY_SHORT[weekday(d)]}</span>
                          </th>
                        ))}
                        <th className="num">Days</th>
                        <th className="num">Capacity</th>
                        <th className="num">Allocated</th>
                        <th className="num">Balance</th>
                        <th className="num">Remaining cap.</th>
                        <th>Utilisation</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m, r) => {
                        const perDay = m.capacityPerDay * m.focus;
                        return (
                          <tr key={m.accountId}>
                            <td className="sticky">
                              <Who name={m.displayName} url={m.avatarUrl} note={!m.inTemplate ? <span className="lozenge neutral" title="Has sprint work but is not in the template">Not in template</span> : undefined} />
                            </td>
                            <td className="small">{m.role}</td>
                            {m.days.map((d, c) =>
                              d.kind === 'working' && m.inTemplate ? (
                                <td key={d.date} className={`day${d.overridden ? ' overridden' : ''}${d.date === app.today ? ' today' : ''}`}>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    max={MAX_PER_DAY[unit]}
                                    step={unit === 'hours' ? 0.5 : 0.25}
                                    data-r={r}
                                    data-c={c}
                                    aria-label={`${m.displayName}, ${d.date}, planned ${unit}`}
                                    value={Math.round(d.capacity * 100) / 100}
                                    onChange={(e) => setOverride(m.accountId, d.date, e.target.value, perDay)}
                                    onKeyDown={gridKeys}
                                    onFocus={(e) => e.currentTarget.select()}
                                  />
                                </td>
                              ) : (
                                <td key={d.date} className={`day ${d.kind}`} title={d.kind === 'holiday' ? holidayNames.get(d.date) : d.kind === 'leave' ? 'On leave' : d.kind === 'nonworking' ? 'Non-working day' : undefined}>
                                  <span className="small">{d.kind === 'holiday' ? 'H' : d.kind === 'leave' ? 'L' : d.kind === 'nonworking' ? '' : '0'}</span>
                                </td>
                              ),
                            )}
                            <td className="num">{m.availableDays}</td>
                            <td className="num">{f(m.totalCapacity)}</td>
                            <td className="num">
                              {f(m.allocated)}
                              {m.unestimatedCount > 0 && (
                                <span className="small muted" title={`${m.unestimatedCount} issue(s) without estimate`}>
                                  {' '}
                                  +{m.unestimatedCount}?
                                </span>
                              )}
                            </td>
                            <td className="num" style={{ color: m.balance < 0 ? 'var(--danger-text)' : undefined, fontWeight: m.balance < 0 ? 600 : undefined }}>
                              {m.balance < 0 ? `Over ${f(-m.balance)}` : f(m.balance)}
                            </td>
                            <td className="num">{f(m.remainingCapacity)}</td>
                            <td>
                              <div className="cell-meter">
                                <Meter value={m.utilization} over={ws.data!.settings.overloadThreshold} under={ws.data!.settings.underThreshold} />
                                <span className="small num">{formatPercent(m.utilization)}</span>
                              </div>
                            </td>
                            <td>
                              <StatusLozenge status={m.status} />
                            </td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={result.dates.length + 9} className="muted">
                            No team members match the filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="total">
                        <td className="sticky">Team total</td>
                        <td />
                        {result.dates.map((d) => (
                          <td key={d} className="day small num">
                            {formatValue(result.members.reduce((s, m) => s + (m.days.find((x) => x.date === d)?.capacity ?? 0), 0), unit).replace(' pts', '')}
                          </td>
                        ))}
                        <td />
                        <td className="num">{f(result.totals.totalCapacity)}</td>
                        <td className="num">{f(result.totals.allocated)}</td>
                        <td className="num">{f(result.totals.balance)}</td>
                        <td className="num">{f(result.totals.remainingCapacity)}</td>
                        <td className="small num">{formatPercent(result.totals.utilization)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="small muted" style={{ margin: 0 }}>
                Edit a day to plan reduced or extra capacity; clear it to return to the default (capacity/day × focus). Use ↑/↓ or Enter to move between rows, Ctrl+←/→ to move between days. Editing the plan never changes Jira issues.
              </p>

              <details className="card">
                <summary>
                  <strong>Sprint issues ({counted.length} counted of {ws.data.items.length})</strong>
                </summary>
                <div className="table-wrap" style={{ marginTop: 12, maxHeight: 400 }}>
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Summary</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Assignee</th>
                        <th className="num">{unit === 'hours' ? 'Original estimate' : 'Story points'}</th>
                        <th className="num">Time spent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {counted.map((i) => (
                        <tr key={i.key}>
                          <td className="nowrap">{i.key}</td>
                          <td>{i.summary}</td>
                          <td className="small">{i.issueType}</td>
                          <td className="small">{i.status}</td>
                          <td className="small">{i.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                          <td className="num">{allocatedOf(i, unit) === null ? <span className="muted">None</span> : f(allocatedOf(i, unit))}</td>
                          <td className="num">{formatValue((i.timeSpentSec ?? 0) / 3600, 'hours')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}
