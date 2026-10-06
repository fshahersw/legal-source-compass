import { describe, expect, it } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  datasetLabel,
  duplicateLookingIds,
  normalizeItem,
  recordDestination,
  resolveLink,
  sectionOf,
  shortRecordId,
} from "./groups";

describe("permanent record destinations", () => {
  it("preserves exact collection identity and native IDs", () => {
    expect(recordDestination("mdls", "mdl:2873")).toEqual({ kind: "mdl", id: "2873" });
    // The matter registry's MDL record opens the matter page; its docket rows keep the generic record view.
    expect(recordDestination("sw_matters_v1", "sw-matter:3140")).toEqual({ kind: "mdl", id: "3140" });
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

describe("sectionOf", () => {
  it("groups datasets by explicit id and prefix", () => {
    expect(sectionOf("court_spine")).toBe("courts");
    expect(sectionOf("judge_disclosures")).toBe("judges");
    expect(sectionOf("mdl_docket_activity")).toBe("matters");
    expect(sectionOf("cl_master_entries")).toBe("matters");
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
    expect(resolveLink(`#record/cl_courts/${encodeURIComponent(literalEscape)}`, aliases)).toEqual({
      kind: "record",
      dataset: "cl_courts",
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
