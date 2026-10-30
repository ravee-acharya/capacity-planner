import { useState } from 'react';
import type { SavedReport, SavedReportSummary } from '../../../../src/shared/report';
import { call } from '../bridge';
import { ExportButton } from '../components/ExportButton';
import { ReportView } from '../components/ReportView';
import { Confirm, Empty, ErrorMessage, Message, Spinner, UnitBadge } from '../components/ui';
import { formatDateTime, useApp, useAsync } from '../hooks';

export function SavedReports() {
  const { app, toast, navigate } = useApp();
  const list = useAsync(() => call('listSavedReports'), []);
  const [open, setOpen] = useState<SavedReport>();
  const [loadingId, setLoadingId] = useState<string>();
  const [deleting, setDeleting] = useState<SavedReportSummary>();
  const [error, setError] = useState<unknown>();
  const [filter, setFilter] = useState<'all' | 'mine' | 'public'>('all');

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(undefined);
    try {
      await fn();
      toast(done);
      list.reload();
    } catch (e) {
      setError(e);
    }
  };

  const view = async (id: string) => {
    setLoadingId(id);
    setError(undefined);
    try {
      setOpen(await call('getSavedReport', { id }));
    } catch (e) {
      setError(e);
    } finally {
      setLoadingId(undefined);
    }
  };

  if (open) {
    const mine = open.ownerId === app.user.accountId || app.isAdmin;
    return (
      <div className="stack">
        <div className="page-header">
          <div>
            <button className="btn subtle small" onClick={() => setOpen(undefined)}>
              ← Saved reports
            </button>
            <h1 style={{ marginTop: 8 }}>{open.name}</h1>
            <p>
              {open.description ? `${open.description} · ` : ''}
              {open.visibility === 'public' ? 'Public' : 'Private'} · by {open.ownerName} · snapshot from {formatDateTime(open.snapshot.generatedAt)}
            </p>
          </div>
          <div className="row">
            <ExportButton report={open.snapshot} name={open.name} />
            <button className="btn" onClick={() => navigate('reports', { params: open.params })}>
              Re-run with live data
            </button>
            {mine && (
              <button
                className="btn"
                onClick={async () => {
                  setError(undefined);
                  try {
                    setOpen(await call('updateSavedReport', { id: open.id, refresh: true }));
                    toast('Snapshot refreshed');
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Refresh snapshot
              </button>
            )}
          </div>
        </div>
        <Message>You are viewing a saved snapshot. Daily breakdowns are not stored in snapshots; re-run the report to see live data.</Message>
        <ErrorMessage error={error} />
        <ReportView report={open.snapshot} />
      </div>
    );
  }

  const shown = (list.data ?? []).filter((r) => filter === 'all' || (filter === 'mine' ? r.ownerId === app.user.accountId : r.visibility === 'public'));

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Saved reports</h1>
          <p>Your private reports and the public reports shared by your team.</p>
        </div>
        <select className="select" aria-label="Show reports" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All visible reports</option>
          <option value="mine">Created by me</option>
          <option value="public">Public</option>
        </select>
      </div>
      <ErrorMessage error={error ?? list.error} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div className="card">
          <Empty title="No saved reports" action={<button className="btn primary" onClick={() => navigate('reports')}>Create a report</button>}>
            Run a report and choose “Save report” to keep a snapshot here.
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Name</th>
                <th>Sprints</th>
                <th>Unit</th>
                <th>Visibility</th>
                <th>Owner</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const mine = r.ownerId === app.user.accountId || app.isAdmin;
                return (
                  <tr key={r.id}>
                    <td>
                      <button className="btn subtle" style={{ padding: 0, height: 'auto', color: 'var(--link)' }} onClick={() => view(r.id)}>
                        {r.name}
                      </button>
                      {r.description && <div className="small muted">{r.description}</div>}
                    </td>
                    <td className="small">{r.sprintNames.join(', ')}</td>
                    <td>
                      <UnitBadge unit={r.params.unit} />
                    </td>
                    <td>
                      <span className={`lozenge ${r.visibility === 'public' ? 'info' : 'neutral'}`}>{r.visibility}</span>
                    </td>
                    <td className="small">{r.ownerName}</td>
                    <td className="small">{formatDateTime(r.updatedAt)}</td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn small" disabled={loadingId === r.id} onClick={() => view(r.id)}>
                          {loadingId === r.id ? 'Opening…' : 'Open'}
                        </button>
                        {mine && (
                          <>
                            <button className="btn small" onClick={() => act(() => call('updateSavedReport', { id: r.id, visibility: r.visibility === 'public' ? 'private' : 'public' }), `“${r.name}” is now ${r.visibility === 'public' ? 'private' : 'public'}`)}>
                              Make {r.visibility === 'public' ? 'private' : 'public'}
                            </button>
                            <button className="btn small subtle" onClick={() => setDeleting(r)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {deleting && (
        <Confirm
          title={`Delete “${deleting.name}”?`}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => {
            const r = deleting;
            setDeleting(undefined);
            act(() => call('deleteSavedReport', { id: r.id }), `Deleted “${r.name}”`);
          }}
        >
          This removes the saved snapshot for everyone who can see it.
        </Confirm>
      )}
    </div>
  );
}
