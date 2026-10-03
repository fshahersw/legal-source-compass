import { describe, expect, it } from "vitest";
import { buildEntityView } from "./entityView";
import { displayValue } from "./domainRegistry";

describe("source attribution", () => {
  it("preserves nested source-version evidence as inert JSON on permanent record pages", () => {
    const provenance = {
      projection_schema: "courtlistener-docket-metadata-view/1",
      selection_source: { payload_sha256: "a".repeat(64), retrieved_at: "2026-10-02T08:38:15Z" },
      metadata_source: {
        payload_sha256: "b".repeat(64),
        source_url: "https://www.courtlistener.com/api/rest/v4/dockets/123/",
      },
      source_note: '<a href="javascript:alert(1)">Untrusted source text</a>',
    };
    const raw = { id: "cl:dockets:123", title: "Docket 123", provenance };
    const view = buildEntityView(raw);
    expect(JSON.parse(view.provenanceJson!)).toEqual(provenance);
    expect(view.links).toEqual([]);
    expect(view.sections).toEqual([]);
    expect(view.technical).toEqual([]);
    expect(raw.provenance).toEqual(provenance);
  });
  it("keeps absent provenance absent and retains legacy scalar evidence", () => {
    expect(buildEntityView({ id: "x" }).provenanceJson).toBeNull();
    const view = buildEntityView({ id: "x", provenance: "Original publisher note" });
    expect(view.provenanceJson).toBeNull();
    expect(view.technical).toContainEqual(["Provenance", "Original publisher note"]);
  });
  it("does not call an arbitrary stored source URL official", () => {
    const raw = {
      id: "x",
      title: "Third-party report",
      source_url: "https://example.com/report",
      qualification: "Secondary summary; not an adjudicated finding.",
    };
    const view = buildEntityView(raw);
    expect(view.links).toContainEqual({ url: raw.source_url, label: "Original source" });
    expect(view.qualification).toBe(raw.qualification);
    expect(view.technical).not.toContainEqual(["Qualification", raw.qualification]);
    expect(raw.source_url).toBe("https://example.com/report");
  });
});

describe("visible source-qualified record facts", () => {
  it("displays missing FDA facts without hiding zero, false or native classification codes", () => {
    const raw = {
      id: "openfda:device-classification:BRT",
      facts: [
        ["FDA review code", ""],
        ["FDA classification reason", " \n\t"],
        ["Source count", 0],
        ["Source flag", false],
        ["Native code N", "N"],
        ["Native code U", "U"],
        ["Native code f", "f"],
      ],
    };
    const original = JSON.stringify(raw);
    expect(
      buildEntityView(raw).facts.map(([label, value]) => [label, displayValue(value)]),
    ).toEqual([
      ["FDA review code", "Not recorded"],
      ["FDA classification reason", "Not recorded"],
      ["Source count", "0"],
      ["Source flag", "No"],
      ["Native code N", "N"],
      ["Native code U", "U"],
      ["Native code f", "f"],
    ]);
    expect(JSON.stringify(raw)).toBe(original);
  });
  it("keeps native hazard classes, device classes and filing dates visible beside their source scope", () => {
    const raw = {
      id: "x",
      qualification: "Dated metadata; source status is not current lifecycle.",
      facts: [
        ["Recall hazard class (FDA)", "Class II"],
        ["Device regulatory class (FDA)", "3"],
        ["Filing date (source)", "2026-10-01"],
        ["Native court (as recorded)", "cand"],
        ["How the count was produced", "Native source rows"],
        ["Snapshot basis", "Dated export"],
      ],
    };
    const view = buildEntityView(raw);
    expect(view.facts).toEqual(raw.facts.slice(0, 4));
    expect(view.technical).toEqual(raw.facts.slice(4));
    expect(view.qualification).toBe(raw.qualification);
    expect(buildEntityView({ id: "x" }).qualification).toBeNull();
    const unsafe = '<a href="javascript:alert(1)">Source text</a>\nSecond line';
    expect(buildEntityView({ qualification: unsafe }).qualification).toBe(unsafe);
    expect(buildEntityView({ qualification: unsafe }).links).toEqual([]);
  });
});

describe("publisher section citation notes", () => {
  it("shows every native CITA excerpt separately while retaining the section heading table", () => {
    const raw = {
      id: "ecfr:notes:21:820",
      section_source_notes: [
        {
          section_identifier: "820.1",
          heading: "Scope",
          citation_notes: [
            { attributes: { TYPE: "N" }, text: "[61 FR 52654, Oct. 7, 1996]" },
            { attributes: {}, text: "[79 FR 1740, Jan. 10, 2014]" },
          ],
          source_notes: ["Publisher source excerpt"],
        },
        {
          section_identifier: "820.2",
          heading: "Definitions",
          citation_notes: [],
          source_notes: [],
        },
      ],
    };
    const original = JSON.stringify(raw);
    const view = buildEntityView(raw);
    expect(view.sections.find((s) => s.key === "publisher_section_citations")).toEqual({
      kind: "items",
      key: "publisher_section_citations",
      label: "Publisher section citation notes",
      items: [
        { title: "820.1 — Scope", subtitle: "[61 FR 52654, Oct. 7, 1996]", links: [] },
        { title: "820.1 — Scope", subtitle: "[79 FR 1740, Jan. 10, 2014]", links: [] },
      ],
    });
    expect(view.sections.find((s) => s.key === "publisher_section_sources")).toMatchObject({
      items: [{ title: "820.1 — Scope", subtitle: "Publisher source excerpt", links: [] }],
    });
    expect(view.sections.find((s) => s.key === "section_source_notes")).toMatchObject({
      kind: "table",
      rows: [
        ["820.1", "Scope", "Publisher source excerpt"],
        ["820.2", "Definitions", "—"],
      ],
    });
    expect(JSON.stringify(raw)).toBe(original);
  });

  it("keeps citation text and attributes inert, and ignores unrecognized malformed notes", () => {
    const excerpt = '<a href="javascript:alert(1)">Native publisher text</a>\nSecond line';
    const raw = {
      id: "ecfr:notes:x",
      section_source_notes: [
        { citation_notes: [{ text: excerpt, attributes: { href: "javascript:alert(1)" } }] },
        { citation_notes: [null, "Unsupported shape", { text: "" }, { text: 12 }] },
        { citation_notes: "Not a native notes array" },
        null,
      ],
      unrelated_nested_notes: [{ citation_notes: [{ text: "Not an eCFR section field" }] }],
    };
    const original = JSON.stringify(raw);
    const section = buildEntityView(raw).sections.find(
      (s) => s.key === "publisher_section_citations",
    );
    expect(section).toMatchObject({
      items: [{ title: "Section identifier not recorded", subtitle: excerpt, links: [] }],
    });
    expect(buildEntityView(raw).links).toEqual([]);
    expect(JSON.stringify(raw)).toBe(original);
    expect(buildEntityView({ section_source_notes: [] }).sections).toEqual([]);
  });
});

describe("display-time clean-up in record pages", () => {
  it("decodes entities in titles, facts and text and encodes raw spaces in link hrefs", () => {
    const view = buildEntityView({
      id: "disc-1",
      title: "Financial disclosure &amp; investments",
      text: "Part 21 &#8212; Protection of privacy &lt;reserved&gt;",
      source_url: "https://www.uscourts.gov/files/Smith, John 2024.pdf",
      facts: [["Filer", "Smith &amp; Jones"]],
      links: [{ url: "https://example.test/a b.pdf", label: "Copy" }],
    });
    expect(view.title).toBe("Financial disclosure & investments");
    expect(view.text).toBe("Part 21 — Protection of privacy <reserved>");
    expect(view.facts).toContainEqual(["Filer", "Smith & Jones"]);
    expect(view.links).toEqual(
      expect.arrayContaining([
        { url: "https://example.test/a%20b.pdf", label: "Copy" },
        {
          url: "https://www.uscourts.gov/files/Smith,%20John%202024.pdf",
          label: "Original source",
        },
      ]),
    );
  });
});
