import { describe, expect, it } from "vitest";
import {
  bySurgeDesc,
  capped,
  joinCapped,
  numTick,
  surgeRatioLabel,
  usdMillionsTick,
} from "./listDisplay";

describe("capped lists", () => {
  it("reports how many rows a capped list hides, and hides none when expanded", () => {
    const rows = Array.from({ length: 11 }, (_, i) => i);
    expect(capped(rows, 8)).toEqual({ shown: [0, 1, 2, 3, 4, 5, 6, 7], hidden: 3 });
    expect(capped(rows, 8, true)).toEqual({ shown: rows, hidden: 0 });
    expect(capped([1, 2], 8)).toEqual({ shown: [1, 2], hidden: 0 });
    expect(capped([], 8)).toEqual({ shown: [], hidden: 0 });
  });

  it("says how many joined items were left out", () => {
    expect(joinCapped(["A", "B", "C", "D"], 2, "; ")).toBe("A; B +2 more");
    expect(joinCapped(["A", "B"], 2, "; ")).toBe("A; B");
    expect(joinCapped([], 3, ", ")).toBe("");
  });

  it("counts the true total when the stored list is itself a capped sample", () => {
    // A defendant group of 12 cases whose builder kept the 5 largest case numbers.
    const stored = ["N1", "N2", "N3", "N4", "N5"];
    expect(joinCapped(stored, 3, ", ", 12)).toBe("N1, N2, N3 +9 more");
    expect(joinCapped(stored, 3, ", ", 28)).toBe("N1, N2, N3 +25 more");
    expect(joinCapped(stored, 3, ", ", 1_200)).toBe("N1, N2, N3 +1,197 more");
    // Stored items fit under the limit but the total is larger: the rest are still counted.
    expect(joinCapped(["N1", "N2"], 3, ", ", 4)).toBe("N1, N2 +2 more");
    // A total below what is stored never hides stored items from the count.
    expect(joinCapped(stored, 3, ", ", 2)).toBe("N1, N2, N3 +2 more");
    expect(joinCapped(["N1", "N2", "N3"], 3, ", ", 3)).toBe("N1, N2, N3");
    // No stored item: no bare "+N more".
    expect(joinCapped([], 3, ", ", 7)).toBe("");
  });
});

describe("surge ratio label and order", () => {
  it("never prints Infinity for a zero baseline", () => {
    expect(surgeRatioLabel(2.44)).toBe("2.4×");
    expect(surgeRatioLabel(Infinity)).toBe("from 0");
    expect(surgeRatioLabel(Number.NaN)).toBe("from 0");
  });

  it("ranks zero baselines first without a NaN comparator, ties by latest cases", () => {
    const rows = [
      { code: "A", ratio: 2.5, latest: 10 },
      { code: "B", ratio: Infinity, latest: 3 },
      { code: "C", ratio: 4, latest: 8 },
      { code: "D", ratio: Infinity, latest: 9 },
      { code: "E", ratio: 2.5, latest: 20 },
    ];
    expect([...rows].sort(bySurgeDesc).map((r) => r.code)).toEqual(["D", "B", "C", "E", "A"]);
    expect(bySurgeDesc(rows[1]!, rows[3]!)).toBe(6);
    expect(Number.isNaN(bySurgeDesc(rows[1]!, rows[1]!))).toBe(false);
  });
});

describe("axis ticks", () => {
  it("uses thousands separators below 10,000 and compact notation above", () => {
    expect(numTick(0)).toBe("0");
    expect(numTick(1250)).toBe("1,250");
    expect(numTick(2.5)).toBe("2.5");
    expect(numTick(12_400)).toBe("12.4K");
    expect(numTick(1_500_000)).toBe("1.5M");
    expect(numTick(Number.NaN)).toBe("");
  });

  it("formats million-dollar axes as $M below $1B and $B above, never '$12KM'", () => {
    expect(usdMillionsTick(0)).toBe("$0M");
    expect(usdMillionsTick(950)).toBe("$950M");
    expect(usdMillionsTick(2.5)).toBe("$2.5M");
    expect(usdMillionsTick(1500)).toBe("$1.5B");
    expect(usdMillionsTick(5871)).toBe("$5.9B");
    expect(usdMillionsTick(12_400)).toBe("$12.4B");
    expect(usdMillionsTick(-300)).toBe("-$300M");
    expect(usdMillionsTick(Number.NaN)).toBe("");
  });
});
