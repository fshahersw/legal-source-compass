/**
 * MDL hub history by district (dataset court_jb_districts): pending MDL actions per district, FY2005-FY2025, from
 * the Judicial Business tables (C-4A, T-1, S-19). Pure: parses the stored series, turns printed dashes into gaps,
 * and writes reconciliation notes per series-year instead of the record-level "Source total mismatch" badge, which
 * flags a whole district when one cumulative cell in one year did not add up.
 */

export type HubSeriesKey =
  | "mdl_pending"
  | "mdl_pending_share_of_national_pct"
  | "mdl_in_12m"
  | "mdl_out_12m"
  | "mdl_in_cum"
  | "mdl_out_cum";

export const HUB_SERIES_LABEL: Record<HubSeriesKey, string> = {
  mdl_pending: "MDL actions pending",
  mdl_pending_share_of_national_pct: "Share of national MDL actions pending",
  mdl_in_12m: "MDL actions transferred in (12 months)",
  mdl_out_12m: "MDL actions closed or remanded (12 months)",
  mdl_in_cum: "MDL actions transferred in (cumulative)",
  mdl_out_cum: "MDL actions closed or remanded (cumulative)",
};

const KEYS = Object.keys(HUB_SERIES_LABEL) as HubSeriesKey[];

export type HubDistrict = {
  courtId: string;
  name: string;
  years: number[];
  series: Record<HubSeriesKey, (number | null)[]>;
  /** Series-years whose published cell did not reconcile with the table totals (as the builder recorded them). */
  unreconciled: { series: string; years: number[] }[];
  /** Series-years the table printed as a dash (shown as gaps, never as zero). */
  dashes: { series: string; years: number[] }[];
  sourceUrl: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const COURT = /^[a-z0-9]{2,16}$/;

function yearMap(v: unknown): { series: string; years: number[] }[] {
  const o = obj(v);
  if (!o) return [];
  return Object.entries(o)
    .map(([series, ys]) => ({
      series,
      years: (Array.isArray(ys) ? ys : []).filter(
        (y): y is number => Number.isInteger(y) && y >= 1990 && y <= 2100,
      ),
    }))
    .filter((x) => /^[a-z0-9_]{1,60}$/.test(x.series) && x.years.length > 0)
    .sort((a, b) => a.series.localeCompare(b.series));
}

/** One court_jb_districts row ({id, item, source_url}) or null when it is not a district series. */
export function parseHubDistrict(raw: unknown): HubDistrict | null {
  const r = obj(raw);
  const item = obj(r?.["item"]);
  if (!r || !item) return null;
  const courtId = typeof item["court_id"] === "string" ? item["court_id"] : r["id"];
  if (typeof courtId !== "string" || !COURT.test(courtId)) return null;
  const years = (Array.isArray(item["years"]) ? item["years"] : []).filter(
    (y): y is number => Number.isInteger(y),
  );
  if (!years.length) return null;
  const rawSeries = obj(item["series"]) ?? {};
  const dashes = yearMap(item["dash"]);
  const dashed = new Map(dashes.map((d) => [d.series, new Set(d.years)]));
  const series = {} as Record<HubSeriesKey, (number | null)[]>;
  for (const key of KEYS) {
    const vals = Array.isArray(rawSeries[key]) ? (rawSeries[key] as unknown[]) : [];
    series[key] = years.map((y, i) => {
      const v = vals[i];
      return isNum(v) && !dashed.get(key)?.has(y) ? v : null;
    });
  }
  const title = typeof item["title"] === "string" ? item["title"] : courtId;
  return {
    courtId,
    name: title.replace(/^U\.S\. District Court, /, ""),
    years,
    series,
    unreconciled: yearMap(item["unreconciled_years"]),
    dashes,
    sourceUrl:
      typeof r["source_url"] === "string" && /^https:\/\//.test(r["source_url"])
        ? r["source_url"]
        : null,
  };
}

export const fy = (y: number) => `FY${y}`;

/**
 * Plain notes for the series a chart shows: "MDL actions pending: FY2011 did not reconcile with the table total".
 * Series the chart does not show are counted, not listed, so a cumulative-column mismatch does not read as a
 * problem with the pending counts.
 */
export function reconciliationNotes(
  d: Pick<HubDistrict, "unreconciled" | "dashes">,
  shown: readonly HubSeriesKey[],
): { shown: string[]; otherSeries: number } {
  const set = new Set<string>(shown);
  const label = (s: string) => HUB_SERIES_LABEL[s as HubSeriesKey] ?? s.replace(/_/g, " ");
  const notes: string[] = [];
  for (const u of d.unreconciled)
    if (set.has(u.series))
      notes.push(
        `${label(u.series)}: ${u.years.map(fy).join(", ")} did not reconcile with the published table total`,
      );
  for (const x of d.dashes)
    if (set.has(x.series))
      notes.push(`${label(x.series)}: ${x.years.map(fy).join(", ")} printed as a dash (Not recorded)`);
  return { shown: notes, otherSeries: d.unreconciled.filter((u) => !set.has(u.series)).length };
}

export type HubYear = { year: number; values: Record<string, number | null> };

/** The value of one series in one fiscal year, or null. */
export function valueAt(d: HubDistrict, key: HubSeriesKey, year: number): number | null {
  const i = d.years.indexOf(year);
  return i < 0 ? null : (d.series[key][i] ?? null);
}

export function latestYear(districts: readonly HubDistrict[]): number | null {
  let max: number | null = null;
  for (const d of districts) for (const y of d.years) if (max === null || y > max) max = y;
  return max;
}

/** Districts ranked by pending MDL actions in `year`; districts with no recorded value are left out. */
export function rankHubs(districts: readonly HubDistrict[], year: number) {
  return districts
    .map((d) => ({
      d,
      pending: valueAt(d, "mdl_pending", year),
      share: valueAt(d, "mdl_pending_share_of_national_pct", year),
    }))
    .filter((x): x is { d: HubDistrict; pending: number; share: number | null } => x.pending !== null)
    .sort((a, b) => b.pending - a.pending || a.d.courtId.localeCompare(b.d.courtId));
}

export type HubSummary = {
  year: number;
  top: { courtId: string; name: string; pending: number; share: number | null } | null;
  /** Fewest districts whose published shares reach 75% of national pending MDL actions; null when shares are missing. */
  districtsFor75: number | null;
  /** Pending actions of the top district five fiscal years earlier, for the change KPI. */
  topFiveYearsEarlier: number | null;
  districtsWithPending: number;
};

export function hubSummary(districts: readonly HubDistrict[], year: number): HubSummary {
  const ranked = rankHubs(districts, year);
  const first = ranked[0];
  let cum = 0;
  let districtsFor75: number | null = null;
  const byShare = ranked
    .map((r) => r.share)
    .filter(isNum)
    .sort((a, b) => b - a);
  if (byShare.length === ranked.length && byShare.length > 0)
    for (let i = 0; i < byShare.length; i++) {
      cum += byShare[i]!;
      if (cum >= 75) {
        districtsFor75 = i + 1;
        break;
      }
    }
  return {
    year,
    top: first
      ? { courtId: first.d.courtId, name: first.d.name, pending: first.pending, share: first.share }
      : null,
    districtsFor75,
    topFiveYearsEarlier: first ? valueAt(first.d, "mdl_pending", year - 5) : null,
    districtsWithPending: ranked.filter((r) => r.pending > 0).length,
  };
}

/** Rows for a multi-line chart: one row per fiscal year, one key per district (court id). */
export function hubTrendRows(
  districts: readonly HubDistrict[],
  key: HubSeriesKey = "mdl_pending",
): Record<string, string | number | null>[] {
  const years = [...new Set(districts.flatMap((d) => d.years))].sort((a, b) => a - b);
  return years.map((y) => {
    const row: Record<string, string | number | null> = { fy: fy(y) };
    for (const d of districts) row[d.courtId] = valueAt(d, key, y);
    return row;
  });
}
