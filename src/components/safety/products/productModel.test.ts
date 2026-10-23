import { describe, expect, it } from "vitest";
import {
  formatCount,
  mainSeries,
  monthAdd,
  primaryDim,
  recentChange,
  recordSource,
  seriesGroups,
  seriesMonths,
  sourceLabel,
  sourceShort,
  subjectHref,
  termMatrix,
  timeline,
  type SubjectSeries,
} from "./productModel";

const s = (series: string, from: string, vals: number[]): SubjectSeries => ({
  series,
  timeline_series: null,
  unit: "reports",
  source_id: "openfda_faers",
  query_url: "https://api.fda.gov/drug/event.json?search=x&count=receivedate",
  method: "m",
  coverage_from: from,
  coverage_to: monthAdd(from, vals.length - 1),
  retrieved_at: "2026-10-23T00:00:00Z",
  total: vals.reduce((a, b) => a + b, 0),
  caveat: "c",
  vals,
});

describe("productModel", () => {
  it("expands a stored series into months", () => {
    expect(seriesMonths(s("faers_reports", "2025-11", [1, 0, 3]))).toEqual([
      { month: "2025-11", value: 1 },
      { month: "2025-12", value: 0 },
      { month: "2026-01", value: 3 },
    ]);
  });

  it("aggregates years and marks partly covered years partial", () => {
    const t = timeline(
      [
        s(
          "faers_reports",
          "2024-07",
          Array.from({ length: 18 }, () => 2),
        ),
      ],
      ["faers_reports"],
      "year",
    );
    expect(t.axis.keys).toEqual(["2024", "2025"]);
    expect(t.series[0]!.points).toEqual([
      { key: "2024", value: 12, partial: true },
      { key: "2025", value: 24, partial: false },
    ]);
  });

  it("keeps a series' months outside its window as gaps on a shared axis", () => {
    const t = timeline(
      [s("faers_reports", "2024-01", [1, 2, 3]), s("enforcement_reports", "2024-02", [0, 5])],
      ["faers_reports", "enforcement_reports"],
      "month",
    );
    expect(t.axis.keys).toEqual(["2024-01", "2024-02", "2024-03"]);
    expect(t.series[1]!.points.map((p) => p.key)).toEqual(["2024-02", "2024-03"]);
  });

  it("computes the 12-month change only with 24 months", () => {
    expect(
      recentChange(
        s(
          "faers_reports",
          "2024-01",
          Array.from({ length: 24 }, (_, i) => (i < 12 ? 10 : 15)),
        ),
      ),
    ).toEqual({
      last12: 180,
      prev12: 120,
      pct: 50,
    });
    expect(recentChange(s("faers_reports", "2024-01", [1, 2])).last12).toBeNull();
  });

  it("picks the main series and the groups a page offers", () => {
    const all = [
      s("faers_serious", "2024-01", [1]),
      s("faers_reports", "2024-01", [2]),
      s("device_recalls", "1997-06", [0]),
    ];
    expect(mainSeries(all)?.series).toBe("faers_reports");
    expect(seriesGroups(all).map((g) => g.id)).toEqual(["faers", "recalls"]);
  });

  it("reads a truncated period's missing term as not recorded and a complete one as 0", () => {
    const m = termMatrix({
      terms: ["Nausea", "Alopecia"],
      periods: [
        { period: "2024-Q1", limit_n: 25, returned: 25, truncated: true, query_url: "u" },
        { period: "2024-Q2", limit_n: 25, returned: 3, truncated: false, query_url: "u" },
      ],
      cells: [["2024-Q1", "Nausea", 9, 2]],
    });
    expect(m.value("Nausea", "2024-Q1")).toBe(9);
    expect(m.value("Alopecia", "2024-Q1")).toBeNull();
    expect(m.value("Alopecia", "2024-Q2")).toBe(0);
    expect(m.value("Alopecia", "2025-Q1")).toBeNull();
    expect(m.serious("Nausea", "2024-Q1")).toBe(2);
  });

  it("formats and routes", () => {
    expect(formatCount(null)).toBe("Not recorded");
    expect(formatCount(12345)).toBe("12,345");
    expect(subjectHref("faers:docetaxel")).toBe("/safety/products/faers%3Adocetaxel");
    expect(primaryDim({ breakdowns: { device_problem: {} as never }, subject: {} as never })).toBe(
      "device_problem",
    );
    expect(recordSource({ records: { maude: 0, nhtsa: 3 } })).toBe("nhtsa");
  });

  it("names sources briefly for tiles and in full for notes, never inventing one", () => {
    expect(sourceShort("openfda_faers")).toBe("FAERS");
    expect(sourceLabel("openfda_faers")).toMatch(/Adverse Event Reporting System/);
    expect(sourceShort("cpsc_neiss")).toBe("cpsc_neiss");
    expect(sourceShort(null)).toBeNull();
  });
});
