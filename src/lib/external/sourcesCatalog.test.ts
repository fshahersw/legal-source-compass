import { describe, expect, it } from "vitest";
import {
  buildPortals,
  CATEGORIES,
  COURT_SITES,
  categoryOf,
  extractUrls,
  groupByCategory,
  matchesQuery,
  normalizeSourcesSearch,
  portalKind,
  portalName,
  usedOn,
  WORKFLOWS,
  type SourceDataset,
} from "./sourcesCatalog";

const ds = (id: string, urls: string[] = [], records: number | null = 1): SourceDataset => ({
  id,
  label: id.replace(/_/g, " "),
  records,
  sourceText: urls.join(" ") || null,
  sourceUrls: urls,
  updatedAt: null,
});

describe("sources catalog", () => {
  it.each([
    ["court_spine", "courts"],
    ["courts_db", "courts"],
    ["clb_judge_dockets", "judges"],
    ["judge_cl_crosswalk", "judges"],
    ["mdl_counsel", "firms"],
    ["mdl_hierarchy", "matters"],
    ["sw_matter_dockets_v1", "matters"],
    ["agency_safety_openfda_food_enforcement", "safety"],
    ["agency_safety_openfda_device_classification_20261002", "medical"],
    ["agency_safety_fda_warning_letters", "enforcement"],
    ["fda_faers_product_series", "medical"],
    ["npdb_malpractice_states", "medical"],
    ["npdb_adverse_actions", "enforcement"],
    ["recall_patterns", "safety"],
    ["company_sec_profiles", "companies"],
    ["scac_statistics", "companies"],
    ["cfpb_complaints_states", "consumer"],
    ["state_metrics_profiles", "states"],
    ["ecfr_section_text", "law"],
    ["saved_pages", "sources"],
    ["something_new", "other"],
  ])("puts %s in %s", (id, category) => {
    expect(categoryOf(id)).toBe(category);
  });

  it("lists only pages traced to code, by exact id or declared prefix", () => {
    expect(usedOn("court_locations").map((p) => p.to)).toEqual(["/courts"]);
    expect(usedOn("fjc_civil_nos").map((p) => p.to)).toEqual(["/courts/caseload"]);
    expect(usedOn("mdl_intel_hearing_orders").map((p) => p.to)).toEqual(["/matters/intel"]);
    expect(usedOn("court_jb_districts")).toEqual([]);
  });

  it("extracts http(s) URLs only, without credentials or trailing punctuation", () => {
    expect(
      extractUrls(
        'See https://www.cpsc.gov/Recalls. and {"url": "https://open.fda.gov/apis/drug/event/"} ftp://x.org https://u:p@evil.test/ https://www.cpsc.gov/Recalls',
      ),
    ).toEqual(["https://www.cpsc.gov/Recalls", "https://open.fda.gov/apis/drug/event/"]);
  });

  it("groups portals by host and kind", () => {
    const portals = buildPortals([
      ds("a", ["https://www.uscourts.gov/x", "https://www.jpml.uscourts.gov/y"]),
      ds("b", ["https://www.uscourts.gov/z"]),
      ds("c", ["https://courts.ca.gov/rules"]),
    ]);
    expect(portals[0]).toMatchObject({ host: "uscourts.gov", name: "U.S. Courts", kind: "courts" });
    expect(portals[0]!.datasets.map((d) => d.id)).toEqual(["a", "b"]);
    expect(portalKind("courts.ca.gov")).toBe("state");
    expect(portalKind("ed.gov")).toBe("federal");
    expect(portalKind("open.fda.gov")).toBe("federal");
    expect(portalKind("courtlistener.com")).toBe("research");
    expect(portalName("cand.uscourts.gov")).toBe("cand.uscourts.gov (U.S. Courts)");
  });

  it("groups individual court sites and keeps record URLs out of the stated source", () => {
    const rows = [
      {
        ...ds("court_locations", ["https://www.uscourts.gov/links"]),
        recordUrls: ["https://www.cand.uscourts.gov/x"],
      },
      {
        ...ds("courts_db"),
        recordUrls: ["https://www.ca9.uscourts.gov/", "https://www.jpml.uscourts.gov/"],
      },
    ];
    const portals = buildPortals(rows);
    const sites = portals.find((p) => p.host === COURT_SITES)!;
    expect(sites.hosts).toEqual(["ca9.uscourts.gov", "cand.uscourts.gov"]);
    expect(sites.datasets.map((d) => d.id)).toEqual(["court_locations", "courts_db"]);
    expect(portals.find((p) => p.host === "jpml.uscourts.gov")?.name).toBe(
      "Judicial Panel on Multidistrict Litigation",
    );
    expect(rows[0]!.sourceUrls).toEqual(["https://www.uscourts.gov/links"]);
  });

  it("groups datasets into every category and sorts by records", () => {
    const g = groupByCategory([
      ds("court_spine", [], 5),
      ds("courts_db", [], 9),
      ds("x_y", [], null),
    ]);
    expect(g.get("courts")!.map((d) => d.id)).toEqual(["courts_db", "court_spine"]);
    expect(g.get("other")!.map((d) => d.id)).toEqual(["x_y"]);
    expect([...g.keys()]).toEqual(CATEGORIES.map((c) => c.id));
  });

  it("matches every search term", () => {
    expect(matchesQuery("FDA food enforcement reports", "fda food")).toBe(true);
    expect(matchesQuery("FDA food enforcement reports", "fda drug")).toBe(false);
    expect(matchesQuery("anything", "  ")).toBe(true);
  });

  it("keeps workflow steps on in-app pages", () => {
    for (const w of WORKFLOWS) for (const s of w.steps) expect(s.to.startsWith("/")).toBe(true);
  });

  it("normalises the address state", () => {
    expect(normalizeSourcesSearch({ tab: "portals", cat: "courts", q: "fda" })).toEqual({
      tab: "portals",
      cat: "courts",
      q: "fda",
    });
    expect(normalizeSourcesSearch({ tab: "datasets", cat: "nope", q: "" })).toEqual({
      tab: undefined,
      cat: undefined,
      q: undefined,
    });
  });
});
