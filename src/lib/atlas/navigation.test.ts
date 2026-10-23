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
    expect(PRIMARY_NAVIGATION.map((x) => x.to)).toEqual(["/", "/law", "/analytics", "/sources"]);
    expect(PRIMARY_NAVIGATION.map((x) => x.label)).toEqual([
      "States & courts",
      "Law & regulation",
      "Analytics",
      "Sources",
    ]);
  });
  it("keeps courts and judges within geographic navigation", () => {
    for (const path of ["/", "/places/NE", "/courts/ned", "/judges/123"])
      expect(navigationSection(path)).toBe("states");
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
  it("keeps case law within the law section, after state codes", () => {
    for (const path of ["/cases", "/cases/abc123"]) expect(navigationSection(path)).toBe("law");
    const tabs = contextualNavigation("/cases").map((x) => x.to);
    expect(tabs.indexOf("/cases")).toBe(tabs.indexOf("/law/codes") + 1);
    expect(PRIMARY_NAVIGATION.map((x) => x.to)).not.toContain("/cases");
  });
  it("places Time limits as a tab of Law & regulation, after Case law and Legislation", () => {
    for (const path of ["/limitations", "/limitations/", "/limitations/statutory"])
      expect(navigationSection(path)).toBe("law");
    const tabs = contextualNavigation("/limitations");
    expect(tabs).toEqual(contextualNavigation("/law"));
    // Case law, then Legislation (added by the legislation stream), then Time limits.
    expect(tabs.map((x) => x.to).indexOf("/limitations")).toBeGreaterThan(
      tabs.map((x) => x.to).indexOf("/cases"),
    );
    expect(tabs.map((x) => x.to).slice(2, 5)).toEqual([
      "/cases",
      "/law/legislation",
      "/limitations",
    ]);
    expect(tabs).toContainEqual({ to: "/limitations", label: "Time limits" });
    // The calculator and the statutory review both light the one Time limits tab.
    expect(activeContextualPath("/limitations")).toBe("/limitations");
    expect(activeContextualPath("/limitations/statutory")).toBe("/limitations");
    // Time limits is no longer a sidebar section.
    expect(PRIMARY_NAVIGATION.map((x) => x.label)).not.toContain("Time limits");
    expect(PRIMARY_NAVIGATION.map((x) => x.to)).not.toContain("/limitations");
    expect(navigationSection("/limitationsx")).toBeNull();
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
  it("offers state, court and judge analytics inside Analytics, not States & courts", () => {
    const analytics = contextualNavigation("/analytics").map((x) => x.to);
    expect(analytics).toEqual(
      expect.arrayContaining(["/places/analytics", "/courts/analytics", "/judges/analytics"]),
    );
    const states = contextualNavigation("/courts").map((x) => x.to);
    for (const to of ["/places/analytics", "/courts/analytics", "/judges/analytics", "/analytics"])
      expect(states).not.toContain(to);
    for (const path of ["/places/analytics", "/courts/analytics", "/judges/analytics"]) {
      expect(navigationSection(path)).toBe("analytics");
      expect(contextualNavigation(path)).toEqual(contextualNavigation("/analytics"));
    }
  });
  it("keeps enforcement and company intelligence inside the law section", () => {
    expect(navigationSection("/companies")).toBe("law");
    expect(navigationSection("/companies/200406")).toBe("law");
    expect(contextualNavigation("/law").map((x) => x.to)).toEqual(
      expect.arrayContaining(["/law/enforcement", "/companies"]),
    );
  });
});
describe("Analytics section", () => {
  it("is the third sidebar section, opens at /analytics and lights only its own tab", () => {
    expect(PRIMARY_NAVIGATION[2]).toEqual({
      id: "analytics",
      to: "/analytics",
      label: "Analytics",
      icon: "chart",
    });
    expect(navigationSection("/analytics")).toBe("analytics");
    expect(navigationSection("/analytics/insights")).toBe("analytics");
    expect(navigationSection("/analytics/enforcement")).toBe("analytics");
    expect(navigationSection("/analytics/safety")).toBe("analytics");
    expect(contextualNavigation("/analytics")[0]).toEqual({ to: "/analytics", label: "Overview" });
    expect(activeContextualPath("/analytics")).toBe("/analytics");
    expect(activeContextualPath("/analytics/")).toBe("/analytics");
    expect(activeContextualPath("/analytics/insights")).toBe("/analytics/insights");
    expect(activeContextualPath("/analytics/enforcement")).toBe("/analytics/enforcement");
    expect(activeContextualPath("/analytics/safety/")).toBe("/analytics/safety");
    expect(activeContextualPath("/places/analytics")).toBe("/places/analytics");
    expect(activeContextualPath("/courts/analytics")).toBe("/courts/analytics");
    expect(activeContextualPath("/judges/analytics")).toBe("/judges/analytics");
  });
  it("shows the same tab list on every Analytics page, with state analytics keeping its strip", () => {
    const tabs = contextualNavigation("/analytics");
    expect(tabs.map((x) => x.label)).toEqual([
      "Overview",
      "Enforcement trends",
      "Safety trends",
      "State analytics",
      "Court analytics",
      "Judge analytics",
      "Insights of the day",
    ]);
    for (const path of ["/analytics/insights", "/places/analytics", "/courts/analytics"])
      expect(contextualNavigation(path)).toEqual(tabs);
    // /places/<USPS> still has no strip.
    expect(contextualNavigation("/places/NE")).toEqual([]);
  });
  it("does not capture look-alike paths", () => {
    expect(navigationSection("/analytics-x")).toBeNull();
    expect(navigationSection("/analyticsx/y")).toBeNull();
    expect(navigationSection("/places/analyticsx")).toBe("states");
    expect(navigationSection("/courts/analytics-x")).toBe("states");
    expect(navigationSection("/judges/analyticsx")).toBe("states");
  });
  it("is not offered from the law or sources tabs", () => {
    for (const path of ["/law", "/sources"])
      expect(contextualNavigation(path).map((x) => x.to)).not.toContain("/analytics");
  });
});
describe("section tab lists", () => {
  const sections = [
    ["/", "states"],
    ["/analytics", "analytics"],
    ["/law", "law"],
    ["/sources", "sources"],
  ] as const;
  // "/" itself carries no strip; the States & courts tabs are read from /courts.
  const tabsOf = (path: string) => contextualNavigation(path === "/" ? "/courts" : path);
  it("puts every tab in the section whose strip lists it", () => {
    for (const [path, section] of sections)
      for (const tab of tabsOf(path))
        expect(navigationSection(tab.to), `${tab.label} (${tab.to})`).toBe(section);
  });
  it("lists no destination in two sections or twice", () => {
    const seen = new Map<string, string>();
    for (const [path, section] of sections)
      for (const tab of tabsOf(path)) {
        expect(seen.has(tab.to), `${tab.to} already listed in ${seen.get(tab.to)}`).toBe(false);
        seen.set(tab.to, section);
      }
  });
  it("pins the tab lists of every section", () => {
    expect(tabsOf("/").map((t) => t.label)).toEqual([
      "State map",
      "All courts",
      "Caseload",
      "Collection",
      "Law firms",
      "Securities suits",
      "Vacancies",
      "All judges",
    ]);
    expect(tabsOf("/law").map((t) => t.label)).toEqual([
      "Overview",
      "State codes",
      "Case law",
      "Legislation",
      "Time limits",
      "Regulatory intelligence",
      "Enforcement",
      "Agencies",
      "Product safety",
      "Companies",
      "Industry payments",
    ]);
    expect(tabsOf("/sources").map((t) => t.label)).toEqual([
      "Directory",
      "Library",
      "Catalog",
      "Coverage",
      "Saved work",
    ]);
  });
});
describe("federal MDL views", () => {
  it("places MDL analytics, MDL intelligence and the case lens with Analytics, under Court analytics", () => {
    for (const path of ["/matters/analytics", "/matters/intel", "/matters/lens/3026"]) {
      expect(navigationSection(path)).toBe("analytics");
      expect(contextualNavigation(path)).toEqual(contextualNavigation("/analytics"));
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
    ["/analytics", "/analytics"],
    ["/analytics/insights", "/analytics/insights"],
    ["/analytics/enforcement", "/analytics/enforcement"],
    ["/analytics/safety", "/analytics/safety"],
    ["/matters/analytics", "/courts/analytics"],
    ["/matters/intel", "/courts/analytics"],
    ["/matters/lens/3026", "/courts/analytics"],
    ["/limitations", "/limitations"],
    ["/limitations/statutory", "/limitations"],
    ["/places", "/"],
    ["/places/", "/"],
    ["/companies", "/companies"],
    ["/companies/0001326801", "/companies"],
    ["/companies/payments", "/companies/payments"],
    ["/agencies/fda", "/agencies"],
    ["/sources", "/sources"],
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
    // State analytics is an Analytics tab: the State map tab never owns it.
    expect(activeContextualPath("/places/analytics", states)).toBeNull();
    expect(activeContextualPath("/places/analytics")).toBe("/places/analytics");
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
describe("federal civil caseload tab", () => {
  it("sits with States & courts as its own tab right after All courts", () => {
    expect(navigationSection("/courts/caseload")).toBe("states");
    expect(contextualNavigation("/courts/caseload")).toEqual(contextualNavigation("/courts"));
    const tabs = contextualNavigation("/courts").map((x) => x.to);
    expect(tabs.indexOf("/courts/caseload")).toBe(tabs.indexOf("/courts") + 1);
    expect(contextualNavigation("/courts")).toContainEqual({
      to: "/courts/caseload",
      label: "Caseload",
    });
  });
  it("lights only itself, and leaves the court pages and Court analytics alone", () => {
    expect(activeContextualPath("/courts/caseload")).toBe("/courts/caseload");
    expect(activeContextualPath("/courts/caseload/")).toBe("/courts/caseload");
    expect(activeContextualPath("/courts/analytics")).toBe("/courts/analytics");
    expect(activeContextualPath("/courts/ned")).toBe("/courts");
    expect(ariaCurrent("/courts/caseload", "/courts/caseload", true)).toBe("page");
  });
  it("adds no primary section", () => {
    expect(PRIMARY_NAVIGATION).toHaveLength(4);
    expect(PRIMARY_NAVIGATION.map((x) => x.to)).not.toContain("/courts/caseload");
  });
});
describe("CourtListener collection tab", () => {
  it("sits with States & courts as its own tab right after Caseload", () => {
    expect(navigationSection("/courts/collection")).toBe("states");
    expect(contextualNavigation("/courts/collection")).toEqual(contextualNavigation("/courts"));
    const tabs = contextualNavigation("/courts").map((x) => x.to);
    expect(tabs.indexOf("/courts/collection")).toBe(tabs.indexOf("/courts/caseload") + 1);
    expect(contextualNavigation("/courts")).toContainEqual({
      to: "/courts/collection",
      label: "Collection",
    });
  });
  it("lights only itself, and leaves Caseload and the court pages alone", () => {
    expect(activeContextualPath("/courts/collection")).toBe("/courts/collection");
    expect(activeContextualPath("/courts/collection/")).toBe("/courts/collection");
    expect(activeContextualPath("/courts/caseload")).toBe("/courts/caseload");
    expect(activeContextualPath("/courts/ned")).toBe("/courts");
    expect(ariaCurrent("/courts/collection", "/courts/collection", true)).toBe("page");
    expect(ariaCurrent("/courts/caseload", "/courts/collection", false)).toBeUndefined();
  });
  it("adds no primary section", () => {
    expect(PRIMARY_NAVIGATION).toHaveLength(4);
    expect(PRIMARY_NAVIGATION.map((x) => x.to)).not.toContain("/courts/collection");
  });
});
