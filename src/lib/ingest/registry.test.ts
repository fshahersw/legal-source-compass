import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOT_SCHEDULED, SOURCES } from "./registry.ts";

const sql = readFileSync(
  new URL("../../../database/contracts/ingest-v1.sql", import.meta.url),
  "utf8",
);
/** The rows of the ingest.sources insert: (id, dataset, label, publisher, source_url, function_name, schedule, stale_after, mode, ordinal_policy, ...) */
const seeded = [
  ...sql.matchAll(
    /\(\s*'([a-z_]+)',\s*'([a-z0-9_]+)',\s*'[^']*',\s*'[^']*',\s*'https:[^']*',\s*'(ingest-[a-z-]+)',\s*'([^']+)',\s*interval '[^']+',\s*'(insert_only|upsert)',\s*'(prepend|append)'/g,
  ),
].map((m) => ({
  source: m[1]!,
  dataset: m[2]!,
  functionName: m[3]!,
  schedule: m[4]!,
  mode: m[5]!,
  ordinalPolicy: m[6]!,
}));

describe("registry and ingest-v1.sql agree", () => {
  it("one SQL source row per adapter, same dataset, function, mode and ordinal policy", () => {
    expect(seeded.map((s) => s.source).sort()).toEqual(SOURCES.map((s) => s.source).sort());
    for (const a of SOURCES) {
      const s = seeded.find((x) => x.source === a.source)!;
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
    }
  });

  it("every function has an edge entrypoint that serves its sources", () => {
    for (const fn of new Set(SOURCES.map((s) => s.functionName))) {
      const path = new URL(`../../../supabase/functions/${fn}/index.ts`, import.meta.url);
      expect(existsSync(path), fn).toBe(true);
      const code = readFileSync(path, "utf8");
      for (const s of SOURCES.filter((x) => x.functionName === fn))
        expect(code, `${fn} serves ${s.source}`).toMatch(/serveIngest|SOURCES/);
    }
  });

  it("schedules are spread over the hour (no job on minute 0 or 30)", () => {
    const minutes = seeded.map((s) => Number(s.schedule.split(" ")[0]!.split(",")[0]));
    expect(minutes.every((m) => m !== 0 && m !== 30)).toBe(true);
    expect(new Set(seeded.map((s) => s.schedule)).size).toBe(seeded.length);
  });

  it("secrets are named, never valued", () => {
    for (const s of SOURCES)
      for (const name of s.secrets) expect(name).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(sql).not.toMatch(/sb_secret_|eyJhbGci/);
  });

  it("lists the skipped sources with reasons", () => {
    expect(NOT_SCHEDULED.length).toBeGreaterThan(0);
    for (const s of NOT_SCHEDULED) expect(s.reason.length).toBeGreaterThan(40);
  });
});
