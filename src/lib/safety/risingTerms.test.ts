import { describe, expect, it } from "vitest";
import { risingTerms, termSeries } from "./risingTerms";

const periods = [
  "2024-Q3",
  "2024-Q4",
  "2025-Q1",
  "2025-Q2",
  "2025-Q3",
  "2025-Q4",
  "2026-Q1",
  "2026-Q2",
];
const data: Record<string, (number | null)[]> = {
  MENINGIOMA: [80, 80, 76, 80, 471, 692, 1237, 8360],
  NAUSEA: [500, 500, 500, 500, 400, 400, 400, 400],
  // missing from a truncated period: not comparable, never treated as 0
  HEADACHE: [10, null, 10, 10, 90, 90, 90, 90],
};
const value = (t: string, p: string) => data[t]?.[periods.indexOf(p)] ?? null;

describe("risingTerms", () => {
  it("compares the last four quarters with the four before, only where every quarter records the term", () => {
    const r = risingTerms(Object.keys(data), periods, value)!;
    expect(r.grain).toBe("quarter");
    expect(r.recentPeriods).toEqual(["2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]);
    expect(r.rising.map((x) => x.term)).toEqual(["MENINGIOMA"]);
    expect(r.rising[0]).toMatchObject({ recent: 10760, prior: 316 });
    expect(r.notComparable).toBe(1);
  });
  it("needs two full windows", () => {
    expect(risingTerms(["A"], ["2025-Q1"], () => 1)).toBeNull();
  });
  it("uses one-year windows for yearly breakdowns", () => {
    const r = risingTerms(["A"], ["2024", "2025"], (_t, p) => (p === "2025" ? 9 : 3))!;
    expect(r).toMatchObject({ k: 1, grain: "year" });
    expect(r.rising[0]!.change).toBe(200);
  });
});

describe("termSeries", () => {
  it("keeps unrecorded periods null", () => {
    expect(termSeries(["HEADACHE"], periods, value)[0]!.points[1]!.value).toBeNull();
  });
});
