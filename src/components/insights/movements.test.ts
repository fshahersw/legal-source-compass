import { describe, expect, it } from "vitest";
import type { Kpi } from "./kpis";
import { changeRows, movementTakeaway } from "./movements";

const kpi = (title: string, changePercent: number | null, changeText: string | null): Kpi => ({
  id: title,
  topic: "courts",
  title,
  unit: "",
  value: "1",
  periodText: null,
  seriesLabel: null,
  changeText,
  changeNote: null,
  changePercent,
  direction: null,
  completePeriods: 6,
  spark: null,
  source: { label: "S", url: "/s" },
  href: { to: "/insights/trends" },
  partialNote: null,
});

describe("movementTakeaway", () => {
  it("names the largest move with its printed comparison", () => {
    expect(
      movementTakeaway([
        kpi("Consumer complaints received by the CFPB", 99.1, "+2,708,676 (+99.1%) vs 2024"),
      ]),
    ).toBe("Largest move: Consumer complaints received by the CFPB, +99.1% vs 2024");
  });
  it("uses a true minus sign for a fall", () => {
    expect(movementTakeaway([kpi("MDLs pending", -40.4, "−19 (−40.4%) vs October 2025")])).toBe(
      "Largest move: MDLs pending, −40.4% vs October 2025",
    );
  });
  it("says nothing without a movement", () => {
    expect(movementTakeaway([])).toBeNull();
    expect(movementTakeaway([kpi("A", null, "+4 vs 2024")])).toBeNull();
  });
});

describe("changeRows", () => {
  it("orders by the size of the percentage, keeps changes without one last and drops tiles without a change", () => {
    const rows = changeRows([
      kpi("small", 2, "+2 (+2.0%) vs 2024"),
      kpi("none", null, "+0.3 percentage points vs 2024"),
      kpi("big fall", -40, "−40 (−40.0%) vs 2024"),
      kpi("no change text", 10, null),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["big fall", "small", "none"]);
  });
});
