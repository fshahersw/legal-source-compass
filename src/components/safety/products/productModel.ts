/**
 * Shapes of the safety/1 read RPCs (database/contracts/safety-signals-v1.sql) and the pure view model of the product and
 * device pages: series labels, month/year aggregation for the timeline, the period × term heatmap and record columns.
 * Client-safe and tested (productModel.test.ts). A value the source does not give is null ("Not recorded"), never 0;
 * a month inside a stored series' window that the source omits is 0 (openFDA date counts omit empty months).
 */
import type { PeriodAxis, TrendSeriesInput } from "@/components/charts/series";
import type { Json } from "@/lib/external/json";

export const NOT_RECORDED = "Not recorded";

export type SubjectType = "product" | "device_code" | "mdl_group" | "national";

export type SafetySubjectRow = {
  id: string;
  subject_type: SubjectType;
  kind: string;
  label: string;
  keys: Record<string, Json>;
  rank: number | null;
  reports_total: number | null;
  as_of: string | null;
  source_id: string;
  mdls: number[];
};

export type SafetySubjectList = {
  total: number;
  rows: SafetySubjectRow[];
  limit: number;
  offset: number;
};

export type MdlLink = {
  mdl: number;
  relation: "mdl_group" | "named_product";
  title: string;
  title_tokens: string[];
  title_source_dataset: string;
  title_source_url: string;
  basis: string;
  basis_note: string;
};

export type SubjectSeries = {
  series: string;
  timeline_series: string | null;
  unit: string;
  source_id: string;
  query_url: string;
  method: string;
  coverage_from: string;
  coverage_to: string;
  retrieved_at: string;
  total: number;
  caveat: string;
  vals: number[];
};

export type BreakdownRow = { term: string; value: number; serious: number | null };

export type SubjectBreakdown = {
  period: string;
  limit_n: number;
  returned: number;
  truncated: boolean;
  query_url: string;
  retrieved_at: string;
  rows: BreakdownRow[];
};

export type SafetySubjectProfile = {
  subject: {
    id: string;
    subject_type: SubjectType;
    kind: string;
    label: string;
    keys: Record<string, Json>;
    search: Record<string, Json>;
    rank: number | null;
    reports_total: number | null;
    as_of: string | null;
    source_id: string;
    source_url: string;
    source_label: string | null;
    caveat: string;
  };
  mdls: MdlLink[];
  series: SubjectSeries[];
  breakdowns: Record<string, SubjectBreakdown>;
  periods: { dim: string; period: string }[];
  records: { maude: number; nhtsa: number };
};

export type SafetyBreakdown = {
  meta: {
    limit_n: number;
    returned: number;
    truncated: boolean;
    query_url: string;
    retrieved_at: string;
  } | null;
  rows: BreakdownRow[];
};

export type SafetyTermPeriods = {
  terms: string[];
  periods: {
    period: string;
    limit_n: number;
    returned: number;
    truncated: boolean;
    query_url: string;
  }[];
  cells: [string, string, number, number | null][];
};

export type SafetyRecord = { [key: string]: Json } & {
  id: string | number;
  date: string | null;
  source_url: string;
};

export type SafetyRecordPage = {
  source: string;
  total: number;
  capped: boolean;
  rows: SafetyRecord[];
  limit: number;
  offset: number;
  caveat: string;
};

/** One row of public.product_signals_v1 (the shape VIZ-B's product signal timeline reads). */
export type SafetySignalRow = {
  series: string;
  month: string;
  value: number;
  unit: string;
  source_dataset: string;
  source_url: string;
  basis: string;
};

export type SafetyCompanyProfile = {
  name: string;
  merged_across_sources: false;
  identifiers: {
    cms_open_payments_ids: string[];
    insights_entities: { type: string; id: string; label: string; href: string | null }[];
  };
  cfpb: {
    by_year: Record<string, number>;
    top_products: { product: string; complaints: number }[];
    top_issues: { issue: string; complaints: number }[];
    caveat: string;
  } | null;
  osha: {
    inspections: number;
    first_open: string | null;
    last_open: string | null;
    violations: number;
    current_penalty: number | null;
  } | null;
  open_payments: {
    by_year: Record<string, { records: number; amount_usd: number }>;
    top_products: { product: string; amount_usd: number }[];
  } | null;
  nhtsa: {
    complaints: number;
    crash: number;
    fire: number;
    injured: number | null;
    deaths: number | null;
    first: string | null;
    last: string | null;
    caveat: string;
  } | null;
  maude: { reports_in_stored_records: number; scope: string; caveat: string } | null;
};

// ------------------------------------------------------------------------------------------------ labels
const SERIES_LABELS: Record<string, string> = {
  faers_reports: "All reports",
  faers_serious: "Serious",
  faers_death: "Death reported",
  faers_hospitalization: "Hospitalization",
  faers_life_threatening: "Life-threatening",
  faers_disabling: "Disability",
  faers_congenital_anomaly: "Congenital anomaly",
  faers_other_serious: "Other serious",
  maude_reports: "All device reports",
  maude_death: "Death",
  maude_injury: "Injury",
  maude_malfunction: "Malfunction",
  caers_reports: "All reports",
  enforcement_reports: "FDA enforcement reports",
  device_recalls: "FDA device recalls",
  nhtsa_complaints: "All complaints",
  nhtsa_complaints_crash: "Reporting a crash",
  nhtsa_complaints_fire: "Reporting a fire",
  nhtsa_complaints_injury: "Reporting an injury or death",
};

export const seriesLabel = (s: string) => SERIES_LABELS[s] ?? s.replace(/_/g, " ");

const SOURCE_LABELS: Record<string, string> = {
  openfda_faers: "FDA Adverse Event Reporting System (FAERS) via openFDA",
  openfda_maude: "FDA MAUDE device reports via openFDA",
  openfda_caers: "FDA CAERS food and cosmetic reports via openFDA",
  openfda_enforcement: "FDA enforcement reports via openFDA",
  openfda_device_recall: "FDA device recalls via openFDA",
  nhtsa_complaints: "NHTSA vehicle complaints",
};
export const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;

const SOURCE_SHORT: Record<string, string> = {
  openfda_faers: "FAERS",
  openfda_maude: "MAUDE",
  openfda_caers: "CAERS",
  openfda_enforcement: "FDA enforcement",
  openfda_device_recall: "FDA recalls",
  nhtsa_complaints: "NHTSA",
};
/** A short name for a KPI tile (the full name goes in its note). */
export const sourceShort = (s: string | null | undefined) => (s ? (SOURCE_SHORT[s] ?? s) : null);

const BASIS_LABELS: Record<string, string> = {
  title_names_product: "The MDL title names the product",
  title_names_brand: "The MDL title names the brand",
  title_names_class: "The MDL title names the class",
  title_names_manufacturer_and_device: "The MDL title names the maker and device",
  title_names_vehicle_and_component: "The MDL title names the vehicle and component",
};
export const basisLabel = (b: string) => BASIS_LABELS[b] ?? b;

export const KIND_LABELS: Record<string, string> = {
  drug: "Drug",
  device: "Device",
  food: "Food",
  cosmetic: "Cosmetic",
  vehicle: "Vehicle",
  all: "All products",
};

export const TYPE_LABELS: Record<SubjectType, string> = {
  mdl_group: "MDL product group",
  product: "Drug (FAERS generic name)",
  device_code: "Device product code (MAUDE)",
  national: "National totals",
};

export function formatCount(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : NOT_RECORDED;
}

export function formatMonth(m: string): string {
  if (!/^\d{4}-\d{2}$/.test(m)) return m;
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

// ------------------------------------------------------------------------------------------------ months
export function monthAdd(m: string, k: number): string {
  const idx = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + k;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** The months of a stored series with their values (vals[0] is coverage_from). */
export function seriesMonths(
  s: Pick<SubjectSeries, "coverage_from" | "vals">,
): { month: string; value: number }[] {
  return s.vals.map((value, i) => ({ month: monthAdd(s.coverage_from, i), value }));
}

/** The main series of a subject: reports for FAERS/MAUDE/CAERS, complaints for NHTSA. */
export function mainSeries(series: readonly SubjectSeries[]): SubjectSeries | null {
  for (const name of ["faers_reports", "maude_reports", "caers_reports", "nhtsa_complaints"]) {
    const s = series.find((x) => x.series === name);
    if (s) return s;
  }
  return null;
}

/** Last-12 / previous-12 month totals of a series (null when the window is shorter). */
export function recentChange(s: SubjectSeries | null): {
  last12: number | null;
  prev12: number | null;
  pct: number | null;
} {
  if (!s || s.vals.length < 12) return { last12: null, prev12: null, pct: null };
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const last12 = sum(s.vals.slice(-12));
  if (s.vals.length < 24) return { last12, prev12: null, pct: null };
  const prev12 = sum(s.vals.slice(-24, -12));
  return {
    last12,
    prev12,
    pct: prev12 > 0 ? Math.round(((last12 - prev12) / prev12) * 1000) / 10 : null,
  };
}

export type Grain = "month" | "year";

/**
 * Timeline data for the chosen series: monthly keys ("2024-06") or calendar years ("2024"). A year the source data end
 * inside (or start inside) is partial. Series with different windows share one axis; a key outside a series' window is
 * absent for it (a gap), never 0.
 */
export function timeline(
  all: readonly SubjectSeries[],
  pick: readonly string[],
  grain: Grain,
): { axis: PeriodAxis; series: TrendSeriesInput[] } {
  const chosen = pick
    .map((p) => all.find((s) => s.series === p))
    .filter((s): s is SubjectSeries => !!s);
  const keys = new Set<string>();
  const out: TrendSeriesInput[] = chosen.map((s) => {
    const months = seriesMonths(s);
    if (grain === "month") {
      for (const m of months) keys.add(m.month);
      return {
        id: s.series,
        label: seriesLabel(s.series),
        points: months.map((m) => ({ key: m.month, value: m.value })),
      };
    }
    const years = new Map<string, { v: number; n: number }>();
    for (const m of months) {
      const y = m.month.slice(0, 4);
      const e = years.get(y) ?? { v: 0, n: 0 };
      e.v += m.value;
      e.n += 1;
      years.set(y, e);
    }
    for (const y of years.keys()) keys.add(y);
    return {
      id: s.series,
      label: seriesLabel(s.series),
      points: [...years.entries()].map(([y, e]) => ({ key: y, value: e.v, partial: e.n < 12 })),
    };
  });
  const sorted = [...keys].sort();
  // fill gap keys between the first and last so the axis is continuous
  const full: string[] = [];
  if (sorted.length) {
    if (grain === "month")
      for (let m = sorted[0]!; m <= sorted[sorted.length - 1]!; m = monthAdd(m, 1)) full.push(m);
    else
      for (let y = Number(sorted[0]); y <= Number(sorted[sorted.length - 1]); y++)
        full.push(String(y));
  }
  const axis: PeriodAxis = {
    keys: full,
    label: (k) => (grain === "month" ? formatMonth(k) : k),
    tick: (k) => (grain === "month" ? k.slice(0, 4) : k),
    showTick: (k, i) =>
      grain === "month"
        ? k.endsWith("-01") && Number(k.slice(0, 4)) % (full.length > 180 ? 5 : 2) === 0
        : i % Math.max(1, Math.ceil(full.length / 12)) === 0,
  };
  return { axis, series: out };
}

/** The series groups a subject page offers as timeline toggles. */
export function seriesGroups(
  series: readonly SubjectSeries[],
): { id: string; label: string; series: string[] }[] {
  const has = (s: string) => series.some((x) => x.series === s);
  const groups: { id: string; label: string; series: string[] }[] = [];
  const faers = ["faers_reports", "faers_serious", "faers_death"].filter(has);
  if (faers.length) groups.push({ id: "faers", label: "Reports and seriousness", series: faers });
  const outcomes = [
    "faers_hospitalization",
    "faers_life_threatening",
    "faers_disabling",
    "faers_congenital_anomaly",
    "faers_other_serious",
  ].filter(has);
  if (outcomes.length) groups.push({ id: "outcomes", label: "Serious outcomes", series: outcomes });
  const maude = ["maude_reports", "maude_injury", "maude_death", "maude_malfunction"].filter(has);
  if (maude.length)
    groups.push({ id: "maude", label: "Device reports by event type", series: maude });
  if (has("caers_reports"))
    groups.push({ id: "caers", label: "Food / cosmetic reports", series: ["caers_reports"] });
  const nhtsa = [
    "nhtsa_complaints",
    "nhtsa_complaints_crash",
    "nhtsa_complaints_fire",
    "nhtsa_complaints_injury",
  ].filter(has);
  if (nhtsa.length) groups.push({ id: "nhtsa", label: "Vehicle complaints", series: nhtsa });
  const recalls = ["enforcement_reports", "device_recalls"].filter(has);
  if (recalls.length)
    groups.push({ id: "recalls", label: "Recalls and enforcement", series: recalls });
  return groups;
}

// ------------------------------------------------------------------------------------------------ heatmap
/**
 * Period × term matrix. A term absent from a period whose breakdown returned fewer terms than requested is 0 (complete);
 * absent from a truncated period it is not recorded (null), never 0.
 */
export function termMatrix(data: SafetyTermPeriods | null): {
  rows: { id: string; label: string }[];
  columns: { id: string; label: string }[];
  value: (term: string, period: string) => number | null;
  serious: (term: string, period: string) => number | null;
  truncated: Set<string>;
} {
  const cells = new Map<string, [number, number | null]>();
  for (const [period, term, v, s] of data?.cells ?? []) cells.set(`${term}\u0000${period}`, [v, s]);
  const truncated = new Set((data?.periods ?? []).filter((p) => p.truncated).map((p) => p.period));
  const known = new Set((data?.periods ?? []).map((p) => p.period));
  return {
    rows: (data?.terms ?? []).map((t) => ({ id: t, label: t })),
    columns: (data?.periods ?? []).map((p) => ({ id: p.period, label: p.period })),
    value: (term, period) => {
      const c = cells.get(`${term}\u0000${period}`);
      if (c) return c[0];
      if (!known.has(period) || truncated.has(period)) return null;
      return 0;
    },
    serious: (term, period) => cells.get(`${term}\u0000${period}`)?.[1] ?? null,
    truncated,
  };
}

/** The first of the latest `n` stored periods of one dimension (null: none stored), so a heatmap asks for exactly the
 * periods it shows and its rows are the terms most reported in them. */
export function windowStart(
  periods: { dim: string; period: string }[],
  dim: string,
  n: number,
): string | null {
  const own = periods
    .filter((p) => p.dim === dim && p.period !== "all")
    .map((p) => p.period)
    .sort();
  return own.length ? own[Math.max(0, own.length - n)]! : null;
}

/** The breakdown dimension a subject's "reactions / problems" tab shows. */
export function primaryDim(
  profile: Pick<SafetySubjectProfile, "breakdowns" | "subject">,
): "meddra_pt" | "device_problem" | null {
  if (profile.breakdowns["meddra_pt"]) return "meddra_pt";
  if (profile.breakdowns["device_problem"]) return "device_problem";
  return null;
}

/** Which record list a subject has (MAUDE reports for device groups, NHTSA complaints for vehicle groups). */
export function recordSource(
  profile: Pick<SafetySubjectProfile, "records">,
): "maude" | "nhtsa" | null {
  if (profile.records.maude > 0) return "maude";
  if (profile.records.nhtsa > 0) return "nhtsa";
  return null;
}

/** The product page path of a subject id ("faers:docetaxel" → "/safety/products/faers:docetaxel"). */
export const subjectHref = (id: string) => `/safety/products/${encodeURIComponent(id)}`;
