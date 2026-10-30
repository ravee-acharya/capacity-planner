import { useEffect, useState } from 'react';
import type { Settings } from '../../../../src/shared/types';
import { validateSettings } from '../../../../src/shared/validation';
import { call } from '../bridge';
import { ErrorMessage, Field, Message, Spinner } from '../components/ui';
import { useApp, useAsync } from '../hooks';

export function SettingsPage({ onSaved }: { onSaved: () => void }) {
  const { app, toast } = useApp();
  const settings = useAsync(() => call('getSettings'), []);
  const issueTypes = useAsync(() => call('getIssueTypes').catch(() => [] as string[]), []);
  const [s, setS] = useState<Settings>();
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  useEffect(() => setS(settings.data), [settings.data]);
  const ro = !app.isAdmin;

  if (!s) return settings.error ? <ErrorMessage error={settings.error} /> : <Spinner />;
  const problems = validateSettings(s);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings.data);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      settings.setData(await call('saveSettings', s));
      toast('Settings saved');
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Site-wide rules for how capacity and allocation are calculated.</p>
        </div>
        {!ro && (
          <button className="btn primary" disabled={!dirty || saving || problems.length > 0} onClick={save}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </div>
      {ro && <Message>Only Jira administrators can change these settings.</Message>}
      <ErrorMessage error={error} />
      {problems.length > 0 && (
        <Message tone="error">
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Message>
      )}
      <fieldset className="card stack" disabled={ro} style={{ border: 0 }}>
        <h3>Which work counts</h3>
        <div className="field">
          <span className="label">Count these issue types (none selected = all types)</span>
          <div className="chips">
            {(issueTypes.data ?? []).map((t) => (
              <label key={t} className="check chip" style={{ paddingRight: 8 }}>
                <input type="checkbox" checked={s.issueTypes.includes(t)} onChange={(e) => setS({ ...s, issueTypes: e.target.checked ? [...s.issueTypes, t] : s.issueTypes.filter((x) => x !== t) })} />
                {t}
              </label>
            ))}
            {issueTypes.loading && <span className="muted small">Loading issue types…</span>}
          </div>
          <span className="help">Teams that estimate stories should exclude sub-tasks, and vice-versa, so work is not counted twice.</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.excludeSubtasksDoneBeforeStart} onChange={(e) => setS({ ...s, excludeSubtasksDoneBeforeStart: e.target.checked })} />
          Exclude sub-tasks completed before the sprint started
        </label>
        <label className="check">
          <input type="checkbox" checked={s.zeroRemainingOnDone} onChange={(e) => setS({ ...s, zeroRemainingOnDone: e.target.checked })} />
          Treat remaining work as zero once an issue is done
        </label>
        <Field label="Remaining work (hours) is calculated from" htmlFor="rem-mode">
          <select id="rem-mode" className="select" value={s.remainingMode} onChange={(e) => setS({ ...s, remainingMode: e.target.value as Settings['remainingMode'] })}>
            <option value="remaining">Jira remaining estimate</option>
            <option value="original">Original estimate − time spent</option>
          </select>
        </Field>
        <Field label="Story point field (optional)" htmlFor="sp-field" help="Leave blank to use each board's estimation field. Example: customfield_10016.">
          <input id="sp-field" className="input" style={{ maxWidth: 240 }} value={s.storyPointsFieldId ?? ''} onChange={(e) => setS({ ...s, storyPointsFieldId: e.target.value.trim() || undefined })} />
        </Field>
      </fieldset>
      <fieldset className="card stack" disabled={ro} style={{ border: 0 }}>
        <h3>Capacity health</h3>
        <div className="row" style={{ gap: 24 }}>
          <Field label="Overloaded above (%)" htmlFor="over">
            <input id="over" type="number" className="input" style={{ width: 120 }} min={1} max={1000} value={s.overloadThreshold} onChange={(e) => setS({ ...s, overloadThreshold: Number(e.target.value) })} />
          </Field>
          <Field label="Under-utilised below (%)" htmlFor="under">
            <input id="under" type="number" className="input" style={{ width: 120 }} min={0} max={1000} value={s.underThreshold} onChange={(e) => setS({ ...s, underThreshold: Number(e.target.value) })} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="card stack" disabled={ro} style={{ border: 0 }}>
        <h3>Permissions</h3>
        <label className="check">
          <input type="checkbox" checked={s.restrictTemplatesToAdmins} onChange={(e) => setS({ ...s, restrictTemplatesToAdmins: e.target.checked })} />
          Only Jira administrators can create, edit or delete capacity templates
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          Everyone with access to the app can plan sprints and save reports. Jira data is always read with each user's own permissions.
        </p>
      </fieldset>
    </div>
  );
}
