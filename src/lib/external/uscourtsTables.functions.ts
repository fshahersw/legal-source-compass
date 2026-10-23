/**
 * U.S. Courts published statistical tables as time series (datasets uscourts_tables_district, uscourts_tables_bankruptcy,
 * uscourts_tables_circuit and uscourts_tables_national, built by scripts/enrichment/uscourts_tables).
 *
 * Each stored record holds one table for one court (or one national table): the periods the publisher printed it for
 * ("12 months ending <date>"), the columns under their published headings, one value array per column aligned to the
 * periods, the national row and the circuit row of the same table, the footnotes that changed meaning and the source file
 * of every period. Stored JSON is validated here: a value that is not a finite number becomes null (shown as "Not
 * recorded"), a column whose array does not match the period count is dropped, a series is never interpolated or
 * padded, and only http(s) source links survive. Read-only, server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";

// ---------------------------------------------------------------------------------------------- primitives

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v: unknown) => {
  const s = str(v);
  if (!s || !ISO_DATE.test(s)) return null;
  const t = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s;
};
const httpUrl = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

// ---------------------------------------------------------------------------------------------- types

export const UST_UNITS = ["count", "percent", "months", "days", "ratio", "number"] as const;
export type UstUnit = (typeof UST_UNITS)[number];
export type UstScope = "district" | "bankruptcy" | "circuit" | "appeals" | "county" | "national";

/** One period a table was published for: the publisher's "12-month period ending <end>" (months can be 1, 3 or 12). */
export type UstPeriod = {
  end: string;
  months: number | null;
  /** Publication code: JB (Judicial Business), STFJ, FJCS, BF (Bankruptcy Filings). */
  pub: string;
  /** Index into `sources`. */
  src: number;
};

export type UstColumn = {
  key: string;
  /** The heading path as published, joined with " / ". */
  label: string;
  unit: UstUnit;
  decimals: number | null;
};

export type UstSource = {
  pub: string;
  end: string;
  page: string | null;
  url: string;
  sha256: string | null;
  format: string;
  sheet: string | null;
};

export type UstNote = { at: number[]; lines: string[] };
/** A footnote the publisher attached to this row (col null) or to a column, with the periods it applies to. */
export type UstMark = { at: number[]; col: string | null; text: string };
export type UstBreak = { at: number; kind: string; detail: string };
export type UstSeries = Record<string, (number | null)[]>;
export type UstDash = Record<string, number[]>;

export type UstTable = {
  scope: UstScope;
  /** Court id for a court record; null for a national table. */
  court: string | null;
  /** The row label as published ("NY,S", "1st"), when the record is one court's row. */
  courtLabel: string | null;
  table: string;
  tableKey: string;
  title: string;
  periods: UstPeriod[];
  columns: UstColumn[];
  data: UstSeries;
  /** Period indexes where the source printed a dash (not recorded as zero). */
  dash: UstDash;
  /** The table's national "Total" row for the same columns and periods. */
  national: UstSeries;
  nationalDash: UstDash;
  circuitId: string | null;
  circuit: UstSeries | null;
  notes: UstNote[];
  /** Footnotes attached to this court's row or to a column heading (as published, with their mark). */
  marks: UstMark[];
  breaks: UstBreak[];
  sources: UstSource[];
  /** County records only (Bankruptcy Filings F-5A): the 5-digit FIPS code, the reporting district's id and its own row. */
  county: {
    fips: string;
    district: string;
    state: string | null;
    districtRow: UstSeries | null;
    outsideAt: number[];
  } | null;
};

export type UstRow = {
  key: string;
  label: string;
  path: string[];
  depth: number;
  data: UstSeries;
  dash: UstDash;
  marks: UstMark[];
};

/** A national table: category rows under the published labels. */
export type UstNationalTable = Omit<
  UstTable,
  | "court"
  | "courtLabel"
  | "data"
  | "dash"
  | "national"
  | "nationalDash"
  | "circuitId"
  | "circuit"
  | "marks"
  | "county"
> & { rows: UstRow[]; totals: UstSeries };

// ---------------------------------------------------------------------------------------------- parsing

function parseSeriesMap(raw: unknown, n: number, keys: Set<string>): UstSeries {
  const out: UstSeries = {};
  const o = obj(raw);
  if (!o) return out;
  for (const [key, values] of Object.entries(o)) {
    if (!keys.has(key)) continue;
    const a = arr(values);
    if (a.length !== n) continue;
    out[key] = a.map(num);
  }
  return out;
}

function parseDashMap(raw: unknown, n: number, keys: Set<string>): UstDash {
  const out: UstDash = {};
  const o = obj(raw);
  if (!o) return out;
  for (const [key, values] of Object.entries(o)) {
    if (!keys.has(key)) continue;
    const idx = arr(values).filter(
      (v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n,
    );
    if (idx.length) out[key] = idx;
  }
  return out;
}

function parseMarks(raw: unknown, n: number, keys: Set<string>): UstMark[] {
  const out: UstMark[] = [];
  for (const m of arr(raw)) {
    const r = obj(m);
    const text = str(r?.["text"]);
    const col = r?.["col"] == null ? null : str(r["col"]);
    const at = arr(r?.["at"]).filter(
      (v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n,
    );
    if (!r || !text || !at.length || (r["col"] != null && (!col || !keys.has(col)))) continue;
    out.push({ at, col, text });
  }
  return out;
}

function parseCommon(u: Record<string, unknown>) {
  const periodsRaw = arr(u["periods"]);
  const periods: UstPeriod[] = [];
  for (const p of periodsRaw) {
    const r = obj(p);
    const end = isoDate(r?.["end"]);
    const pub = str(r?.["pub"]);
    const src = r?.["src"];
    if (!r || !end || !pub || typeof src !== "number" || !Number.isInteger(src)) return null;
    const months = num(r["months"]);
    periods.push({ end, months: months != null && months > 0 ? months : null, pub, src });
  }
  if (!periods.length) return null;
  for (let i = 1; i < periods.length; i += 1)
    if (periods[i]!.end <= periods[i - 1]!.end) return null;
  const columns: UstColumn[] = [];
  const seen = new Set<string>();
  for (const c of arr(u["cols"])) {
    const r = obj(c);
    const key = str(r?.["k"]);
    const label = str(r?.["label"]);
    if (!r || !key || !label || seen.has(key)) continue;
    const unit = (UST_UNITS as readonly string[]).includes(String(r["unit"]))
      ? (r["unit"] as UstUnit)
      : "number";
    const dec = num(r["dec"]);
    seen.add(key);
    columns.push({
      key,
      label,
      unit,
      decimals: dec != null && Number.isInteger(dec) && dec >= 0 && dec <= 6 ? dec : null,
    });
  }
  if (!columns.length) return null;
  const sources: UstSource[] = [];
  for (const s of arr(u["src"])) {
    const r = obj(s);
    const url = httpUrl(r?.["url"]);
    const end = isoDate(r?.["end"]);
    const pub = str(r?.["pub"]);
    if (!r || !url || !end || !pub) {
      sources.push({
        pub: "",
        end: "",
        page: null,
        url: "",
        sha256: null,
        format: "",
        sheet: null,
      });
      continue;
    }
    sources.push({
      pub,
      end,
      page: httpUrl(r["page"]),
      url,
      sha256: str(r["sha256"]),
      format: str(r["fmt"]) ?? "",
      sheet: str(r["sheet"]),
    });
  }
  // A period whose source is missing is kept (the value still has its publisher and date) but its link is empty.
  const notes: UstNote[] = [];
  for (const n of arr(u["notes"])) {
    const r = obj(n);
    const lines = arr(r?.["lines"])
      .map(str)
      .filter((l): l is string => l != null);
    const at = arr(r?.["at"]).filter(
      (v): v is number =>
        Number.isInteger(v) && (v as number) >= 0 && (v as number) < periods.length,
    );
    if (r && lines.length && at.length) notes.push({ at, lines });
  }
  const breaks: UstBreak[] = [];
  for (const b of arr(u["breaks"])) {
    const r = obj(b);
    const at = num(r?.["at"]);
    const kind = str(r?.["kind"]);
    const detail = str(r?.["detail"]);
    if (r && at != null && Number.isInteger(at) && at >= 0 && at < periods.length && kind && detail)
      breaks.push({ at, kind, detail });
  }
  return { periods, columns, sources, notes, breaks, keys: new Set(columns.map((c) => c.key)) };
}

/** Parse one court-by-table record (`item.ust`). Null when the record cannot be read; malformed columns are dropped. */
export function parseUstTable(raw: unknown): UstTable | null {
  const u = obj(raw);
  if (!u || u["v"] !== 1) return null;
  const scope = u["scope"];
  if (
    scope !== "district" &&
    scope !== "bankruptcy" &&
    scope !== "circuit" &&
    scope !== "appeals" &&
    scope !== "county"
  )
    return null;
  const table = str(u["table"]);
  const tableKey = str(u["tableKey"]);
  const title = str(u["title"]);
  if (!table || !tableKey || !title) return null;
  const common = parseCommon(u);
  if (!common) return null;
  const n = common.periods.length;
  const data = parseSeriesMap(u["data"], n, common.keys);
  const columns = common.columns.filter((c) => data[c.key]);
  if (!columns.length) return null;
  const keys = new Set(columns.map((c) => c.key));
  const circ = obj(u["circ"]);
  let county: UstTable["county"] = null;
  if (scope === "county") {
    const fips = str(u["fips"]);
    const district = str(u["district"]);
    if (!fips || !/^\d{5}$/.test(fips) || !district) return null;
    const row = obj(u["districtRow"]);
    county = {
      fips,
      district,
      state: str(u["state"]),
      districtRow: row ? parseSeriesMap(row, n, keys) : null,
      outsideAt: arr(u["outsideAt"]).filter(
        (v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n,
      ),
    };
  }
  return {
    scope,
    court: str(u["court"]),
    courtLabel: str(u["courtLabel"]),
    table,
    tableKey,
    title,
    periods: common.periods,
    columns,
    data,
    dash: parseDashMap(u["dash"], n, keys),
    national: parseSeriesMap(u["nat"], n, keys),
    nationalDash: parseDashMap(u["natDash"], n, keys),
    circuitId: str(u["circuitId"]),
    circuit: circ ? parseSeriesMap(circ, n, keys) : null,
    notes: common.notes,
    marks: parseMarks(u["marks"], n, keys),
    breaks: common.breaks,
    sources: common.sources,
    county,
  };
}

export function parseUstNational(raw: unknown): UstNationalTable | null {
  const u = obj(raw);
  if (!u || u["v"] !== 1 || u["scope"] !== "national") return null;
  const table = str(u["table"]);
  const tableKey = str(u["tableKey"]);
  const title = str(u["title"]);
  if (!table || !tableKey || !title) return null;
  const common = parseCommon(u);
  if (!common) return null;
  const n = common.periods.length;
  const rows: UstRow[] = [];
  for (const r of arr(u["rows"])) {
    const o = obj(r);
    const key = str(o?.["k"]);
    const label = str(o?.["label"]);
    if (!o || !key || !label) continue;
    const data = parseSeriesMap(o["data"], n, common.keys);
    if (!Object.keys(data).length) continue;
    const depth = num(o["depth"]);
    rows.push({
      key,
      label,
      path: arr(o["path"])
        .map(str)
        .filter((p): p is string => p != null),
      depth: depth != null && depth >= 0 ? Math.floor(depth) : 0,
      data,
      dash: parseDashMap(o["dash"], n, common.keys),
      marks: parseMarks(o["marks"], n, common.keys),
    });
  }
  if (!rows.length) return null;
  const { keys: _keys, ...rest } = common;
  void _keys;
  return {
    scope: "national",
    table,
    tableKey,
    title,
    ...rest,
    rows,
    totals: parseSeriesMap(u["totals"], n, common.keys),
  };
}

// ---------------------------------------------------------------------------------------------- catalog

export type UstCatalogEntry = {
  tableKey: string;
  table: string;
  title: string;
  scopes: UstScope[];
  firstEnd: string;
  lastEnd: string;
  periods: number;
  pubs: string[];
};

export function parseUstCatalog(raw: unknown): UstCatalogEntry[] {
  const out: UstCatalogEntry[] = [];
  for (const e of arr(obj(raw)?.["tables"])) {
    const r = obj(e);
    const tableKey = str(r?.["tableKey"]);
    const table = str(r?.["table"]);
    const title = str(r?.["title"]);
    const firstEnd = isoDate(r?.["firstEnd"]);
    const lastEnd = isoDate(r?.["lastEnd"]);
    const periods = num(r?.["periods"]);
    if (
      !r ||
      !tableKey ||
      !table ||
      !title ||
      !firstEnd ||
      !lastEnd ||
      periods == null ||
      periods < 1
    )
      continue;
    const scopes = arr(r["scopes"]).filter((s): s is UstScope =>
      ["district", "bankruptcy", "circuit", "appeals", "county", "national"].includes(String(s)),
    );
    out.push({
      tableKey,
      table,
      title,
      scopes,
      firstEnd,
      lastEnd,
      periods,
      pubs: arr(r["pubs"])
        .map(str)
        .filter((p): p is string => p != null),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- reads

export const USCOURTS_DATASETS = {
  district: "uscourts_tables_district",
  bankruptcy: "uscourts_tables_bankruptcy",
  circuit: "uscourts_tables_circuit",
  county: "uscourts_tables_bankruptcy_county",
  national: "uscourts_tables_national",
} as const;

const BANKRUPTCY_ID = /^[a-z]{2,5}b$/;
const TABLE_KEY = /^[a-z0-9][a-z0-9-]{0,30}$/;

/** The 94 federal district courts the statistical tables print (the court directory holds other, historical "…d" ids). */
export const FEDERAL_DISTRICT_IDS: ReadonlySet<string> = new Set(
  (
    "akd almd alnd alsd ared arwd azd cacd caed cand casd cod ctd dcd ded flmd flnd flsd gamd gand gasd gud hid iand iasd idd " +
    "ilcd ilnd ilsd innd insd ksd kyed kywd laed lamd lawd mad mdd med mied miwd mnd moed mowd msnd mssd mtd nced ncmd ncwd ndd " +
    "ned nhd njd nmd nmid nvd nyed nynd nysd nywd ohnd ohsd oked oknd okwd ord paed pamd pawd prd rid scd sdd tned tnmd tnwd txed " +
    "txnd txsd txwd utd vaed vawd vid vtd waed wawd wied wiwd wvnd wvsd wyd"
  ).split(" "),
);
/** The 12 regional circuits and the Federal Circuit. */
export const FEDERAL_CIRCUIT_IDS: ReadonlySet<string> = new Set([
  "cadc",
  "ca1",
  "ca2",
  "ca3",
  "ca4",
  "ca5",
  "ca6",
  "ca7",
  "ca8",
  "ca9",
  "ca10",
  "ca11",
  "cafc",
]);

/**
 * Which table dataset holds a court's rows, from the court id alone: a federal district, a regional circuit or the Federal
 * Circuit, or a bankruptcy court that pairs with a district (see bankruptcyDistrict). Null for every other court.
 */
export function courtScope(courtId: string): "district" | "bankruptcy" | "circuit" | null {
  if (FEDERAL_CIRCUIT_IDS.has(courtId)) return "circuit";
  if (FEDERAL_DISTRICT_IDS.has(courtId)) return "district";
  if (BANKRUPTCY_ID.test(courtId) && bankruptcyDistrict(courtId)) return "bankruptcy";
  return null;
}

type Cache<T> = { at: number; value: T };
const TTL = 10 * 60 * 1000;
const cache = new Map<string, Cache<unknown>>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cache<T> | undefined;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Read the stored tables of one court. `dataset` overrides the dataset the court id implies: bankruptcy tables are keyed by
 * the district id (a bankruptcy court is a unit of its district), so a district page reads them with dataset "bankruptcy".
 */
export async function loadCourtTables(
  courtId: string,
  tableKeys: readonly string[],
  dataset?: "district" | "bankruptcy" | "circuit",
): Promise<UstTable[]> {
  const scope = dataset ?? courtScope(courtId);
  if (!scope || !tableKeys.length) return [];
  const keys = [...new Set(tableKeys.filter((k) => TABLE_KEY.test(k)))];
  if (!keys.length) return [];
  const ids = keys.map((k) => `"${courtId}:${k}"`).join(",");
  const r = await restGet<{ id: string; ust: unknown }[]>(
    `corpus_records?select=id,ust:item->ust&dataset=eq.${USCOURTS_DATASETS[scope]}&id=in.(${encodeURIComponent(ids)})`,
  );
  const out: UstTable[] = [];
  for (const row of r.rows) {
    const t = parseUstTable(row.ust);
    if (t && t.court === courtId) out.push(t);
  }
  return out;
}

export const getUscourtsCourtTables = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        courtId: z.string().regex(/^[a-z0-9]{2,8}$/),
        tables: z.array(z.string().regex(TABLE_KEY)).min(1).max(12),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<UstTable[]> =>
    cached(`court:${data.courtId}:${[...data.tables].sort().join(",")}`, () =>
      loadCourtTables(data.courtId, data.tables),
    ),
  );

/**
 * Bankruptcy filings of one county (Table F-5A), by its 5-digit FIPS code: one table per reporting district, because a county
 * can appear under another district's rows (those rows are marked `outsideAt`) and the two are never merged.
 */
export async function loadCountyTables(
  fips: string,
  tableKeys: readonly string[] = ["f-5a"],
): Promise<UstTable[]> {
  if (!/^\d{5}$/.test(fips)) return [];
  const keys = [...new Set(tableKeys.filter((k) => TABLE_KEY.test(k)))];
  if (!keys.length) return [];
  const ids = keys.flatMap((k) => [`"table:${k}"`, `"${fips}:${k}"`]).join(",");
  const r = await restGet<{ id: string; ust: unknown }[]>(
    `corpus_records?select=id,ust:item->ust&dataset=eq.${USCOURTS_DATASETS.county}&id=in.(${encodeURIComponent(ids)})`,
  );
  const byId = new Map(r.rows.map((row) => [row.id, row.ust]));
  const out: UstTable[] = [];
  for (const key of keys) {
    for (const payload of countyPayloads(byId.get(`table:${key}`), byId.get(`${fips}:${key}`))) {
      const t = parseUstTable(payload);
      if (t && t.scope === "county" && t.county?.fips === fips) out.push(t);
    }
  }
  return out;
}

/**
 * Full table payloads of one county from its stored pieces. A county record holds only the county's own series, one entry per
 * reporting district; the periods, columns, sources, footnotes, breaks, the national Total row and each district's own row are
 * stored once per table (the `table:<key>` record) and are joined here, so the result has the shape of any other table record.
 */
export function countyPayloads(shared: unknown, county: unknown): unknown[] {
  const s = obj(shared);
  const c = obj(county);
  if (
    !s ||
    !c ||
    s["kind"] !== "county-table" ||
    c["scope"] !== "county" ||
    c["tableKey"] !== s["tableKey"]
  )
    return [];
  const districtRows = obj(s["districtRows"]);
  return arr(c["districts"]).flatMap((entry) => {
    const e = obj(entry);
    const district = str(e?.["district"]);
    if (!e || !district) return [];
    return [
      {
        v: 1,
        scope: "county",
        court: `${str(c["fips"]) ?? ""}:${district}`,
        courtLabel: e["label"] ?? c["courtLabel"],
        table: s["table"],
        tableKey: s["tableKey"],
        title: s["title"],
        periods: s["periods"],
        cols: s["cols"],
        src: s["src"],
        notes: s["notes"],
        breaks: s["breaks"],
        nat: s["nat"],
        natDash: s["natDash"],
        data: e["data"],
        dash: e["dash"],
        marks: [...arr(e["marks"]), ...arr(s["marks"])],
        fips: c["fips"],
        state: c["state"],
        district,
        districtRow: obj(districtRows?.[district])?.["data"] ?? null,
        outsideAt: e["outsideAt"],
      },
    ];
  });
}

export const getUscourtsCountyTables = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        fips: z.string().regex(/^\d{5}$/),
        tables: z.array(z.string().regex(TABLE_KEY)).max(4).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<UstTable[]> =>
    cached(`county:${data.fips}:${(data.tables ?? []).join(",")}`, () =>
      loadCountyTables(data.fips, data.tables),
    ),
  );

export const getUscourtsNationalTable = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ table: z.string().regex(TABLE_KEY) }).parse(d))
  .handler(async ({ data }): Promise<UstNationalTable | null> =>
    cached(`national:${data.table}`, async () => {
      const r = await restGet<{ id: string; ust: unknown }[]>(
        `corpus_records?select=id,ust:item->ust&dataset=eq.${USCOURTS_DATASETS.national}&id=eq.${encodeURIComponent(data.table)}`,
      );
      return parseUstNational(r.rows[0]?.ust);
    }),
  );

// ---------------------------------------------------------------------------------------------- court trends bundle

/** Tables the trend panel charts, per kind of court page (table keys as stored). */
export const TREND_TABLES = {
  district: ["c", "d", "c-5", "c-6", "x-1a"],
  circuit: ["b", "b-4"],
  bankruptcy: ["f-2", "f-2-three-months"],
} as const;

/**
 * The district whose bankruptcy statistics a bankruptcy-court id shows: stored bankruptcy tables are keyed by the district
 * id ("azd" for the Arizona bankruptcy court, which the court directory spells "arb"). Ids with no district pairing (the
 * Nebraska entry "neb", and "ptab", "ttab", "mspb", which are not bankruptcy courts) return null.
 */
export function bankruptcyDistrict(courtId: string): string | null {
  if (!BANKRUPTCY_ID.test(courtId)) return null;
  if (courtId === "arb") return "azd";
  if (["neb", "ptab", "ttab", "mspb"].includes(courtId)) return null;
  const district = `${courtId.slice(0, -1)}d`;
  return FEDERAL_DISTRICT_IDS.has(district) ? district : null;
}

export type CourtTrends = {
  courtId: string;
  kind: "district" | "circuit" | "bankruptcy";
  /** The court id the stored rows are keyed by (the district for a bankruptcy court). */
  keyId: string;
  /** Tables from the court's own dataset (civil, criminal and judgeship tables of a district; appeals tables of a circuit). */
  tables: UstTable[];
  /** Bankruptcy tables of the same district. */
  bankruptcy: UstTable[];
};

export async function loadCourtTrends(courtId: string): Promise<CourtTrends | null> {
  const scope = courtScope(courtId);
  if (!scope) return null;
  if (scope === "bankruptcy") {
    const district = bankruptcyDistrict(courtId);
    if (!district) return null;
    const bankruptcy = await loadCourtTables(district, TREND_TABLES.bankruptcy, "bankruptcy");
    return bankruptcy.length
      ? { courtId, kind: "bankruptcy", keyId: district, tables: [], bankruptcy }
      : null;
  }
  if (scope === "circuit") {
    const tables = await loadCourtTables(courtId, TREND_TABLES.circuit);
    return tables.length
      ? { courtId, kind: "circuit", keyId: courtId, tables, bankruptcy: [] }
      : null;
  }
  const [tables, bankruptcy] = await Promise.all([
    loadCourtTables(courtId, TREND_TABLES.district),
    loadCourtTables(courtId, TREND_TABLES.bankruptcy, "bankruptcy"),
  ]);
  return tables.length || bankruptcy.length
    ? { courtId, kind: "district", keyId: courtId, tables, bankruptcy }
    : null;
}

export const getCourtStatsTrends = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ courtId: z.string().regex(/^[a-z0-9]{2,8}$/) }).parse(d))
  .handler(async ({ data }): Promise<CourtTrends | null> =>
    cached(`trends:${data.courtId}`, () => loadCourtTrends(data.courtId)),
  );

export const getUscourtsCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<UstCatalogEntry[]> =>
    cached("catalog", async () => {
      const r = await restGet<{ id: string; catalog: unknown }[]>(
        `corpus_records?select=id,catalog:item->catalog&dataset=eq.${USCOURTS_DATASETS.national}&id=eq.summary:catalog`,
      );
      return parseUstCatalog(r.rows[0]?.catalog);
    }),
);
