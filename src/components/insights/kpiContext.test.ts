import { describe, expect, it } from "vitest";
import { renderSectionContext } from "@/lib/assistant/sectionContext";
import type { TileState } from "./hubTiles";
import { kpiContext, kpiFigures, kpiSources } from "./kpiContext";
import type { Kpi } from "./kpis";

const kpi = (over: Partial<Kpi>): Kpi => ({
  id: "hub:x",
  topic: "courts",
  title: "Federal civil cases filed",
  unit: "cases",
  value: "303,716",
  periodText: "FY2025",
  seriesLabel: "United States",
  changeText: "+12,736 (+4.4%) vs FY2024",
  changeNote: null,
  changePercent: 4.4,
  direction: "up",
  completePeriods: 12,
  spark: null,
  source: { label: "Federal Judicial Center", url: "https://www.fjc.gov" },
  href: { to: "/insights/trends" },
  partialNote: null,
  ...over,
});
const ok = (k: Kpi): TileState => ({ kind: "ok", kpi: k });

describe("kpiFigures", () => {
  it("gives each tile its value with period, unit and series, and its change", () => {
    const f = kpiFigures([kpi({})]);
    expect(f).toEqual([
      {
        label: "Federal civil cases filed",
        value: "303,716",
        unit: "cases",
        period: "FY2025",
        note: "United States",
      },
      {
        label: "Federal civil cases filed, change on the period before",
        value: "+12,736 (+4.4%) vs FY2024",
        period: "FY2025",
      },
    ]);
  });
  it("adds a unit only to a bare number, and skips a change the tile does not show", () => {
    const f = kpiFigures([kpi({ value: "$3.94 billion", unit: "dollars", changeText: null })]);
    expect(f).toHaveLength(1);
    expect(f[0]!.unit).toBeUndefined();
  });
  it("keeps a missing value as a gap, never zero", () => {
    expect(kpiFigures([kpi({ value: null, changeText: null })])[0]!.value).toBeNull();
  });
});

describe("kpiContext", () => {
  it("is null while any tile loads, so no summary is written from half a strip", () => {
    const loading: TileState = { kind: "loading", id: "a", topic: "courts", title: "A" };
    expect(kpiContext("Headlines", [ok(kpi({})), loading])).toBeNull();
    expect(kpiContext("Headlines", [])).toBeNull();
  });
  it("leaves out failed tiles and names every distinct source once", () => {
    const failed: TileState = {
      kind: "error",
      id: "a",
      topic: "courts",
      title: "A",
      retry: () => undefined,
    };
    const second = kpi({
      title: "Pending MDLs",
      value: "190",
      unit: "MDLs",
      source: {
        label: "Judicial Panel on Multidistrict Litigation",
        url: "https://www.jpml.uscourts.gov",
      },
    });
    const ctx = kpiContext("Headlines", [ok(kpi({})), failed, ok(second), ok(kpi({}))])!;
    expect(ctx.title).toBe("Headlines");
    expect(ctx.source).toBe("Federal Judicial Center; Judicial Panel on Multidistrict Litigation");
    expect(renderSectionContext(ctx)).toContain("- Pending MDLs: 190 MDLs (FY2025)");
    expect(kpiSources([kpi({}), second])).toContain("Judicial Panel");
  });
});
