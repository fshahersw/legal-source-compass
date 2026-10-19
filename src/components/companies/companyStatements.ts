/**
 * Financial statements, segments and investor documents of an SEC registrant (datasets company_sec_statements,
 * company_sec_segments and company_sec_ir_documents, built by scripts/enrichment/sec/build_company_statements.py and
 * build_company_ir.py). Pure parsers and view helpers: stored JSON is validated defensively, malformed rows are dropped
 * and unknown values stay null ("Not recorded"), never guessed.
 */
import { NOT_RECORDED, type CompanySummary } from "./companyData";

/* ---------- primitive guards ---------- */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
const ACCN = /^\d{10}-\d{2}-\d{6}$/;
const accn = (v: unknown) => (typeof v === "string" && ACCN.test(v) ? v : null);
const SEC_URL = /^https:\/\/(www\.)?sec\.gov\//;
const secUrl = (v: unknown) => (typeof v === "string" && SEC_URL.test(v) ? v : null);
const numbers = (v: unknown, length: number) => {
  const a = arr(v);
  return Array.from({ length }, (_, i) => num(a[i]));
};

/* ---------- statements ---------- */
export type Grain = "annual" | "quarterly";
export type StatementKind = "income" | "balance" | "cashflow";
/** 0 = as filed, 1 = derived from other filed values of the same concept, 2 = computed from two lines. */
export type CellBasis = 0 | 1 | 2;
export type Cell = { v: number; accn: string | null; concept: string | null; basis: CellBasis };
export type Period = { fy: number; q: number | null; start: string; end: string };
export type Line = {
  key: string;
  label: string;
  statement: StatementKind;
  unit: string | null;
  annual: (Cell | null)[];
  quarterly: (Cell | null)[];
};
export const MARGIN_KEYS = [
  "gross_margin",
  "operating_margin",
  "net_margin",
  "fcf_margin",
] as const;
export type MarginKey = (typeof MARGIN_KEYS)[number];
export type Statements = {
  annualPeriods: Period[];
  quarterlyPeriods: Period[];
  lines: Record<string, Line>;
  margins: Record<Grain, Record<MarginKey, (number | null)[]>>;
  growth: Record<Grain, Record<string, (number | null)[]>>;
};
export type Logo = {
  path: string;
  sourcePage: string | null;
  sourceImage: string | null;
  sha256: string | null;
  retrieved: string | null;
};
export type FilingRef = { form: string; accn: string; date: string; url: string };
export type FilingRow = FilingRef & {
  reportDate: string | null;
  items: string | null;
  description: string | null;
  indexUrl: string | null;
};
export type StatementsProfile = {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  stateOfIncorporation: string | null;
  fiscalYearEnd: string | null;
  category: string | null;
  website: string | null;
  irWebsite: string | null;
  description: string | null;
  descriptionSource: FilingRef | null;
  logo: Logo | null;
  currency: string | null;
  priceNote: string | null;
  supplement: FilingRef[];
  statements: Statements | null;
  filings: FilingRow[];
  retrieved: string | null;
};

const STATEMENT_KINDS = new Set(["income", "balance", "cashflow"]);

function period(v: unknown, quarterly: boolean): Period | null {
  if (!isObj(v)) return null;
  const fy = int(v["fy"]);
  const start = date(v["start"]);
  const end = date(v["end"]);
  const q = quarterly ? int(v["q"]) : null;
  if (fy === null || !start || !end || (quarterly && (q === null || q < 1 || q > 4))) return null;
  return { fy, q, start, end };
}

function cell(v: unknown): Cell | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const value = num(v[0]);
  const basis = v[3];
  if (value === null || (basis !== 0 && basis !== 1 && basis !== 2)) return null;
  return { v: value, accn: accn(v[1]), concept: str(v[2]), basis };
}

const cells = (v: unknown, length: number) => {
  const a = arr(v);
  return Array.from({ length }, (_, i) => cell(a[i]));
};

/** Periods must be complete: one malformed period would shift every later column, so the grain is dropped instead. */
function periods(v: unknown, quarterly: boolean): Period[] | null {
  const raw = arr(v);
  const out = raw.map((p) => period(p, quarterly));
  return out.every((p): p is Period => p !== null) ? out : null;
}

export function parseStatements(v: unknown): Statements | null {
  if (!isObj(v) || !isObj(v["lines"])) return null;
  const annualPeriods = periods(v["annual_periods"], false) ?? [];
  const quarterlyPeriods = periods(v["quarterly_periods"], true) ?? [];
  if (!annualPeriods.length && !quarterlyPeriods.length) return null;
  const lines: Record<string, Line> = {};
  for (const [key, raw] of Object.entries(v["lines"] as Obj)) {
    if (!isObj(raw)) continue;
    const statement = raw["statement"];
    if (typeof statement !== "string" || !STATEMENT_KINDS.has(statement)) continue;
    const annual = cells(raw["annual"], annualPeriods.length);
    const quarterly = cells(raw["quarterly"], quarterlyPeriods.length);
    if (!annual.some(Boolean) && !quarterly.some(Boolean)) continue;
    lines[key] = {
      key,
      label: str(raw["label"]) ?? key,
      statement: statement as StatementKind,
      unit: str(raw["unit"]),
      annual,
      quarterly,
    };
  }
  const marginsRaw = isObj(v["margins"]) ? (v["margins"] as Obj) : {};
  const growthRaw = isObj(v["growth"]) ? (v["growth"] as Obj) : {};
  const margins = {} as Statements["margins"];
  const growth = {} as Statements["growth"];
  for (const grain of ["annual", "quarterly"] as const) {
    const length = grain === "annual" ? annualPeriods.length : quarterlyPeriods.length;
    const m = isObj(marginsRaw[grain]) ? (marginsRaw[grain] as Obj) : {};
    margins[grain] = Object.fromEntries(
      MARGIN_KEYS.map((k) => [k, numbers(m[k], length)]),
    ) as Record<MarginKey, (number | null)[]>;
    const g = isObj(growthRaw[grain]) ? (growthRaw[grain] as Obj) : {};
    growth[grain] = Object.fromEntries(Object.entries(g).map(([k, x]) => [k, numbers(x, length)]));
  }
  return { annualPeriods, quarterlyPeriods, lines, margins, growth };
}

function filingRef(v: unknown): FilingRef | null {
  if (!isObj(v)) return null;
  const form = str(v["form"]);
  const a = accn(v["accn"]);
  const d = date(v["date"]);
  const url = secUrl(v["url"]);
  return form && a && d && url ? { form, accn: a, date: d, url } : null;
}

function filingRow(v: unknown): FilingRow | null {
  const ref = filingRef(v);
  if (!ref || !isObj(v)) return null;
  return {
    ...ref,
    reportDate: date(v["report_date"]),
    items: str(v["items"]),
    description: str(v["description"]),
    indexUrl: secUrl(v["index_url"]),
  };
}

const LOGO_PATH = /^\/company-logos\/\d{10}\.(png|svg)$/;
const HTTP = /^https?:\/\//;

function logo(v: unknown): Logo | null {
  if (!isObj(v)) return null;
  const path = typeof v["path"] === "string" && LOGO_PATH.test(v["path"]) ? v["path"] : null;
  if (!path) return null;
  const page = str(v["source_page"]);
  const image = str(v["source_image"]);
  return {
    path,
    sourcePage: page && HTTP.test(page) ? page : null,
    sourceImage: image && HTTP.test(image) ? image : null,
    sha256: str(v["sha256"]),
    retrieved: date(v["retrieved"]),
  };
}

const DOMAIN = /^(?:https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;
const site = (v: unknown) => {
  const s = str(v);
  return s && DOMAIN.test(s) ? s.replace(/^https?:\/\//i, "").replace(/\/$/, "") : null;
};

export function parseStatementsProfile(v: unknown): StatementsProfile | null {
  if (!isObj(v)) return null;
  const cik = typeof v["cik"] === "string" && /^\d{10}$/.test(v["cik"]) ? v["cik"] : null;
  const name = str(v["name"]);
  if (!cik || !name) return null;
  return {
    cik,
    name,
    tickers: strs(v["tickers"]),
    exchanges: strs(v["exchanges"]),
    sic: str(v["sic"]),
    sicDescription: str(v["sic_description"]),
    stateOfIncorporation: str(v["state_of_incorporation"]),
    fiscalYearEnd:
      typeof v["fiscal_year_end"] === "string" && /^\d{4}$/.test(v["fiscal_year_end"])
        ? v["fiscal_year_end"]
        : null,
    // EDGAR joins two categories with an HTML line break ("Large Accelerated<br>Well Known Seasoned Issuer").
    category: str(v["category"])?.replace(/\s*<br\s*\/?>\s*/gi, " · ") ?? null,
    website: site(v["website"]),
    irWebsite: site(v["ir_website"]),
    description: str(v["description"]),
    descriptionSource: filingRef(v["description_source"]),
    logo: logo(v["logo"]),
    currency: str(v["currency"]),
    priceNote: str(v["price_note"]),
    supplement: arr(v["statements_supplement"])
      .map(filingRef)
      .filter((f): f is FilingRef => f !== null),
    statements: parseStatements(v["statements"]),
    filings: arr(v["filings"])
      .map(filingRow)
      .filter((f): f is FilingRow => f !== null),
    retrieved: date(v["retrieved"]),
  };
}

/* ---------- statement view helpers ---------- */
export const STATEMENT_LINES: Record<StatementKind, string[]> = {
  income: [
    "revenue",
    "cost_of_revenue",
    "gross_profit",
    "rnd",
    "sga",
    "operating_income",
    "interest_expense",
    "pretax_income",
    "income_tax",
    "net_income",
    "eps_basic",
    "eps_diluted",
    "shares_diluted",
  ],
  balance: [
    "cash",
    "short_term_investments",
    "receivables",
    "inventory",
    "current_assets",
    "ppe",
    "goodwill",
    "intangibles",
    "total_assets",
    "current_liabilities",
    "long_term_debt",
    "total_liabilities",
    "equity",
    "liabilities_and_equity",
  ],
  cashflow: ["cfo", "capex", "fcf", "cfi", "cff", "dna", "sbc", "dividends", "buybacks"],
};
export const STATEMENT_LABEL: Record<StatementKind, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  cashflow: "Cash flow statement",
};
/** Lines shown in bold as subtotals. */
export const SUBTOTALS = new Set([
  "gross_profit",
  "operating_income",
  "net_income",
  "total_assets",
  "total_liabilities",
  "equity",
  "cfo",
  "fcf",
]);
export const MARGIN_LABEL: Record<MarginKey, string> = {
  gross_margin: "Gross margin",
  operating_margin: "Operating margin",
  net_margin: "Net margin",
  fcf_margin: "Free cash flow margin",
};
export const BASIS_LABEL: Record<CellBasis, string> = {
  0: "As filed",
  1: "Derived from other filed values of the same concept",
  2: "Computed from two reported lines",
};

export function periodsOf(s: Statements, grain: Grain) {
  return grain === "annual" ? s.annualPeriods : s.quarterlyPeriods;
}

export function periodLabel(p: Period) {
  return p.q === null ? `FY${p.fy}` : `Q${p.q} FY${p.fy}`;
}

/** Statement lines in display order, only those with a value in the grain. */
export function statementRows(s: Statements, kind: StatementKind, grain: Grain): Line[] {
  return STATEMENT_LINES[kind]
    .map((k) => s.lines[k])
    .filter((l): l is Line => !!l && l.statement === kind && l[grain].some(Boolean));
}

export type Scale = { divisor: number; label: string };

/** Money lines in millions when the largest value is at least 10 million, otherwise in thousands. */
export function moneyScale(s: Statements): Scale {
  let max = 0;
  for (const l of Object.values(s.lines))
    if (!l.unit?.includes("/") && l.unit !== "shares")
      for (const c of [...l.annual, ...l.quarterly]) if (c) max = Math.max(max, Math.abs(c.v));
  return max >= 1e7 ? { divisor: 1e6, label: "millions" } : { divisor: 1e3, label: "thousands" };
}

export function unitKind(unit: string | null): "money" | "per_share" | "shares" {
  if (unit === "shares") return "shares";
  if (unit?.includes("/")) return "per_share";
  return "money";
}

/** A table cell: money and share counts scaled (negatives in parentheses), per-share values to two decimals. */
export function tableValue(c: Cell | null, unit: string | null, scale: Scale): string {
  if (!c) return "—";
  const kind = unitKind(unit);
  if (kind === "per_share") return c.v < 0 ? `(${Math.abs(c.v).toFixed(2)})` : c.v.toFixed(2);
  const scaled = Math.abs(c.v) / (kind === "shares" ? 1e6 : scale.divisor);
  const digits = scaled !== 0 && scaled < 10 ? 1 : 0;
  const text = scaled.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return c.v < 0 ? `(${text})` : text;
}

export function unitCaption(line: Line, scale: Scale, currency: string | null) {
  const kind = unitKind(line.unit);
  if (kind === "shares") return "shares, millions";
  if (kind === "per_share") return `${line.unit?.split("/")[0] ?? currency ?? ""} per share`;
  return `${line.unit ?? currency ?? ""} ${scale.label}`;
}

const csvField = (v: string | number | null) => {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Tidy CSV of one grain: one row per line and period, full units, with basis, concept and accession. */
export function statementsCsv(s: Statements, grain: Grain, cik: string): string {
  const ps = periodsOf(s, grain);
  const rows: (string | number | null)[][] = [
    [
      "cik",
      "statement",
      "line",
      "unit",
      "fiscal_year",
      "fiscal_quarter",
      "period_start",
      "period_end",
      "value",
      "basis",
      "concept",
      "accession",
    ],
  ];
  for (const kind of ["income", "balance", "cashflow"] as const)
    for (const line of statementRows(s, kind, grain))
      line[grain].forEach((c, i) => {
        const p = ps[i];
        if (!c || !p) return;
        rows.push([
          cik,
          STATEMENT_LABEL[kind],
          line.label,
          line.unit,
          p.fy,
          p.q,
          p.start,
          p.end,
          c.v,
          ["as filed", "derived", "computed"][c.basis] ?? null,
          c.concept,
          c.accn,
        ]);
      });
  return rows.map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}

export type TrendRow = {
  label: string;
  end: string;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
  fcf: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
};

export function trendRows(s: Statements, grain: Grain): TrendRow[] {
  const value = (key: string, i: number) => s.lines[key]?.[grain][i]?.v ?? null;
  return periodsOf(s, grain).map((p, i) => ({
    label: periodLabel(p),
    end: p.end,
    revenue: value("revenue", i),
    operating_income: value("operating_income", i),
    net_income: value("net_income", i),
    fcf: value("fcf", i),
    gross_margin: s.margins[grain].gross_margin[i] ?? null,
    operating_margin: s.margins[grain].operating_margin[i] ?? null,
    net_margin: s.margins[grain].net_margin[i] ?? null,
  }));
}

export type LatestValue = { value: number; period: Period; cell: Cell; unit: string | null };

/** The most recent period with a value for the line. */
export function latestValue(s: Statements, key: string, grain: Grain): LatestValue | null {
  const line = s.lines[key];
  const ps = periodsOf(s, grain);
  if (!line) return null;
  for (let i = ps.length - 1; i >= 0; i--) {
    const c = line[grain][i];
    const p = ps[i];
    if (c && p) return { value: c.v, period: p, cell: c, unit: line.unit };
  }
  return null;
}

/** Margin or growth of the given period index; null when not computable. */
export function seriesAt(series: (number | null)[] | undefined, period: Period, ps: Period[]) {
  const i = ps.indexOf(period);
  return i >= 0 ? (series?.[i] ?? null) : null;
}

/* ---------- segments ---------- */
export type SegmentKind = "segment" | "product" | "geography";
export type SegmentGrain = {
  periods: { start: string; end: string }[];
  values: Record<string, (number | null)[]>;
  accn: Record<string, (string | null)[]>;
};
export type SegmentCheck = {
  start: string;
  end: string;
  members: number;
  sum: number;
  total: number | null;
  diffPct: number | null;
  status: "matches" | "differs" | "no_total";
};
export type SegmentAxis = {
  axis: string;
  kind: SegmentKind;
  measure: "revenue" | "operating_income";
  concept: string;
  unit: string | null;
  members: { member: string; label: string }[];
  annual: SegmentGrain | null;
  quarterly: SegmentGrain | null;
  checks: SegmentCheck[];
};
export type SegmentsProfile = {
  cik: string;
  axes: SegmentAxis[];
  filingsUsed: FilingRef[];
  retrieved: string | null;
};

const SEGMENT_KINDS = new Set(["segment", "product", "geography"]);

function segmentGrain(v: unknown, members: Set<string>): SegmentGrain | null {
  if (!isObj(v) || !isObj(v["values"])) return null;
  const ps = arr(v["periods"]).map((p) =>
    isObj(p) && date(p["start"]) && date(p["end"])
      ? { start: p["start"] as string, end: p["end"] as string }
      : null,
  );
  if (!ps.length || ps.some((p) => p === null)) return null;
  const length = ps.length;
  const values: Record<string, (number | null)[]> = {};
  const accns: Record<string, (string | null)[]> = {};
  const accnRaw = isObj(v["accn"]) ? (v["accn"] as Obj) : {};
  for (const [m, raw] of Object.entries(v["values"] as Obj)) {
    if (!members.has(m)) continue;
    const vals = numbers(raw, length);
    if (!vals.some((x) => x !== null)) continue;
    values[m] = vals;
    accns[m] = Array.from({ length }, (_, i) => accn(arr(accnRaw[m])[i]));
  }
  return Object.keys(values).length
    ? { periods: ps as { start: string; end: string }[], values, accn: accns }
    : null;
}

function segmentCheck(v: unknown): SegmentCheck | null {
  if (!isObj(v)) return null;
  const start = date(v["start"]);
  const end = date(v["end"]);
  const sum = num(v["sum"]);
  const s = v["status"];
  if (!start || !end || sum === null || (s !== "matches" && s !== "differs" && s !== "no_total"))
    return null;
  return {
    start,
    end,
    members: int(v["members"]) ?? 0,
    sum,
    total: num(v["total"]),
    diffPct: num(v["diff_pct"]),
    status: s,
  };
}

function segmentAxis(v: unknown): SegmentAxis | null {
  if (!isObj(v)) return null;
  const kind = v["kind"];
  const measure = v["measure"];
  const axis = str(v["axis"]);
  const concept = str(v["concept"]);
  if (!axis || !concept || typeof kind !== "string" || !SEGMENT_KINDS.has(kind)) return null;
  if (measure !== "revenue" && measure !== "operating_income") return null;
  const members = arr(v["members"])
    .map((m) =>
      isObj(m) && str(m["member"]) && str(m["label"])
        ? { member: m["member"] as string, label: m["label"] as string }
        : null,
    )
    .filter((m): m is { member: string; label: string } => m !== null);
  const ids = new Set(members.map((m) => m.member));
  const annual = segmentGrain(v["annual"], ids);
  const quarterly = segmentGrain(v["quarterly"], ids);
  if (!members.length || (!annual && !quarterly)) return null;
  return {
    axis,
    kind: kind as SegmentKind,
    measure,
    concept,
    unit: str(v["unit"]),
    members,
    annual,
    quarterly,
    checks: arr(v["checks"])
      .map(segmentCheck)
      .filter((c): c is SegmentCheck => c !== null),
  };
}

export function parseSegmentsProfile(v: unknown): SegmentsProfile | null {
  if (!isObj(v)) return null;
  const cik = typeof v["cik"] === "string" && /^\d{10}$/.test(v["cik"]) ? v["cik"] : null;
  if (!cik) return null;
  const axes = arr(v["axes"])
    .map(segmentAxis)
    .filter((a): a is SegmentAxis => a !== null);
  if (!axes.length) return null;
  return {
    cik,
    axes,
    filingsUsed: arr(v["filings_used"])
      .map(filingRef)
      .filter((f): f is FilingRef => f !== null),
    retrieved: date(v["retrieved"]),
  };
}

export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  segment: "Business segments",
  product: "Products and services",
  geography: "Geography",
};

/** Members ordered by their latest value (largest first); the rest beyond `limit` are summed into "Other members". */
const within = (a: number, b: number, tolerance = 0.01) =>
  Math.abs(a - b) <= tolerance * Math.max(Math.abs(b), 1);

/**
 * Members that are subtotals of other members (e.g. "Non-US" beside its countries). A candidate must make the other
 * members add up to the consolidated total in the latest period that reports one (where all members together do not),
 * and in at least half of the periods that report one (periods drawn from different filings may list different
 * members), and its label must name an aggregate ("Non-US", "International", "Total ..."). Only revenue axes and a
 * single unambiguous member are considered; anything else is left as filed. `matched` of `compared` periods fit
 * without the subtotal.
 */
export function subtotalMembers(
  axis: SegmentAxis,
  grain: Grain,
): { members: string[]; matched: number; compared: number } {
  const none = { members: [], matched: 0, compared: 0 };
  const g = axis[grain];
  if (!g || axis.measure !== "revenue") return none;
  const periods = g.periods
    .map((p, i) => ({
      i,
      total: axis.checks.find((c) => c.start === p.start && c.end === p.end)?.total ?? null,
    }))
    .filter((x): x is { i: number; total: number } => x.total !== null && x.total !== 0);
  const latest = periods[periods.length - 1];
  if (!latest) return none;
  const members = Object.keys(g.values);
  const sumAt = (i: number, without: string[]) =>
    members.filter((m) => !without.includes(m)).reduce((a, m) => a + (g.values[m]?.[i] ?? 0), 0);
  if (within(sumAt(latest.i, []), latest.total)) return none;
  const fitsAt = (p: { i: number; total: number }, without: string[]) =>
    without.every((m) => g.values[m]?.[p.i] != null) && within(sumAt(p.i, without), p.total);
  const matchedFor = (without: string[]) => periods.filter((p) => fitsAt(p, without)).length;
  const fits = (without: string[]) =>
    fitsAt(latest, without) && 2 * matchedFor(without) >= periods.length;
  const found = (without: string[]) => ({
    members: without,
    matched: matchedFor(without),
    compared: periods.length,
  });
  const label = new Map(axis.members.map((m) => [m.member, m.label]));
  const singles = members.filter((m) => fits([m]));
  // A gap can equal one member's value by coincidence (eliminations, corporate items), so the member's own label must
  // also name an aggregate.
  return singles.length === 1 && SUBTOTAL_LABEL.test(label.get(singles[0]!) ?? "")
    ? found(singles)
    : none;
}

const SUBTOTAL_LABEL =
  /\b(total|subtotal|non-?\s?u\.?s\.?|international|int['’]l|outside|excluding|rest of|all other|other countries|foreign)\b/i;

export function segmentSeries(
  axis: SegmentAxis,
  grain: Grain,
  limit = 8,
  exclude: ReadonlySet<string> = new Set(),
) {
  const g = axis[grain];
  if (!g) return null;
  const last = g.periods.length - 1;
  const label = new Map(axis.members.map((m) => [m.member, m.label]));
  const ordered = Object.keys(g.values)
    .filter((m) => !exclude.has(m))
    .sort((a, b) => Math.abs(g.values[b]?.[last] ?? 0) - Math.abs(g.values[a]?.[last] ?? 0));
  const shown = ordered.slice(0, limit);
  const rest = ordered.slice(limit);
  const keys = shown.map((m, i) => ({ key: `m${i}`, member: m, label: label.get(m) ?? m }));
  if (rest.length) keys.push({ key: "other", member: "", label: `Other members (${rest.length})` });
  const rows = g.periods.map((p, i) => {
    const row: Record<string, string | number | null> = { end: p.end };
    shown.forEach((m, j) => {
      row[`m${j}`] = g.values[m]?.[i] ?? null;
    });
    if (rest.length) {
      const vals = rest.map((m) => g.values[m]?.[i] ?? null).filter((x): x is number => x !== null);
      row["other"] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    }
    return row;
  });
  return { keys, rows };
}

/** Latest-period mix: each member's value and share of the members' sum (not of the consolidated total). */
export function latestMix(
  axis: SegmentAxis,
  grain: Grain,
  exclude: ReadonlySet<string> = new Set(),
) {
  const g = axis[grain];
  if (!g) return null;
  const last = g.periods.length - 1;
  const label = new Map(axis.members.map((m) => [m.member, m.label]));
  const items = Object.entries(g.values)
    .filter(([m]) => !exclude.has(m))
    .map(([m, vals]) => ({ member: m, label: label.get(m) ?? m, value: vals[last] ?? null }))
    .filter((x): x is { member: string; label: string; value: number } => x.value !== null)
    .sort((a, b) => b.value - a.value);
  const sum = items.reduce((a, x) => a + x.value, 0);
  const period = g.periods[last]!;
  const check = axis.checks.find((c) => c.start === period.start && c.end === period.end) ?? null;
  return {
    period,
    items: items.map((x) => ({
      ...x,
      share: sum > 0 && x.value >= 0 ? (100 * x.value) / sum : null,
    })),
    sum,
    check,
  };
}

export function checkText(c: SegmentCheck | null, money: (v: number) => string): string {
  if (!c) return "No consolidated total was compared for this period.";
  if (c.status === "no_total")
    return `Members sum to ${money(c.sum)}; the filing reports no consolidated total for the same concept and period.`;
  if (c.status === "matches")
    return `Members sum to ${money(c.sum)}, within 1% of the consolidated ${money(c.total ?? 0)}.`;
  return `Members sum to ${money(c.sum)} against a consolidated ${money(c.total ?? 0)} (${c.diffPct !== null && c.diffPct > 0 ? "+" : ""}${c.diffPct ?? NOT_RECORDED}%). Shown as filed; the difference is usually eliminations, corporate items or members on another axis.`;
}

/* ---------- investor documents ---------- */
export type DocType = "earnings_release" | "presentation" | "transcript" | "other";
export type FigureScale = "units" | "thousands" | "millions" | "billions";
export type Figure = { value: number; scale: FigureScale | null; quote: string };
export type CheckStatus = "matches" | "rounded" | "differs" | "no_xbrl_value" | "not_extracted";
export type XbrlCheck = {
  status: CheckStatus;
  xbrl: number | null;
  extracted: number | null;
  xbrlAccn: string | null;
  derived: boolean;
};
export type Extraction = {
  periodLabel: string | null;
  periodEnd: string | null;
  revenue: Figure | null;
  netIncome: Figure | null;
  epsDiluted: Figure | null;
  segments: (Figure & { name: string })[];
  kpis: { name: string; value: string; quote: string }[];
  guidance: { metric: string; text: string; quote: string }[];
  quarter: Period | null;
  checks: { revenue: XbrlCheck | null; netIncome: XbrlCheck | null; epsDiluted: XbrlCheck | null };
};
export type IrDocument = {
  id: string;
  cik: string;
  accn: string;
  date: string;
  form: string;
  items: string | null;
  exhibit: string;
  description: string | null;
  docType: DocType;
  url: string;
  indexUrl: string | null;
  chars: number | null;
  truncated: boolean;
  transcribed: boolean;
  extraction: Extraction | null;
};

const DOC_TYPES = new Set(["earnings_release", "presentation", "transcript", "other"]);
const SCALES = new Set(["units", "thousands", "millions", "billions"]);
const CHECKS = new Set(["matches", "rounded", "differs", "no_xbrl_value", "not_extracted"]);
export const IR_ID = /^\d{10}:\d{10}-\d{2}-\d{6}:[A-Za-z0-9.]{1,20}:[0-9a-f]{6}$/;

function figure(v: unknown): Figure | null {
  if (!isObj(v)) return null;
  const value = num(v["value"]);
  const quote = str(v["quote"]);
  if (value === null || !quote) return null;
  const scale =
    typeof v["scale"] === "string" && SCALES.has(v["scale"]) ? (v["scale"] as FigureScale) : null;
  return { value, scale, quote };
}

function xbrlCheck(v: unknown): XbrlCheck | null {
  if (!isObj(v) || typeof v["status"] !== "string" || !CHECKS.has(v["status"])) return null;
  return {
    status: v["status"] as CheckStatus,
    xbrl: num(v["xbrl"]),
    extracted: num(v["extracted"]),
    xbrlAccn: accn(v["xbrl_accn"]),
    derived: v["derived"] === true,
  };
}

function extraction(v: unknown): Extraction | null {
  if (!isObj(v)) return null;
  const checks = isObj(v["xbrl_checks"]) ? (v["xbrl_checks"] as Obj) : {};
  const out: Extraction = {
    periodLabel: str(v["period_label"]),
    periodEnd: date(v["period_end"]),
    revenue: figure(v["revenue"]),
    netIncome: figure(v["net_income"]),
    epsDiluted: figure(v["eps_diluted"]),
    segments: arr(v["segments"])
      .map((s) => {
        const f = figure(s);
        const name = isObj(s) ? str(s["name"]) : null;
        return f && name ? { ...f, name } : null;
      })
      .filter((s): s is Figure & { name: string } => s !== null),
    kpis: arr(v["kpis"])
      .map((k) =>
        isObj(k) &&
        str(k["name"]) &&
        str(k["quote"]) &&
        (str(k["value"]) || num(k["value"]) !== null)
          ? {
              name: k["name"] as string,
              value: str(k["value"]) ?? String(k["value"]),
              quote: k["quote"] as string,
            }
          : null,
      )
      .filter((k): k is { name: string; value: string; quote: string } => k !== null),
    guidance: arr(v["guidance"])
      .map((g) =>
        isObj(g) && str(g["metric"]) && str(g["quote"])
          ? {
              metric: g["metric"] as string,
              text: str(g["text"]) ?? "",
              quote: g["quote"] as string,
            }
          : null,
      )
      .filter((g): g is { metric: string; text: string; quote: string } => g !== null),
    quarter: period(v["xbrl_quarter"], true),
    checks: {
      revenue: xbrlCheck(checks["revenue"]),
      netIncome: xbrlCheck(checks["net_income"]),
      epsDiluted: xbrlCheck(checks["eps_diluted"]),
    },
  };
  const any =
    out.revenue ||
    out.netIncome ||
    out.epsDiluted ||
    out.segments.length ||
    out.kpis.length ||
    out.guidance.length;
  return any ? out : null;
}

export function parseIrDocument(id: unknown, v: unknown): IrDocument | null {
  if (typeof id !== "string" || !IR_ID.test(id) || !isObj(v)) return null;
  const cik = typeof v["cik"] === "string" && /^\d{10}$/.test(v["cik"]) ? v["cik"] : null;
  const a = accn(v["accn"]);
  const d = date(v["date"]);
  const form = str(v["form"]);
  const exhibit = str(v["exhibit"]);
  const url = secUrl(v["url"]);
  const docType = v["doc_type"];
  if (
    !cik ||
    !a ||
    !d ||
    !form ||
    !exhibit ||
    !url ||
    typeof docType !== "string" ||
    !DOC_TYPES.has(docType)
  )
    return null;
  return {
    id,
    cik,
    accn: a,
    date: d,
    form,
    items: str(v["items"]),
    exhibit,
    description: str(v["description"]),
    docType: docType as DocType,
    url,
    indexUrl: secUrl(v["index_url"]),
    chars: int(v["chars"]),
    truncated: v["truncated"] === true,
    transcribed: v["transcribed"] === true,
    extraction: extraction(v["extraction"]),
  };
}

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  earnings_release: "Earnings release",
  presentation: "Presentation",
  transcript: "Call transcript",
  other: "Other exhibit",
};

/** A readable title: the exhibit description unless it only repeats the exhibit number or file name. */
export function documentTitle(d: IrDocument): string {
  const desc = d.description?.trim() ?? "";
  const generic =
    !desc ||
    /^(ex-?|exhibit\s*)99/i.test(desc) ||
    /\.(htm|html|pdf|txt)$/i.test(desc) ||
    desc.toLowerCase() === d.exhibit.toLowerCase();
  if (!generic) return desc;
  const period = d.extraction?.periodLabel;
  return period ? `${DOC_TYPE_LABEL[d.docType]}: ${period}` : DOC_TYPE_LABEL[d.docType];
}

export const CHECK_LABEL: Record<CheckStatus, string> = {
  matches: "Matches XBRL",
  rounded: "Matches XBRL at the precision reported",
  differs: "Differs from XBRL",
  no_xbrl_value: "No XBRL value for this quarter",
  not_extracted: "Not read",
};

export function figureAmount(f: Figure, perShare = false): number {
  if (perShare) return f.value;
  const factor = { units: 1, thousands: 1e3, millions: 1e6, billions: 1e9 }[f.scale ?? "units"];
  return f.value * factor;
}

/* ---------- filings ---------- */
export const FILING_GROUPS = [
  {
    id: "periodic",
    label: "Annual and quarterly reports",
    forms: ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "40-F"],
  },
  { id: "current", label: "Current reports", forms: ["8-K", "8-K/A", "6-K"] },
  { id: "other", label: "Proxy and registration", forms: ["DEF 14A", "S-1", "S-4", "424B2"] },
] as const;
export type FilingGroup = (typeof FILING_GROUPS)[number]["id"];

export function filingsIn(rows: FilingRow[], group: FilingGroup | "all") {
  if (group === "all") return rows;
  const forms = new Set<string>(FILING_GROUPS.find((g) => g.id === group)?.forms ?? []);
  return rows.filter((r) => forms.has(r.form));
}

/** 8-K item numbers, as the SEC lists them (2.02 results of operations, 7.01 Regulation FD, ...). */
export const ITEM_LABEL: Record<string, string> = {
  "1.01": "Material agreement",
  "1.02": "Agreement terminated",
  "2.01": "Acquisition or disposition",
  "2.02": "Results of operations",
  "2.03": "Financial obligation",
  "2.05": "Exit or disposal costs",
  "2.06": "Material impairment",
  "3.01": "Listing notice",
  "5.02": "Officers or directors",
  "5.03": "Charter or bylaws",
  "5.07": "Shareholder vote",
  "7.01": "Regulation FD",
  "8.01": "Other events",
  "9.01": "Financial statements and exhibits",
  "1.03": "Bankruptcy or receivership",
  "2.04": "Triggering events",
  "3.02": "Unregistered equity sales",
  "3.03": "Rights of holders modified",
  "4.01": "Auditor change",
  "4.02": "Non-reliance on financial statements",
  "5.01": "Change in control",
  "5.04": "Benefit plan blackout",
  "5.05": "Code of ethics",
  "5.08": "Shareholder nominations",
};

const STATES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  PR: "Puerto Rico",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/** EDGAR state-of-incorporation code as a name; foreign codes (e.g. L2) are shown as recorded. */
export function stateName(code: string | null) {
  if (!code) return NOT_RECORDED;
  return STATES[code] ?? `EDGAR code ${code}`;
}

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

/** EDGAR fiscal year end "MMDD" as "December 31". */
export function fiscalYearEnd(mmdd: string | null) {
  if (!mmdd) return NOT_RECORDED;
  const m = Number(mmdd.slice(0, 2));
  const d = Number(mmdd.slice(2));
  const name = MONTHS[m - 1];
  return name && d >= 1 && d <= 31 ? `${name} ${d}` : NOT_RECORDED;
}

/** "ABT · NYSE" style ticker line; the statements profile first, then the MDL profile. */
export function tickerLine(p: StatementsProfile | null, s: CompanySummary | null): string {
  const tickers = p?.tickers.length ? p.tickers : (s?.profile.tickers ?? []);
  const exchanges = p?.exchanges.length ? p.exchanges : (s?.profile.exchanges ?? []);
  if (!tickers.length) return "No ticker recorded";
  return `${tickers.join(", ")}${exchanges.length ? ` · ${[...new Set(exchanges)].join(", ")}` : ""}`;
}
