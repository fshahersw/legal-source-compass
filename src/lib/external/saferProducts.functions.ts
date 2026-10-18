/**
 * SaferProducts.gov consumer-report aggregates (saferproducts_reports_series, saferproducts_products,
 * saferproducts_companies, saferproducts_recalls_crosscheck), built by scripts/enrichment/saferproducts from CPSC's
 * public database export.
 *
 * EVERY count here is a count of UNVERIFIED consumer-submitted reports. CPSC publishes a report after
 * minimum-information checks and does not verify every report; a report is not a finding of defect, causation or
 * incidence. Only aggregates are stored: no report number, free text or victim detail exists in these datasets.
 * Stored JSON is validated here; malformed rows are dropped, never repaired.
 */
import { createServerFn } from "@tanstack/react-start";
import { restGet } from "./rest.server";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const nonNeg = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 ? n : null;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY = /^\d{2}-\d{2}$/;

// ------------------------------------------------------------------------------------------ types

export type SpSeverity = {
  death: number;
  injury: number;
  incidentNoInjury: number;
  noIncident: number;
  unspecified: number;
};

export type SpYearPoint = { year: number; reports: number; partial: boolean };

export type SpYear = SpYearPoint & {
  /** Percent change on the year before; null unless BOTH years are complete (the dataset's own rule). */
  yoyPct: number | null;
  /** false when this year or the one before it is partial. */
  yoyComparable: boolean;
};

export type SpYtd = {
  /** Month-day (MM-DD) of the latest publication; both windows run from 1 January to this day. */
  through: string;
  reports: number;
  priorYearSameWindow: number;
  changePct: number | null;
  baseYearSameWindow: number | null;
  changeVs2019Pct: number | null;
  excludingLargest: {
    company: string;
    removedReports: number;
    reports: number;
    priorYearSameWindow: number;
    changePct: number | null;
  } | null;
};

export type SpGrowth = {
  recentWindow: string;
  priorWindow: string;
  recent: number;
  prior: number;
  changePct: number;
  /** true only when both windows hold at least the dataset's minimum number of reports. */
  eligible: boolean;
  ratio: number | null;
  ci95: [number, number] | null;
  rank: number | null;
  rankOf: number | null;
};

export type SpCategory = {
  id: string;
  name: string;
  reports: number;
  sharePct: number | null;
  deaths: number | null;
  injuries: number | null;
  yearly: SpYearPoint[];
  growth: SpGrowth | null;
};

export type SaferProductsReports = {
  total: number;
  publicationWindow: { first: string; last: string } | null;
  reportWindow: { first: string; last: string } | null;
  retrieved: string | null;
  peak: { year: number; reports: number } | null;
  severity: SpSeverity | null;
  ageBands: { key: string; label: string; reports: number }[];
  ageNotRecorded: number | null;
  latestComplete: {
    year: number;
    reports: number;
    yoyPct: number | null;
    changeVs2019Pct: number | null;
  } | null;
  latestPartial: { year: number; reports: number; ytd: SpYtd | null } | null;
  lag: { median: number | null; p90: number | null; within30Pct: number | null } | null;
  commentRatePct: number | null;
  yearlyPublished: SpYear[];
  yearlyReported: SpYearPoint[];
  categories: SpCategory[];
  caveats: string[];
};

export type SpPrecision = {
  sampleSize: number;
  correct: number;
  precisionPct: number;
  wilson95: [number, number];
  round: string | null;
};

export type SpTheme = {
  theme: string;
  label: string;
  reports: number;
  sharePct: number | null;
  /** The measured precision of the wording rule; null when the dataset carries none (shown as Not recorded). */
  precision: SpPrecision | null;
};

export type SpGrowthRow = {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  code: string | null;
  reports: number;
  growth: SpGrowth;
  yearly: SpYearPoint[];
};

export type SpGrowthLevel = "type" | "subcategory" | "category";

export type SaferProductsSignals = {
  windows: { recent: string; prior: string; minReportsPerWindow: number | null } | null;
  levels: Record<
    SpGrowthLevel,
    { rows: SpGrowthRow[]; eligible: number | null; total: number | null }
  >;
  themes: SpTheme[];
  caveats: string[];
};

export type SpCompany = {
  id: string;
  name: string;
  role: "manufacturer" | "retailer";
  rank: number | null;
  reports: number;
  sharePct: number | null;
  deaths: number | null;
  injuries: number | null;
  /** Manufacturer comment rate; null for retailers (the field does not apply) and when not recorded. */
  commentRatePct: number | null;
  /** Spelling variants of this exact string, listed by the dataset and never merged into its counts. */
  variants: { name: string; reports: number }[];
  variantCount: number;
  yearly: SpYearPoint[];
  firstPublished: string | null;
  lastPublished: string | null;
  /** SEC company-profile CIK, only when the dataset recorded a unique exact-name match. */
  cik: string | null;
  secTitle: string | null;
  /** Company-name match to a recall firm (manufacturer strings only). Name equality, not the recalled product. */
  recallMatch: {
    recordId: string;
    level: string;
    recalls: number | null;
    firstRecall: string | null;
    lastRecall: string | null;
    reportsBeforeFirstRecall: number | null;
  } | null;
};

export type SpRecallCheck = {
  exportRecalls: number | null;
  matchedToCorpus: number | null;
  exportOnly: string[];
  reportsByLevel: {
    exact: number;
    normalised: number;
    locationStripped: number;
    none: number;
  } | null;
  nameStringsByLevel: {
    exact: number;
    normalised: number;
    locationStripped: number;
    none: number;
  } | null;
  productPairs: {
    pairs: number;
    recalls: number;
    pairedReportFirst: number | null;
  } | null;
};

export type SaferProductsCompanies = {
  companies: SpCompany[];
  recallCheck: SpRecallCheck | null;
  threshold: number | null;
  caveats: string[];
};

// ---------------------------------------------------------------------------------------- parsers

export function parseSeverity(raw: unknown): SpSeverity | null {
  const s = obj(raw);
  const death = nonNeg(s?.["death"]);
  const injury = nonNeg(s?.["injury"]);
  const incidentNoInjury = nonNeg(s?.["incident_no_injury"]);
  const noIncident = nonNeg(s?.["no_incident"]);
  const unspecified = nonNeg(s?.["unspecified"]);
  if (
    death == null ||
    injury == null ||
    incidentNoInjury == null ||
    noIncident == null ||
    unspecified == null
  )
    return null;
  return { death, injury, incidentNoInjury, noIncident, unspecified };
}

export function parseYearPoints(raw: unknown): SpYearPoint[] {
  const out: SpYearPoint[] = [];
  for (const entry of arr(raw)) {
    const r = obj(entry);
    const year = num(r?.["year"]);
    const reports = nonNeg(r?.["reports"]);
    if (!r || year == null || !Number.isInteger(year) || reports == null) continue;
    out.push({ year, reports, partial: r["partial"] === true });
  }
  return out.sort((a, b) => a.year - b.year);
}

function parseWindow(raw: unknown): { first: string; last: string } | null {
  const w = obj(raw);
  const first = strOrNull(w?.["first"]);
  const last = strOrNull(w?.["last"]);
  return first && last && ISO_DATE.test(first) && ISO_DATE.test(last) ? { first, last } : null;
}

export function parseGrowth(raw: unknown): SpGrowth | null {
  const g = obj(raw);
  const recent = nonNeg(g?.["recent_reports"]);
  const prior = nonNeg(g?.["prior_reports"]);
  const changePct = num(g?.["change_pct"]);
  const recentWindow = strOrNull(g?.["recent_window"]);
  const priorWindow = strOrNull(g?.["prior_window"]);
  if (!g || recent == null || prior == null || changePct == null || !recentWindow || !priorWindow)
    return null;
  const ci = arr(g["ratio_ci95"]);
  const lo = num(ci[0]);
  const hi = num(ci[1]);
  const rank = num(g["rank"]);
  const rankOf = num(g["rank_of"]);
  return {
    recentWindow,
    priorWindow,
    recent,
    prior,
    changePct,
    eligible: g["eligible"] === true,
    ratio: num(g["ratio"]),
    ci95: lo != null && hi != null && lo <= hi ? [lo, hi] : null,
    rank: rank != null && rank >= 1 ? rank : null,
    rankOf: rankOf != null && rankOf >= 1 ? rankOf : null,
  };
}

function parseYtd(raw: unknown): SpYtd | null {
  const y = obj(raw);
  const through = strOrNull(y?.["through"]);
  const reports = nonNeg(y?.["reports"]);
  const prior = nonNeg(y?.["prior_year_same_window"]);
  if (!y || !through || !MONTH_DAY.test(through) || reports == null || prior == null) return null;
  const ex = obj(y["excluding_largest_company"]);
  const exCompany = strOrNull(ex?.["company"]);
  const exRemoved = nonNeg(ex?.["removed_reports"]);
  const exReports = nonNeg(ex?.["reports"]);
  const exPrior = nonNeg(ex?.["prior_year_same_window"]);
  return {
    through,
    reports,
    priorYearSameWindow: prior,
    changePct: num(y["change_vs_prior_year_pct"]),
    baseYearSameWindow: nonNeg(y["base_year_same_window"]),
    changeVs2019Pct: num(y["change_vs_2019_pct"]),
    excludingLargest:
      ex && exCompany && exRemoved != null && exReports != null && exPrior != null
        ? {
            company: exCompany,
            removedReports: exRemoved,
            reports: exReports,
            priorYearSameWindow: exPrior,
            changePct: num(ex["change_vs_prior_year_pct"]),
          }
        : null,
  };
}

const AGE_BANDS: { key: string; label: string }[] = [
  { key: "under_1", label: "Under 1" },
  { key: "1_4", label: "1–4" },
  { key: "5_12", label: "5–12" },
  { key: "13_17", label: "13–17" },
  { key: "18_64", label: "18–64" },
  { key: "65_plus", label: "65 and over" },
];

export function parseCategory(row: {
  id?: unknown;
  cells?: unknown;
  yearly?: unknown;
  growth?: unknown;
}): SpCategory | null {
  const id = strOrNull(row.id);
  const c = obj(row.cells);
  const name = strOrNull(c?.["name"]);
  const reports = nonNeg(c?.["reports"]);
  if (!id || !c || !name || reports == null) return null;
  return {
    id,
    name,
    reports,
    sharePct: num(c["share_pct"]),
    deaths: nonNeg(c["deaths"]),
    injuries: nonNeg(c["injuries"]),
    yearly: parseYearPoints(row.yearly),
    growth: parseGrowth(row.growth),
  };
}

export type SpMeta = {
  publicationWindow: { first: string; last: string } | null;
  reportWindow: { first: string; last: string } | null;
  retrieved: string | null;
  caveats: string[];
  themeDefs: { theme: string; label: string; precision: SpPrecision | null }[];
};

export function parseSpMeta(raw: unknown): SpMeta {
  const m = obj(raw);
  return {
    publicationWindow: parseWindow(m?.["pw"]),
    reportWindow: parseWindow(m?.["rw"]),
    retrieved: strOrNull(m?.["retrieved"]),
    caveats: arr(m?.["caveats"]).flatMap((c) => {
      const s = strOrNull(c);
      return s ? [s] : [];
    }),
    themeDefs: arr(m?.["defs"]).flatMap((d) => {
      const r = obj(d);
      const theme = strOrNull(r?.["theme"]);
      const label = strOrNull(r?.["label"]);
      if (!r || !theme || !label) return [];
      return [{ theme, label, precision: parsePrecision(r["precision"]) }];
    }),
  };
}

function parsePrecision(raw: unknown): SpPrecision | null {
  const p = obj(raw);
  const sampleSize = num(p?.["sample_size"]);
  const correct = num(p?.["correct"]);
  const precisionPct = num(p?.["precision_pct"]);
  const w = arr(p?.["wilson95_pct"]);
  const lo = num(w[0]);
  const hi = num(w[1]);
  if (
    !p ||
    sampleSize == null ||
    sampleSize <= 0 ||
    correct == null ||
    correct < 0 ||
    correct > sampleSize ||
    precisionPct == null ||
    lo == null ||
    hi == null ||
    lo > hi
  )
    return null;
  return {
    sampleSize,
    correct,
    precisionPct,
    wilson95: [lo, hi],
    round: strOrNull(p["round"]),
  };
}

export function parseSaferProductsReports(input: {
  summary: unknown;
  meta: unknown;
  categories: { id?: unknown; cells?: unknown; yearly?: unknown; growth?: unknown }[];
}): SaferProductsReports | null {
  const s = obj(input.summary);
  const total = nonNeg(s?.["reports"]);
  if (!s || total == null) return null;
  const published = parseYearPoints(s["yearly_published"]);
  const yoyByYear = new Map<number, number | null>();
  for (const entry of arr(s["yearly_published"])) {
    const r = obj(entry);
    const year = num(r?.["year"]);
    if (year != null) yoyByYear.set(year, num(r?.["yoy_pct"]));
  }
  if (!published.length) return null;
  const partialByYear = new Map(published.map((y) => [y.year, y.partial]));
  const yearlyPublished: SpYear[] = published.map((y) => {
    const comparable = !y.partial && partialByYear.get(y.year - 1) === false;
    return {
      ...y,
      yoyPct: comparable ? (yoyByYear.get(y.year) ?? null) : null,
      yoyComparable: comparable,
    };
  });
  const meta = parseSpMeta(input.meta);
  const peak = obj(s["peak_year"]);
  const peakYear = num(peak?.["year"]);
  const peakReports = nonNeg(peak?.["reports"]);
  const complete = obj(s["latest_complete_year"]);
  const completeYear = num(complete?.["year"]);
  const completeReports = nonNeg(complete?.["reports"]);
  const partial = obj(s["latest_partial_year"]);
  const partialYear = num(partial?.["year"]);
  const partialReports = nonNeg(partial?.["reports"]);
  const lag = obj(obj(s["lag"])?.["report_to_publication_days"]);
  const ageBandsRaw = obj(s["age_bands"]);
  const categories = input.categories
    .flatMap((r) => {
      const c = parseCategory(r);
      return c ? [c] : [];
    })
    .sort((a, b) => b.reports - a.reports);
  return {
    total,
    publicationWindow: meta.publicationWindow,
    reportWindow: meta.reportWindow,
    retrieved: meta.retrieved,
    peak: peakYear != null && peakReports != null ? { year: peakYear, reports: peakReports } : null,
    severity: parseSeverity(s["severity"]),
    ageBands: AGE_BANDS.flatMap(({ key, label }) => {
      const n = nonNeg(ageBandsRaw?.[key]);
      return n == null ? [] : [{ key, label, reports: n }];
    }),
    ageNotRecorded: nonNeg(s["age_not_recorded"]),
    latestComplete:
      completeYear != null && completeReports != null
        ? {
            year: completeYear,
            reports: completeReports,
            yoyPct: num(complete?.["yoy_pct"]),
            changeVs2019Pct: num(complete?.["change_vs_2019_pct"]),
          }
        : null,
    latestPartial:
      partialYear != null && partialReports != null
        ? { year: partialYear, reports: partialReports, ytd: parseYtd(partial?.["ytd"]) }
        : null,
    lag: lag
      ? {
          median: num(lag["median"]),
          p90: num(lag["p90"]),
          within30Pct: num(lag["within_30_days_pct"]),
        }
      : null,
    commentRatePct: num(s["manufacturer_comment_rate_pct"]),
    yearlyPublished,
    yearlyReported: parseYearPoints(s["yearly_reported"]),
    categories,
    caveats: meta.caveats,
  };
}

export function parseThemes(summaryThemes: unknown, defs: SpMeta["themeDefs"]): SpTheme[] {
  const byTheme = new Map(defs.map((d) => [d.theme, d]));
  return arr(summaryThemes).flatMap((t) => {
    const r = obj(t);
    const theme = strOrNull(r?.["theme"]);
    const reports = nonNeg(r?.["reports"]);
    if (!r || !theme || reports == null) return [];
    const def = byTheme.get(theme);
    const label = strOrNull(r["label"]) ?? def?.label;
    if (!label) return [];
    return [
      {
        theme,
        label,
        reports,
        sharePct: num(r["share_pct"]),
        // The summary's own precision_pct is shown only with its measured sample and interval from the definition.
        precision: def?.precision ?? null,
      },
    ];
  });
}

export function parseGrowthRows(
  rows: {
    id?: unknown;
    name?: unknown;
    category?: unknown;
    subcategory?: unknown;
    code?: unknown;
    reports?: unknown;
    growth?: unknown;
    yearly?: unknown;
  }[],
): SpGrowthRow[] {
  return rows.flatMap((row) => {
    const id = strOrNull(row.id);
    const name = strOrNull(row.name);
    const reports = nonNeg(row.reports);
    const growth = parseGrowth(row.growth);
    // Only rows the dataset ranked (both windows at or above its minimum) belong in a ranked table.
    if (!id || !name || reports == null || !growth || !growth.eligible || growth.rank == null)
      return [];
    const code = row.code;
    return [
      {
        id,
        name,
        category: strOrNull(row.category),
        subcategory: strOrNull(row.subcategory),
        code: typeof code === "string" || typeof code === "number" ? String(code) : null,
        reports,
        growth,
        yearly: parseYearPoints(row.yearly),
      },
    ];
  });
}

const LEVEL_PREFIX: Record<SpGrowthLevel, string> = {
  type: "sp-type-",
  subcategory: "sp-sub-",
  category: "sp-cat-",
};

export function parseSaferProductsSignals(input: {
  summaryThemes: unknown;
  meta: unknown;
  leaders: unknown;
  thresholds: unknown;
  levels: Record<SpGrowthLevel, Parameters<typeof parseGrowthRows>[0]>;
}): SaferProductsSignals | null {
  const meta = parseSpMeta(input.meta);
  const themes = parseThemes(input.summaryThemes, meta.themeDefs);
  const leaders = obj(input.leaders);
  const th = obj(input.thresholds);
  const windows = obj(th?.["growth_windows"]);
  const recent = strOrNull(windows?.["recent"]);
  const prior = strOrNull(windows?.["prior"]);
  const levelOut = (level: SpGrowthLevel) => {
    const rows = parseGrowthRows(input.levels[level]).filter((r) =>
      r.id.startsWith(LEVEL_PREFIX[level]),
    );
    const l = obj(leaders?.[level]);
    return { rows, eligible: nonNeg(l?.["eligible"]), total: nonNeg(l?.["total"]) };
  };
  const levels = {
    type: levelOut("type"),
    subcategory: levelOut("subcategory"),
    category: levelOut("category"),
  };
  if (!themes.length && !levels.type.rows.length && !levels.category.rows.length) return null;
  return {
    windows:
      recent && prior
        ? { recent, prior, minReportsPerWindow: nonNeg(th?.["growth_min_reports_per_window"]) }
        : null,
    levels,
    themes,
    caveats: meta.caveats,
  };
}

export function parseCompany(row: {
  id?: unknown;
  cells?: unknown;
  sec?: unknown;
  recall?: unknown;
  variants?: unknown;
  first?: unknown;
  last?: unknown;
  yearly?: unknown;
}): SpCompany | null {
  const id = strOrNull(row.id);
  const c = obj(row.cells);
  const name = strOrNull(c?.["name"]);
  const reports = nonNeg(c?.["reports"]);
  const roleRaw = strOrNull(c?.["role"])?.toLowerCase();
  const role = roleRaw === "manufacturer" || roleRaw === "retailer" ? roleRaw : null;
  if (!id || !c || !name || reports == null || !role) return null;
  const sec = obj(row.sec);
  const cik = strOrNull(sec?.["cik"]);
  const matched = sec?.["status"] === "matched" && cik != null && /^\d{10}$/.test(cik);
  const recall = obj(row.recall);
  const recallId = strOrNull(recall?.["record_id"]);
  const level = strOrNull(recall?.["level"]);
  const variants = obj(row.variants);
  const first = strOrNull(row.first);
  const last = strOrNull(row.last);
  const variantNames = arr(variants?.["names"]).flatMap((v) => {
    const r = obj(v);
    const n = strOrNull(r?.["name"]);
    const k = nonNeg(r?.["reports"]);
    return n && k != null ? [{ name: n, reports: k }] : [];
  });
  const firstRecall = strOrNull(recall?.["first_recall"]);
  const lastRecall = strOrNull(recall?.["last_recall"]);
  return {
    id,
    name,
    role,
    rank: nonNeg(c["rank"]),
    reports,
    sharePct: num(c["share_pct"]),
    deaths: nonNeg(c["deaths"]),
    injuries: nonNeg(c["injuries"]),
    commentRatePct: role === "manufacturer" ? num(c["comment_rate_pct"]) : null,
    variants: variantNames,
    variantCount: Math.max(nonNeg(variants?.["count"]) ?? 0, variantNames.length),
    yearly: parseYearPoints(row.yearly),
    firstPublished: first && ISO_DATE.test(first) ? first : null,
    lastPublished: last && ISO_DATE.test(last) ? last : null,
    cik: matched ? cik : null,
    secTitle: matched ? strOrNull(sec?.["title"]) : null,
    recallMatch:
      recall && recallId && level
        ? {
            recordId: recallId,
            level,
            recalls: nonNeg(recall["recalls"]),
            firstRecall: firstRecall && ISO_DATE.test(firstRecall) ? firstRecall : null,
            lastRecall: lastRecall && ISO_DATE.test(lastRecall) ? lastRecall : null,
            reportsBeforeFirstRecall: nonNeg(recall["reports_before_first_recall"]),
          }
        : null,
  };
}

function parseLevelCounts(raw: unknown) {
  const l = obj(raw);
  const exact = nonNeg(l?.["exact_string"]);
  const normalised = nonNeg(l?.["normalised"]);
  const stripped = nonNeg(l?.["normalised_after_location_strip"]);
  const none = nonNeg(l?.["none"]);
  return exact == null || normalised == null || stripped == null || none == null
    ? null
    : { exact, normalised, locationStripped: stripped, none };
}

export function parseRecallCheck(raw: unknown): SpRecallCheck | null {
  const s = obj(raw);
  if (!s) return null;
  const comparison = obj(s["comparison"]);
  const levels = obj(s["levels"]);
  const pairs = obj(s["product_pairs"]);
  const pairCount = nonNeg(pairs?.["report_recall_pairs"]);
  const pairRecalls = nonNeg(pairs?.["recalls_with_pairs"]);
  const out: SpRecallCheck = {
    exportRecalls: nonNeg(comparison?.["export_recalls"]),
    matchedToCorpus: nonNeg(comparison?.["matched"]),
    exportOnly: arr(comparison?.["export_only"]).flatMap((v) => {
      const x = strOrNull(v);
      return x ? [x] : [];
    }),
    reportsByLevel: parseLevelCounts(levels?.["reports"]),
    nameStringsByLevel: parseLevelCounts(levels?.["report_name_strings"]),
    productPairs:
      pairCount != null && pairRecalls != null
        ? {
            pairs: pairCount,
            recalls: pairRecalls,
            pairedReportFirst: nonNeg(pairs?.["recalls_where_a_paired_report_came_first"]),
          }
        : null,
  };
  return out.reportsByLevel || out.productPairs || out.exportRecalls != null ? out : null;
}

export function parseSaferProductsCompanies(input: {
  rows: Parameters<typeof parseCompany>[0][];
  meta: unknown;
  threshold: unknown;
  recallSummary: unknown;
}): SaferProductsCompanies | null {
  const companies = input.rows.flatMap((r) => {
    const c = parseCompany(r);
    return c ? [c] : [];
  });
  if (!companies.length) return null;
  companies.sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name));
  return {
    companies,
    recallCheck: parseRecallCheck(input.recallSummary),
    threshold: nonNeg(input.threshold),
    caveats: parseSpMeta(input.meta).caveats,
  };
}

// ----------------------------------------------------------------------------------- server fns

const TTL = 10 * 60 * 1000;
const META_SELECT =
  "pw:metadata->summary->publication_window,rw:metadata->summary->report_window,retrieved:metadata->summary->retrieved,caveats:metadata->summary->caveats";

let reportsCache: { at: number; value: SaferProductsReports } | null = null;
let signalsCache: { at: number; value: SaferProductsSignals } | null = null;
let companiesCache: { at: number; value: SaferProductsCompanies } | null = null;

export const getSaferProductsReports = createServerFn({ method: "GET" }).handler(
  async (): Promise<SaferProductsReports | null> => {
    if (reportsCache && Date.now() - reportsCache.at < TTL) return reportsCache.value;
    const [summary, meta, categories] = await Promise.all([
      restGet<{ s: unknown }[]>(
        "corpus_records?select=s:item->safer&dataset=eq.saferproducts_reports_series&id=eq.saferproducts-summary&limit=1",
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_datasets?select=${META_SELECT}&id=eq.saferproducts_reports_series&limit=1`,
      ),
      restGet<{ id: unknown; cells: unknown; yearly: unknown; growth: unknown }[]>(
        "corpus_records?select=id,cells:item->cells,yearly:item->safer->yearly,growth:item->safer->growth&dataset=eq.saferproducts_products&id=like.sp-cat-*&order=ordinal.asc&limit=100",
      ),
    ]);
    const value = parseSaferProductsReports({
      summary: summary.rows[0]?.s,
      meta: meta.rows[0],
      categories: categories.rows,
    });
    if (value) reportsCache = { at: Date.now(), value };
    return value;
  },
);

const GROWTH_SELECT =
  "id,name:item->safer->name,category:item->safer->category,subcategory:item->safer->subcategory,code:item->safer->code,reports:item->safer->reports,growth:item->safer->growth,yearly:item->safer->yearly";

export const getSaferProductsSignals = createServerFn({ method: "GET" }).handler(
  async (): Promise<SaferProductsSignals | null> => {
    if (signalsCache && Date.now() - signalsCache.at < TTL) return signalsCache.value;
    const eligible = "item->safer->growth->>eligible=eq.true&order=ordinal.asc&limit=1000";
    const rowsFor = (level: SpGrowthLevel) =>
      restGet<Parameters<typeof parseGrowthRows>[0]>(
        `corpus_records?select=${GROWTH_SELECT}&dataset=eq.saferproducts_products&id=like.${LEVEL_PREFIX[level]}*&${eligible}`,
      );
    const [summary, meta, defs, products, type, subcategory, category] = await Promise.all([
      restGet<{ themes: unknown }[]>(
        "corpus_records?select=themes:item->safer->themes&dataset=eq.saferproducts_reports_series&id=eq.saferproducts-summary&limit=1",
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_datasets?select=${META_SELECT}&id=eq.saferproducts_reports_series&limit=1`,
      ),
      restGet<{ defs: unknown }[]>(
        "corpus_datasets?select=defs:metadata->summary->theme_definitions&id=eq.saferproducts_reports_series&limit=1",
      ),
      restGet<{ leaders: unknown; thresholds: unknown }[]>(
        "corpus_datasets?select=leaders:metadata->summary->growth_leaders,thresholds:metadata->summary->thresholds&id=eq.saferproducts_products&limit=1",
      ),
      rowsFor("type"),
      rowsFor("subcategory"),
      rowsFor("category"),
    ]);
    const value = parseSaferProductsSignals({
      summaryThemes: summary.rows[0]?.themes,
      meta: { ...meta.rows[0], defs: defs.rows[0]?.defs },
      leaders: products.rows[0]?.leaders,
      thresholds: products.rows[0]?.thresholds,
      levels: { type: type.rows, subcategory: subcategory.rows, category: category.rows },
    });
    if (value) signalsCache = { at: Date.now(), value };
    return value;
  },
);

export const getSaferProductsCompanies = createServerFn({ method: "GET" }).handler(
  async (): Promise<SaferProductsCompanies | null> => {
    if (companiesCache && Date.now() - companiesCache.at < TTL) return companiesCache.value;
    const [rows, meta, threshold, recall] = await Promise.all([
      restGet<Parameters<typeof parseCompany>[0][]>(
        "corpus_records?select=id,cells:item->cells,sec:item->safer->sec_match,recall:item->safer->recall_match,variants:item->safer->variants,first:item->safer->first_published,last:item->safer->last_published,yearly:item->safer->yearly&dataset=eq.saferproducts_companies&order=ordinal.asc&limit=1000",
      ),
      restGet<Record<string, unknown>[]>(
        `corpus_datasets?select=${META_SELECT}&id=eq.saferproducts_companies&limit=1`,
      ),
      restGet<{ t: unknown }[]>(
        "corpus_datasets?select=t:metadata->summary->threshold->min_reports_per_name&id=eq.saferproducts_companies&limit=1",
      ),
      restGet<{ s: unknown }[]>(
        "corpus_records?select=s:item->safer&dataset=eq.saferproducts_recalls_crosscheck&id=eq.sp-xc-summary&limit=1",
      ),
    ]);
    const value = parseSaferProductsCompanies({
      rows: rows.rows,
      meta: meta.rows[0],
      threshold: threshold.rows[0]?.t,
      recallSummary: recall.rows[0]?.s,
    });
    if (value) companiesCache = { at: Date.now(), value };
    return value;
  },
);
