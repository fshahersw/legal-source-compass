/**
 * Facts from published securities class action research reports (datasets cra_reports and cra_facts, built by
 * scripts/enrichment/cra): Cornerstone Research with the Stanford Securities Class Action Clearinghouse, Cornerstone
 * Research, and NERA Economic Consulting. Every fact is a value printed in a report's table or text, with its page.
 *
 * Pure and client-safe. Stored JSON is validated: a row that cannot be read is dropped and counted, a value that is not a
 * finite number is "Not recorded", and links are kept only when they point at the publisher's own PDF.
 *
 * Series are built from the latest report (vintage) that prints each year. Reports restate earlier years, so the values
 * the earlier reports printed are kept and listed where they differ. Dollar series are drawn only in the dollar basis of
 * the latest report: values in another basis (nominal, or another inflation year) are never mixed into one line.
 */
import type { TrendDatum, ValueFormatter } from "@/components/charts";
import { metricFormatter, NOT_RECORDED } from "@/components/charts";

export const REPORT_ID = /^(?:cr|nera)-[a-z0-9][a-z0-9-]{1,60}$/;
const FACT_ID = /^(?:cr|nera)-[a-z0-9][a-z0-9-]{1,60}:[0-9a-f]{16}$/;
const PDF_HOSTS = new Set(["www.cornerstone.com", "securities.stanford.edu", "www.nera.com"]);
const LANDING_HOSTS = new Set(["www.cornerstone.com", "www.nera.com"]);

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
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
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRINTED_DAY = new RegExp(`^(?:(\\d{1,2}) )?(${MONTHS.join("|")}) (\\d{4})$`);

/**
 * A report date as the build records it: an ISO day (PDF creation date) or the date printed on the report or the month
 * of the publisher's upload ("28 January 2026", "July 2026"). Returns the UTC time of the day (the first of the month
 * when only a month is given), or null for any other text.
 */
export function reportDateValue(s: string | null): number | null {
  if (!s) return null;
  const iso = ISO_DAY.exec(s);
  if (iso) {
    const t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isFinite(t) && Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? t : null;
  }
  const m = PRINTED_DAY.exec(s);
  if (!m) return null;
  const day = m[1] ? Number(m[1]) : 1;
  return day >= 1 && day <= 31 ? Date.UTC(Number(m[3]), MONTHS.indexOf(m[2]!), day) : null;
}

function hostOf(u: string): { host: string; path: string; hash: string } | null {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return { host: url.hostname, path: url.pathname, hash: url.hash };
  } catch {
    return null;
  }
}

/** The publisher's PDF (https, one of the three publishers' hosts, a .pdf path, at most a #page=N fragment). */
export function pdfLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const u = hostOf(s);
  if (!u || !PDF_HOSTS.has(u.host) || !/\.pdf$/i.test(u.path)) return null;
  if (u.hash && !/^#page=\d{1,4}$/.test(u.hash)) return null;
  return s;
}

function landingLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const u = hostOf(s);
  return u && LANDING_HOSTS.has(u.host) && !u.hash ? s : null;
}

export type CraReport = {
  id: string;
  family: string;
  familyLabel: string;
  publisher: string;
  edition: string;
  /** Period the report covers as printed ("2025", "2025 H1", "2015–2020 Q1"). */
  period: string;
  title: string;
  date: string | null;
  dateBasis: string | null;
  pdfUrl: string | null;
  landingUrl: string | null;
  pages: number | null;
  facts: number | null;
  status: string | null;
};

export type CraFact = {
  id: string;
  reportId: string;
  series: string;
  /** The series name as the build labels it ("Disclosure Dollar Loss (total)"). */
  seriesLabel: string;
  period: string;
  periodType: string;
  aggregate: string;
  value: number | null;
  valueText: string;
  unit: string;
  basis: string;
  dimension: string;
  scope: string;
  table: string;
  pdfPage: number | null;
  printedPage: string | null;
  method: "table" | "text";
  partial: boolean;
  note: string;
  /** The publisher's PDF at the fact's page. */
  sourceUrl: string | null;
};

export function parseReport(row: { id?: unknown; p?: unknown }): CraReport | null {
  const p = obj(row.p);
  const id = str(row.id);
  if (!p || !id || !REPORT_ID.test(id) || p["id"] !== id) return null;
  const publisher = str(p["publisher"]);
  const title = str(p["title"]);
  const family = str(p["family"]);
  const period = str(p["period"]);
  if (!publisher || !title || !family || !period) return null;
  const date = str(p["date"]);
  return {
    id,
    family,
    familyLabel: str(p["family_label"]) ?? family,
    publisher,
    edition: str(p["edition"]) ?? title,
    period,
    title,
    date: reportDateValue(date) != null ? date : null,
    dateBasis: str(p["date_basis"]),
    pdfUrl: pdfLink(p["pdf_url"]),
    landingUrl: landingLink(p["landing_url"]),
    pages: count(p["pages"]),
    facts: count(p["facts"]),
    status: str(p["status"]),
  };
}

export function parseFact(row: {
  id?: unknown;
  source_url?: unknown;
  label?: unknown;
  p?: unknown;
}): CraFact | null {
  const p = obj(row.p);
  const id = str(row.id);
  if (!p || !id || !FACT_ID.test(id)) return null;
  const reportId = str(p["report_id"]);
  const series = str(p["series"]);
  const period = str(p["period"]);
  const valueText = str(p["value_text"]);
  if (!reportId || !REPORT_ID.test(reportId) || !id.startsWith(`${reportId}:`)) return null;
  if (!series || !period || !valueText) return null;
  const page = count(p["pdf_page"]);
  return {
    id,
    reportId,
    series,
    seriesLabel: str(row.label) ?? series,
    period,
    periodType: text(p["period_type"]),
    aggregate: text(p["aggregate"]),
    value: num(p["value"]),
    valueText,
    unit: text(p["unit"]),
    basis: text(p["basis"]),
    dimension: text(p["dimension"]),
    scope: text(p["scope"]),
    table: text(p["table"]),
    pdfPage: page != null && page >= 1 ? page : null,
    printedPage: str(p["printed_page"]),
    method: p["method"] === "text" ? "text" : "table",
    partial: p["partial"] === true,
    note: text(p["note"]),
    sourceUrl: pdfLink(row.source_url),
  };
}

/**
 * Order of report vintages: the last year a report covers, then within the year a quarterly update, a midyear report, a
 * third-quarter update and finally the full-year report; ties fall back to the report date.
 */
export function vintageRank(r: Pick<CraReport, "period" | "date">): number {
  const m = /(\d{4})(?:\s*(Q[1-4]|H[12]))?\s*$/.exec(r.period);
  if (!m) return 0;
  const sub = { Q1: 0.25, Q2: 0.5, H1: 0.5, Q3: 0.75, Q4: 1, H2: 1 }[m[2] ?? ""] ?? 1;
  const d = reportDateValue(r.date) ?? NaN;
  // The date only breaks ties within a period: a fraction of a day count kept well below the period step.
  const tie = Number.isFinite(d) ? d / 1e15 : 0;
  return Number(m[1]) + sub * 0.9 + tie;
}

export function compareVintage(a: CraReport, b: CraReport): number {
  return vintageRank(a) - vintageRank(b) || a.id.localeCompare(b.id);
}

/** One line of a chart: a series (and optionally one breakdown and one population) of the facts. */
export type LineSpec = {
  id: string;
  label: string;
  series: string;
  /** Exact breakdown as printed ("Case type: Accounting cases"); "" for the series without a breakdown. */
  dimension: string;
  /** Exact population ("Core Federal Filings"); omit to accept the series' only population. */
  scope?: string | undefined;
};

export type ChartId =
  "filings" | "dollarLoss" | "cohorts" | "settlements" | "settlementSize" | "accounting" | "sp500";

export const CHARTS: Record<ChartId, readonly LineSpec[]> = {
  filings: [
    {
      id: "cr",
      label: "Cornerstone and Stanford",
      series: "filings.class_action_filings",
      dimension: "",
      scope: "",
    },
    { id: "nera", label: "NERA", series: "nera.filings", dimension: "" },
  ],
  dollarLoss: [
    {
      id: "ddl",
      label: "Disclosure Dollar Loss",
      series: "filings.ddl_total",
      dimension: "",
      scope: "",
    },
    {
      id: "mdl",
      label: "Maximum Dollar Loss",
      series: "filings.mdl_total",
      dimension: "",
      scope: "",
    },
  ],
  cohorts: [
    {
      id: "y1",
      label: "Within 1 year",
      series: "filings.cohort_status.y1_resolved.core",
      dimension: "",
      scope: "Core Federal Filings",
    },
    {
      id: "y2",
      label: "Within 2 years",
      series: "filings.cohort_status.y2_resolved.core",
      dimension: "",
      scope: "Core Federal Filings",
    },
    {
      id: "y3",
      label: "Within 3 years",
      series: "filings.cohort_status.y3_resolved.core",
      dimension: "",
      scope: "Core Federal Filings",
    },
  ],
  settlements: [
    { id: "count", label: "Settlements", series: "settlements.count", dimension: "", scope: "" },
  ],
  settlementSize: [
    {
      id: "median",
      label: "Median",
      series: "settlements.percentile.median",
      dimension: "",
      scope: "",
    },
    {
      id: "average",
      label: "Average",
      series: "settlements.percentile.average",
      dimension: "",
      scope: "",
    },
  ],
  accounting: [
    {
      id: "acc",
      label: "Accounting cases",
      series: "accounting.filings",
      dimension: "Case type: Accounting cases",
    },
    {
      id: "non",
      label: "Non-accounting cases",
      series: "accounting.filings",
      dimension: "Case type: Non-accounting cases",
    },
  ],
  sp500: [
    {
      id: "all",
      label: "All S&P 500 companies",
      series: "filings.sp500_companies_sued_pct",
      dimension: "Sector: All S&P 500 Companies",
      scope: "Federal",
    },
  ],
};

export const CHART_IDS = Object.keys(CHARTS) as ChartId[];

export type SeriesPoint = {
  period: string;
  value: number;
  partial: boolean;
  fact: CraFact;
  report: CraReport;
};

export type Restatement = { period: string; latest: SeriesPoint; earlier: SeriesPoint[] };

export type SeriesResult = {
  spec: LineSpec;
  points: SeriesPoint[];
  unit: string;
  /** Dollar basis of every point ("inflation-adjusted, 2025 dollars"); "" for counts and percentages. */
  basis: string;
  /** Reports the points come from, latest first. */
  reports: CraReport[];
  /** Years an earlier report printed with a different value (same unit, basis, breakdown and population). */
  restated: Restatement[];
  /** Year values left out because they are printed in another dollar basis or unit than the latest report's. */
  otherBasis: number;
};

const byPeriod = (a: { period: string }, b: { period: string }) =>
  a.period < b.period ? -1 : a.period > b.period ? 1 : 0;

/** Single-year values of one line, the latest vintage per year, with the differing earlier vintages. */
export function buildSeries(
  facts: readonly CraFact[],
  reports: ReadonlyMap<string, CraReport>,
  spec: LineSpec,
): SeriesResult {
  const empty: SeriesResult = {
    spec,
    points: [],
    unit: "",
    basis: "",
    reports: [],
    restated: [],
    otherBasis: 0,
  };
  const cand = facts
    .filter(
      (f) =>
        f.series === spec.series &&
        f.periodType === "year" &&
        /^\d{4}$/.test(f.period) &&
        f.aggregate === "" &&
        f.value != null &&
        f.dimension === spec.dimension &&
        (spec.scope === undefined || f.scope === spec.scope) &&
        reports.has(f.reportId),
    )
    .map((f) => ({ f, r: reports.get(f.reportId)! }))
    .sort(
      (a, b) =>
        compareVintage(b.r, a.r) ||
        (a.f.pdfPage ?? 9999) - (b.f.pdfPage ?? 9999) ||
        a.f.id.localeCompare(b.f.id),
    );
  const head = cand[0];
  if (!head) return empty;
  const latestReport = head.r.id;
  // The basis and unit of the latest report (its most common pair, should it print more than one).
  const pairs = new Map<string, number>();
  for (const c of cand)
    if (c.r.id === latestReport)
      pairs.set(`${c.f.unit}|${c.f.basis}`, (pairs.get(`${c.f.unit}|${c.f.basis}`) ?? 0) + 1);
  const [pair] = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const [unit = "", basis = ""] = pair.split("|");
  const same = cand.filter((c) => c.f.unit === unit && c.f.basis === basis);
  const otherBasis = cand.length - same.length;
  const groups = new Map<string, SeriesPoint[]>();
  for (const { f, r } of same) {
    const list = groups.get(f.period) ?? [];
    // One value per report and year: the first page that prints it (reports print a year once per table).
    if (!list.some((p) => p.report.id === r.id))
      list.push({ period: f.period, value: f.value!, partial: f.partial, fact: f, report: r });
    groups.set(f.period, list);
  }
  const points: SeriesPoint[] = [];
  const restated: Restatement[] = [];
  for (const [period, list] of groups) {
    const latest = list[0]!;
    points.push(latest);
    const earlier = list.slice(1).filter((p) => !p.partial && p.value !== latest.value);
    if (earlier.length && !latest.partial) restated.push({ period, latest, earlier });
  }
  points.sort(byPeriod);
  restated.sort(byPeriod);
  const used = new Map<string, CraReport>();
  for (const p of points) used.set(p.report.id, p.report);
  return {
    spec,
    points,
    unit,
    basis,
    reports: [...used.values()].sort((a, b) => compareVintage(b, a)),
    restated,
    otherBasis,
  };
}

/** Every year from the first to the last year any line records, so a missing year is a gap, never a zero. */
export function yearKeys(results: readonly SeriesResult[]): string[] {
  const years = results.flatMap((r) => r.points.map((p) => Number(p.period)));
  if (!years.length) return [];
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const out: string[] = [];
  for (let y = lo; y <= hi && out.length < 200; y++) out.push(String(y));
  return out;
}

export function trendPoints(r: SeriesResult): TrendDatum[] {
  return r.points.map((p) => ({ key: p.period, value: p.value, partial: p.partial }));
}

function fixed(v: number, digits: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** How a chart writes values in the unit the reports print them in. */
export function unitFormatter(unit: string): ValueFormatter {
  if (unit === "percent") return metricFormatter("percent");
  const scale = unit === "usd_billions" ? "billion" : unit === "usd_millions" ? "million" : null;
  if (!scale) return metricFormatter("count");
  const letter = scale === "billion" ? "B" : "M";
  const body = (v: number) => (Number.isInteger(v) ? fixed(v, 0) : fixed(v, 1));
  return {
    full: (v) =>
      typeof v === "number" && Number.isFinite(v) ? `$${body(v)} ${scale}` : NOT_RECORDED,
    // Ticks of a millions axis that reach 1,000 are written in billions ("$1.5B"), never "$1,500M".
    tick: (v) =>
      scale === "million" && Math.abs(v) >= 1000
        ? `$${fixed(v / 1000, 1).replace(/\.0$/, "")}B`
        : `$${body(v)}${letter}`,
    delta: (d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}$${body(Math.abs(d))} ${scale}`,
  };
}

/** Unit words for the chart header and tooltips. */
export function unitWords(unit: string, basis: string): string {
  const base =
    unit === "usd_billions"
      ? "US$ billions"
      : unit === "usd_millions"
        ? "US$ millions"
        : unit === "percent"
          ? "percent"
          : unit === "usd"
            ? "US$"
            : unit;
  return basis && basis !== "not stated" ? `${base}, ${basis}` : base;
}

/** "p. 5": the page number the report prints, else the PDF page. */
export function pageText(f: Pick<CraFact, "printedPage" | "pdfPage">): string {
  if (f.printedPage) return `p. ${f.printedPage}`;
  return f.pdfPage != null ? `PDF p. ${f.pdfPage}` : "page not recorded";
}

/** Reports grouped by series, newest first, for the report picker. */
export function groupReports(
  reports: readonly CraReport[],
): { family: string; label: string; reports: CraReport[] }[] {
  const out = new Map<string, { family: string; label: string; reports: CraReport[] }>();
  for (const r of reports) {
    const g = out.get(r.family) ?? { family: r.family, label: r.familyLabel, reports: [] };
    g.reports.push(r);
    out.set(r.family, g);
  }
  for (const g of out.values()) g.reports.sort((a, b) => compareVintage(b, a));
  return [...out.values()];
}

/** The report shown first: the newest report with facts in the filings series, else the newest report with facts. */
export function defaultReport(reports: readonly CraReport[]): CraReport | null {
  const withFacts = reports.filter((r) => (r.facts ?? 0) > 0).sort((a, b) => compareVintage(b, a));
  return withFacts.find((r) => r.family === "cr_filings") ?? withFacts[0] ?? null;
}

/** Short publisher name for lists that mix publishers. */
export function shortPublisher(publisher: string): string {
  if (publisher.startsWith("Cornerstone Research and the Stanford"))
    return "Cornerstone Research and Stanford Clearinghouse";
  if (publisher.startsWith("NERA")) return "NERA";
  return publisher;
}

/** "NERA, 2018 Full-Year Review": which report printed a value. */
export function reportShort(r: Pick<CraReport, "publisher" | "edition">): string {
  return `${shortPublisher(r.publisher)}, ${r.edition}`;
}
