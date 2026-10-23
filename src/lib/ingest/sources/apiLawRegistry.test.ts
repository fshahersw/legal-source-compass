import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_LAW_SOURCES } from "./apiLawRegistry.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const rows = (sql: string) =>
  [
    ...sql.matchAll(
      /\(\s*'([a-z0-9_]+)',\s*'([a-z0-9_]+)',\s*'[^']*',\s*'[^']*',\s*'https:[^']*',\s*'(ingest-[a-z-]+)',\s*'([^']+)',\s*interval '[^']+',\s*'(insert_only|upsert)',\s*'(prepend|append)',\s*'([a-z0-9_]+)',\s*'([^']+)'/g,
    ),
  ].map((m) => ({
    source: m[1]!,
    dataset: m[2]!,
    functionName: m[3]!,
    schedule: m[4]!,
    mode: m[5]!,
    ordinalPolicy: m[6]!,
    category: m[7]!,
    idPattern: m[8]!,
  }));
const mine = rows(read("../../../../database/contracts/api-law-v1.sql"));
const base = rows(read("../../../../database/contracts/ingest-v1.sql"));

describe("api-law sources and api-law-v1.sql agree", () => {
  it("one SQL source row per adapter with the same dataset, function, mode and ordinal policy", () => {
    expect(mine.map((s) => s.source).sort()).toEqual(API_LAW_SOURCES.map((s) => s.source).sort());
    for (const a of API_LAW_SOURCES) {
      const s = mine.find((x) => x.source === a.source)!;
      expect({
        dataset: s.dataset,
        functionName: s.functionName,
        mode: s.mode,
        ordinalPolicy: s.ordinalPolicy,
      }).toEqual({
        dataset: a.dataset,
        functionName: a.functionName,
        mode: a.mode,
        ordinalPolicy: a.ordinalPolicy,
      });
      // corpus_writer.record sets category = dataset
      expect(s.category).toBe(a.dataset);
    }
  });

  it("no source id or dataset collides with ingest-v1.sql; schedules are unique and off the hour", () => {
    expect(
      mine.filter((s) => base.some((b) => b.source === s.source || b.dataset === s.dataset)),
    ).toEqual([]);
    const all = [...base, ...mine].map((s) => s.schedule);
    expect(new Set(all).size).toBe(all.length);
    for (const s of mine)
      expect([0, 30]).not.toContain(Number(s.schedule.split(" ")[0]!.split(",")[0]));
  });

  it("every function has an edge entrypoint serving its sources", () => {
    for (const fn of new Set(API_LAW_SOURCES.map((s) => s.functionName))) {
      const url = new URL(`../../../../supabase/functions/${fn}/index.ts`, import.meta.url);
      expect(existsSync(url), fn).toBe(true);
      expect(readFileSync(url, "utf8")).toMatch(/serveIngest/);
    }
  });

  it("id patterns are anchored and secrets are names", () => {
    for (const s of mine) expect(s.idPattern).toMatch(/^\^.*\$$/);
    for (const a of API_LAW_SOURCES)
      for (const n of a.secrets) expect(n).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });
});
