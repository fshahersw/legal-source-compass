import { describe, expect, it } from "vitest";
import type { Kpi } from "./kpis";
import { kpiDelta } from "./kpiDelta";

const kpi = (changeText: string | null, direction: Kpi["direction"]): Kpi => ({
  id: "x",
  topic: "courts",
  title: "T",
  unit: "cases",
  value: "1",
  periodText: null,
  seriesLabel: null,
  changeText,
  changeNote: changeText ? null : "No earlier period to compare with.",
  changePercent: null,
  direction,
  completePeriods: 6,
  spark: null,
  source: { label: "S", url: "/s" },
  href: { to: "/insights/trends" },
  partialNote: null,
});

describe("kpiDelta", () => {
  it("puts the percentage in the pill and keeps the rest of the sentence beside it", () => {
    expect(kpiDelta(kpi("+12,700 (+4.4%) vs FY2024", "up"))).toEqual({
      value: 1,
      text: "+4.4%",
      detail: "+12,700 vs FY2024",
    });
  });
  it("follows the model's direction and never adds a tone", () => {
    const d = kpiDelta(kpi("−129,421 (−39.6%) vs FY2024", "down"))!;
    expect(d.value).toBe(-1);
    expect(d.goodDirection).toBeUndefined();
    expect(kpiDelta(kpi("0 (0.0%) vs 2024", "flat"))!.value).toBe(0);
  });
  it("uses the whole change when the sentence has no percentage", () => {
    expect(kpiDelta(kpi("+0.3 percentage points vs 2024", "up"))).toEqual({
      value: 1,
      text: "+0.3 percentage points",
      detail: "vs 2024",
    });
  });
  it("returns nothing without a change", () => {
    expect(kpiDelta(kpi(null, null))).toBeNull();
  });
});
