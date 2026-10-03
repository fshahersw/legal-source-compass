import { describe, expect, it } from "vitest";
import { SW_MATTERS, swMatter } from "./tiers";

describe("Seeger Weiss priority list", () => {
  it("lists 24 Tier 1 and 14 Tier 2 matters with unique MDL numbers", () => {
    expect(SW_MATTERS.filter((m) => m.tier === 1)).toHaveLength(24);
    expect(SW_MATTERS.filter((m) => m.tier === 2)).toHaveLength(14);
    expect(new Set(SW_MATTERS.map((m) => m.mdl)).size).toBe(SW_MATTERS.length);
  });

  it("keeps the brief's order (Social Media first, Depo-Provera second)", () => {
    expect(SW_MATTERS.slice(0, 2).map((m) => m.mdl)).toEqual([3047, 3140]);
  });

  it("looks matters up by MDL number string only", () => {
    expect(swMatter("3140")).toMatchObject({ tier: 1, shortName: "Depo-Provera" });
    expect(swMatter("2885")).toMatchObject({ tier: 2 });
    expect(swMatter("9999")).toBeNull();
    expect(swMatter("03140")).toBeNull();
  });
});
