import { describe, expect, it } from "vitest";
import {
  changePct,
  coverageShares,
  compact,
  int,
  listAnd,
  medianOf,
  NOT_RECORDED,
  pct,
  plural,
  shareOf,
  signedPct,
  times,
  topShare,
  usableTakeaways,
  usdCompact,
} from "./analysisFormat";

describe("analysisFormat", () => {
  it("never guesses an unknown number", () => {
    expect(int(null)).toBe(NOT_RECORDED);
    expect(int(undefined)).toBe(NOT_RECORDED);
    expect(int(Number.NaN)).toBe(NOT_RECORDED);
    expect(pct(null)).toBe(NOT_RECORDED);
    expect(signedPct(undefined)).toBe(NOT_RECORDED);
    expect(compact(Number.POSITIVE_INFINITY)).toBe(NOT_RECORDED);
    expect(usdCompact(null)).toBe(NOT_RECORDED);
  });

  it("formats integers, percents and signed changes", () => {
    expect(int(1234567.4)).toBe("1,234,567");
    expect(pct(41.84)).toBe("41.8%");
    expect(pct(7, 0)).toBe("7%");
    expect(signedPct(4.25)).toBe("+4.3%");
    expect(signedPct(-3.14)).toBe("−3.1%");
    expect(signedPct(0)).toBe("0.0%");
  });

  it("formats dollars at the right magnitude", () => {
    expect(usdCompact(7_190_000_000)).toBe("$7.19B");
    expect(usdCompact(24_300_000)).toBe("$24.3M");
    expect(usdCompact(950_000)).toBe("$950K");
    expect(usdCompact(12_400)).toBe("$12,400");
    expect(usdCompact(-2_000_000)).toBe("−$2M");
  });

  it("compacts large counts and leaves small ones whole", () => {
    expect(compact(9_999)).toBe("9,999");
    expect(compact(12_345)).toBe("12.3K");
    expect(compact(1_500_000)).toBe("1.5M");
  });

  it("pluralises", () => {
    expect(plural(1, "MDL")).toBe("1 MDL");
    expect(plural(3, "MDL")).toBe("3 MDLs");
    expect(plural(0, "case", "cases")).toBe("0 cases");
  });

  it("computes shares and ratios only from a positive base", () => {
    expect(shareOf(25, 200)).toBe(12.5);
    expect(shareOf(5, 0)).toBeNull();
    expect(shareOf(null, 10)).toBeNull();
    expect(times(9, 3)).toBe("3.0×");
    expect(times(1, 0)).toBeNull();
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(80, 100)).toBe(-20);
    expect(changePct(5, 0)).toBeNull();
  });

  it("computes top-k share and medians, ignoring unknowns", () => {
    expect(topShare([50, 30, 10, 10], 2)).toBe(80);
    expect(topShare([], 3)).toBeNull();
    expect(topShare([0, 0], 1)).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, null, 2, undefined])).toBe(2);
    expect(medianOf([])).toBeNull();
  });

  it("keeps takeaways only when at least two are usable and unique", () => {
    const a = { id: "a", figure: "1", text: "a" };
    const b = { id: "b", figure: "2", text: "b" };
    expect(usableTakeaways([a, null, b])).toEqual([a, b]);
    expect(usableTakeaways([a, null])).toEqual([]);
    expect(usableTakeaways([a, { ...a, figure: "9" }])).toEqual([]);
    expect(usableTakeaways([a, { id: "c", figure: NOT_RECORDED, text: "c" }, b], 5)).toEqual([
      a,
      b,
    ]);
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      figure: String(i),
      text: "x",
    }));
    expect(usableTakeaways(many)).toHaveLength(5);
    expect(usableTakeaways(many, 3)).toHaveLength(3);
  });

  it("joins lists in prose order", () => {
    expect(listAnd([])).toBe("");
    expect(listAnd(["a"])).toBe("a");
    expect(listAnd(["a", "b"])).toBe("a and b");
    expect(listAnd(["a", "b", "c"])).toBe("a, b and c");
  });

  it("drops empty coverage segments and sums shares to 100", () => {
    const shares = coverageShares([
      { key: "x", value: 3 },
      { key: "y", value: 0 },
      { key: "z", value: 1 },
    ]);
    expect(shares.map((s) => s.segment.key)).toEqual(["x", "z"]);
    expect(shares.reduce((a, s) => a + s.sharePct, 0)).toBeCloseTo(100);
    expect(coverageShares([{ key: "x", value: 0 }])).toEqual([]);
  });
});
