import { describe, expect, it } from "vitest";
import { normalizeItem, resolveLink, sectionOf, datasetLabel, recordDestination } from "./groups";

describe("permanent record destinations", () => {
  it("preserves exact collection identity and native IDs", () => {
    expect(recordDestination("mdls", "mdl:2873")).toEqual({ kind: "mdl", id: "2873" });
    expect(recordDestination("mdl_docket_activity", "mdl:2873")).toEqual({ kind: "record", dataset: "mdl_docket_activity", id: "mdl:2873" });
    expect(recordDestination("court_spine", "cand")).toEqual({ kind: "court", id: "cand" });
    expect(recordDestination("open_us_law", "oul:abc")).toEqual({ kind: "provision", dataset: "open_us_law", id: "oul:abc" });
    expect(recordDestination("citation_index", "1956")).toEqual({ kind: "record", dataset: "citation_index", id: "1956" });
  });
});

describe("sectionOf", () => {
  it("groups datasets by explicit id and prefix", () => {
    expect(sectionOf("court_spine")).toBe("courts");
    expect(sectionOf("judge_disclosures")).toBe("judges");
    expect(sectionOf("mdl_docket_activity")).toBe("matters");
    expect(sectionOf("agency_safety_openfda_crl")).toBe("safety");
    expect(sectionOf("open_us_law")).toBe("law");
    expect(sectionOf("something_new")).toBe("other");
  });
});

describe("datasetLabel", () => {
  it("keeps real labels and prettifies raw ids", () => {
    expect(datasetLabel("mdls", "JPML multidistrict litigation")).toBe("JPML multidistrict litigation");
    expect(datasetLabel("judge_entities", "judge_entities")).toBe("Judge Entities");
  });
});

describe("normalizeItem", () => {
  it("uses cells when present and never invents values", () => {
    const n = normalizeItem({ id: "x", title: "  A  v. B ", cells: { amount: "$1", empty: null }, links: [{ url: "https://a", label: "A" }], badges: ["Verdict"] });
    expect(n.title).toBe("A v. B");
    expect(n.cells).toEqual({ amount: "$1" });
    expect(n.links).toHaveLength(1);
    expect(n.badges).toEqual(["Verdict"]);
  });
  it("falls back to scalar fields and name", () => {
    const n = normalizeItem({ id: "j1", name: "Alice", role: "Judge", courts: ["C1", "C2"], photo_url: "/judge-images/p", nested: { a: 1 } });
    expect(n.title).toBe("Alice");
    expect(n.cells).toEqual({ role: "Judge", courts: "C1; C2" });
    expect(n.photo).toBe("/judge-images/p");
  });
});

describe("resolveLink", () => {
  const aliases = { mdls: "mdls", mdl_docket_activity: "mdl_docket_activity", "mdl-activity": "mdl_docket_activity" };
  it("opens an exact native saved-law target without guessing other record identities", () => {
    const id = "oul:ba1dac985d5bad2c6fa80ecaa19261a8e2b1f45102c91f1e4c053ce835f2ef52";
    expect(resolveLink(`#record/${id}`, aliases)).toEqual({ kind: "provision", dataset: "open_us_law", id });
    expect(resolveLink("#record/unknown:123", aliases)).toEqual({ kind: "unmapped", raw: "#record/unknown:123" });
    expect(resolveLink(`#record/${id}?dataset=other`, aliases)).toEqual({ kind: "unmapped", raw: `#record/${id}?dataset=other` });
  });
  it("maps corpus hash routes to datasets and search", () => {
    expect(resolveLink("#mdls?court=cand", aliases)).toEqual({ kind: "dataset", dataset: "mdls", q: "", filters: { court: "cand" } });
    expect(resolveLink("#mdl-activity?mdl=3071", aliases)).toMatchObject({ kind: "dataset", dataset: "mdl_docket_activity" });
    expect(resolveLink("#documents?q=N.D.%20Cal", aliases)).toEqual({ kind: "search", q: "N.D. Cal" });
  });
  it("routes stored files through the proxy and keeps external urls intact", () => {
    expect(resolveLink("/supplement-files/court_reference/ilcb", aliases)).toEqual({ kind: "file", href: "/api/files?route=%2Fsupplement-files%2Fcourt_reference%2Filcb" });
    expect(resolveLink("https://x.gov/a?b=1#c", aliases)).toEqual({ kind: "external", href: "https://x.gov/a?b=1#c" });
    expect(resolveLink("#unknown", aliases)).toEqual({ kind: "unmapped", raw: "#unknown" });
  });
});
