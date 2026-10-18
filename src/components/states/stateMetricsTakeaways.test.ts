import { describe, expect, it } from "vitest";
import { stateMetricTakeaways } from "./stateMetricsTakeaways";
import type { RankedValue } from "./stateMetricsMath";

const row = (
  name: string,
  value: number,
  rank: number,
  extra: Partial<RankedValue> = {},
): RankedValue => ({
  usps: name.slice(0, 2).toUpperCase(),
  fips: "00",
  name,
  value,
  rank,
  z: 0,
  change5: null,
  outlier: null,
  ...extra,
});

const ranked: RankedValue[] = [
  row("Alpha", 40, 1, { change5: 20, outlier: "high", z: 2.5 }),
  ...Array.from({ length: 10 }, (_, i) =>
    row(`Mid${i}`, 20 - i, i + 2, { change5: i % 2 ? -5 : 5 }),
  ),
  row("Omega", 5, 12, { change5: -30 }),
];

describe("stateMetricTakeaways", () => {
  it("states highest vs median, range, five-year direction and outliers", () => {
    const items = stateMetricTakeaways({
      short: "Overdose / 100k",
      year: 2025,
      format: "rate",
      ranked,
      jurisdictions: 51,
      partial: false,
    });
    expect(items.map((t) => t.id)).toEqual(["highest", "range", "five-year", "outliers"]);
    expect(items[0]!.text).toContain("Alpha is highest on Overdose / 100k in 2025 (40.0)");
    expect(items[0]!.figure).toBe("2.6\u00d7 median");
    expect(items[1]!.figure).toBe("8.0×");
    expect(items[1]!.text).toContain("of 51");
    expect(items[2]!.text).toContain("above their 2020 level");
    expect(items[2]!.text).toContain("largest rise Alpha +20.0%");
    expect(items[2]!.text).toContain("largest fall Omega −30.0%");
    expect(items[3]!.figure).toBe("1");
    expect(items[3]!.text).toContain("AL");
  });

  it("uses points for percentage metrics and flags totals", () => {
    const items = stateMetricTakeaways({
      short: "Unemployment",
      year: 2025,
      format: "pct",
      ranked,
      jurisdictions: 12,
      partial: false,
    });
    expect(items[2]!.text).toContain("pts");
    const totals = stateMetricTakeaways({
      short: "Deaths",
      year: 2025,
      format: "int",
      ranked,
      jurisdictions: 12,
      partial: false,
    });
    expect(totals[0]!.text).toContain("mostly tracks population");
  });

  it("drops rank-dependent claims for a partial year and for empty data", () => {
    const partial = stateMetricTakeaways({
      short: "x",
      year: 2026,
      format: "rate",
      ranked,
      jurisdictions: 51,
      partial: true,
    });
    expect(partial.map((t) => t.id)).toEqual(["highest", "range"]);
    expect(
      stateMetricTakeaways({
        short: "x",
        year: 2026,
        format: "rate",
        ranked: [],
        jurisdictions: 51,
        partial: false,
      }),
    ).toEqual([]);
  });
});
