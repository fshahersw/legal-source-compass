/**
 * Size distributions for enforcement amounts, one agency at a time (amounts from different agencies measure different
 * things and are never pooled).
 *
 * - DOJ: the share of press releases in each size band of their largest stated resolution figure, per calendar year.
 *   Shares, not counts, because the DOJ News API's coverage jumps between years; a band the overview does not record
 *   for a year makes that year's shares unknown rather than a guess.
 * - EPA: published case records (federal penalty of $100,000 or more), binned on a log scale by the case's total
 *   federal penalty, split by judicial and administrative cases, with medians taken from the records themselves.
 *   National cases recorded as several regional records sharing one penalty count once, at the combined penalty.
 */
import type { AmountBucket } from "@/lib/external/enforcementActions.functions";
import type { EpaCaseRow } from "@/lib/external/enforcement.functions";
import type { StackRow } from "@/components/charts/d3/maths";

// ------------------------------------------------------------------------------------------------ DOJ

/** Size bands from smallest to largest; "none" (no figure stated) is reported apart, not as a band. */
export const DOJ_BANDS = ["under_1m", "1m_plus", "10m_plus", "100m_plus", "1b_plus"] as const;
export type DojBand = (typeof DOJ_BANDS)[number];
export const DOJ_BAND_LABEL: Record<DojBand, string> = {
  under_1m: "Under $1M",
  "1m_plus": "$1M–10M",
  "10m_plus": "$10M–100M",
  "100m_plus": "$100M–1B",
  "1b_plus": "$1B or more",
};

export type DojYearInput = {
  year: string;
  count: number;
  amount: Partial<Record<AmountBucket, number>>;
};

export type DojSizeYear = {
  year: string;
  partial: boolean;
  releases: number;
  /** Releases with a figure stated; null when any band is not recorded for the year. */
  withFigure: number | null;
  noFigure: number | null;
  counts: Record<DojBand, number | null>;
  /** Percent of releases with a figure, per band; all null when withFigure is null or zero. */
  shares: Record<DojBand, number | null>;
};

/** Per-year size-band counts and shares. `currentYear` marks the unfinished calendar year. */
export function dojSizeYears(byYear: readonly DojYearInput[], currentYear: number): DojSizeYear[] {
  return [...byYear]
    .sort((a, b) => a.year.localeCompare(b.year))
    .map((y) => {
      const counts = Object.fromEntries(DOJ_BANDS.map((b) => [b, y.amount[b] ?? null])) as Record<
        DojBand,
        number | null
      >;
      const known = DOJ_BANDS.every((b) => counts[b] != null);
      const withFigure = known ? DOJ_BANDS.reduce((s, b) => s + counts[b]!, 0) : null;
      const shares = Object.fromEntries(
        DOJ_BANDS.map((b) => [
          b,
          withFigure ? Math.round((1000 * counts[b]!) / withFigure) / 10 : null,
        ]),
      ) as Record<DojBand, number | null>;
      return {
        year: y.year,
        partial: Number(y.year) >= currentYear,
        releases: y.count,
        withFigure,
        noFigure: y.amount.none ?? null,
        counts,
        shares,
      };
    });
}

export function dojStackRows(years: readonly DojSizeYear[]): StackRow[] {
  return years.map((y) => ({
    period: y.year,
    partial: y.partial,
    values: { ...y.shares },
  }));
}

/** Headline: the latest complete year with known shares, and its share stating $10M or more. */
export function dojSizeCallout(years: readonly DojSizeYear[]): {
  year: string;
  withFigure: number;
  tenMillionPlus: number;
  sharePct: number;
} | null {
  const y = [...years].reverse().find((r) => !r.partial && r.withFigure);
  if (!y || !y.withFigure) return null;
  const tenMillionPlus = y.counts["10m_plus"]! + y.counts["100m_plus"]! + y.counts["1b_plus"]!;
  return {
    year: y.year,
    withFigure: y.withFigure,
    tenMillionPlus,
    sharePct: Math.round((1000 * tenMillionPlus) / y.withFigure) / 10,
  };
}

// ------------------------------------------------------------------------------------------------ EPA

export const EPA_FLOOR = 100_000;
/** Log-decade bins from the published floor upward; the last bin is open-ended. */
export const EPA_BINS = [
  { id: "100k", lo: 1e5, hi: 1e6, label: "$100K–1M" },
  { id: "1m", lo: 1e6, hi: 1e7, label: "$1M–10M" },
  { id: "10m", lo: 1e7, hi: 1e8, label: "$10M–100M" },
  { id: "100m", lo: 1e8, hi: Infinity, label: "$100M or more" },
] as const;

export type EpaCaseType = "judicial" | "administrative" | "other";
export function epaCaseType(code: string): EpaCaseType {
  return code === "JDC" ? "judicial" : code === "AFR" ? "administrative" : "other";
}

export type EpaPenaltyCase = {
  key: string;
  name: string;
  type: EpaCaseType;
  penalty: number;
  settlementFy: number;
  /** Regional records merged into this case (1 for an ordinary case). */
  records: number;
};

export type EpaBin = {
  id: string;
  label: string;
  judicial: number;
  administrative: number;
  other: number;
  total: number;
};

export type EpaPenaltySizes = {
  cases: EpaPenaltyCase[];
  bins: EpaBin[];
  median: Record<EpaCaseType | "all", number | null>;
  count: Record<EpaCaseType | "all", number>;
  /** National cases whose regional records were merged into one case. */
  mergedNational: number;
  /** Records skipped because they had no settlement fiscal year. */
  unsettled: number;
  /** Records below the published floor (expected 0; kept visible if the data ever changes). */
  belowFloor: number;
  firstFy: number | null;
  lastFy: number | null;
};

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

type CaseInput = Pick<
  EpaCaseRow,
  "caseNumber" | "name" | "typeCode" | "fedPenalty" | "settlementFy" | "states" | "nationalCase"
>;

/**
 * Bin published EPA case records settled in [fromFy, toFy], optionally only cases with a facility in `state`.
 * A national case keeps the lead record's type and the combined penalty, and counts once.
 */
export function epaPenaltySizes(
  rows: readonly CaseInput[],
  { fromFy, toFy, state }: { fromFy: number; toFy: number; state?: string | undefined },
): EpaPenaltySizes {
  const cases: EpaPenaltyCase[] = [];
  const seenLeads = new Set<string>();
  let unsettled = 0;
  let belowFloor = 0;
  let mergedNational = 0;
  for (const r of rows) {
    if (state && !r.states.includes(state)) continue;
    if (r.settlementFy == null) {
      unsettled++;
      continue;
    }
    if (r.settlementFy < fromFy || r.settlementFy > toFy) continue;
    const nc = r.nationalCase;
    if (nc) {
      if (seenLeads.has(nc.lead)) continue;
      // Prefer the lead record's own row for the case type; the first record seen stands in until it appears.
      const lead =
        rows.find((x) => x.caseNumber === nc.lead && x.nationalCase?.lead === nc.lead) ?? r;
      seenLeads.add(nc.lead);
      mergedNational++;
      const penalty = nc.combined;
      if (penalty < EPA_FLOOR) {
        belowFloor++;
        continue;
      }
      cases.push({
        key: nc.lead,
        name: lead.name,
        type: epaCaseType(lead.typeCode),
        penalty,
        settlementFy: r.settlementFy,
        records: nc.records.length,
      });
      continue;
    }
    if (r.fedPenalty < EPA_FLOOR) {
      belowFloor++;
      continue;
    }
    cases.push({
      key: r.caseNumber,
      name: r.name,
      type: epaCaseType(r.typeCode),
      penalty: r.fedPenalty,
      settlementFy: r.settlementFy,
      records: 1,
    });
  }
  const bins: EpaBin[] = EPA_BINS.map((b) => {
    const inBin = cases.filter((c) => c.penalty >= b.lo && c.penalty < b.hi);
    const by = (t: EpaCaseType) => inBin.filter((c) => c.type === t).length;
    return {
      id: b.id,
      label: b.label,
      judicial: by("judicial"),
      administrative: by("administrative"),
      other: by("other"),
      total: inBin.length,
    };
  });
  const of = (t: EpaCaseType) => cases.filter((c) => c.type === t).map((c) => c.penalty);
  const fys = cases.map((c) => c.settlementFy);
  return {
    cases,
    bins,
    median: {
      judicial: median(of("judicial")),
      administrative: median(of("administrative")),
      other: median(of("other")),
      all: median(cases.map((c) => c.penalty)),
    },
    count: {
      judicial: of("judicial").length,
      administrative: of("administrative").length,
      other: of("other").length,
      all: cases.length,
    },
    mergedNational,
    unsettled,
    belowFloor,
    firstFy: fys.length ? Math.min(...fys) : null,
    lastFy: fys.length ? Math.max(...fys) : null,
  };
}

export type LogBin = { x0: number; x1: number; count: number };

/**
 * Histogram on a log scale: `perDecade` equal-width bins per power of ten from `lo` up to `hi` (both powers of ten).
 * Values below `lo` are not binned (callers report them); a value equal to `hi` falls in the last bin.
 */
export function logHistogram(
  values: readonly number[],
  lo: number,
  hi: number,
  perDecade: number,
): LogBin[] {
  const decades = Math.round(Math.log10(hi / lo));
  const n = Math.max(1, decades * perDecade);
  const bins: LogBin[] = Array.from({ length: n }, (_, i) => ({
    x0: lo * 10 ** (i / perDecade),
    x1: lo * 10 ** ((i + 1) / perDecade),
    count: 0,
  }));
  for (const v of values) {
    if (!(v >= lo)) continue;
    const i = Math.min(n - 1, Math.floor(Math.log10(v / lo) * perDecade + 1e-9));
    bins[i]!.count++;
  }
  return bins;
}

/** Smallest power of ten at or above every value (at least `lo` × 10). */
export function decadeCeiling(values: readonly number[], lo: number): number {
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  return Math.max(lo * 10, 10 ** Math.ceil(Math.log10(Math.max(max, 1)) - 1e-9));
}
