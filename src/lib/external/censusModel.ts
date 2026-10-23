/**
 * Census datasets (census_acs_states, census_acs_counties, census_acs1_states, census_pop_estimates, census_cbp_states,
 * census_cbp_counties; built by scripts/enrichment/census). Pure, defensive parsing and arithmetic shared by the server
 * functions and the views: stored JSON is untrusted, malformed values are dropped, never repaired, and a missing value is
 * "Not recorded", never zero.
 *
 * A stored ACS figure is `[value, margin of error]`; `[value, null, "c"]` is a controlled estimate (no sampling error) and
 * `[value, null, "m"]` one whose margin the Census Bureau could not compute; `[null, null, sentinel]` is a figure the Bureau
 * did not publish for that area and release.
 */
import { num, obj, str } from "./placeAnalysisParse";

export const NOT_RECORDED = "Not recorded";
export const CENSUS_FORMATS = ["int", "dollars", "dec1", "pct"] as const;
export type CensusFormat = (typeof CENSUS_FORMATS)[number];
export type Survey = "acs5" | "acs1";
export type CensusLevel = "us" | "state" | "county";

export type CensusFigure = {
  value: number | null;
  /** Margin of error at the 90 percent confidence level, in the figure's own unit; null when none applies. */
  moe: number | null;
  /** "c" controlled estimate (no sampling error); "m" margin of error not computable. */
  note: "c" | "m" | null;
};

export type CensusMeasureDef = {
  key: string;
  label: string;
  unit: string;
  format: CensusFormat;
  group: string;
  kind: "value" | "share";
  table: string;
  cells: string[];
  cellsSubtracted: string[];
  denominatorCell: string | null;
  universe: string | null;
  note: string | null;
};

export type CensusLatest = CensusFigure & { year: number };
export type CensusRank = { rank: number; of: number };

export type CensusGeo = {
  geoid: string;
  level: CensusLevel;
  name: string;
  usps: string;
  survey: Survey;
  years: number[];
  latestYear: number;
  period: string;
  /** measure key -> year -> figure */
  series: Record<string, Record<string, CensusFigure>>;
  latest: Record<string, CensusLatest>;
  rank: Record<string, CensusRank>;
  measures: CensusMeasureDef[];
};

const KEY = /^[a-z0-9_]{1,40}$/;
const YEAR = /^(19|20)\d{2}$/;
const GEOID = /^(US|\d{2}|\d{5})$/;

export function parseFigure(raw: unknown): CensusFigure | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const value = num(raw[0]);
  const moe = num(raw[1]);
  const tag = raw[2];
  const note = tag === "c" || tag === "m" ? tag : null;
  if (value == null) return { value: null, moe: null, note: null };
  return { value, moe: moe != null && moe >= 0 ? moe : null, note };
}

export function parseSeries(raw: unknown): Record<string, Record<string, CensusFigure>> {
  const out: Record<string, Record<string, CensusFigure>> = {};
  for (const [key, byYear] of Object.entries(obj(raw))) {
    if (!KEY.test(key)) continue;
    const years: Record<string, CensusFigure> = {};
    for (const [year, fig] of Object.entries(obj(byYear))) {
      const parsed = YEAR.test(year) ? parseFigure(fig) : null;
      if (parsed) years[year] = parsed;
    }
    if (Object.keys(years).length) out[key] = years;
  }
  return out;
}

export function parseLatest(raw: unknown): Record<string, CensusLatest> {
  const out: Record<string, CensusLatest> = {};
  for (const [key, triple] of Object.entries(obj(raw))) {
    if (!KEY.test(key) || !Array.isArray(triple) || triple.length < 3) continue;
    const value = num(triple[0]);
    const year = num(triple[2]);
    if (value == null || year == null) continue;
    const moe = num(triple[1]);
    const note = triple[3] === "c" || triple[3] === "m" ? triple[3] : null;
    out[key] = { value, moe: moe != null && moe >= 0 ? moe : null, note, year };
  }
  return out;
}

export function parseRanks(raw: unknown): Record<string, CensusRank> {
  const out: Record<string, CensusRank> = {};
  for (const [key, pair] of Object.entries(obj(raw))) {
    if (!KEY.test(key) || !Array.isArray(pair)) continue;
    const rank = num(pair[0]);
    const of = num(pair[1]);
    if (rank != null && of != null && rank >= 1 && of >= rank) out[key] = { rank, of };
  }
  return out;
}

export function parseMeasure(raw: unknown): CensusMeasureDef | null {
  const m = obj(raw);
  const key = str(m["key"], 40);
  const format = CENSUS_FORMATS.find((f) => f === m["format"]);
  if (!KEY.test(key) || !str(m["label"]) || !format) return null;
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((c): c is string => typeof c === "string" && /^[BC]\d{5}_\d{3}$/.test(c))
      : [];
  return {
    key,
    label: str(m["label"], 160),
    unit: str(m["unit"], 120),
    format,
    group: str(m["group"], 40) || "Other",
    kind: m["kind"] === "share" ? "share" : "value",
    table: str(m["table"], 12),
    cells: list(m["cells"]),
    cellsSubtracted: list(m["cells_subtracted"]),
    denominatorCell: str(m["denominator_cell"], 12) || null,
    universe: str(m["universe"], 120) || null,
    note: str(m["note"], 300) || null,
  };
}

/** One stored Census ACS payload (`item.census`) -> typed geography, or null when it does not parse. */
export function parseCensusGeo(raw: unknown): CensusGeo | null {
  const c = obj(raw);
  const geoid = str(c["geoid"], 5);
  const level =
    c["level"] === "us" || c["level"] === "state" || c["level"] === "county" ? c["level"] : null;
  const survey = c["survey"] === "acs5" || c["survey"] === "acs1" ? c["survey"] : null;
  const latestYear = num(c["latest_year"]);
  if (!GEOID.test(geoid) || !level || !survey || latestYear == null || !str(c["name"])) return null;
  const years = Array.isArray(c["years"])
    ? c["years"].flatMap((y) => (num(y) != null && YEAR.test(String(y)) ? [num(y)!] : []))
    : [];
  const measures = Array.isArray(c["measures"])
    ? c["measures"].flatMap((m) => {
        const parsed = parseMeasure(m);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    geoid,
    level,
    name: str(c["name"], 160),
    usps: /^[A-Z]{2}$/.test(str(c["usps"], 2)) ? str(c["usps"], 2) : "",
    survey,
    years: [...new Set(years)].sort((a, b) => a - b),
    latestYear,
    period: str(c["period"], 20),
    series: parseSeries(c["series"]),
    latest: parseLatest(c["latest"]),
    rank: parseRanks(c["rank"]),
    measures,
  };
}

// ---------------------------------------------------------------------------------------------------- formatting
export function formatCensus(value: number | null | undefined, format: CensusFormat): string {
  if (value == null || !Number.isFinite(value)) return NOT_RECORDED;
  switch (format) {
    case "int":
      return Math.round(value).toLocaleString("en-US");
    case "dollars":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "dec1":
      return value.toFixed(1);
    case "pct":
      return `${value.toFixed(1)}%`;
  }
}

/** "± 1.2%" / "± $1,950"; empty when no margin applies. Controlled estimates say so instead. */
export function formatMoe(fig: Pick<CensusFigure, "moe" | "note">, format: CensusFormat): string {
  if (fig.note === "c") return "controlled estimate";
  if (fig.moe == null) return "";
  const text =
    format === "pct"
      ? `${fig.moe.toFixed(1)} pts`
      : formatCensus(fig.moe, format === "dec1" ? "dec1" : format);
  return `± ${text}`;
}

// ---------------------------------------------------------------------------------------------------- arithmetic
export type Difference = {
  diff: number;
  /** Margin of error of the difference, sqrt(moeA^2 + moeB^2); null when either margin is missing. */
  moe: number | null;
  /** True when |diff| exceeds the margin (the estimates differ at the 90 percent level); null when it cannot be told. */
  distinguishable: boolean | null;
};

/** a - b with the Census Bureau's margin for a difference of two independent estimates. */
export function difference(
  a: CensusFigure | undefined,
  b: CensusFigure | undefined,
): Difference | null {
  if (!a || !b || a.value == null || b.value == null) return null;
  const diff = a.value - b.value;
  const aMoe = a.note === "c" ? 0 : a.moe;
  const bMoe = b.note === "c" ? 0 : b.moe;
  if (aMoe == null || bMoe == null) return { diff, moe: null, distinguishable: null };
  const moe = Math.sqrt(aMoe * aMoe + bMoe * bMoe);
  return { diff, moe, distinguishable: Math.abs(diff) > moe };
}

/**
 * Change between two releases. Five-year releases that share survey years are not independent, so a margin and a
 * significance statement are given only when the releases do not overlap (their end years differ by at least five).
 */
export function changeBetween(
  geo: Pick<CensusGeo, "series" | "survey">,
  key: string,
  fromYear: number,
  toYear: number,
):
  | (Difference & { fromYear: number; toYear: number; pct: number | null; independent: boolean })
  | null {
  const from = geo.series[key]?.[String(fromYear)];
  const to = geo.series[key]?.[String(toYear)];
  const d = difference(to, from);
  if (!d || !from || from.value == null) return null;
  const independent = geo.survey === "acs1" ? toYear !== fromYear : toYear - fromYear >= 5;
  const pct = from.value !== 0 ? (d.diff / Math.abs(from.value)) * 100 : null;
  return {
    ...d,
    moe: independent ? d.moe : null,
    distinguishable: independent ? d.distinguishable : null,
    fromYear,
    toYear,
    pct,
    independent,
  };
}

export type TrendPoint = { year: number; value: number | null; moe: number | null };

/** The measure's value for every release year; a year with no published value is a gap (value null), never zero. */
export function trendPoints(geo: Pick<CensusGeo, "series" | "years">, key: string): TrendPoint[] {
  const byYear = geo.series[key] ?? {};
  return geo.years.map((year) => {
    const f = byYear[String(year)];
    return { year, value: f?.value ?? null, moe: f?.note ? null : (f?.moe ?? null) };
  });
}

export function latestOf(geo: Pick<CensusGeo, "latest">, key: string): CensusLatest | null {
  return geo.latest[key] ?? null;
}

// ---------------------------------------------------------------------------------------------------- PEP
export type PepGeo = {
  geoid: string;
  level: CensusLevel;
  name: string;
  usps: string;
  /** July 1 estimates of vintage 2025 (2020-2025) and vintage 2019 (2010-2019), kept apart. */
  v2025: Record<string, number>;
  v2019: Record<string, number>;
  base2020: number | null;
  census2010: number | null;
  latest: {
    year: number;
    date: string;
    value: number;
    rank: number | null;
    of: number | null;
  } | null;
};

const pops = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const n = num(v);
    if (YEAR.test(k) && n != null && n >= 0) out[k] = n;
  }
  return out;
};

export function parsePep(raw: unknown): PepGeo | null {
  const c = obj(raw);
  const geoid = str(c["geoid"], 5);
  const level =
    c["level"] === "us" || c["level"] === "state" || c["level"] === "county" ? c["level"] : null;
  if (!GEOID.test(geoid) || !level || !str(c["name"])) return null;
  const series = obj(c["series"]);
  const v25 = obj(series["v2025"]);
  const v19 = obj(series["v2019"]);
  const latest = obj(c["latest"]);
  const latestValue = num(latest["value"]);
  const latestYear = num(latest["year"]);
  return {
    geoid,
    level,
    name: str(c["name"], 160),
    usps: /^[A-Z]{2}$/.test(str(c["usps"], 2)) ? str(c["usps"], 2) : "",
    v2025: pops(v25["pop"]),
    v2019: pops(v19["pop"]),
    base2020: num(obj(v25["base"])["2020"]),
    census2010: num(obj(v19["base"])["census2010"]),
    latest:
      latestValue != null && latestYear != null
        ? {
            year: latestYear,
            date: str(latest["date"], 40),
            value: latestValue,
            rank: num(latest["rank"]),
            of: num(latest["of"]),
          }
        : null,
  };
}

// ---------------------------------------------------------------------------------------------------- CBP
export const CBP_SECTORS: Record<string, string> = {
  "00": "All sectors",
  "11": "Agriculture, forestry, fishing and hunting",
  "21": "Mining, quarrying, and oil and gas extraction",
  "22": "Utilities",
  "23": "Construction",
  "31-33": "Manufacturing",
  "42": "Wholesale trade",
  "44-45": "Retail trade",
  "48-49": "Transportation and warehousing",
  "51": "Information",
  "52": "Finance and insurance",
  "53": "Real estate and rental and leasing",
  "54": "Professional, scientific, and technical services",
  "55": "Management of companies and enterprises",
  "56": "Administrative and support and waste management and remediation services",
  "61": "Educational services",
  "62": "Health care and social assistance",
  "71": "Arts, entertainment, and recreation",
  "72": "Accommodation and food services",
  "81": "Other services (except public administration)",
  "99": "Industries not classified",
};

export type CbpCell = {
  establishments: number | null;
  employees: number | null;
  /** Annual payroll in thousands of dollars. */
  payroll: number | null;
  /** Census flags (D, S) for withheld figures, by field. */
  flags: Record<string, string>;
};
export type CbpGeo = {
  geoid: string;
  level: CensusLevel;
  name: string;
  usps: string;
  years: number[];
  latestYear: number;
  /** sector -> year -> cell */
  series: Record<string, Record<string, CbpCell>>;
};

export function parseCbp(raw: unknown): CbpGeo | null {
  const c = obj(raw);
  const geoid = str(c["geoid"], 5);
  const level =
    c["level"] === "us" || c["level"] === "state" || c["level"] === "county" ? c["level"] : null;
  const latestYear = num(c["latest_year"]);
  if (!GEOID.test(geoid) || !level || latestYear == null || !str(c["name"])) return null;
  const series: CbpGeo["series"] = {};
  for (const [sector, byYear] of Object.entries(obj(c["series"]))) {
    if (!(sector in CBP_SECTORS)) continue;
    const years: Record<string, CbpCell> = {};
    for (const [year, cell] of Object.entries(obj(byYear))) {
      if (!YEAR.test(year) || !Array.isArray(cell) || cell.length < 3) continue;
      const flags: Record<string, string> = {};
      for (const [field, flag] of Object.entries(obj(cell[3]))) {
        if (field === "estab" || field === "emp" || field === "pay") flags[field] = str(flag, 4);
      }
      const nn = (v: unknown) => {
        const n = num(v);
        return n != null && n >= 0 ? n : null;
      };
      years[year] = {
        establishments: nn(cell[0]),
        employees: nn(cell[1]),
        payroll: nn(cell[2]),
        flags,
      };
    }
    if (Object.keys(years).length) series[sector] = years;
  }
  return {
    geoid,
    level,
    name: str(c["name"], 160),
    usps: /^[A-Z]{2}$/.test(str(c["usps"], 2)) ? str(c["usps"], 2) : "",
    years: Array.isArray(c["years"])
      ? c["years"].flatMap((y) => (num(y) != null ? [num(y)!] : []))
      : [],
    latestYear,
    series,
  };
}

/** Sector rows of one release, largest employment first; withheld employment sorts last and stays "Not recorded". */
export function cbpSectorRows(geo: CbpGeo, year: number) {
  return Object.entries(geo.series)
    .filter(([sector]) => sector !== "00")
    .flatMap(([sector, byYear]) => {
      const cell = byYear[String(year)];
      return cell ? [{ sector, label: CBP_SECTORS[sector] ?? sector, ...cell }] : [];
    })
    .sort((a, b) => (b.employees ?? -1) - (a.employees ?? -1));
}

// ---------------------------------------------------------------------------------------------------- API links
/** The Census Data API request that returns this area's figures for one release (no key; a reader may add their own). */
export function acsApiUrl(
  survey: Survey,
  year: number,
  geoid: string,
  cells: string[],
): string | null {
  if (!/^[BC]\d{5}_\d{3}$/.test(cells[0] ?? "") || !cells.every((c) => /^[BC]\d{5}_\d{3}$/.test(c)))
    return null;
  const vars = cells.flatMap((c) => [`${c}E`, `${c}M`]).join(",");
  const geo =
    geoid === "US"
      ? "for=us:1"
      : geoid.length === 2
        ? `for=state:${geoid}`
        : geoid.length === 5
          ? `for=county:${geoid.slice(2)}&in=state:${geoid.slice(0, 2)}`
          : null;
  if (!geo || !/^(US|\d{2}|\d{5})$/.test(geoid)) return null;
  return `https://api.census.gov/data/${year}/acs/${survey}?get=NAME,${vars}&${geo}`;
}
