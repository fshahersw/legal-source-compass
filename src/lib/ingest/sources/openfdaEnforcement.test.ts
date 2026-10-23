import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/openfda-enforcement.json";
// @ts-expect-error -- plain JavaScript helper (PostgreSQL jsonb text form) without type declarations
import { jsonbHash } from "../../../../scripts/ingest/jsonb.mjs";
import { classify, comparableOf } from "../rows.ts";
import { runSource, updatedPaths } from "../runner.ts";
import { politeHttp } from "../http.ts";
import type { CorpusClient } from "../corpus.ts";
import type { CorpusRow, JsonObject, StoredRow } from "../types.ts";
import {
  enforcementRow,
  firmId,
  firmNorm,
  openfdaEnforcement,
  qualification,
  textParts,
  type Capture,
  type Kind,
} from "./openfdaEnforcement.ts";

const cap: Capture = {
  url: "https://api.fda.gov/drug/enforcement.json?search=report_date:[20260826+TO+20261023]&limit=1000",
  capturedAt: "2026-10-23T09:41:05Z",
  lastUpdated: "2026-10-14",
  bytes: 1234,
  sha256: "a".repeat(64),
};
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const records = fixture.records as unknown as Record<Kind, JsonObject[]>;

describe("openFDA rows equal the stored corpus rows (capture provenance masked)", () => {
  it.each(Object.entries(fixture.stored_hashes))("%s", (id, storedHash) => {
    const kind = id.split(":")[1]!.split("/")[0] as Kind;
    const rec = records[kind].find(
      (r) => `openfda:${kind}/enforcement:${r["recall_number"]}` === id,
    )!;
    const row = enforcementRow(kind, rec, cap);
    expect(jsonbHash(comparableOf(openfdaEnforcement(kind), row))).toBe(storedHash);
  });

  it.each(["drug", "device", "food"] as Kind[])(
    "the %s bulk qualification is the stored text",
    (kind) => {
      expect(md5(qualification(kind, "bulk"))).toBe(
        (fixture.stored_qualification_md5 as Record<string, string>)[kind],
      );
    },
  );

  it("rows read from the API say so (qualification, temporal, original file) and keep the publisher record", () => {
    const row = enforcementRow("drug", records.drug[0]!, cap);
    expect(String(row.detail["qualification"])).toMatch(
      /publisher's API records as of the stated last-updated date/,
    );
    expect((row.detail["temporal"] as JsonObject)["source_as_of"]).toBe("2026-10-14");
    expect((row.detail["original_file"] as JsonObject)["url"]).toBe(cap.url);
    expect(row.detail["publisher_record"]).toEqual(records.drug[0]);
    expect(row.source_url).toBe("");
  });
});

describe("openFDA field rules", () => {
  it("firm names", () => {
    expect(firmNorm("Taylor Farms de Mexico S. de R.L. de C.V.")).toBe(
      "TAYLOR FARMS DE MEXICO S DE R L DE C V",
    );
    expect(firmNorm("A L Kauffman & Sons Co. DBA Kauffman's Fruit Farm and Market")).toBe(
      "A L KAUFFMAN AND SONS CO DBA KAUFFMANS FRUIT FARM AND MARKET",
    );
    expect(firmNorm("Eden¿¿¿s Elixirs, LLC")).toBe("EDEN S ELIXIRS LLC");
    expect(firmNorm("B @ B Trade Inc.")).toBe("B B TRADE INC");
    expect(firmId(firmNorm("3M Company/3m Espe Dental Products"))).toBe(
      "firm:3m-company-3m-espe-dental-products",
    );
  });

  it("text parts keep published order and empty values", () => {
    expect(textParts({ a: "x", b: {}, c: ["1", "2"], d: "", e: { f: "y" } }).join(" ")).toBe(
      "x  1 2  y",
    );
  });

  it("the ledger names what the publisher changed (termination apart from openfda harmonisation)", () => {
    const rec = records.drug.find((r) => r["recall_number"] === "D-0776-2026")!;
    const stored = enforcementRow("drug", rec, cap);
    const terminated = enforcementRow(
      "drug",
      { ...rec, status: "Terminated", termination_date: "20261015" },
      cap,
    );
    const unharmonised = enforcementRow("drug", { ...rec, openfda: {} }, cap);
    const paths = updatedPaths(
      openfdaEnforcement("drug"),
      [terminated, unharmonised],
      [{ ...stored, ordinal: 1 } as unknown as StoredRow],
      "id",
    );
    expect(paths["$.detail.publisher_record.status"]).toBe(1);
    expect(paths["$.detail.publisher_record.openfda"]).toBe(1);
    expect(paths["$.text"]).toBe(2);
    expect(paths["$.filters.status[]"]).toBe(1);
    expect(Object.keys(paths).every((p) => !/\[\d+\]/.test(p) && p.split(".").length <= 4)).toBe(
      true,
    );
  });

  it("text parts render booleans as the Python builder did (openfda.is_original_packager)", () => {
    expect(textParts({ a: [true], b: false, c: "true" }).join(" ")).toBe("True False true");
  });

  it("dates: ISO, raw kept, date_types only for present dates", () => {
    const row = enforcementRow("device", records.device[0]!, cap);
    expect(row.filters["date_types"]).toEqual([
      "center_classification_date",
      "recall_initiation_date",
      "report_date",
      "termination_date",
    ]);
    expect((row.detail["fields"] as JsonObject)["termination_date_raw"]).toBe("20260910");
  });
});

describe("openFDA run (offline)", () => {
  it("reads report and termination windows, sends new rows newest first, the cursor moves to today", async () => {
    const urls: string[] = [];
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const u = decodeURIComponent(String(input));
      urls.push(u);
      if (u.includes("search=report_date"))
        return new Response(
          JSON.stringify({
            meta: {
              ...fixture.window_meta,
              results: { skip: 0, limit: 1000, total: fixture.window_drug.length },
            },
            results: fixture.window_drug,
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "No matches found!" } }),
        { status: 404 },
      );
    }) as typeof fetch;
    const corpus: CorpusClient = {
      rowsBy: async () => [],
      edge: async () => [],
      query: async () => [{ v: "2026-09-09" }],
      rpc: async <T>() => null as T,
      call: async <T>(name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "ingest_open_run_v1")
          return { run_id: "00000000-0000-4000-8000-000000000004", cursor: null } as T;
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
    const adapter = openfdaEnforcement("drug");
    const summary = await runSource(adapter, {
      corpus,
      env: () => undefined,
      dryRun: false,
      now: new Date("2026-10-23T09:41:00Z"),
      http: politeHttp({ maxRequests: 12, minIntervalMs: 0, fetch: fetchImpl }),
    });
    expect(summary.status).toBe("ok");
    expect(urls).toEqual([
      "https://api.fda.gov/drug/enforcement.json?search=report_date:[20260826+TO+20261023]&limit=1000",
      "https://api.fda.gov/drug/enforcement.json?search=termination_date:[20260826+TO+20261023]&limit=1000",
    ]);
    const sent = calls
      .filter((c) => c.name === "ingest_upsert_v1")
      .flatMap((c) => c.args["p_rows"] as CorpusRow[]);
    const dates = sent.map((r) => String(r.filters["report_date"]));
    expect(dates).toEqual([...dates].sort().reverse());
    expect(calls.find((c) => c.name === "ingest_finish_run_v1")!.args["p_cursor_after"]).toEqual({
      read_through: "2026-10-23",
      last_updated: fixture.window_meta.last_updated,
    });
  });

  it("a record stored from the bulk export with the same publisher content is unchanged", () => {
    const kind: Kind = "food";
    const row = enforcementRow(kind, records.food[0]!, cap);
    const bulk = JSON.parse(JSON.stringify(row)) as CorpusRow;
    (bulk.detail["temporal"] as JsonObject)["captured_at"] = "2026-09-19T05:35:37Z";
    bulk.detail["qualification"] = qualification(kind, "bulk");
    bulk.detail["original_file"] = { url: "/agency-safety/files/openfda-food-enforcement" };
    const result = classify(
      openfdaEnforcement(kind),
      [row],
      [{ ...bulk, ordinal: 1 } as StoredRow],
    );
    expect(result.unchanged).toBe(1);
    const terminated = enforcementRow(
      kind,
      { ...records.food[0]!, status: "Terminated", termination_date: "20261020" },
      cap,
    );
    expect(
      classify(openfdaEnforcement(kind), [terminated], [{ ...bulk, ordinal: 1 } as StoredRow])
        .updates,
    ).toHaveLength(1);
  });
});
