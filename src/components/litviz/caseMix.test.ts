import { describe, expect, it } from "vitest";
import { caseMixRows, OTHER_KEY, type GroupSeries, type NationalYear } from "./caseMix";

const g = (id: string, values: Record<number, number | null>): GroupSeries => ({
  id,
  label: id.toUpperCase(),
  years: Object.entries(values).map(([fy, filings]) => ({
    fy: Number(fy),
    partial: false,
    filings,
  })),
});
const nat = (values: Record<number, number | null>, partial: number[] = []): NationalYear[] =>
  Object.entries(values).map(([fy, filings]) => ({
    fy: Number(fy),
    filings,
    partial: partial.includes(Number(fy)),
  }));

describe("caseMixRows", () => {
  it("ranks groups on the latest complete year, not the unfinished one", () => {
    const mix = caseMixRows(
      [g("a", { 2024: 50, 2025: 10, 2026: 90 }), g("b", { 2024: 20, 2025: 30, 2026: 5 })],
      nat({ 2024: 100, 2025: 100, 2026: 120 }, [2026]),
      { top: 1 },
    )!;
    expect(mix.latestFy).toBe(2025);
    expect(mix.keys).toEqual(["b", OTHER_KEY]);
    expect(mix.rows.at(-1)).toMatchObject({ period: "FY2026", partial: true });
  });

  it("computes the rest as the national total minus the shown groups", () => {
    const mix = caseMixRows(
      [g("a", { 2025: 60 }), g("b", { 2025: 30 }), g("c", { 2025: 5 })],
      nat({ 2025: 100 }),
      { top: 2 },
    )!;
    expect(mix.rows[0]!.values).toEqual({ a: 60, b: 30, [OTHER_KEY]: 10 });
    expect(mix.shownShare).toBeCloseTo(0.9);
  });

  it("leaves a gap, not a zero, when a shown group or the total is not recorded", () => {
    const mix = caseMixRows(
      [g("a", { 2024: null, 2025: 60 }), g("b", { 2025: 30 })],
      nat({ 2023: null, 2024: 100, 2025: 100 }),
      { top: 2 },
    )!;
    const by = Object.fromEntries(mix.rows.map((r) => [r.period, r.values]));
    expect(by["FY2024"]).toEqual({ a: null, b: null, [OTHER_KEY]: null });
    expect(by["FY2023"]![OTHER_KEY]).toBeNull();
  });

  it("never shows a negative remainder", () => {
    const mix = caseMixRows([g("a", { 2025: 120 })], nat({ 2025: 100 }), { top: 1 })!;
    expect(mix.rows[0]!.values[OTHER_KEY]).toBeNull();
  });

  it("keeps only the last span of fiscal years", () => {
    const mix = caseMixRows([g("a", { 2020: 1, 2025: 1 })], nat({ 2020: 5, 2024: 5, 2025: 5 }), {
      span: 2,
    })!;
    expect(mix.rows.map((r) => r.period)).toEqual(["FY2024", "FY2025"]);
  });
});
