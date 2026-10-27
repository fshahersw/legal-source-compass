import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  activeContextualPath,
  contextualNavigation,
  navigationSection,
} from "@/lib/atlas/navigation";
import { CALCULATOR_TABS, calculatorTab } from "@/components/calculators/CalculatorsPage";

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

describe("calculator tabs", () => {
  it("has at most four mode tabs and keeps every former tab id working", () => {
    expect(CALCULATOR_TABS.length).toBeLessThanOrEqual(4);
    expect(calculatorTab("interest")).toBe("interest");
    expect(calculatorTab("damages")).toBe("damages");
    expect(calculatorTab("life")).toBe("damages");
    expect(calculatorTab("state-rates")).toBe("interest");
    expect(calculatorTab("sources")).toBe("damages");
    expect(calculatorTab("nope")).toBeUndefined();
    expect(calculatorTab(3)).toBeUndefined();
  });
});
