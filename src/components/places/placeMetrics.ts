/**
 * County, city and state analysis measures (datasets county_profiles, county_legal_activity, city_profiles,
 * state_cross_analysis, built by scripts/enrichment/state_analysis). Pure helpers: catalog, formatting, map classes,
 * rankings and distributions. A missing value is always "Not recorded", never zero.
 */
export const NOT_RECORDED = "Not recorded";

export type PlaceFormat = "int" | "pct" | "dollars" | "rate" | "dec1" | "change";
export type PlaceMetricGroup = "Legal activity" | "People" | "Economy" | "Housing";
export type PlaceMetric = {
  key: string;
  label: string;
  short: string;
  unit: string;
  format: PlaceFormat;
  group: PlaceMetricGroup;
  source: string;
  /** Five-year count behind a rate; below SMALL_BASE the rate is flagged as unstable. */
  base?: string;
  /**
   * false: shown where the record is described (county table) but never offered as a map or ranking measure, because
   * it does not measure what its place in a picker implies.
   */
  pickable?: boolean;
  /** Reading note shown beside the value wherever the measure appears. */
  caveat?: string;
};

/** Why fjc_rate is not a residence measure (Middlesex NJ: 45,053 of 47,891 filings FY2021-25 carry an MDL number). */
export const FJC_ALL_CAVEAT =
  "Includes MDL-numbered filings, which the FJC codes to the court's or defendant's county rather than where the plaintiff lives; use the core or non-MDL product-liability rates for residence.";

export const SMALL_BASE = 10;

const ACS = "Census ACS 2020-2024 5-year";
export const PLACE_METRICS: PlaceMetric[] = [
  {
    key: "fjc_core_rate",
    label: "Federal civil filings by residents (core)",
    short: "Core federal filings",
    unit: "per 100,000 a year",
    format: "rate",
    group: "Legal activity",
    source:
      "FJC Integrated Database, FY2021-FY2025, first plaintiff's county of residence; excludes prisoner petitions, MDL-numbered and U.S.-plaintiff cases",
    base: "fjc_core_5y",
  },
  {
    key: "fjc_core_product_rate",
    label: "Product-liability filings by residents, outside MDLs",
    short: "Non-MDL product liability",
    unit: "per 100,000 a year",
    format: "rate",
    group: "Legal activity",
    source:
      "FJC Integrated Database, FY2021-FY2025, first plaintiff's county of residence; core filings (no MDL number, prisoner petition or U.S. plaintiff) with a product-liability nature of suit; not published under 5 filings",
    base: "fjc_core_product_5y",
  },
  {
    key: "fjc_rate",
    label: "Federal civil filings coded to the county, incl. MDL (not a residence measure)",
    short: "Filings coded to county, incl. MDL",
    unit: "per 100,000 a year",
    format: "rate",
    group: "Legal activity",
    source: "FJC Integrated Database, FY2021-FY2025, IDB county code of the first plaintiff",
    base: "fjc_5y",
    pickable: false,
    caveat: FJC_ALL_CAVEAT,
  },
  {
    key: "osha_rate",
    label: "OSHA inspections",
    short: "OSHA inspections",
    unit: "per 100,000 a year",
    format: "rate",
    group: "Legal activity",
    source:
      "OSHA inspection data, FY2021-FY2025, site ZIP placed in a county by the Census ZCTA file",
    base: "osha_5y",
  },
  {
    key: "cfpb_rate",
    label: "CFPB consumer complaints",
    short: "CFPB complaints",
    unit: "per 100,000 a year",
    format: "rate",
    group: "Legal activity",
    source: "CFPB Consumer Complaint Database, 2021-2025, consumer ZIP placed in a county",
    base: "cfpb_5y",
  },
  {
    key: "cfpb_noncredit_rate",
    label: "CFPB complaints other than credit reporting",
    short: "CFPB, not credit reporting",
    unit: "per 100,000 a year",
    format: "rate",
    group: "Legal activity",
    source: "CFPB Consumer Complaint Database, 2021-2025, products other than credit reporting",
    base: "cfpb_noncredit_5y",
  },
  {
    key: "echo_formal_per_1k",
    label: "EPA and state formal enforcement actions",
    short: "Environmental actions",
    unit: "per 1,000 ECHO facilities",
    format: "rate",
    group: "Legal activity",
    source:
      "EPA ECHO Exporter (ICIS-Air, ICIS-NPDES, SDWIS, RCRAInfo), counties with 20+ facilities",
  },
  {
    key: "fjc_trend_pct",
    label: "Change in core federal filings by residents",
    short: "Filing trend",
    unit: "FY2016-18 to FY2023-25",
    format: "change",
    group: "Legal activity",
    source: "FJC Integrated Database; yearly means, both periods at least 5",
  },
  {
    key: "fjc_own_district_share",
    label: "Residents' filings made in their own district",
    short: "Filed in own district",
    unit: "% of filings",
    format: "pct",
    group: "Legal activity",
    source: "FJC Integrated Database, FY2021-FY2025; districts from 28 U.S.C. ch. 5",
  },
  {
    key: "resources",
    label: "County litigation resources in the corpus",
    short: "Litigation resources",
    unit: "records",
    format: "int",
    group: "Legal activity",
    source: "county_litigation records tagged with the county",
    pickable: false,
    caveat: "Counts saved court web pages in this corpus: coverage of the corpus, not legal activity.",
  },
  {
    key: "population",
    label: "Population",
    short: "Population",
    unit: "residents (July 1, 2025)",
    format: "int",
    group: "People",
    source: "Census Population Estimates, Vintage 2025",
  },
  {
    key: "density",
    label: "Population density",
    short: "Density",
    unit: "residents per sq mi",
    format: "dec1",
    group: "People",
    source: "Census Population Estimates and 2024 Gazetteer",
  },
  {
    key: "median_age",
    label: "Median age",
    short: "Median age",
    unit: "years",
    format: "dec1",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_under18",
    label: "Under 18",
    short: "Under 18",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_65plus",
    label: "Aged 65 and over",
    short: "65 and over",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_hispanic",
    label: "Hispanic or Latino",
    short: "Hispanic or Latino",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_white_nh",
    label: "White, not Hispanic",
    short: "White (not Hispanic)",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_black_nh",
    label: "Black, not Hispanic",
    short: "Black (not Hispanic)",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_asian_nh",
    label: "Asian, not Hispanic",
    short: "Asian (not Hispanic)",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "pct_foreign_born",
    label: "Foreign-born",
    short: "Foreign-born",
    unit: "% of residents",
    format: "pct",
    group: "People",
    source: ACS,
  },
  {
    key: "median_hh_income",
    label: "Median household income",
    short: "Median income",
    unit: "2024 dollars",
    format: "dollars",
    group: "Economy",
    source: ACS,
  },
  {
    key: "per_capita_personal_income",
    label: "Per capita personal income",
    short: "Personal income",
    unit: "dollars (2024)",
    format: "dollars",
    group: "Economy",
    source: "BEA CAINC1, 2024",
  },
  {
    key: "poverty_rate",
    label: "Below the poverty level",
    short: "Poverty",
    unit: "% of people",
    format: "pct",
    group: "Economy",
    source: ACS,
  },
  {
    key: "unemployment_rate",
    label: "Unemployment rate",
    short: "Unemployment",
    unit: "% (2025 annual average)",
    format: "pct",
    group: "Economy",
    source: "BLS Local Area Unemployment Statistics",
  },
  {
    key: "pct_bachelors",
    label: "Bachelor's degree or higher",
    short: "Bachelor's+",
    unit: "% of residents 25+",
    format: "pct",
    group: "Economy",
    source: ACS,
  },
  {
    key: "pct_uninsured",
    label: "No health insurance",
    short: "Uninsured",
    unit: "% of residents",
    format: "pct",
    group: "Economy",
    source: ACS,
  },
  {
    key: "owner_occupied",
    label: "Owner-occupied homes",
    short: "Owner-occupied",
    unit: "% of occupied units",
    format: "pct",
    group: "Housing",
    source: ACS,
  },
  {
    key: "median_home_value",
    label: "Median home value",
    short: "Home value",
    unit: "2024 dollars",
    format: "dollars",
    group: "Housing",
    source: ACS,
  },
  {
    key: "median_rent",
    label: "Median gross rent",
    short: "Gross rent",
    unit: "2024 dollars a month",
    format: "dollars",
    group: "Housing",
    source: ACS,
  },
];
export const METRIC_BY_KEY = new Map(PLACE_METRICS.map((m) => [m.key, m]));
export const DEFAULT_METRIC = "fjc_core_rate";
export const LEGAL_KEYS = PLACE_METRICS.filter((m) => m.group === "Legal activity").map(
  (m) => m.key,
);

export const isPickable = (m: PlaceMetric): boolean => m.pickable !== false;
/** Measures a map or ranking picker may offer. */
export const PICKABLE_KEYS: ReadonlySet<string> = new Set(
  PLACE_METRICS.filter(isPickable).map((m) => m.key),
);

/**
 * Picker groups: pickable measures only, and (when `rows` is given) only measures at least one row records, so a
 * measure whose packet is not published yet (fjc_core_product_rate) is never offered as an empty map.
 */
export function metricGroups(
  keys?: ReadonlySet<string>,
  rows?: readonly { metrics: Record<string, number | null | undefined> }[],
) {
  const out = new Map<PlaceMetricGroup, PlaceMetric[]>();
  for (const m of PLACE_METRICS) {
    if (!isPickable(m)) continue;
    if (keys && !keys.has(m.key)) continue;
    if (rows && !rows.some((r) => r.metrics[m.key] != null && Number.isFinite(r.metrics[m.key]!)))
      continue;
    out.set(m.group, [...(out.get(m.group) ?? []), m]);
  }
  return [...out.entries()].map(([group, items]) => ({ group, items }));
}

export function formatPlaceValue(value: number | null | undefined, format: PlaceFormat): string {
  if (value == null || !Number.isFinite(value)) return NOT_RECORDED;
  switch (format) {
    case "pct":
      return `${value.toFixed(1)}%`;
    case "change":
      return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(0)}%`;
    case "dollars":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "rate":
      return value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1);
    case "dec1":
      return Math.abs(value) >= 100
        ? Math.round(value).toLocaleString("en-US")
        : value.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

export function formatMetric(key: string, value: number | null | undefined): string {
  return formatPlaceValue(value, METRIC_BY_KEY.get(key)?.format ?? "int");
}

export type MetricRow = { id: string; name: string; metrics: Record<string, number | null> };

/** Linear-interpolated quantile (type 7) of finite values; null when empty. */
export function quantile(values: number[], q: number): number | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

/**
 * Quantile class breaks for a choropleth (up to `classes` classes, fewer when values repeat). Returns ascending upper
 * bounds; a value belongs to the first class whose bound is >= the value.
 */
export function classBreaks(values: number[], classes = 5): number[] {
  const v = values.filter(Number.isFinite);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i <= classes; i++) {
    const b = quantile(v, i / classes)!;
    if (!out.length || b > out[out.length - 1]!) out.push(b);
  }
  return out;
}

export function classOf(value: number | null | undefined, breaks: number[]): number | null {
  if (value == null || !Number.isFinite(value) || !breaks.length) return null;
  const i = breaks.findIndex((b) => value <= b);
  return i === -1 ? breaks.length - 1 : i;
}

/** Percent of the map's high color for class i of n (lightest class still distinguishable from "Not recorded"). */
export function classShade(i: number, n: number): number {
  if (n <= 1) return 55;
  return Math.round(14 + (i / (n - 1)) * 80);
}

export function isSmallBase(row: MetricRow, key: string): boolean {
  const base = METRIC_BY_KEY.get(key)?.base;
  if (!base) return false;
  const n = row.metrics[base];
  return n == null || n < SMALL_BASE;
}

export type Ranked = { id: string; name: string; value: number; rank: number; smallBase: boolean };

/** Rows with a value, highest first; ties share the lowest rank number. */
export function rankRows(rows: MetricRow[], key: string): Ranked[] {
  const withValue = rows
    .filter((r) => r.metrics[key] != null && Number.isFinite(r.metrics[key]!))
    .map((r) => ({
      id: r.id,
      name: r.name,
      value: r.metrics[key]!,
      smallBase: isSmallBase(r, key),
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  let rank = 0;
  let last: number | null = null;
  return withValue.map((r, i) => {
    if (last === null || r.value !== last) rank = i + 1;
    last = r.value;
    return { ...r, rank };
  });
}

export type Bin = { lo: number; hi: number; count: number };

/** Equal-width histogram over finite values (at most `bins` bins); empty input gives []. */
export function histogram(values: number[], bins = 12, cap = 1): Bin[] {
  const v = values.filter(Number.isFinite);
  if (!v.length) return [];
  const min = Math.min(...v),
    max = Math.max(...v);
  if (min === max) return [{ lo: min, hi: max, count: v.length }];
  // With cap < 1 the bins span min..quantile(cap); values above it fall in the last bin, whose upper end is the maximum,
  // so one extreme county does not flatten every other bar.
  const top = cap < 1 ? Math.max(quantile(v, cap)!, min) : max;
  const span = top > min ? top : max;
  const width = (span - min) / bins;
  const out: Bin[] = Array.from({ length: bins }, (_, i) => ({
    lo: min + i * width,
    hi: min + (i + 1) * width,
    count: 0,
  }));
  out[bins - 1]!.hi = max;
  for (const x of v) out[Math.min(bins - 1, Math.floor((x - min) / width))]!.count += 1;
  return out;
}

export type Summary = {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
};

export function summarize(values: number[]): Summary | null {
  const v = values.filter(Number.isFinite);
  if (!v.length) return null;
  return {
    n: v.length,
    min: Math.min(...v),
    p25: quantile(v, 0.25)!,
    median: quantile(v, 0.5)!,
    p75: quantile(v, 0.75)!,
    max: Math.max(...v),
  };
}

/** Residence classes of a district's filings (FJC IDB codes), in display order. */
export const RESIDENCE_CLASSES: { key: string; label: string }[] = [
  { key: "own_counties", label: "Lives in the district's counties" },
  { key: "other_in_state", label: "Lives in another district of the state" },
  { key: "in_state_no_district", label: "In-state county with no recorded district" },
  { key: "screened_code", label: "County code screened out (not residence)" },
  { key: "out_of_state", label: "Lives outside the state (88888)" },
  { key: "outside_us", label: "Lives outside the U.S. (99999)" },
  { key: "unmatched_code", label: "Code not a current county" },
  { key: "missing", label: "Not recorded" },
];

/** Shares (percent) of each residence class from raw counts; classes with no count are dropped. */
export function residenceShares(
  counts: Record<string, number>,
): { key: string; label: string; count: number; pct: number }[] {
  const total = Object.values(counts).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (!total) return [];
  return RESIDENCE_CLASSES.flatMap(({ key, label }) => {
    const c = counts[key] ?? 0;
    return c > 0 ? [{ key, label, count: c, pct: (c / total) * 100 }] : [];
  });
}

export function signed(x: number, digits = 2): string {
  return `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(digits)}`;
}

export function pText(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return NOT_RECORDED;
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

/** County FIPS (5 digits) and USPS checks for links built from stored values. */
export const isFips = (v: unknown): v is string => typeof v === "string" && /^\d{5}$/.test(v);
export const isCourtId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z]{2,4}d$/.test(v);
