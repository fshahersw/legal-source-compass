/**
 * Census Bureau Business Trends and Outlook Survey (BTOS): every two weeks a sample of employer businesses reports how
 * revenues, employment, hours, demand and prices changed and what it expects over six months. One row for the nation and
 * one per state, each holding every published collection period of:
 *   - the BTOS indexes (0 to 100; 100 points for "increased" or "excellent", 50 for "no change" or "average", 0 for
 *     "decreased" or "poor", averaged over answers; 50 means balanced) with their standard errors;
 *   - the share of businesses using AI (the survey now words it "Super Intelligence (SI), formerly Artificial
 *     Intelligence"), now and expected in six months, and the share with losses from an extreme weather event.
 * Read from the published National.xlsx and State.xlsx downloads. Estimates the Census Bureau suppresses ("S") stay empty.
 * Census Bureau experimental data product; public domain.
 */
import { corpusRecord } from "../rows.ts";
import type {
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  RowContent,
  SourceAdapter,
} from "../types.ts";
import { type RowFilter, xlsxRecords, xlsxSheets, xlsxSharedStrings } from "../xlsx.ts";

export const BTOS_DATASET = "census_btos_states";
export const BTOS_PAGE = "https://www.census.gov/hfp/btos/data";
export const BTOS_DOWNLOADS = "https://www.census.gov/hfp/btos/data_downloads";
export const BTOS_NATIONAL = "https://www.census.gov/hfp/btos/downloads/National.xlsx";
export const BTOS_STATE = "https://www.census.gov/hfp/btos/downloads/State.xlsx";

const STATE_NAMES: Record<string, string> = {
  US: "United States",
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

/** Response questions carried as share-of-businesses series, matched on the question text and the answer. */
export const SHARE_SERIES: { key: string; label: string; question: RegExp; answer: string }[] = [
  {
    key: "ai_use",
    label: "Used AI in the last two weeks",
    question:
      /in the last two weeks, did this business use (super intelligence|artificial intelligence)/i,
    answer: "Yes",
  },
  {
    key: "ai_expected",
    label: "Expects to use AI in the next six months",
    question:
      /next six months, do you think this business will be using (super intelligence|artificial intelligence)/i,
    answer: "Yes",
  },
  {
    key: "weather_loss",
    label: "Monetary losses from an extreme weather event (last six months)",
    question: /monetary losses due to an extreme weather event/i,
    answer: "Yes",
  },
];

/** smpdt column headers: ISO week-year and fortnight, e.g. "202621". */
const PERIOD = /^20\d{2}(0[1-9]|1\d|2[0-7])$/;

/** "14.6%" / "56.5" → number; "S", "", or anything else → null. */
export function estimate(v: string | null | undefined): number | null {
  const t = (v ?? "").trim().replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Excel serial day number (1900 date system) → ISO date; null when not a plausible serial. */
export function serialDate(v: string | null | undefined): string | null {
  const n = Number((v ?? "").trim());
  if (!Number.isFinite(n) || n < 30000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

export type Period = {
  smpdt: string;
  collection_start: string | null;
  collection_end: string | null;
  reference_start: string | null;
  reference_end: string | null;
  published: string | null;
};

type Rec = Record<string, string | null>;
/** [smpdt, estimate, standard error] */
export type Point = [string, number | null, number | null];

export function readPeriods(recs: Rec[]): Period[] {
  const out: Period[] = [];
  for (const r of recs) {
    const smpdt = (r["Smpdt"] ?? "").trim();
    if (!PERIOD.test(smpdt)) continue;
    out.push({
      smpdt,
      collection_start: serialDate(r["Collection Start"]),
      collection_end: serialDate(r["Col End"]),
      reference_start: serialDate(r["Reference Period Start"]),
      reference_end: serialDate(r["Ref End"]),
      published: serialDate(r["Publication Date"]),
    });
  }
  return out.sort((a, b) => a.smpdt.localeCompare(b.smpdt));
}

const periodColumns = (r: Rec) =>
  Object.keys(r)
    .filter((k) => PERIOD.test(k))
    .sort();

/** Pairs estimate and standard-error records by key into ascending [period, value, se] series. */
export function pairSeries(est: Rec | undefined, se: Rec | undefined): Point[] {
  if (!est) return [];
  return periodColumns(est)
    .map((p): Point => [p, estimate(est[p]), se ? estimate(se[p]) : null])
    .filter(
      (p) => p[1] !== null || p[2] !== null || (est[p[0]] ?? "").trim().toUpperCase() === "S",
    );
}

export type AreaSeries = {
  code: string;
  indexes: Record<string, Point[]>;
  shares: Record<string, Point[]>;
  suppressed: number;
};

/**
 * Index and share series for each area. `stateCol` is null for the national workbook (one area, "US").
 */
export function areaSeries(
  indexEst: Rec[],
  indexSe: Rec[],
  respEst: Rec[],
  respSe: Rec[],
  stateCol: string | null,
): Map<string, AreaSeries> {
  const areaOf = (r: Rec) => (stateCol ? (r[stateCol] ?? "").trim().toUpperCase() : "US");
  const out = new Map<string, AreaSeries>();
  const get = (code: string) => {
    let a = out.get(code);
    if (!a) {
      a = { code, indexes: {}, shares: {}, suppressed: 0 };
      out.set(code, a);
    }
    return a;
  };
  const seIndex = new Map(
    indexSe.map((r) => [`${areaOf(r)}|${(r["Option Text"] ?? "").trim()}`, r]),
  );
  for (const r of indexEst) {
    const code = areaOf(r);
    const name = (r["Option Text"] ?? "").trim();
    if (!/^[A-Z]{2}$/.test(code) || !name) continue;
    const series = pairSeries(r, seIndex.get(`${code}|${name}`));
    if (!series.length) continue;
    const a = get(code);
    a.indexes[name] = series;
    a.suppressed += series.filter((p) => p[1] === null).length;
  }
  const respKey = (r: Rec) =>
    `${areaOf(r)}|${(r["Question ID"] ?? "").trim()}|${(r["Answer ID"] ?? "").trim()}`;
  const seResp = new Map(respSe.map((r) => [respKey(r), r]));
  for (const r of respEst) {
    const code = areaOf(r);
    if (!/^[A-Z]{2}$/.test(code)) continue;
    const q = r["Question"] ?? "";
    const ans = (r["Answer"] ?? "").trim();
    for (const s of SHARE_SERIES) {
      if (!s.question.test(q) || ans !== s.answer) continue;
      const series = pairSeries(r, seResp.get(respKey(r)));
      if (!series.length) continue;
      const a = get(code);
      // a question asked under more than one ID over the years: keep every period, the later ID winning a clash
      const merged = new Map((a.shares[s.key] ?? []).map((p) => [p[0], p]));
      for (const p of series) merged.set(p[0], p);
      a.shares[s.key] = [...merged.values()].sort((x, y) => x[0].localeCompare(y[0]));
      a.suppressed += series.filter((p) => p[1] === null).length;
    }
  }
  return out;
}

const lastValue = (s: Point[] | undefined) =>
  [...(s ?? [])].reverse().find((p) => p[1] !== null) ?? null;

export function btosRow(a: AreaSeries, periods: Period[], retrieved: string): CorpusRow {
  const name = STATE_NAMES[a.code] ?? a.code;
  const byPeriod = new Map(periods.map((p) => [p.smpdt, p]));
  const perf = lastValue(a.indexes["Current performance"]);
  const future = lastValue(a.indexes["Future performance"]);
  const ai = lastValue(a.shares["ai_use"]);
  const latest = [...Object.values(a.indexes), ...Object.values(a.shares)]
    .flat()
    .map((p) => p[0])
    .sort()
    .pop();
  const latestPeriod = latest ? byPeriod.get(latest) : undefined;
  const when = (smpdt: string | undefined) => {
    const p = smpdt ? byPeriod.get(smpdt) : undefined;
    return p?.collection_start && p.collection_end
      ? `${p.collection_start} to ${p.collection_end}`
      : (smpdt ?? "Not recorded");
  };
  const allPoints = [...Object.values(a.indexes), ...Object.values(a.shares)].flat();
  const first = allPoints.map((p) => p[0]).sort()[0];
  return corpusRecord(
    BTOS_DATASET,
    `btos:${a.code}`,
    `${name}: Business Trends and Outlook Survey`,
    {
      source_url: a.code === "US" ? BTOS_PAGE : BTOS_DOWNLOADS,
      state: a.code === "US" ? "" : a.code,
      subtitle: [
        perf ? `Current performance index ${perf[1]}` : null,
        ai ? `AI use ${ai[1]}%` : null,
        latestPeriod?.collection_end ? `collected through ${latestPeriod.collection_end}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      cells: {
        area: name,
        code: a.code,
        latest_collection_end: latestPeriod?.collection_end ?? null,
        current_performance: perf?.[1] ?? null,
        future_performance: future?.[1] ?? null,
        ai_use_pct: ai?.[1] ?? null,
        periods: new Set(allPoints.map((p) => p[0])).size,
      },
      facts: [
        ["Area", name],
        ["Latest collection period", when(latest)],
        ["First period in this row", when(first)],
        ...(perf
          ? [["Current performance index", `${perf[1]} (${when(perf[0])})`] as [string, string]]
          : []),
        ...(ai
          ? [
              ["Businesses using AI in the last two weeks", `${ai[1]}% (${when(ai[0])})`] as [
                string,
                string,
              ],
            ]
          : []),
        [
          "How the indexes work",
          "Each index runs 0 to 100: an answer of increased (or excellent) counts 100, no change (or average) 50, decreased (or poor) 0, averaged over businesses. 50 means balanced; below 50 means more businesses reported decreases.",
        ],
        [
          "Wording",
          'The survey now words its AI questions as "Super Intelligence (SI), formerly referred to as Artificial Intelligence"; the series continues under the same question.',
        ],
        [
          "Suppressed estimates",
          `${a.suppressed} values the Census Bureau suppressed for quality are left empty`,
        ],
        ["Retrieved", retrieved],
      ],
      text: `${name} ${a.code} business trends outlook survey BTOS revenues employment hours demand prices AI use extreme weather losses Census`,
      filters: { code: [a.code] },
      links: [
        { label: "BTOS data (Census Bureau)", url: BTOS_PAGE },
        { label: "BTOS downloads and methodology", url: BTOS_DOWNLOADS },
      ],
      extra: {
        btos: {
          code: a.code,
          name,
          columns: ["smpdt", "estimate", "standard_error"],
          periods: periods as unknown as Json,
          indexes: a.indexes as unknown as Json,
          shares: a.shares as unknown as Json,
          share_labels: Object.fromEntries(SHARE_SERIES.map((s) => [s.key, s.label])),
        },
      },
    },
  );
}

export function comparableBtos(content: RowContent): Json {
  const facts = (Array.isArray(content.detail["facts"]) ? content.detail["facts"] : []).filter(
    (f) => !(Array.isArray(f) && f[0] === "Retrieved"),
  );
  return {
    ...(content as unknown as JsonObject),
    detail: { ...content.detail, facts },
  } as unknown as Json;
}

/** Only "Yes" answers feed the share series, so the response sheets are read through this filter. */
const YES: RowFilter = { column: "Answer", keep: (v) => (v ?? "").trim() === "Yes" };

async function readWorkbook(bytes: Uint8Array) {
  const sheets = await xlsxSheets(bytes);
  const strings = await xlsxSharedStrings(bytes);
  const read = async (name: string, filter?: RowFilter) => {
    const s = sheets.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!s) throw new Error(`the BTOS workbook has no "${name}" sheet`);
    return xlsxRecords(bytes, s.path, strings, filter);
  };
  return {
    indexEst: await read("Index Estimates"),
    indexSe: await read("Index Standard Errors"),
    respEst: await read("Response Estimates", YES),
    respSe: await read("Response Standard Errors", YES),
    dates: await read("Collection and Reference Dates"),
  };
}

export const censusBtos: SourceAdapter = {
  source: "census_btos_states",
  dataset: BTOS_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-census",
  limits: { maxRequests: 4, minIntervalMs: 1000 },
  secrets: [],
  async collect(ctx): Promise<Collected> {
    if (!ctx.http.getBytes) throw new Error("this run's HTTP client cannot read binary files");
    const retrieved = ctx.now.toISOString().slice(0, 10);
    const national = await ctx.http.getBytes(BTOS_NATIONAL);
    if (national.status !== 200) throw new Error(`BTOS National.xlsx HTTP ${national.status}`);
    const state = await ctx.http.getBytes(BTOS_STATE);
    if (state.status !== 200) throw new Error(`BTOS State.xlsx HTTP ${state.status}`);
    const n = await readWorkbook(national.bytes);
    const s = await readWorkbook(state.bytes);
    const areas = new Map([
      ...areaSeries(n.indexEst, n.indexSe, n.respEst, n.respSe, null),
      ...areaSeries(s.indexEst, s.indexSe, s.respEst, s.respSe, "State"),
    ]);
    // the dates sheet also schedules future collections; keep the periods some series has published
    const published = new Set<string>();
    for (const a of areas.values())
      for (const series of [...Object.values(a.indexes), ...Object.values(a.shares)])
        for (const p of series) published.add(p[0]);
    const periods = readPeriods(n.dates.length ? n.dates : s.dates).filter((p) =>
      published.has(p.smpdt),
    );
    if (periods.length < 20)
      throw new Error(`only ${periods.length} published collection periods read`);
    if (areas.size < 50) throw new Error(`only ${areas.size} areas read`);
    const held: HeldRecord[] = [];
    const rows: CorpusRow[] = [];
    for (const a of [...areas.values()].sort((x, y) => x.code.localeCompare(y.code))) {
      if (!STATE_NAMES[a.code]) {
        held.push({ key: a.code, reason: "area code not a state, DC, Puerto Rico or the nation" });
        continue;
      }
      if (!Object.keys(a.indexes).length) {
        held.push({ key: a.code, reason: "no index series published" });
        continue;
      }
      rows.push(btosRow(a, periods, retrieved));
    }
    const last = periods[periods.length - 1]!;
    return {
      rows,
      fetched: areas.size,
      held,
      cursorAfter: { latest: last.smpdt, collection_end: last.collection_end },
      complete: true,
      notes: { areas: areas.size, periods: periods.length, latest: last.smpdt },
    };
  },
  comparable: comparableBtos,
};
