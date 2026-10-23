import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonical } from "../rows.ts";
import { runSource } from "../runner.ts";
import type { CorpusClient } from "../corpus.ts";
import type { CorpusRow, JsonObject, RequestRecord, SourceHttp, StoredRow } from "../types.ts";
import {
  comparableFred,
  currentObservations,
  dueSeries,
  fredObservations,
  fredSeries,
  fredUrl,
  fromTuple,
  isRestricted,
  lookbackStart,
  nextPeriodEnded,
  observationRows,
  obsMetaOf,
  OBS_DATASET,
  parseObservationPage,
  parseRelease,
  parseReleaseDates,
  parseSeriesMeta,
  parseSources,
  seriesRow,
  SERIES_DATASET,
  vintageWindows,
  type RawObservation,
} from "./fred.ts";
import { FRED_SERIES, SPEC_BY_ID, UR_STATES } from "./fredSpec.ts";

type Fixture = { url: string; body: unknown };
const FX = JSON.parse(
  readFileSync(new URL("../fixtures/fred/responses.json", import.meta.url), "utf8"),
) as Record<string, Fixture>;
const text = (name: string) => JSON.stringify(FX[name]!.body);
const raw = (name: string) => parseObservationPage(text(name)).observations;

/** Same endpoint and parameters (order-free; the key is never part of the comparison). */
function sameRequest(a: string, b: string) {
  const ua = new URL(a);
  const ub = new URL(b);
  if (ua.pathname !== ub.pathname) return false;
  const pa = [...ua.searchParams].filter(([k]) => k !== "api_key").sort().join("&");
  const pb = [...ub.searchParams].filter(([k]) => k !== "api_key").sort().join("&");
  return pa === pb;
}

function fakeHttp(responses: Fixture[], maxRequests = 100): SourceHttp & { urls: string[] } {
  const requests: RequestRecord[] = [];
  const urls: string[] = [];
  let used = 0;
  return {
    urls,
    requests,
    get remaining() {
      return maxRequests - used;
    },
    async getText(url, init = {}) {
      if (used >= maxRequests) {
        const { BudgetExhausted } = await import("../http.ts");
        throw new BudgetExhausted();
      }
      used++;
      urls.push(init.recordUrl ?? url);
      expect(init.recordUrl ?? "", "recorded URL never carries the key").not.toMatch(/api_key/);
      const hit = responses.find((r) => sameRequest(r.url, url));
      if (!hit) return { status: 400, text: JSON.stringify({ error_code: 400, error_message: `no fixture for ${new URL(url).pathname}` }), record: { url, status: 400, bytes: 0, sha256: "", retrieved_at: "" } };
      const body = JSON.stringify(hit.body);
      const record = { url: init.recordUrl ?? url, status: 200, bytes: body.length, sha256: "x", retrieved_at: "2026-10-23T00:00:00Z" };
      requests.push(record);
      return { status: 200, text: body, record };
    },
  };
}

describe("parsing", () => {
  it("reads series metadata, release, sources and release dates as published", () => {
    const m = parseSeriesMeta(text("meta_WGS1YR"));
    expect(m.id).toBe("WGS1YR");
    expect(m.frequency_short).toBe("W");
    expect(m.units_short).toBe("%");
    expect(m.seasonal_adjustment_short).toBe("NSA");
    expect(m.title).toMatch(/1-Year Constant Maturity/);
    expect(parseRelease(text("release_WGS1YR"))).toMatchObject({ id: 18, name: "H.15 Selected Interest Rates" });
    expect(parseSources(text("sources_18"))[0]!.name).toMatch(/Board of Governors/);
    const cpiDates = parseReleaseDates(text("dates_10"));
    expect(cpiDates).toContain("2026-10-14");
    expect(cpiDates).toEqual([...cpiDates].sort());
  });

  it("turns FRED error bodies into errors without echoing the request", () => {
    expect(() => parseSeriesMeta(JSON.stringify({ error_code: 400, error_message: "Bad Request.  The series does not exist." }))).toThrow(/does not exist/);
    expect(() => parseObservationPage("<html>")).toThrow(/not JSON/);
    expect(() =>
      parseObservationPage(JSON.stringify({ observations: [{ realtime_start: "2020-01-01", realtime_end: "9999-12-31", date: "2020-01-01", value: "abc" }] })),
    ).toThrow(/not a number/);
  });

  it("flags third-party copyrighted series", () => {
    expect(isRestricted({ title: "Moody's Seasoned Aaa", notes: "Copyright, 2024, Moody's" })).toBe(true);
    expect(isRestricted(parseSeriesMeta(text("meta_WGS1YR")))).toBe(false);
  });
});

describe("current observations and vintages", () => {
  it("keeps the weekly 1-year rate exactly as published, with its release date as vintage", () => {
    const obs = currentObservations(raw("obs_WGS1YR_2026"));
    const oct9 = obs.find((o) => o.date === "2026-10-09")!;
    // uscourts.gov district tables: week ending 10/09/2026 -> 4.45% (judgments 10/12/2026 to 10/18/2026)
    expect(oct9).toEqual({ date: "2026-10-09", value: "4.45", vintage: "2026-10-13" });
    expect(obs.find((o) => o.date === "2026-01-02")!.value).toBe("3.48");
    expect(obs.find((o) => o.date === "2026-10-02")!.value).toBe("4.52");
  });

  it("keeps BLS's 2016 CPI-U corrections: current value plus the first published value", () => {
    const obs = currentObservations(raw("obs_CPIAUCNS_2016"));
    const may = obs.find((o) => o.date === "2016-05-01")!;
    expect(may.value).toBe("240.229");
    expect(may.firstValue).toBe("240.236");
    expect(may.firstVintage).toBe("2016-06-16");
    expect(may.vintage).toBe("2016-10-18");
    expect(obs.find((o) => o.date === "2016-01-01")!.firstVintage).toBeUndefined();
  });

  it("keeps a month BLS never published as null (October 2025, lapse in appropriations)", () => {
    const oct = currentObservations(raw("obs_CPIAUCNS_2025")).find((o) => o.date === "2025-10-01")!;
    expect(oct.value).toBeNull();
  });

  it("merges a value's runs (also across windows) and drops dates missing from the current vintage", () => {
    const r = (date: string, value: string, start: string, end: string): RawObservation => ({ date, value, realtime_start: start, realtime_end: end });
    const obs = currentObservations([
      r("2020-01-01", "1.0", "2020-02-01", "2020-05-31"),
      r("2020-01-01", "1.1", "2020-06-01", "2021-12-31"),
      r("2020-01-01", "1.1", "2022-01-01", "9999-12-31"), // window split, same value
      r("2020-02-01", "2.0", "2020-03-01", "2020-12-31"), // withdrawn
      r("2020-03-01", ".", "2020-04-01", "9999-12-31"),
    ]);
    expect(obs).toEqual([
      { date: "2020-01-01", value: "1.1", vintage: "2020-06-01", firstValue: "1.0", firstVintage: "2020-02-01" },
      { date: "2020-03-01", value: null, vintage: "2020-04-01" },
    ]);
  });

  it("splits a long real-time history into windows FRED accepts", () => {
    const dates = Array.from({ length: 4000 }, (_, i) => new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString().slice(0, 10));
    const w = vintageWindows(dates, "1999-06-01");
    expect(w.length).toBe(3);
    expect(w[0]).toEqual({ start: "1999-06-01", end: dates[1899] });
    expect(w[1]!.start).toBe(dates[1900]);
    expect(w.at(-1)!.end).toBe("9999-12-31");
    expect(vintageWindows([], "2020-01-01")).toEqual([{ start: "2020-01-01", end: "9999-12-31" }]);
  });

  it("round-trips the stored tuple form", () => {
    for (const o of currentObservations(raw("obs_CPIAUCSL_2023"))) {
      const t = observationRows(obsMetaOf(SPEC_BY_ID.get("CPIAUCSL")!, parseSeriesMeta(text("meta_CPIAUCSL"))), [o], "2026-10-23")[0]!;
      const back = fromTuple((t.item["fred"] as JsonObject)["obs"]![0] as never);
      expect(back).toEqual(o);
    }
  });
});

describe("rows", () => {
  const meta = parseSeriesMeta(text("meta_WGS1YR"));
  const spec = SPEC_BY_ID.get("WGS1YR")!;
  const obs = currentObservations(raw("obs_WGS1YR_2026"));

  it("builds one row per year with the corpus shape and source facts", () => {
    const rows = observationRows(obsMetaOf(spec, meta), obs, "2026-10-23");
    expect(rows.map((r) => r.id)).toEqual(["fred:WGS1YR:2026"]);
    const r = rows[0]!;
    expect(r.dataset).toBe(OBS_DATASET);
    expect(r.category).toBe(OBS_DATASET);
    expect(r.source_url).toBe("https://fred.stlouisfed.org/series/WGS1YR");
    expect(r.filters).toEqual({ _listing: ["yes"], series: ["WGS1YR"], year: ["2026"], group: ["judgment_rate"] });
    expect((r.item["fred"] as JsonObject)["obs"]).toContainEqual(["2026-10-09", "4.45", "2026-10-13"]);
    expect(JSON.stringify(r)).not.toMatch(/api_key/);
    expect(r.id).toMatch(/^fred:[A-Z0-9]{2,30}(:[0-9]{4})?$/);
  });

  it("builds the series row with metadata as published and the latest observation", () => {
    const row = seriesRow(
      spec,
      meta,
      parseRelease(text("release_WGS1YR")),
      parseSources(text("sources_18")),
      { years: ["2026"], latest: obs.at(-1)! },
      "2026-10-23",
    );
    expect(row.id).toBe("fred:WGS1YR");
    expect(row.dataset).toBe(SERIES_DATASET);
    const facts = Object.fromEntries((row.detail["facts"] as [string, string][]).map(([k, v]) => [k, v]));
    expect(facts["Units"]).toBe("Percent");
    expect(facts["Release"]).toBe("H.15 Selected Interest Rates");
    expect(facts["Use here"]).toMatch(/28 U\.S\.C\. § 1961\(a\)/);
    expect(facts["Notice"]).toMatch(/not endorsed or certified by the Federal Reserve Bank of St\. Louis/);
    expect(facts["Latest observation"]).toMatch(/^4\.49 % \(2026-10-16;/);
  });

  it("masks only the capture date when comparing", () => {
    const [a] = observationRows(obsMetaOf(spec, meta), obs, "2026-10-23");
    const [b] = observationRows(obsMetaOf(spec, meta), obs, "2026-10-24");
    const content = (r: CorpusRow) => ({ ...r, county_geoids: [] }) as never;
    expect(canonical(comparableFred(content(a!)))).toBe(canonical(comparableFred(content(b!))));
    const [c] = observationRows(obsMetaOf(spec, meta), obs.slice(0, -1), "2026-10-23");
    expect(canonical(comparableFred(content(a!)))).not.toBe(canonical(comparableFred(content(c!))));
  });
});

describe("spec", () => {
  it("lists unique ids, every state and DC once, and no third-party series", () => {
    const ids = FRED_SERIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FRED_SERIES.filter((s) => s.group === "state_unemployment").length).toBe(UR_STATES.length);
    expect(UR_STATES.length).toBe(52);
    expect(ids).not.toContain("AAA");
    expect(ids).not.toContain("BAA");
    for (const s of FRED_SERIES) expect(s.id).toMatch(/^[A-Z0-9]{2,30}$/);
  });
});

describe("scheduling", () => {
  it("rereads from 1 January: last month for daily/weekly, five years back for monthly/quarterly", () => {
    expect(lookbackStart("W", "2026-10-16", "1962-01-05")).toBe("2026-01-01");
    expect(lookbackStart("D", "2027-01-05", "1962-01-02")).toBe("2026-01-01");
    expect(lookbackStart("M", "2026-09-01", "1913-01-01")).toBe("2021-01-01");
    expect(lookbackStart("Q", null, "2001-01-01")).toBe("2001-01-01");
  });

  it("expects a new monthly or quarterly value only after the next period ends", () => {
    expect(nextPeriodEnded("M", "2026-08-01", "2026-09-30")).toBe(false);
    expect(nextPeriodEnded("M", "2026-08-01", "2026-10-01")).toBe(true);
    expect(nextPeriodEnded("Q", "2026-04-01", "2026-09-30")).toBe(false);
    expect(nextPeriodEnded("Q", "2026-04-01", "2026-10-01")).toBe(true);
    expect(nextPeriodEnded("D", "2026-10-21", "2026-10-21")).toBe(true);
  });

  it("marks a series due after its release publishes again", () => {
    const stored = new Map([
      ["WGS1YR", { frequency_short: "W", release_id: 18 }],
      ["GS10", { frequency_short: "M", release_id: 18 }],
      ["CPIAUCNS", { frequency_short: "M", release_id: 10 }],
    ]);
    const state = {
      WGS1YR: { through: "2026-10-09", seen: "2026-10-19", fetched: "2026-10-19" },
      GS10: { through: "2026-09-01", seen: "2026-10-19", fetched: "2026-10-19" },
      CPIAUCNS: { through: "2026-08-01", seen: "2026-09-11", fetched: "2026-09-25" },
    };
    const releaseDates = new Map([
      [18, ["2026-10-19", "2026-10-20", "2026-10-21"]],
      [10, ["2026-09-11", "2026-10-14"]],
    ]);
    expect(dueSeries({ order: ["WGS1YR", "GS10", "CPIAUCNS"], stored, state, releaseDates, today: "2026-10-22" })).toEqual(["WGS1YR", "CPIAUCNS"]);
    // nothing new: only the safety interval brings a series back
    const quiet = new Map([[18, ["2026-10-19"]], [10, ["2026-09-11"]]]);
    expect(dueSeries({ order: ["WGS1YR", "GS10", "CPIAUCNS"], stored, state, releaseDates: quiet, today: "2026-10-22" })).toEqual([]);
    expect(dueSeries({ order: ["WGS1YR"], stored, state, releaseDates: quiet, today: "2026-10-26" })).toEqual(["WGS1YR"]);
    // a series with no series row yet is left to the series source
    expect(dueSeries({ order: ["UNRATE"], stored, state, releaseDates, today: "2026-10-22" })).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ adapters (dry run)

function fakeCorpus(rows: Record<string, CorpusRow[]>): CorpusClient {
  const all = () => Object.values(rows).flat();
  const asStored = (r: CorpusRow, i: number) => ({ ...r, ordinal: i }) as StoredRow;
  return {
    async rowsBy(dataset, column, values) {
      return (rows[dataset] ?? []).map(asStored).filter((r) => values.includes(column === "id" ? r.id : r.source_url));
    },
    async edge() {
      return [];
    },
    async query(q: string) {
      const u = new URL("http://x/" + q);
      const dataset = u.searchParams.get("dataset")!.replace(/^eq\./, "");
      let list = (rows[dataset] ?? []).slice();
      const id = u.searchParams.get("id");
      if (id?.startsWith("in.(")) {
        const ids = id.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, ""));
        list = list.filter((r) => ids.includes(r.id));
      }
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const limit = Number(u.searchParams.get("limit") ?? 1000);
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
      const select = u.searchParams.get("select") ?? "";
      return list.slice(offset, offset + limit).map((r) => {
        const out: JsonObject = { id: r.id };
        if (select.includes("f:item->fred")) out["f"] = r.item["fred"]!;
        if (select.includes("o:item->fred->obs")) out["o"] = (r.item["fred"] as JsonObject)["obs"]!;
        return out;
      });
    },
    async rpc() {
      throw new Error("no rpc in a dry run");
    },
    async call() {
      throw new Error("no rpc in a dry run");
    },
  } as CorpusClient;
  void all;
}

describe("scheduled sources (dry run, recorded responses)", () => {
  const meta = parseSeriesMeta(text("meta_WGS1YR"));
  const spec = SPEC_BY_ID.get("WGS1YR")!;
  const release = parseRelease(text("release_WGS1YR"));
  const sources = parseSources(text("sources_18"));
  const obs = currentObservations(raw("obs_WGS1YR_2026"));
  const full = observationRows(obsMetaOf(spec, meta), obs, "2026-10-20");

  it("fred_observations rebuilds the current year exactly as the full build did (unchanged), and reads only due series", async () => {
    // the stored state: the full build of 2026 (through 2026-10-16), the series row from that build
    const series = seriesRow(spec, meta, release, sources, { years: ["2026"], latest: obs.at(-1)! }, "2026-10-20");
    const corpus = fakeCorpus({ [SERIES_DATASET]: [series], [OBS_DATASET]: full });
    const releaseDatesUrl = fredUrl("release/dates", {
      release_id: 18,
      realtime_start: "2026-10-14",
      include_release_dates_with_no_data: "false",
      sort_order: "asc",
      limit: 1000,
    });
    const http = fakeHttp([
      { url: releaseDatesUrl, body: FX["dates_18"]!.body },
      { url: FX["obs_WGS1YR_2026"]!.url, body: FX["obs_WGS1YR_2026"]!.body },
    ]);
    const summary = await runSource(fredObservations, {
      corpus,
      env: (n) => (n === "FRED_API_KEY" ? "test-key" : undefined),
      dryRun: true,
      http,
      now: new Date("2026-10-23T22:17:00Z"),
      cursor: { series: { WGS1YR: { through: "2026-10-16", seen: "2026-10-14", fetched: "2026-10-14" } }, releases_checked: "2026-10-14" },
    });
    expect(summary.status).toBe("ok");
    expect(summary.inserted).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    expect(http.urls.some((u) => u.includes("series/observations") && u.includes("WGS1YR"))).toBe(true);
    const cursor = summary.cursorAfter as { series: Record<string, { through: string; seen: string }> };
    expect(cursor.series["WGS1YR"]!.through).toBe("2026-10-16");
    expect(JSON.stringify(summary)).not.toMatch(/test-key/);
  });

  it("fred_observations stops at its request budget and stays resumable", async () => {
    const series = seriesRow(spec, meta, release, sources, { years: ["2026"], latest: obs.at(-1)! }, "2026-10-20");
    const corpus = fakeCorpus({ [SERIES_DATASET]: [series], [OBS_DATASET]: full });
    const http = fakeHttp([], 1);
    const summary = await runSource(fredObservations, {
      corpus,
      env: () => "test-key",
      dryRun: true,
      http,
      now: new Date("2026-10-23T22:17:00Z"),
    });
    expect(["partial", "failed"]).toContain(summary.status);
  });

  it("fred_series restates the latest stored observation without reading FRED for series outside its slice", async () => {
    const stale = seriesRow(spec, meta, release, sources, { years: ["2026"], latest: obs.at(-2)! }, "2026-10-20");
    const corpus = fakeCorpus({ [SERIES_DATASET]: [stale], [OBS_DATASET]: full });
    // the rotation starts past WGS1YR, and every other spec series has no row: give the budget only to WGS1YR's metadata
    const http = fakeHttp([{ url: FX["meta_WGS1YR"]!.url, body: FX["meta_WGS1YR"]!.body }], 0);
    const summary = await runSource(fredSeries, {
      corpus,
      env: () => "test-key",
      dryRun: true,
      http,
      now: new Date("2026-10-23T22:47:00Z"),
      cursor: { next: 1 },
    });
    expect(summary.updated).toBe(1);
    const upd = summary.detail!.updates[0]!;
    expect(upd.id).toBe("fred:WGS1YR");
    expect(upd.changed.join(" ")).toMatch(/latest/);
  });
});
