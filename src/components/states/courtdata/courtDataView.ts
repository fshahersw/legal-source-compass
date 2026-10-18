/**
 * Pure display helpers for the state page's court-data panel. They work only from rows the server function loaded;
 * an unknown value is "Not recorded" or null, never a guess, and CourtListener figures are always described as
 * collection counts, not complete court totals.
 */
import {
  NOT_RECORDED,
  changePct,
  compact,
  int,
  shareOf,
  signedPct,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type { MiniPoint } from "@/components/states/consumer/MiniLine";
import type {
  CivilCaseload,
  CivilYear,
  CourtListenerState,
  StateCourtData,
} from "@/lib/external/stateCourtData.functions";

export { NOT_RECORDED };

export const COLLECTION_CAVEAT = "a collection, not complete court totals";

export const countText = (v: number | null | undefined): string => int(v);

/** "94.6%" for a percent already in percent units; "Not recorded" for null. */
export function percentText(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v)
    ? NOT_RECORDED
    : `${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}

/** Whole days, "Not recorded" when the median is not published (it needs at least 30 cases). */
export function daysText(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v)
    ? NOT_RECORDED
    : `${Math.round(v).toLocaleString("en-US")} days`;
}

export function yearsText(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v)
    ? NOT_RECORDED
    : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} yrs`;
}

/** The date a snapshot note says filings run through ("... filing dates through 2026-06-30"); null when it names none. */
export function snapshotThrough(snapshot: string | null | undefined): string | null {
  return /through (\d{4}-\d{2}-\d{2})/.exec(snapshot ?? "")?.[1] ?? null;
}

export function civilYear(c: CivilCaseload, fy: number): CivilYear | undefined {
  return c.series.find((y) => y.fy === fy);
}

/** The latest complete year and the one before it, when both loaded. */
export function lastTwo(c: CivilCaseload): { last: CivilYear; previous: CivilYear | null } | null {
  const last = c.series[c.series.length - 1];
  if (!last) return null;
  const previous = c.series.find((y) => y.fy === last.fy - 1) ?? null;
  return { last, previous };
}

export type CivilMeasure = "filings" | "terminations" | "pending" | "medianDays";

export function civilPoints(
  series: readonly CivilYear[],
  measure: CivilMeasure,
  second?: CivilMeasure,
): MiniPoint[] {
  return series.map((y) => ({
    x: y.fy,
    label: String(y.fy),
    y: y[measure],
    ...(second ? { y2: y[second] } : {}),
  }));
}

/** Percent change of a measure from the prior fiscal year, computed from the two years' counts. */
export function civilChange(
  c: CivilCaseload,
  measure: CivilMeasure,
): { fy: number; previousFy: number; pct: number } | null {
  const two = lastTwo(c);
  if (!two?.previous) return null;
  const pct = changePct(two.last[measure], two.previous[measure]);
  return pct == null ? null : { fy: two.last.fy, previousFy: two.previous.fy, pct };
}

export function courtsPlural(n: number): string {
  return `${n.toLocaleString("en-US")} federal district ${n === 1 ? "court" : "courts"}`;
}

export type SplitSegment = { label: string; dockets: number; sharePct: number };

/** Federal / state / other dockets with their share of the collection's dockets for the state. */
export function docketSplit(c: CourtListenerState): SplitSegment[] {
  return c.byGroup.flatMap((g) => {
    const sharePct = shareOf(g.dockets, c.dockets);
    return sharePct == null || g.dockets <= 0 ? [] : [{ ...g, sharePct }];
  });
}

export function courtTakeaways(d: StateCourtData): Takeaway[] {
  const civil = d.civil;
  const two = civil ? lastTwo(civil) : null;
  const filingsChange = civil ? civilChange(civil, "filings") : null;
  const cl = d.courtListener;
  const federal = cl ? docketSplit(cl).find((s) => s.label === "Federal") : undefined;
  const bench = d.benches?.rows[0];
  const partial = civil?.partialYear ?? null;
  return usableTakeaways([
    civil && two?.last.filings != null
      ? {
          id: "filings",
          figure: int(two.last.filings),
          text: `civil cases filed in the state's ${courtsPlural(civil.districts.length || 1)} in FY${two.last.fy} (FJC Integrated Database)${
            filingsChange
              ? `, ${signedPct(filingsChange.pct)} from FY${filingsChange.previousFy}`
              : ""
          }${partial ? `; FY${partial.fy} is partial and is not compared` : ""}.`,
          anchor: "courts-civil",
          anchorLabel: "See the caseload",
        }
      : null,
    civil && two?.last.medianDays != null
      ? {
          id: "median",
          figure: `${int(two.last.medianDays)} days`,
          text: `median time from filing to termination for cases terminated in FY${two.last.fy}${
            two.previous?.medianDays != null
              ? `, against ${int(two.previous.medianDays)} days in FY${two.previous.fy}`
              : ""
          }.`,
          anchor: "courts-civil",
          anchorLabel: "See the caseload",
        }
      : null,
    cl
      ? {
          id: "dockets",
          figure: compact(cl.dockets),
          text: `dockets in CourtListener's collection for the state's courts${
            federal ? `, ${percentText(federal.sharePct, 0)} in federal courts` : ""
          }: ${COLLECTION_CAVEAT}.`,
          anchor: "courts-dockets",
          anchorLabel: "See the collection",
        }
      : null,
    bench
      ? {
          id: "bench",
          figure: int(bench.positions),
          text: `judicial positions on record for ${bench.name}, the largest bench on record in the state (CourtListener people records): positions, not a count of sitting judges.`,
          anchor: "courts-benches",
          anchorLabel: "See the benches",
        }
      : null,
  ]);
}
