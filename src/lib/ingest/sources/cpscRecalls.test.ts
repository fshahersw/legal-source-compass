import { describe, expect, it } from "vitest";
import raws from "../fixtures/cpsc-recalls.json";
import golden from "../fixtures/golden/cpsc-rows.json";
import rules from "../fixtures/golden/cpsc-rules.json";
import { canonical, classify, comparableOf, diffPaths } from "../rows.ts";
import { runSource } from "../runner.ts";
import { politeHttp } from "../http.ts";
import type { CorpusClient } from "../corpus.ts";
import type { CorpusRow, JsonObject, StoredRow } from "../types.ts";
import {
  deathForeignOnly,
  deathMentionClass,
  hazardCategories,
  mentionsDeath,
  mentionsInjury,
  mentionsStandardViolation,
  normalizeCountry,
  parseUnits,
  reportsNone,
} from "./cpscParsing.ts";
import { cpscRecalls, recallRow, shape, standaloneOf } from "./cpscRecalls.ts";

const goldenRows = golden.rows as unknown as CorpusRow[];
const standalone = new Set(golden.standalone);

describe("CPSC rules equal parsing.py", () => {
  it.each(rules.cases.map((c) => [c.text.slice(0, 60), c] as const))("%s", (_t, c) => {
    expect({
      death_class: deathMentionClass(c.text),
      foreign_only: deathForeignOnly(c.text),
      mentions_death: mentionsDeath(c.text),
      mentions_injury: mentionsInjury(c.text),
      reports_none: reportsNone(c.text),
      hazard_categories: hazardCategories(c.text),
      standard_violation: mentionsStandardViolation(c.text),
    }).toEqual({
      death_class: c.death_class,
      foreign_only: c.foreign_only,
      mentions_death: c.mentions_death,
      mentions_injury: c.mentions_injury,
      reports_none: c.reports_none,
      hazard_categories: c.hazard_categories,
      standard_violation: c.standard_violation,
    });
  });

  it("units", () => {
    for (const [text, value] of Object.entries(rules.units))
      expect([text, parseUnits(text)]).toEqual([text, value]);
  });

  it("manufacturer countries", () => {
    const set = new Set(rules.standalone);
    for (const [text, value] of Object.entries(rules.countries))
      expect([text, normalizeCountry(text, set)]).toEqual([text, value]);
  });

  it("covers the rule branches", () => {
    const classes = new Set(rules.cases.map((c) => c.death_class));
    expect(classes).toEqual(new Set([null, "background", "product"]));
    expect(rules.cases.some((c) => c.foreign_only)).toBe(true);
    expect(rules.cases.some((c) => c.reports_none)).toBe(true);
  });
});

describe("CPSC rows equal build_cpsc.py", () => {
  const built = (raws as Record<string, unknown>[])
    .map((r) => shape(r, standalone))
    .sort((a, b) =>
      String(a["date"]) + "\u0000" + String(a["recall_number"]) <
      String(b["date"]) + "\u0000" + String(b["recall_number"])
        ? -1
        : 1,
    )
    .map((r) => recallRow(r, golden.retrieved));

  it("same standalone country set", () => {
    const values = (raws as { ManufacturerCountries?: { Country?: string }[] }[]).flatMap((r) =>
      (r.ManufacturerCountries ?? []).map((c) => (c.Country ?? "").replace(/\s+/g, " ").trim()),
    );
    expect([...standaloneOf(values)].sort()).toEqual(golden.standalone);
  });

  it("same rows in the same order", () => {
    expect(built.map((r) => r.id)).toEqual(goldenRows.map((r) => r.id));
  });

  it.each(goldenRows.map((g, i) => [g.id, i] as const))("%s byte for byte", (_id, i) => {
    const mine = JSON.parse(JSON.stringify(built[i]));
    expect(diffPaths(goldenRows[i], mine)).toEqual([]);
    expect(canonical(mine)).toBe(canonical(goldenRows[i]));
  });
});

describe("CPSC change detection", () => {
  const stored = goldenRows.map((r, i) => ({ ...r, ordinal: i })) as StoredRow[];

  it("a later retrieval of the same record is unchanged", () => {
    const again = (raws as Record<string, unknown>[]).map((r) =>
      recallRow(shape(r, standalone), "2026-11-30"),
    );
    const result = classify(cpscRecalls, again, stored);
    expect(result.inserts).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.unchanged).toBe(again.length);
  });

  it("a republished record with a new LastPublishDate is an update; a new one an insert", () => {
    const first = {
      ...(raws[0] as Record<string, unknown>),
      LastPublishDate: "2026-12-01T00:00:00",
    };
    const fresh = { ...(raws[1] as Record<string, unknown>), RecallNumber: "28001" };
    const rows = [first, fresh].map((r) => recallRow(shape(r, standalone), "2026-12-01"));
    const result = classify(cpscRecalls, rows, stored);
    expect(result.updates.map((r) => r.id)).toEqual([rows[0]!.id]);
    expect(result.inserts.map((r) => r.id)).toEqual(["cpsc-api:28001"]);
    expect(
      diffPaths(
        comparableOf(
          cpscRecalls,
          stored.find((s) => s.id === rows[0]!.id)!,
        ),
        comparableOf(cpscRecalls, rows[0]!),
      ),
    ).toEqual(["$.item.recall.last_publish"]);
  });
});

describe("CPSC run (offline)", () => {
  it("reads one publish-date window, appends new recalls oldest first and stores the cursor", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const urls: string[] = [];
    const corpus: CorpusClient = {
      rowsBy: async (_d, _c, values) => stored().filter((r) => values.includes(r.id)),
      edge: async () => [],
      query: async (q: string) =>
        q.includes("last_publish") ? [{ v: "2026-10-15" }] : [{ v: "2026-10-15" }],
      rpc: async <T>() => [...standaloneOf(golden.standalone)] as T,
      call: async <T>(name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "ingest_open_run_v1")
          return { run_id: "00000000-0000-4000-8000-000000000002", cursor: null } as T;
        if (name === "ingest_upsert_v1") {
          const rows = args["p_rows"] as unknown[];
          return { inserted: rows.length, updated: 0, unchanged: 0, held: 0 } as T;
        }
        return { status: args["p_status"] ?? "ok" } as T;
      },
    };
    const stored = () => goldenRows.slice(0, 10).map((r, i) => ({ ...r, ordinal: i }) as StoredRow);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(raws), { status: 200 });
    }) as typeof fetch;
    const summary = await runSource(cpscRecalls, {
      corpus,
      env: () => undefined,
      dryRun: false,
      now: new Date("2026-10-23T15:52:00Z"),
      http: politeHttp({ maxRequests: 6, minIntervalMs: 0, fetch: fetchImpl }),
    });
    expect(urls).toEqual([
      "https://www.saferproducts.gov/RestWebServices/Recall?format=json&LastPublishDateStart=2026-10-12&LastPublishDateEnd=2026-10-23",
    ]);
    expect(summary.status).toBe("ok");
    expect(summary.fetched).toBe(raws.length);
    const sent = calls
      .filter((c) => c.name === "ingest_upsert_v1")
      .flatMap((c) => c.args["p_rows"] as CorpusRow[]);
    // ten stored rows equal the source (unchanged, not sent); the others are new, oldest first
    expect(sent.map((r) => r.id)).toEqual(goldenRows.slice(10).map((r) => r.id));
    const finish = calls.find((c) => c.name === "ingest_finish_run_v1")!.args;
    expect(finish["p_unchanged"]).toBe(10);
    expect(finish["p_cursor_after"]).toEqual({
      publish_through: "2026-10-23",
      newest_last_publish: "2026-10-22",
    });
    expect((finish["p_requests"] as JsonObject[])[0]!["url"]).toBe(urls[0]);
  });
});
