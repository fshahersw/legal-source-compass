import { describe, expect, it } from "vitest";
import {
  classBreaks,
  classOf,
  formatPlaceValue,
  histogram,
  isSmallBase,
  METRIC_BY_KEY,
  metricGroups,
  NOT_RECORDED,
  quantile,
  rankRows,
  residenceShares,
  summarize,
} from "./placeMetrics";
import { directorySearch, parsePlaceHubSearch } from "./placeSearch";

describe("formatting", () => {
  it("never turns a missing value into a number", () => {
    expect(formatPlaceValue(null, "rate")).toBe(NOT_RECORDED);
    expect(formatPlaceValue(Number.NaN, "pct")).toBe(NOT_RECORDED);
    expect(formatPlaceValue(undefined, "int")).toBe(NOT_RECORDED);
  });
  it("formats each kind", () => {
    expect(formatPlaceValue(12.345, "pct")).toBe("12.3%");
    expect(formatPlaceValue(74983, "dollars")).toBe("$74,983");
    expect(formatPlaceValue(64.88, "rate")).toBe("64.9");
    expect(formatPlaceValue(1503.45, "rate")).toBe("1,503");
    expect(formatPlaceValue(-40.4, "change")).toBe("−40%");
    expect(formatPlaceValue(97, "change")).toBe("+97%");
  });
});

describe("quantiles and map classes", () => {
  it("interpolates like type 7", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNull();
  });
  it("collapses repeated breaks and classifies values", () => {
    const z = classBreaks([0, 0, 0, 0, 5]);
    expect(z).toHaveLength(3);
    expect(z[0]).toBe(0);
    expect(z[1]).toBeCloseTo(1);
    expect(z[2]).toBe(5);
    const b = classBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(b).toHaveLength(5);
    expect(classOf(1, b)).toBe(0);
    expect(classOf(10, b)).toBe(4);
    expect(classOf(null, b)).toBeNull();
    expect(classOf(3, [])).toBeNull();
  });
});

describe("rankings and distributions", () => {
  const rows = [
    { id: "01001", name: "A", metrics: { osha_rate: 5, osha_5y: 3 } },
    { id: "01003", name: "B", metrics: { osha_rate: 9, osha_5y: 40 } },
    { id: "01005", name: "C", metrics: { osha_rate: 9, osha_5y: 12 } },
    { id: "01007", name: "D", metrics: { osha_rate: null, osha_5y: 0 } },
  ];
  it("ranks highest first, ties share a rank, missing values are left out", () => {
    const r = rankRows(rows, "osha_rate");
    expect(r.map((x) => [x.name, x.rank])).toEqual([
      ["B", 1],
      ["C", 1],
      ["A", 3],
    ]);
    expect(r.find((x) => x.name === "A")?.smallBase).toBe(true);
  });
  it("flags small bases only for measures that have one", () => {
    expect(isSmallBase(rows[0]!, "osha_rate")).toBe(true);
    expect(isSmallBase(rows[1]!, "osha_rate")).toBe(false);
    expect(isSmallBase(rows[0]!, "median_age")).toBe(false);
  });
  it("bins and summarizes", () => {
    const h = histogram([0, 1, 2, 3, 4], 2);
    expect(h.map((b) => b.count)).toEqual([2, 3]);
    expect(histogram([], 4)).toEqual([]);
    expect(summarize([3, 1, 2])).toMatchObject({ n: 3, min: 1, median: 2, max: 3 });
    expect(summarize([])).toBeNull();
  });
  it("computes residence shares and drops empty classes", () => {
    const s = residenceShares({ own_counties: 75, out_of_state: 25, missing: 0 });
    expect(s.map((x) => [x.key, x.pct])).toEqual([
      ["own_counties", 75],
      ["out_of_state", 25],
    ]);
    expect(residenceShares({})).toEqual([]);
  });
  it("groups metrics for the picker", () => {
    const g = metricGroups(new Set(["fjc_core_rate", "poverty_rate"]));
    expect(g.map((x) => x.group)).toEqual(["Legal activity", "Economy"]);
  });
  it("never offers the MDL-inflated or corpus-coverage measures in a picker", () => {
    const keys = metricGroups().flatMap((g) => g.items.map((m) => m.key));
    expect(keys).not.toContain("fjc_rate");
    expect(keys).not.toContain("resources");
    expect(keys).toContain("fjc_core_rate");
    expect(METRIC_BY_KEY.get("fjc_rate")?.label).toMatch(/not a residence measure/);
    expect(METRIC_BY_KEY.get("fjc_rate")?.caveat).toMatch(/MDL/);
  });
  it("offers a measure only when some row records it", () => {
    const rows = [{ metrics: { fjc_core_rate: 60.6, fjc_core_product_rate: null } }];
    const keys = metricGroups(undefined, rows).flatMap((g) => g.items.map((m) => m.key));
    expect(keys).toEqual(["fjc_core_rate"]);
  });
});

describe("state hub search with the Analysis tab", () => {
  it("drops a measure no picker offers, so the default core rate is shown", () => {
    expect(parsePlaceHubSearch({ tab: "analysis", metric: "fjc_rate" }).metric).toBeUndefined();
    expect(parsePlaceHubSearch({ tab: "analysis", metric: "resources" }).metric).toBeUndefined();
  });
  it("keeps analysis view and a known metric", () => {
    expect(
      parsePlaceHubSearch({ tab: "analysis", view: "districts", metric: "osha_rate" }),
    ).toEqual({
      tab: "analysis",
      view: "districts",
      metric: "osha_rate",
    });
  });
  it("drops unknown metrics and views, and analysis params outside the tab", () => {
    expect(parsePlaceHubSearch({ tab: "analysis", view: "x", metric: "drop table" })).toEqual({
      tab: "analysis",
    });
    expect(parsePlaceHubSearch({ tab: "courts", view: "map", metric: "osha_rate" })).toEqual({
      tab: "courts",
    });
    expect(parsePlaceHubSearch({ tab: "nope" })).toEqual({ tab: "overview" });
  });
  it("gives directories a search without the analysis tab", () => {
    expect(directorySearch({ tab: "analysis", view: "map", q: "x" })).toEqual({
      tab: "overview",
      q: "x",
    });
    expect(directorySearch({ tab: "judges" })).toEqual({ tab: "judges" });
  });
});
