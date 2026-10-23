import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  activeContextualPath,
  contextualNavigation,
  navigationSection,
} from "@/lib/atlas/navigation";
import { CALCULATOR_TABS } from "@/components/calculators/CalculatorsPage";

describe("calculators page placement", () => {
  it("belongs to Law & government without adding a tab (the section keeps at most seven)", () => {
    expect(navigationSection("/law/calculators", { tab: "interest" })).toBe("law");
    const strip = contextualNavigation("/law/calculators", undefined);
    expect(strip.length).toBeLessThanOrEqual(7);
    expect(strip.some((t) => t.to === "/law/calculators")).toBe(false);
    expect(activeContextualPath("/law/calculators", undefined)).toBeNull();
  });

  it("keeps the nine sidebar sections and at most seven in-page tabs", () => {
    expect(PRIMARY_NAVIGATION).toHaveLength(9);
    expect(CALCULATOR_TABS.length).toBeLessThanOrEqual(7);
  });
});
