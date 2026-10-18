/**
 * Types and defensive parsers for the SEC company-intelligence datasets (company_sec_*), plus pure
 * view helpers shared by /companies and /companies/$cik. No I/O here, so it is safe on both sides.
 */

export type Tier = "A" | "B" | "C";
export type Role = "defendant" | "not_named" | "plaintiff" | "unclear";
export type MdlStatus = "pending" | "terminated" | "no_longer_listed";
export type FlagKey =
  "accrual_surge" | "accrual_heavy" | "expense_spike" | "docket_growth" | "multi_mdl";
export const METRICS = [
  "revenue",
  "net_income",
  "assets",
  "cash",
  "rnd",
  "litigation_accrual",
  "possible_loss",
  "litigation_expense",
  "legal_payments",
] as const;
export type Metric = (typeof METRICS)[number];

export type FinPoint = {
  fy: number;
  end: string;
  start: string | null;
  value: number;
  unit: string;
  concept: string;
  accn: string | null;
  form: string | null;
  filed: string | null;
};
export type SparkPoint = { fy: number; v: number };
export type SeriesPoint = { date: string; pending: number; mdls?: number };

export type CompanyProfile = {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  stateOfIncorporation: string | null;
  businessState: string | null;
  businessCity: string | null;
  fiscalYearEnd: string | null;
  formerNames: string[];
};
export type CompanyMdl = {
  mdl: number;
  title: string;
  status: MdlStatus;
  type: string | null;
  pending: number | null;
  change12m: number | null;
  tier: Tier;
  role: Role;
  verifiedCount: number;
  firstVerified: string | null;
  lastVerified: string | null;
  countsTowardExposure: boolean;
  district: string | null;
  judge: string | null;
};
export type Exposure = {
  linkedMdls: number;
  pendingMdls: number;
  pendingActions: number | null;
  pendingChange12m: number | null;
  pendingChangePct: number | null;
  sharePct: number | null;
  strongestTier: Tier | null;
  excludedByRole: number;
};
export type CompanySummary = {
  profile: CompanyProfile;
  hasFinancials: boolean;
  coRegistrantOf: string[];
  currency: string | null;
  mdls: CompanyMdl[];
  exposure: Exposure;
  latest: Partial<Record<Metric, FinPoint>>;
  accrualPctRevenue: number | null;
  accrualYoyPct: number | null;
  expenseYoyPct: number | null;
  accrualPctSeries: { fy: number; pct: number }[];
  spark: Record<
    "revenue" | "net_income" | "litigation_accrual" | "litigation_expense",
    SparkPoint[]
  >;
  pendingSeries: SeriesPoint[];
  mentionsByYear: { year: number; verified: number; search: number }[];
  verifiedFilings: number;
  flags: FlagKey[];
};
export type CoverageRow = {
  mdl: number;
  title: string;
  status: MdlStatus;
  pending: number | null;
  companies: { cik: string; name: string; tier: Tier; role: Role }[];
};
export type CompaniesOverview = {
  asOf: string;
  jpmlAsOf: string | null;
  targetMdls: number;
  pendingTargets: number;
  mdlsWithLinks: number;
  pendingMdlsWithLinks: number;
  companies: number;
  companiesWithFinancials: number;
  links: number;
  tiers: Partial<Record<Tier, number>>;
  verifiedFilings: number;
  filingsByYear: { year: number; A: number; B: number; C: number }[];
  coverage: CoverageRow[];
  medianAccrualPctRevenue: number | null;
  flagRules: Partial<Record<FlagKey, string>>;
  flagLabels: Partial<Record<FlagKey, string>>;
  tierLabels: Partial<Record<Tier, string>>;
  roleLabels: Partial<Record<Role, string>>;
  method: string[];
};
export type CompaniesData = { overview: CompaniesOverview; companies: CompanySummary[] };

export type EvidenceFiling = {
  adsh: string;
  form: string;
  fileDate: string;
  periodEnding: string | null;
  url: string;
  indexUrl: string | null;
  matched: string;
  role: Role;
  coRegistrants: string[];
  excerpt: string | null;
};
export type CompanyLink = {
  mdl: number;
  title: string;
  status: MdlStatus;
  type: string | null;
  pending: number | null;
  change12m: number | null;
  district: string | null;
  judge: string | null;
  terminationYear: number | null;
  tier: Tier;
  tierLabel: string;
  role: Role;
  roleLabel: string;
  verifiedCount: number;
  searchCount: number;
  checked: number;
  firstVerified: string | null;
  lastVerified: string | null;
  byYear: { year: number; verified: number; search: number }[];
  verified: EvidenceFiling[];
  searchUrls: string[];
  countsTowardExposure: boolean;
  series: SeriesPoint[];
};
export type Financials = {
  taxonomy: string | null;
  retrieved: string | null;
  conceptsPresent: string[];
  annual: Record<Metric, FinPoint[]>;
  quarterly: Record<Metric, FinPoint[]>;
  accrualPctRevenue: { fy: number; pct: number }[];
  expensePctRevenue: { fy: number; pct: number }[];
  labels: Partial<Record<Metric, string>>;
};
export type CompanyDetail = {
  summary: CompanySummary;
  sourceUrl: string | null;
  financials: Financials | null;
  links: CompanyLink[];
};

/* ---------- primitive guards ---------- */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
const TIERS = new Set(["A", "B", "C"]);
const ROLES = new Set(["defendant", "not_named", "plaintiff", "unclear"]);
const FLAGS = new Set([
  "accrual_surge",
  "accrual_heavy",
  "expense_spike",
  "docket_growth",
  "multi_mdl",
]);
const tier = (v: unknown): Tier | null =>
  typeof v === "string" && TIERS.has(v) ? (v as Tier) : null;
const role = (v: unknown): Role =>
  typeof v === "string" && ROLES.has(v) ? (v as Role) : "unclear";
const status = (v: unknown): MdlStatus =>
  v === "terminated" || v === "no_longer_listed" ? v : v === "pending" ? "pending" : "terminated";
const SEC_URL = /^https:\/\/(www\.)?sec\.gov\//;
const secUrl = (v: unknown) => (typeof v === "string" && SEC_URL.test(v) ? v : null);

function finPoint(v: unknown): FinPoint | null {
  if (!isObj(v)) return null;
  const fy = int(v["fy"]);
  const value = num(v["value"]);
  const end = date(v["end"]);
  const unit = str(v["unit"]);
  const concept = str(v["concept"]);
  if (fy === null || value === null || !end || !unit || !concept) return null;
  return {
    fy,
    end,
    start: date(v["start"]),
    value,
    unit,
    concept,
    accn: str(v["accn"]),
    form: str(v["form"]),
    filed: date(v["filed"]),
  };
}
const finPoints = (v: unknown) =>
  arr(v)
    .map(finPoint)
    .filter((p): p is FinPoint => p !== null);
const spark = (v: unknown) =>
  arr(v)
    .map((p) =>
      isObj(p) && int(p["fy"]) !== null && num(p["v"]) !== null
        ? { fy: p["fy"] as number, v: p["v"] as number }
        : null,
    )
    .filter((p): p is SparkPoint => p !== null);
const pctSeries = (v: unknown) =>
  arr(v)
    .map((p) =>
      isObj(p) && int(p["fy"]) !== null && num(p["pct"]) !== null
        ? { fy: p["fy"] as number, pct: p["pct"] as number }
        : null,
    )
    .filter((p): p is { fy: number; pct: number } => p !== null);
const seriesPoints = (v: unknown) =>
  arr(v)
    .map((p) => {
      if (!isObj(p)) return null;
      const d = date(p["date"]);
      const pending = int(p["pending"]);
      if (!d || pending === null) return null;
      const mdls = int(p["mdls"]);
      return mdls === null ? { date: d, pending } : { date: d, pending, mdls };
    })
    .filter((p): p is SeriesPoint => p !== null);
const yearCounts = (v: unknown) =>
  arr(v)
    .map((p) =>
      isObj(p) && int(p["year"]) !== null
        ? {
            year: p["year"] as number,
            verified: int(p["verified"]) ?? 0,
            search: int(p["search"]) ?? 0,
          }
        : null,
    )
    .filter((p): p is { year: number; verified: number; search: number } => p !== null);

function profile(v: unknown): CompanyProfile | null {
  if (!isObj(v)) return null;
  const cik = str(v["cik"]);
  const name = str(v["name"]);
  if (!cik || !/^\d{10}$/.test(cik) || !name) return null;
  return {
    cik,
    name,
    tickers: strs(v["tickers"]),
    exchanges: strs(v["exchanges"]),
    sic: str(v["sic"]),
    sicDescription: str(v["sic_description"]),
    stateOfIncorporation: str(v["state_of_incorporation"]),
    businessState: str(v["business_state"]),
    businessCity: str(v["business_city"]),
    fiscalYearEnd: str(v["fiscal_year_end"]),
    formerNames: strs(v["former_names"]),
  };
}

function companyMdl(v: unknown): CompanyMdl | null {
  if (!isObj(v)) return null;
  const mdl = int(v["mdl"]);
  const t = tier(v["tier"]);
  const title = str(v["mdl_title"]);
  if (mdl === null || !t || !title) return null;
  return {
    mdl,
    title,
    status: status(v["mdl_status"]),
    type: str(v["mdl_type"]),
    pending: int(v["pending"]),
    change12m: int(v["change_12m"]),
    tier: t,
    role: role(v["role"]),
    verifiedCount: int(v["verified_count"]) ?? 0,
    firstVerified: date(v["first_verified"]),
    lastVerified: date(v["last_verified"]),
    countsTowardExposure: v["counts_toward_exposure"] === true,
    district: str(v["district"]),
    judge: str(v["judge"]),
  };
}

export function parseCompanySummary(v: unknown): CompanySummary | null {
  if (!isObj(v)) return null;
  const p = profile(v["company"]);
  if (!p) return null;
  const mdls = arr(v["mdls"])
    .map(companyMdl)
    .filter((m): m is CompanyMdl => m !== null);
  if (!mdls.length) return null;
  const e = isObj(v["exposure"]) ? v["exposure"] : {};
  const latestRaw = isObj(v["latest"]) ? v["latest"] : {};
  const latest: Partial<Record<Metric, FinPoint>> = {};
  for (const m of METRICS) {
    const point = finPoint(latestRaw[m]);
    if (point) latest[m] = point;
  }
  const sp = isObj(v["spark"]) ? v["spark"] : {};
  return {
    profile: p,
    hasFinancials: v["has_financials"] === true,
    coRegistrantOf: strs(v["co_registrant_of"]),
    currency: str(v["currency"]),
    mdls,
    exposure: {
      linkedMdls: int(e["linked_mdls"]) ?? mdls.length,
      pendingMdls: int(e["pending_mdls"]) ?? 0,
      pendingActions: int(e["pending_actions"]),
      pendingChange12m: int(e["pending_change_12m"]),
      pendingChangePct: num(e["pending_change_pct"]),
      sharePct: num(e["share_of_all_pending_pct"]),
      strongestTier: tier(e["strongest_tier"]),
      excludedByRole: int(e["excluded_by_role"]) ?? 0,
    },
    latest,
    accrualPctRevenue: num(v["accrual_pct_revenue"]),
    accrualYoyPct: num(v["accrual_yoy_pct"]),
    expenseYoyPct: num(v["expense_yoy_pct"]),
    accrualPctSeries: pctSeries(v["accrual_pct_series"]),
    spark: {
      revenue: spark(sp["revenue"]),
      net_income: spark(sp["net_income"]),
      litigation_accrual: spark(sp["litigation_accrual"]),
      litigation_expense: spark(sp["litigation_expense"]),
    },
    pendingSeries: seriesPoints(v["pending_series"]),
    mentionsByYear: yearCounts(v["mentions_by_year"]),
    verifiedFilings: int(v["verified_filings"]) ?? 0,
    flags: strs(v["flags"]).filter((f): f is FlagKey => FLAGS.has(f)),
  };
}

const record = <K extends string>(v: unknown, keys: Set<string>) => {
  const out: Partial<Record<K, string>> = {};
  if (isObj(v))
    for (const [k, x] of Object.entries(v))
      if (keys.has(k) && typeof x === "string") out[k as K] = x;
  return out;
};

export function parseOverview(v: unknown): CompaniesOverview | null {
  if (!isObj(v) || !date(v["as_of"])) return null;
  const tiers: Partial<Record<Tier, number>> = {};
  if (isObj(v["tiers"]))
    for (const t of ["A", "B", "C"] as const) {
      const n = int((v["tiers"] as Obj)[t]);
      if (n !== null) tiers[t] = n;
    }
  return {
    asOf: v["as_of"] as string,
    jpmlAsOf: date(v["jpml_as_of"]),
    targetMdls: int(v["target_mdls"]) ?? 0,
    pendingTargets: int(v["pending_targets"]) ?? 0,
    mdlsWithLinks: int(v["mdls_with_links"]) ?? 0,
    pendingMdlsWithLinks: int(v["pending_mdls_with_links"]) ?? 0,
    companies: int(v["companies"]) ?? 0,
    companiesWithFinancials: int(v["companies_with_financials"]) ?? 0,
    links: int(v["links"]) ?? 0,
    tiers,
    verifiedFilings: int(v["verified_filings"]) ?? 0,
    filingsByYear: arr(v["filings_by_year"])
      .map((r) =>
        isObj(r) && int(r["year"]) !== null
          ? {
              year: r["year"] as number,
              A: int(r["A"]) ?? 0,
              B: int(r["B"]) ?? 0,
              C: int(r["C"]) ?? 0,
            }
          : null,
      )
      .filter((r): r is { year: number; A: number; B: number; C: number } => r !== null),
    coverage: arr(v["coverage"])
      .map((r): CoverageRow | null => {
        if (!isObj(r) || int(r["mdl"]) === null || !str(r["title"])) return null;
        return {
          mdl: r["mdl"] as number,
          title: r["title"] as string,
          status: status(r["status"]),
          pending: int(r["pending"]),
          companies: arr(r["companies"])
            .map((c) => {
              if (!isObj(c)) return null;
              const cik = str(c["cik"]);
              const name = str(c["name"]);
              const t = tier(c["tier"]);
              return cik && name && t ? { cik, name, tier: t, role: role(c["role"]) } : null;
            })
            .filter((c): c is CoverageRow["companies"][number] => c !== null),
        };
      })
      .filter((r): r is CoverageRow => r !== null),
    medianAccrualPctRevenue: num(v["median_accrual_pct_revenue"]),
    flagRules: record<FlagKey>(v["flag_rules"], FLAGS),
    flagLabels: record<FlagKey>(v["flag_labels"], FLAGS),
    tierLabels: record<Tier>(v["tier_labels"], TIERS),
    roleLabels: record<Role>(v["role_labels"], ROLES),
    method: strs(v["method"]),
  };
}

function filing(v: unknown): EvidenceFiling | null {
  if (!isObj(v)) return null;
  const adsh = str(v["adsh"]);
  const url = secUrl(v["url"]);
  const fileDate = date(v["file_date"]);
  if (!adsh || !url || !fileDate) return null;
  return {
    adsh,
    form: str(v["form"]) ?? "Filing",
    fileDate,
    periodEnding: date(v["period_ending"]),
    url,
    indexUrl: secUrl(v["index_url"]),
    matched: str(v["matched"]) ?? "",
    role: role(v["role"]),
    coRegistrants: strs(v["co_registrants"]),
    excerpt: str(v["excerpt"]),
  };
}

export function parseLink(v: unknown): CompanyLink | null {
  if (!isObj(v)) return null;
  const mdl = int(v["mdl"]);
  const t = tier(v["tier"]);
  const title = str(v["mdl_title"]);
  const verified = arr(v["verified"])
    .map(filing)
    .filter((f): f is EvidenceFiling => f !== null);
  if (mdl === null || !t || !title || !verified.length) return null;
  return {
    mdl,
    title,
    status: status(v["mdl_status"]),
    type: str(v["mdl_type"]),
    pending: int(v["pending"]),
    change12m: int(v["change_12m"]),
    district: str(v["district"]),
    judge: str(v["judge"]),
    terminationYear: int(v["termination_year"]),
    tier: t,
    tierLabel: str(v["tier_label"]) ?? TIER_LABEL[t],
    role: role(v["role"]),
    roleLabel: str(v["role_label"]) ?? ROLE_LABEL[role(v["role"])],
    verifiedCount: int(v["verified_count"]) ?? verified.length,
    searchCount: int(v["search_count"]) ?? 0,
    checked: int(v["checked"]) ?? 0,
    firstVerified: date(v["first_verified"]),
    lastVerified: date(v["last_verified"]),
    byYear: yearCounts(v["by_year"]),
    verified,
    searchUrls: strs(v["search_urls"]).filter((u) => u.startsWith("https://efts.sec.gov/")),
    countsTowardExposure: v["counts_toward_exposure"] === true,
    series: seriesPoints(v["series"]),
  };
}

export function parseFinancials(v: unknown): Financials | null {
  if (!isObj(v) || !isObj(v["annual"])) return null;
  const annualRaw = v["annual"] as Obj;
  const quarterlyRaw = isObj(v["quarterly"]) ? (v["quarterly"] as Obj) : {};
  const annual = {} as Record<Metric, FinPoint[]>;
  const quarterly = {} as Record<Metric, FinPoint[]>;
  for (const m of METRICS) {
    annual[m] = finPoints(annualRaw[m]);
    quarterly[m] = finPoints(quarterlyRaw[m]);
  }
  const derived = isObj(v["derived"]) ? (v["derived"] as Obj) : {};
  return {
    taxonomy: str(v["taxonomy"]),
    retrieved: date(v["retrieved"]),
    conceptsPresent: strs(v["concepts_present"]),
    annual,
    quarterly,
    accrualPctRevenue: pctSeries(derived["accrual_pct_revenue"]),
    expensePctRevenue: pctSeries(derived["expense_pct_revenue"]),
    labels: record<Metric>(v["labels"], new Set(METRICS)),
  };
}

/* ---------- view helpers ---------- */
export const TIER_LABEL: Record<Tier, string> = {
  A: "Filing cites the MDL number",
  B: "Filing cites the official MDL caption",
  C: "Filing describes the MDL by its subject (requires review)",
};
export const TIER_SHORT: Record<Tier, string> = {
  A: "MDL number",
  B: "Caption",
  C: "Subject · review",
};
export const ROLE_LABEL: Record<Role, string> = {
  defendant: "Excerpt describes claims against the company",
  not_named: "Excerpt says the company is not named",
  plaintiff: "Excerpt describes the company as a claimant",
  unclear: "Role not stated in excerpt",
};
export const ROLE_SHORT: Record<Role, string> = {
  defendant: "Defendant (excerpt)",
  not_named: "Not named",
  plaintiff: "Claimant",
  unclear: "Not stated",
};
export const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Revenue",
  net_income: "Net income",
  assets: "Total assets",
  cash: "Cash and equivalents",
  rnd: "R&D expense",
  litigation_accrual: "Litigation / loss-contingency accrual",
  possible_loss: "Estimate of possible loss",
  litigation_expense: "Litigation expense in period",
  legal_payments: "Payments for legal settlements",
};

export const NOT_RECORDED = "Not recorded";
export function money(value: number | null | undefined, unit?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return NOT_RECORDED;
  const a = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const u = unit && unit !== "USD" ? ` ${unit}` : "";
  const prefix = !unit || unit === "USD" ? "$" : "";
  for (const [div, suf] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const)
    if (a >= div) return `${sign}${prefix}${(a / div).toFixed(a / div >= 100 ? 0 : 1)}${suf}${u}`;
  return `${sign}${prefix}${a.toLocaleString("en-US")}${u}`;
}
export const count = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-US") : NOT_RECORDED;
export const pct = (v: number | null | undefined, digits = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}%` : NOT_RECORDED;
export const signedPct = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%`
    : NOT_RECORDED;

export type SortKey =
  | "name"
  | "mdls"
  | "pending"
  | "revenue"
  | "net_income"
  | "accrual"
  | "accrual_pct"
  | "accrual_yoy";

export function sortValue(c: CompanySummary, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return c.profile.name.toLowerCase();
    case "mdls":
      return c.exposure.linkedMdls;
    case "pending":
      return c.exposure.pendingActions;
    case "revenue":
      return c.latest.revenue?.value ?? null;
    case "net_income":
      return c.latest.net_income?.value ?? null;
    case "accrual":
      return c.latest.litigation_accrual?.value ?? null;
    case "accrual_pct":
      return c.accrualPctRevenue;
    case "accrual_yoy":
      return c.accrualYoyPct;
  }
}

/** Sort with nulls ("Not recorded") always last, regardless of direction. */
export function sortCompanies(rows: CompanySummary[], key: SortKey, dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.profile.name.localeCompare(b.profile.name);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.profile.name.localeCompare(b.profile.name);
  });
}

export type CompanyFilter = {
  q: string;
  tier: "" | Tier;
  flag: "" | FlagKey;
  financials: boolean;
  pendingOnly: boolean;
};
export const EMPTY_FILTER: CompanyFilter = {
  q: "",
  tier: "",
  flag: "",
  financials: false,
  pendingOnly: false,
};

export function filterCompanies(rows: CompanySummary[], f: CompanyFilter) {
  const q = f.q.trim().toLowerCase();
  return rows.filter((c) => {
    if (f.tier && c.exposure.strongestTier !== f.tier) return false;
    if (f.flag && !c.flags.includes(f.flag)) return false;
    if (f.financials && !c.hasFinancials) return false;
    if (f.pendingOnly && !c.exposure.pendingMdls) return false;
    if (!q) return true;
    return (
      c.profile.name.toLowerCase().includes(q) ||
      c.profile.tickers.some((t) => t.toLowerCase() === q) ||
      (c.profile.sicDescription ?? "").toLowerCase().includes(q) ||
      c.mdls.some((m) => String(m.mdl) === q || m.title.toLowerCase().includes(q))
    );
  });
}

/** Median of a list of numbers (null when empty). */
export function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Companies to show in the accrual small multiples: those with 3+ fiscal years of accrual data,
 * ranked by latest accrual. */
export function accrualMultiples(rows: CompanySummary[], limit = 12) {
  return rows
    .filter((c) => c.spark.litigation_accrual.length >= 3 && c.latest.litigation_accrual)
    .sort(
      (a, b) =>
        (b.latest.litigation_accrual?.value ?? 0) - (a.latest.litigation_accrual?.value ?? 0),
    )
    .slice(0, limit);
}

export function edgarCompanyUrl(cik: string) {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`;
}
export function companyfactsUrl(cik: string) {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
}
