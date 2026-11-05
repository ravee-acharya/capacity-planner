import { useState } from 'react';
import type { Forecast } from '../../../../src/services/api';
import { formatPercent, formatValue } from '../../../../src/shared/engine';
import { MIN_BIAS_ISSUES, MIN_FOCUS_SPRINTS, VERDICT_TEXT, type Verdict } from '../../../../src/shared/forecast';
import { call } from '../bridge';
import { formatDate } from '../hooks';
import { ErrorMessage, Message, Spinner, Who } from './ui';

const VERDICT_TONE: Record<Verdict, string> = { comfortable: 'success', likely: 'success', stretch: 'warning', unlikely: 'danger' };

function biasText(bias: number | null) {
  if (bias === null) return '—';
  const pct = Math.round((bias - 1) * 100);
  if (Math.abs(pct) < 5) return 'On target';
  return pct > 0 ? `${pct}% over` : `${-pct}% under`;
}

/** Visual range: the past-delivery band, its median, and where the commitment sits. */
function RangeBar({ low, median, high, committed }: { low: number; median: number; high: number; committed: number }) {
  const max = Math.max(high, committed, 1) * 1.1;
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div style={{ position: 'relative', height: 34, margin: '8px 0 4px' }} role="img" aria-label={`Expected ${low} to ${high}, median ${median}; committed ${committed}`}>
      <div style={{ position: 'absolute', top: 12, left: 0, right: 0, height: 10, background: 'var(--bg-neutral)', borderRadius: 5 }} />
      <div style={{ position: 'absolute', top: 12, left: x(low), width: `calc(${x(high)} - ${x(low)})`, height: 10, background: 'var(--chart-2)', opacity: 0.55, borderRadius: 5 }} />
      <div style={{ position: 'absolute', top: 8, left: x(median), width: 2, height: 18, background: 'var(--chart-2)' }} title="Median" />
      <div style={{ position: 'absolute', top: 2, left: x(committed), width: 3, height: 30, marginLeft: -1, background: 'var(--text)' }} title="Committed" />
    </div>
  );
}

export function ForecastPanel({
  boardId,
  sprintId,
  templateId,
  dirty,
  onUseFocus,
}: {
  boardId: number;
  sprintId: number;
  templateId?: string;
  dirty: boolean;
  onUseFocus: (changes: Record<string, number>) => void;
}) {
  const [sprints, setSprints] = useState(6);
  const [data, setData] = useState<Forecast>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();

  const run = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await call('getForecast', { boardId, sprintId, templateId, sprints }));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const unit = data?.unit ?? 'hours';
  const f = (v: number | null) => formatValue(v, unit);
  const v = data?.velocity;
  const suggestions = Object.fromEntries(
    (data?.members ?? []).filter((m) => m.measuredFocus !== null && Math.abs(Math.min(1, m.measuredFocus) - m.configuredFocus) >= 0.05).map((m) => [m.accountId, Math.min(1, m.measuredFocus!)]),
  );

  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <h3>Forecast from past sprints</h3>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Learns what the team really delivers, how focused each person really is, and how accurate their estimates are.
          </p>
        </div>
        <div className="row">
          <select className="select" aria-label="Sprints of history" value={sprints} onChange={(e) => setSprints(Number(e.target.value))}>
            {[4, 6, 8].map((n) => (
              <option key={n} value={n}>
                Last {n} sprints
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={run} disabled={loading}>
            {loading ? 'Analysing…' : data ? 'Re-analyse' : 'Analyse history'}
          </button>
        </div>
      </div>
      {dirty && data && <Message tone="warning">The forecast uses the saved plan. Save your changes and re-analyse to include them.</Message>}
      <ErrorMessage error={error} />
      {loading && !data && <Spinner label="Reading past sprints from Jira" />}
      {data && (
        <>
          {data.warnings.map((w) => (
            <Message key={w}>{w}</Message>
          ))}

          <div className="grid-2">
            <div className="stack" style={{ gap: 8 }}>
              <h4>Will the sprint's commitment be delivered?</h4>
              {!v ? (
                <p className="muted">At least two closed sprints with dates are needed for a velocity forecast.</p>
              ) : (
                <>
                  <div className="row">
                    <span className={`lozenge ${VERDICT_TONE[v.verdict]}`}>{v.verdict}</span>
                    <span className="small">{VERDICT_TEXT[v.verdict]}</span>
                  </div>
                  <RangeBar low={v.low} median={v.median} high={v.high} committed={v.committed} />
                  <div className="small">
                    Expected to complete <strong>{f(v.low)} – {f(v.high)}</strong> (median {f(v.median)}) with this sprint's {f(data.capacity)} of capacity.
                    Committed: <strong>{f(v.committed)}</strong>.
                  </div>
                  <div className="small muted">
                    Based on {v.sprints} sprints: they completed {formatPercent(v.rateLow * 100)}–{formatPercent(v.rateHigh * 100)} of their planned capacity.
                    {v.lowConfidence && ' Only a few sprints of history, so treat this as indicative.'}
                  </div>
                </>
              )}
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Past sprint</th>
                    <th className="num">Capacity</th>
                    <th className="num">Committed</th>
                    <th className="num">Completed</th>
                    <th className="num">Of capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td>
                        {h.name}
                        <div className="small muted">{formatDate(h.end)}</div>
                      </td>
                      <td className="num">{f(h.capacity)}</td>
                      <td className="num">{f(h.committed)}</td>
                      <td className="num">{f(h.completed)}</td>
                      <td className="num">{formatPercent(h.rate === null ? null : h.rate * 100)}</td>
                    </tr>
                  ))}
                  {data.history.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        No closed sprints found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="row between">
            <h4>Per person: focus and estimate accuracy</h4>
            {Object.keys(suggestions).length > 0 && (
              <button className="btn" onClick={() => onUseFocus(suggestions)}>
                Use all measured focus values ({Object.keys(suggestions).length})
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Team member</th>
                  <th className="num">Focus in plan</th>
                  <th className="num">Measured focus</th>
                  <th>
                    <span className="sr-only">Use</span>
                  </th>
                  <th className="num">Estimates</th>
                  <th className="num">Capacity</th>
                  <th className="num">Allocated</th>
                  {unit === 'hours' && <th className="num">Likely actual effort</th>}
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => {
                  const suggested = suggestions[m.accountId];
                  const risky = m.riskAdjusted !== null && m.riskAdjusted > m.totalCapacity && m.allocated <= m.totalCapacity;
                  return (
                    <tr key={m.accountId}>
                      <td>
                        <Who name={m.displayName} url={m.avatarUrl} />
                      </td>
                      <td className="num">{m.configuredFocus}</td>
                      <td className="num" title={`From ${m.focusSprints} sprint(s): hours logged ÷ hours available`}>
                        {m.measuredFocus === null ? <span className="muted small">needs {MIN_FOCUS_SPRINTS}+ sprints with logged time</span> : m.measuredFocus}
                      </td>
                      <td>
                        {suggested !== undefined && (
                          <button className="btn small" onClick={() => onUseFocus({ [m.accountId]: suggested })}>
                            Use {suggested}
                          </button>
                        )}
                      </td>
                      <td className="num" title={`${m.biasIssues} finished issue(s) with estimate and logged time`}>
                        {m.estimateBias === null ? <span className="muted small">needs {MIN_BIAS_ISSUES}+ issues</span> : biasText(m.estimateBias)}
                      </td>
                      <td className="num">{f(m.totalCapacity)}</td>
                      <td className="num">{f(m.allocated)}</td>
                      {unit === 'hours' && (
                        <td className="num" style={{ color: risky || (m.riskAdjusted ?? 0) > m.totalCapacity ? 'var(--danger-text)' : undefined, fontWeight: risky ? 600 : undefined }}>
                          {m.riskAdjusted === null ? '—' : f(m.riskAdjusted)}
                          {risky && <div className="small">Over capacity once estimate accuracy is applied</div>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Measured focus = hours the person logged on sprint issues during the sprint ÷ hours they were available (before focus), over sprints where they logged time. Estimate accuracy = time spent ÷ original estimate on finished issues.
            Suggestions only change this sprint's plan after you click Use and then Save plan.
          </p>
        </>
      )}
    </div>
  );
}
