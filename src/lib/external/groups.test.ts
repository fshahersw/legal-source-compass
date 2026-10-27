import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  datasetLabel,
  datasetSuccessor,
  duplicateLookingIds,
  normalizeItem,
  pageRoutePatterns,
  recordDestination,
  resolveLink as resolveWithRoutes,
  searchLinkOutcome,
  sectionOf,
  shortRecordId,
} from "./groups";

/** The app's real route tree: the generated `fullPaths` union, the same paths the live router exposes. */
function generatedFullPaths(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../routeTree.gen.ts", import.meta.url)),
    "utf8",
  );
  const block = /fullPaths:\s*((?:\|\s*'[^']*'\s*)+)/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}
const ROUTES = pageRoutePatterns(generatedFullPaths());
const resolveLink = (url: string, aliases: Record<string, string>) =>
  resolveWithRoutes(url, aliases, ROUTES);

describe("permanent record destinations", () => {
  it("preserves exact collection identity and native IDs", () => {
    expect(recordDestination("mdls", "mdl:2873")).toEqual({ kind: "mdl", id: "2873" });
    // The matter registry's MDL record opens the matter page; its docket rows keep the generic record view.
    expect(recordDestination("sw_matters_v1", "sw-matter:3140")).toEqual({
      kind: "mdl",
      id: "3140",
    });
    expect(recordDestination("sw_matters_v1", "sw-matter:oops")).toEqual({
      kind: "record",
      dataset: "sw_matters_v1",
      id: "sw-matter:oops",
    });
    expect(recordDestination("sw_matter_dockets_v1", "sw-md:3140:flnd:3:2025-md-03140")).toEqual({
      kind: "record",
      dataset: "sw_matter_dockets_v1",
      id: "sw-md:3140:flnd:3:2025-md-03140",
    });
    expect(recordDestination("mdl_docket_activity", "mdl:2873")).toEqual({
      kind: "record",
      dataset: "mdl_docket_activity",
      id: "mdl:2873",
    });
    expect(recordDestination("court_spine", "cand")).toEqual({ kind: "court", id: "cand" });
    expect(recordDestination("indiana_code", "in:abc")).toEqual({
      kind: "provision",
      dataset: "indiana_code",
      id: "in:abc",
    });
    expect(recordDestination("citation_index", "1956")).toEqual({
      kind: "record",
      dataset: "citation_index",
      id: "1956",
    });
  });
});

describe("datasetSuccessor", () => {
  it("sends the retired staged regulatory-links id to the published collection", () => {
    expect(datasetSuccessor("sw_matter_regulatory_links_v1_staged")).toBe(
      "sw_matter_regulatory_links_v1",
    );
  });
  it("leaves live and unknown ids alone, including inherited object keys", () => {
    expect(datasetSuccessor("sw_matter_regulatory_links_v1")).toBeNull();
    expect(datasetSuccessor("sw_matter_dockets_v1_superseded")).toBeNull();
    expect(datasetSuccessor("constructor")).toBeNull();
    expect(datasetSuccessor("")).toBeNull();
  });
});

describe("sectionOf", () => {
  it("groups datasets by explicit id and prefix", () => {
    expect(sectionOf("court_spine")).toBe("courts");
    expect(sectionOf("judge_entities")).toBe("judges");
    expect(sectionOf("mdl_docket_activity")).toBe("matters");
    expect(sectionOf("agency_safety_openfda_crl")).toBe("safety");
    expect(sectionOf("indiana_code")).toBe("law");
    expect(sectionOf("mass_tort_authority_evidence")).toBe("law");
    expect(sectionOf("something_new")).toBe("other");
  });
});

describe("datasetLabel", () => {
  it("keeps real labels and prettifies raw ids", () => {
    expect(datasetLabel("mdls", "JPML multidistrict litigation")).toBe(
      "JPML multidistrict litigation",
    );
    expect(datasetLabel("judge_entities", "judge_entities")).toBe("Judge Entities");
  });
});

describe("normalizeItem", () => {
  it("uses cells when present and never invents values", () => {
    const n = normalizeItem({
      id: "x",
      title: "  A  v. B ",
      cells: { amount: "$1", empty: null },
      links: [{ url: "https://a", label: "A" }],
      badges: ["Verdict"],
    });
    expect(n.title).toBe("A v. B");
    expect(n.cells).toEqual({ amount: "$1" });
    expect(n.links).toHaveLength(1);
    expect(n.badges).toEqual(["Verdict"]);
  });
  it("falls back to scalar fields and name", () => {
    const n = normalizeItem({
      id: "j1",
      name: "Alice",
      role: "Judge",
      courts: ["C1", "C2"],
      photo_url: "/judge-images/p",
      nested: { a: 1 },
    });
    expect(n.title).toBe("Alice");
    expect(n.cells).toEqual({ role: "Judge", courts: "C1; C2" });
    expect(n.photo).toBe("/judge-images/p");
  });
  it("flattens a dates object and drops producer bookkeeping fields when no cells are published", () => {
    const n = normalizeItem({
      id: "fda-wl:1",
      title: "CGMP/Finished Pharmaceuticals/Adulterated",
      firm: "Example Pharma",
      dates: { posted_date: "2022-01-11", letter_issue_date: "2021-11-23" },
      published_at: "2022-01-11",
      sort_date: "2022-01-11",
      dataset: "fda_warning_letters",
      group: "warning_letters",
      firm_id: "firm:example-pharma",
      firm_norm: "EXAMPLE PHARMA",
      native_id: "1",
    });
    expect(n.cells).toEqual({
      firm: "Example Pharma",
      posted_date: "2022-01-11",
      letter_issue_date: "2021-11-23",
    });
  });
});

describe("resolveLink", () => {
  const aliases = {
    mdls: "mdls",
    mdl_docket_activity: "mdl_docket_activity",
    "mdl-activity": "mdl_docket_activity",
  };
  it("preserves publisher hierarchy identity in permanent record tokens and decodes once", () => {
    const longestRecordedId =
      "ecfr:node:title-40/chapter-I/subchapter-C/part-82/subpart-A/appendix-Appendix%20J%20to%20Subpart%20A%20of%20Part%2082%20-%20Parties%20to%20the%20Montreal%20Protocol%20Classied%20Under%20Article%205%281%29%20That%20Have%20Banned%20the%20Import%20of%20Controlled%20Products%20That%20Rely%20on%20Class%20I%20Controlled%20Substances%20for%20Their%20Continuing%20Functioning";
    expect(longestRecordedId).toHaveLength(369);
    expect(
      resolveLink(`#record/ecfr_hierarchy/${encodeURIComponent(longestRecordedId)}`, aliases),
    ).toEqual({ kind: "record", dataset: "ecfr_hierarchy", id: longestRecordedId });
    const root = createRootRoute();
    const record = createRoute({ getParentRoute: () => root, path: "/records/$dataset/$id" });
    const router = createRouter({
      routeTree: root.addChildren([record]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const destination = router.buildLocation({
      to: "/records/$dataset/$id",
      params: { dataset: "ecfr_hierarchy", id: longestRecordedId },
    });
    expect(destination.pathname).toBe(
      `/records/ecfr_hierarchy/${encodeURIComponent(longestRecordedId)}`,
    );
    expect(router.matchRoutes(destination.pathname).at(-1)?.params).toEqual({
      dataset: "ecfr_hierarchy",
      id: longestRecordedId,
    });
    const id = "ecfr:node:title-21/chapter-I/subchapter-H/part-820";
    expect(resolveLink(`#record/ecfr_hierarchy/${encodeURIComponent(id)}`, aliases)).toEqual({
      kind: "record",
      dataset: "ecfr_hierarchy",
      id,
    });
    const literalEscape = "native:%2F";
    expect(
      resolveLink(`#record/court_spine/${encodeURIComponent(literalEscape)}`, aliases),
    ).toEqual({
      kind: "record",
      dataset: "court_spine",
      id: literalEscape,
    });
    expect(recordDestination("ecfr_hierarchy", id)).toEqual({
      kind: "record",
      dataset: "ecfr_hierarchy",
      id,
    });
  });
  it("leaves malformed and unsafe record tokens inert", () => {
    for (const token of [
      "#record/ecfr_hierarchy/%ZZ",
      "#record/ecfr_hierarchy/%E0%A4%A",
      "#record/ecfr_hierarchy/",
      "#record/../native",
      "#record/ecfr-hierarchy/native",
      "#record/ecfr_hierarchy/native/child",
      "#record/ecfr_hierarchy/native?dataset=other",
      "#record/ecfr_hierarchy/native%23child",
      "#record/ecfr_hierarchy/native%3Fquery",
      "#record/ecfr_hierarchy/native%00id",
      "#record/ecfr_hierarchy/native%5Cpath",
      "#record/ecfr_hierarchy/native%2F..%2Fchild",
      "#record/ecfr_hierarchy/%20native",
      `#record/ecfr_hierarchy/${"x".repeat(513)}`,
      `#record/ecfr_hierarchy/${encodeURIComponent("\u0800".repeat(171))}`,
      "#judge/%ZZ",
    ])
      expect(resolveLink(token, aliases)).toEqual({ kind: "unmapped", raw: token });
  });
  it("does not guess record identities from unknown native tokens", () => {
    const id = "oul:ba1dac985d5bad2c6fa80ecaa19261a8e2b1f45102c91f1e4c053ce835f2ef52";
    expect(resolveLink(`#record/${id}`, aliases)).toEqual({
      kind: "unmapped",
      raw: `#record/${id}`,
    });
    expect(resolveLink("#record/unknown:123", aliases)).toEqual({
      kind: "unmapped",
      raw: "#record/unknown:123",
    });
    expect(resolveLink(`#record/${id}?dataset=other`, aliases)).toEqual({
      kind: "unmapped",
      raw: `#record/${id}?dataset=other`,
    });
  });
  it("maps corpus hash routes to datasets and search", () => {
    expect(resolveLink("#mdls?court=cand", aliases)).toEqual({
      kind: "dataset",
      dataset: "mdls",
      q: "",
      filters: { court: "cand" },
    });
    expect(resolveLink("#mdl-activity?mdl=3071", aliases)).toMatchObject({
      kind: "dataset",
      dataset: "mdl_docket_activity",
    });
    expect(resolveLink("#documents?q=N.D.%20Cal", aliases)).toEqual({
      kind: "search",
      q: "N.D. Cal",
    });
  });
  it("routes stored files through the proxy and keeps external urls intact", () => {
    expect(resolveLink("/supplement-files/court_reference/ilcb", aliases)).toEqual({
      kind: "file",
      href: "/api/files?route=%2Fsupplement-files%2Fcourt_reference%2Filcb",
    });
    expect(resolveLink("https://x.gov/a?b=1#c", aliases)).toEqual({
      kind: "external",
      href: "https://x.gov/a?b=1#c",
    });
    expect(resolveLink("#unknown", aliases)).toEqual({ kind: "unmapped", raw: "#unknown" });
  });
});

describe("stored root-relative paths: in-app pages vs stored files", () => {
  const app = (to: string, params: Record<string, string> = {}) => ({
    kind: "app",
    to,
    params,
    search: null,
    hash: null,
  });

  it("reads page routes from the generated route tree, without the /api endpoints", () => {
    expect(generatedFullPaths().length).toBeGreaterThan(50);
    for (const r of [
      "/companies/$cik",
      "/courts/$id",
      "/judges/$id",
      "/matters/lens/$mdl",
      "/places/$state",
      "/records/$dataset/$id",
      "/companies",
      "/",
    ])
      expect(ROUTES).toContain(r);
    expect(ROUTES.some((r) => r === "/api" || r.startsWith("/api/"))).toBe(false);
    expect(ROUTES.some((r) => r.length > 1 && r.endsWith("/"))).toBe(false);
  });

  it("has only literal and named-param segments, the only kinds the stored-path matcher reads", () => {
    // A splat ("/x/$"), optional ("{-$x}") or prefixed ("{$x}.json") segment would be matched as a literal and
    // stored paths under it would silently read as unmapped: extend matchPageRoute before adding one.
    const odd = ROUTES.flatMap((r) => r.split("/").slice(1)).filter(
      (seg) => seg.includes("$") && !/^\$[A-Za-z_]\w*$/.test(seg),
    );
    expect(odd).toEqual([]);
    expect(ROUTES.some((r) => /[{}]/.test(r))).toBe(false);
  });

  it("derives the same patterns from a live router's routesById", () => {
    const root = createRootRoute();
    const companies = createRoute({ getParentRoute: () => root, path: "/companies/" });
    const company = createRoute({ getParentRoute: () => root, path: "/companies/$cik" });
    const files = createRoute({ getParentRoute: () => root, path: "/api/files" });
    const router = createRouter({
      routeTree: root.addChildren([companies, company, files]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const live = pageRoutePatterns(Object.values(router.routesById).map((r) => r.fullPath));
    expect(live).toEqual(["/", "/companies", "/companies/$cik"]);
    expect(resolveWithRoutes("/companies/0000001800", {}, live)).toEqual(
      app("/companies/$cik", { cik: "0000001800" }),
    );
  });

  it("opens stored in-app links (real examples from item/detail links) as router links", () => {
    expect(resolveLink("/companies/0000001800", {})).toEqual(
      app("/companies/$cik", { cik: "0000001800" }),
    );
    expect(resolveLink("/courts/akd", {})).toEqual(app("/courts/$id", { id: "akd" }));
    expect(resolveLink("/judges/0026ac81ec4658f59f134da92fc995ac", {})).toEqual(
      app("/judges/$id", { id: "0026ac81ec4658f59f134da92fc995ac" }),
    );
    expect(resolveLink("/matters/lens/1", {})).toEqual(app("/matters/lens/$mdl", { mdl: "1" }));
    expect(resolveLink("/places/AK", {})).toEqual(app("/places/$state", { state: "AK" }));
    // A static route wins over a parameter route, as in the router.
    expect(resolveLink("/places/analytics", {})).toEqual(app("/places/analytics"));
    expect(resolveLink("/companies/", {})).toEqual(app("/companies"));
    expect(resolveLink("/records/agency_safety_cpsc_recalls_local/cpsc:rcl:26341", {})).toEqual({
      kind: "record",
      dataset: "agency_safety_cpsc_recalls_local",
      id: "cpsc:rcl:26341",
    });
    expect(resolveLink("/records/mdls/1358", {})).toEqual({
      kind: "record",
      dataset: "mdls",
      id: "1358",
    });
    expect(resolveLink("/matters/lens/1?tab=hearings#orders", {})).toEqual({
      ...app("/matters/lens/$mdl", { mdl: "1" }),
      search: { tab: "hearings" },
      hash: "orders",
    });
  });

  it("keeps everything after the dataset as the record id, so ids containing '/' open their record", () => {
    for (const [stored, dataset, id] of [
      [
        "/records/agency_safety_openfda_device_enforcement/openfda:device/enforcement:Z-1770-2026",
        "agency_safety_openfda_device_enforcement",
        "openfda:device/enforcement:Z-1770-2026",
      ],
      [
        "/records/agency_safety_openfda_food_enforcement/openfda:food/enforcement:N/A",
        "agency_safety_openfda_food_enforcement",
        "openfda:food/enforcement:N/A",
      ],
      [
        "/records/agency_safety_openfda_crl/openfda:transparency/crl:CRL_BLA761308_20260709_Redacted.pdf",
        "agency_safety_openfda_crl",
        "openfda:transparency/crl:CRL_BLA761308_20260709_Redacted.pdf",
      ],
    ] as const) {
      expect(resolveLink(stored, {})).toEqual({ kind: "record", dataset, id });
      // The router encodes the id as one segment and reads it back intact.
      const root = createRootRoute();
      const record = createRoute({ getParentRoute: () => root, path: "/records/$dataset/$id" });
      const router = createRouter({
        routeTree: root.addChildren([record]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
      });
      const loc = router.buildLocation({ to: "/records/$dataset/$id", params: { dataset, id } });
      expect(loc.pathname).toBe(`/records/${dataset}/${encodeURIComponent(id)}`);
      expect(router.matchRoutes(loc.pathname).at(-1)?.params).toEqual({ dataset, id });
    }
    // An already-encoded id is decoded exactly once.
    expect(
      resolveLink("/records/agency_safety_openfda_crl/openfda%3Atransparency%2Fcrl%3Ax", {}),
    ).toEqual({
      kind: "record",
      dataset: "agency_safety_openfda_crl",
      id: "openfda:transparency/crl:x",
    });
  });

  it("serves stored corpus files (every corpus_artifacts route root) through /api/files", () => {
    for (const route of [
      "/supplement-files/court_reference/ilcb",
      "/supplement-files/agency_science_documents/10",
      "/files/0002d027ebf80b17609ee88bcc6aa706",
      "/judge-images/asset_0af91b0f65152938",
      "/library-assets/court-image-21bef4871fc4b187c7834af0",
      "/source-assets/archive:005945d89bdae8e70eeac16c770cda5e338bafcaa8efb15e6c331dfcb42d8c22/original",
      "/agency-files/fda-press-recalls-xlsx",
      "/mdl-files/jpmldoc-1113fa70c31288db",
      "/api/trellis-coverage/receipt?id=tc-0002",
      "/api/enrichment/file?id=addition%3A001cf2d2959d8a967edbf296&kind=original",
      "/api/county-litigation-asset?id=county-litigation%3A0022f6784f77ad841a7295a8a4bc39ed&kind=original",
    ])
      expect(resolveLink(route, {})).toEqual({
        kind: "file",
        href: `/api/files?route=${encodeURIComponent(route)}`,
      });
  });

  it("labels paths under a page route that match no route instead of sending them to the file proxy", () => {
    for (const raw of [
      "/courts/akd/extra",
      "/records/agency_safety_insights",
      "/records/Not-A-Dataset/x",
      "/records/agency_safety_insights/a/../b",
      "/courts//akd",
      "/courts/%ZZ",
      "/courts/a%2Fb",
      "//evil.example/x",
    ])
      expect(resolveLink(raw, {})).toEqual({ kind: "unmapped", raw });
  });

  it("never opens a record path whose stored id may carry '?', '#' or a trailing '/' as a different record", () => {
    // Record ids are stored raw: "abc?x" is not record "abc" with a query.
    for (const raw of [
      "/records/agency_safety_openfda_crl/abc?x",
      "/records/agency_safety_openfda_crl/abc#x",
      "/records/agency_safety_openfda_crl/abc/",
      "/records/agency_safety_openfda_device_enforcement/openfda:device/enforcement:Z-1?x=1",
      "/records/agency_safety_openfda_device_enforcement/openfda:device/enforcement:Z-1/",
    ])
      expect(resolveLink(raw, {})).toEqual({ kind: "unmapped", raw });
    // Other page routes keep their query and hash.
    expect(resolveLink("/courts/akd?tab=x", {})).toMatchObject({
      kind: "app",
      to: "/courts/$id",
      search: { tab: "x" },
    });
  });
});

describe("openFDA searches recorded as finding nothing usable", () => {
  const url =
    'https://api.fda.gov/device/event.json?search=device.manufacturer_d_name:"BAUSCH%20AND%20LOMB%20AMERICAS"&count=device.manufacturer_d_name.exact&limit=100';
  const query = { url, label: "openFDA query" };
  const noMatch = {
    id: "maude-100001116887",
    facts: [
      ["Matched MAUDE spellings", "None"],
      ["Reports received 2017-2025 (lower bound)", "Not applicable"],
    ],
  };
  const matched = {
    id: "maude-100000010935",
    facts: [["Matched MAUDE spellings", "VALEANT PHARMACEUTICALS NORTH AMERICA LLC"]],
  };
  const ds = "company_adverse_manufacturers";
  it("flags the query links of no-match records only", () => {
    expect(searchLinkOutcome(ds, noMatch, query)).toBe("no_exact_match");
    expect(searchLinkOutcome(ds, matched, query)).toBeNull();
    // The openFDA documentation page is a real source and stays a link.
    expect(
      searchLinkOutcome(ds, noMatch, {
        url: "https://open.fda.gov/apis/device/event/",
        label: "openFDA device adverse events",
      }),
    ).toBeNull();
    expect(
      searchLinkOutcome("agency_safety_openfda_device_enforcement", noMatch, query),
    ).toBeNull();
    expect(searchLinkOutcome(ds, {}, query)).toBeNull();
  });
  it("uses a per-query recorded result on matched records too, never the query text", () => {
    // e.g. 'BAUSCH HEALTH US' on maude-100000010935 answers 404 "No matches found!"; once the builder records the
    // per-query result in the label, that one query is listed as such while the record's other links stay links.
    const empty = { url, label: "openFDA query (no matches)" };
    expect(searchLinkOutcome(ds, matched, empty)).toBe("no_matches");
    expect(searchLinkOutcome(ds, noMatch, empty)).toBe("no_matches");
    expect(searchLinkOutcome(ds, matched, query)).toBeNull();
    // The label marks only openFDA API queries of this dataset.
    expect(
      searchLinkOutcome(ds, matched, {
        url: "https://open.fda.gov/apis/device/event/",
        label: "openFDA query (no matches)",
      }),
    ).toBeNull();
    expect(
      searchLinkOutcome("agency_safety_openfda_device_enforcement", matched, empty),
    ).toBeNull();
  });
});

describe("display-time clean-up of stored strings", () => {
  it("decodes entities and collapses whitespace in titles and cells, leaving the input untouched", () => {
    const raw = {
      id: "ecfr:21:74",
      title: "  Part 74 &#8212;  Listing of color additives &amp;   exemptions \n",
      cells: { heading: "&lt;Reserved&gt;", note: "AT&amp;T" },
    };
    const item = normalizeItem(raw);
    expect(item.title).toBe("Part 74 — Listing of color additives & exemptions");
    expect(item.cells).toEqual({ heading: "<Reserved>", note: "AT&T" });
    expect(raw.title).toContain("&#8212;");
  });

  it("encodes raw spaces in an external href without altering the stored url", () => {
    const stored = "https://www.uscourts.gov/files/Smith, John 2024.pdf";
    expect(resolveLink(stored, {})).toEqual({
      kind: "external",
      href: "https://www.uscourts.gov/files/Smith,%20John%202024.pdf",
    });
    expect(stored).toContain(" ");
  });

  it("flags rows that look identical on a page so they can be told apart by record id", () => {
    const row = (id: string, cells: Record<string, string>) =>
      normalizeItem({
        id,
        title: "David R Buchanan",
        subtitle: "Seeger Weiss",
        cells,
        badges: ["MDL 2873"],
      });
    const items = [
      row("a1", { mdl: "2873", role: "Attorney to be noticed" }),
      row("a2", { mdl: "2873", role: "Attorney to be noticed" }),
      row("a3", { mdl: "2873", role: "Lead attorney" }),
    ];
    expect([...duplicateLookingIds(items)].sort()).toEqual(["a1", "a2"]);
    expect(duplicateLookingIds([])).toEqual(new Set());
    expect(shortRecordId("004171ce-e2c1-5d3c-8371-54d9e04b721a")).toBe("004171ce…");
    expect(shortRecordId("firm:3f24b0b7635a81a8")).toBe("firm:3f24b0b7635a81a8");
    expect(shortRecordId("x".repeat(40))).toBe(`${"x".repeat(26)}…`);
  });
});
