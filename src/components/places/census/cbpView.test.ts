import { describe, expect, it } from "vitest";
import { parseCbp } from "@/lib/external/censusModel";
import { cbpTotals, sectorRows } from "./cbpView";

const geo = parseCbp({
  geoid: "56",
  level: "state",
  name: "Wyoming",
  usps: "WY",
  years: [2022, 2023],
  latest_year: 2023,
  series: {
    "00": { "2022": [19000, 240000, 11000000], "2023": [20000, 250000, 12000000] },
    "21": { "2023": [400, 20000, 2000000] },
    "23": { "2023": [3000, 30000, 1500000] },
    "62": { "2023": [900, null, null, { emp: "S", pay: "S" }] },
    "11": { "2023": [100, null, null, { emp: "D" }] },
  },
})!;

describe("cbpTotals", () => {
  it("lists the all-sector totals by year", () => {
    expect(cbpTotals(geo)).toEqual([
      { year: 2022, establishments: 19000, employees: 240000, payroll: 11000000 },
      { year: 2023, establishments: 20000, employees: 250000, payroll: 12000000 },
    ]);
  });
});

describe("sectorRows", () => {
  const rows = sectorRows(geo, 2023);
  it("orders by published employment and puts withheld sectors last, alphabetically", () => {
    expect(rows.map((r) => r.sector)).toEqual(["23", "21", "11", "62"]);
  });
  it("computes the share only from two published counts", () => {
    expect(rows[0]!.share).toBeCloseTo(12);
    expect(rows[2]!.share).toBeNull();
  });
  it("keeps the withholding flag and never invents a number", () => {
    const withheld = rows.find((r) => r.sector === "62")!;
    expect(withheld.employees).toBeNull();
    expect(withheld.withheld).toBe("S");
    expect(withheld.establishments).toBe(900);
  });
  it("is empty for a year with no data", () => {
    expect(sectorRows(geo, 1999)).toEqual([]);
  });
});
