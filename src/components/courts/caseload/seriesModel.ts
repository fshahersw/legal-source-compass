/**
 * Pure model for the published-tables views of /courts/caseload (client-safe, tested in seriesModel.test.ts).
 *
 * Parses the series index records (uscourts_series_index) and the latest-period records, and turns a stored table record into
 * chart series: one point per published period, a printed dash or a missing cell is a gap ("Not recorded"), never zero, and
 * nothing is interpolated. Periods from different publications are different 12-month windows (ending September 30 in
 * Judicial Business, June 30 and December 31 in the Statistical Tables, March 31 in Caseload Statistics, every quarter in
 * Bankruptcy Filings); a chart shows one publication's periods unless the reader asks for all of them.
 */
import type {
  TrendDatum,
  TrendSeriesInput,
  PeriodAxis,
  Annotation,
  ValueFormatter,
} from "@/components/charts";
import { metricFormatter, NOT_RECORDED, longDate } from "@/components/charts";
import type { RankedItem } from "@/components/charts";
import type {
  UstBreak,
  UstCatalogEntry,
  UstPeriod,
  UstUnit,
} from "@/lib/external/uscourtsTables.functions";

export const INDEX_DATASET = "uscourts_series_index";
export const NATIONAL_DATASET = "uscourts_tables_national";
export const SERIES_DATASETS = [
  "uscourts_tables_national",
  "uscourts_tables_district",
  "uscourts_tables_bankruptcy",
  "uscourts_tables_circuit",
  "uscourts_tables_bankruptcy_county",
  "uscourts_bapcpa",
  "uscourts_wiretap",
  "uscourts_dnsw",
  "uscourts_fisc",
] as const;
export type SeriesDataset = (typeof SERIES_DATASETS)[number];
export type SeriesScope = "district" | "bankruptcy" | "appeals" | "county" | "category";

export const PUB_NAMES: Record<string, string> = {
  JB: "Judicial Business",
  STFJ: "Statistical Tables for the Federal Judiciary",
  FJCS: "Federal Judicial Caseload Statistics",
  BF: "Bankruptcy Filings",
  BAPCPA: "BAPCPA report",
  WIRETAP: "Wiretap report",
  DNSW: "Delayed-Notice Search Warrant report",
  FISC: "Director's report on the FISA courts",
  JFF: "Judicial Facts and Figures",
  FCMS: "Federal Court Management Statistics",
  CJRA: "Civil Justice Reform Act report",
};
const PUB_ORDER = ["JB", "STFJ", "FJCS", "BF", "BAPCPA", "WIRETAP", "DNSW", "FISC"];
export const GEOGRAPHY: Record<SeriesScope, string> = {
  district: "U.S. district courts",
  bankruptcy: "U.S. bankruptcy courts",
  appeals: "U.S. courts of appeals",
  county: "Counties (bankruptcy filings)",
  category: "National (category rows)",
};
export const TABLES_PAGE =
  "https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables";

// ------------------------------------------------------------------------------------------------ primitives

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown) => {
  const s = str(v);
  return s && ISO.test(s) ? s : null;
};
const httpUrl = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
const datasetOf = (v: unknown): SeriesDataset | null => {
  const s = str(v);
  return s && (SERIES_DATASETS as readonly string[]).includes(s) ? (s as SeriesDataset) : null;
};
const SCOPES: readonly SeriesScope[] = ["district", "bankruptcy", "appeals", "county", "category"];
const scopeOf = (v: unknown): SeriesScope | null => {
  const s = str(v);
  return s && (SCOPES as readonly string[]).includes(s) ? (s as SeriesScope) : null;
};
const UNITS: readonly UstUnit[] = ["count", "percent", "months", "days", "ratio", "number"];
const TABLE_KEY = /^[a-z0-9][a-z0-9-]{0,40}$/;
const RECORD_ID = /^([a-z]{2,8}:)?[a-z0-9][a-z0-9-]{0,40}$/;
const ref = (v: unknown): { dataset: SeriesDataset; id: string } | null => {
  const o = obj(v);
  const dataset = datasetOf(o?.["dataset"]);
  const id = str(o?.["id"]);
  return dataset && id && RECORD_ID.test(id) ? { dataset, id } : null;
};

export const COURT_DATASET: Record<Exclude<SeriesScope, "category">, SeriesDataset> = {
  district: "uscourts_tables_district",
  bankruptcy: "uscourts_tables_bankruptcy",
  appeals: "uscourts_tables_circuit",
  county: "uscourts_tables_bankruptcy_county",
};

// ------------------------------------------------------------------------------------------------ index records

export type HeldItem = {
  tableNumber: string;
  tableKey: string | null;
  end: string;
  pub: string;
  url: string | null;
  page: string | null;
  failureCount: number;
  failures: { kind: string; entity: string; col: string; printed: number; sum: number }[];
  replacedBy: string | null;
};

export type SeriesCard = {
  tableKey: string;
  table: string;
  title: string;
  scope: SeriesScope;
  geography: string;
  family: string;
  pubs: string[];
  first: string;
  last: string;
  periods: number;
  national: { dataset: SeriesDataset; id: string } | null;
  courtsDataset: SeriesDataset | null;
  courtCount: number | null;
  latest: { dataset: SeriesDataset; id: string } | null;
  recStatus: string | null;
  held: number;
  page: string | null;
};

export function parseHeldItem(v: unknown): HeldItem | null {
  const o = obj(v);
  const end = iso(o?.["end"]);
  const pub = str(o?.["pub"]);
  const tableNumber = str(o?.["tableNumber"]) ?? str(o?.["table"]);
  if (!o || !end || !pub || !tableNumber) return null;
  const failures = arr(o["failures"]).flatMap((f) => {
    const r = obj(f);
    const printed = num(r?.["printed"]);
    const sum = num(r?.["sum"]);
    const kind = str(r?.["kind"]);
    if (!r || printed == null || sum == null || !kind) return [];
    return [{ kind, entity: str(r["entity"]) ?? "", col: str(r["col"]) ?? "", printed, sum }];
  });
  const tk = str(o["table"]);
  return {
    tableNumber,
    tableKey: tk && TABLE_KEY.test(tk) && tk !== tableNumber ? tk : null,
    end,
    pub,
    url: httpUrl(o["url"]),
    page: httpUrl(o["page"]),
    failureCount: num(o["failureCount"]) ?? failures.length,
    failures,
    replacedBy: str(o["replacedBy"]),
  };
}

export function parseSeriesCard(row: Record<string, unknown>): SeriesCard | null {
  const cells = obj(row["cells"]);
  const tableKey = str(row["tk"]);
  const table = str(row["table"]);
  const title = str(row["title"]);
  const scope = scopeOf(row["scope"]);
  const first = iso(cells?.["first"]);
  const last = iso(cells?.["last"]);
  const periods = num(cells?.["periods"]);
  if (
    !tableKey ||
    !TABLE_KEY.test(tableKey) ||
    !table ||
    !title ||
    !scope ||
    !first ||
    !last ||
    periods == null
  )
    return null;
  return {
    tableKey,
    table,
    title,
    scope,
    geography: str(row["geo"]) ?? GEOGRAPHY[scope],
    family: str(row["fam"]) ?? "tables",
    pubs: arr(row["pubs"])
      .map(str)
      .filter((p): p is string => p != null),
    first,
    last,
    periods,
    national: ref(row["nat"]),
    courtsDataset: datasetOf(row["cds"]),
    courtCount: num(row["ccount"]),
    latest: ref(row["latest"]),
    recStatus: str(row["rstatus"]),
    held: arr(row["held"]).length,
    page: httpUrl(row["page"]),
  };
}

/** A series card from the national dataset's table catalog (used until the series index is published). */
export function cardFromCatalog(e: UstCatalogEntry): SeriesCard {
  const raw = e.scopes[0] ?? "national";
  const scope: SeriesScope =
    raw === "district" || raw === "bankruptcy" || raw === "appeals" || raw === "county"
      ? raw
      : "category";
  const courtsDataset = scope === "category" ? null : COURT_DATASET[scope];
  return {
    tableKey: e.tableKey,
    table: e.table,
    title: e.title,
    scope,
    geography: GEOGRAPHY[scope],
    family: "tables",
    pubs: e.pubs,
    first: e.firstEnd,
    last: e.lastEnd,
    periods: e.periods,
    national: { dataset: NATIONAL_DATASET, id: e.tableKey },
    courtsDataset,
    courtCount: null,
    latest:
      courtsDataset && scope !== "county"
        ? { dataset: courtsDataset, id: `latest:${e.tableKey}` }
        : null,
    recStatus: null,
    held: 0,
    page: null,
  };
}

export type SeriesPeriod = {
  end: string;
  months: number | null;
  pub: string;
  fmt: string | null;
  phrase?: string;
};
export type SeriesColumn = { k: string; label: string; unit: UstUnit; dec: number | null };
export type SeriesRow = { k: string; label: string; depth: number };
export type Reconciliation = {
  status: string;
  tests: number;
  passed: number;
  exceedsParts: number;
  explained: number;
  noTotals: number;
  held: HeldItem[];
};

export type SeriesDetail = {
  tableKey: string;
  table: string;
  title: string;
  scope: SeriesScope;
  geography: string;
  family: string;
  periods: SeriesPeriod[];
  pubs: string[];
  cols: SeriesColumn[];
  rows: SeriesRow[];
  courts: { dataset: SeriesDataset; ids: string[]; count: number } | null;
  circuits: { dataset: SeriesDataset; ids: string[] } | null;
  national: { dataset: SeriesDataset; id: string } | null;
  latest: { dataset: SeriesDataset; id: string } | null;
  rec: Reconciliation | null;
  duplicates: { end: string; pub: string; kept: string }[];
  coverage: Record<string, number>;
  page: string | null;
};

function parseCols(v: unknown): SeriesColumn[] {
  const out: SeriesColumn[] = [];
  const seen = new Set<string>();
  for (const c of arr(v)) {
    const o = obj(c);
    const k = str(o?.["k"]);
    const label = str(o?.["label"]);
    if (!o || !k || !label || seen.has(k)) continue;
    seen.add(k);
    const unit = (UNITS as readonly string[]).includes(String(o["unit"]))
      ? (o["unit"] as UstUnit)
      : "number";
    const dec = num(o["dec"]);
    out.push({
      k,
      label,
      unit,
      dec: dec != null && Number.isInteger(dec) && dec >= 0 && dec <= 6 ? dec : null,
    });
  }
  return out;
}

export function parseSeriesDetail(v: unknown): SeriesDetail | null {
  const o = obj(v);
  if (!o || o["v"] !== 1) return null;
  const tableKey = str(o["tableKey"]);
  const table = str(o["table"]);
  const title = str(o["title"]);
  const scope = scopeOf(o["scope"]);
  if (!tableKey || !TABLE_KEY.test(tableKey) || !table || !title || !scope) return null;
  const periods: SeriesPeriod[] = [];
  for (const p of arr(o["periods"])) {
    const r = obj(p);
    const end = iso(r?.["end"]);
    const pub = str(r?.["pub"]);
    if (!r || !end || !pub) continue;
    const months = num(r["months"]);
    const phrase = str(r["phrase"]);
    periods.push({
      end,
      months: months != null && months > 0 ? months : null,
      pub,
      fmt: str(r["fmt"]),
      ...(phrase ? { phrase: phrase.slice(0, 160) } : {}),
    });
  }
  if (!periods.length) return null;
  const courtsRaw = obj(o["courts"]);
  const courtsDs = datasetOf(courtsRaw?.["dataset"]);
  const circRaw = obj(o["circuits"]);
  const circDs = datasetOf(circRaw?.["dataset"]);
  const ids = (v: unknown) =>
    arr(v)
      .map(str)
      .filter((s): s is string => s != null && /^[a-z0-9]{2,8}$/.test(s));
  const recRaw = obj(o["rec"]);
  const coverage: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj(o["coverage"]) ?? {})) {
    const n = num(val);
    if (n != null) coverage[k] = n;
  }
  return {
    tableKey,
    table,
    title,
    scope,
    geography: str(o["geography"]) ?? GEOGRAPHY[scope],
    family: str(o["family"]) ?? "tables",
    periods,
    pubs: arr(o["pubs"])
      .map(str)
      .filter((p): p is string => p != null),
    cols: parseCols(o["cols"]),
    rows: arr(o["rows"]).flatMap((r) => {
      const x = obj(r);
      const k = str(x?.["k"]);
      const label = str(x?.["label"]);
      const depth = num(x?.["depth"]);
      return x && k && label
        ? [{ k, label, depth: depth != null && depth >= 0 ? Math.floor(depth) : 0 }]
        : [];
    }),
    courts: courtsDs
      ? { dataset: courtsDs, ids: ids(courtsRaw?.["ids"]), count: num(courtsRaw?.["count"]) ?? 0 }
      : null,
    circuits: circDs ? { dataset: circDs, ids: ids(circRaw?.["ids"]) } : null,
    national: ref(o["national"]),
    latest: ref(o["latest"]),
    rec: recRaw
      ? {
          status: str(recRaw["status"]) ?? "not recorded",
          tests: num(recRaw["tests"]) ?? 0,
          passed: num(recRaw["passed"]) ?? 0,
          exceedsParts: num(recRaw["exceedsParts"]) ?? 0,
          explained: num(recRaw["explained"]) ?? 0,
          noTotals: num(recRaw["noTotals"]) ?? 0,
          held: arr(recRaw["held"])
            .map(parseHeldItem)
            .filter((h): h is HeldItem => h != null),
        }
      : null,
    duplicates: arr(o["duplicates"]).flatMap((d) => {
      const r = obj(d);
      const end = iso(r?.["end"]);
      const pub = str(r?.["pub"]);
      const kept = str(r?.["kept"]);
      return r && end && pub && kept ? [{ end, pub, kept }] : [];
    }),
    coverage,
    page: httpUrl(o["page"]),
  };
}

export type LatestTable = {
  table: string;
  tableKey: string;
  title: string;
  end: string;
  scope: string;
  cols: SeriesColumn[];
  courts: Record<string, Record<string, number>>;
  /** Rows that print several courts as one ("arcomb": E.D. and W.D. Arkansas), with the courts they cover and their label. */
  combined?: Record<string, { covers: string[]; label: string }>;
};

export function parseLatest(v: unknown): LatestTable | null {
  const o = obj(v);
  if (!o || o["kind"] !== "latest") return null;
  const table = str(o["table"]);
  const tableKey = str(o["tableKey"]);
  const title = str(o["title"]);
  const end = iso(o["end"]);
  if (!table || !tableKey || !title || !end) return null;
  const cols = parseCols(o["cols"]);
  const keys = new Set(cols.map((c) => c.k));
  const courts: Record<string, Record<string, number>> = {};
  for (const [court, values] of Object.entries(obj(o["courts"]) ?? {})) {
    if (!/^[a-z0-9]{2,8}$/.test(court)) continue;
    const vals: Record<string, number> = {};
    for (const [k, val] of Object.entries(obj(values) ?? {})) {
      const n = num(val);
      if (n != null && keys.has(k)) vals[k] = n;
    }
    if (Object.keys(vals).length) courts[court] = vals;
  }
  const combined: NonNullable<LatestTable["combined"]> = {};
  for (const [court, info] of Object.entries(obj(o["combined"]) ?? {})) {
    const c = obj(info);
    const label = str(c?.["label"]);
    const covers = arr(c?.["covers"]).filter(
      (x): x is string => typeof x === "string" && /^[a-z0-9]{2,8}$/.test(x),
    );
    if (/^[a-z0-9]{2,8}$/.test(court) && label && covers.length && court in courts)
      combined[court] = { covers, label };
  }
  return { table, tableKey, title, end, scope: str(o["scope"]) ?? "", cols, courts, combined };
}

export type CoverageCounts = Record<string, number>;
export type CoverageSummary = {
  generatedAt: string | null;
  totals: CoverageCounts;
  publications: { code: string; title: string; page: string | null; counts: CoverageCounts }[];
  series: number;
};

const counts = (v: unknown): CoverageCounts => {
  const out: CoverageCounts = {};
  for (const [k, val] of Object.entries(obj(v) ?? {})) {
    const n = num(val);
    if (n != null) out[k] = n;
  }
  return out;
};

export function parseCoverageSummary(v: unknown): CoverageSummary | null {
  const o = obj(v);
  if (!o || o["v"] !== 1) return null;
  return {
    generatedAt: str(o["generated_at"]),
    totals: counts(o["totals"]),
    publications: arr(o["publications"]).flatMap((p) => {
      const r = obj(p);
      const code = str(r?.["code"]);
      const title = str(r?.["title"]);
      return r && code && title
        ? [{ code, title, page: httpUrl(r["page"]), counts: counts(r["counts"]) }]
        : [];
    }),
    series: num(o["series"]) ?? 0,
  };
}

export type PeriodStatus = { end: string; acq: string; parse: string; pub: string };
export type PublicationTable = {
  table: string;
  title: string;
  series: string;
  counts: CoverageCounts;
  periods: PeriodStatus[];
  gaps: { why: string; n: number }[];
};
export type PublicationCoverage = {
  code: string;
  title: string;
  page: string | null;
  counts: CoverageCounts;
  tables: PublicationTable[];
};

export function parsePublicationCoverage(v: unknown): PublicationCoverage | null {
  const o = obj(v);
  const code = str(o?.["code"]);
  const title = str(o?.["title"]);
  if (!o || o["v"] !== 1 || !code || !title) return null;
  return {
    code,
    title,
    page: httpUrl(o["page"]),
    counts: counts(o["counts"]),
    tables: arr(o["tables"]).flatMap((t) => {
      const r = obj(t);
      const table = str(r?.["table"]);
      if (!r || !table) return [];
      return [
        {
          table,
          title: str(r["title"]) ?? "",
          series: str(r["series"]) ?? "",
          counts: counts(r["counts"]),
          periods: arr(r["periods"]).flatMap((p) => {
            const a = arr(p);
            const end = iso(a[0]);
            return end
              ? [
                  {
                    end,
                    acq: String(a[1] ?? "-"),
                    parse: String(a[2] ?? "-"),
                    pub: String(a[3] ?? "-"),
                  },
                ]
              : [];
          }),
          gaps: arr(r["gaps"]).flatMap((g) => {
            const a = arr(g);
            const why = str(a[0]);
            const n = num(a[1]);
            return why && n != null ? [{ why, n }] : [];
          }),
        },
      ];
    }),
  };
}

export function parseHeld(v: unknown): HeldItem[] {
  const o = obj(v);
  if (!o || o["v"] !== 1) return [];
  return arr(o["items"])
    .map(parseHeldItem)
    .filter((h): h is HeldItem => h != null);
}

// ------------------------------------------------------------------------------------------------ chart model

export type PeriodChoice = "all" | string;

/** Publications of a series with their period counts, in the publisher's order. */
export function pubCounts(
  periods: readonly Pick<UstPeriod, "pub">[],
): { pub: string; n: number }[] {
  const by = new Map<string, number>();
  for (const p of periods) by.set(p.pub, (by.get(p.pub) ?? 0) + 1);
  const rank = (pub: string) => {
    const i = PUB_ORDER.indexOf(pub);
    return i === -1 ? PUB_ORDER.length : i;
  };
  return [...by.entries()]
    .map(([pub, n]) => ({ pub, n }))
    .sort((a, b) => rank(a.pub) - rank(b.pub) || b.n - a.n);
}

/** The publication a chart shows first: Judicial Business (fiscal years) when the table has it, else the one with most periods. */
export function defaultPub(periods: readonly Pick<UstPeriod, "pub">[]): string {
  const c = pubCounts(periods);
  if (c.some((x) => x.pub === "JB")) return "JB";
  return [...c].sort((a, b) => b.n - a.n)[0]?.pub ?? "all";
}

export function periodIndices(
  periods: readonly Pick<UstPeriod, "pub">[],
  choice: PeriodChoice,
): number[] {
  const out: number[] = [];
  periods.forEach((p, i) => {
    if (choice === "all" || p.pub === choice) out.push(i);
  });
  return out;
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "12 months ending September 30, 2025", "3 months ending ...", "As of ..." for one published period. */
export function periodText(p: Pick<UstPeriod, "end" | "months" | "phrase">): string {
  if (p.months === 0) return `As of ${longDate(p.end)}`;
  if (p.months == null && p.phrase) return p.phrase;
  if (p.months == null) return `Period ending ${longDate(p.end)}`;
  return `${p.months} ${p.months === 1 ? "month" : "months"} ending ${longDate(p.end)}`;
}

/**
 * Chosen periods that are shorter than the others: no month count but the publisher's own description (the 2006 interim period of
 * the delayed-notice warrant report, the first FISA-court report from June 8, 2015). Empty when every chosen period is alike.
 */
export function shortPeriods(
  periods: readonly Pick<UstPeriod, "end" | "months" | "phrase">[],
  idx: readonly number[],
): { end: string; text: string }[] {
  const chosen = idx.map((i) => periods[i]).filter((p): p is (typeof periods)[number] => !!p);
  if (!chosen.some((p) => p.months != null)) return [];
  return chosen
    .filter((p) => p.months == null && p.phrase)
    .map((p) => ({ end: p.end, text: p.phrase! }));
}

/** Quarter ends from the first to the last date, inclusive (every key a chart may need for "all published periods"). */
export function quarterEnds(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let q = Math.ceil(Number(first.slice(5, 7)) / 3);
  const ly = Number(last.slice(0, 4));
  const lq = Math.ceil(Number(last.slice(5, 7)) / 3);
  const END = ["03-31", "06-30", "09-30", "12-31"];
  while (y < ly || (y === ly && q <= lq)) {
    out.push(`${y}-${END[q - 1]}`);
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
    if (out.length > 800) break;
  }
  return out;
}

/**
 * The period axis for the chosen periods. One publication: its own period ends (evenly spaced, one per edition). All
 * publications: every quarter end from the first to the last period, so a quarter with no published table is a gap and the
 * spacing follows time.
 */
export function buildAxis(
  periods: readonly Pick<UstPeriod, "end" | "months" | "pub">[],
  idx: readonly number[],
  choice: PeriodChoice,
): PeriodAxis {
  const chosen = idx.map((i) => periods[i]!).filter(Boolean);
  const byEnd = new Map(chosen.map((p) => [p.end, p] as const));
  const keys =
    choice === "all" && chosen.length
      ? quarterEnds(chosen[0]!.end, chosen[chosen.length - 1]!.end).filter(
          (k) => k >= chosen[0]!.end,
        )
      : chosen.map((p) => p.end);
  const months = new Set(chosen.map((p) => p.end.slice(5)));
  const annual = months.size === 1;
  return {
    keys,
    label: (k) => {
      const p = byEnd.get(k);
      return p
        ? `${periodText(p)} (${PUB_NAMES[p.pub] ?? p.pub})`
        : `No table for the period ending ${longDate(k)}`;
    },
    tick: (k) =>
      annual ? k.slice(0, 4) : `${MONTH_ABBR[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`,
  };
}

/** One series' points on the axis: the stored value at each chosen period, a gap (null) for a dash or a missing cell. */
export function seriesPoints(
  values: readonly (number | null)[] | undefined,
  periods: readonly Pick<UstPeriod, "end">[],
  idx: readonly number[],
): TrendDatum[] {
  return idx.map((i) => ({ key: periods[i]!.end, value: values?.[i] ?? null }));
}

export function trendSeries(
  id: string,
  label: string,
  values: readonly (number | null)[] | undefined,
  periods: readonly Pick<UstPeriod, "end">[],
  idx: readonly number[],
): TrendSeriesInput {
  return { id, label, points: seriesPoints(values, periods, idx) };
}

/** Value formatter for a column's unit; decimals as the publisher printed them for plain numbers. */
export function formatterFor(unit: UstUnit, dec: number | null): ValueFormatter {
  if (unit === "count") return metricFormatter("count");
  if (unit === "percent") return metricFormatter("percent");
  if (unit === "months") return metricFormatter("months");
  if (unit === "days") return metricFormatter("days");
  if (unit === "ratio") return metricFormatter("ratio");
  const d = dec ?? 1;
  return {
    full: (v) =>
      typeof v === "number" && Number.isFinite(v)
        ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
        : NOT_RECORDED,
    tick: (v) => v.toLocaleString("en-US", { maximumFractionDigits: d }),
    delta: (x) =>
      `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: d })}`,
  };
}

/** The unit as a chart frame states it. */
export function unitText(unit: UstUnit): string {
  switch (unit) {
    case "count":
      return "number, as published";
    case "percent":
      return "percent";
    case "months":
      return "months";
    case "days":
      return "days";
    case "ratio":
      return "ratio or average, as published";
    default:
      return "value, as published";
  }
}

/**
 * Breaks the publisher's own editions show (columns, title or source format changed) as labelled rules on the axis: once per
 * period, at most `max` of them, at least a fifth of the axis (and `minGap` periods) apart, the earlier one kept, so labels
 * never sit on each other.
 */
export function breakAnnotations(
  breaks: readonly UstBreak[],
  periods: readonly Pick<UstPeriod, "end">[],
  keys: readonly string[],
  max = 2,
  minGap = 2,
): Annotation[] {
  const position = new Map(keys.map((k, i) => [k, i] as const));
  // labels are about a fifth of a chart wide: rules closer than that would print their labels on each other
  const gap = Math.max(minGap, Math.ceil(keys.length / 5));
  const words: Record<string, string> = {
    columns: "Columns changed",
    title: "Title changed",
    source: "From spreadsheets",
    heading: "Heading reworded",
  };
  const out: (Annotation & { at: number })[] = [];
  for (const b of breaks) {
    const key = periods[b.at]?.end;
    const label = words[b.kind];
    const at = key ? position.get(key) : undefined;
    if (!key || !label || at === undefined) continue;
    if (out.some((a) => Math.abs(a.at - at) < gap)) continue;
    out.push({ key, label, at });
    if (out.length >= max) break;
  }
  return out.map(({ key, label }) => ({ key, label }));
}

/** Every court's latest value for one column, labelled by name where the name is known, for a ranked comparison. */
export function rankingItems(
  latest: LatestTable,
  col: string,
  names: ReadonlyMap<string, string>,
  courts?: ReadonlySet<string>,
): RankedItem[] {
  return Object.entries(latest.courts)
    .filter(([id]) => !courts || courts.has(id))
    .map(([id, values]) => ({
      id,
      label: names.get(id) ?? id.toUpperCase(),
      value: values[col] ?? null,
    }));
}

/** "S.D. New York" from "U.S. District Court, S.D. New York" (the court records' title); the input otherwise. */
export function shortName(name: string): string {
  return name
    .replace(/^U\.S\. (District|Bankruptcy) Court,\s*/, "")
    .replace(/^U\.S\. Court of Appeals for the\s*/, "");
}

export type SpliceResult = {
  values: (number | null)[];
  /** Index (into `keys`) of the column each period's value comes from; -1 for no value. */
  from: number[];
  /** Periods where two of the columns both carry a value (left as gaps: the splice never chooses). */
  conflicts: number[];
};

/**
 * One series from columns the publisher renamed between editions ("Total Filings" until June 2018, "Total All Chapters" from
 * September 2018): each period takes the one column that has a value. A period where two of them have values is a gap.
 */
export function spliceColumns(
  data: Readonly<Record<string, readonly (number | null)[]>>,
  keys: readonly string[],
  n: number,
): SpliceResult {
  const values: (number | null)[] = [];
  const from: number[] = [];
  const conflicts: number[] = [];
  for (let i = 0; i < n; i++) {
    const have = keys
      .map((k, j) => [j, data[k]?.[i] ?? null] as const)
      .filter(([, v]) => v != null);
    if (have.length === 1) {
      values.push(have[0]![1]);
      from.push(have[0]![0]);
    } else {
      values.push(null);
      from.push(-1);
      if (have.length > 1) conflicts.push(i);
    }
  }
  return { values, from, conflicts };
}

export type QuarterChange = {
  latestEnd: string;
  latest: number;
  priorEnd: string;
  prior: number;
  change: number;
  /** null when the earlier value is zero. */
  percent: number | null;
};

/**
 * The newest period against the period ending on the same date one year earlier (both printed), for quarterly tables. Null
 * when either is not recorded: a change is never computed from a gap.
 */
export function sameQuarterYearEarlier(
  periods: readonly Pick<UstPeriod, "end">[],
  values: readonly (number | null)[],
): QuarterChange | null {
  if (!periods.length) return null;
  const li = periods.length - 1;
  const latestEnd = periods[li]!.end;
  const priorEnd = `${Number(latestEnd.slice(0, 4)) - 1}${latestEnd.slice(4)}`;
  const pi = periods.findIndex((p) => p.end === priorEnd);
  const latest = values[li];
  const prior = pi >= 0 ? values[pi] : null;
  if (latest == null || prior == null) return null;
  return {
    latestEnd,
    latest,
    priorEnd,
    prior,
    change: latest - prior,
    percent: prior === 0 ? null : ((latest - prior) / Math.abs(prior)) * 100,
  };
}

/** Search text of a series card. */
export function cardText(c: SeriesCard): string {
  return `${c.table} ${c.title} ${c.geography} ${c.pubs.map((p) => PUB_NAMES[p] ?? p).join(" ")}`.toLowerCase();
}

export function matchesQuery(c: SeriesCard, q: string | undefined): boolean {
  if (!q) return true;
  const text = cardText(c);
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w));
}

/** Natural order of table numbers ("C-2" before "C-10"). */
export function compareTables(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x.localeCompare(y);
  }
  return 0;
}

export const RECONCILE_TEXT: Record<string, string> = {
  reconciled: "Every published period adds up to the totals it prints",
  held_periods: "Reconciled; some editions fail their own totals and are held",
  not_sums:
    "Prints totals that are not sums of its rows (they count parts the table does not list)",
  no_totals: "Prints no totals that can be added up (averages, medians, rates)",
};

// ------------------------------------------------------------------------------------------------ bankruptcy measures

export type Measure = "total" | "business" | "nonbusiness" | "ch7" | "ch11" | "ch13";

/** The measures of the bankruptcy views: one column, or columns the publisher renamed in September 2018 (no period prints both). */
export const BANKRUPTCY_MEASURES: Record<
  Measure,
  { label: string; keys: string[]; printed: string[] }
> = {
  total: {
    label: "All cases filed",
    keys: ["total_filings", "total_all_chapters"],
    printed: ["Total Filings", "Total All Chapters"],
  },
  business: {
    label: "Business cases",
    keys: [
      "predominant_nature_of_debt/business_filings/total",
      "predominant_nature_of_debt/business/all_chapters",
    ],
    printed: ["Business Filings / Total", "Business / All Chapters"],
  },
  nonbusiness: {
    label: "Nonbusiness (consumer) cases",
    keys: [
      "predominant_nature_of_debt/nonbusiness_filings/total",
      "predominant_nature_of_debt/nonbusiness/all_chapters",
    ],
    printed: ["Nonbusiness Filings / Total", "Nonbusiness / All Chapters"],
  },
  ch7: { label: "Chapter 7 cases", keys: ["total_chapter_7"], printed: ["Total Chapter 7"] },
  ch11: { label: "Chapter 11 cases", keys: ["total_chapter_11"], printed: ["Total Chapter 11"] },
  ch13: { label: "Chapter 13 cases", keys: ["total_chapter_13"], printed: ["Total Chapter 13"] },
};

/** One measure over a table's periods, joined across the September 2018 renaming; with the heading printed in each period. */
export function measureSeries(
  data: Readonly<Record<string, readonly (number | null)[]>>,
  measure: Measure,
  n: number,
) {
  const spec = BANKRUPTCY_MEASURES[measure];
  const s = spliceColumns(data, spec.keys, n);
  return {
    values: s.values,
    printed: s.from.map((j) => (j >= 0 ? spec.printed[j]! : null)),
    conflicts: s.conflicts,
  };
}

// ------------------------------------------------------------------------------------------------ column labels

const RELATIVE = /^y(m?)(\d+)$/;
const YEAR = /\b(19|20)\d{2}\b/;

function relativeWords(seg: string): string | null {
  const m = RELATIVE.exec(seg) ?? /_y(m?)(\d+)$/.exec(seg);
  if (!m) return null;
  const n = Number(m[2]);
  if (n === 0) return "this period";
  return m[1]
    ? n === 1
      ? "previous year"
      : `${n} years earlier`
    : n === 1
      ? "next year"
      : `${n} years later`;
}

/**
 * A column heading for a chart over many editions. Headings print the edition's own years ("Filed / 2026" in the 2026
 * edition, "Filed / 2025" in the 2025 one); the stored key says which year relative to the period a heading names ("filed/y0"),
 * so the year is written as "this period" or "previous year" instead of the last edition's year.
 */
export function columnDisplay(label: string, key: string): string {
  const parts = label.split(" / ");
  const segs = key.split("/");
  if (parts.length !== segs.length) return label;
  const kept: string[] = [];
  const qualifiers: string[] = [];
  parts.forEach((part, i) => {
    const words = relativeWords(segs[i]!);
    if (!words || !YEAR.test(part)) kept.push(part);
    else if (/^\s*(19|20)\d{2}\s*$/.test(part)) qualifiers.push(words);
    else kept.push(part.replace(YEAR, `(${words})`).replace(/,\s*\(/, " ("));
  });
  if (!qualifiers.length) return kept.join(" / ");
  if (!kept.length) return qualifiers.join(", ").replace(/^./, (c) => c.toUpperCase());
  return `${kept.join(" / ")} (${qualifiers.join(", ")})`;
}
