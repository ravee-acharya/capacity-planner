import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Api } from '../../../src/services/api';

export type AppContext = Awaited<ReturnType<Api['getContext']>>;

/** The project/board/sprint/template the user is working with, shared by every page. */
export interface Selection {
  projectKey?: string;
  boardId?: number;
  sprintId?: number;
  templateId?: string;
}

export const Ctx = createContext<{
  app: AppContext;
  toast: (message: string, tone?: 'info' | 'error') => void;
  navigate: (section: Section, state?: unknown) => void;
  navState: unknown;
  selection: Selection;
  select: (patch: Selection, replace?: boolean) => void;
}>(null as never);

export const useApp = () => useContext(Ctx);

export type Section = 'overview' | 'tracking' | 'templates' | 'members' | 'holidays' | 'reports' | 'saved' | 'settings';

/** Run an async loader; re-runs when deps change and ignores stale responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => id === seq.current && setState({ data, loading: false }),
      (error) => id === seq.current && setState({ error, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run, setData: (data: T) => setState({ data, loading: false }) };
}

/** Trigger a browser download; returns false if the sandbox blocked it. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  try {
    const blob = new Blob(['﻿', text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}

export function fileSafe(name: string) {
  return name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'report';
}

export function formatDate(d?: string | null) {
  if (!d) return '—';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatDateTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
