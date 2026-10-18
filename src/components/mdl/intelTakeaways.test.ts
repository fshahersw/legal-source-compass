import { describe, expect, it } from "vitest";
import { coverageSegments, intelTakeaways, type IntelTakeawayInput } from "./intelTakeaways";

describe("coverageSegments", () => {
  it("partitions every transferred MDL exactly once", () => {
    const segs = coverageSegments(["orders", "orders", "statements", "nothing", "none", "failed"]);
    expect(Object.fromEntries(segs.map((s) => [s.key, s.value]))).toEqual({
      orders: 2,
      statements: 1,
      nothing: 1,
      none: 2,
    });
    expect(segs.reduce((a, s) => a + s.value, 0)).toBe(6);
  });

  it("says fetched only when a located page failed to fetch", () => {
    expect(coverageSegments(["none"]).find((s) => s.key === "none")!.label).toBe("No page located");
    expect(coverageSegments(["failed"]).find((s) => s.key === "none")!.label).toBe(
      "No page located and fetched",
    );
  });
});

const base: IntelTakeawayInput = {
  lastYear: 2025,
  grantSharePct: 56.8,
  tenYearGrantMedianPct: 46.3,
  motionsFiled: 32,
  motionsGranted: 21,
  top5DistrictSharePct: 72.8,
  hhiDistrict: 2053,
  transferred: 63,
  withOrders: 37,
  withPage: 42,
  flagged: 2,
  bellwetherQuoted: 20,
  plMdls: 63,
};

describe("intelTakeaways", () => {
  it("reports each figure with its denominator", () => {
    const items = intelTakeaways(base);
    expect(items.map((t) => t.id)).toEqual([
      "grant-share",
      "concentration",
      "court-pages",
      "bellwether",
      "flagged",
    ]);
    expect(items[0]!.text).toContain("21 granted, 32 filed");
    expect(items[0]!.text).toContain("46.3%");
    expect(items[2]!.figure).toBe("37 of 63");
    expect(items[3]!.figure).toBe("20 of 63");
  });

  it("drops unknowns instead of printing a placeholder number", () => {
    const items = intelTakeaways({
      ...base,
      grantSharePct: null,
      top5DistrictSharePct: null,
      transferred: 0,
      plMdls: null,
    });
    // Only the flagged count is left; a single bullet is not shown as a summary.
    expect(items).toEqual([]);
  });
});
