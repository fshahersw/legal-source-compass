import { describe, expect, it } from "vitest";
import { mapRows, mapTakeaway } from "./placesMapModel";

const states = [
  { fips: "01", usps: "AL", name: "Alabama" },
  { fips: "02", usps: "AK", name: "Alaska" },
  { fips: "11", usps: "DC", name: "District of Columbia" },
  { fips: "10", usps: "DE", name: "Delaware" },
];
const fmt = (v: number) => v.toFixed(1);

describe("mapRows", () => {
  it("orders by value, keeps every state, puts missing values last and never turns them into zero", () => {
    const rows = mapRows(states, { "01": 72.6, "11": 617.9, "10": 151.3 }, { "11": { rank: 1 } });
    expect(rows.map((r) => [r.usps, r.value, r.rank])).toEqual([
      ["DC", 617.9, 1],
      ["DE", 151.3, null],
      ["AL", 72.6, null],
      ["AK", null, null],
    ]);
  });
  it("breaks ties by name", () => {
    expect(
      mapRows(states, { "01": 5, "02": 5 }, {})
        .map((r) => r.usps)
        .slice(0, 2),
    ).toEqual(["AL", "AK"]);
  });
});

describe("mapTakeaway", () => {
  it("names the highest state with its value and unit", () => {
    const rows = mapRows(states, { "01": 72.6, "11": 617.9 }, {});
    expect(mapTakeaway(rows, fmt, "per 100,000 residents")).toBe(
      "District of Columbia is highest, at 617.9 per 100,000 residents",
    );
  });
  it("names tied states together", () => {
    const rows = mapRows(states, { "01": 5, "02": 5, "10": 1 }, {});
    expect(mapTakeaway(rows, fmt, "sources")).toBe(
      "Alabama and Alaska are highest, at 5.0 sources",
    );
    const all = mapRows(states, { "01": 5, "02": 5, "10": 5, "11": 5 }, {});
    expect(mapTakeaway(all, fmt, "")).toBe("4 states share the highest value, 5.0");
  });
  it("says nothing when no state has a value", () => {
    expect(mapTakeaway(mapRows(states, {}, {}), fmt, "x")).toBeNull();
    expect(mapTakeaway([], fmt, "x")).toBeNull();
  });
});
