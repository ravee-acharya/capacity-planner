import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { MemberStatus } from '../../../../src/shared/engine';
import { ApiError } from '../bridge';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export function Message({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; children?: ReactNode }) {
  return (
    <div className={`msg ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <Message tone="error" title={e.problems?.length ? 'Please fix the following' : 'Something went wrong'}>
      {e.problems?.length ? (
        <ul>
          {e.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : (
        e.message ?? String(error)
      )}
    </Message>
  );
}

export function Field({ label, help, children, htmlFor }: { label: string; help?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, narrow }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${narrow ? ' narrow' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <header>
          <h2 id={id}>{title}</h2>
          <button className="btn subtle" data-close onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  );
}

export function Confirm({ title, children, confirmLabel = 'Delete', onConfirm, onCancel }: { title: string; children: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      narrow
      footer={
        <>
          <button className="btn subtle" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{children}</div>
    </Modal>
  );
}

const COLORS = ['#1D7AFC', '#22A06B', '#8F7EE7', '#E56910', '#CD519D', '#2898BD', '#6A9A23', '#C9372C'];

export function Avatar({ name, url }: { name: string; url?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="avatar" style={{ background: color }} aria-hidden>
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : initials || '?'}
    </span>
  );
}

export function Who({ name, url, note }: { name: string; url?: string; note?: ReactNode }) {
  return (
    <span className="who">
      <Avatar name={name} url={url} />
      <span>{name}</span>
      {note}
    </span>
  );
}

export const STATUS_LABEL: Record<MemberStatus, [string, string]> = {
  over: ['Overloaded', 'danger'],
  under: ['Under-utilised', 'warning'],
  idle: ['No work', 'neutral'],
  ok: ['Balanced', 'success'],
  nocapacity: ['No capacity', 'neutral'],
};

export function StatusLozenge({ status }: { status: MemberStatus }) {
  const [label, tone] = STATUS_LABEL[status];
  return <span className={`lozenge ${tone}`}>{label}</span>;
}

export function utilColor(u: number | null, over = 100, under = 70) {
  if (u === null) return 'var(--chart-neutral)';
  if (u > over) return 'var(--danger-bold)';
  if (u < under) return 'var(--warning-bold)';
  return 'var(--success-bold)';
}

export function Meter({ value, over, under }: { value: number | null; over?: number; under?: number }) {
  const w = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="meter" role="img" aria-label={value === null ? 'No capacity' : `${Math.round(value)}% utilised`}>
      <span style={{ width: `${w}%`, background: utilColor(value, over, under) }} />
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'warning' | 'success' }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: [T, string][]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(([key, text]) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          tabIndex={value === key ? 0 : -1}
          onClick={() => onChange(key)}
          onKeyDown={(e) => {
            const i = tabs.findIndex(([k]) => k === key);
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length][0]);
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length][0]);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: [T, string][]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function UnitBadge({ unit }: { unit: 'hours' | 'points' }) {
  return <span className="lozenge info">{unit === 'hours' ? 'Hours' : 'Story points'}</span>;
}
