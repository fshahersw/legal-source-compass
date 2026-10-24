import { describe, expect, it } from "vitest";
import { aggregate, inferType, recommend, type Field } from "./encode";

describe("explore encoding", () => {
  it("types a year column as time and counts as numbers", () => {
    expect(inferType([2020, 2021, 2022], "Year")).toBe("temporal");
    expect(inferType([12, 5.5, null], "Filings")).toBe("quantitative");
    expect(inferType(["CA", "NY"], "State")).toBe("nominal");
  });

  it("recommends line for time, bar for categories, none without a numeric y", () => {
    const f: Field[] = [
      { key: "yr", label: "Year", type: "temporal" },
      { key: "st", label: "State", type: "nominal" },
      { key: "n", label: "Count", type: "quantitative" },
    ];
    expect(recommend(f, { x: "yr", y: "n" })).toBe("line");
    expect(recommend(f, { x: "st", y: "n" })).toBe("bar");
    expect(recommend(f, { x: "yr", y: "st" })).toBe("none");
  });

  it("skips rows with a missing value instead of counting them as zero", () => {
    const rows = [
      { st: "CA", n: 3 },
      { st: "CA", n: 2 },
      { st: "NY", n: null },
    ];
    const r = aggregate(rows, { x: "st", y: "n" }, "bar");
    expect(r.points).toEqual([{ x: "CA", series: "All", y: 5 }]);
    expect(r.skipped).toBe(1);
  });
});
