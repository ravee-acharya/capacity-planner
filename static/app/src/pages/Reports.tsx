import { useState } from 'react';
import type { Report, ReportParams, ReportRow } from '../../../../src/shared/report';
import type { Unit } from '../../../../src/shared/types';
import { call } from '../bridge';
import { ExportButton } from '../components/ExportButton';
import { SprintPicker, TemplateSelect } from '../components/pickers';
import { ReportView } from '../components/ReportView';
import { ErrorMessage, Field, Modal, Segmented, Spinner } from '../components/ui';
import { useApp, useAsync } from '../hooks';

type DraftRow = Partial<ReportRow> & { key: number };
let rowKey = 0;

export function Reports() {
  const { navState, toast, navigate, selection } = useApp();
  const preset = (navState as { params?: ReportParams } | undefined)?.params;
  const [unit, setUnit] = useState<Unit>(preset?.unit ?? 'hours');
  const [rows, setRows] = useState<DraftRow[]>(
    preset?.rows.map((r) => ({ ...r, key: ++rowKey })) ?? [{ key: ++rowKey, projectKey: selection.projectKey, boardId: selection.boardId, sprintId: selection.sprintId }],
  );
  const templates = useAsync(() => call('listTemplates'), []);
  const [report, setReport] = useState<Report>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState<{ name: string; description: string; visibility: 'private' | 'public' }>();

  const ready = rows.filter((r) => r.boardId && r.sprintId) as ReportRow[];
  const run = async () => {
    setRunning(true);
    setError(undefined);
    try {
      setReport(await call('computeReport', { unit, rows: ready.map(({ projectKey, boardId, sprintId, templateId }) => ({ projectKey, boardId, sprintId, templateId })) }));
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!saving || !report) return;
    setError(undefined);
    try {
      await call('saveReport', { ...saving, report });
      setSaving(undefined);
      toast(`Saved report “${saving.name.trim()}”`);
    } catch (e) {
      setError(e);
      setSaving(undefined);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>Compare capacity, allocation and utilisation across up to six sprints.</p>
        </div>
        {report && report.sprints.length > 0 && (
          <div className="row">
            <ExportButton report={report} name="capacity-report" />
            <button className="btn primary" onClick={() => setSaving({ name: '', description: '', visibility: 'private' })}>
              Save report
            </button>
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row between">
          <div className="field">
            <span className="label">Capacity type</span>
            <Segmented<Unit>
              label="Capacity type"
              value={unit}
              onChange={(u) => {
                setUnit(u);
                setReport(undefined);
              }}
              options={[
                ['hours', 'Hours'],
                ['points', 'Story points'],
              ]}
            />
          </div>
          <button className="btn subtle" onClick={() => navigate('saved')}>
            Open saved reports
          </button>
        </div>
        {rows.map((r, i) => (
          <div key={r.key} className="toolbar">
            <SprintPicker compact value={r} onChange={(v) => setRows(rows.map((x) => (x.key === r.key ? { ...x, ...v, sprintId: v.sprintId } : x)))} />
            <TemplateSelect templates={templates.data ?? []} unit={unit} value={r.templateId} onChange={(templateId) => setRows(rows.map((x) => (x.key === r.key ? { ...x, templateId } : x)))} allowNone="Use the sprint's plan" />
            {rows.length > 1 && (
              <button className="btn subtle" aria-label={`Remove sprint row ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="row between">
          <button className="btn" disabled={rows.length >= 6} onClick={() => setRows([...rows, { key: ++rowKey, projectKey: rows.at(-1)?.projectKey, boardId: rows.at(-1)?.boardId }])}>
            + Add sprint to compare
          </button>
          <button className="btn primary" disabled={ready.length === 0 || running} onClick={run}>
            {running ? 'Running…' : 'View report'}
          </button>
        </div>
      </div>

      <ErrorMessage error={error} />
      {running && !report && <Spinner label="Calculating capacity from Jira data" />}
      {report && <ReportView report={report} />}

      {saving && (
        <Modal
          narrow
          title="Save report"
          onClose={() => setSaving(undefined)}
          footer={
            <>
              <button className="btn subtle" onClick={() => setSaving(undefined)}>
                Cancel
              </button>
              <button className="btn primary" disabled={!saving.name.trim()} onClick={save}>
                Save
              </button>
            </>
          }
        >
          <Field label="Report name" htmlFor="rep-name">
            <input id="rep-name" className="input" maxLength={80} value={saving.name} onChange={(e) => setSaving({ ...saving, name: e.target.value })} />
          </Field>
          <Field label="Description (optional)" htmlFor="rep-desc">
            <textarea id="rep-desc" className="input" rows={2} maxLength={300} value={saving.description} onChange={(e) => setSaving({ ...saving, description: e.target.value })} />
          </Field>
          <div className="field">
            <span className="label">Visibility</span>
            <Segmented
              label="Visibility"
              value={saving.visibility}
              onChange={(visibility) => setSaving({ ...saving, visibility })}
              options={[
                ['private', 'Private – only me'],
                ['public', 'Public – everyone with app access'],
              ]}
            />
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            A snapshot of the current figures is saved, so the report can be compared later even after the sprint changes.
          </p>
        </Modal>
      )}
    </div>
  );
}
