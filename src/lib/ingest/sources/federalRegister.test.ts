import { describe, expect, it } from "vitest";
// @ts-expect-error -- the original continuation pipeline is plain JavaScript without type declarations
import * as original from "../../../../scripts/ingest/federal-register/lib.mjs";
import fixture from "../fixtures/federal-register-2026-10-23.json";
import { canonical } from "../rows.ts";
import { runSource } from "../runner.ts";
import type { CorpusClient } from "../corpus.ts";
import type { JsonObject, StoredRow } from "../types.ts";
import {
  API_ORIGIN,
  ctxFromStored,
  dayUrl,
  federalRegister,
  pickFields,
  planProjection,
  projectRecord,
  type FrDoc,
} from "./federalRegister.ts";

const docs = (fixture.results as Record<string, unknown>[]).map((r) => pickFields(r));
const ctx = {
  id: "1011190",
  ordinal: -4465,
  collected: "2026-10-23",
  coverage: { from: "1994-01-03", through: "2026-10-23" },
};
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("federal register projection equals the original lib.mjs", () => {
  it("uses the same request URL", () => {
    expect(dayUrl("2026-10-23", 2)).toBe(original.dayUrl("2026-10-23", 2));
  });

  it.each(docs.map((d) => [d.document_number, d] as const))("document %s", (_n, d) => {
    expect(canonical(projectRecord(d, ctx))).toBe(
      canonical(json(original.projectRecord(original.pickFields(d), ctx))),
    );
    expect(projectRecord(d, ctx).text).toBe(
      original.projectRecord(original.pickFields(d), ctx).text,
    );
  });

  it("covers the projection's branches", () => {
    const rows = docs.map((d) => projectRecord(d, ctx));
    expect(rows.some((r) => String((r.item["cells"] as JsonObject)["cfr"]).endsWith("…"))).toBe(
      true,
    );
    expect(rows.some((r) => (r.item["badges"] as string[]).some((b) => b.startsWith("RIN ")))).toBe(
      true,
    );
    expect(rows.some((r) => (r.filters["cfr_title"] as string[]).length > 0)).toBe(true);
    expect(
      rows.some((r) =>
        (r.detail["links"] as { label: string }[]).some((l) => l.label === original.GOVINFO_LABEL),
      ),
    ).toBe(true);
  });

  it("reads back a stored row's projection context", () => {
    const row = projectRecord(docs[0]!, ctx) as unknown as StoredRow;
    expect(ctxFromStored({ ...row, ordinal: ctx.ordinal })).toEqual(ctx);
  });
});

describe("run.mjs projection rules", () => {
  const head = { id: "1011182", ordinal: -4457, publishedThrough: "2026-10-22" };
  const withDay = (d: FrDoc, day: string): FrDoc => ({ ...d, publication_date: day });

  it("adds new documents newest first with ids from the collection base, holds late ones, skips held ones", () => {
    const late = withDay({ ...docs[1]!, document_number: "2026-99999" }, "2026-10-21");
    const input = [...docs, late].map((d) => ({ d, retrievedAt: "2026-10-23T14:23:05Z" }));
    const held = new Set([`${API_ORIGIN}/d/${docs[0]!.document_number}`]);
    const plan = planProjection(input, head, held);
    expect(plan.alreadyHeld).toBe(1);
    expect(plan.held).toEqual([
      {
        key: "2026-99999",
        reason: "published before the newest held day; history is never reordered",
      },
    ]);
    expect(plan.rows).toHaveLength(docs.length - 1);
    const n = plan.rows.length;
    const addable = docs.slice(1).sort(original.compareNewestFirst);
    plan.rows.forEach((r, i) => {
      const ordinal = head.ordinal - n + i;
      expect(r.ordinal).toBe(ordinal);
      expect(r.id).toBe(String(1011182 + -4457 - ordinal));
      expect(canonical(r)).toBe(
        canonical(
          json(
            original.projectRecord(addable[i], {
              id: String(1011182 - 4457 - ordinal),
              ordinal,
              collected: "2026-10-23",
              coverage: { from: "1994-01-03", through: "2026-10-23" },
            }),
          ),
        ),
      );
    });
    expect(plan.newest).toBe("2026-10-23");
  });

  it("adds nothing when every document is held", () => {
    const input = docs.map((d) => ({ d, retrievedAt: "2026-10-23T14:23:05Z" }));
    const plan = planProjection(
      input,
      head,
      new Set(docs.map((d) => `${API_ORIGIN}/d/${d.document_number}`)),
    );
    expect(plan.rows).toEqual([]);
    expect(plan.alreadyHeld).toBe(docs.length);
  });
});

/** A corpus double: one head row, nothing else held, RPC calls recorded. */
function fakeCorpus(calls: { name: string; args: Record<string, unknown> }[]): CorpusClient {
  const head = { id: "1011182", ordinal: -4457, item: { cells: { published: "2026-10-22" } } };
  return {
    rowsBy: async () => [],
    edge: async () => [head],
    query: async () => [],
    rpc: async () => null as never,
    call: async <T>(name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "ingest_open_run_v1")
        return { run_id: "00000000-0000-4000-8000-000000000001", cursor: null } as T;
      if (name === "ingest_upsert_v1") {
        const rows = args["p_rows"] as unknown[];
        return {
          received: rows.length,
          inserted: rows.length,
          updated: 0,
          unchanged: 0,
          held: 0,
        } as T;
      }
      if (name === "ingest_finish_run_v1")
        return {
          status: args["p_status"],
          inserted: docs.length,
          updated: 0,
          unchanged: 0,
          held: 0,
        } as T;
      return { status: "ok" } as T;
    },
  };
}

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const day = url.searchParams.get("conditions[publication_date][gte]");
    const body = day === "2026-10-23" ? fixture : { count: 0, description: "none" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("federal register run (offline)", () => {
  it("reads the recheck window, writes one ordered batch, notes the catalog and closes the run", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const summary = await runSource(federalRegister, {
      corpus: fakeCorpus(calls),
      env: () => undefined,
      dryRun: false,
      trigger: "manual",
      now: new Date("2026-10-23T14:23:00Z"),
      fetch: fakeFetch(),
    });
    expect(summary.status).toBe("ok");
    expect(summary.fetched).toBe(docs.length);
    expect(calls.map((c) => c.name)).toEqual([
      "ingest_open_run_v1",
      "ingest_upsert_v1",
      "ingest_catalog_note_v1",
      "ingest_finish_run_v1",
      "ingest_refresh_insights_v1",
    ]);
    const rows = calls[1]!.args["p_rows"] as { ordinal: number }[];
    expect(rows.map((r) => r.ordinal)).toEqual(rows.map((_, i) => -4457 - rows.length + i));
    const finish = calls[3]!.args;
    expect(finish["p_cursor_after"]).toEqual({
      last_day_read: "2026-10-23",
      newest_published: "2026-10-23",
    });
    const requests = finish["p_requests"] as { url: string }[];
    expect(
      requests.map((r) => new URL(r.url).searchParams.get("conditions[publication_date][gte]")),
    ).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    const note = calls[2]!.args["p_note"] as JsonObject;
    expect(String(note["qualification"])).toContain("published 1994-01-03 to 2026-10-23");
  });

  it("stops as partial at the request budget and keeps what it read", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const { politeHttp } = await import("../http.ts");
    const http = politeHttp({ maxRequests: 1, minIntervalMs: 0, fetch: fakeFetch() });
    const summary = await runSource(federalRegister, {
      corpus: fakeCorpus(calls),
      env: () => undefined,
      dryRun: false,
      now: new Date("2026-10-23T14:23:00Z"),
      http,
    });
    expect(summary.status).toBe("partial");
    expect(calls.map((c) => c.name)).toEqual([
      "ingest_open_run_v1",
      "ingest_finish_run_v1",
      "ingest_refresh_insights_v1",
    ]);
    expect(calls[1]!.args["p_cursor_after"]).toEqual({
      last_day_read: "2026-10-20",
      newest_published: "2026-10-22",
    });
  });

  it("a dry run writes nothing", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const summary = await runSource(federalRegister, {
      corpus: fakeCorpus(calls),
      env: () => undefined,
      dryRun: true,
      now: new Date("2026-10-23T14:23:00Z"),
      fetch: fakeFetch(),
    });
    expect(calls).toEqual([]);
    expect(summary.inserted).toBe(docs.length);
    expect(summary.detail?.inserts).toHaveLength(docs.length);
  });
});
