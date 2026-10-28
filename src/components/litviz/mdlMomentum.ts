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

export { exactChange, monthKey, shiftMonth, type ExactChange } from "@/lib/external/mdlSeries";
import { exactChange } from "@/lib/external/mdlSeries";

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

/** Ticks for a symmetric-log axis over the data extent [lo, hi]: 0 and ±10, ±100 … within the extent. */
export function symlogTicks(lo: number, hi: number): number[] {
  const ticks = [0];
  for (let p = 10; p <= 1e12; p *= 10) {
    const up = hi >= p;
    const down = lo <= -p;
    if (up) ticks.push(p);
    if (down) ticks.unshift(-p);
    if (!up && !down) break;
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
