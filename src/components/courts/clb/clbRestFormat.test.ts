import { describe, expect, it } from "vitest";
import { chartFrom, yearSpan } from "./clbRestFormat";

describe("clbRestFormat", () => {
  it("starts a yearly chart at the first year with 2% of the peak and counts what is left out", () => {
    const rows = [
      { yr: 1980, n: 40 },
      { yr: 1981, n: 70 },
      { yr: 1984, n: 4000 },
      { yr: 1985, n: 150 },
      { yr: 2010, n: 145000 },
    ];
    const r = chartFrom(rows, (x) => x.n);
    expect(r.rows.map((x) => x.yr)).toEqual([1984, 1985, 2010]);
    expect(r.earlier).toBe(110);
    expect(chartFrom([], (x: { yr: number }) => x.yr)).toEqual({ rows: [], earlier: 0 });
    expect(chartFrom(rows.slice(2), (x) => x.n).earlier).toBe(0);
  });

  it("writes a year span from dates or years, never inventing an end", () => {
    expect(yearSpan("1998-02-01", "2022-09-18")).toBe("1998–2022");
    expect(yearSpan(2003, 2003)).toBe("2003");
    expect(yearSpan(null, "2020-01-01")).toBe("2020");
    expect(yearSpan(undefined, null)).toBeNull();
  });
});
