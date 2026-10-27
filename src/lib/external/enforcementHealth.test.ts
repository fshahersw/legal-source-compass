import { describe, expect, it } from "vitest";
import {
  coverageBreak,
  fcaYear,
  isPartialYear,
  lastChange,
  median,
  sizeBucket,
  type TopicYear,
} from "./enforcementHealth";

describe("coverageBreak", () => {
  it("finds the 2012 to 2013 coverage jump of the yearly partitions", () => {
    // partition sizes measured 2026-10-27
    const parts = [
      ["2009", 1149],
      ["2010", 1229],
      ["2011", 1501],
      ["2012", 1351],
      ["2013", 18266],
      ["2014", 18546],
    ].map(([year, records]) => ({
      dataset: `doj_press_releases_${year}`,
      year: String(year),
      records: Number(records),
    }));
    expect(coverageBreak(parts)).toEqual({ year: "2013", before: 1351, after: 18266 });
    expect(coverageBreak(parts.slice(4))).toBeNull();
  });
});

describe("sizeBucket and fcaYear", () => {
  it("puts every release in exactly one band and takes the median of stated figures", () => {
    expect(sizeBucket(null)).toBe("none");
    expect(sizeBucket(999_999)).toBe("none");
    expect(sizeBucket(1e6)).toBe("m1");
    expect(sizeBucket(5e7)).toBe("m10");
    expect(sizeBucket(1.2e9)).toBe("m100");
    const out = fcaYear("2025", false, [null, 5e5, 2e6, 3e7, 4e6, 2e8]);
    expect(out.sizes).toEqual({ year: "2025", partial: false, none: 2, m1: 2, m10: 1, m100: 1 });
    expect(out.sizes.none + out.sizes.m1 + out.sizes.m10 + out.sizes.m100).toBe(6);
    expect(out.median).toEqual({ year: "2025", partial: false, median: 17e6, n: 4 });
  });

  it("returns a null median, not zero, when no release states $1M or more", () => {
    expect(fcaYear("2015", false, [null]).median.median).toBeNull();
    expect(median([])).toBeNull();
  });
});

describe("isPartialYear and lastChange", () => {
  const rows: TopicYear[] = [
    { year: "2024", partial: false, fca: 253, hcf: 432, opioids: 949, rx: 218 },
    { year: "2025", partial: false, fca: 248, hcf: 390, opioids: 723, rx: 131 },
    { year: "2026", partial: true, fca: 209, hcf: 317, opioids: 479, rx: 96 },
  ];
  it("marks the year of the latest release as partial", () => {
    expect(isPartialYear("2026", "2026-10-27")).toBe(true);
    expect(isPartialYear("2025", "2026-10-27")).toBe(false);
    expect(isPartialYear("2025", null)).toBe(false);
  });
  it("compares the latest complete year with the year before and never uses the partial year", () => {
    const c = lastChange(rows, "fca")!;
    expect(c).toMatchObject({ year: "2025", value: 248, prior: 253, delta: -5 });
    expect(c.pct).toBeCloseTo(-1.976, 2);
  });
});
