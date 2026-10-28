import { describe, expect, it } from "vitest";
import { clearanceCallout, clearanceRows } from "./clearanceRate";

describe("civil clearance flow ratio", () => {
  it.each([
    [80, 80],
    [120, 120],
  ])("%s terminations per 100 filings is %s percent", (terminations, rate) => {
    expect(
      clearanceRows([{ fy: 2025, filings: 100, terminations, partial: false }])[0]?.rate,
    ).toBe(rate);
  });

  it("does not divide by zero", () => {
    expect(
      clearanceRows([{ fy: 2025, filings: 0, terminations: 120, partial: false }])[0]?.rate,
    ).toBeNull();
  });

  it("retains absent years as gaps and excludes partial years", () => {
    const rows = clearanceRows([
      { fy: 2023, filings: 100, terminations: 80, partial: false },
      { fy: 2025, filings: 100, terminations: 120, partial: false },
      { fy: 2026, filings: 40, terminations: 20, partial: true },
    ]);
    expect(rows.map((r) => [r.fy, r.rate])).toEqual([
      [2023, 80],
      [2024, null],
      [2025, 120],
    ]);
  });

  it("does not resolve ambiguous duplicate years by picking a row", () => {
    expect(
      clearanceRows([
        { fy: 2025, filings: 100, terminations: 80, partial: false },
        { fy: 2025, filings: 100, terminations: 90, partial: false },
      ])[0]?.rate,
    ).toBeNull();
  });
});

describe("clearanceCallout", () => {
  it("uses the latest year with a ratio and its change from the exact previous year", () => {
    const c = clearanceCallout(
      clearanceRows([
        { fy: 2023, filings: 100, terminations: 90, partial: false },
        { fy: 2024, filings: 100, terminations: 95, partial: false },
        { fy: 2025, filings: 100, terminations: 104, partial: false },
        { fy: 2026, filings: 30, terminations: 50, partial: true },
      ]),
    )!;
    expect(c.fy).toBe(2025);
    expect(c.rate).toBe(104);
    expect(c.changePts).toBe(9);
    expect(c.yearsAtOrAbove).toBe(1);
    expect(c.yearsWithRate).toBe(3);
  });

  it("skips a trailing zero-filing year instead of filling it, and leaves the change unrecorded across a gap", () => {
    const c = clearanceCallout(
      clearanceRows([
        { fy: 2022, filings: 100, terminations: 110, partial: false },
        { fy: 2024, filings: 100, terminations: 100, partial: false },
        { fy: 2025, filings: 0, terminations: 12, partial: false },
      ]),
    )!;
    expect(c.fy).toBe(2024);
    expect(c.changePts).toBeNull();
    expect(c.yearsAtOrAbove).toBe(2);
  });

  it("is null when no complete year has a ratio", () => {
    expect(
      clearanceCallout(
        clearanceRows([{ fy: 2026, filings: 10, terminations: 5, partial: true }]),
      ),
    ).toBeNull();
  });
});
