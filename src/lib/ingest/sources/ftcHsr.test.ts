import { describe, expect, it } from "vitest";
import pages from "../fixtures/ftc-hsr-pages.json";
import golden from "../fixtures/golden/hsr-rows.json";
import { canonical, classify, diffPaths } from "../rows.ts";
import { runSource } from "../runner.ts";
import { politeHttp } from "../http.ts";
import type { CorpusClient } from "../corpus.ts";
import type { CorpusRow, JsonObject, StoredRow } from "../types.ts";
import {
  assignIds,
  buildNotices,
  ftcHsr,
  moveSeries,
  normalizeNotice,
  seriesOf,
  type Notice,
} from "./ftcHsr.ts";

const goldenRows = golden.rows as unknown as CorpusRow[];
const docs = pages as unknown as { data: JsonObject[] }[];

describe("HSR rows equal build_hsr.py", () => {
  const built = buildNotices(docs).map((r) => JSON.parse(JSON.stringify(r)) as CorpusRow);

  it("same ids in the same order (incl. <txn>-<n> groups and the series row)", () => {
    expect(built.map((r) => r.id)).toEqual(goldenRows.map((r) => r.id));
    expect(built.some((r) => /-\d$/.test(r.id))).toBe(true);
    expect(
      built.some(
        (r) => (r.item["notice"] as JsonObject | undefined)?.["title_status"] === "differs",
      ),
    ).toBe(true);
  });

  it.each(goldenRows.map((g, i) => [g.id, i] as const))("%s byte for byte", (_id, i) => {
    expect(diffPaths(goldenRows[i], built[i])).toEqual([]);
    expect(canonical(built[i])).toBe(canonical(goldenRows[i]));
  });
});

describe("HSR series moves by exactly the notices written", () => {
  const notices = docs
    .flatMap((d) => d.data)
    .map((r) => normalizeNotice(r))
    .filter((n): n is Notice => n !== null);
  const unique = [...new Map(notices.map((n) => [n.api_id, n])).values()];

  it("adding notices one by one equals counting them all", () => {
    const start = seriesOf(unique.slice(0, 10));
    const moved = moveSeries(
      start,
      unique.slice(10).map((after) => ({ before: null, after })),
    );
    expect("held" in moved).toBe(false);
    const all = seriesOf(unique);
    expect(moved).toEqual({ series: all.series, first: all.first, last: all.last });
  });

  it("an edited date that moves the first or last date is held", () => {
    const all = seriesOf(unique);
    const edge = unique.find((n) => n.date === all.last)!;
    expect(moveSeries(all, [{ before: edge, after: { ...edge, date: "2026-01-02" } }])).toEqual({
      held: "an edited notice moved the first or last date of the series; a full rebuild recomputes it",
    });
    const inner = unique.find((n) => n.date !== all.first && n.date !== all.last)!;
    const moved = moveSeries(all, [{ before: inner, after: { ...inner, date: "2026-01-02" } }]);
    expect("held" in moved).toBe(false);
  });

  it("assign_ids numbers a shared transaction by (date, created, api id)", () => {
    const ids = assignIds(unique);
    expect([...ids.values()].filter((v) => v.startsWith("20260358"))).toEqual(
      expect.arrayContaining(["20260358-1", "20260358-2"]),
    );
  });
});

/** Corpus double holding the golden rows except the newest notices. */
function corpusHolding(
  held: CorpusRow[],
  calls: { name: string; args: Record<string, unknown> }[],
): CorpusClient {
  const stored = held.map((r, i) => ({ ...r, ordinal: i }) as StoredRow);
  const notice = (r: StoredRow) => r.item["notice"] as JsonObject | undefined;
  return {
    rowsBy: async (_d, _c, values) => stored.filter((r) => values.includes(r.id)),
    edge: async () => [],
    query: async (q: string) => {
      const decoded = decodeURIComponent(q);
      if (decoded.includes("order=item->notice->>created.desc")) {
        const c =
          stored
            .map((r) => String(notice(r)?.["created"] ?? ""))
            .sort()
            .at(-1) ?? null;
        return [{ c }];
      }
      const api = decoded.match(/api_id=in\.\((.*)\)$/);
      if (api) {
        const ids = api[1]!.split(",").map((x) => x.replace(/"/g, ""));
        return stored.filter((r) =>
          ids.includes(String(notice(r)?.["api_id"])),
        ) as unknown as JsonObject[];
      }
      const txn = decoded.match(/or=\(id\.eq\.(\d+),/);
      if (txn)
        return stored.filter(
          (r) => r.id === txn[1] || r.id.startsWith(`${txn[1]}-`),
        ) as unknown as JsonObject[];
      return [];
    },
    rpc: async <T>() => null as T,
    call: async <T>(name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "ingest_open_run_v1")
        return { run_id: "00000000-0000-4000-8000-000000000003", cursor: null } as T;
      if (name === "ingest_upsert_v1")
        return {
          inserted: (args["p_rows"] as unknown[]).length,
          updated: 0,
          unchanged: 0,
          held: 0,
        } as T;
      return { status: args["p_status"] ?? "ok" } as T;
    },
  };
}

describe("HSR run (offline)", () => {
  it("adds the notices newer than the held ones, moves the series row, sends the key only as a header", async () => {
    // hold everything except the three newest notices (by date) and the series row; the held series counts only them
    const notices = goldenRows.filter((r) => r.id !== "series-by-year");
    const newest = notices.slice(-3);
    const heldNotices = notices.slice(0, -3);
    const heldSeries = buildNotices([
      {
        data: docs
          .flatMap((d) => d.data)
          .filter(
            (r) => !newest.some((n) => (n.item["notice"] as JsonObject)["api_id"] === r["id"]),
          ),
      },
    ]).at(-1)!;
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify(docs[0]), { status: 200 });
    }) as typeof fetch;
    const summary = await runSource(ftcHsr, {
      corpus: corpusHolding([...heldNotices, heldSeries], calls),
      env: (k) => (k === "DATA_GOV_API_KEY" ? "TEST-KEY" : undefined),
      dryRun: false,
      now: new Date("2026-10-23T16:11:00Z"),
      http: politeHttp({ maxRequests: 4, minIntervalMs: 0, fetch: fetchImpl }),
    });
    expect(summary.status).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).not.toContain("TEST-KEY");
    expect(seen[0]!.headers["X-Api-Key"]).toBe("TEST-KEY");
    const finish = calls.find((c) => c.name === "ingest_finish_run_v1")!.args;
    expect(JSON.stringify(finish)).not.toContain("TEST-KEY");
    const sent = calls
      .filter((c) => c.name === "ingest_upsert_v1")
      .flatMap((c) => c.args["p_rows"] as CorpusRow[]);
    const page0 = new Set(docs[0]!.data.map((r) => String(r["id"])));
    const expectedNew = newest
      .filter((n) => page0.has(String((n.item["notice"] as JsonObject)["api_id"])))
      .map((n) => n.id);
    expect(sent.map((r) => r.id)).toEqual([...expectedNew, "series-by-year"]);
    // the moved series equals the series of a full build over the same notices
    const fullSeries = buildNotices([
      {
        data: docs
          .flatMap((d) => d.data)
          .filter(
            (r) =>
              !newest.some((n) => (n.item["notice"] as JsonObject)["api_id"] === r["id"]) ||
              page0.has(String(r["id"])),
          ),
      },
    ]).at(-1)!;
    expect(canonical(sent.at(-1))).toBe(canonical(fullSeries));
  });

  it("a notice whose transaction number is held under its plain id is held, not renumbered", async () => {
    const plain = goldenRows.find((r) => /^\d{8}$/.test(r.id))!;
    const twin = JSON.parse(
      JSON.stringify(
        docs
          .flatMap((d) => d.data)
          .find((r) => r["id"] === (plain.item["notice"] as JsonObject)["api_id"]),
      ),
    ) as JsonObject;
    twin["id"] = "ffffffff-0000-4000-8000-000000000000";
    (twin["attributes"] as JsonObject)["created"] = "2026-10-23T12:00:00+00:00";
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [twin], meta: { count: 1 } }), {
        status: 200,
      })) as typeof fetch;
    const summary = await runSource(ftcHsr, {
      corpus: corpusHolding(goldenRows, calls),
      env: () => "K",
      dryRun: true,
      now: new Date("2026-10-23T16:11:00Z"),
      http: politeHttp({ maxRequests: 4, minIntervalMs: 0, fetch: fetchImpl }),
    });
    expect(summary.heldReasons).toEqual({
      "transaction number already held under its plain id; a full rebuild renumbers both notices": 1,
    });
    expect(summary.inserted).toBe(0);
  });

  it("an unchanged re-read changes nothing", () => {
    const stored = goldenRows.map((r, i) => ({ ...r, ordinal: i }) as StoredRow);
    const result = classify(ftcHsr, buildNotices(docs), stored);
    expect(result.inserts).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.unchanged).toBe(goldenRows.length);
  });
});
