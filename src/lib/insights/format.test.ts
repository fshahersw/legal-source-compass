import { describe, expect, it } from "vitest";
import {
  circuitLabel,
  clip,
  fmtDec,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtSignedInt,
  fmtSignedPct,
  fmtTimes,
  fmtWords,
  joinList,
  latestCompleteFiscalYear,
  median,
  moved,
  pctChange,
  sharePct,
  sortAsc,
  sortDesc,
  sum,
  timesOf,
} from "./format";

describe("number formatting", () => {
  it("formats counts, decimals and percentages with one rounding rule", () => {
    expect(fmtInt(1307769)).toBe("1,307,769");
    expect(fmtInt(2.5)).toBe("3");
    expect(fmtDec(3.14159, 1)).toBe("3.1");
    expect(fmtPct(18.24)).toBe("18.2%");
    expect(fmtPct(80.5, 0)).toBe("81%");
  });

  it("signs changes and never shows a signed zero", () => {
    expect(fmtSignedPct(18.24)).toBe("+18.2%");
    expect(fmtSignedPct(-18.24)).toBe("-18.2%");
    expect(fmtSignedPct(0.04)).toBe("0.0%");
    expect(fmtSignedPct(-0.04)).toBe("0.0%");
    expect(fmtSignedInt(5190)).toBe("+5,190");
    expect(fmtSignedInt(-3392)).toBe("-3,392");
    expect(fmtSignedInt(0.2)).toBe("0");
  });

  it("describes a move in words", () => {
    expect(moved(18.24)).toBe("up 18.2%");
    expect(moved(-0.9)).toBe("down 0.9%");
    expect(moved(0.01)).toBe("unchanged");
    expect(moved(99.06, 0)).toBe("up 99%");
  });

  it("writes big numbers in words and dollars in words", () => {
    expect(fmtWords(1307769)).toBe("1.3 million");
    expect(fmtWords(204977)).toBe("204,977");
    expect(fmtWords(2_500_000_000)).toBe("2.5 billion");
    expect(fmtMoney(3_923_550_962.8)).toBe("$3.9 billion");
    expect(fmtMoney(44_497_238.8)).toBe("$44.5 million");
    expect(fmtMoney(12_345)).toBe("$12,345");
    expect(fmtMoney(-2_000_000)).toBe("-$2 million");
    expect(fmtTimes(6.13)).toBe("6.1 times");
    expect(fmtTimes(226.1)).toBe("226 times");
  });
});

describe("derived values return null instead of a guess", () => {
  it("pctChange needs two finite numbers and a positive base", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(50, 100)).toBeCloseTo(-50);
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(1, -5)).toBeNull();
    expect(pctChange(null, 5)).toBeNull();
    expect(pctChange(5, undefined)).toBeNull();
    expect(pctChange(Number.NaN, 5)).toBeNull();
  });
  it("sharePct and timesOf need a positive whole", () => {
    expect(sharePct(25, 200)).toBe(12.5);
    expect(sharePct(5, 0)).toBeNull();
    expect(sharePct(null, 10)).toBeNull();
    expect(timesOf(6, 3)).toBe(2);
    expect(timesOf(6, 0)).toBeNull();
  });
});

describe("statistics helpers", () => {
  it("median ignores missing values", () => {
    expect(median([3, null, 1, undefined, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, undefined])).toBeNull();
    expect(median([])).toBeNull();
  });
  it("sum ignores non-numbers", () => {
    expect(sum([1, null, 2, undefined, Number.NaN])).toBe(3);
  });
  it("sortDesc / sortAsc drop missing values and keep ties in input order", () => {
    const items = [
      { n: "a", v: 2 },
      { n: "b", v: null },
      { n: "c", v: 2 },
      { n: "d", v: 5 },
    ];
    expect(sortDesc(items, (i) => i.v).map((i) => i.n)).toEqual(["d", "a", "c"]);
    expect(sortAsc(items, (i) => i.v).map((i) => i.n)).toEqual(["a", "c", "d"]);
  });
});

describe("text helpers", () => {
  it("joins lists in plain English", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["A"])).toBe("A");
    expect(joinList(["A", "B"])).toBe("A and B");
    expect(joinList(["A", "B", "C"])).toBe("A, B and C");
  });
  it("clips at a word boundary", () => {
    expect(clip("short")).toBe("short");
    const out = clip("The quick brown fox jumps over the lazy dog again and again", 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
  it("labels circuits", () => {
    expect(circuitLabel(0)).toBe("D.C. Circuit");
    expect(circuitLabel(1)).toBe("1st Circuit");
    expect(circuitLabel(2)).toBe("2nd Circuit");
    expect(circuitLabel(3)).toBe("3rd Circuit");
    expect(circuitLabel(11)).toBe("11th Circuit");
    expect(circuitLabel(12)).toBeNull();
    expect(circuitLabel(null)).toBeNull();
  });
  it("finds the latest complete federal fiscal year", () => {
    expect(latestCompleteFiscalYear("2026-10-10")).toBe(2026);
    expect(latestCompleteFiscalYear("2026-09-29")).toBe(2025);
    expect(latestCompleteFiscalYear("garbage")).toBeNull();
    expect(latestCompleteFiscalYear(null)).toBeNull();
  });
});
