import { describe, expect, it } from "vitest";
import {
  classifyResource,
  commercialHost,
  coversState,
  hiddenCounts,
  hostKey,
  hostState,
  partitionResources,
  registrable,
  type ResourceFacts,
} from "./resourceFilter";

const facts = (
  domain: string,
  title = "A resource",
  extra: Partial<ResourceFacts> = {},
): ResourceFacts => ({
  url: `https://${domain}/page`,
  domain,
  title,
  text: [],
  ...extra,
});

describe("commercialHost", () => {
  it("recognises the named publishers on any subdomain", () => {
    for (const h of [
      "www.findlaw.com",
      "caselaw.findlaw.com",
      "california.lp.findlaw.com",
      "law.justia.com",
      "govt.westlaw.com",
      "advance.lexis.com",
      "supportcenter.lexisnexis.com",
      "casetext.com",
      "ballotpedia.org",
      "scholar.google.com",
      "publicrecords.netronline.com",
    ])
      expect(commercialHost(h), h).not.toBeNull();
  });
  it("leaves nonprofit and government hosts alone", () => {
    for (const h of [
      "www.law.cornell.edu",
      "www.courtlistener.com",
      "www.uscourts.gov",
      "codelibrary.amlegal.com",
      "library.municode.com",
      "www.ca.gov",
    ])
      expect(commercialHost(h), h).toBeNull();
  });
  it("does not match a lookalike inside another name", () => {
    expect(commercialHost("notfindlaw.com")).toBeNull();
    expect(registrable("a.b.example.co")).toBe("example.co");
  });
});

describe("hostState", () => {
  it.each([
    ["www.in.gov", "IN"],
    ["portal.ct.gov", "CT"],
    ["www.maine.gov", "ME"],
    ["mn.gov", "MN"],
    ["courts.delaware.gov", "DE"],
    ["courts.state.ny.us", "NY"],
    ["www.state.nj.us", "NJ"],
    ["www.txcourts.gov", "TX"],
    ["www.njcourts.gov", "NJ"],
    ["www.sccourts.org", "SC"],
    ["wvbar.org", "WV"],
    ["floridabar.org", "FL"],
    ["www.myflorida.com", "FL"],
    ["www.mass.gov", "MA"],
    ["law.indiana.edu", "IN"],
    ["libguides.law.rutgers.edu", "NJ"],
    ["guides.ou.edu", "OK"],
    ["www.dc.gov", "DC"],
    ["law.indiana.libguides.com", "IN"],
    ["texas.libguides.com", "TX"],
  ])("%s belongs to %s", (host, state) => {
    expect(hostState(host)).toBe(state);
  });
  it.each([
    "www.va.gov",
    "www.uscourts.gov",
    "www.usa.gov",
    "www.fda.gov",
    "www.justice.gov",
    "example.com",
    "www.govinfo.gov",
    "uscode.house.gov",
    "oslpr.org",
    "x",
  ])("%s cannot be placed in a state", (host) => {
    expect(hostState(host)).toBeNull();
  });
});

describe("coversState", () => {
  it("is true when the resource's own text names the state", () => {
    expect(coversState(facts("law.indiana.edu", "California legal research guide"), "CA")).toBe(
      true,
    );
    expect(
      coversState(
        facts("x.edu", "Guide", { text: ["Covers New York and California courts"] }),
        "CA",
      ),
    ).toBe(true);
  });
  it("is true for national and multi-state statements", () => {
    expect(coversState(facts("x.edu", "50-state survey of statutes"), "CA")).toBe(true);
    expect(coversState(facts("x.edu", "United States Code"), "CA")).toBe(true);
  });
  it("does not read state codes", () => {
    expect(coversState(facts("x.edu", "Rules of IN RE proceedings"), "IN")).toBe(false);
    expect(coversState(facts("x.edu", "CA courts"), "CA")).toBe(false);
  });
  it("does not read a state name inside another word", () => {
    expect(coversState(facts("x.edu", "Indiana Jones Studies"), "IA")).toBe(false);
  });
});

describe("classifyResource", () => {
  it("hides commercial hosts with the reason", () => {
    const c = classifyResource(facts("caselaw.findlaw.com", "California Cases"), "CA");
    expect(c).toMatchObject({ show: false, reason: "commercial" });
  });
  it("hides an Indiana university guide on the California page, but not on Indiana's", () => {
    const guide = facts("libguides.law.indiana.edu", "Legal research guide");
    expect(classifyResource(guide, "CA")).toMatchObject({ show: false, reason: "other_state" });
    expect(classifyResource(guide, "IN")).toEqual({ show: true });
  });
  it("hides the Indiana law library's hosted guide on another state's page", () => {
    const guide = facts("law.indiana.libguides.com", "Legislative History Guides and Resources");
    expect(classifyResource(guide, "CA")).toMatchObject({ show: false, reason: "other_state" });
    expect(classifyResource(guide, "IN")).toEqual({ show: true });
    expect(classifyResource(facts("libguides.com", "Guide"), "CA")).toEqual({ show: true });
  });
  it("shows an out-of-state host whose own text covers the page's state", () => {
    expect(
      classifyResource(facts("law.indiana.edu", "Guide to California practice"), "CA"),
    ).toEqual({ show: true });
  });
  it("never flags a host it cannot place", () => {
    expect(classifyResource(facts("www.example-guides.com", "Guide"), "CA")).toEqual({
      show: true,
    });
    expect(classifyResource(facts("www.fda.gov", "FDA recalls"), "CA")).toEqual({ show: true });
  });
  it("shows a state's own official hosts", () => {
    expect(classifyResource(facts("www.courts.ca.gov", "Judicial Council"), "CA")).toEqual({
      show: true,
    });
  });
});

describe("partitionResources", () => {
  const rows = [
    facts("www.courts.ca.gov", "Judicial Council"),
    facts("www.findlaw.com", "FindLaw"),
    facts("www.in.gov", "Indiana courts"),
    facts("example.com", "Other"),
  ];
  it("keeps every row exactly once and counts the reasons", () => {
    const { shown, hidden } = partitionResources(rows, "CA", (r) => r);
    expect(shown.map((r) => r.domain)).toEqual(["www.courts.ca.gov", "example.com"]);
    expect(hidden.map((h) => h.row.domain)).toEqual(["www.findlaw.com", "www.in.gov"]);
    expect(shown.length + hidden.length).toBe(rows.length);
    expect(hiddenCounts(hidden)).toEqual({ commercial: 1, otherState: 1 });
  });
  it("does not change its input", () => {
    const copy = JSON.stringify(rows);
    partitionResources(rows, "CA", (r) => r);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("registry evidence", () => {
  const guide = facts("libguides.law.indiana.edu", "Legal research guide");
  it("shows an out-of-state-looking host the registry registers to the page's own state", () => {
    const registry = new Map([["libguides.law.indiana.edu", "CA"]]);
    expect(classifyResource(guide, "CA", registry)).toEqual({ show: true, evidence: "registry" });
  });
  it("does not rescue a host the registry places in another state, or one it does not list", () => {
    expect(
      classifyResource(guide, "CA", new Map([["libguides.law.indiana.edu", "IN"]])),
    ).toMatchObject({
      show: false,
      reason: "other_state",
    });
    expect(classifyResource(guide, "CA", new Map([["other.example.gov", "CA"]]))).toMatchObject({
      show: false,
    });
    expect(classifyResource(guide, "CA", new Map())).toMatchObject({ show: false });
  });
  it("never overrides the commercial rule", () => {
    const f = facts("caselaw.findlaw.com", "California Cases");
    expect(classifyResource(f, "CA", new Map([["caselaw.findlaw.com", "CA"]]))).toMatchObject({
      show: false,
      reason: "commercial",
    });
  });
  it("keys hosts the way the registry lookup does", () => {
    expect(hostKey("https://WWW.IN.gov:8080/x?y")).toBe("www.in.gov");
    expect(hostKey("Law.Indiana.EDU")).toBe("law.indiana.edu");
  });
  it("partitions with the registry map and leaves the default behaviour unchanged without it", () => {
    const rows = [
      facts("www.in.gov", "Indiana courts"),
      facts("www.courts.ca.gov", "Judicial Council"),
    ];
    const without = partitionResources(rows, "CA", (r) => r);
    expect(without.hidden.map((h) => h.row.domain)).toEqual(["www.in.gov"]);
    const withMap = partitionResources(rows, "CA", (r) => r, new Map([["www.in.gov", "CA"]]));
    expect(withMap.shown.map((r) => r.domain)).toEqual(["www.in.gov", "www.courts.ca.gov"]);
    expect(withMap.hidden).toEqual([]);
  });
});
