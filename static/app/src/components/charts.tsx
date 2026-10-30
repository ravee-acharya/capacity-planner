// Lightweight SVG charts. Every chart has an accessible text summary and a legend.
import { useState } from 'react';
import { formatPercent, formatValue } from '../../../../src/shared/engine';
import type { Unit } from '../../../../src/shared/types';
import { utilColor } from './ui';

export interface Series {
  key: string;
  label: string;
  color: string;
}

function niceMax(v: number) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}>
          <i style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Grouped vertical bars: one group per category, one bar per series. */
export function GroupedBars({ categories, series, values, unit, title }: { categories: string[]; series: Series[]; values: number[][]; unit: Unit; title: string }) {
  const [hover, setHover] = useState<{ c: number; s: number } | null>(null);
  if (categories.length === 0) return null;
  const max = niceMax(Math.max(0, ...values.flat()));
  const groupW = Math.max(48, series.length * 18 + 20);
  const left = 48;
  const width = left + categories.length * groupW + 8;
  const height = 220;
  const plotH = 170;
  const barW = (groupW - 20) / series.length;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const y = (v: number) => 10 + plotH - (Math.max(0, v) / max) * plotH;
  return (
    <figure style={{ margin: 0 }}>
      <Legend series={series} />
      <div className="chart-wrap">
        <svg width={Math.max(width, 300)} height={height} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} stroke="var(--border)" />
              <text x={left - 6} y={y(t) + 4} textAnchor="end">
                {unit === 'hours' ? Math.round(t) : Math.round(t * 10) / 10}
              </text>
            </g>
          ))}
          {categories.map((c, ci) => (
            <g key={c + ci} transform={`translate(${left + ci * groupW + 10},0)`}>
              {series.map((s, si) => {
                const v = values[ci]?.[si] ?? 0;
                const active = hover?.c === ci && hover.s === si;
                return (
                  <rect
                    key={s.key}
                    x={si * barW}
                    y={y(v)}
                    width={Math.max(barW - 2, 2)}
                    height={Math.max(0, 10 + plotH - y(v))}
                    fill={s.color}
                    opacity={hover && !active ? 0.55 : 1}
                    rx={2}
                    onMouseEnter={() => setHover({ c: ci, s: si })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${c} – ${s.label}: ${formatValue(v, unit)}`}</title>
                  </rect>
                );
              })}
              <text x={(groupW - 20) / 2} y={height - 18} textAnchor="middle">
                {c.length > 12 ? `${c.slice(0, 11)}…` : c}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {hover && (
        <div className="small muted" aria-live="polite">
          {categories[hover.c]} – {series[hover.s].label}: {formatValue(values[hover.c][hover.s], unit)}
        </div>
      )}
    </figure>
  );
}

/** Horizontal utilisation bars with a 100% marker. */
export function UtilisationBars({ rows, over = 100, under = 70 }: { rows: { label: string; value: number | null }[]; over?: number; under?: number }) {
  const scale = Math.max(over, 100, ...rows.map((r) => r.value ?? 0)) * 1.05;
  return (
    <div role="list" className="stack" style={{ gap: 8 }}>
      {rows.map((r) => (
        <div role="listitem" key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, 160px) 1fr 56px', gap: 8, alignItems: 'center' }}>
          <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.label}
          </span>
          <div style={{ position: 'relative', height: 14, background: 'var(--bg-neutral)', borderRadius: 3 }}>
            <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, ((r.value ?? 0) / scale) * 100)}%`, background: utilColor(r.value, over, under), borderRadius: 3 }} />
            <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${(100 / scale) * 100}%`, borderLeft: '2px dashed var(--text-subtlest)' }} title="100% capacity" />
          </div>
          <span className="small num">{formatPercent(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Donut chart for share-of-total distributions. */
export function Donut({ slices, unit, title }: { slices: { label: string; value: number; color: string }[]; unit: Unit; title: string }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ alignItems: 'center', gap: 24 }}>
      <svg width={160} height={160} viewBox="0 0 160 160" role="img" aria-label={title}>
        <circle cx={80} cy={80} r={r} fill="none" stroke="var(--bg-neutral)" strokeWidth={22} />
        {total > 0 &&
          slices.map((s) => {
            const len = (Math.max(0, s.value) / total) * c;
            const el = (
              <circle key={s.label} cx={80} cy={80} r={r} fill="none" stroke={s.color} strokeWidth={22} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)">
                <title>{`${s.label}: ${formatValue(s.value, unit)}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        <text x={80} y={78} textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: 'var(--text)' }}>
          {formatValue(total, unit)}
        </text>
        <text x={80} y={96} textAnchor="middle">
          total
        </text>
      </svg>
      <div className="stack" style={{ gap: 6 }}>
        {slices.map((s) => (
          <div key={s.label} className="small row" style={{ gap: 6 }}>
            <i style={{ width: 10, height: 10, background: s.color, borderRadius: 2, display: 'inline-block' }} />
            <span>{s.label}</span>
            <span className="muted">
              {formatValue(s.value, unit)} ({total > 0 ? Math.round((s.value / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
