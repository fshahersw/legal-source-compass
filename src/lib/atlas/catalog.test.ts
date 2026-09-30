import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { countField, filterCatalog, type CatalogEntry, type CatalogIndex, type StateCourts } from "./catalog";

const dir = "public/data/catalog";
const idx = JSON.parse(readFileSync(`${dir}/index.json`, "utf8")) as CatalogIndex;

describe("source catalog bundle", () => {
  it("keeps all 9,348 rows across jurisdiction files", () => {
    const files = readdirSync(dir).filter((f) => f !== "index.json");
    const total = files.reduce((a, f) => a + (JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as unknown[]).length, 0);
    expect(total).toBe(9348);
    expect(idx.jurisdictions.reduce((a, j) => a + j.count, 0)).toBe(9348);
  });
  it("filters exactly", () => {
    const mn = JSON.parse(readFileSync(`${dir}/mn.json`, "utf8")) as CatalogEntry[];
    expect(mn.length).toBe(390);
    const cats = countField(mn, "category");
    expect(filterCatalog(mn, { category: cats[0]!.key }).length).toBe(cats[0]!.count);
  });
  it("has 2,956 state court links for 55 places", () => {
    const s = JSON.parse(readFileSync("public/data/state-courts.json", "utf8")) as StateCourts;
    expect(Object.keys(s.states).length).toBe(55);
    expect(Object.values(s.states).flat().reduce((a, x) => a + x.links.length, 0)).toBe(2956);
  });
});

describe("docket summaries match the case catalog", () => {
  const up = "/mnt/user-uploads";
  let graph: { counts: Record<string, number>; filings_by_year: Record<string, number> } | null = null;
  try { graph = JSON.parse(readFileSync(`${up}/graph.json`, "utf8")); } catch { /* uploads absent */ }
  it.skipIf(!graph)("totals and per-year filings agree", () => {
    const rows = JSON.parse(readFileSync("public/data/catalog-matters.json", "utf8")) as { status: string; date_filed: string | null }[];
    expect(rows.length).toBe(graph!.counts["unique_dockets"]);
    expect(rows.filter((r) => r.status === "terminated").length).toBe(graph!.counts["terminated"]);
    const years: Record<string, number> = {};
    for (const r of rows) if (r.date_filed) years[r.date_filed.slice(0, 4)] = (years[r.date_filed.slice(0, 4)] ?? 0) + 1;
    expect(years).toEqual(graph!.filings_by_year);
  });
});
