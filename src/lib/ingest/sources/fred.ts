/**
 * FRED (Federal Reserve Bank of St. Louis) series → econ_fred_series (one row per series: metadata as published, latest
 * observation) and econ_fred_observations (one row per series and calendar year: every observation of that year with
 * its vintage). Shared by the full build (scripts/api_econ/fred_build.mjs) and the scheduled refresh
 * (supabase/functions/ingest-fred, sources fred_observations and fred_series), so both write identical rows.
 *
 * Vintages. Observations are read with their full ALFRED real-time history (every vintage from the first observation
 * date requested to 9999-12-31; FRED serves at most 2,000 vintage dates per request, so long histories are read in
 * windows). For each date the current value is the row whose realtime period ends 9999-12-31; its vintage is the
 * first day of the run of realtime periods carrying that same value (the date ALFRED first shows the current value). If
 * the first value ALFRED shows for the date differs from the current one, the first value and its vintage date are kept
 * beside it. FRED's "." (no value for that date, e.g. a holiday) is kept as null. ALFRED's history starts at the
 * earliest vintage it holds, so for older observations the vintage date is that earliest vintage, not the original
 * publication date; the rows say so.
 *
 * Scheduled refresh (both sources are bounded, polite and resumable):
 *   fred_observations — for each FRED release used by the series (H.15, CPI, ECI, Employment Situation, State
 *     Employment and Unemployment, Personal Income and Outlays), reads the release dates since the series was last
 *     fetched; a series is due when its release published again (daily and weekly series), or when the next period of a
 *     monthly/quarterly series has ended and its release published since (so the daily H.15 release does not refetch
 *     monthly averages every day), or after a safety interval. A due series is reread from 1 January of the year 31
 *     days before its last observation (daily/weekly) or five years before it (monthly/quarterly: BLS revises seasonally
 *     adjusted CPI and state unemployment for five years each year), and every year row from that year on is rebuilt.
 *     Series beyond the request budget stay due and are read on the next run.
 *   fred_series — rereads FRED's metadata for a rotating slice of the series each run (all series every few days) and
 *     restates every series row's latest observation and year list from the stored observation rows.
 * The FRED API key travels only in the request URL FRED requires; every recorded URL has it removed (http.ts).
 */
import { BudgetExhausted, RateLimited, SourceError } from "../http.ts";
import { maskPath, corpusRecord } from "../rows.ts";
import type {
  CollectContext,
  Collected,
  CorpusRow,
  HeldRecord,
  Json,
  JsonObject,
  SourceAdapter,
  SourceHttp,
} from "../types.ts";
import { FRED_SERIES, GROUP_LABELS, SPEC_BY_ID, type FredSpec } from "./fredSpec.ts";

export const OBS_DATASET = "econ_fred_observations";
export const SERIES_DATASET = "econ_fred_series";
export const API_BASE = "https://api.stlouisfed.org/fred";
export const API_DOCS = "https://fred.stlouisfed.org/docs/api/fred/";
export const FRED_NOTICE =
  "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";
export const FRED_TERMS_URL = "https://fred.stlouisfed.org/docs/api/terms_of_use.html";
export const ALL_REALTIME = { start: "1776-07-04", end: "9999-12-31" } as const;
export const VINTAGE_BASIS =
  "Current vintage from ALFRED's real-time history; the vintage date is the first day ALFRED shows the current value. ALFRED's history begins at the earliest vintage it holds, so for older observations that date is the earliest vintage held, not the original publication date.";
const NOT_RECORDED = "Not recorded";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const VALUE = /^-?\d+(\.\d+)?$/;
const SID = /^[A-Z0-9]{2,30}$/;

export const seriesPage = (id: string) => `https://fred.stlouisfed.org/series/${id}`;
export const alfredPage = (id: string) => `https://alfred.stlouisfed.org/series?seid=${id}`;
export const seriesRowId = (id: string) => `fred:${id}`;
export const obsRowId = (id: string, year: number | string) => `fred:${id}:${year}`;

/** A FRED API URL without the key (the form that is recorded and shown). */
export function fredUrl(path: string, params: Record<string, string | number>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  q.set("file_type", "json");
  return `${API_BASE}/${path}?${q.toString()}`;
}

/** The same URL with the key FRED requires as a query parameter (never recorded: http.ts strips api_key). */
export const keyed = (url: string, key: string) => `${url}&api_key=${encodeURIComponent(key)}`;

// ------------------------------------------------------------------------------------------------ parsing

export type FredSeriesMeta = {
  id: string;
  title: string;
  observation_start: string;
  observation_end: string;
  frequency: string;
  frequency_short: string;
  units: string;
  units_short: string;
  seasonal_adjustment: string;
  seasonal_adjustment_short: string;
  last_updated: string;
  notes: string | null;
};
export type FredRelease = { id: number; name: string; link: string | null };
export type FredSource = { id: number; name: string; link: string | null };
export type RawObservation = {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
};
export type Observation = {
  date: string;
  /** As published (text, so "4.10" stays "4.10"); null where FRED publishes "." (no value for the date). */
  value: string | null;
  vintage: string;
  firstValue?: string | null;
  firstVintage?: string;
};
/** Stored form: [date, value, vintage] or, when the first published value differs, [date, value, vintage, first, firstVintage]. */
export type ObsTuple =
  | [string, string | null, string]
  | [string, string | null, string, string | null, string];

function fredJson(text: string, what: string): JsonObject {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new SourceError(`FRED ${what}: response is not JSON`, 0);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    throw new SourceError(`FRED ${what}: unexpected response shape`, 0);
  const o = doc as JsonObject;
  if (typeof o["error_message"] === "string")
    throw new SourceError(
      `FRED ${what}: ${String(o["error_message"]).slice(0, 200)}`,
      Number(o["error_code"] ?? 0),
    );
  return o;
}

const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);

export function parseSeriesMeta(text: string): FredSeriesMeta {
  const doc = fredJson(text, "series");
  const s = (Array.isArray(doc["seriess"]) ? doc["seriess"][0] : null) as JsonObject | null;
  if (!s) throw new SourceError("FRED series: no series in the response", 0);
  const need = (k: string) => {
    const v = str(s[k]);
    if (v === null) throw new SourceError(`FRED series: field ${k} missing`, 0);
    return v;
  };
  const meta: FredSeriesMeta = {
    id: need("id"),
    title: need("title"),
    observation_start: need("observation_start"),
    observation_end: need("observation_end"),
    frequency: need("frequency"),
    frequency_short: need("frequency_short"),
    units: need("units"),
    units_short: need("units_short"),
    seasonal_adjustment: need("seasonal_adjustment"),
    seasonal_adjustment_short: need("seasonal_adjustment_short"),
    last_updated: need("last_updated"),
    notes: str(s["notes"]),
  };
  if (!SID.test(meta.id)) throw new SourceError("FRED series: unexpected series id", 0);
  if (!ISO.test(meta.observation_start) || !ISO.test(meta.observation_end))
    throw new SourceError("FRED series: observation period is not ISO dates", 0);
  return meta;
}

export function parseRelease(text: string): FredRelease {
  const doc = fredJson(text, "series/release");
  const r = (Array.isArray(doc["releases"]) ? doc["releases"][0] : null) as JsonObject | null;
  if (!r || typeof r["id"] !== "number" || typeof r["name"] !== "string")
    throw new SourceError("FRED series/release: no release in the response", 0);
  return { id: r["id"], name: r["name"], link: str(r["link"]) };
}

export function parseSources(text: string): FredSource[] {
  const doc = fredJson(text, "release/sources");
  const list = Array.isArray(doc["sources"]) ? (doc["sources"] as JsonObject[]) : [];
  return list
    .filter((s) => typeof s["id"] === "number" && typeof s["name"] === "string")
    .map((s) => ({ id: s["id"] as number, name: s["name"] as string, link: str(s["link"]) }));
}

export function parseReleaseDates(text: string): string[] {
  const doc = fredJson(text, "release/dates");
  const list = Array.isArray(doc["release_dates"]) ? (doc["release_dates"] as JsonObject[]) : [];
  return list
    .map((d) => str(d["date"]))
    .filter((d): d is string => d !== null && ISO.test(d))
    .sort();
}

export function parseObservationPage(text: string): {
  observations: RawObservation[];
  count: number;
  offset: number;
  limit: number;
} {
  const doc = fredJson(text, "series/observations");
  if (!Array.isArray(doc["observations"]))
    throw new SourceError("FRED series/observations: no observations array", 0);
  const observations = (doc["observations"] as JsonObject[]).map((o) => {
    const r = {
      realtime_start: str(o["realtime_start"]) ?? "",
      realtime_end: str(o["realtime_end"]) ?? "",
      date: str(o["date"]) ?? "",
      value: str(o["value"]) ?? "",
    };
    if (!ISO.test(r.date) || !ISO.test(r.realtime_start) || !ISO.test(r.realtime_end))
      throw new SourceError("FRED series/observations: a date is not ISO", 0);
    if (r.value !== "." && !VALUE.test(r.value))
      throw new SourceError("FRED series/observations: a value is not a number or '.'", 0);
    return r;
  });
  return {
    observations,
    count: Number(doc["count"] ?? observations.length),
    offset: Number(doc["offset"] ?? 0),
    limit: Number(doc["limit"] ?? 100000),
  };
}

const pubValue = (v: string): string | null => (v === "." ? null : v);

/** Current value of each date with its vintage (and the first published value when it differs). Sorted by date. */
export function currentObservations(raw: RawObservation[]): Observation[] {
  const byDate = new Map<string, RawObservation[]>();
  for (const r of raw) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const out: Observation[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const rows = byDate
      .get(date)!
      .slice()
      .sort((a, b) => (a.realtime_start < b.realtime_start ? -1 : a.realtime_start > b.realtime_start ? 1 : 0));
    let cur = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i]!.realtime_end === ALL_REALTIME.end) cur = i;
    if (cur < 0) continue; // the date is no longer published in the current vintage
    const current = rows[cur]!;
    let vintage = current.realtime_start;
    for (let i = cur - 1; i >= 0 && rows[i]!.value === current.value; i--) vintage = rows[i]!.realtime_start;
    const obs: Observation = { date, value: pubValue(current.value), vintage };
    const first = rows[0]!;
    if (first.value !== current.value) {
      obs.firstValue = pubValue(first.value);
      obs.firstVintage = first.realtime_start;
    }
    out.push(obs);
  }
  return out;
}

export const toTuple = (o: Observation): ObsTuple =>
  o.firstVintage === undefined
    ? [o.date, o.value, o.vintage]
    : [o.date, o.value, o.vintage, o.firstValue ?? null, o.firstVintage];

export const fromTuple = (t: Json): Observation | null => {
  if (!Array.isArray(t) || t.length < 3 || typeof t[0] !== "string" || typeof t[2] !== "string") return null;
  const o: Observation = {
    date: t[0],
    value: typeof t[1] === "string" ? t[1] : null,
    vintage: t[2],
  };
  if (t.length >= 5 && typeof t[4] === "string") {
    o.firstValue = typeof t[3] === "string" ? t[3] : null;
    o.firstVintage = t[4];
  }
  return o;
};

/** Third-party series whose owners restrict reuse carry "Copyright" in their FRED notes (FRED API Terms of Use). */
export const isRestricted = (meta: Pick<FredSeriesMeta, "notes" | "title">) =>
  /copyright/i.test(`${meta.notes ?? ""} ${meta.title}`);

// ------------------------------------------------------------------------------------------------ rows

/** What an observation row restates about its series (copied from the series metadata). */
export type ObsMeta = {
  id: string;
  label: string;
  group: string;
  units_short: string;
  frequency_short: string;
  seasonal_adjustment_short: string;
};

export const obsMetaOf = (
  spec: FredSpec,
  meta: Pick<FredSeriesMeta, "units_short" | "frequency_short" | "seasonal_adjustment_short">,
): ObsMeta => ({
  id: spec.id,
  label: spec.label,
  group: spec.group,
  units_short: meta.units_short,
  frequency_short: meta.frequency_short,
  seasonal_adjustment_short: meta.seasonal_adjustment_short,
});

export function observationRow(m: ObsMeta, year: string, obs: Observation[], asOf: string): CorpusRow {
  const rid = obsRowId(m.id, year);
  const withValue = obs.filter((o) => o.value !== null).length;
  const revised = obs.filter((o) => o.firstVintage !== undefined).length;
  const first = obs[0]?.date ?? NOT_RECORDED;
  const last = obs.at(-1)?.date ?? NOT_RECORDED;
  const facts: [string, string][] = [
    ["Series", `${m.label} (FRED ${m.id})`],
    ["Year", year],
    [
      "Observations",
      withValue === obs.length
        ? String(obs.length)
        : `${obs.length} dates, ${withValue} with a value (FRED publishes "." where a date has no value)`,
    ],
    ["First and last date", `${first} to ${last}`],
    ["Units", m.units_short],
    ["Frequency", m.frequency_short],
    ["Seasonal adjustment", m.seasonal_adjustment_short],
    [
      "Values revised after first publication",
      revised
        ? `${revised} (the first published value and its vintage date are kept beside the current value)`
        : "None in ALFRED's real-time history",
    ],
    ["Vintage basis", VINTAGE_BASIS],
    [
      "Source request",
      `FRED API fred/series/observations, series_id ${m.id}, observations ${year}-01-01 to ${year}-12-31, real-time period from ${year}-01-01 to ${ALL_REALTIME.end} (read in windows of at most 1,900 vintage dates where FRED requires it)`,
    ],
    ["Notice", FRED_NOTICE],
  ];
  return corpusRecord(OBS_DATASET, rid, `${m.label} (${m.id}), ${year}`, {
    source_url: seriesPage(m.id),
    subtitle: `${obs.length} observations, ${first} to ${last}`,
    cells: {
      series: m.id,
      year,
      observations: String(obs.length),
      first,
      last,
      units: m.units_short,
      revised: String(revised),
    },
    facts,
    links: [
      { url: seriesPage(m.id), label: "Series on FRED" },
      { url: alfredPage(m.id), label: "Vintages on ALFRED" },
    ],
    text: `${m.label} ${m.id} ${year} ${GROUP_LABELS[m.group as keyof typeof GROUP_LABELS] ?? ""}`,
    filters: { series: [m.id], year: [year], group: [m.group] },
    extra: {
      kind: "observations",
      fred: {
        series_id: m.id,
        year: Number(year),
        units_short: m.units_short,
        frequency_short: m.frequency_short,
        seasonal_adjustment_short: m.seasonal_adjustment_short,
        obs: obs.map(toTuple) as unknown as Json[],
        as_of: asOf,
      },
    },
  });
}

/** Year rows for every year at or after `fromYear` that has observations, oldest first. */
export function observationRows(m: ObsMeta, obs: Observation[], asOf: string, fromYear = 0): CorpusRow[] {
  const byYear = new Map<string, Observation[]>();
  for (const o of obs) {
    const y = o.date.slice(0, 4);
    if (Number(y) < fromYear) continue;
    const list = byYear.get(y) ?? [];
    list.push(o);
    byYear.set(y, list);
  }
  return [...byYear.keys()].sort().map((y) => observationRow(m, y, byYear.get(y)!, asOf));
}

export type SeriesSummary = {
  /** Years with a stored observation row, ascending. */
  years: string[];
  /** Latest observation with a value. */
  latest: Observation | null;
};

const fmtObs = (o: Observation | null, units: string) =>
  o && o.value !== null ? `${o.value} ${units} (${o.date}; current value since ${o.vintage})` : NOT_RECORDED;

export function seriesRow(
  spec: FredSpec,
  meta: FredSeriesMeta,
  release: FredRelease | null,
  sources: FredSource[],
  summary: SeriesSummary,
  asOf: string,
): CorpusRow {
  const rid = seriesRowId(spec.id);
  const sourceNames = sources.map((s) => s.name).join("; ");
  const links: JsonObject[] = [
    { url: seriesPage(spec.id), label: "Series on FRED" },
    { url: alfredPage(spec.id), label: "Vintages on ALFRED" },
  ];
  if (release?.link && /^https?:\/\//.test(release.link))
    links.push({ url: release.link, label: `Release: ${release.name}` });
  for (const s of sources)
    if (s.link && /^https?:\/\//.test(s.link)) links.push({ url: s.link, label: `Source: ${s.name}` });
  const period = `${meta.observation_start} to ${meta.observation_end}`;
  const facts: [string, string][] = [
    ["Title (as published)", meta.title],
    ["Series ID", spec.id],
    ["Use here", spec.purpose],
    ["Units", meta.units],
    ["Frequency", meta.frequency],
    ["Seasonal adjustment", meta.seasonal_adjustment],
    ["Observation period (FRED)", period],
    ["Latest observation", fmtObs(summary.latest, meta.units_short)],
    ["Stored years", summary.years.length ? `${summary.years[0]} to ${summary.years.at(-1)} (${summary.years.length} year rows)` : NOT_RECORDED],
    ["FRED last updated", meta.last_updated],
    ["Release", release ? release.name : NOT_RECORDED],
    ["Source", sourceNames || NOT_RECORDED],
    ["Vintage basis", VINTAGE_BASIS],
    ["Notes (FRED)", meta.notes?.trim() ? meta.notes.trim() : NOT_RECORDED],
    ["Notice", `${FRED_NOTICE} Terms of use: ${FRED_TERMS_URL}`],
  ];
  return corpusRecord(SERIES_DATASET, rid, meta.title, {
    source_url: seriesPage(spec.id),
    subtitle: `${spec.label} · ${meta.frequency}, ${meta.units}`,
    state: spec.state ?? "",
    cells: {
      series_id: spec.id,
      label: spec.label,
      group: GROUP_LABELS[spec.group],
      frequency: meta.frequency_short,
      units: meta.units_short,
      seasonal_adjustment: meta.seasonal_adjustment_short,
      period,
      latest: summary.latest?.value ?? NOT_RECORDED,
      latest_date: summary.latest?.date ?? NOT_RECORDED,
    },
    facts,
    links,
    text: `${spec.label} ${meta.title} ${spec.purpose} ${sourceNames} ${release?.name ?? ""}`,
    filters: {
      group: [spec.group],
      frequency: [meta.frequency_short],
      seasonal_adjustment: [meta.seasonal_adjustment_short],
      ...(spec.state ? { state: [spec.state] } : {}),
    },
    extra: {
      kind: "series",
      fred: {
        series_id: spec.id,
        label: spec.label,
        group: spec.group,
        purpose: spec.purpose,
        state: spec.state ?? null,
        title: meta.title,
        units: meta.units,
        units_short: meta.units_short,
        frequency: meta.frequency,
        frequency_short: meta.frequency_short,
        seasonal_adjustment: meta.seasonal_adjustment,
        seasonal_adjustment_short: meta.seasonal_adjustment_short,
        observation_start: meta.observation_start,
        observation_end: meta.observation_end,
        last_updated: meta.last_updated,
        notes: meta.notes,
        release: release as unknown as Json,
        sources: sources as unknown as Json[],
        latest: summary.latest ? (toTuple(summary.latest) as unknown as Json) : null,
        years: summary.years,
        as_of: asOf,
      },
    },
  });
}

/** The series metadata a stored series row was built from (item.fred). */
export function storedMeta(f: JsonObject): {
  meta: FredSeriesMeta;
  release: FredRelease | null;
  sources: FredSource[];
} | null {
  const need = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : null);
  const id = need("series_id");
  if (!id) return null;
  const meta: FredSeriesMeta = {
    id,
    title: need("title") ?? "",
    observation_start: need("observation_start") ?? "",
    observation_end: need("observation_end") ?? "",
    frequency: need("frequency") ?? "",
    frequency_short: need("frequency_short") ?? "",
    units: need("units") ?? "",
    units_short: need("units_short") ?? "",
    seasonal_adjustment: need("seasonal_adjustment") ?? "",
    seasonal_adjustment_short: need("seasonal_adjustment_short") ?? "",
    last_updated: need("last_updated") ?? "",
    notes: need("notes"),
  };
  const r = f["release"] as JsonObject | null | undefined;
  const release =
    r && typeof r["id"] === "number" && typeof r["name"] === "string"
      ? { id: r["id"], name: r["name"], link: typeof r["link"] === "string" ? r["link"] : null }
      : null;
  const sources = (Array.isArray(f["sources"]) ? (f["sources"] as JsonObject[]) : [])
    .filter((s) => typeof s["id"] === "number" && typeof s["name"] === "string")
    .map((s) => ({
      id: s["id"] as number,
      name: s["name"] as string,
      link: typeof s["link"] === "string" ? (s["link"] as string) : null,
    }));
  return { meta, release, sources };
}

/** Capture dates are provenance a rebuild restates; masked so an unchanged series or year is never rewritten. */
export function comparableFred(content: Parameters<SourceAdapter["comparable"]>[0]): Json {
  return maskPath(content as unknown as Json, ["item", "fred", "as_of"]);
}

// ------------------------------------------------------------------------------------------------ fetching

/** FRED refuses a JSON observations request whose real-time period holds more than 2,000 vintage dates. */
export const MAX_VINTAGES = 1900;

/** Real-time windows of at most `size` vintage dates covering `start` to 9999-12-31 (the last window ends there). */
export function vintageWindows(vintageDates: string[], start: string, size = MAX_VINTAGES): { start: string; end: string }[] {
  const dates = [...new Set(vintageDates.filter((d) => ISO.test(d) && d >= start))].sort();
  const out: { start: string; end: string }[] = [];
  let from = start;
  for (let i = size; i < dates.length; i += size) {
    out.push({ start: from, end: addDays(dates[i]!, -1) });
    from = dates[i]!;
  }
  out.push({ start: from, end: ALL_REALTIME.end });
  return out;
}

async function fetchWindow(
  http: SourceHttp,
  key: string,
  seriesId: string,
  start: string,
  realtime: { start: string; end: string },
  end?: string,
): Promise<RawObservation[]> {
  const out: RawObservation[] = [];
  let offset = 0;
  for (;;) {
    const params: Record<string, string | number> = {
      series_id: seriesId,
      realtime_start: realtime.start,
      realtime_end: realtime.end,
      observation_start: start,
      sort_order: "asc",
      limit: 100000,
      offset,
    };
    if (end) params["observation_end"] = end;
    const url = fredUrl("series/observations", params);
    const res = await http.getText(keyed(url, key), { recordUrl: url });
    if (res.status !== 200) {
      fredJson(res.text, `series/observations HTTP ${res.status}`);
      throw new SourceError(`FRED series/observations: HTTP ${res.status}`, res.status);
    }
    const page = parseObservationPage(res.text);
    out.push(...page.observations);
    offset += page.observations.length;
    if (!page.observations.length || offset >= page.count) return out;
  }
}

/** Vintage dates of a series on or after `start` (fred/series/vintagedates, paged). */
export async function fetchVintageDates(http: SourceHttp, key: string, seriesId: string, start: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; ) {
    const url = fredUrl("series/vintagedates", {
      series_id: seriesId,
      realtime_start: start,
      realtime_end: ALL_REALTIME.end,
      limit: 10000,
      offset,
    });
    const doc = fredJson(await getJson(http, key, url, "series/vintagedates"), "series/vintagedates");
    const list = Array.isArray(doc["vintage_dates"]) ? (doc["vintage_dates"] as Json[]).filter((d): d is string => typeof d === "string") : [];
    out.push(...list);
    offset += list.length;
    if (!list.length || offset >= Number(doc["count"] ?? 0)) return out;
  }
}

/**
 * Every observation of a series dated `start` or later, with every vintage published since `start` (no value for a date
 * can be published before the date, so nothing is cut off). A real-time period holding more vintage dates than FRED
 * serves at once is read in windows; the windows' rows are merged by date (currentObservations joins a value's runs).
 */
export async function fetchObservations(
  http: SourceHttp,
  key: string,
  seriesId: string,
  start: string,
  end?: string,
): Promise<RawObservation[]> {
  try {
    return await fetchWindow(http, key, seriesId, start, { start, end: ALL_REALTIME.end }, end);
  } catch (error) {
    if (!(error instanceof SourceError && /vintage dates/i.test(error.message))) throw error;
  }
  const out: RawObservation[] = [];
  for (const w of vintageWindows(await fetchVintageDates(http, key, seriesId, start), start))
    out.push(...(await fetchWindow(http, key, seriesId, start, w, end)));
  return out;
}

async function getJson(http: SourceHttp, key: string, url: string, what: string): Promise<string> {
  const res = await http.getText(keyed(url, key), { recordUrl: url });
  if (res.status !== 200) {
    fredJson(res.text, `${what} HTTP ${res.status}`);
    throw new SourceError(`FRED ${what}: HTTP ${res.status}`, res.status);
  }
  return res.text;
}

export const fetchSeriesMeta = async (http: SourceHttp, key: string, id: string) =>
  parseSeriesMeta(await getJson(http, key, fredUrl("series", { series_id: id }), "series"));
export const fetchRelease = async (http: SourceHttp, key: string, id: string) =>
  parseRelease(await getJson(http, key, fredUrl("series/release", { series_id: id }), "series/release"));
export const fetchSources = async (http: SourceHttp, key: string, releaseId: number) =>
  parseSources(
    await getJson(http, key, fredUrl("release/sources", { release_id: releaseId }), "release/sources"),
  );
export const fetchReleaseDates = async (http: SourceHttp, key: string, releaseId: number, since: string) =>
  parseReleaseDates(
    await getJson(
      http,
      key,
      fredUrl("release/dates", {
        release_id: releaseId,
        realtime_start: since,
        include_release_dates_with_no_data: "false",
        sort_order: "asc",
        limit: 1000,
      }),
      "release/dates",
    ),
  );

// ------------------------------------------------------------------------------------------------ scheduling (pure)

const DAY = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const isHighFrequency = (freqShort: string) => /^(D|W|BW)/.test(freqShort);

/** First observation date a refresh rereads (1 January of that year, so every rebuilt year row is complete). */
export function lookbackStart(freqShort: string, through: string | null, observationStart: string): string {
  if (!through || !ISO.test(through)) return `${observationStart.slice(0, 4)}-01-01`;
  if (isHighFrequency(freqShort)) return `${addDays(through, -31).slice(0, 4)}-01-01`;
  return `${Number(through.slice(0, 4)) - 5}-01-01`;
}

/** Whether the period after the one starting `through` (FRED dates a monthly/quarterly/annual value by its first day) has ended before `today`. */
export function nextPeriodEnded(freqShort: string, through: string | null, today: string): boolean {
  if (!through || !ISO.test(through)) return true;
  if (isHighFrequency(freqShort)) return true;
  const months = freqShort.startsWith("Q") ? 3 : freqShort.startsWith("SA") ? 6 : freqShort.startsWith("A") ? 12 : 1;
  const d = new Date(`${through}T00:00:00Z`);
  // end of the next period = start + 2 periods - 1 day
  const endNext = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2 * months, 1) - DAY);
  return today > endNext.toISOString().slice(0, 10);
}

export type SeriesState = {
  /** Last observation date stored (or the series metadata's observation_end). */
  through: string | null;
  /** Latest release date known when the series was last read (initially the date FRED last updated it). */
  seen: string;
  /** Date of the last read. */
  fetched: string;
};
export type ObsCursor = { series: Record<string, SeriesState>; releases_checked: string | null };

/** Series a run should read, in spec order. Pure. */
export function dueSeries(args: {
  order: readonly string[];
  stored: ReadonlyMap<string, { frequency_short: string; release_id: number | null }>;
  state: Readonly<Record<string, SeriesState>>;
  releaseDates: ReadonlyMap<number, string[]>;
  today: string;
}): string[] {
  const out: string[] = [];
  for (const id of args.order) {
    const st = args.stored.get(id);
    if (!st) continue; // no series row yet: the series source writes it first
    const s = args.state[id];
    if (!s) {
      out.push(id);
      continue;
    }
    const high = isHighFrequency(st.frequency_short);
    const sweep = daysBetween(s.fetched, args.today) >= (high ? 7 : 35);
    const dates = st.release_id === null ? [] : (args.releaseDates.get(st.release_id) ?? []);
    const released = dates.some((d) => d > s.seen);
    if (sweep || (released && (high || nextPeriodEnded(st.frequency_short, s.through, args.today))))
      out.push(id);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ adapters

const today = (now: Date) => now.toISOString().slice(0, 10);

type StoredSeries = {
  id: string;
  fred: JsonObject;
};

async function readStoredSeries(ctx: CollectContext): Promise<StoredSeries[]> {
  const rows = await ctx.corpus.query(
    `corpus_records?select=id,f:item->fred&dataset=eq.${SERIES_DATASET}&order=id.asc&limit=1000`,
  );
  return rows
    .filter((r) => typeof r["id"] === "string" && r["f"] && typeof r["f"] === "object")
    .map((r) => ({ id: String(r["id"]).replace(/^fred:/, ""), fred: r["f"] as JsonObject }));
}

const lastUpdatedDate = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "1970-01-01");

export const fredObservations: SourceAdapter = {
  source: "fred_observations",
  dataset: OBS_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-fred",
  limits: { maxRequests: 60, minIntervalMs: 600 },
  secrets: ["FRED_API_KEY"],

  async collect(ctx: CollectContext): Promise<Collected> {
    const key = ctx.env("FRED_API_KEY");
    if (!key) throw new Error("FRED_API_KEY is not set for this function");
    const day = today(ctx.now);
    const stored = await readStoredSeries(ctx);
    if (!stored.length) throw new Error(`${SERIES_DATASET} holds no series rows; publish the full build first`);
    const byId = new Map(stored.map((s) => [s.id, s]));
    const cursorIn = (ctx.cursor ?? {}) as JsonObject;
    const state: Record<string, SeriesState> = {
      ...((cursorIn["series"] as Record<string, SeriesState> | undefined) ?? {}),
    };
    // a series never read by a scheduled run starts from what the full build stored
    for (const s of stored) {
      if (state[s.id]) continue;
      const through = typeof s.fred["observation_end"] === "string" ? String(s.fred["observation_end"]) : null;
      const seen = lastUpdatedDate(String(s.fred["last_updated"] ?? ""));
      state[s.id] = { through, seen, fetched: seen };
    }
    const meta = new Map<string, { frequency_short: string; release_id: number | null }>();
    for (const s of stored) {
      const rel = s.fred["release"] as JsonObject | null;
      meta.set(s.id, {
        frequency_short: String(s.fred["frequency_short"] ?? ""),
        release_id: rel && typeof rel["id"] === "number" ? (rel["id"] as number) : null,
      });
    }

    const notes: JsonObject = {};
    const held: HeldRecord[] = [];
    let complete = true;
    let stopped: string | null = null;
    const releaseDates = new Map<number, string[]>();
    const releases = [...new Set([...meta.values()].map((m) => m.release_id).filter((r): r is number => r !== null))];
    try {
      for (const r of releases.sort((a, b) => a - b)) {
        const seen = stored
          .filter((s) => meta.get(s.id)?.release_id === r)
          .map((s) => state[s.id]!.seen)
          .sort()[0];
        const since = [seen ?? addDays(day, -60), addDays(day, -60)].sort().at(-1)!;
        releaseDates.set(r, await fetchReleaseDates(ctx.http, key, r, since));
      }
    } catch (error) {
      if (error instanceof BudgetExhausted || error instanceof RateLimited) {
        return {
          rows: [],
          fetched: 0,
          held,
          cursorAfter: { series: state, releases_checked: (cursorIn["releases_checked"] as string) ?? null } as unknown as Json,
          complete: false,
          notes: { stopped: error.message },
        };
      }
      throw error;
    }
    notes["release_dates"] = Object.fromEntries(
      [...releaseDates].map(([r, d]) => [String(r), d.length ? `${d[0]} to ${d.at(-1)} (${d.length})` : "none"]),
    );

    const order = FRED_SERIES.map((s) => s.id).filter((id) => byId.has(id));
    const due = dueSeries({ order, stored: meta, state, releaseDates, today: day });
    notes["due"] = due.length;
    const rows: CorpusRow[] = [];
    let fetched = 0;
    const read: string[] = [];
    for (const id of due) {
      const spec = SPEC_BY_ID.get(id)!;
      const sm = storedMeta(byId.get(id)!.fred);
      if (!sm) {
        held.push({ key: id, reason: "stored series row has no metadata" });
        continue;
      }
      const st = state[id]!;
      const start = lookbackStart(sm.meta.frequency_short, st.through, sm.meta.observation_start);
      let raw: RawObservation[];
      try {
        raw = await fetchObservations(ctx.http, key, id, start);
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          stopped = error.message;
          break;
        }
        throw error;
      }
      const obs = currentObservations(raw);
      fetched += obs.length;
      rows.push(...observationRows(obsMetaOf(spec, sm.meta), obs, day, Number(start.slice(0, 4))));
      const withValue = obs.filter((o) => o.value !== null);
      const latestRelease = (releaseDates.get(meta.get(id)!.release_id ?? -1) ?? []).at(-1);
      state[id] = {
        through: withValue.at(-1)?.date ?? obs.at(-1)?.date ?? st.through,
        seen: [st.seen, latestRelease ?? st.seen].sort().at(-1)!,
        fetched: day,
      };
      read.push(id);
    }
    notes["read"] = read.length;
    if (due.length > read.length) notes["still_due"] = due.slice(read.length).join(",").slice(0, 900);
    if (stopped) notes["stopped"] = stopped;
    return {
      rows,
      fetched,
      held,
      cursorAfter: { series: state, releases_checked: day } as unknown as Json,
      complete,
      notes,
    };
  },

  comparable: comparableFred,
};

/** Series metadata reread per run (rotating), so every series is refreshed every few days. */
export const SERIES_PER_RUN = 30;

export const fredSeries: SourceAdapter = {
  source: "fred_series",
  dataset: SERIES_DATASET,
  mode: "upsert",
  ordinalPolicy: "append",
  functionName: "ingest-fred",
  limits: { maxRequests: SERIES_PER_RUN + 12, minIntervalMs: 600 },
  secrets: ["FRED_API_KEY"],

  async collect(ctx: CollectContext): Promise<Collected> {
    const key = ctx.env("FRED_API_KEY");
    if (!key) throw new Error("FRED_API_KEY is not set for this function");
    const day = today(ctx.now);
    const stored = new Map((await readStoredSeries(ctx)).map((s) => [s.id, s]));
    // observation row ids (paged: PostgREST returns at most 1,000 rows per request)
    const obsIds: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await ctx.corpus.query(
        `corpus_records?select=id&dataset=eq.${OBS_DATASET}&order=id.asc&limit=1000&offset=${offset}`,
      );
      obsIds.push(...page.map((r) => String(r["id"])));
      if (page.length < 1000) break;
    }
    const years = new Map<string, string[]>();
    for (const rid of obsIds) {
      const m = /^fred:([A-Z0-9]+):(\d{4})$/.exec(rid);
      if (!m) continue;
      const list = years.get(m[1]!) ?? [];
      list.push(m[2]!);
      years.set(m[1]!, list);
    }
    // latest stored observation of each series: its last year row, else the one before (a new year may hold only ".")
    const latest = new Map<string, Observation | null>();
    const lastRows = [...years].flatMap(([id, ys]) => ys.sort().slice(-2).map((y) => obsRowId(id, y)));
    for (let i = 0; i < lastRows.length; i += 40) {
      const chunk = lastRows.slice(i, i + 40);
      const rows = await ctx.corpus.query(
        `corpus_records?select=id,o:item->fred->obs&dataset=eq.${OBS_DATASET}&id=in.(${chunk.map((x) => `"${x}"`).join(",")})`,
      );
      for (const r of rows.sort((a, b) => (String(a["id"]) < String(b["id"]) ? -1 : 1))) {
        const id = String(r["id"]).split(":")[1]!;
        const obs = (Array.isArray(r["o"]) ? (r["o"] as Json[]) : [])
          .map(fromTuple)
          .filter((o): o is Observation => o !== null && o.value !== null);
        if (obs.length) latest.set(id, obs.at(-1)!);
      }
    }

    const cursorIn = (ctx.cursor ?? {}) as JsonObject;
    const start = typeof cursorIn["next"] === "number" ? (cursorIn["next"] as number) : 0;
    const order = FRED_SERIES.map((s) => s.id);
    const rotation: string[] = [];
    // series without a stored row first, then the rotating slice
    for (const id of order) if (!stored.has(id)) rotation.push(id);
    for (let k = 0; k < order.length && rotation.length < SERIES_PER_RUN; k++) {
      const id = order[(start + k) % order.length]!;
      if (!rotation.includes(id)) rotation.push(id);
    }

    const held: HeldRecord[] = [];
    const fresh = new Map<string, { meta: FredSeriesMeta; release: FredRelease | null; sources: FredSource[] }>();
    const sourcesByRelease = new Map<number, FredSource[]>();
    for (const s of stored.values()) {
      const sm = storedMeta(s.fred);
      if (sm?.release) sourcesByRelease.set(sm.release.id, sm.sources);
    }
    let complete = true;
    let stopped: string | null = null;
    let advanced = 0;
    for (const id of rotation) {
      try {
        const meta = await fetchSeriesMeta(ctx.http, key, id);
        if (meta.id !== id) throw new SourceError(`FRED returned series ${meta.id} for ${id}`, 0);
        if (isRestricted(meta)) {
          held.push({ key: id, reason: "FRED notes mark the series as copyrighted by a third party; not published" });
          advanced++;
          continue;
        }
        const prev = stored.has(id) ? storedMeta(stored.get(id)!.fred) : null;
        let release = prev?.release ?? null;
        if (!release) release = await fetchRelease(ctx.http, key, id);
        let sources = sourcesByRelease.get(release.id);
        if (!sources) {
          sources = await fetchSources(ctx.http, key, release.id);
          sourcesByRelease.set(release.id, sources);
        }
        fresh.set(id, { meta, release, sources });
        advanced++;
      } catch (error) {
        if (error instanceof BudgetExhausted || error instanceof RateLimited) {
          complete = false;
          stopped = error.message;
          break;
        }
        throw error;
      }
    }

    const rows: CorpusRow[] = [];
    for (const spec of FRED_SERIES) {
      const f = fresh.get(spec.id);
      const s = stored.get(spec.id);
      const base = f ?? (s ? storedMeta(s.fred) : null);
      if (!base) continue;
      if (isRestricted(base.meta)) continue;
      const asOf = f ? day : String(s?.fred["as_of"] ?? day);
      rows.push(
        seriesRow(
          spec,
          base.meta,
          base.release,
          base.sources,
          {
            years: (years.get(spec.id) ?? []).slice().sort(),
            latest: latest.get(spec.id) ?? null,
          },
          asOf,
        ),
      );
    }
    const newSeries = order.filter((id) => !stored.has(id)).length;
    const nextIndex = (start + Math.max(0, advanced - newSeries)) % order.length;
    return {
      rows,
      fetched: fresh.size,
      held,
      cursorAfter: { next: nextIndex, checked: day } as unknown as Json,
      complete,
      notes: {
        metadata_read: fresh.size,
        rotation_start: start,
        observation_rows: obsIds.length,
        ...(stopped ? { stopped } : {}),
      },
    };
  },

  comparable: comparableFred,
};

export const FRED_ADAPTERS: readonly SourceAdapter[] = [fredObservations, fredSeries];
