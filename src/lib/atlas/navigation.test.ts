import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  UTILITY_NAVIGATION,
  activeContextualPath,
  activeContextualTab,
  ariaCurrent,
  composeBreadcrumbs,
  contextualNavigation,
  navigationSection,
  normalizePath,
  recordPlacement,
  tabKey,
  type NavigationSection,
  type SearchParams,
} from "./navigation";

const labels = (path: string, search?: SearchParams) =>
  contextualNavigation(path, search).map((t) => t.label);
const lit = (path: string, search?: SearchParams) =>
  activeContextualTab(path, search)?.label ?? null;
const trail = (
  path: string,
  search: SearchParams,
  crumbs: Parameters<typeof composeBreadcrumbs>[2],
) => composeBreadcrumbs(path, search, crumbs);

describe("sidebar", () => {
  it("has exactly the nine sections, in the owner's order", () => {
    expect(PRIMARY_NAVIGATION.map((x) => [x.label, x.to])).toEqual([
      ["Overview", "/"],
      ["Places", "/places"],
      ["Courts & judges", "/courts"],
      ["Litigation", "/litigation"],
      ["Law & government", "/law"],
      ["Enforcement", "/enforcement"],
      ["Products & safety", "/safety"],
      ["Companies", "/companies"],
      ["Insights", "/insights"],
    ]);
  });
  it("keeps Sources and Saved work below the nine sections", () => {
    expect(UTILITY_NAVIGATION.map((x) => [x.label, x.to])).toEqual([
      ["Sources", "/sources"],
      ["Saved work", "/saved-sources"],
    ]);
  });
  it("lights every section on its own landing page", () => {
    for (const item of [...PRIMARY_NAVIGATION, ...UTILITY_NAVIGATION])
      expect(navigationSection(item.to), item.to).toBe(item.id);
  });
});

describe("section tabs", () => {
  const SECTION_TABS: [string, SearchParams, string[]][] = [
    ["/places", undefined, ["Map", "Compare"]],
    [
      "/courts",
      undefined,
      ["Courts", "Judges", "Caseload", "Vacancies", "Compare courts", "Compare judges"],
    ],
    [
      "/litigation",
      undefined,
      [
        "Overview",
        "Case law",
        "MDLs & mass torts",
        "Dockets",
        "Securities class actions",
        "Law firms",
        "Settlements",
      ],
    ],
    [
      "/law",
      undefined,
      [
        "Overview",
        "Federal law",
        "State law",
        "Legislation & Congress",
        "Rulemaking",
        "Time limits",
        "Agencies",
      ],
    ],
    [
      "/enforcement",
      undefined,
      [
        "Overview",
        "Actions by agency",
        "Exclusions",
        "Oversight reports",
        "Merger review",
        "Agency data sources",
      ],
    ],
    [
      "/safety",
      undefined,
      [
        "Overview",
        "Regulatory intelligence",
        "Injuries (NEISS)",
        "Consumer reports",
        "Signals",
        "Collections",
      ],
    ],
    ["/companies", undefined, ["Directory", "Industry payments"]],
    [
      "/insights",
      undefined,
      ["Overview", "Explore", "Trends", "Rankings & maps", "Signals", "Insights of the day"],
    ],
    [
      "/sources",
      undefined,
      ["Directory", "Library", "Catalog", "Coverage", "Registry", "Datasets"],
    ],
    ["/saved-sources", undefined, ["Saved sources", "Imports & exports"]],
  ];
  it.each(SECTION_TABS)("%s shows its section's tabs", (path, search, expected) => {
    expect(labels(path, search)).toEqual(expected);
  });
  it("never shows more than seven tabs, nor one destination twice", () => {
    for (const [path, search] of SECTION_TABS) {
      const tabs = contextualNavigation(path, search);
      expect(tabs.length).toBeLessThanOrEqual(7);
      expect(new Set(tabs.map(tabKey)).size).toBe(tabs.length);
      expect(new Set(tabs.map((t) => t.label)).size).toBe(tabs.length);
    }
  });
  it("puts every tab in its own section and lights it on its own page", () => {
    for (const [path, search] of SECTION_TABS) {
      const section = navigationSection(path, search);
      for (const tab of contextualNavigation(path, search)) {
        expect(navigationSection(tab.to, tab.search), tabKey(tab)).toBe(section);
        expect(activeContextualPath(tab.to, tab.search), tabKey(tab)).toBe(tabKey(tab));
        // The same strip on every page of the section.
        expect(contextualNavigation(tab.to, tab.search)).toEqual(
          contextualNavigation(path, search),
        );
      }
    }
  });
  it("lists no destination in two sections", () => {
    const seen = new Map<string, string>();
    for (const [path, search] of SECTION_TABS)
      for (const tab of contextualNavigation(path, search)) {
        expect(seen.has(tabKey(tab)), `${tabKey(tab)} also in ${seen.get(tabKey(tab))}`).toBe(
          false,
        );
        seen.set(tabKey(tab), path);
      }
  });
  it("shows no strip on the map home or a state page", () => {
    expect(contextualNavigation("/")).toEqual([]);
    expect(contextualNavigation("/places/NE")).toEqual([]);
    expect(contextualNavigation("/places/NE/31055")).toEqual([]);
    expect(labels("/places/analytics")).toEqual(["Map", "Compare"]);
  });
});

/** Every page family: [path, search, section, lit tab label or null]. */
const PAGES: [string, SearchParams, NavigationSection | null, string | null][] = [
  // Overview and Places
  ["/", undefined, "overview", null],
  ["/", { metric: "x" }, "overview", null],
  ["/overview", undefined, "overview", null],
  ["/places", undefined, "places", "Map"],
  ["/places/", { layer: "counties" }, "places", "Map"],
  ["/places/analytics", undefined, "places", "Compare"],
  ["/places/NY", undefined, "places", null],
  ["/places/NY/36061", undefined, "places", null],
  // Courts & judges
  ["/courts", undefined, "courts", "Courts"],
  ["/courts", { system: "Federal", state: "NY" }, "courts", "Courts"],
  ["/courts/nysd", undefined, "courts", "Courts"],
  ["/courts/caseload", undefined, "courts", "Caseload"],
  ["/courts/vacancies", undefined, "courts", "Vacancies"],
  ["/courts/analytics", undefined, "courts", "Compare courts"],
  ["/judges", undefined, "courts", "Judges"],
  ["/judges/123", undefined, "courts", "Judges"],
  ["/judges/analytics", undefined, "courts", "Compare judges"],
  ["/people", undefined, "courts", "Judges"],
  ["/people", { kind: "judges" }, "courts", "Judges"],
  ["/prototypes/court/njd", undefined, "courts", "Courts"],
  ["/prototypes/judge/abc", undefined, "courts", "Judges"],
  // Litigation
  ["/litigation", undefined, "litigation", "Overview"],
  ["/litigation/settlements", undefined, "litigation", "Settlements"],
  ["/litigation/settlements", { view: "notices" }, "litigation", "Settlements"],
  ["/cases", undefined, "litigation", "Case law"],
  ["/cases/abc123", undefined, "litigation", "Case law"],
  ["/matters", undefined, "litigation", "MDLs & mass torts"],
  ["/matters", { ds: "mdls" }, "litigation", "MDLs & mass torts"],
  ["/matters/3026", undefined, "litigation", "MDLs & mass torts"],
  ["/matters/analytics", undefined, "litigation", "MDLs & mass torts"],
  ["/matters/intel", undefined, "litigation", "MDLs & mass torts"],
  ["/matters/lens/3026", undefined, "litigation", "MDLs & mass torts"],
  ["/matters/cases", undefined, "litigation", "MDLs & mass torts"],
  ["/matters/seeger-weiss", undefined, "litigation", "MDLs & mass torts"],
  ["/mdls", undefined, "litigation", "MDLs & mass torts"],
  ["/prototypes/mdl/2738", undefined, "litigation", "MDLs & mass torts"],
  ["/courts/collection", undefined, "litigation", "Dockets"],
  ["/registry", undefined, "litigation", "Dockets"],
  ["/registry/m-1", undefined, "litigation", "Dockets"],
  ["/sources/analysis", undefined, "litigation", "Dockets"],
  ["/sources/docket-documents", undefined, "litigation", "Dockets"],
  ["/courts/securities", undefined, "litigation", "Securities class actions"],
  ["/courts/firms", undefined, "litigation", "Law firms"],
  ["/people", { kind: "mdl_counsel" }, "litigation", "Law firms"],
  // Law & government
  ["/law", undefined, "law", "Overview"],
  ["/law", { view: "list" }, "law", "Overview"],
  ["/law", { scope: "reference" }, "law", "Overview"],
  ["/law", { scope: "federal" }, "law", "Federal law"],
  ["/law", { scope: "federal", group: "register" }, "law", "Federal law"],
  ["/laws", undefined, "law", "Federal law"],
  ["/law/uscode", undefined, "law", "Federal law"],
  ["/law/uscode/42/1983", undefined, "law", "Federal law"],
  ["/law/cfr/21/part/314", undefined, "law", "Federal law"],
  ["/law", { scope: "states", state: "NY" }, "law", "State law"],
  ["/law/codes", undefined, "law", "State law"],
  ["/law/codes/TX", undefined, "law", "State law"],
  ["/law/constitutions/CA", undefined, "law", "State law"],
  ["/law/regulations/NY", undefined, "law", "State law"],
  ["/law/legislation", undefined, "law", "Legislation & Congress"],
  ["/law/legislation/members/A000001", undefined, "law", "Legislation & Congress"],
  ["/law/legislation/federal/118/hr/1", undefined, "law", "Legislation & Congress"],
  ["/law/rulemaking", undefined, "law", "Rulemaking"],
  ["/limitations", undefined, "law", "Time limits"],
  ["/limitations/statutory", undefined, "law", "Time limits"],
  ["/agencies", undefined, "law", "Agencies"],
  ["/agencies/fda", undefined, "law", "Agencies"],
  ["/law/provision/abc", undefined, "law", null],
  // Enforcement
  ["/enforcement", undefined, "enforcement", "Overview"],
  ["/enforcement", { tab: "actions" }, "enforcement", "Actions by agency"],
  [
    "/enforcement",
    { tab: "actions", agency: "epa", state: "CA" },
    "enforcement",
    "Actions by agency",
  ],
  ["/enforcement", { tab: "exclusions" }, "enforcement", "Exclusions"],
  ["/enforcement", { tab: "oversight" }, "enforcement", "Oversight reports"],
  ["/enforcement", { tab: "merger" }, "enforcement", "Merger review"],
  ["/enforcement", { tab: "sources" }, "enforcement", "Agency data sources"],
  ["/law/enforcement", undefined, "enforcement", null],
  // Products & safety
  ["/safety", undefined, "safety", "Overview"],
  ["/safety", { view: "neiss" }, "safety", "Injuries (NEISS)"],
  ["/safety", { view: "reports" }, "safety", "Consumer reports"],
  ["/safety", { view: "list" }, "safety", "Collections"],
  ["/safety", { agency: "FDA" }, "safety", "Collections"],
  ["/safety", { agency: "FDA", ds: "agency_safety_openfda_drugsfda" }, "safety", "Collections"],
  ["/safety/signals", undefined, "safety", "Signals"],
  ["/safety/signals", { view: "neiss" }, "safety", "Signals"],
  ["/law/monitoring", undefined, "safety", "Regulatory intelligence"],
  ["/law/monitoring", { view: "analytics" }, "safety", "Regulatory intelligence"],
  // Companies
  ["/companies", undefined, "companies", "Directory"],
  ["/companies/0001326801", undefined, "companies", "Directory"],
  ["/companies/payments", undefined, "companies", "Industry payments"],
  // Insights (W3 owns the pages; the former /analytics pages stay here until redirected)
  ["/insights", undefined, "insights", "Overview"],
  ["/insights/explore", undefined, "insights", "Explore"],
  ["/insights/today", undefined, "insights", "Insights of the day"],
  ["/analytics", undefined, "insights", "Overview"],
  ["/analytics/enforcement", undefined, "insights", "Trends"],
  ["/analytics/safety", undefined, "insights", "Trends"],
  ["/analytics/insights", undefined, "insights", "Insights of the day"],
  // Sources and Saved work
  ["/sources", undefined, "sources", "Directory"],
  ["/sources/library", undefined, "sources", "Library"],
  ["/sources/detail", undefined, "sources", "Library"],
  ["/sources/catalog", undefined, "sources", "Catalog"],
  ["/sources/coverage", undefined, "sources", "Coverage"],
  ["/sources/registry", undefined, "sources", "Registry"],
  ["/sources/registry-v22", undefined, "sources", "Registry"],
  ["/data", undefined, "sources", "Datasets"],
  ["/data/tables/x", undefined, "sources", "Datasets"],
  ["/data/unknown_dataset_id", undefined, "sources", "Datasets"],
  ["/source-datasets", undefined, "sources", "Datasets"],
  ["/categories", undefined, "sources", "Library"],
  ["/saved-sources", undefined, "saved", "Saved sources"],
  ["/data-exports", undefined, "saved", "Imports & exports"],
  // Records and dataset pages go with their dataset
  ["/records/sec_enforcement_actions/x", undefined, "enforcement", "Actions by agency"],
  ["/records/sam_exclusions/x", undefined, "enforcement", "Exclusions"],
  ["/records/oversight_reports/x", undefined, "enforcement", "Oversight reports"],
  ["/records/ftc_hsr_early_terminations/x", undefined, "enforcement", "Merger review"],
  ["/records/settlement_notices/x", undefined, "litigation", "Settlements"],
  ["/records/mdl_counsel/x", undefined, "litigation", "Law firms"],
  ["/records/congress_bills/x", undefined, "law", "Legislation & Congress"],
  ["/records/public_laws_enacted/x", undefined, "law", "Legislation & Congress"],
  ["/records/court_rule_sections/x", undefined, "law", "State law"],
  ["/records/agency_safety_cpsc_recalls_api/x", undefined, "safety", "Collections"],
  ["/records/company_sec_profiles/x", undefined, "companies", "Directory"],
  ["/records/judicial_vacancies/x", undefined, "courts", "Judges"],
  ["/records/county_profiles/x", undefined, "places", null],
  ["/records/unknown_dataset_id/x", undefined, null, null],
  ["/data/sec_enforcement_actions", undefined, "enforcement", "Actions by agency"],
  ["/data/court_rule_sections", undefined, "law", "State law"],
  // Unsectioned utilities
  ["/search", { q: "x" }, null, null],
  ["/auth", undefined, null, null],
  ["/reset-password", undefined, null, null],
  ["/prototypes", undefined, null, null],
];

describe("every page lights its section and exactly one tab", () => {
  it.each(PAGES)("%s %j → %s / %s", (path, search, section, tab) => {
    expect(navigationSection(path, search)).toBe(section);
    expect(lit(path, search)).toBe(tab);
    const strip = contextualNavigation(path, search);
    const litTabs = strip.filter((t) => tabKey(t) === activeContextualPath(path, search));
    expect(litTabs.length).toBe(strip.length && tab ? 1 : 0);
  });
  it("tolerates trailing slashes", () => {
    expect(navigationSection("/courts/")).toBe("courts");
    expect(lit("/companies/payments/")).toBe("Industry payments");
    expect(navigationSection("/litigation/")).toBe("litigation");
  });
  it("does not capture look-alike paths", () => {
    expect(navigationSection("/analytics-x")).toBeNull();
    expect(navigationSection("/lawsx")).toBeNull();
    expect(navigationSection("/limitationsx")).toBeNull();
    expect(navigationSection("/enforcementx")).toBeNull();
    expect(lit("/courts/analyticsx")).toBe("Courts");
    expect(lit("/places/analyticsx")).toBeNull();
  });
});

describe("record placement", () => {
  it("places enforcement, litigation, law, safety, companies, courts and places datasets", () => {
    expect(recordPlacement("doj_press_releases_2025")).toEqual({
      section: "enforcement",
      tab: "actions",
    });
    expect(recordPlacement("oig_leie_exclusions")).toEqual({
      section: "enforcement",
      tab: "exclusions",
    });
    expect(recordPlacement("doj_oig_reports")).toEqual({
      section: "enforcement",
      tab: "oversight",
    });
    expect(recordPlacement("mdls")).toEqual({ section: "litigation", tab: "mdls" });
    expect(recordPlacement("cl_docket_metadata")).toEqual({
      section: "litigation",
      tab: "dockets",
    });
    expect(recordPlacement("us_code_sections")).toEqual({ section: "law", tab: "federal" });
    expect(recordPlacement("state_constitution_sections")).toEqual({
      section: "law",
      tab: "state",
    });
    expect(recordPlacement("limitation_periods")).toEqual({ section: "law", tab: "limits" });
    expect(recordPlacement("unified_agenda_pipeline")).toEqual({
      section: "law",
      tab: "rulemaking",
    });
    expect(recordPlacement("fsis_recalls")).toEqual({ section: "safety", tab: "collections" });
    expect(recordPlacement("court_spine")).toEqual({ section: "courts", tab: "courts" });
    expect(recordPlacement("judges")).toEqual({ section: "courts", tab: "judges" });
    expect(recordPlacement("census_acs_states")).toEqual({ section: "places" });
    expect(recordPlacement("saved_pages")).toEqual({ section: "sources", tab: "datasets" });
    expect(recordPlacement("no_such_dataset")).toBeNull();
  });
});

describe("aria-current", () => {
  it("is 'page' only on the exact page (path and query) and 'true' on a lit parent", () => {
    expect(ariaCurrent("/companies/payments", "/companies/payments", true)).toBe("page");
    expect(ariaCurrent("/companies/payments/", "/companies/payments", true)).toBe("page");
    expect(ariaCurrent("/courts/ned", "/courts", true)).toBe("true");
    expect(ariaCurrent("/", "/", true)).toBe("page");
    expect(ariaCurrent("/courts", "/courts", false)).toBeUndefined();
    expect(
      ariaCurrent("/enforcement", "/enforcement", true, { tab: "actions" }, { tab: "actions" }),
    ).toBe("page");
    expect(
      ariaCurrent(
        "/enforcement",
        "/enforcement",
        true,
        { tab: "actions", agency: "sec" },
        { tab: "actions" },
      ),
    ).toBe("true");
    expect(ariaCurrent("/law", "/law", true, { scope: "federal" })).toBe("true");
  });
  it("normalizes trailing slashes and keeps the root", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("//")).toBe("/");
    expect(normalizePath("/courts/")).toBe("/courts");
    expect(normalizePath("/courts/ned")).toBe("/courts/ned");
  });
});

describe("breadcrumbs: Section › sub-area › entity", () => {
  const HOME = { label: "Home", to: "/" };
  it("courts: Courts & judges › New York › S.D.N.Y.", () => {
    expect(
      trail("/courts/nysd", undefined, [
        { label: "Courts", to: "/courts" },
        { label: "New York", to: "/courts", search: { system: "Federal", state: "NY" } },
        { label: "S.D.N.Y." },
      ]),
    ).toEqual([
      { label: "Courts & judges", to: "/courts" },
      { label: "New York", to: "/courts", search: { system: "Federal", state: "NY" } },
      { label: "S.D.N.Y." },
    ]);
  });
  it("litigation: Litigation › MDLs & mass torts › MDL 2873, dropping former Analytics crumbs", () => {
    expect(
      trail("/matters/lens/2873", undefined, [
        HOME,
        { label: "Analytics", to: "/analytics" },
        { label: "Federal court analytics", to: "/courts/analytics" },
        { label: "MDL analytics", to: "/matters/analytics" },
        { label: "MDL 2873" },
      ]),
    ).toEqual([
      { label: "Litigation", to: "/litigation" },
      { label: "MDLs & mass torts", to: "/matters/analytics" },
      { label: "MDL 2873" },
    ]);
  });
  it("law: Law & government › Federal law › U.S. Code › Title 42 › § 1983", () => {
    expect(
      trail("/law/uscode/42/1983", undefined, [
        HOME,
        { label: "Law & regulation", to: "/law" },
        { label: "United States Code", to: "/law/uscode" },
        { label: "Title 42", to: "/law/uscode/42" },
        { label: "§ 1983" },
      ]),
    ).toEqual([
      { label: "Law & government", to: "/law" },
      { label: "Federal law", to: "/law", search: { scope: "federal" } },
      { label: "United States Code", to: "/law/uscode" },
      { label: "Title 42", to: "/law/uscode/42" },
      { label: "§ 1983" },
    ]);
  });
  it("a tab page is Section › Tab, with the page's own name folded into the tab", () => {
    expect(
      trail("/courts/caseload", undefined, [
        HOME,
        { label: "Courts", to: "/courts" },
        { label: "Federal civil caseload" },
      ]),
    ).toEqual([{ label: "Courts & judges", to: "/courts" }, { label: "Caseload" }]);
    expect(trail("/enforcement", { tab: "actions" }, [{ label: "DOJ" }])).toEqual([
      { label: "Enforcement", to: "/enforcement" },
      { label: "Actions by agency" },
    ]);
  });
  it("a view inside a tab follows the tab", () => {
    expect(trail("/enforcement", { tab: "actions", agency: "sec" }, [{ label: "SEC" }])).toEqual([
      { label: "Enforcement", to: "/enforcement" },
      { label: "Actions by agency", to: "/enforcement", search: { tab: "actions" } },
      { label: "SEC" },
    ]);
    expect(
      trail("/law", { scope: "states", state: "NY" }, [
        HOME,
        { label: "Law & government", to: "/law" },
        { label: "State law", to: "/law", search: { scope: "states" } },
        { label: "New York" },
      ]),
    ).toEqual([
      { label: "Law & government", to: "/law" },
      { label: "State law", to: "/law", search: { scope: "states" } },
      { label: "New York" },
    ]);
  });
  it("a section landing is the section alone", () => {
    expect(trail("/litigation", undefined, [])).toEqual([{ label: "Litigation" }]);
    expect(trail("/", undefined, [])).toEqual([{ label: "Overview" }]);
    expect(trail("/courts", undefined, [HOME, { label: "Courts", to: "/courts" }])).toEqual([
      { label: "Courts & judges" },
    ]);
  });
  it("splits a crumb whose link carries its own query", () => {
    expect(
      trail("/sources/registry-v22", { j: "TX", task: "dockets" }, [
        HOME,
        { label: "Sources", to: "/sources/library" },
        { label: "Registry V2.2", to: "/sources/registry-v22" },
        { label: "Texas", to: "/sources/registry-v22?j=TX" },
        { label: "Dockets" },
      ]),
    ).toEqual([
      { label: "Sources", to: "/sources" },
      { label: "Registry", to: "/sources/registry" },
      { label: "Registry V2.2", to: "/sources/registry-v22" },
      { label: "Texas", to: "/sources/registry-v22", search: { j: "TX" } },
      { label: "Dockets" },
    ]);
  });
  it("keeps an unsectioned page's own crumbs, with Home named Overview", () => {
    expect(trail("/search", { q: "x" }, [HOME, { label: "Search" }])).toEqual([
      { label: "Overview", to: "/" },
      { label: "Search" },
    ]);
  });
  it("record pages sit under their dataset's section and tab", () => {
    expect(
      trail("/records/sec_enforcement_actions/abc", undefined, [
        HOME,
        { label: "SEC enforcement actions", to: "/data/sec_enforcement_actions" },
        { label: "SEC v. Example" },
      ]),
    ).toEqual([
      { label: "Enforcement", to: "/enforcement" },
      { label: "Actions by agency", to: "/enforcement", search: { tab: "actions" } },
      { label: "SEC enforcement actions", to: "/data/sec_enforcement_actions" },
      { label: "SEC v. Example" },
    ]);
  });
});
