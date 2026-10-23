import { describe, expect, it } from "vitest";
import {
  andClause,
  cfpbRow,
  dayCountsToMonths,
  lastCompleteMonth,
  monthAdd,
  monthEnd,
  openfdaUrl,
  patchRow,
  runCfpbComplaints,
  runOpenfdaEvents,
} from "./ingestSafety";
import { serveSafety } from "./edgeSafety";
import type { CorpusClient } from "../ingest/corpus";

describe("pure helpers", () => {
  it("adds months and finds month ends", () => {
    expect(monthAdd("2024-11", 2)).toBe("2025-01");
    expect(monthAdd("2024-01", -1)).toBe("2023-12");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(monthEnd("2025-12")).toBe("2025-12-31");
  });
  it("sums openFDA day counts by month and ignores malformed days", () => {
    expect(
      dayCountsToMonths([
        { time: "20240105", count: 2 },
        { time: "20240131", count: 3 },
        { time: "20240201", count: 1 },
        { time: "00100817", count: 9 },
        { time: "20240202", count: -1 },
      ]),
    ).toEqual({ "2024-01": 5, "2024-02": 1 });
  });
  it("takes the last complete month of the data", () => {
    expect(lastCompleteMonth([{ time: "20260630", count: 1 }])).toBe("2026-06");
    expect(
      lastCompleteMonth([
        { time: "20260915", count: 1 },
        { time: "20260101", count: 1 },
      ]),
    ).toBe("2026-08");
    expect(lastCompleteMonth([])).toBeNull();
  });
  it("encodes searches the way openFDA reads them ('+' literal)", () => {
    const s = andClause('device.brand_name:"bair hugger"', 'event_type:"Death"');
    expect(openfdaUrl("device/event.json", s, "date_received")).toBe(
      'https://api.fda.gov/device/event.json?search=(device.brand_name:"bair%20hugger")+AND+event_type:"Death"&count=date_received',
    );
  });
  it("builds a patch inside the stored window and drops zero months", () => {
    const row = patchRow(
      "mdl:2740",
      { series: "faers_reports", coverage_from: "2025-08", coverage_to: "2026-05" },
      { "2026-04": 3, "2026-05": 0, "2026-06": 7, "2025-01": 9 },
      "2026-04",
      "2026-06",
      "https://api.fda.gov/drug/event.json?search=x&count=receivedate",
      "2026-10-23T00:00:00Z",
    );
    expect(row).toMatchObject({
      window_from: "2026-04",
      window_to: "2026-06",
      months: { "2026-04": 3, "2026-06": 7 },
    });
    const clipped = patchRow(
      "s:x",
      { series: "faers_reports", coverage_from: "2026-05", coverage_to: "2026-05" },
      {},
      "2026-04",
      "2026-06",
      "https://a",
      "t",
    );
    expect(clipped?.["window_from"]).toBe("2026-05");
  });
  it("maps a CFPB hit without inventing values", () => {
    const row = cfpbRow({
      _source: {
        complaint_id: "30763292",
        date_received: "2026-10-23T03:59:30.000Z",
        product: "Debt collection",
        sub_product: null,
        issue: "Attempts to collect debt not owed",
        company: "ACME LLC",
        state: "FL",
        timely: "Yes",
        company_response: "In progress",
        date_sent_to_company: "2026-10-23T03:59:58.000Z",
      },
    });
    expect(row).toMatchObject({
      complaint_id: 30763292,
      date_received: "2026-10-23",
      sub_product: "",
      sub_issue: "",
      timely: true,
      date_sent: "2026-10-23",
      tags: null,
    });
    expect(row).not.toHaveProperty("narrative");
    expect(cfpbRow({ _source: { complaint_id: "x" } })).toBeNull();
  });
});

type Call = { name: string; args: Record<string, unknown> };

function fakeCorpus(
  calls: Call[],
  plan: unknown,
  open: unknown = { run_id: "00000000-0000-4000-8000-000000000001", cursor: null },
): CorpusClient {
  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ name, args });
    if (name === "ingest_open_run_v1") return open as T;
    if (name === "safety_ingest_plan_v1") return plan as T;
    if (name === "safety_ingest_apply_v1")
      return { updated: (args["p_rows"] as unknown[]).length, inserted: 0, unchanged: 0 } as T;
    return {} as T;
  };
  return {
    call,
    rpc: call,
    rowsBy: async () => [],
    edge: async () => [],
    query: async () => [],
  } as unknown as CorpusClient;
}

describe("runOpenfdaEvents", () => {
  const plan = {
    subjects: [
      {
        id: "mdl:2740",
        search: 'patient.drug.openfda.generic_name:"docetaxel"',
        series: [
          { series: "faers_reports", coverage_from: "2004-01", coverage_to: "2026-03" },
          { series: "faers_death", coverage_from: "2004-01", coverage_to: "2026-03" },
          { series: "not_refreshed", coverage_from: "2004-01", coverage_to: "2026-03" },
        ],
      },
      {
        id: "national:faers",
        search: "_exists_:receivedate",
        series: [{ series: "faers_reports", coverage_from: "2004-01", coverage_to: "2026-03" }],
      },
    ],
  };
  const fetchOpenfda = (seen: string[]): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const results = url.includes("search=")
        ? [
            { time: "20260410", count: 4 },
            { time: "20260602", count: 6 },
          ]
        : [{ time: "20260630", count: 1 }];
      return new Response(JSON.stringify({ results }), { status: 200 });
    }) as typeof fetch;

  it("refreshes the latest months of every stored series and closes the run with a rotated cursor", async () => {
    const calls: Call[] = [];
    const seen: string[] = [];
    const res = await runOpenfdaEvents("safety_faers_series", {
      corpus: fakeCorpus(calls, plan),
      env: (k) => (k === "DATA_GOV_API_KEY" ? "SECRET-KEY" : undefined),
      trigger: "manual",
      now: new Date("2026-10-23T00:00:00Z"),
      fetch: fetchOpenfda(seen),
      sleep: async () => undefined,
      minIntervalMs: 0,
    });
    expect(res.status).toBe("ok");
    expect(seen).toHaveLength(4); // endpoint dates + 3 refreshed series (the unknown series is skipped)
    expect(seen[1]).toContain("receivedate:[20260401+TO+20260630]");
    expect(seen.every((u) => u.includes("api_key=SECRET-KEY"))).toBe(true);
    const apply = calls.find((c) => c.name === "safety_ingest_apply_v1")!;
    expect(apply.args["p_target"]).toBe("series_patch");
    expect((apply.args["p_rows"] as Record<string, unknown>[])[0]).toMatchObject({
      subject_id: "mdl:2740",
      series: "faers_reports",
      window_from: "2026-04",
      window_to: "2026-06",
      months: { "2026-04": 4, "2026-06": 6 },
    });
    const fin = calls.find((c) => c.name === "ingest_finish_run_v1")!;
    expect(fin.args["p_status"]).toBe("ok");
    expect(fin.args["p_cursor_after"]).toEqual({ index: 0, cycle: 2 });
    expect(JSON.stringify(fin.args["p_requests"])).not.toContain("SECRET-KEY");
    expect(JSON.stringify(apply.args)).not.toContain("SECRET-KEY");
    expect(calls.some((c) => c.name === "ingest_refresh_insights_v1")).toBe(true);
  });

  it("stops at the request budget as a partial run and keeps its place", async () => {
    const calls: Call[] = [];
    const res = await runOpenfdaEvents("safety_faers_series", {
      corpus: fakeCorpus(calls, plan),
      env: () => "k",
      trigger: "schedule",
      now: new Date(),
      fetch: fetchOpenfda([]),
      sleep: async () => undefined,
      minIntervalMs: 0,
      maxRequests: 3,
    });
    expect(res.status).toBe("partial");
    const fin = calls.find((c) => c.name === "ingest_finish_run_v1")!;
    expect(fin.args["p_cursor_after"]).toEqual({ index: 1, cycle: 1 }); // the first subject finished; the next run starts at the second
  });

  it("does nothing when the source is disabled for scheduled runs", async () => {
    const calls: Call[] = [];
    const res = await runOpenfdaEvents("safety_maude_series", {
      corpus: fakeCorpus(calls, plan, { skipped: "disabled" }),
      env: () => "k",
      trigger: "schedule",
      now: new Date(),
      fetch: fetchOpenfda([]),
    });
    expect(res.status).toBe("skipped");
    expect(calls.map((c) => c.name)).toEqual(["ingest_open_run_v1"]);
  });
});

describe("runCfpbComplaints", () => {
  it("reads the last week for the held products and writes complaint rows", async () => {
    const calls: Call[] = [];
    const seen: string[] = [];
    const fetchCfpb = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(
        JSON.stringify({
          hits: {
            total: { value: 1 },
            hits: [
              {
                _source: {
                  complaint_id: "101",
                  date_received: "2026-10-20T00:00:00Z",
                  product: "Debt collection",
                  company: "ACME LLC",
                  issue: "X",
                },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const res = await runCfpbComplaints({
      corpus: fakeCorpus(calls, {
        latest_received: "2026-10-15",
        products: ["Debt collection", "Mortgage"],
      }),
      env: () => undefined,
      trigger: "manual",
      now: new Date("2026-10-23T12:00:00Z"),
      fetch: fetchCfpb,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });
    expect(res.status).toBe("ok");
    expect(seen[0]).toContain("date_received_min=2026-10-16");
    expect(seen[0]).toContain("product=Debt+collection");
    expect(seen[0]).toContain("product=Mortgage");
    const apply = calls.find((c) => c.name === "safety_ingest_apply_v1")!;
    expect(apply.args["p_target"]).toBe("cfpb_complaints");
  });
});

describe("serveSafety", () => {
  it("rejects a missing token and an unknown source; reports a missing secret by name only", async () => {
    const token = "a".repeat(64);
    const fetchDb = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const name = String(input).split("/rpc/")[1] ?? "";
      if (name === "ingest_check_trigger_v1") {
        const { p_token } = JSON.parse(String(init?.body)) as { p_token: string };
        return new Response(JSON.stringify(p_token === token), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const handler = serveSafety({
      sources: ["safety_faers_series", "safety_maude_series"],
      env: (k) => ({ SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "service" })[k],
      fetch: fetchDb,
    });
    const post = (auth: string, body: unknown) =>
      handler(
        new Request("https://f.example", {
          method: "POST",
          headers: { Authorization: auth },
          body: JSON.stringify(body),
        }),
      );
    expect((await post("Bearer short", {})).status).toBe(401);
    expect((await post(`Bearer ${"b".repeat(64)}`, {})).status).toBe(401);
    expect((await post(`Bearer ${token}`, { source: "nope" })).status).toBe(400);
    const missing = await post(`Bearer ${token}`, { source: "safety_faers_series" });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({
      error: "missing function secrets",
      names: ["DATA_GOV_API_KEY"],
    });
  });
});
