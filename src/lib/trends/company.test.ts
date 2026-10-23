import { describe, expect, it } from "vitest";
import { buildCompanyEnforcementYears, COMPANY_READ_LIMITS, mayBeTruncated } from "./company";

const src = (dates: (string | null)[], limit: number, total: number | null = dates.length) => ({
  dates,
  limit,
  total,
});
const none = { dates: [], limit: 100, total: 0 };
const base = { cik: "0000200406", today: "2026-10-23" } as const;

describe("mayBeTruncated", () => {
  it("uses the corpus total when there is one, and the read limit when there is not", () => {
    expect(mayBeTruncated(src(["2020-01-01"], 200, 5))).toBe(true);
    expect(mayBeTruncated(src(["2020-01-01"], 200, 1))).toBe(false);
    expect(
      mayBeTruncated({ dates: new Array(100).fill("2020-01-01"), limit: 100, total: null }),
    ).toBe(true);
    expect(mayBeTruncated({ dates: ["2020-01-01"], limit: 100, total: null })).toBe(false);
  });
});

describe("buildCompanyEnforcementYears", () => {
  const doj = src(["2013-11-04", "2013-11-04", "2013-11-04", "2011-04-08", "2010-01-15"], 200);
  const sec = src(["2011-04-08"], 100);
  const ftc = src(
    ["2017-09-27", "2012-06-11", "2006-12-12", "2005-11-02", "1995-12-19"],
    100,
    null,
  );
  const b = buildCompanyEnforcementYears({ ...base, doj, sec, ftc })!;
  const pts = (id: string) => b.series.find((s) => s.id === id)!.points;

  it("runs the span to the current year and counts a blank year once, however many sources are stacked", () => {
    const years = b.series[0]!.points.map((p) => p.x);
    expect(years[0]).toBe("1995");
    expect(years.at(-1)).toBe("2026");
    expect(b.series[0]!.points.at(-1)).toMatchObject({ value: null, partial: true });
    // 32 years from 1995 to 2026; items fall in 1995, 2005, 2006, 2010, 2011, 2012, 2013, 2017
    expect(b.gaps).toBe(32 - 8);
    expect(b.latest).toMatchObject({ period: "1995–2017", value: 11 });
  });

  it("counts each source by the year of its own date and leaves a year with no match blank", () => {
    expect(pts("doj").find((p) => p.x === "2013")!.value).toBe(3);
    expect(pts("sec").find((p) => p.x === "2011")!.value).toBe(1);
    expect(pts("ftc").find((p) => p.x === "1995")!.value).toBe(1);
    expect(pts("doj").find((p) => p.x === "2014")!.value).toBeNull();
    expect(pts("doj")[0]!.x).toBe("1995");
    expect(b.stacked).toBe(true);
  });

  it("reads the latest value from all sources together, and marks the current year partial", () => {
    const withNow = buildCompanyEnforcementYears({
      ...base,
      doj: src([...doj.dates, "2026-02-02"], 200),
      sec,
      ftc,
    })!;
    expect(withNow.series[0]!.points.at(-1)).toMatchObject({ x: "2026", value: 1, partial: true });
    expect(withNow.latest).toMatchObject({
      period: "1995–2026",
      value: 12,
      seriesLabel: "All sources",
    });
    expect(withNow.latest!.change).toBeNull();
  });

  it("leaves a source out, and says so, when its rows may be cut off by the read limit", () => {
    const full = new Array(COMPANY_READ_LIMITS.sec).fill("2015-05-05");
    const cut = buildCompanyEnforcementYears({
      ...base,
      doj,
      sec: { dates: full, limit: COMPANY_READ_LIMITS.sec, total: 130 },
      ftc,
    })!;
    expect(cut.series.map((s) => s.id)).toEqual(["doj", "ftc"]);
    expect(cut.notes.join(" ")).toContain("SEC actions has more items than the page loads");
  });

  it("notes undated items and never charts FTC cases", () => {
    const d = buildCompanyEnforcementYears({
      ...base,
      doj: src([...doj.dates, null], 200),
      sec,
      ftc,
    })!;
    expect(d.notes.join(" ")).toContain("1 item has no date");
    expect(d.notes.join(" ")).toContain("FTC cases are listed in the table but not charted");
  });

  it("returns null for a thin record: fewer than five dated items or a single year", () => {
    expect(
      buildCompanyEnforcementYears({
        ...base,
        doj: src(["2013-01-01", "2014-01-01"], 200),
        sec: none,
        ftc: none,
      }),
    ).toBeNull();
    expect(
      buildCompanyEnforcementYears({
        ...base,
        doj: src(new Array(6).fill("2013-01-01"), 200),
        sec: none,
        ftc: none,
      }),
    ).toBeNull();
    expect(buildCompanyEnforcementYears({ ...base, doj: none, sec: none, ftc: none })).toBeNull();
  });
});
