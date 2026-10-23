import { describe, expect, it } from "vitest";
import { buildCourtPlYears } from "./court";

const base = {
  courtId: "scd",
  courtName: "District of South Carolina",
  years: [2014, 2015, 2016, 2017],
  rank: { pl: 1, of: 94 },
} as const;

describe("buildCourtPlYears", () => {
  const b = buildCourtPlYears({
    ...base,
    pl: [400, null, 1200, 9000],
    civil: [3000, 3100, 3500, 11000],
    nationalShare: [1.2, null, 3.4, 12.6],
  })!;

  it("draws products-liability filings by fiscal year and leaves a year the tables do not give as a gap", () => {
    expect(b.series[0]!.points.map((p) => p.value)).toEqual([400, null, 1200, 9000]);
    expect(b.xKind).toBe("fy");
    expect(b.latest).toMatchObject({ period: "FY2017", value: 9000 });
  });

  it("states the court's share of its own civil filings and of the national total, with its rank", () => {
    const text = b.notes.join(" ");
    expect(text).toContain(
      "In FY2017 these 9,000 cases were 81.8% of the 11,000 civil cases filed in the court",
    );
    expect(text).toContain(
      "held 12.6% of all products-liability cases filed in federal district courts in FY2017, ranking 1 of 94 districts",
    );
    expect(text).toContain("include MDL actions transferred to the court");
  });

  it("states no rank when the last counted year is not the year the stored ranks describe", () => {
    const older = buildCourtPlYears({
      ...base,
      pl: [400, 500, 1200, null],
      civil: [3000, 3100, 3500, 11000],
      nationalShare: [1.2, 1.5, 3.4, null],
    })!;
    const text = older.notes.join(" ");
    expect(text).toContain("held 3.4% of all products-liability cases");
    expect(text).not.toContain("ranking");
  });

  it("leaves out a baseline it cannot compute and returns null when nothing is counted", () => {
    const thin = buildCourtPlYears({
      ...base,
      pl: [5, 6, 7, 8],
      civil: [null, null, null, null],
      nationalShare: [null, null, null, null],
    })!;
    expect(thin.notes.join(" ")).not.toContain("of the");
    expect(thin.notes.join(" ")).not.toContain("held");
    expect(
      buildCourtPlYears({ ...base, pl: [null, null, null, null], civil: [], nationalShare: [] }),
    ).toBeNull();
  });
});
