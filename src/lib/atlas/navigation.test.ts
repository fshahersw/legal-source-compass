import { describe, expect, it } from "vitest";
import { PRIMARY_NAVIGATION, contextualNavigation, navigationSection } from "./navigation";
describe("state-first navigation", () => {
  it("starts at the state map and has four clear primary destinations", () => {
    expect(PRIMARY_NAVIGATION.map((x) => x.to)).toEqual([
      "/",
      "/law",
      "/limitations",
      "/sources/library",
    ]);
  });
  it("keeps courts and judges within geographic navigation", () => {
    for (const path of ["/", "/places/NE", "/courts/ned", "/judges/123"])
      expect(navigationSection(path)).toBe("states");
    expect(navigationSection("/limitations")).toBe("time-limits");
    expect(navigationSection("/law/codes/NE")).toBe("law");
  });
  it("does not advertise matters, cases, MDLs, expert rulings, or people", () => {
    const links = [
      ...PRIMARY_NAVIGATION,
      ...["/places/NE", "/law", "/sources/library", "/courts/ned", "/judges/123"].flatMap(
        contextualNavigation,
      ),
    ];
    for (const item of links)
      expect(item.to).not.toMatch(/^\/(?:matters|mdls|people|insights)(?:\/|$)/);
    expect(JSON.stringify(links)).not.toMatch(/Matters & MDLs|Cases & dockets|Expert rulings/);
  });
  it("does not repeat global geographic tabs on an individual state page", () => {
    expect(contextualNavigation("/places/NE")).toEqual([]);
  });
});
