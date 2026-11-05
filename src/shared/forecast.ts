// Forecasting from past sprints: capacity-adjusted velocity ranges, measured focus and
// estimate bias. Pure functions; the service layer gathers the history.
import { round } from './engine';
import type { Unit } from './types';

/** Linear-interpolated quantile of an ascending list. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface HistorySprint {
  id: number;
  name: string;
  start: string;
  end: string;
  /** Team capacity (with focus) in the sprint, in the forecast unit. */
  capacity: number;
  /** Work completed by sprint end, in the forecast unit. */
  completed: number;
  /** Work that was in the sprint, completed or not. */
  committed: number;
  /** completed / capacity, or null when the sprint had no capacity. */
  rate: number | null;
}

export type Verdict = 'comfortable' | 'likely' | 'stretch' | 'unlikely';

export interface VelocityForecast {
  sprints: number;
  rateLow: number;
  rateMedian: number;
  rateHigh: number;
  /** Expected completion this sprint = rate × this sprint's capacity. */
  low: number;
  median: number;
  high: number;
  committed: number;
  verdict: Verdict;
  /** True when fewer than 3 sprints were usable, so the range is indicative only. */
  lowConfidence: boolean;
}

export const MIN_VELOCITY_SPRINTS = 2;

/**
 * Capacity-adjusted velocity: each past sprint's completion rate (completed ÷ capacity) is applied
 * to this sprint's capacity, so a sprint with holidays gets a proportionally smaller forecast.
 * Range = P20–P80 of rates with 5+ sprints, otherwise min–max.
 */
export function velocityForecast(history: HistorySprint[], capacity: number, committed: number): VelocityForecast | null {
  const rates = history.map((h) => h.rate).filter((r): r is number => r !== null && Number.isFinite(r)).sort((a, b) => a - b);
  if (rates.length < MIN_VELOCITY_SPRINTS) return null;
  const wide = rates.length < 5;
  const rateLow = wide ? rates[0] : quantile(rates, 0.2);
  const rateHigh = wide ? rates[rates.length - 1] : quantile(rates, 0.8);
  const rateMedian = quantile(rates, 0.5);
  const low = round(rateLow * capacity, 2);
  const median = round(rateMedian * capacity, 2);
  const high = round(rateHigh * capacity, 2);
  const verdict: Verdict = committed <= low ? 'comfortable' : committed <= median ? 'likely' : committed <= high ? 'stretch' : 'unlikely';
  return { sprints: rates.length, rateLow, rateMedian, rateHigh, low, median, high, committed: round(committed, 2), verdict, lowConfidence: rates.length < 3 };
}

export interface MemberSample {
  /** Hours available before focus (capacity/day × allocation × days). */
  rawCapacityHours: number;
  /** Hours logged on the person's sprint issues. */
  spentHours: number;
  /** Done issues with both an estimate and logged time. */
  estimatedSec: number;
  spentOnEstimatedSec: number;
  estimatedIssues: number;
}

export interface MemberCalibration {
  /** Logged hours ÷ available hours, or null without enough history. */
  measuredFocus: number | null;
  focusSprints: number;
  /** Time spent ÷ original estimate on finished issues (1.3 = 30% over), or null. */
  estimateBias: number | null;
  biasIssues: number;
}

export const MIN_FOCUS_SPRINTS = 2;
export const MIN_BIAS_ISSUES = 5;

export function calibrateMember(samples: MemberSample[]): MemberCalibration {
  // Only sprints where the person logged time count: a sprint with nothing logged usually means
  // they worked on things outside the sprint, and would wrongly suggest a focus near zero.
  const withCapacity = samples.filter((s) => s.rawCapacityHours > 0 && s.spentHours > 0);
  const raw = withCapacity.reduce((s, x) => s + x.rawCapacityHours, 0);
  const spent = withCapacity.reduce((s, x) => s + x.spentHours, 0);
  const est = samples.reduce((s, x) => s + x.estimatedSec, 0);
  const spentEst = samples.reduce((s, x) => s + x.spentOnEstimatedSec, 0);
  const issues = samples.reduce((s, x) => s + x.estimatedIssues, 0);
  return {
    measuredFocus: withCapacity.length >= MIN_FOCUS_SPRINTS && raw > 0 ? round(Math.min(1.5, spent / raw), 2) : null,
    focusSprints: withCapacity.length,
    estimateBias: issues >= MIN_BIAS_ISSUES && est > 0 ? round(spentEst / est, 2) : null,
    biasIssues: issues,
  };
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  comfortable: 'Comfortable – at or below the low end of past delivery',
  likely: 'Likely – within typical past delivery',
  stretch: 'Stretch – only the best past sprints delivered this much',
  unlikely: 'Unlikely – more than the team has delivered before',
};

export function unitWord(unit: Unit) {
  return unit === 'hours' ? 'hours' : 'points';
}
