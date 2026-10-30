import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, DEMO } from './bridge';
import { ErrorMessage, Spinner } from './components/ui';
import { Ctx, useAsync, type Section, type Selection } from './hooks';
import { Holidays } from './pages/Holidays';
import { Overview } from './pages/Overview';
import { Reports } from './pages/Reports';
import { SavedReports } from './pages/SavedReports';
import { SettingsPage } from './pages/Settings';
import { TeamMembers } from './pages/TeamMembers';
import { Templates } from './pages/Templates';
import { Tracking } from './pages/Tracking';

const NAV: [Section, string, string][] = [
  ['overview', 'Overview', '◧'],
  ['tracking', 'Capacity tracking', '▦'],
  ['templates', 'Templates', '❒'],
  ['members', 'Team members', '◉'],
  ['holidays', 'Holidays & leave', '◷'],
  ['reports', 'Reports', '▤'],
  ['saved', 'Saved reports', '★'],
  ['settings', 'Settings', '⚙'],
];

export function App() {
  const ctx = useAsync(() => call('getContext'), []);
  const [section, setSection] = useState<Section>('overview');
  const [navState, setNavState] = useState<unknown>();
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: string }[]>([]);

  const toast = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const navigate = useCallback((s: Section, state?: unknown) => {
    setNavState(state);
    setSection(s);
    window.scrollTo(0, 0);
  }, []);
  const [selection, setSelection] = useState<Selection>();
  useEffect(() => {
    if (ctx.data && !selection) setSelection(ctx.data.preferences);
  }, [ctx.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = useCallback((patch: Selection, replace?: boolean) => setSelection((s) => (replace ? { templateId: s?.templateId, ...patch } : { ...s, ...patch })), []);

  // Remember the selection per user so the app reopens where they left off.
  const saved = useRef('');
  useEffect(() => {
    const json = JSON.stringify(selection ?? {});
    if (!selection?.sprintId || json === saved.current) return;
    saved.current = json;
    call('savePreferences', selection).catch(() => undefined);
  }, [selection]);

  const value = useMemo(
    () => (ctx.data && selection ? { app: ctx.data, toast, navigate, navState, selection, select } : null),
    [ctx.data, toast, navigate, navState, selection, select],
  );

  if (!value && !ctx.error) return <Spinner label="Loading Capacity Planner" />;
  if (!value) {
    return (
      <div className="main">
        <ErrorMessage error={ctx.error} />
      </div>
    );
  }

  return (
    <Ctx.Provider value={value}>
      {DEMO && <div className="demo-banner">DEMO MODE — sample data only, nothing is saved to Jira</div>}
      <div className="app">
        <nav className="sidebar" aria-label="Capacity Planner">
          <div className="brand">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <rect x="3" y="12" width="4" height="9" rx="1" fill="#0C66E4" />
              <rect x="10" y="7" width="4" height="14" rx="1" fill="#1D7AFC" />
              <rect x="17" y="3" width="4" height="18" rx="1" fill="#579DFF" />
            </svg>
            Capacity Planner
          </div>
          <ul className="nav">
            {NAV.map(([key, label, icon]) => (
              <li key={key}>
                <button aria-current={section === key ? 'page' : undefined} onClick={() => navigate(key)}>
                  <span aria-hidden style={{ width: 16, textAlign: 'center' }}>
                    {icon}
                  </span>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="main">
          {section === 'overview' && <Overview />}
          {section === 'tracking' && <Tracking />}
          {section === 'templates' && <Templates />}
          {section === 'members' && <TeamMembers />}
          {section === 'holidays' && <Holidays />}
          {section === 'reports' && <Reports />}
          {section === 'saved' && <SavedReports />}
          {section === 'settings' && <SettingsPage onSaved={ctx.reload} />}
        </main>
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
