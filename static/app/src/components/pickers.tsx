import { useEffect, useId, useRef, useState } from 'react';
import type { JiraUser } from '../../../../src/services/ports';
import type { Template } from '../../../../src/shared/types';
import { call } from '../bridge';
import { formatDate, useAsync } from '../hooks';
import { Avatar } from './ui';

export interface SprintSelection {
  projectKey?: string;
  boardId?: number;
  sprintId?: number;
}

const STATE_LABEL = { active: 'Active', future: 'Future', closed: 'Closed' } as const;

/** Cascading Project → Board → Sprint selector backed by Jira. */
export function SprintPicker({ value, onChange, compact }: { value: SprintSelection; onChange: (v: SprintSelection) => void; compact?: boolean }) {
  const id = useId();
  const projects = useAsync(() => call('searchProjects', { query: '' }), []);
  const boards = useAsync(() => (value.projectKey ? call('getBoards', { projectKey: value.projectKey }) : Promise.resolve([])), [value.projectKey]);
  const sprints = useAsync(() => (value.boardId ? call('getSprints', { boardId: value.boardId }) : Promise.resolve([])), [value.boardId]);

  // Auto-select the only board, and the active sprint, to save clicks.
  useEffect(() => {
    if (value.projectKey && !value.boardId && boards.data?.length === 1) onChange({ ...value, boardId: boards.data[0].id });
  }, [boards.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (value.boardId && !value.sprintId && sprints.data?.length) {
      const active = sprints.data.find((s) => s.state === 'active') ?? sprints.data[0];
      onChange({ ...value, sprintId: active.id });
    }
  }, [sprints.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = compact ? { minWidth: 140 } : { minWidth: 180 };
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-p`}>Project</label>
        <select id={`${id}-p`} className="select" style={style} value={value.projectKey ?? ''} onChange={(e) => onChange({ projectKey: e.target.value || undefined })}>
          <option value="">{projects.loading ? 'Loading…' : projects.error ? 'Could not load projects' : 'Select project'}</option>
          {projects.data?.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name} ({p.key})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-b`}>Board</label>
        <select id={`${id}-b`} className="select" style={style} disabled={!value.projectKey} value={value.boardId ?? ''} onChange={(e) => onChange({ projectKey: value.projectKey, boardId: Number(e.target.value) || undefined })}>
          <option value="">{boards.loading && value.projectKey ? 'Loading…' : boards.data?.length === 0 && value.projectKey ? 'No scrum boards' : 'Select board'}</option>
          {boards.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-s`}>Sprint</label>
        <select id={`${id}-s`} className="select" style={style} disabled={!value.boardId} value={value.sprintId ?? ''} onChange={(e) => onChange({ ...value, sprintId: Number(e.target.value) || undefined })}>
          <option value="">{sprints.loading && value.boardId ? 'Loading…' : sprints.data?.length === 0 && value.boardId ? 'No sprints' : 'Select sprint'}</option>
          {(['active', 'future', 'closed'] as const).map((state) => {
            const list = sprints.data?.filter((s) => s.state === state) ?? [];
            return list.length ? (
              <optgroup key={state} label={STATE_LABEL[state]}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.startDate ? ` (${formatDate(s.startDate)} – ${formatDate(s.endDate)})` : ''}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </div>
    </>
  );
}

export function TemplateSelect({ templates, value, onChange, unit, label = 'Template', allowNone }: { templates: Template[]; value?: string; onChange: (id?: string) => void; unit?: 'hours' | 'points'; label?: string; allowNone?: string }) {
  const id = useId();
  const list = unit ? templates.filter((t) => t.unit === unit) : templates;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" style={{ minWidth: 180 }} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{allowNone ?? 'Select template'}</option>
        {list.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.unit === 'hours' ? 'hours' : 'points'})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Searchable Jira user picker (assignable users of a project when one is given). */
export function UserPicker({ onPick, projectKey, exclude = [], label = 'Add team member' }: { onPick: (u: JiraUser) => void; projectKey?: string; exclude?: string[]; label?: string }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<JiraUser[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setStatus('loading');
    timer.current = window.setTimeout(() => {
      call('searchUsers', { query: q.trim(), projectKey }).then(
        (users) => {
          setResults(users.filter((u) => !exclude.includes(u.accountId)));
          setActive(0);
          setStatus('idle');
        },
        () => setStatus('error'),
      );
    }, 250);
  }, [q, projectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (u: JiraUser) => {
    onPick(u);
    setQ('');
    setResults([]);
    setOpen(false);
  };
  return (
    <div className="field combo">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        placeholder="Type at least 2 letters of a name"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <ul className="options" id={`${id}-list`} role="listbox">
          {status === 'loading' && <li aria-disabled>Searching…</li>}
          {status === 'error' && <li aria-disabled>Could not search users.</li>}
          {status === 'idle' && results.length === 0 && <li aria-disabled>No matching users you can see.</li>}
          {status === 'idle' &&
            results.map((u, i) => (
              <li key={u.accountId} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u)}>
                <span className="who">
                  <Avatar name={u.displayName} url={u.avatarUrl} />
                  <span>{u.displayName}</span>
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
