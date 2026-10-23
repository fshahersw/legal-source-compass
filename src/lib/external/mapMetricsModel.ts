/**
 * Metrics for the home map (and the state analytics map): what each one counts, the Census denominator and year behind
 * every rate, and the pure helpers (ranks, class breaks, formatting). Inputs are rows already read from the published
 * datasets; stored JSON is untrusted, so a value that does not parse is left out ("Not recorded"), never zero and never
 * filled from another state.
 *
 * Rates divide a count by the Census Bureau's Population Estimates for July 1 of the stated year
 * (dataset census_pop_estimates); the count's own year and source are stated beside it.
 */
import { stateByName, STATES } from "@/lib/corpus/geo";
import { PUERTO_RICO } from "@/lib/corpus/stateHub";
import { num, obj, str } from "./placeAnalysisParse";

export const NOT_RECORDED = "Not recorded";
export type MapFormat = "int" | "rate1" | "dollars" | "pct" | "dec1";
export type MapGroup =
  "Courts and litigation" | "Enforcement and complaints" | "People and economy" | "Directory";

export type MapMetricDef = {
  key: string;
  label: string;
  /** Short label for the selector and legend title. */
  short: string;
  group: MapGroup;
  unit: string;
  format: MapFormat;
  /** What is counted, and what a reader should not read into it. */
  help: string;
  /** Key of the county-layer counterpart, or null when no county data of this kind exists. */
  county: string | null;
  /** How the county counterpart differs from the state metric, shown whenever the county layer is on. */
  countyNote?: string;
};

export const STATE_METRICS: MapMetricDef[] = [
  {
    key: "fed_filings_rate",
    label: "Federal civil filings per 100,000 residents",
    short: "Federal civil filings per 100,000",
    group: "Courts and litigation",
    unit: "per 100,000 residents",
    format: "rate1",
    help: "Civil cases filed in the state's federal district courts in the fiscal year (FJC Integrated Database), divided by the state's resident population. A case is counted where it is filed, not where the parties live; prisoner petitions are included.",
    county: "fjc_core_rate",
    countyNote:
      "County layer: civil cases filed by plaintiffs living in the county (core filings, excluding prisoner petitions, MDL-numbered and U.S.-plaintiff cases), yearly mean FY2021 to FY2025 per 100,000 residents. A different count from the state figure.",
  },
  {
    key: "fed_filings",
    label: "Federal civil cases filed",
    short: "Federal civil cases filed",
    group: "Courts and litigation",
    unit: "cases",
    format: "int",
    help: "Civil cases filed in the state's federal district courts in the fiscal year (FJC Integrated Database). A count, so it follows population size; see the per-100,000 measure to compare states.",
    county: null,
  },
  {
    key: "mdl_pending",
    label: "Pending MDL actions in the state's federal courts",
    short: "Pending MDL actions",
    group: "Courts and litigation",
    unit: "actions",
    format: "int",
    help: "Actions pending in multidistrict litigations whose transferee court sits in the state (JPML pending-MDL reports, as compiled for the matter registry). Where an action was first filed is a different count.",
    county: null,
  },
  {
    key: "judges_rate",
    label: "Active federal district judges per 100,000 residents",
    short: "District judges per 100,000",
    group: "Courts and litigation",
    unit: "judges per 100,000 residents",
    format: "rate1",
    help: "Active Article III district judges (including chief judges) in the state's district courts, from the Federal Judicial Center's biographical directory, divided by resident population. Senior judges, magistrate judges and state judges are not counted.",
    county: null,
  },
  {
    key: "cfpb_rate",
    label: "CFPB consumer complaints per 100,000 residents",
    short: "CFPB complaints per 100,000",
    group: "Enforcement and complaints",
    unit: "per 100,000 residents",
    format: "rate1",
    help: "Complaints received by the Consumer Financial Protection Bureau in the calendar year, by consumer state, divided by resident population. Complaints are not a statistical sample, and credit-reporting complaints dominate recent years.",
    county: "cfpb_rate",
    countyNote:
      "County layer: complaints by consumer ZIP placed in a county, yearly mean 2021 to 2025 per 100,000 residents.",
  },
  {
    key: "osha_rate",
    label: "OSHA inspections per 100,000 covered jobs",
    short: "OSHA inspections per 100,000 jobs",
    group: "Enforcement and complaints",
    unit: "per 100,000 covered jobs",
    format: "rate1",
    help: "OSHA and State Plan inspections in the fiscal year divided by covered employment from the Bureau of Labor Statistics QCEW (an employment denominator, not a population one).",
    county: "osha_rate",
    countyNote:
      "County layer: inspections by site ZIP placed in a county, yearly mean FY2021 to FY2025 per 100,000 residents (a population denominator).",
  },
  {
    key: "echo_formal_5y",
    label: "Facilities with a formal environmental enforcement action, past 5 years",
    short: "Facilities with a formal action",
    group: "Enforcement and complaints",
    unit: "facilities",
    format: "int",
    help: "EPA ECHO-regulated facilities with a formal federal or state enforcement action in the past five years. A count that follows the number of regulated facilities.",
    county: null,
  },
  {
    key: "pop",
    label: "Population",
    short: "Population",
    group: "People and economy",
    unit: "residents",
    format: "int",
    help: "Resident population on July 1 (Census Bureau Population Estimates).",
    county: "pop",
  },
  ...(
    [
      ["median_hh_income", "Median household income", "dollars (2024)", "dollars"],
      ["per_capita_income", "Per capita income", "dollars (2024)", "dollars"],
      ["poverty_rate", "People below the poverty level", "% of people", "pct"],
      ["unemployment_rate", "Unemployment rate", "% of the civilian labor force", "pct"],
      ["bachelors_plus", "Bachelor's degree or higher", "% of people 25 and over", "pct"],
      ["uninsured", "No health insurance coverage", "% of people", "pct"],
      ["median_age", "Median age", "years", "dec1"],
      ["age_65plus", "Aged 65 and over", "% of residents", "pct"],
      ["non_english", "Language other than English at home", "% of people 5 and over", "pct"],
      ["median_home_value", "Median home value", "dollars (2024)", "dollars"],
    ] as const
  ).map(([key, label, unit, format]): MapMetricDef => ({
    key: `acs:${key}`,
    label,
    short: label,
    group: "People and economy",
    unit,
    format,
    help: "American Community Survey 5-year estimate, 2020 to 2024 (Census Bureau). A survey estimate with a margin of error; small differences between areas may not be real differences.",
    county: `acs:${key}`,
  })),
  {
    key: "directory_sources",
    label: "Research sources recorded in the directory",
    short: "Research sources recorded",
    group: "Directory",
    unit: "sources",
    format: "int",
    help: "How many research sources the atlas directory records for the state. It counts directory entries, not legal completeness, caseload or activity.",
    county: null,
  },
];
export const STATE_METRIC_BY_KEY = new Map(STATE_METRICS.map((m) => [m.key, m]));
export const DEFAULT_MAP_METRIC = "fed_filings_rate";
export const MAP_GROUPS: MapGroup[] = [
  "Courts and litigation",
  "Enforcement and complaints",
  "People and economy",
  "Directory",
];

/** Display format of a county-layer metric (the state metric it belongs to has the same unit). */
export const COUNTY_LAYER_FORMAT: Record<string, MapFormat> = Object.fromEntries(
  STATE_METRICS.filter((m) => m.county).map((m) => [m.county!, m.format]),
);

/** Unit text for the county layer of a metric (the legal rates are yearly means per 100,000 residents). */
export function countyLayerUnit(def: MapMetricDef): string {
  return def.county && /^(fjc_core_rate|cfpb_rate|osha_rate)$/.test(def.county)
    ? "per 100,000 residents a year"
    : def.unit;
}

// ---------------------------------------------------------------------------------------------------- arithmetic
/** count / population x 100,000; null when either input is missing, the count is negative or the population is not positive. */
export function ratePer100k(
  count: number | null | undefined,
  pop: number | null | undefined,
): number | null {
  if (count == null || pop == null || !Number.isFinite(count) || !Number.isFinite(pop)) return null;
  if (count < 0 || pop <= 0) return null;
  return (count / pop) * 100_000;
}

/** Standard competition ranks (1 = highest; ties share a rank and the next rank is skipped) over the given keys only. */
export function competitionRank(
  values: Record<string, number>,
  scope: Iterable<string>,
): Record<string, { rank: number; of: number }> {
  const entries = [...new Set(scope)]
    .flatMap((k) => (Number.isFinite(values[k]) ? [[k, values[k]!] as const] : []))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: Record<string, { rank: number; of: number }> = {};
  let rank = 0;
  let prev: number | null = null;
  entries.forEach(([k, v], i) => {
    if (prev === null || v !== prev) {
      rank = i + 1;
      prev = v;
    }
    out[k] = { rank, of: entries.length };
  });
  return out;
}

/** Upper bounds of `classes` quantile classes over the finite values (ascending); duplicates collapse. */
export function quantileBreaks(values: number[], classes = 5): number[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const bounds: number[] = [];
  for (let i = 1; i <= classes; i++) {
    const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((i / classes) * v.length) - 1));
    const b = v[idx]!;
    if (!bounds.length || b > bounds[bounds.length - 1]!) bounds.push(b);
  }
  return bounds;
}

/** Index of the class a value falls in (0 = lowest); null when the value is missing. */
export function classIndex(value: number | null | undefined, breaks: number[]): number | null {
  if (value == null || !Number.isFinite(value) || !breaks.length) return null;
  for (let i = 0; i < breaks.length; i++) if (value <= breaks[i]!) return i;
  return breaks.length - 1;
}

export function formatMapValue(value: number | null | undefined, format: MapFormat): string {
  if (value == null || !Number.isFinite(value)) return NOT_RECORDED;
  switch (format) {
    case "int":
      return Math.round(value).toLocaleString("en-US");
    case "rate1":
      return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case "dollars":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "pct":
      return `${value.toFixed(1)}%`;
    case "dec1":
      return value.toFixed(1);
  }
}

// ---------------------------------------------------------------------------------------------------- state payload
export type StateMapMetric = {
  key: string;
  yearLabel: string;
  /** Values by state FIPS; absent where the source records none. */
  values: Record<string, number>;
  /** One sentence per state naming the numerator and denominator, or the margin of error. */
  detail: Record<string, string>;
  rank: Record<string, { rank: number; of: number }>;
  sourceName: string;
  sourceUrl: string;
  denominator: { label: string; year: string; url: string } | null;
};
export type StateMapPayload = { metrics: StateMapMetric[]; unavailable: string[] };

export type StateMapInputs = {
  pep: { id: string; l: unknown }[];
  acs: { id: string; l: unknown }[];
  fjc: { id: string; c: unknown; fy: unknown }[];
  districts: { s: unknown; a: unknown; pa: unknown; asof: unknown }[];
  cfpb: { id: string; y: unknown }[];
  osha: { id: string; c: unknown; r: unknown }[];
  echo: { id: string; c: unknown }[];
};

const PEP_URL = "https://www.census.gov/programs-surveys/popest.html";
const ACS_URL = "https://www.census.gov/data/developers/data-sets/acs-5year.html";
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const FIPS_OF_USPS = new Map<string, string>([...STATES, PUERTO_RICO].map((s) => [s.usps, s.fips]));
const RANKED = STATES.map((s) => s.fips);

function fipsOfUsps(id: unknown): string | null {
  const usps = str(id, 2);
  return FIPS_OF_USPS.get(usps) ?? null;
}

/** July 1 population by state FIPS from the Population Estimates rows. */
export function popByFips(rows: StateMapInputs["pep"]): {
  pop: Record<string, number>;
  year: number | null;
} {
  const pop: Record<string, number> = {};
  let year: number | null = null;
  for (const row of rows) {
    if (!/^\d{2}$/.test(row.id)) continue;
    const l = obj(row.l);
    const v = num(l["value"]);
    const y = num(l["year"]);
    if (v == null || y == null || v <= 0) continue;
    if (year == null) year = y;
    if (y === year) pop[row.id] = v;
  }
  return { pop, year };
}

function withRanks(metric: Omit<StateMapMetric, "rank">): StateMapMetric {
  return { ...metric, rank: competitionRank(metric.values, RANKED) };
}

/** Assemble every state metric that has data; a metric with no state value at all is left out. */
export function buildStateMapMetrics(input: StateMapInputs): StateMapMetric[] {
  const { pop, year: popYear } = popByFips(input.pep);
  const popLabel = popYear != null ? `July 1, ${popYear}` : null;
  const denominator =
    popYear != null
      ? {
          label: "Census Population Estimates, resident population",
          year: `July 1, ${popYear}`,
          url: PEP_URL,
        }
      : null;
  const out: StateMapMetric[] = [];
  const push = (m: Omit<StateMapMetric, "rank">) => {
    if (Object.keys(m.values).length) out.push(withRanks(m));
  };

  if (popYear != null) {
    const values: Record<string, number> = { ...pop };
    push({
      key: "pop",
      yearLabel: popLabel!,
      values,
      detail: Object.fromEntries(
        Object.entries(values).map(([f, v]) => [f, `${n0(v)} residents on ${popLabel}`]),
      ),
      sourceName: "Census Bureau Population Estimates (vintage 2025)",
      sourceUrl: PEP_URL,
      denominator: null,
    });
  }

  // FJC civil filings (cells.filings is the latest complete fiscal year, named in profile.latest_fy)
  const fjcValues: Record<string, number> = {};
  const fjcRates: Record<string, number> = {};
  const fjcDetail: Record<string, string> = {};
  const rateDetail: Record<string, string> = {};
  let fy: number | null = null;
  for (const row of input.fjc) {
    const fips = fipsOfUsps(row.id);
    const filings = num(obj(row.c)["filings"]);
    const rowFy = num(Number(row.fy));
    if (!fips || filings == null || filings < 0 || rowFy == null) continue;
    if (fy == null) fy = rowFy;
    if (rowFy !== fy) continue;
    fjcValues[fips] = filings;
    fjcDetail[fips] =
      `${n0(filings)} civil cases filed in FY${fy} in the state's federal district courts`;
    const rate = ratePer100k(filings, pop[fips]);
    if (rate != null) {
      fjcRates[fips] = rate;
      rateDetail[fips] =
        `${n0(filings)} cases filed in FY${fy} ÷ ${n0(pop[fips]!)} residents (${popLabel})`;
    }
  }
  const fjcSource = "FJC Integrated Database, civil cases filed by district summed by state";
  const fjcUrl =
    "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present";
  if (fy != null) {
    push({
      key: "fed_filings",
      yearLabel: `FY${fy}`,
      values: fjcValues,
      detail: fjcDetail,
      sourceName: fjcSource,
      sourceUrl: fjcUrl,
      denominator: null,
    });
    push({
      key: "fed_filings_rate",
      yearLabel: `FY${fy}`,
      values: fjcRates,
      detail: rateDetail,
      sourceName: fjcSource,
      sourceUrl: fjcUrl,
      denominator,
    });
  }

  // Judges and pending MDL actions from the district benches
  const judgesActive: Record<string, number> = {};
  const pending: Record<string, number> = {};
  let asOf: string | null = null;
  const districtsSeen = new Set<string>();
  for (const d of input.districts) {
    const name = str(d.s, 60);
    const fips =
      stateByName.get(name)?.fips ?? (name === PUERTO_RICO.name ? PUERTO_RICO.fips : null);
    if (!fips) continue;
    districtsSeen.add(fips);
    const active = num(Number(d.a));
    const pend = num(Number(d.pa));
    if (active != null && active >= 0) judgesActive[fips] = (judgesActive[fips] ?? 0) + active;
    if (pend != null && pend >= 0) pending[fips] = (pending[fips] ?? 0) + pend;
    asOf = asOf ?? (str(d.asof, 10) || null);
  }
  const judgeRates: Record<string, number> = {};
  const judgeDetail: Record<string, string> = {};
  for (const [fips, active] of Object.entries(judgesActive)) {
    const rate = ratePer100k(active, pop[fips]);
    if (rate == null) continue;
    judgeRates[fips] = rate;
    judgeDetail[fips] =
      `${active} active district judges ÷ ${n0(pop[fips]!)} residents (${popLabel})`;
  }
  push({
    key: "judges_rate",
    yearLabel: asOf ? `as of ${asOf}` : "latest",
    values: judgeRates,
    detail: judgeDetail,
    sourceName: "Federal Judicial Center biographical directory of Article III judges",
    sourceUrl: "https://www.fjc.gov/history/judges",
    denominator,
  });
  push({
    key: "mdl_pending",
    yearLabel: asOf ? `as of ${asOf}` : "latest",
    values: pending,
    detail: Object.fromEntries(
      Object.entries(pending).map(([f, v]) => [
        f,
        `${n0(v)} actions pending in MDLs whose transferee court is in the state`,
      ]),
    ),
    sourceName: "JPML pending-MDL reports",
    sourceUrl: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
    denominator: null,
  });

  // CFPB complaints in the latest complete calendar year, recomputed against the same Census denominator
  const cfpb: Record<string, number> = {};
  const cfpbDetail: Record<string, string> = {};
  let cfpbYear: number | null = null;
  for (const row of input.cfpb) {
    const m = /^cfpb-state:([A-Z]{2})$/.exec(row.id);
    const fips = m ? fipsOfUsps(m[1]) : null;
    if (!fips || !Array.isArray(row.y)) continue;
    const complete = row.y
      .map((y) => obj(y))
      .filter(
        (y) =>
          y["complete"] === true &&
          num(y["complaints"]) != null &&
          /^\d{4}$/.test(str(y["year"], 4)),
      );
    const latest = complete.sort(
      (a, b) => Number(str(b["year"], 4)) - Number(str(a["year"], 4)),
    )[0];
    if (!latest) continue;
    const y = Number(str(latest["year"], 4));
    if (cfpbYear == null) cfpbYear = y;
    if (y !== cfpbYear) continue;
    const complaints = num(latest["complaints"])!;
    const rate = ratePer100k(complaints, pop[fips]);
    if (rate == null) continue;
    cfpb[fips] = rate;
    cfpbDetail[fips] =
      `${n0(complaints)} complaints in ${y} ÷ ${n0(pop[fips]!)} residents (${popLabel})`;
  }
  if (cfpbYear != null)
    push({
      key: "cfpb_rate",
      yearLabel: String(cfpbYear),
      values: cfpb,
      detail: cfpbDetail,
      sourceName: "CFPB Consumer Complaint Database, complaints by consumer state",
      sourceUrl: "https://www.consumerfinance.gov/data-research/consumer-complaints/",
      denominator,
    });

  // OSHA inspections per 100,000 covered jobs (the dataset states its own BLS denominator)
  const osha: Record<string, number> = {};
  const oshaDetail: Record<string, string> = {};
  let oshaFy: number | null = null;
  let oshaDen = "";
  for (const row of input.osha) {
    const m = /^osha-state:([A-Z]{2})$/.exec(row.id);
    const fips = m ? fipsOfUsps(m[1]) : null;
    const rate = obj(row.r);
    const per = num(rate["inspections_per_100k_covered_jobs"]);
    const rowFy = num(rate["fy"]);
    const jobs = num(rate["denominator_value"]);
    const inspections = num(obj(row.c)["inspections"]);
    if (!fips || per == null || rowFy == null || per < 0) continue;
    if (oshaFy == null) oshaFy = rowFy;
    if (rowFy !== oshaFy) continue;
    osha[fips] = per;
    oshaDen =
      oshaDen || `${str(rate["denominator"], 120)} ${num(rate["denominator_year"]) ?? ""}`.trim();
    oshaDetail[fips] =
      inspections != null && jobs != null
        ? `${n0(inspections)} inspections in FY${rowFy} ÷ ${n0(jobs)} covered jobs`
        : `FY${rowFy} inspections per 100,000 covered jobs`;
  }
  if (oshaFy != null)
    push({
      key: "osha_rate",
      yearLabel: `FY${oshaFy}`,
      values: osha,
      detail: oshaDetail,
      sourceName:
        "OSHA inspection data (U.S. Department of Labor) with BLS QCEW covered employment",
      sourceUrl: "https://enforcedata.dol.gov/views/data_summary.php",
      denominator: {
        label: oshaDen || "BLS QCEW covered employment",
        year: String(oshaFy),
        url: "https://www.bls.gov/cew/",
      },
    });

  const echo: Record<string, number> = {};
  for (const row of input.echo) {
    const m = /^epa-echo-programs:([A-Z]{2})$/.exec(row.id);
    const fips = m ? fipsOfUsps(m[1]) : null;
    const v = num(obj(row.c)["formal_5y"]);
    if (fips && v != null && v >= 0) echo[fips] = v;
  }
  push({
    key: "echo_formal_5y",
    yearLabel: "past 5 years",
    values: echo,
    detail: Object.fromEntries(
      Object.entries(echo).map(([f, v]) => [
        f,
        `${n0(v)} facilities with a formal action in the past five years`,
      ]),
    ),
    sourceName: "EPA ECHO Exporter, facilities by state",
    sourceUrl: "https://echo.epa.gov/tools/data-downloads",
    denominator: null,
  });

  // Census ACS 5-year measures (value and margin of error come from the stored latest figure)
  const acsBy: Record<
    string,
    { values: Record<string, number>; detail: Record<string, string>; year: number }
  > = {};
  for (const row of input.acs) {
    if (!/^\d{2}$/.test(row.id)) continue;
    for (const [key, triple] of Object.entries(obj(row.l))) {
      if (!Array.isArray(triple)) continue;
      const v = num(triple[0]);
      const y = num(triple[2]);
      if (v == null || y == null) continue;
      const slot = (acsBy[key] ??= { values: {}, detail: {}, year: y });
      if (slot.year !== y) continue;
      slot.values[row.id] = v;
      const moe = num(triple[1]);
      slot.detail[row.id] =
        moe != null ? `margin of error ± ${moe >= 100 ? n0(moe) : moe.toFixed(1)}` : "";
    }
  }
  for (const [key, slot] of Object.entries(acsBy)) {
    if (!STATE_METRIC_BY_KEY.has(`acs:${key}`)) continue;
    push({
      key: `acs:${key}`,
      yearLabel: `${slot.year - 4}–${slot.year}`,
      values: slot.values,
      detail: slot.detail,
      sourceName: "Census Bureau American Community Survey 5-year estimates",
      sourceUrl: ACS_URL,
      denominator: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- county payload
export type CountyLayerPayload = {
  key: string;
  yearLabel: string;
  values: Record<string, number>;
  sourceName: string;
  sourceUrl: string;
};

/** County values from a `{id, v}` row list; a value that is not a finite non-negative number is dropped. */
export function parseCountyValues(rows: { id: string; v: unknown }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!/^\d{5}$/.test(row.id)) continue;
    const v = typeof row.v === "string" ? Number(row.v) : row.v;
    if (typeof v === "number" && Number.isFinite(v)) out[row.id] = v;
  }
  return out;
}
