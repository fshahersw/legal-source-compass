/**
 * MDL momentum: each MDL in the latest JPML report placed by its size (actions pending now) and its signed net change
 * over exactly twelve monthly reports. Pure and client-safe.
 *
 * The 12-month change is N(t) − N(t−12), where t−12 is the report printed in the same calendar month a year earlier.
 * It is computed only when exactly one validated report exists in that month; a missing month (the Panel skipped or
 * the MDL was not listed) or two reports in one month leave the change unrecorded. The nearest other report is never
 * substituted, so a skipped month cannot pass a 10- or 13-month change off as a 12-month one.
 */
import type { MdlRow } from "@/lib/external/mdlAnalytics.functions";
import type { MdlPoint } from "@/lib/external/mdlSeries";

/** "2026-10" for "2026-10-01". Null for anything that is not an ISO calendar date. */
export function monthKey(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null;
}

/** The month key `months` calendar months before `key` ("2026-10", 12 → "2025-10"). */
export function shiftMonth(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) - months;
  const yy = Math.floor(idx / 12);
  const mm = idx - yy * 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}

export type ExactChange =
  | { ok: true; latest: MdlPoint; prior: MdlPoint; change: number }
  | { ok: false; reason: "no-latest" | "no-prior-report" | "two-reports-in-month" };

/**
 * Change in actions pending between the latest report in `series` and the report exactly `months` calendar months
 * earlier. `series` should already be validated (see `validSeries`); the latest point is the last by date.
 */
export function exactChange(series: readonly MdlPoint[], months = 12): ExactChange {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const latestKey = latest ? monthKey(latest.date) : null;
  if (!latest || !latestKey) return { ok: false, reason: "no-latest" };
  if (sorted.filter((p) => monthKey(p.date) === latestKey).length > 1)
    return { ok: false, reason: "two-reports-in-month" };
  const target = shiftMonth(latestKey, months);
  const prior = sorted.filter((p) => monthKey(p.date) === target);
  if (prior.length === 0) return { ok: false, reason: "no-prior-report" };
  if (prior.length > 1) return { ok: false, reason: "two-reports-in-month" };
  return { ok: true, latest, prior: prior[0]!, change: latest.pending - prior[0]!.pending };
}

export type MomentumPoint = {
  mdl: number;
  title: string;
  judge: string | null;
  district: string | null;
  type: string | null;
  massTort: boolean;
  /** Date the MDL was transferred (created by the Panel), as the record carries it. */
  dateTransferred: string | null;
  /** Actions pending in the latest report. */
  pending: number;
  /** N(t) − N(t−12); null when no exact report exists twelve months earlier. */
  change: number | null;
  /** Date of the report the change is measured from, when there is one. */
  priorDate: string | null;
  priorPending: number | null;
};

export type Momentum = {
  /** Latest report date every point is measured at. */
  asOf: string;
  /** Pending ≥ 1 and an exact 12-month change: the dots. */
  plotted: MomentumPoint[];
  /** Listed in the latest report with 0 actions pending (cannot sit on a log axis). */
  zeroPending: MomentumPoint[];
  /** Pending ≥ 1 but no exact report twelve months earlier. */
  noExactHistory: MomentumPoint[];
  /** Pending MDLs whose last validated report is not the latest one (not placed at all). */
  notInLatest: number;
};

/** Split the pending MDLs of the latest report into plotted, zero-pending and no-history groups. */
export function mdlMomentum(rows: readonly MdlRow[], asOf: string): Momentum {
  const out: Momentum = { asOf, plotted: [], zeroPending: [], noExactHistory: [], notInLatest: 0 };
  for (const r of rows) {
    if (r.status !== "pending") continue;
    const latest = r.series[r.series.length - 1];
    if (!latest || latest.date !== asOf) {
      out.notInLatest++;
      continue;
    }
    const ch = exactChange(r.series);
    const point: MomentumPoint = {
      mdl: r.mdl,
      title: r.title,
      judge: r.judge,
      district: r.district,
      type: r.type,
      massTort: r.massTort,
      dateTransferred: r.dateTransferred,
      pending: latest.pending,
      change: ch.ok ? ch.change : null,
      priorDate: ch.ok ? ch.prior.date : null,
      priorPending: ch.ok ? ch.prior.pending : null,
    };
    if (latest.pending === 0) out.zeroPending.push(point);
    else if (point.change == null) out.noExactHistory.push(point);
    else out.plotted.push(point);
  }
  out.plotted.sort((a, b) => b.pending - a.pending || a.mdl - b.mdl);
  out.zeroPending.sort((a, b) => a.mdl - b.mdl);
  out.noExactHistory.sort((a, b) => b.pending - a.pending || a.mdl - b.mdl);
  return out;
}

/** Symmetric log: sign(v)·log10(1 + |v|). Keeps 0 at 0 and spreads small and large changes on one axis. */
export const symlog = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v));

/** Ticks for a symmetric-log axis covering [lo, hi]: 0 and ±1, ±10, ±100 … out to the data. */
export function symlogTicks(lo: number, hi: number): number[] {
  const ticks = [0];
  for (let p = 1; p <= 1e9; p *= 10) {
    if (hi >= p * 0.5) ticks.push(p);
    if (lo <= -p * 0.5) ticks.unshift(-p);
    if (p > Math.max(Math.abs(lo), Math.abs(hi))) break;
  }
  return ticks;
}

/** Powers of ten from 1 up to the first one at or above `max` (log axis ticks for counts ≥ 1). */
export function log10Ticks(max: number): number[] {
  const ticks = [1];
  while (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! * 10);
  return ticks;
}

/** Plain summary counts for the headline: how many rose, fell and held. */
export function momentumSplit(points: readonly MomentumPoint[]) {
  let rose = 0;
  let fell = 0;
  let held = 0;
  for (const p of points) {
    if (p.change == null) continue;
    if (p.change > 0) rose++;
    else if (p.change < 0) fell++;
    else held++;
  }
  return { rose, fell, held };
}
