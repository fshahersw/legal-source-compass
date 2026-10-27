import { describe, expect, it } from "vitest";
import { lawyerShares, monthlyPoints, parseLawyerYears, transferWindow, windowSum } from "./reportingContext";

// 36 months from 2023-01 to 2025-12: 10 a month in 2023, 20 in 2024, 50 in 2025.
const series = {
  coverage_from: "2023-01",
  coverage_to: "2025-12",
  vals: [...Array(12).fill(10), ...Array(12).fill(20), ...Array(12).fill(50)] as number[],
};

describe("windowSum", () => {
  it("sums months inside the series and flags a window that runs past it", () => {
    expect(windowSum(series, "2024-01", 12)).toEqual({ value: 240, partial: false });
    expect(windowSum(series, "2025-07", 12)).toEqual({ value: 300, partial: true });
    expect(windowSum(series, "2027-01", 12)).toEqual({ value: null, partial: true });
  });
});

describe("transferWindow", () => {
  const t = { mdl: 3140, title: "Depo-Provera", pending: 6412, total: 6524, sourceUrl: null };
  it("compares the 12 months before and from the transfer month when both are complete", () => {
    const w = transferWindow(series, { ...t, transferred: "2025-01-15" });
    expect(w).toMatchObject({ transferMonth: "2025-01", before: 240, after: 600, change: 150 });
  });
  it("never compares a partial window", () => {
    const w = transferWindow(series, { ...t, transferred: "2025-06-04" });
    expect(w.afterPartial).toBe(true);
    expect(w.change).toBeNull();
  });
  it("is not recorded without a transfer date", () => {
    expect(transferWindow(series, { ...t, transferred: null }).before).toBeNull();
  });
});

describe("lawyer share", () => {
  it("parses the product series and keeps an unknown lawyer count null", () => {
    const years = parseLawyerYears([
      { year: 2026, reports: 10349, lawyer: 9846, partial: true },
      { year: 2025, reports: 100, lawyer: null },
      { year: "x", reports: 1 },
    ]);
    expect(years.map((y) => y.year)).toEqual([2025, 2026]);
    const shares = lawyerShares({ mdl: 3140, product: null, search: null, sourceUrl: null, years });
    expect(shares[0]!.share).toBeNull();
    expect(shares[1]).toMatchObject({ share: 95.1, partial: true });
  });
});

describe("monthlyPoints", () => {
  it("starts at the requested month inside the window", () => {
    const pts = monthlyPoints(series, "2025-10");
    expect(pts.map((p) => p.month)).toEqual(["2025-10", "2025-11", "2025-12"]);
  });
});
