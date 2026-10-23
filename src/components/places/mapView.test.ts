import { describe, expect, it } from "vitest";
import { dataRows, legendClasses, readout, shadeOf } from "./mapView";

describe("legendClasses", () => {
  it("covers the values with ascending quantile classes and counts every area once", () => {
    const values = Array.from({ length: 51 }, (_, i) => i + 1);
    const classes = legendClasses(values, "int");
    expect(classes).toHaveLength(5);
    expect(classes.reduce((n, c) => n + c.count, 0)).toBe(51);
    expect(classes[0]!.lo).toBe(1);
    expect(classes.at(-1)!.hi).toBe(51);
    for (let i = 1; i < classes.length; i++) expect(classes[i]!.lo).toBe(classes[i - 1]!.hi);
  });
  it("labels ranges in the metric's own unit format", () => {
    const [first] = legendClasses([10.04, 20.5, 30.7, 40.2, 50.9], "rate1");
    expect(first!.label).toBe("10.0");
    const pct = legendClasses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "pct");
    expect(pct[1]!.label).toBe("2.0% to 4.0%");
  });
  it("collapses duplicate bounds and returns nothing without data", () => {
    expect(legendClasses([5, 5, 5], "int")).toHaveLength(1);
    expect(legendClasses([], "int")).toEqual([]);
    expect(legendClasses([Number.NaN], "int")).toEqual([]);
  });
  it("shades light to dark", () => {
    expect(shadeOf(0, 5)).toBeLessThan(shadeOf(4, 5));
    expect(shadeOf(0, 1)).toBe(60);
  });
});

describe("readout", () => {
  it("gives value, rank and the sentence behind the number", () => {
    const r = readout({
      name: "Wyoming",
      value: 53.06,
      format: "rate1",
      unit: "per 100,000 residents",
      rank: { rank: 12, of: 51 },
      rankScope: "states and DC",
      detail: "312 cases ÷ 588,000 residents",
    });
    expect(r).toEqual({
      name: "Wyoming",
      value: "53.1 per 100,000 residents",
      rank: "Rank 12 of 51 states and DC",
      detail: "312 cases ÷ 588,000 residents",
    });
  });
  it("says Not recorded, with no rank or detail, for a missing value", () => {
    const r = readout({
      name: "Guam",
      value: undefined,
      format: "int",
      unit: "cases",
      rankScope: "x",
      detail: "n/a",
    });
    expect(r.value).toBe("Not recorded");
    expect(r.rank).toBeNull();
    expect(r.detail).toBeNull();
  });
  it("treats zero as a value", () => {
    expect(
      readout({ name: "A", value: 0, format: "int", unit: "actions", rankScope: "x" }).value,
    ).toBe("0 actions");
  });
});

describe("dataRows", () => {
  const names = new Map([
    ["56", "Wyoming"],
    ["06", "California"],
    ["72", "Puerto Rico"],
  ]);
  it("sorts highest first, ranks the scoped areas and leaves others unranked", () => {
    const rows = dataRows(names, { "56": 1, "06": 9, "72": 5, "99": 100 }, ["56", "06"]);
    expect(rows.map((r) => r.id)).toEqual(["06", "72", "56"]);
    expect(rows.map((r) => r.rank)).toEqual([1, null, 2]);
  });
});
