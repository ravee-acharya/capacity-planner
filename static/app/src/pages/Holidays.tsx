import { useState } from 'react';
import { eachDate, isDateStr, weekday, WEEKDAY_SHORT } from '../../../../src/shared/dates';
import type { JiraUser } from '../../../../src/services/ports';
import { call } from '../bridge';
import { UserPicker } from '../components/pickers';
import { Empty, ErrorMessage, Field, Spinner, Who } from '../components/ui';
import { formatDate, useApp, useAsync } from '../hooks';

export function Holidays() {
  const { app, toast } = useApp();
  const holidays = useAsync(() => call('listHolidays'), []);
  const leaves = useAsync(() => call('listLeaves'), []);
  const [error, setError] = useState<unknown>();
  const [h, setH] = useState({ date: '', name: '' });
  const [who, setWho] = useState<JiraUser>();
  const [l, setL] = useState({ from: '', to: '', note: '' });
  const [showPast, setShowPast] = useState(false);

  const act = async (fn: () => Promise<unknown>, done: string, after: () => void) => {
    setError(undefined);
    try {
      await fn();
      toast(done);
      after();
    } catch (e) {
      setError(e);
    }
  };

  const hList = (holidays.data ?? []).filter((x) => showPast || x.date >= app.today);
  const lList = (leaves.data ?? []).filter((x) => showPast || x.to >= app.today);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Holidays &amp; leave</h1>
          <p>Company holidays apply to every sprint plan. Leave applies to one person across all plans. Each day is removed from capacity only once.</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past entries
        </label>
      </div>
      <ErrorMessage error={error} />
      <div className="grid-2">
        <div className="card stack">
          <h3>Company holidays</h3>
          <form
            className="row"
            style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              act(() => call('saveHoliday', h), `Added ${h.name.trim()}`, () => {
                setH({ date: '', name: '' });
                holidays.reload();
              });
            }}
          >
            <Field label="Date" htmlFor="h-date">
              <input id="h-date" type="date" className="input" required value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
            </Field>
            <Field label="Name" htmlFor="h-name">
              <input id="h-name" className="input" required maxLength={80} placeholder="e.g. Diwali" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
            </Field>
            <button className="btn primary" type="submit" disabled={!isDateStr(h.date) || !h.name.trim()}>
              Add holiday
            </button>
          </form>
          {holidays.loading && !holidays.data ? (
            <Spinner />
          ) : hList.length === 0 ? (
            <Empty title="No holidays">Add public or company holidays so they are excluded from capacity.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Holiday</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hList.map((x) => (
                    <tr key={x.id}>
                      <td className="nowrap">
                        {formatDate(x.date)} <span className="muted small">{WEEKDAY_SHORT[weekday(x.date)]}</span>
                      </td>
                      <td>{x.name}</td>
                      <td>
                        <button className="btn small subtle" aria-label={`Delete ${x.name}`} onClick={() => act(() => call('deleteHoliday', { id: x.id }), `Removed ${x.name}`, holidays.reload)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card stack">
          <h3>Team member leave</h3>
          <form
            className="stack"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!who) return;
              act(() => call('saveLeave', { accountId: who.accountId, displayName: who.displayName, ...l }), `Added leave for ${who.displayName}`, () => {
                setWho(undefined);
                setL({ from: '', to: '', note: '' });
                leaves.reload();
              });
            }}
          >
            {who ? (
              <div className="row">
                <Who name={who.displayName} url={who.avatarUrl} />
                <button type="button" className="btn small subtle" onClick={() => setWho(undefined)}>
                  Change
                </button>
              </div>
            ) : (
              <UserPicker label="Team member" onPick={setWho} />
            )}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="From" htmlFor="l-from">
                <input id="l-from" type="date" className="input" required value={l.from} onChange={(e) => setL({ ...l, from: e.target.value, to: l.to && l.to >= e.target.value ? l.to : e.target.value })} />
              </Field>
              <Field label="To" htmlFor="l-to">
                <input id="l-to" type="date" className="input" required min={l.from || undefined} value={l.to} onChange={(e) => setL({ ...l, to: e.target.value })} />
              </Field>
              <Field label="Note (optional)" htmlFor="l-note">
                <input id="l-note" className="input" maxLength={200} value={l.note} onChange={(e) => setL({ ...l, note: e.target.value })} />
              </Field>
            </div>
            <div>
              <button className="btn primary" type="submit" disabled={!who || !isDateStr(l.from) || !isDateStr(l.to) || l.to < l.from}>
                Add leave
              </button>
            </div>
          </form>
          {leaves.loading && !leaves.data ? (
            <Spinner />
          ) : lList.length === 0 ? (
            <Empty title="No leave recorded">Leave removes those days from the person's capacity in every sprint.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Dates</th>
                    <th className="num">Days</th>
                    <th>Note</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lList.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <Who name={x.displayName} />
                      </td>
                      <td className="nowrap">
                        {formatDate(x.from)} – {formatDate(x.to)}
                      </td>
                      <td className="num">{eachDate(x.from, x.to).length}</td>
                      <td className="small">{x.note}</td>
                      <td>
                        <button className="btn small subtle" aria-label={`Delete leave for ${x.displayName}`} onClick={() => act(() => call('deleteLeave', { id: x.id }), 'Leave removed', leaves.reload)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Calendar days are listed; weekends and holidays inside the range are not double-counted.
          </p>
        </div>
      </div>
    </div>
  );
}
