import { describe, expect, it } from "vitest";
import type { Citator } from "@/lib/external/caselaw";
import { citeLine, courtBars, decadeBars, fmtDay, fmtInt, sortCiting } from "./caseFormat";
import { liveTier, normalizeCaseSearch } from "./caseSearch";

describe("normalizeCaseSearch", () => {
  it("keeps valid values and drops the rest", () => {
    expect(
      normalizeCaseSearch({
        mode: "fulltext",
        q: "  miranda ",
        tier: "2",
        court: "ca9",
        from: "1999-02-30",
        to: "2001-12-31",
        status: "Published",
        sort: "newest",
        page: "3",
        semantic: "true",
        cursor: "abc%3D",
        extra: "x",
      }),
    ).toEqual({
      mode: "fulltext",
      q: "  miranda ",
      tier: 2,
      court: "ca9",
      to: "2001-12-31",
      status: "Published",
      sort: "newest",
      page: 3,
      semantic: true,
      cursor: "abc%3D",
    });
    expect(
      normalizeCaseSearch({
        mode: "x",
        tier: 4,
        court: "CA 9",
        page: 1,
        sort: "best",
        status: "Draft",
        cursor: "<script>",
      }),
    ).toEqual({});
    expect(normalizeCaseSearch({ q: "   " })).toEqual({});
  });
  it("live search covers only the appellate and state tiers", () => {
    expect(liveTier(1)).toBeNull();
    expect(liveTier(2)).toBe(2);
    expect(liveTier(undefined)).toBeNull();
  });
});

describe("caseFormat", () => {
  it("formats days and counts without guessing", () => {
    expect(fmtDay("1966-06-13")).toBe("June 13, 1966");
    expect(fmtDay(null)).toBe("Not recorded");
    expect(fmtInt(null)).toBe("Not recorded");
    expect(fmtInt(58593)).toBe("58,593");
    expect(citeLine("Miranda v. Arizona", ["384 U.S. 436"], "1966-06-13")).toBe(
      "Miranda v. Arizona, 384 U.S. 436 (1966)",
    );
    expect(citeLine("A v. B", [], null)).toBe("A v. B");
  });
  it("builds court and decade bars", () => {
    const c = {
      byCourt: [
        { courtId: "ca1", n: 6 },
        { courtId: "ca2", n: 3 },
        { courtId: "cal", n: 1 },
      ],
      byDecade: [
        { decade: 1990, n: 4 },
        { decade: null, n: 1 },
      ],
      courts: { ca1: "1st Cir." },
    } as unknown as Citator;
    expect(courtBars(c, 2).map((b) => [b.label, b.n, Math.round(b.pct)])).toEqual([
      ["1st Cir.", 6, 100],
      ["ca2", 3, 50],
      ["1 other courts", 1, 17],
    ]);
    expect(decadeBars(c).map((b) => [b.label, b.pct])).toEqual([
      ["1990s", 100],
      ["Undated", 25],
    ]);
  });
  it("sorts citing cases", () => {
    const rows = [
      { id: 1, date: "2001-01-01", depth: 1 },
      { id: 2, date: null, depth: 5 },
      { id: 3, date: "1999-01-01", depth: 2 },
    ];
    expect(sortCiting(rows, "rank").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortCiting(rows, "newest").map((r) => r.id)).toEqual([1, 3, 2]);
    expect(sortCiting(rows, "oldest").map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortCiting(rows, "depth").map((r) => r.id)).toEqual([2, 3, 1]);
  });
});
