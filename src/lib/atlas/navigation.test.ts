import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  activeContextualPath,
  ariaCurrent,
  contextualNavigation,
  navigationSection,
  normalizePath,
} from "./navigation";
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
      ...[
        "/places/NE",
        "/law",
        "/sources/library",
        "/courts/ned",
        "/judges/123",
        "/matters/analytics",
        "/matters/intel",
        "/matters/lens/3026",
      ].flatMap((path) => contextualNavigation(path)),
    ];
    for (const item of links)
      expect(item.to).not.toMatch(/^\/(?:matters|mdls|people|insights)(?:\/|$)/);
    expect(JSON.stringify(links)).not.toMatch(/Matters & MDLs|Cases & dockets|Expert rulings/);
  });
  it("does not repeat global geographic tabs on an individual state page", () => {
    expect(contextualNavigation("/places/NE")).toEqual([]);
  });
  it("keeps regulatory intelligence within the existing law section", () => {
    expect(navigationSection("/law/monitoring")).toBe("law");
    expect(contextualNavigation("/law/monitoring")).toContainEqual({
      to: "/law/monitoring",
      label: "Regulatory intelligence",
    });
    expect(PRIMARY_NAVIGATION).toHaveLength(4);
  });
});
describe("analytics destinations", () => {
  it("offers state, court and judge analytics inside geographic navigation", () => {
    const tabs = contextualNavigation("/courts").map((x) => x.to);
    expect(tabs).toEqual(
      expect.arrayContaining(["/places/analytics", "/courts/analytics", "/judges/analytics"]),
    );
    expect(navigationSection("/places/analytics")).toBe("states");
    expect(contextualNavigation("/places/analytics").length).toBeGreaterThan(0);
  });
  it("keeps enforcement and company intelligence inside the law section", () => {
    expect(navigationSection("/companies")).toBe("law");
    expect(navigationSection("/companies/200406")).toBe("law");
    expect(contextualNavigation("/law").map((x) => x.to)).toEqual(
      expect.arrayContaining(["/law/enforcement", "/companies"]),
    );
  });
});
describe("federal MDL views", () => {
  it("places MDL analytics, MDL intelligence and the case lens with States & courts", () => {
    for (const path of ["/matters/analytics", "/matters/intel", "/matters/lens/3026"]) {
      expect(navigationSection(path)).toBe("states");
      expect(contextualNavigation(path)).toEqual(contextualNavigation("/courts"));
      expect(activeContextualPath(path)).toBe("/courts/analytics");
    }
  });
  it("leaves the matters pages themselves unsectioned", () => {
    for (const path of [
      "/matters",
      "/matters/123",
      "/matters/cases",
      "/matters/seeger-weiss",
      "/matters/lens",
      "/matters/analytics-x",
      "/matters/intelligence",
    ])
      expect(navigationSection(path)).toBeNull();
  });
});
describe("active section tab", () => {
  const cases: [string, string | null][] = [
    ["/safety", "/safety"],
    ["/safety/signals", "/safety"],
    ["/courts", "/courts"],
    ["/courts/ned", "/courts"],
    ["/courts/analytics", "/courts/analytics"],
    ["/judges/123", "/judges"],
    ["/judges/analytics", "/judges/analytics"],
    ["/law", "/law"],
    ["/law/codes", "/law/codes"],
    ["/law/codes/NE", "/law/codes"],
    ["/law/provision/abc", "/law"],
    ["/law/enforcement", "/law/enforcement"],
    ["/places/analytics", "/places/analytics"],
    ["/places", "/"],
    ["/places/", "/"],
    ["/companies", "/companies"],
    ["/companies/0001326801", "/companies"],
    ["/companies/payments", "/companies/payments"],
    ["/agencies/fda", "/agencies"],
    ["/sources/library", "/sources/library"],
    ["/search", null],
    ["/laws", null],
  ];
  it.each(cases)("%s lights %s", (path, expected) => {
    expect(activeContextualPath(path)).toBe(expected);
  });
  it("lights exactly one tab on every page that has tabs", () => {
    for (const [path, expected] of cases) {
      const tabs = contextualNavigation(path);
      const lit = tabs.filter((t) => t.to === activeContextualPath(path));
      expect(lit.length).toBe(expected === null ? 0 : 1);
    }
  });
  it("never lights Companies and Industry payments together", () => {
    for (const path of ["/companies/payments", "/companies/payments/", "/companies/0001326801"]) {
      const active = activeContextualPath(path);
      expect(active === "/companies" || active === "/companies/payments").toBe(true);
    }
    expect(activeContextualPath("/companies/payments/")).toBe("/companies/payments");
  });
  it("lights the State map tab on the map and its /places address only", () => {
    const states = contextualNavigation("/courts");
    expect(activeContextualPath("/", states)).toBe("/");
    // /places renders the same States & courts map (and /overview redirects there).
    expect(activeContextualPath("/places", states)).toBe("/");
    expect(activeContextualPath("/places/analytics", states)).toBe("/places/analytics");
    expect(activeContextualPath("/places/NE", states)).toBeNull();
    expect(activeContextualPath("/placesx", states)).toBeNull();
    expect(activeContextualPath("/courts/ned", states)).toBe("/courts");
    expect(activeContextualPath("/search", states)).toBeNull();
    // The map page itself carries no tab strip; /places keeps the strip with State map lit.
    expect(contextualNavigation("/")).toEqual([]);
    expect(contextualNavigation("/places")).toEqual(states);
    // The alias belongs to the "/" tab only: no other section's tabs light on /places.
    expect(activeContextualPath("/places", contextualNavigation("/law"))).toBeNull();
  });
  it("marks the current page as 'page' and a lit parent tab as 'true'", () => {
    expect(ariaCurrent("/companies/payments", "/companies/payments", true)).toBe("page");
    expect(ariaCurrent("/companies/payments/", "/companies/payments", true)).toBe("page");
    expect(ariaCurrent("/courts/ned", "/courts", true)).toBe("true");
    expect(ariaCurrent("/places", "/", true)).toBe("true");
    expect(ariaCurrent("/", "/", true)).toBe("page");
    expect(ariaCurrent("/courts", "/courts", false)).toBeUndefined();
    // Every lit tab gets one of the two values, never on an unlit tab.
    for (const [path, expected] of cases)
      for (const tab of contextualNavigation(path)) {
        const value = ariaCurrent(path, tab.to, tab.to === activeContextualPath(path));
        if (tab.to !== expected) expect(value).toBeUndefined();
        else expect(value).toBe(normalizePath(path) === tab.to ? "page" : "true");
      }
  });
  it("normalizes trailing slashes and keeps the root", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("//")).toBe("/");
    expect(normalizePath("/courts/")).toBe("/courts");
    expect(normalizePath("/courts//")).toBe("/courts");
    expect(normalizePath("/courts/ned")).toBe("/courts/ned");
  });
  it("matches at path-segment boundaries only", () => {
    const tabs = [
      { to: "/", label: "Root" },
      { to: "/court", label: "Court" },
    ];
    expect(activeContextualPath("/courts", tabs)).toBeNull();
    expect(activeContextualPath("/court/x", tabs)).toBe("/court");
    expect(activeContextualPath("/anything", tabs)).toBeNull();
  });
});
