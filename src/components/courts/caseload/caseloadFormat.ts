/**
 * Pure display and chart-shaping helpers for /courts/caseload. Every helper returns "Not recorded" (or null) for an
 * unknown input; none guesses a number, and the fiscal year in progress is never treated as a complete year.
 */
import {
  changePct,
  int,
  NOT_RECORDED,
  pct as pctFixed,
  signedPct,
} from "@/components/analysis/analysisFormat";
import type {
  CaseloadYear,
  DistrictRow,
  RankEntry,
  RankMetric,
  ShareRow,
} from "@/lib/external/courtCaseload.functions";

export { NOT_RECORDED };

/** "FY2025", or "FY2026*" for the fiscal year in progress. */
export const fyLabel = (fy: number, partial = false) => `FY${fy}${partial ? "*" : ""}`;

/** "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st". */
export function ordinal(n: number): string {
  if (!Number.isInteger(n) || n < 0) return NOT_RECORDED;
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** What a rank of 1 means for each ranked measure, so "55th of 94 by median days" can be read correctly. */
export const RANK_TEXT: Record<RankMetric, { by: string; top: string }> = {
  filings: { by: "filings", top: "most civil filings" },
  pending_end: { by: "pending cases", top: "most cases pending at the year end" },
  median_days: { by: "median days", top: "longest median time to termination" },
  class_action_pct: {
    by: "class-action share",
    top: "highest share of filings alleging a class action",
  },
  pro_se_plaintiff_pct: {
    by: "pro se share",
    top: "highest share of filings with a pro se plaintiff",
  },
  product_pct: {
    by: "product-liability share",
    top: "highest product-liability and health-care/pharma share of filings",
  },
  settled_pct: { by: "settled share", top: "highest share of terminations coded settled" },
  trial_pct: { by: "trial share", top: "highest share of terminations by trial judgment" },
};

/** "6th of 94 by filings", with the meaning of rank 1 as the tooltip. */
export function rankChip(entry: RankEntry, fy: number): { text: string; title: string } {
  const t = RANK_TEXT[entry.metric];
  return {
    text: `${ordinal(entry.rank)} of ${int(entry.of)} by ${t.by}`,
    title: `FY${fy}: rank ${int(entry.rank)} of ${int(entry.of)} districts; 1st is the ${t.top}. Ties share the lowest number.`,
  };
}

/** "187 days"; Not recorded for null. */
export function days(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? NOT_RECORDED : `${int(v)} days`;
}

/** "+12 days" / "−424 days" with a real minus sign; Not recorded for null. */
export function daysDelta(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NOT_RECORDED;
  const body = Math.abs(Math.round(v)).toLocaleString("en-US");
  return v > 0 ? `+${body} days` : v < 0 ? `−${body} days` : "no change";
}

/** "6.6 months" from days, to one decimal (30.4375 days a month). */
export function monthsFromDays(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return NOT_RECORDED;
  return `${(v / 30.4375).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} months`;
}

export const pct = (v: number | null | undefined, digits = 1) => pctFixed(v, digits);

/** The year with this fiscal year, or null. */
export const yearOf = (years: readonly CaseloadYear[], fy: number | null | undefined) =>
  fy == null ? null : (years.find((y) => y.fy === fy) ?? null);

/** The latest complete year in the series (never the fiscal year in progress). */
export const latestComplete = (years: readonly CaseloadYear[]) =>
  [...years].reverse().find((y) => !y.partial) ?? null;

/** The year before `fy` in the series (the previous fiscal year, not just the previous row). */
export const priorYear = (years: readonly CaseloadYear[], fy: number) => yearOf(years, fy - 1);

// -------------------------------------------------------------------------------------------- court names

const INITIALS: Record<string, string> = {
  "N.D.": "Northern",
  "S.D.": "Southern",
  "E.D.": "Eastern",
  "W.D.": "Western",
  "C.D.": "Central",
  "M.D.": "Middle",
};

/** "E.D. Louisiana" from "District Court, E.D. Louisiana"; the full name when it has no such prefix. */
export function shortCourtName(name: string): string {
  return name.replace(/^District Court,\s*/i, "").trim() || name;
}

/** The name with its district initials spelled out ("N.D. California" also reads "Northern California"). */
export function districtSearchText(
  d: Pick<DistrictRow, "id" | "name" | "state" | "circuit">,
): string {
  const short = shortCourtName(d.name);
  const first = short.split(/\s+/)[0] ?? "";
  const spelled = INITIALS[first] ? short.replace(first, INITIALS[first]!) : "";
  return [d.name, spelled, d.id, d.state, d.circuit].filter(Boolean).join(" ");
}

/** "Ninth Circuit" -> "9th", "D.C. Circuit" -> "D.C."; the full label when it is not recognised. */
export function circuitShort(label: string | null): string {
  if (!label) return NOT_RECORDED;
  if (/^D\.?C\.?/i.test(label)) return "D.C.";
  const words: Record<string, string> = {
    First: "1st",
    Second: "2nd",
    Third: "3rd",
    Fourth: "4th",
    Fifth: "5th",
    Sixth: "6th",
    Seventh: "7th",
    Eighth: "8th",
    Ninth: "9th",
    Tenth: "10th",
    Eleventh: "11th",
    Twelfth: "12th",
  };
  const first = label.split(/\s+/)[0] ?? "";
  return words[first] ?? label;
}

// -------------------------------------------------------------------------------------------- chart rows

/** Chart row: each series is split into the complete years and the dashed hop from the last complete year to a partial one. */
export type VolumeRow = {
  fy: number;
  label: string;
  partial: boolean;
  filings: number | null;
  filingsPartial: number | null;
  terminations: number | null;
  terminationsPartial: number | null;
  pending: number | null;
  pendingPartial: number | null;
};

/** Chart rows for filings, terminations and pending at year end; a partial year is drawn as a dashed hop, not a point on the line. */
export function volumeRows(years: readonly CaseloadYear[]): VolumeRow[] {
  const last = latestComplete(years)?.fy ?? null;
  return years.map((y) => {
    const hop = y.partial || y.fy === last;
    return {
      fy: y.fy,
      label: y.partial ? `${y.fy}*` : String(y.fy),
      partial: y.partial,
      filings: y.partial ? null : y.filings,
      filingsPartial: hop ? y.filings : null,
      terminations: y.partial ? null : y.terminations,
      terminationsPartial: hop ? y.terminations : null,
      pending: y.partial ? null : y.pendingEnd,
      pendingPartial: hop ? y.pendingEnd : null,
    };
  });
}

export type MedianRow = {
  fy: number;
  label: string;
  partial: boolean;
  median: number | null;
  medianPartial: number | null;
  /** [p25, p75] only when both are recorded and bracket the median. */
  band: [number, number] | null;
  national: number | null;
  p25: number | null;
  p75: number | null;
};

/** True when p25 <= median <= p75 and all three are recorded. */
export function isCleanBand(y: Pick<CaseloadYear, "medianDays" | "p25Days" | "p75Days">): boolean {
  return (
    y.medianDays != null &&
    y.p25Days != null &&
    y.p75Days != null &&
    y.p25Days <= y.medianDays &&
    y.medianDays <= y.p75Days
  );
}

export function medianRows(
  years: readonly CaseloadYear[],
  nationalYears: readonly CaseloadYear[] = [],
): MedianRow[] {
  const last = latestComplete(years)?.fy ?? null;
  const national = new Map(
    nationalYears.filter((y) => !y.partial).map((y) => [y.fy, y.medianDays]),
  );
  return years.map((y) => {
    const hop = y.partial || y.fy === last;
    return {
      fy: y.fy,
      label: y.partial ? `${y.fy}*` : String(y.fy),
      partial: y.partial,
      median: y.partial ? null : y.medianDays,
      medianPartial: hop ? y.medianDays : null,
      band: isCleanBand(y) && !y.partial ? [y.p25Days!, y.p75Days!] : null,
      national: national.get(y.fy) ?? null,
      p25: y.p25Days,
      p75: y.p75Days,
    };
  });
}

/** The first fiscal year with a recorded median, for the note that earlier years are Not recorded. */
export function firstMedianYear(years: readonly CaseloadYear[]): number | null {
  return years.find((y) => y.medianDays != null)?.fy ?? null;
}

// -------------------------------------------------------------------------------------------- mix lists

/** The first `limit` rows, ordered by share (then count) descending; rows without a share keep their order last. */
export function topShares(rows: readonly ShareRow[], limit: number): ShareRow[] {
  return [...rows]
    .sort((a, b) => (b.sharePct ?? -1) - (a.sharePct ?? -1) || (b.count ?? -1) - (a.count ?? -1))
    .slice(0, limit);
}

/** A bar width in percent of the largest share on the list; at least 1 so a recorded value is visible. */
export function barWidth(value: number | null, max: number): number {
  if (value == null || !(max > 0) || value <= 0) return 0;
  return Math.max(1, Math.min(100, (value / max) * 100));
}

/** Compact MDL cell text: "2011-11-23" as given; Not recorded for null. */
export const dateOrNot = (v: string | null) => v ?? NOT_RECORDED;

/** "FY2021 to FY2025". */
export const windowLabel = (w: { fyFrom: number; fyTo: number } | null) =>
  w ? `FY${w.fyFrom} to FY${w.fyTo}` : NOT_RECORDED;

// -------------------------------------------------------------------------------------------- dates

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jun 30, 2026" from "2026-06-30" without a time-zone shift; null when the text is not a calendar date. */
export function longDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}

/** "partial year, through Jun 30, 2026", or "partial year" when the cut-off date is not recorded. */
export function partialText(through: string | null | undefined): string {
  const d = longDate(through);
  return d ? `partial year, through ${d}` : "partial year";
}

/** "+4.2%" / "−3.1%" for `after` against `before`; Not recorded when `before` is zero or either is unknown. */
export function signedPctOf(
  after: number | null | undefined,
  before: number | null | undefined,
): string {
  return signedPct(changePct(after, before));
}

/** The series with a null row for each fiscal year between its first and last that has no row, so a chart keeps a true time axis. */
export function fillYearGaps(years: readonly CaseloadYear[]): CaseloadYear[] {
  if (years.length < 2) return [...years];
  const byFy = new Map(years.map((y) => [y.fy, y]));
  const first = years[0]!.fy;
  const last = years.at(-1)!.fy;
  const out: CaseloadYear[] = [];
  for (let fy = first; fy <= last; fy += 1) {
    out.push(
      byFy.get(fy) ?? {
        fy,
        partial: false,
        filings: null,
        terminations: null,
        pendingEnd: null,
        medianDays: null,
        p25Days: null,
        p75Days: null,
        p90Days: null,
        classActionPct: null,
        proSePct: null,
        productPct: null,
        juryDemandedPct: null,
        settledPct: null,
        trialPct: null,
        withMdlNumber: null,
        mdlTransferIn: null,
        mdlOriginating: null,
      },
    );
  }
  return out;
}

/**
 * Per-year counts with a zero for each fiscal year between the first and last that has no row. The rows come from a
 * grouped count, so an absent year means no case was counted in it, and a chart keeps a true time axis.
 */
export function fillCountGaps<T extends { fy: number; value: number }>(
  rows: readonly T[],
  empty: (fy: number) => T,
): T[] {
  if (rows.length < 2) return [...rows];
  const byFy = new Map(rows.map((r) => [r.fy, r]));
  const first = Math.min(...rows.map((r) => r.fy));
  const last = Math.max(...rows.map((r) => r.fy));
  const out: T[] = [];
  for (let fy = first; fy <= last; fy += 1) out.push(byFy.get(fy) ?? empty(fy));
  return out;
}
