import { useState } from 'react';
import { WEEKDAY_SHORT } from '../../../../src/shared/dates';
import { formatValue } from '../../../../src/shared/engine';
import type { Template, TemplateConfig, TemplateMember, Unit, Weekday } from '../../../../src/shared/types';
import { MAX_PER_DAY, validateTemplateInput } from '../../../../src/shared/validation';
import { call } from '../bridge';
import { UserPicker } from '../components/pickers';
import { Confirm, Empty, ErrorMessage, Field, Message, Modal, Segmented, Spinner, UnitBadge, Who } from '../components/ui';
import { formatDateTime, useApp, useAsync } from '../hooks';

type Draft = { id?: string; name: string; description: string; config: TemplateConfig };

const blank = (): Draft => ({
  name: '',
  description: '',
  config: { unit: 'hours', defaultCapacityPerDay: 8, defaultFocus: 1, workingDays: [1, 2, 3, 4, 5], members: [] },
});

/** Empty input = null (use the template default). */
const parseOptional = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export function WorkingDays({ value, onChange }: { value: Weekday[]; onChange: (d: Weekday[]) => void }) {
  return (
    <div className="days" role="group" aria-label="Working days">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
        const on = value.includes(d as Weekday);
        return (
          <button key={d} type="button" aria-pressed={on} aria-label={WEEKDAY_SHORT[d]} title={WEEKDAY_SHORT[d]} onClick={() => onChange((on ? value.filter((x) => x !== d) : [...value, d as Weekday]).sort())}>
            {WEEKDAY_SHORT[d][0]}
          </button>
        );
      })}
    </div>
  );
}

function TemplateEditor({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: (t: Template) => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const c = d.config;
  const setC = (patch: Partial<TemplateConfig>) => setD({ ...d, config: { ...c, ...patch } });
  const setMember = (i: number, patch: Partial<TemplateMember>) => setC({ members: c.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const problems = validateTemplateInput({ name: d.name, description: d.description, ...c });
  const unitLabel = c.unit === 'hours' ? 'hours' : 'points';

  const save = async () => {
    setTouched(true);
    if (problems.length) return;
    setSaving(true);
    setError(undefined);
    try {
      const payload = { name: d.name, description: d.description, config: c };
      const t = d.id ? await call('updateTemplate', { id: d.id, ...payload }) : await call('createTemplate', payload);
      onSaved(t);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={d.id ? 'Edit template' : 'Create template'}
      onClose={onClose}
      footer={
        <>
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </>
      }
    >
      {d.id && <Message>Saving creates a new template version. Sprint plans that already use this template keep their snapshot until you re-apply it.</Message>}
      <ErrorMessage error={error} />
      {touched && problems.length > 0 && (
        <Message tone="error" title="Please fix the following">
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Message>
      )}
      <div className="grid-2">
        <Field label="Template name" htmlFor="tpl-name">
          <input id="tpl-name" className="input" maxLength={80} value={d.name} aria-invalid={touched && !d.name.trim()} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field>
        <div className="field">
          <span className="label">Capacity unit</span>
          <Segmented<Unit>
            label="Capacity unit"
            value={c.unit}
            onChange={(unit) => setC({ unit, defaultCapacityPerDay: Math.min(c.defaultCapacityPerDay, MAX_PER_DAY[unit]) })}
            options={[
              ['hours', 'Hours'],
              ['points', 'Story points'],
            ]}
          />
        </div>
      </div>
      <Field label="Description (optional)" htmlFor="tpl-desc">
        <textarea id="tpl-desc" className="input" rows={2} maxLength={500} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
      <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
        <Field label={`Default capacity per day (${unitLabel})`} htmlFor="tpl-cap" help="Used when a member has no value of their own.">
          <input id="tpl-cap" className="input" type="number" min={0} max={MAX_PER_DAY[c.unit]} step={0.5} style={{ width: 120 }} value={c.defaultCapacityPerDay} onChange={(e) => setC({ defaultCapacityPerDay: Number(e.target.value) })} />
        </Field>
        <Field label="Default focus (0–1)" htmlFor="tpl-focus" help="Share of the day spent on sprint work.">
          <input id="tpl-focus" className="input" type="number" min={0} max={1} step={0.05} style={{ width: 120 }} value={c.defaultFocus} onChange={(e) => setC({ defaultFocus: Number(e.target.value) })} />
        </Field>
        <div className="field">
          <span className="label">Working days</span>
          <WorkingDays value={c.workingDays} onChange={(workingDays) => setC({ workingDays })} />
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3>Team members ({c.members.length})</h3>
        <div style={{ maxWidth: 360 }}>
          <UserPicker exclude={c.members.map((m) => m.accountId)} onPick={(u) => setC({ members: [...c.members, { accountId: u.accountId, displayName: u.displayName, avatarUrl: u.avatarUrl, role: '', capacityPerDay: null, focus: null }] })} />
        </div>
        {c.members.length === 0 ? (
          <p className="muted">Add the people whose capacity this template defines.</p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th className="num">Capacity / day</th>
                  <th className="num">Focus</th>
                  <th className="num">Effective / day</th>
                  <th>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.members.map((m, i) => {
                  const eff = (m.capacityPerDay ?? c.defaultCapacityPerDay) * (m.focus ?? c.defaultFocus);
                  return (
                    <tr key={m.accountId}>
                      <td>
                        <Who name={m.displayName} url={m.avatarUrl} />
                      </td>
                      <td>
                        <input className="input" style={{ width: 140 }} maxLength={60} placeholder="e.g. Developer" aria-label={`Role for ${m.displayName}`} value={m.role ?? ''} onChange={(e) => setMember(i, { role: e.target.value })} />
                      </td>
                      <td className="num">
                        <input className="input compact" type="number" min={0} max={MAX_PER_DAY[c.unit]} step={0.5} placeholder={String(c.defaultCapacityPerDay)} aria-label={`Capacity per day for ${m.displayName}`} value={m.capacityPerDay ?? ''} onChange={(e) => setMember(i, { capacityPerDay: parseOptional(e.target.value) })} />
                      </td>
                      <td className="num">
                        <input className="input compact" type="number" min={0} max={1} step={0.05} placeholder={String(c.defaultFocus)} aria-label={`Focus for ${m.displayName}`} value={m.focus ?? ''} onChange={(e) => setMember(i, { focus: parseOptional(e.target.value) })} />
                      </td>
                      <td className="num">{Number.isFinite(eff) ? formatValue(eff, c.unit) : '—'}</td>
                      <td>
                        <button className="btn subtle small" aria-label={`Remove ${m.displayName}`} onClick={() => setC({ members: c.members.filter((_, j) => j !== i) })}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Leave capacity or focus blank to use the template defaults.
        </p>
      </div>
    </Modal>
  );
}

export function Templates() {
  const { app, toast, navigate } = useApp();
  const list = useAsync(() => call('listTemplates'), []);
  const [editing, setEditing] = useState<Draft>();
  const [copying, setCopying] = useState<Template>();
  const [copyName, setCopyName] = useState('');
  const [deleting, setDeleting] = useState<Template>();
  const [error, setError] = useState<unknown>();
  const can = app.canEditTemplates;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(undefined);
    try {
      await fn();
      toast(done);
      list.reload();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Capacity templates</h1>
          <p>Define each person's capacity once and reuse it across sprints.</p>
        </div>
        {can && (
          <button className="btn primary" onClick={() => setEditing(blank())}>
            Create template
          </button>
        )}
      </div>
      {!can && <Message>Only Jira administrators can change templates on this site. You can still view and apply them.</Message>}
      <ErrorMessage error={error ?? list.error} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : list.data?.length === 0 ? (
        <div className="card">
          <Empty title="No templates yet" action={can && <button className="btn primary" onClick={() => setEditing(blank())}>Create your first template</button>}>
            A template lists team members, their capacity per day, focus and role.
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th className="num">Members</th>
                <th className="num">Default / day</th>
                <th className="num">Focus</th>
                <th>Working days</th>
                <th className="num">Version</th>
                <th>Last updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    {t.description && <div className="small muted">{t.description}</div>}
                  </td>
                  <td>
                    <UnitBadge unit={t.unit} />
                  </td>
                  <td className="num">{t.members.length}</td>
                  <td className="num">{formatValue(t.defaultCapacityPerDay, t.unit)}</td>
                  <td className="num">{t.defaultFocus}</td>
                  <td className="small">{t.workingDays.map((d) => WEEKDAY_SHORT[d]).join(', ')}</td>
                  <td className="num">v{t.version}</td>
                  <td className="small">{formatDateTime(t.updatedAt)}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn small" onClick={() => navigate('tracking', { templateId: t.id })}>
                        Apply to sprint
                      </button>
                      {can && (
                        <>
                          <button className="btn small" onClick={() => setEditing({ id: t.id, name: t.name, description: t.description ?? '', config: { unit: t.unit, defaultCapacityPerDay: t.defaultCapacityPerDay, defaultFocus: t.defaultFocus, workingDays: t.workingDays, members: t.members } })}>
                            Edit
                          </button>
                          <button
                            className="btn small"
                            onClick={() => {
                              setCopying(t);
                              setCopyName(`Copy of ${t.name}`.slice(0, 80));
                            }}
                          >
                            Duplicate
                          </button>
                          <button className="btn small subtle" onClick={() => setDeleting(t)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TemplateEditor
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(t) => {
            setEditing(undefined);
            toast(`Saved “${t.name}”`);
            list.reload();
          }}
        />
      )}
      {copying && (
        <Modal
          narrow
          title="Duplicate template"
          onClose={() => setCopying(undefined)}
          footer={
            <>
              <button className="btn subtle" onClick={() => setCopying(undefined)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!copyName.trim()}
                onClick={() => {
                  const src = copying;
                  setCopying(undefined);
                  run(() => call('duplicateTemplate', { id: src.id, name: copyName }), `Created “${copyName.trim()}”`);
                }}
              >
                Create copy
              </button>
            </>
          }
        >
          <Field label="New template name" htmlFor="copy-name">
            <input id="copy-name" className="input" maxLength={80} value={copyName} onChange={(e) => setCopyName(e.target.value)} />
          </Field>
        </Modal>
      )}
      {deleting && (
        <Confirm
          title={`Delete “${deleting.name}”?`}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => {
            const t = deleting;
            setDeleting(undefined);
            run(() => call('deleteTemplate', { id: t.id }), `Deleted “${t.name}”`);
          }}
        >
          Sprint plans created from this template keep their own copy, so past plans and reports are not affected.
        </Confirm>
      )}
    </div>
  );
}
