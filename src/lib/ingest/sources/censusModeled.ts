/**
 * Census Bureau model-based annual estimates for every county, state and the nation, as yearly series:
 *   - SAIPE (Small Area Income and Poverty Estimates): poverty rate and count for all ages, child (0-17) poverty rate,
 *     median household income, each with its 90% margin of error, 1989 onward (county years as published).
 *   - SAHIE (Small Area Health Insurance Estimates): share and number of people under 65 without health insurance,
 *     all incomes, both sexes, all races, with margins of error, 2006 onward for states and 2008 onward for counties.
 * Annual and model-based, so they are steadier for small counties than one survey year; they are not the ACS figures
 * already in county profiles and are labelled as SAIPE or SAHIE. Read from api.census.gov with CENSUS_API_KEY (never
 * printed; the request ledger drops the key parameter). Public domain (U.S. Census Bureau).
 */
import { BudgetExhausted, RateLimited } from "../http.ts";
import { corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";

const API = "https://api.census.gov/data/timeseries";

export type Measure = {
  key: string;
  label: string;
  value: string;
  moe: string | null;
  unit: "%" | "people" | "USD";
};

export type ModeledSpec = {
  source: string;
  dataset: string;
  prefix: string;
  name: string;
  short: string;
  endpoint: string;
  page: string;
  firstYear: number;
  /** Fixed predicates selecting the published total (SAHIE category codes). */
  predicates: string;
  measures: Measure[];
  /** Measure shown in the title line and cells. */
  headline: string;
  note: string;
  /**
   * County rows are fetched in parts on consecutive runs, each a range of state FIPS codes, so a run stays within the
   * edge runtime's CPU budget. The nation and states are written by the first part.
   */
  parts: [string, string][];
};

export const SAIPE: ModeledSpec = {
  source: "census_saipe",
  dataset: "census_saipe",
  prefix: "saipe",
  name: "Small Area Income and Poverty Estimates",
  short: "SAIPE",
  endpoint: `${API}/poverty/saipe`,
  page: "https://www.census.gov/programs-surveys/saipe.html",
  firstYear: 1989,
  predicates: "",
  measures: [
    {
      key: "poverty_rate",
      label: "Poverty rate, all ages",
      value: "SAEPOVRTALL_PT",
      moe: "SAEPOVRTALL_MOE",
      unit: "%",
    },
    {
      key: "poverty_count",
      label: "People in poverty, all ages",
      value: "SAEPOVALL_PT",
      moe: "SAEPOVALL_MOE",
      unit: "people",
    },
    {
      key: "child_poverty_rate",
      label: "Poverty rate, ages 0-17",
      value: "SAEPOVRT0_17_PT",
      moe: "SAEPOVRT0_17_MOE",
      unit: "%",
    },
    {
      key: "median_household_income",
      label: "Median household income",
      value: "SAEMHI_PT",
      moe: "SAEMHI_MOE",
      unit: "USD",
    },
  ],
  headline: "poverty_rate",
  note: "Model-based annual estimates combining survey, tax and program data; margins of error are 90% intervals. Not the ACS figures shown elsewhere.",
  parts: [
    ["01", "29"],
    ["30", "56"],
  ],
};

export const SAHIE: ModeledSpec = {
  source: "census_sahie",
  dataset: "census_sahie",
  prefix: "sahie",
  name: "Small Area Health Insurance Estimates",
  short: "SAHIE",
  endpoint: `${API}/healthins/sahie`,
  page: "https://www.census.gov/programs-surveys/sahie.html",
  firstYear: 2006,
  predicates: "&AGECAT=0&RACECAT=0&SEXCAT=0&IPRCAT=0",
  measures: [
    {
      key: "uninsured_rate",
      label: "Uninsured, under 65",
      value: "PCTUI_PT",
      moe: "PCTUI_MOE",
      unit: "%",
    },
    {
      key: "uninsured_count",
      label: "People uninsured, under 65",
      value: "NUI_PT",
      moe: "NUI_MOE",
      unit: "people",
    },
    {
      key: "insured_count",
      label: "People insured, under 65",
      value: "NIC_PT",
      moe: "NIC_MOE",
      unit: "people",
    },
  ],
  headline: "uninsured_rate",
  note: "Model-based annual estimates for people under 65, all incomes, both sexes, all races; margins of error are 90% intervals. Not the ACS figures shown elsewhere.",
  parts: [["01", "56"]],
};

const STATE_FIPS: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

/** "12.9" / "78840" → number; "", "-", null or anything else → null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  // Number("") and Number(" ") are 0 and "1e3" parses; the API prints plain decimals, so anything else is not a value
  return Number.isFinite(n) && /^\s*-?\d/.test(v) && !/[eExX]/.test(v) ? n : null;
}

/** State FIPS codes from..to that exist. */
export function statesIn(range: [string, string]): string[] {
  return Object.keys(STATE_FIPS)
    .filter((c) => c >= range[0] && c <= range[1])
    .sort();
}

export function queryUrl(
  spec: ModeledSpec,
  geo: "us" | "state" | "county",
  time: string,
  key: string,
  states?: string[],
): string {
  const vars = [
    "NAME",
    ...spec.measures.flatMap((m) => (m.moe ? [m.value, m.moe] : [m.value])),
  ].join(",");
  const forGeo =
    geo === "us"
      ? "us:*"
      : geo === "state"
        ? "state:*"
        : `county:*${states && states.length ? `&in=state:${states.join(",")}` : ""}`;
  return `${spec.endpoint}?get=${vars}&for=${forGeo}&time=${time}${spec.predicates}&key=${encodeURIComponent(key)}`;
}

/** [year, value, margin of error] */
export type YearPoint = [number, number | null, number | null];

export type Area = {
  geo: string;
  name: string;
  series: Record<string, YearPoint[]>;
};

/** Rows of an api.census.gov table response, keyed by area; years and points accumulate across calls. */
export function addResponse(spec: ModeledSpec, table: unknown, areas: Map<string, Area>): number {
  if (!Array.isArray(table) || !Array.isArray(table[0]))
    throw new Error(`${spec.short} response is not a table`);
  const head = (table[0] as unknown[]).map((h) => String(h));
  const ix = (k: string) => head.indexOf(k);
  const cName = ix("NAME");
  const cTime = ix("time");
  const cState = ix("state");
  const cCounty = ix("county");
  const cUs = ix("us");
  if (cName < 0 || cTime < 0) throw new Error(`${spec.short} response columns changed`);
  const cols = spec.measures.map((m) => ({
    key: m.key,
    v: ix(m.value),
    e: m.moe ? ix(m.moe) : -1,
  }));
  let n = 0;
  for (let r = 1; r < table.length; r++) {
    const raw = table[r];
    if (!Array.isArray(raw)) continue;
    const year = Number(raw[cTime]);
    if (!Number.isInteger(year)) continue;
    const st = cState >= 0 ? String(raw[cState] ?? "") : "";
    const co = cCounty >= 0 ? String(raw[cCounty] ?? "") : "";
    const geo = cCounty >= 0 ? `${st}${co}` : cState >= 0 ? st : cUs >= 0 ? "US" : "";
    if (!(geo === "US" || /^\d{2}$/.test(geo) || /^\d{5}$/.test(geo))) continue;
    let a = areas.get(geo);
    if (!a) {
      a = { geo, name: String(raw[cName] ?? geo).trim(), series: {} };
      areas.set(geo, a);
    }
    for (const c of cols) {
      const v = c.v >= 0 ? num(raw[c.v]) : null;
      const e = c.e >= 0 ? num(raw[c.e]) : null;
      if (v === null && e === null) continue;
      // repeated years are resolved once per series in modeledRow (the later response wins)
      (a.series[c.key] ??= []).push([year, v, e]);
    }
    n++;
  }
  return n;
}

const fmt = (m: Measure, v: number) =>
  m.unit === "%"
    ? `${v}%`
    : m.unit === "USD"
      ? `$${v.toLocaleString("en-US")}`
      : v.toLocaleString("en-US");

export function stateOf(geo: string): string {
  return geo === "US" ? "" : (STATE_FIPS[geo.slice(0, 2)] ?? "");
}

export function areaTitle(a: Area): string {
  const st = stateOf(a.geo);
  if (a.geo.length === 5 && st && !a.name.endsWith(`, ${st}`) && !/, [A-Z]{2}$/.test(a.name))
    return `${a.name}, ${st}`;
  return a.name;
}

/** Sorts each series by year and keeps the last point given for a year. */
export function settleSeries(a: Area): void {
  for (const [k, s] of Object.entries(a.series)) {
    const byYear = new Map<number, YearPoint>();
    for (const p of s) byYear.set(p[0], p);
    a.series[k] = [...byYear.values()].sort((x, y) => x[0] - y[0]);
  }
}

export function modeledRow(spec: ModeledSpec, a: Area, retrieved: string): CorpusRow {
  settleSeries(a);
  const headline = spec.measures.find((m) => m.key === spec.headline)!;
  const last = (key: string) =>
    [...(a.series[key] ?? [])].reverse().find((p) => p[1] !== null) ?? null;
  const h = last(headline.key);
  const years = [
    ...new Set(
      Object.values(a.series)
        .flat()
        .map((p) => p[0]),
    ),
  ].sort((x, y) => x - y);
  const title = areaTitle(a);
  const level = a.geo === "US" ? "nation" : a.geo.length === 2 ? "state" : "county";
  const cells: JsonObject = {
    area: title,
    level,
    first_year: years[0] ?? null,
    latest_year: years.at(-1) ?? null,
  };
  for (const m of spec.measures) {
    const p = last(m.key);
    cells[m.key] = p?.[1] ?? null;
  }
  const row = corpusRecord(spec.dataset, `${spec.prefix}:${a.geo}`, `${title}: ${spec.name}`, {
    source_url: spec.page,
    state: stateOf(a.geo),
    subtitle: h
      ? `${headline.label} ${fmt(headline, h[1]!)}${h[2] !== null ? ` (±${h[2]})` : ""} in ${h[0]} · ${spec.short} ${years[0]}-${years.at(-1)}`
      : `${spec.short}: Not recorded`,
    cells,
    facts: [
      ["Area", level === "county" ? `${title} (county FIPS ${a.geo})` : title],
      ...spec.measures.map((m): [string, string] => {
        const p = last(m.key);
        return [
          m.label,
          p
            ? `${fmt(m, p[1]!)}${p[2] !== null ? ` ± ${m.unit === "USD" ? `$${p[2].toLocaleString("en-US")}` : p[2].toLocaleString("en-US")}` : ""} (${p[0]})`
            : "Not recorded",
        ];
      }),
      [
        "Years",
        years.length
          ? `${years[0]}-${years.at(-1)} (${years.length} published years)`
          : "Not recorded",
      ],
      ["Method", spec.note],
      ["Retrieved", retrieved],
    ],
    text: `${title} ${a.geo} ${spec.name} ${spec.short} ${spec.measures.map((m) => m.label).join(" ")}`,
    filters: { level: [level], state: [stateOf(a.geo) || "US"] },
    links: [{ label: `${spec.name} (Census Bureau)`, url: spec.page }],
    extra: {
      modeled: {
        program: spec.short,
        geo: a.geo,
        columns: ["year", "estimate", "margin_of_error_90"],
        measures: Object.fromEntries(
          spec.measures.map((m) => [m.key, { label: m.label, unit: m.unit }]),
        ),
        series: a.series as unknown as Json,
      },
    },
  });
  row.county_geoids = a.geo.length === 5 ? [a.geo] : [];
  return row;
}

export function comparableModeled(content: RowContent): Json {
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).filter(
    (f) => !(Array.isArray(f) && f[0] === "Retrieved"),
  );
  return {
    ...(content as unknown as JsonObject),
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

async function getTable(ctx: CollectContext, url: string): Promise<unknown | null> {
  const res = await ctx.http.getText(url);
  if (res.status === 204) return null;
  if (res.status !== 200) {
    // the API answers an invalid key by redirecting to an HTML page
    if (/invalid_key|missing_key/i.test(res.text))
      throw new Error("the Census API rejected the key");
    throw new Error(`Census API HTTP ${res.status}`);
  }
  try {
    return JSON.parse(res.text);
  } catch {
    if (/invalid_key|missing_key/i.test(res.text))
      throw new Error("the Census API rejected the key");
    throw new Error("Census API response is not JSON");
  }
}

export function modeledAdapter(spec: ModeledSpec): SourceAdapter {
  return {
    source: spec.source,
    dataset: spec.dataset,
    mode: "upsert",
    ordinalPolicy: "append",
    functionName: "ingest-census",
    limits: { maxRequests: 50, minIntervalMs: 300 },
    secrets: ["CENSUS_API_KEY"],
    async collect(ctx): Promise<Collected> {
      const key = ctx.env("CENSUS_API_KEY");
      if (!key) throw new Error("CENSUS_API_KEY is not set");
      const cursor =
        ctx.cursor && typeof ctx.cursor === "object" && !Array.isArray(ctx.cursor)
          ? (ctx.cursor as JsonObject)
          : {};
      const part = typeof cursor["next"] === "number" ? cursor["next"] % spec.parts.length : 0;
      const states = statesIn(spec.parts[part]!);
      const retrieved = ctx.now.toISOString().slice(0, 10);
      const areas = new Map<string, Area>();
      const notes: JsonObject = {
        part: `${part + 1} of ${spec.parts.length}: state FIPS ${spec.parts[part]!.join("-")}`,
      };
      const lastYear = ctx.now.getUTCFullYear();
      // nation and states in one call each (all years); the state years tell which county years to ask for
      for (const geo of ["us", "state"] as const) {
        const t = await getTable(ctx, queryUrl(spec, geo, `from+${spec.firstYear}`, key));
        if (t) notes[`${geo}_rows`] = addResponse(spec, t, areas);
      }
      const stateYears = [
        ...new Set(
          [...areas.values()]
            .filter((a) => a.geo.length === 2)
            .flatMap((a) =>
              Object.values(a.series)
                .flat()
                .map((p) => p[0]),
            ),
        ),
      ]
        .filter((y) => y <= lastYear)
        .sort((x, y) => x - y);
      if (stateYears.length < 5)
        throw new Error(`only ${stateYears.length} ${spec.short} years published for states`);
      // the nation and the states are written once a cycle, by the first part
      if (part !== 0) for (const g of [...areas.keys()]) areas.delete(g);
      const held: HeldRecord[] = [];
      let complete = true;
      const countyYears: number[] = [];
      try {
        for (const year of stateYears) {
          const t = await getTable(ctx, queryUrl(spec, "county", String(year), key, states));
          const n = t ? addResponse(spec, t, areas) : 0;
          if (n) countyYears.push(year);
          else
            held.push({ key: String(year), reason: "no county estimates published for this year" });
        }
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          notes["stopped"] = error.message;
        } else throw error;
      }
      const counties = [...areas.values()].filter((a) => a.geo.length === 5).length;
      // about 3,140 counties nationally; a part covers its share of states
      const expected = Math.floor((3000 * states.length) / 51);
      if (counties < expected && complete)
        throw new Error(
          `only ${counties} ${spec.short} counties read for states ${states[0]}-${states.at(-1)}`,
        );
      const rows = [...areas.values()]
        .sort((a, b) => (a.geo < b.geo ? -1 : a.geo > b.geo ? 1 : 0))
        .map((a) => modeledRow(spec, a, retrieved));
      notes["county_years"] = countyYears.length
        ? `${countyYears[0]}-${countyYears.at(-1)} (${countyYears.length})`
        : "none";
      notes["areas"] = rows.length;
      notes["counties"] = counties;
      return {
        rows,
        fetched: rows.length,
        held,
        cursorAfter: {
          next: (part + 1) % spec.parts.length,
          latest_county_year: countyYears.at(-1) ?? null,
          state_years: stateYears.length,
        },
        complete,
        notes,
      };
    },
    comparable: comparableModeled,
  };
}

export const censusSaipe = modeledAdapter(SAIPE);
export const censusSahie = modeledAdapter(SAHIE);
