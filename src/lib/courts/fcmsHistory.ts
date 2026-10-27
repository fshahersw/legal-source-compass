/**
 * Venue speed and backlog over time from the Federal Court Management Statistics (dataset fcms_court_profiles).
 * The latest edition of each district carries a `history` object that stitches every 12-month period since
 * 1999-09-30, each period taken from the earliest edition that prints it. Pure: this module keeps one period kind
 * (12 months ending June 30), so a chart never mixes fiscal-year and mid-year windows, and keeps nulls as gaps.
 */

export type FcmsMetric =
  | "median_months_civil_to_trial"
  | "civil_over_3y_pct"
  | "civil_over_3y_count"
  | "vacant_judgeship_months"
  | "pj_weighted_filings"
  | "median_months_civil"
  | "filings"
  | "pending";

export const FCMS_METRIC: Record<FcmsMetric, { label: string; unit: string; decimals: number }> = {
  median_months_civil_to_trial: {
    label: "Median months, civil filing to trial",
    unit: "months",
    decimals: 1,
  },
  civil_over_3y_pct: { label: "Civil cases pending over 3 years", unit: "%", decimals: 1 },
  civil_over_3y_count: { label: "Civil cases pending over 3 years", unit: "cases", decimals: 0 },
  vacant_judgeship_months: { label: "Vacant judgeship months", unit: "months", decimals: 1 },
  pj_weighted_filings: { label: "Weighted filings per judgeship", unit: "filings", decimals: 0 },
  median_months_civil: {
    label: "Median months, civil filing to disposition",
    unit: "months",
    decimals: 1,
  },
  filings: { label: "Total filings", unit: "cases", decimals: 0 },
  pending: { label: "Pending cases", unit: "cases", decimals: 0 },
};
const METRICS = Object.keys(FCMS_METRIC) as FcmsMetric[];

export type FcmsPoint = { period: string; label: string; value: number | null };

export type FcmsDistrict = {
  courtId: string;
  name: string;
  /** Period end of the latest edition (YYYY-MM-DD). */
  latest: string;
  /** 12 months ending June 30 of each year, oldest first. */
  june: Record<FcmsMetric, FcmsPoint[]>;
  /** Rank in the latest edition ([rank, of]); a rank of 1 is the highest value. */
  rank: Partial<Record<FcmsMetric, { rank: number; of: number }>>;
  sourceUrl: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COURT = /^[a-z0-9]{2,16}$/;

/** "12 months to Jun 2026" period label. */
export const juneLabel = (period: string) => `Jun ${period.slice(0, 4)}`;

/**
 * One latest-edition row ({id, court, name, history, rank, source_url}) as read by the server function.
 * Null when it carries no usable history.
 */
export function parseFcmsDistrict(raw: unknown): FcmsDistrict | null {
  const r = obj(raw);
  if (!r) return null;
  const courtId = r["court"];
  if (typeof courtId !== "string" || !COURT.test(courtId)) return null;
  const h = obj(r["history"]);
  const periods = (Array.isArray(h?.["periods"]) ? (h!["periods"] as unknown[]) : []).map((p) =>
    typeof p === "string" && DAY.test(p) ? p : null,
  );
  const series = obj(h?.["series"]) ?? {};
  if (!periods.some(Boolean)) return null;
  const june = {} as Record<FcmsMetric, FcmsPoint[]>;
  for (const m of METRICS) {
    const vals = Array.isArray(series[m]) ? (series[m] as unknown[]) : [];
    june[m] = periods.flatMap((p, i) => {
      if (!p || p.slice(5) !== "06-30") return [];
      const v = vals[i];
      return [{ period: p, label: juneLabel(p), value: isNum(v) ? v : null }];
    });
  }
  const rank: FcmsDistrict["rank"] = {};
  const rk = obj(r["rank"]) ?? {};
  for (const m of METRICS) {
    const pair = rk[m];
    if (Array.isArray(pair) && isNum(pair[0]) && isNum(pair[1]))
      rank[m] = { rank: pair[0], of: pair[1] };
  }
  const latest = periods
    .filter((p): p is string => !!p)
    .sort()
    .at(-1)!;
  const name = typeof r["name"] === "string" && r["name"].trim() ? r["name"].trim() : courtId;
  return {
    courtId,
    name,
    latest,
    june,
    rank,
    sourceUrl:
      typeof r["source_url"] === "string" && /^https:\/\//.test(r["source_url"])
        ? r["source_url"]
        : null,
  };
}

/** The value of a metric in the latest June period, or null. */
export function latestValue(d: FcmsDistrict, m: FcmsMetric): FcmsPoint | null {
  return d.june[m].at(-1) ?? null;
}

/** Median of the recorded values (null when none): the "median district" baseline. */
export function median(values: readonly (number | null | undefined)[]): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Median district value of a metric in the latest June period, with how many districts recorded it. */
export function medianDistrict(
  districts: readonly FcmsDistrict[],
  m: FcmsMetric,
): { value: number | null; recorded: number; of: number } {
  const vals = districts.map((d) => latestValue(d, m)?.value ?? null);
  return { value: median(vals), recorded: vals.filter(isNum).length, of: districts.length };
}

/**
 * Median district value of a metric for each June period, keyed by period label, with how many districts it rests
 * on. A period with fewer than `min` recorded districts is left out (null), so a thin early year is not a baseline.
 */
export function medianByPeriod(
  districts: readonly FcmsDistrict[],
  m: FcmsMetric,
  min = 20,
): Map<string, { value: number | null; recorded: number }> {
  const by = new Map<string, (number | null)[]>();
  for (const d of districts)
    for (const p of d.june[m]) by.set(p.label, [...(by.get(p.label) ?? []), p.value]);
  const out = new Map<string, { value: number | null; recorded: number }>();
  for (const [label, vals] of by) {
    const recorded = vals.filter(isNum).length;
    out.set(label, { value: recorded >= min ? median(vals) : null, recorded });
  }
  return out;
}

/** Rows for a period chart: { period label, value } for the June periods of one district. */
export function juneRows(d: FcmsDistrict, metrics: readonly FcmsMetric[]) {
  const len = d.june[metrics[0]!]?.length ?? 0;
  return Array.from({ length: len }, (_, i) => {
    const row: Record<string, string | number | null> = {
      period: d.june[metrics[0]!]![i]!.label,
    };
    for (const m of metrics) row[m] = d.june[m][i]?.value ?? null;
    return row;
  });
}

/** The first and last recorded June values of a metric ("over N years"). */
export function span(d: FcmsDistrict, m: FcmsMetric) {
  const rec = d.june[m].filter((p) => p.value !== null);
  const first = rec[0];
  const last = rec.at(-1);
  if (!first || !last || first === last) return null;
  return { first, last, years: Number(last.period.slice(0, 4)) - Number(first.period.slice(0, 4)) };
}

/** How many other districts share `d`'s latest value of `m` (they share its rank); null when it is not recorded. */
export function tiedWith(
  districts: readonly FcmsDistrict[],
  d: FcmsDistrict,
  m: FcmsMetric,
): number | null {
  const v = latestValue(d, m)?.value;
  if (!isNum(v)) return null;
  return districts.filter((o) => o.courtId !== d.courtId && latestValue(o, m)?.value === v).length;
}

/**
 * The district's position among districts on one metric. The rank is computed in the corpus from the FCMS values of
 * the latest edition (1 = highest; ties share a rank); FCMS does not publish a standing for every metric. A value
 * shared with other districts says so, and a zero shared with other districts is not given a rank.
 */
export function rankText(
  districts: readonly FcmsDistrict[],
  d: FcmsDistrict,
  m: FcmsMetric,
): string {
  const r = d.rank[m];
  if (!r) return "rank not recorded";
  const tied = districts.length ? tiedWith(districts, d, m) : null;
  if (latestValue(d, m)?.value === 0 && tied) return `zero, as in ${tied} other districts (not ranked)`;
  const base = `rank ${r.rank} of ${r.of} districts (1 = highest)`;
  return tied ? `${base}, tied with ${tied}` : base;
}
