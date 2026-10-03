import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { countField, filterCatalog, type CatalogEntry, type CatalogIndex, type StateCourts } from "./catalog";

const dir = "private/data/catalog";
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
    const s = JSON.parse(readFileSync("private/data/state-courts.json", "utf8")) as StateCourts;
    expect(Object.keys(s.states).length).toBe(55);
    expect(Object.values(s.states).flat().reduce((a, x) => a + x.links.length, 0)).toBe(2956);
  });
});

describe("docket summaries match the case catalog", () => {
  const up = "/mnt/user-uploads";
  let graph: { counts: Record<string, number>; filings_by_year: Record<string, number> } | null = null;
  try { graph = JSON.parse(readFileSync(`${up}/graph.json`, "utf8")); } catch { /* uploads absent */ }
  it.skipIf(!graph)("totals and per-year filings agree", () => {
    const rows = JSON.parse(readFileSync("private/data/catalog-matters.json", "utf8")) as { status: string; date_filed: string | null }[];
    expect(rows.length).toBe(graph!.counts["unique_dockets"]);
    expect(rows.filter((r) => r.status === "terminated").length).toBe(graph!.counts["terminated"]);
    const years: Record<string, number> = {};
    for (const r of rows) if (r.date_filed) years[r.date_filed.slice(0, 4)] = (years[r.date_filed.slice(0, 4)] ?? 0) + 1;
    expect(years).toEqual(graph!.filings_by_year);
  });
});

import { mergeCatalog, uscourtsId } from "./catalog";
describe("merge and court links", () => {
  it("keeps every catalog origin for one exact URL and preserves the directory row", () => {
    const base = [{ id: "a", url: "https://x.gov/", title: "X", domain: "x.gov", jurisdiction: "Ohio", heading_category: "Federal courts", source_family: "", occurrences: 2 }];
    const catalog = [
      { id: "1", url: "https://x.gov/", title: "X rules", jurisdiction: "oh", category: "court_rules" },
      { id: "2", url: "https://x.gov/", title: "X forms", jurisdiction: "oh", category: "court_forms" },
    ];
    const merged = mergeCatalog(base, catalog);
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]).toMatchObject({ id: "a", occurrences: 2, heading_category: "Federal courts", catalog_records: catalog, category_values: ["Federal courts", "court_rules", "court_forms"] });
    expect(base[0]).not.toHaveProperty("catalog_records");
  });
  it("adds only catalog rows with new exact URLs", () => {
    const base = [{ id: "a", url: "https://x.gov/", title: "X", domain: "x.gov", jurisdiction: "Ohio", heading_category: "", source_family: "", occurrences: 2 }];
    const cat = [{ id: "1", url: "https://x.gov/", title: "X2", jurisdiction: "oh" }, { id: "2", url: "https://x.gov", title: "Y", jurisdiction: "oh" }] as CatalogEntry[];
    const r = mergeCatalog(base, cat);
    expect(r).toMatchObject({ added: 1, matched: 1 });
    expect(r.rows[0]!.title).toBe("X");
    expect(base[0]).not.toHaveProperty("catalog_record");
  });
  it("reads uscourts ids exactly", () => {
    expect(uscourtsId("http://www.akd.uscourts.gov/")).toBe("akd");
    expect(uscourtsId("https://uscourts.gov.evil.com/")).toBeNull();
    expect(uscourtsId("https://www.ca9.uscourts.gov/x")).toBe("ca9");
  });
});
