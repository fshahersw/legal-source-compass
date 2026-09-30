import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogMatter } from "./catalogMatters";
import { byState, byYearStatus, closedWithDates, defendants, firmRoles, median, medianCloseBy } from "./caseAnalytics";

const rows = JSON.parse(readFileSync("public/data/catalog-matters.json", "utf8")) as CatalogMatter[];
const map = JSON.parse(readFileSync("public/data/mdl-documents/master-dockets.json", "utf8")) as Record<string, string>;

describe("case analytics (real catalog)", () => {
  it("year × status sums to dated rows", () => {
    const y = byYearStatus(rows);
    const total = y.reduce((s, r) => s + r.active + r.closed, 0);
    expect(total).toBe(rows.filter((r) => /^\d{4}/.test(r.date_filed ?? "")).length);
    expect(y.reduce((s, r) => s + r.active, 0)).toBe(1032);
  });
  it("defendant counts are exact", () => {
    const d = defendants(rows, map);
    expect(d[0]).toMatchObject({ label: "ASTRAZENECA PHARMACEUTICALS", count: 176 });
    expect(d.find((x) => x.label === "3M")?.count).toBe(172);
    expect(d.reduce((s, x) => s + x.count, 0)).toBe(2122 - 208);
  });
  it("firm roles cover every firm mention", () => {
    const r = firmRoles(rows);
    const mentions = rows.reduce((s, m) => s + (m.firms ?? []).length, 0);
    expect(r.reduce((s, x) => s + x.anchor + x.competitor + x.other, 0)).toBe(mentions);
  });
  it("median close time uses only closed cases with both dates", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    const n = closedWithDates(rows);
    expect(n).toBe(1089); // 1,090 have both dates; 1 closes before its filing date and is excluded
    expect(medianCloseBy(rows, () => ["all"])[0]!.n).toBe(n);
  });
  it("state rollup ignores courts without a known state", () => {
    const s = byState(rows, new Map([["almb", "AL"]]));
    expect([...s.keys()]).toEqual(["AL"]);
    expect(s.get("AL")).toBe(rows.filter((r) => r.court === "almb").length);
  });
});
