/**
 * JPML statistics series: wire types, defensive parsers for the stored rows and pure chart helpers. Client-safe; no
 * network. The figures are the Panel's printed values or the builder's stated formulas
 * (scripts/enrichment/jpml_history/series_metrics.py); nothing here estimates or fills a gap.
 */
import type { PeriodAxis, TrendDatum, TrendSeriesInput } from "@/components/charts";

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s && ISO.test(s) ? s : null;
};
/** Only official JPML file URLs and in-app record paths are passed on. */
export function safeSourceUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (s.startsWith("https://www.jpml.uscourts.gov/")) return s;
  if (/^\/(records|matters|courts|sources)\/[\w:./?=-]+$/.test(s)) return s;
  return null;
}

export const JPML_PAGES = {
  archive: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
  current: "https://www.jpml.uscourts.gov/pending-mdls-0",
  quarterly: "https://www.jpml.uscourts.gov/mdl-quarterly-caseload-summary",
  statistics: "https://www.jpml.uscourts.gov/statistics-info",
} as const;

export type NationalPoint = {
  date: string;
  mdls: number;
  pending: number;
  total: number;
  districts: number | null;
  judges: number | null;
  top10SharePct: number | null;
  hhiDistrict: number | null;
  leadDistrict: string | null;
  leadDistrictSharePct: number | null;
  /** Actions added to MDLs listed in both this and the previous report; only for reports one month apart. */
  addedContinuing: number | null;
  entered: number | null;
  left: number | null;
  monthsSincePrevious: number | null;
  filtersStandard: boolean;
  sourceUrl: string | null;
};

export type Gap = { after: string; before: string; monthsMissing: number };
export type DatedValue = { date: string; value: number };

export type CircuitSeries = {
  slug: string;
  name: string;
  points: {
    date: string;
    districts: number;
    mdls: number;
    pending: number;
    total: number;
    sharePct: number | null;
  }[];
};

export type EntityPoint = {
  date: string;
  mdls: number;
  pending: number;
  total: number;
  sharePct: number | null;
};
export type EntitySeries = {
  id: string;
  name: string;
  courtId: string | null;
  courtLabel: string | null;
  points: EntityPoint[];
};

export type National = {
  monthly: NationalPoint[];
  quarterEnd: NationalPoint[];
  gaps: Gap[];
  heldReports: number;
  fiscalYear: DatedValue[];
  circuits: CircuitSeries[];
  districts: EntitySeries[];
  judges: EntitySeries[];
  judgesTotal: number;
};

export function parseNationalPoint(v: unknown): NationalPoint | null {
  const o = obj(v);
  if (!o) return null;
  const date = isoDate(o["date"]);
  const mdls = num(o["mdls"]);
  const pending = num(o["pending"]);
  const total = num(o["total"]);
  if (!date || mdls === null || pending === null || total === null) return null;
  return {
    date,
    mdls,
    pending,
    total,
    districts: num(o["districts"]),
    judges: num(o["judges"]),
    top10SharePct: num(o["top10_share_pct"]),
    hhiDistrict: num(o["hhi_district"]),
    leadDistrict: str(o["lead_district"]),
    leadDistrictSharePct: num(o["lead_district_share_pct"]),
    addedContinuing: num(o["continuing_total_change"]),
    entered: num(o["entered"]),
    left: num(o["left"]),
    monthsSincePrevious: num(o["months_since_previous"]),
    filtersStandard: o["filters_standard"] !== false,
    sourceUrl: safeSourceUrl(o["source_url"]),
  };
}

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);

export function parseOverview(
  item: unknown,
): Omit<National, "fiscalYear" | "circuits" | "districts" | "judges" | "judgesTotal"> | null {
  const o = obj(item);
  if (!o) return null;
  const monthly = arr(o["monthly"]).flatMap((p) => parseNationalPoint(p) ?? []);
  if (!monthly.length) return null;
  const quarterEnd = arr(o["quarter_end"]).flatMap((p) => parseNationalPoint(p) ?? []);
  const gaps = arr(o["monthly_gaps"]).flatMap((g) => {
    const x = obj(g);
    const after = isoDate(x?.["after"]);
    const before = isoDate(x?.["before"]);
    const m = num(x?.["months_missing"]);
    return after && before && m !== null ? [{ after, before, monthsMissing: m }] : [];
  });
  return {
    monthly: monthly.sort(byDate),
    quarterEnd: quarterEnd.sort(byDate),
    gaps,
    heldReports: arr(o["held_reports"]).length,
  };
}

export function parseDatedValues(v: unknown): DatedValue[] {
  return arr(v)
    .flatMap((p) => {
      const o = obj(p);
      const date = isoDate(o?.["date"]);
      const value = num(o?.["value"]);
      return date && value !== null ? [{ date, value }] : [];
    })
    .sort(byDate);
}

export function parseCircuit(item: unknown): CircuitSeries | null {
  const o = obj(item);
  const c = obj(o?.["circuit"]);
  const slug = str(c?.["slug"]);
  const name = str(c?.["name"]);
  if (!o || !slug || !name) return null;
  const points = arr(o["series"]).flatMap((p) => {
    const x = obj(p);
    const date = isoDate(x?.["date"]);
    const vals = ["districts", "mdls", "pending", "total"].map((k) => num(x?.[k]));
    if (!date || vals.some((v) => v === null)) return [];
    const [districts, mdls, pending, total] = vals as number[];
    return [
      {
        date,
        districts: districts!,
        mdls: mdls!,
        pending: pending!,
        total: total!,
        sharePct: num(x?.["pending_share_pct"]),
      },
    ];
  });
  return points.length ? { slug, name, points: points.sort(byDate) } : null;
}

function parseEntityPoints(v: unknown): EntityPoint[] {
  return arr(v)
    .flatMap((p) => {
      const x = obj(p);
      const date = isoDate(x?.["date"]);
      const mdls = num(x?.["mdls"]);
      const pending = num(x?.["pending"]);
      const total = num(x?.["total"]);
      if (!date || mdls === null || pending === null || total === null) return [];
      return [{ date, mdls, pending, total, sharePct: num(x?.["share_pct"]) }];
    })
    .sort(byDate);
}

/** A row of jpml_transferee_series (district:<code> or judge:<id>); null when malformed. */
export function parseEntity(id: unknown, item: unknown): EntitySeries | null {
  const rid = str(id);
  const o = obj(item);
  if (!rid || !o) return null;
  const points = parseEntityPoints(o["series"]);
  if (!points.length) return null;
  if (rid.startsWith("district:")) {
    const code = str(o["district"]);
    const court = obj(o["court"]);
    const courtId = str(court?.["court_id"]);
    if (!code) return null;
    return {
      id: rid,
      name: code,
      courtId: courtId && /^[a-z0-9]+$/.test(courtId) ? courtId : null,
      courtLabel: str(court?.["label"]),
      points,
    };
  }
  if (rid.startsWith("judge:")) {
    const name = str(o["judge"]);
    return name ? { id: rid, name, courtId: null, courtLabel: null, points } : null;
  }
  return null;
}

/** Entities listed in the latest report, largest pending first (ties by name), at most n. */
export function topAtLatest(entities: readonly EntitySeries[], latest: string, n: number) {
  return entities
    .flatMap((e) => {
      const p = e.points.find((x) => x.date === latest);
      return p ? [{ e, pending: p.pending }] : [];
    })
    .sort((a, b) => b.pending - a.pending || a.e.name.localeCompare(b.e.name))
    .slice(0, n)
    .map((x) => x.e);
}

// ------------------------------------------------------------------ per-MDL series

export type MdlRun = { value: string; from: string; to: string; reports: number };
export type MdlPoint = {
  date: string;
  pending: number;
  total: number;
  district: string | null;
  judges: string[];
  title: string | null;
  circuit?: string | null;
};
export type MdlSeries = {
  mdl: number;
  status: string;
  latestMonthlyReport: string | null;
  points: MdlPoint[];
  quarterEnd: MdlPoint[];
  titleRuns: MdlRun[];
  districtRuns: MdlRun[];
  judgeRuns: MdlRun[];
  firstListed: string | null;
  lastListed: string | null;
  reportsListed: number;
  reportsInSpan: number;
  absent: string[];
  peak: { value: number; date: string } | null;
  added: { added: number; intervals: number; decreases: number; decreaseSum: number } | null;
  changes: {
    from: string;
    to: string;
    monthsApart: number;
    pendingChange: number | null;
    totalChange: number | null;
  }[];
  dateTransferred: string | null;
  monthsSinceTransfer: number | null;
  sourceUrl: string | null;
};

function parseRuns(v: unknown): MdlRun[] {
  return arr(v).flatMap((r) => {
    const o = obj(r);
    const from = isoDate(o?.["from"]);
    const to = isoDate(o?.["to"]);
    const reports = num(o?.["reports"]);
    const value = typeof o?.["value"] === "string" ? (o["value"] as string) : null;
    return from && to && reports !== null && value !== null ? [{ value, from, to, reports }] : [];
  });
}

export function parseMdlSeries(mdl: number, item: unknown, sourceUrl: unknown): MdlSeries | null {
  const s = obj(obj(item)?.["series"]);
  if (!s || num(s["mdl"]) !== mdl) return null;
  const titles = arr(s["titles"]).map((t) => (typeof t === "string" ? t : null));
  const point = (p: unknown): MdlPoint | null => {
    const o = obj(p);
    const date = isoDate(o?.["date"]);
    const pending = num(o?.["pending"]);
    const total = num(o?.["total"]);
    if (!date || pending === null || total === null) return null;
    const t = num(o?.["t"]);
    return {
      date,
      pending,
      total,
      district: str(o?.["district"]),
      judges: arr(o?.["judges"]).flatMap((j) => (typeof j === "string" ? [j] : [])),
      title: t !== null ? (titles[t] ?? null) : null,
      circuit: str(o?.["circuit"]),
    };
  };
  const points = arr(s["points"])
    .flatMap((p) => point(p) ?? [])
    .sort(byDate);
  const quarterEnd = arr(s["quarter_end_points"])
    .flatMap((p) => point(p) ?? [])
    .sort(byDate);
  if (!points.length && !quarterEnd.length) return null;
  const pk = obj(s["peak"]);
  const ad = obj(s["actions_added"]);
  const peakValue = num(pk?.["value"]);
  const peakDate = isoDate(pk?.["date"]);
  return {
    mdl,
    status: str(s["status"]) ?? "unknown",
    latestMonthlyReport: isoDate(s["latest_monthly_report"]),
    points,
    quarterEnd,
    titleRuns: parseRuns(s["title_runs"]),
    districtRuns: parseRuns(s["district_runs"]),
    judgeRuns: parseRuns(s["judge_runs"]),
    firstListed: isoDate(s["first_listed"]),
    lastListed: isoDate(s["last_listed"]),
    reportsListed: num(s["reports_listed"]) ?? points.length,
    reportsInSpan: num(s["reports_in_span"]) ?? points.length,
    absent: arr(s["absent_reports_in_span"]).flatMap((d) => isoDate(d) ?? []),
    peak: peakValue !== null && peakDate ? { value: peakValue, date: peakDate } : null,
    added:
      ad && num(ad["added"]) !== null
        ? {
            added: num(ad["added"])!,
            intervals: num(ad["intervals"]) ?? 0,
            decreases: num(ad["decreases"]) ?? 0,
            decreaseSum: num(ad["decrease_sum"]) ?? 0,
          }
        : null,
    changes: arr(s["changes"]).flatMap((c) => {
      const o = obj(c);
      const from = isoDate(o?.["from"]);
      const to = isoDate(o?.["to"]);
      const m = num(o?.["months_apart"]);
      return from && to && m !== null
        ? [
            {
              from,
              to,
              monthsApart: m,
              pendingChange: num(o?.["pending_change"]),
              totalChange: num(o?.["total_change"]),
            },
          ]
        : [];
    }),
    dateTransferred: isoDate(s["date_transferred"]),
    monthsSinceTransfer: num(s["months_since_transfer_at_latest_point"]),
    sourceUrl: safeSourceUrl(sourceUrl),
  };
}

// ------------------------------------------------------------------ chart helpers

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Every calendar month from the month of `first` to the month of `last` ("YYYY-MM"), gaps included. */
export function monthKeys(first: string, last: string): string[] {
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  const ey = Number(last.slice(0, 4));
  const em = Number(last.slice(5, 7));
  const out: string[] = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 1200) break;
  }
  return out;
}

export function monthLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return `${MONTHS[m - 1] ?? key} ${key.slice(0, 4)}`;
}

export function longDate(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return `${MONTHS[m - 1] ?? ""} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
}

/**
 * Monthly axis with a tick on January of every `step`-th year: the smallest step of 1–5 years that keeps the number of
 * year ticks at or under `maxTicks` (8 for a full-width chart, fewer for small multiples).
 */
export function monthlyAxis(keys: readonly string[], maxTicks = 8): PeriodAxis {
  const years = new Set(keys.map((k) => k.slice(0, 4))).size;
  const step = [1, 2, 3, 4, 5].find((s) => Math.ceil(years / s) <= maxTicks) ?? 5;
  const firstYear = Number(keys[0]?.slice(0, 4) ?? 0);
  return {
    keys,
    label: monthLabel,
    tick: (k) =>
      k.endsWith("-01")
        ? k.slice(0, 4)
        : `${MONTHS[Number(k.slice(5, 7)) - 1]?.slice(0, 3)} ${k.slice(0, 4)}`,
    showTick: (k, i) =>
      years <= 2
        ? i % 3 === 0
        : k.endsWith("-01") && (Number(k.slice(0, 4)) - firstYear) % step === 0,
  };
}

/** One datum per held report, keyed by its calendar month; months without a held report are absent (gaps). */
export function monthlySeries<T extends { date: string }>(
  id: string,
  label: string,
  points: readonly T[],
  value: (p: T) => number | null,
): TrendSeriesInput {
  const seen = new Set<string>();
  const out: TrendDatum[] = [];
  for (const p of points) {
    const key = p.date.slice(0, 7);
    if (seen.has(key)) continue; // one report per month; the builder refuses a second one
    seen.add(key);
    out.push({ key, value: value(p) });
  }
  return { id, label, points: out };
}

export function yearAxis(keys: readonly string[]): PeriodAxis {
  return {
    keys,
    label: (k) => `FY${k} (year ending Sept. 30, ${k})`,
    tick: (k) => `FY${k.slice(2)}`,
    showTick: (_k, i) => keys.length <= 12 || i % Math.ceil(keys.length / 9) === 0,
  };
}

/** Points whose month falls after a gap of more than `months` missing months (for footnotes). */
export function longGaps(gaps: readonly Gap[], months = 6): Gap[] {
  return gaps.filter((g) => g.monthsMissing > months);
}

export const fmtInt = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v).toLocaleString("en-US")
    : "Not recorded";
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}%` : "Not recorded";
export const fmtSigned = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-US")}`
    : "Not recorded";
