/**
 * Pure display helpers for the NEISS views. Every estimate is a WEIGHTED national estimate; a withheld (unstable) cell
 * shows its unweighted sample count labelled as such and never an estimate; nothing is added across products (their
 * estimates overlap). The 2024 sample re-stratification is carried into every chart row and comparison.
 */
import {
  compact,
  int,
  NOT_RECORDED,
  pct,
  signedPct,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type {
  NeissFigure,
  NeissInjuryRow,
  NeissNational,
  NeissProduct,
  NeissTheme,
  NeissYear,
} from "@/lib/external/neiss.functions";

export const NEISS_LABEL = "Weighted national estimates, CPSC NEISS";
export const NEISS_CREDIT =
  "U.S. Consumer Product Safety Commission NEISS; analysis by this project; not endorsed by CPSC";
export const WITHHELD = "Withheld (unstable)";
export const NO_CASES = "No sample cases";

// ------------------------------------------------------------------------------------ figures

/** The cell text for one estimate: the number, "Withheld (unstable)", "No sample cases" or Not recorded. */
export function figureText(fig: NeissFigure | null | undefined): string {
  if (!fig) return NOT_RECORDED;
  if (fig.state === "estimate") return int(fig.estimate);
  return fig.state === "withheld" ? WITHHELD : NO_CASES;
}

/** The sub-line of a cell: the interval and CV for an estimate; the unweighted sample count for a withheld one. */
export function figureNote(
  fig: NeissFigure | null | undefined,
  opts: { cv?: boolean; label?: boolean } = {},
): string | null {
  if (!fig || fig.state === "none") return null;
  if (fig.state === "withheld")
    return `${int(fig.cases)} sample ${fig.cases === 1 ? "case" : "cases"} (unweighted count, not an estimate)`;
  const range = `${int(fig.ci95[0])} to ${int(fig.ci95[1])}`;
  const interval = opts.label === false ? range : `95% interval ${range}`;
  return opts.cv === false ? interval : `${interval}; CV ${pct(fig.cvPct, 1)}`;
}

/** Reasons CPSC's rule gave for withholding, e.g. "estimate below 1,200; fewer than 20 cases". */
export function withheldReasons(fig: NeissFigure | null | undefined): string | null {
  return fig?.state === "withheld" && fig.reasons.length ? fig.reasons.join("; ") : null;
}

export const estimateOf = (fig: NeissFigure | null | undefined): number | null =>
  fig?.state === "estimate" ? fig.estimate : null;

export const cvOf = (fig: NeissFigure | null | undefined): number | null =>
  fig?.state === "estimate" ? fig.cvPct : null;

// ------------------------------------------------------------------------------- national chart

export type NationalRow = {
  year: number;
  label: string;
  /** The line and band are split at the design break so the two sample designs never join. */
  preEstimate: number | null;
  postEstimate: number | null;
  preBand: [number, number] | null;
  postBand: [number, number] | null;
  estimate: number;
  ci95: [number, number];
  cvPct: number;
  cases: number;
  hospitals: number | null;
  afterBreak: boolean;
  /** Text for the tooltip's change line. Withheld across the break, where the comparison is not valid. */
  changeNote: string;
};

export function changeNote(y: NeissYear, breakYear: number | null): string {
  if (!y.change) return "No previous year";
  if (breakYear != null && y.year === breakYear)
    return `Not compared with ${y.year - 1}: the sample was re-stratified`;
  const flag = y.change.exceedsSamplingError ? "exceeds" : "within";
  return `${signedPct(y.change.pct)} on ${y.year - 1}, ${flag} the sampling error`;
}

export function nationalRows(years: readonly NeissYear[], breakYear: number | null): NationalRow[] {
  return years.map((y) => {
    const after = breakYear != null && y.year >= breakYear;
    return {
      year: y.year,
      label: String(y.year),
      preEstimate: after ? null : y.estimate,
      postEstimate: after ? y.estimate : null,
      preBand: after ? null : y.ci95,
      postBand: after ? y.ci95 : null,
      estimate: y.estimate,
      ci95: y.ci95,
      cvPct: y.cvPct,
      cases: y.cases,
      hospitals: y.hospitals,
      afterBreak: after,
      changeNote: changeNote(y, breakYear),
    };
  });
}

/** Both sides of a comparison use the same sample design. */
export const sameDesign = (a: number, b: number, breakYear: number | null): boolean =>
  breakYear == null || a >= breakYear === b >= breakYear;

export function yearOf(years: readonly NeissYear[], year: number): NeissYear | undefined {
  return years.find((y) => y.year === year);
}

export function neissTakeaways(n: NeissNational): Takeaway[] {
  const latest = yearOf(n.years, n.latestYear);
  const prev = yearOf(n.years, n.latestYear - 1);
  const b = n.designBreak;
  const before = b ? yearOf(n.years, b.year - 1) : undefined;
  const after = b ? yearOf(n.years, b.year) : undefined;
  const top = n.topProducts[0];
  const comparable = latest && prev && sameDesign(latest.year, prev.year, b?.year ?? null);
  return usableTakeaways([
    latest
      ? {
          id: "national",
          figure: compact(latest.estimate),
          text: `estimated injuries treated in emergency departments in ${latest.year} (weighted national estimate; 95% interval ${compact(latest.ci95[0])} to ${compact(latest.ci95[1])}, CV ${pct(latest.cvPct, 1)}). Not a count of cases or people.`,
          anchor: "neiss-national",
          anchorLabel: "See the series",
        }
      : null,
    latest && prev && comparable && latest.change
      ? {
          id: "latest-change",
          figure: signedPct(latest.change.pct),
          text: `${latest.year} against ${prev.year}, ${latest.change.exceedsSamplingError ? "beyond" : "within"} the sampling error. Both years use the ${b?.year ?? "current"} sample design.`,
          anchor: "neiss-national",
        }
      : null,
    b && b.changedStratum != null && b.inBothYears != null
      ? {
          id: "design-break",
          figure: `${int(b.changedStratum)} of ${int(b.inBothYears)}`,
          text: `hospitals present in both ${b.year - 1} and ${b.year} moved stratum when CPSC re-stratified the sample${before && after ? `, so ${compact(before.estimate)} to ${compact(after.estimate)} is not a trend` : ""}. Comparisons across ${b.year - 1}/${b.year} mix two designs.`,
          anchor: "neiss-national",
        }
      : null,
    top
      ? {
          id: "top-product",
          figure: compact(top.estimate),
          text: `${top.label}, the largest product group in ${n.latestYear} (CV ${pct(top.cvPct, 1)}). Product estimates overlap, so they cannot be added.`,
          anchor: "neiss-products",
        }
      : null,
    n.reliability
      ? {
          id: "reliability",
          figure: `${int(n.reliability.reliable)} of ${int(n.reliability.total)}`,
          text: `product codes have a reliable ${n.latestYear} estimate; ${int(n.reliability.withheld)} are withheld as unstable and ${int(n.reliability.noCases)} have no sample cases.`,
          anchor: "neiss-signals",
        }
      : null,
  ]);
}

// ----------------------------------------------------------------------------- product signals

export type ProductMode = "reliable" | "withheld" | "none";
export type ProductSort = "estimate" | "cv" | "pooled" | "change" | "name";

export const modeOf = (p: NeissProduct): ProductMode =>
  p.latest?.state === "estimate"
    ? "reliable"
    : p.latest?.state === "withheld"
      ? "withheld"
      : "none";

export function productCounts(rows: readonly NeissProduct[]) {
  const counts = { reliable: 0, withheld: 0, none: 0, flagged: 0, retired: 0 };
  for (const r of rows) {
    counts[modeOf(r)] += 1;
    if (r.change?.exceedsSamplingError) counts.flagged += 1;
    if (r.status === "retired") counts.retired += 1;
  }
  return counts;
}

export function filterProducts(
  rows: readonly NeissProduct[],
  opts: { mode: ProductMode; flaggedOnly: boolean; query: string },
): NeissProduct[] {
  const words = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (modeOf(r) !== opts.mode) return false;
    if (opts.flaggedOnly && !r.change?.exceedsSamplingError) return false;
    if (!words.length) return true;
    const hay = `${r.label} ${r.code}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function sortProducts(
  rows: readonly NeissProduct[],
  sort: ProductSort,
  desc: boolean,
): NeissProduct[] {
  const dir = desc ? -1 : 1;
  const key = (r: NeissProduct): number | string | null =>
    sort === "estimate"
      ? estimateOf(r.latest)
      : sort === "cv"
        ? cvOf(r.latest)
        : sort === "pooled"
          ? estimateOf(r.pooled)
          : sort === "change"
            ? (r.change?.pct ?? null)
            : r.label.toLowerCase();
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka == null && kb == null) {
      // Withheld rows have no estimate to order by: the most sample cases first, then by name.
      const ca = a.latest?.state === "withheld" ? a.latest.cases : 0;
      const cb = b.latest?.state === "withheld" ? b.latest.cases : 0;
      return cb - ca || a.label.localeCompare(b.label);
    }
    if (ka == null) return 1;
    if (kb == null) return -1;
    if (ka === kb) return a.label.localeCompare(b.label);
    return (ka < kb ? -1 : 1) * dir;
  });
}

/** "+65.9%" for a flagged change; the plain statement when the change is within sampling error or not comparable. */
export function productChange(p: NeissProduct): {
  text: string;
  flagged: boolean;
  title: string;
} {
  const c = p.change;
  if (!c) {
    return {
      text: "Not compared",
      flagged: false,
      title: "A change is shown only when both years are reliable estimates",
    };
  }
  if (!c.exceedsSamplingError) {
    return {
      text: "Within sampling error",
      flagged: false,
      title: `${signedPct(c.pct)} (${c.differenceFromPrevious >= 0 ? "+" : "−"}${int(Math.abs(c.differenceFromPrevious))}), not beyond the sampling error`,
    };
  }
  return {
    text: signedPct(c.pct),
    flagged: true,
    title: `${c.differenceFromPrevious >= 0 ? "+" : "−"}${int(Math.abs(c.differenceFromPrevious))} injuries; the difference exceeds 1.96 times its standard error (a conservative test)`,
  };
}

/** Takeaways for the product signal table, computed only from the rows it shows. */
export function neissSignalTakeaways(
  rows: readonly NeissProduct[],
  latestYear: number,
): Takeaway[] {
  const counts = productCounts(rows);
  const compared = rows.filter((r) => r.change);
  const flagged = compared.filter((r) => r.change?.exceedsSamplingError);
  const rises = flagged
    .filter((r) => (r.change?.pct ?? 0) > 0)
    .sort((a, b) => b.change!.pct - a.change!.pct);
  const falls = flagged
    .filter((r) => (r.change?.pct ?? 0) < 0)
    .sort((a, b) => a.change!.pct - b.change!.pct);
  const total = rows.length;
  const from = (r: NeissProduct) => {
    const spark = r.spark;
    const to = spark.at(-1);
    const prev = spark.at(-2);
    return to != null && prev != null ? `${compact(prev)} to ${compact(to)}` : null;
  };
  return usableTakeaways([
    compared.length
      ? {
          id: "flagged",
          figure: `${int(flagged.length)} of ${int(compared.length)}`,
          text: `products show a ${latestYear} against ${latestYear - 1} change beyond the sampling error, with both years reliable. The rest are within sampling error.`,
          anchor: "neiss-signals",
          anchorLabel: "See the table",
        }
      : null,
    rises[0]
      ? {
          id: "largest-rise",
          figure: signedPct(rises[0].change!.pct),
          text: `${rises[0].label}${from(rises[0]) ? ` (${from(rises[0])})` : ""}, the largest flagged rise. Estimates overlap across products.`,
          anchor: "neiss-signals",
        }
      : null,
    falls[0]
      ? {
          id: "largest-fall",
          figure: signedPct(falls[0].change!.pct),
          text: `${falls[0].label}${from(falls[0]) ? ` (${from(falls[0])})` : ""}, the largest flagged fall.`,
          anchor: "neiss-signals",
        }
      : null,
    total
      ? {
          id: "withheld",
          figure: `${int(counts.withheld)} of ${int(total)}`,
          text: `product codes are withheld as unstable for ${latestYear} and show only an unweighted sample count; ${int(counts.none)} have no sample case.`,
          anchor: "neiss-signals",
        }
      : null,
  ]);
}

// --------------------------------------------------------------------------------------- themes

/** The sparkline points of a theme: only years whose narratives are comparable, with the design break noted. */
export function themeSpark(t: NeissTheme): { value: number | null }[] {
  const from = t.comparableFrom;
  return t.years.map((y, i) => ({ value: from != null && y < from ? null : (t.spark[i] ?? null) }));
}

// ------------------------------------------------------------------------------------- injuries

const AGE_ORDER = ["0-4", "5-14", "15-24", "25-44", "45-64", "65+", "Not recorded"];

/** Month, age group and sex keep their natural order; the rest rank by the pooled estimate, largest first. */
export function orderInjuryRows(rows: readonly NeissInjuryRow[]): NeissInjuryRow[] {
  const dim = rows[0]?.dimension;
  const natural = (r: NeissInjuryRow): number =>
    dim === "month"
      ? Number(r.code)
      : dim === "age_group"
        ? AGE_ORDER.indexOf(r.code) === -1
          ? 99
          : AGE_ORDER.indexOf(r.code)
        : 0;
  return [...rows].sort((a, b) => {
    if (dim === "month" || dim === "age_group") return natural(a) - natural(b);
    const ea = estimateOf(a.pooled);
    const eb = estimateOf(b.pooled);
    if (ea == null && eb == null) return a.label.localeCompare(b.label);
    if (ea == null) return 1;
    if (eb == null) return -1;
    return eb - ea || a.label.localeCompare(b.label);
  });
}

/** The year-span label used wherever the pooled figure appears. */
export const POOLED_LABEL = "2021–2025 total";
