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

describe("judge financial-disclosure summaries", () => {
  const qualification =
    "Financial disclosures filed by this judge in a CourtListener bulk snapshot; reports what was filed for each stated year, not current holdings.";
  const summary = (over: Record<string, unknown> = {}) => ({
    link: "#judge-disclosures?entity_id=judge-entity-1",
    state: "filing_with_reportable_holdings",
    available: true,
    entity_id: "judge-entity-1",
    latest_year: 2020,
    years_filed: [2002, 2003, 2004, 2010, 2011, 2012, 2020],
    qualification,
    total_holdings: 39,
    holdings_count_by_year: {
      "2002": 0,
      "2003": 0,
      "2004": 0,
      "2010": 13,
      "2011": 21,
      "2012": 2,
      "2020": 3,
    },
    total_holdings_inferred: 1,
    top_holdings_latest_year: [
      { inferred: false, redacted: false, description: "Credit Union Savings Account X" },
      { inferred: true, redacted: false, description: "Total Return Bond Fund" },
      { inferred: false, redacted: true, description: "12% interest in rental property #1" },
    ],
    top_holdings_latest_year_note: null,
    top_holdings_latest_year_limit: 25,
    ...over,
  });

  it("titles each listed holding by its recorded description, never 'Record'", () => {
    const raw = { id: "j1", name: "Judge One", disclosures: summary() };
    const original = JSON.stringify(raw);
    const view = buildEntityView(raw);
    const holdings = view.sections.find((s) => s.key === "disclosures_latest_holdings");
    expect(holdings).toEqual({
      kind: "collection",
      key: "disclosures_latest_holdings",
      label: "Holdings listed in the 2020 disclosure",
      link: null,
      total: 3,
      sample: [
        { title: "Credit Union Savings Account X", subtitle: null, link: null },
        {
          title: "Total Return Bond Fund",
          subtitle: "Values inferred during CourtListener extraction",
          link: null,
        },
        {
          title: "12% interest in rental property #1",
          subtitle: "Row contains redactions",
          link: null,
        },
      ],
    });
    expect(JSON.stringify(view.sections)).not.toContain('"Record');
    expect(JSON.stringify(raw)).toBe(original);
  });

  it("summarises filing years and per-year counts from the record, with years unformatted", () => {
    const facts = buildEntityView({ id: "j1", disclosures: summary() }).sections.find(
      (s) => s.key === "disclosures",
    );
    expect(facts).toEqual({
      kind: "facts",
      key: "disclosures",
      label: "Financial disclosures",
      facts: [
        ["Filing status", "Filed; reportable holdings listed"],
        ["Years filed", "2002–2004, 2010–2012, 2020"],
        ["Latest year filed", "2020"],
        ["Holding entries, all filed years", "39"],
        ["Years with holdings listed", "2010 (13), 2011 (21), 2012 (2), 2020 (3)"],
        ["Entries with inferred values", "1"],
        ["Source scope", qualification],
      ],
    });
  });

  it("labels a capped latest-year list 'N of M shown' with no separate bare total", () => {
    const capped = (description: (i: number) => string, count = 128) =>
      buildEntityView({
        id: "j2",
        disclosures: summary({
          holdings_count_by_year: { "2020": count },
          years_filed: [2020],
          total_holdings: count,
          top_holdings_latest_year: Array.from({ length: 25 }, (_, i) => ({
            inferred: false,
            redacted: false,
            description: description(i),
          })),
        }),
      }).sections.find((s) => s.key === "disclosures_latest_holdings");
    // Stored A–Z, ignoring case: the order is stated.
    const az = capped((i) => `${i % 2 ? "holding" : "Holding"} ${String(i + 1).padStart(2, "0")}`);
    expect(az).toMatchObject({
      label: "Holdings listed in the 2020 disclosure — 25 of 128 shown, A–Z by description",
      total: null,
    });
    expect(az && az.kind === "collection" ? az.sample.length : 0).toBe(25);
    // "Holding 2" sorts after "Holding 10": this stored order is not A–Z, so no order is claimed.
    expect(capped((i) => `Holding ${i + 1}`, 1_200)).toMatchObject({
      label: "Holdings listed in the 2020 disclosure — 25 of 1,200 shown",
      total: null,
    });
    // A full list keeps its count as the section total.
    expect(
      buildEntityView({ id: "j2b", disclosures: summary() }).sections.find(
        (s) => s.key === "disclosures_latest_holdings",
      ),
    ).toMatchObject({ label: "Holdings listed in the 2020 disclosure", total: 3 });
  });

  it("keeps internal bridge wording for unlinked judges out of the public facts", () => {
    const internal =
      "This entity_id has no linked CourtListener person id bridge in judge_structured_20260919, so no disclosure filing was looked up.";
    const view = buildEntityView({
      id: "j5",
      disclosures: summary({
        state: "not_bridged_to_courtlistener_person_id",
        available: false,
        latest_year: null,
        years_filed: [],
        total_holdings: 0,
        holdings_count_by_year: {},
        total_holdings_inferred: 0,
        top_holdings_latest_year: [],
        qualification: internal,
      }),
    });
    expect(view.sections).toEqual([
      {
        kind: "facts",
        key: "disclosures",
        label: "Financial disclosures",
        facts: [
          [
            "Filing status",
            "Not linked to a CourtListener person record, so no filing could be looked up",
          ],
        ],
      },
    ]);
    expect(JSON.stringify(view.facts)).not.toContain("judge_structured");
    expect(view.technical).toContainEqual(["Disclosure source scope", internal]);
  });

  it("keeps a coverage gap distinct from 'no holdings' and invents no counts", () => {
    const gap =
      "No filing found in the CourtListener financial disclosures snapshot for this judge. This is a coverage gap in the snapshot.";
    const view = buildEntityView({
      id: "j3",
      disclosures: summary({
        state: "no_filing_in_snapshot",
        latest_year: null,
        years_filed: [],
        total_holdings: 0,
        holdings_count_by_year: {},
        total_holdings_inferred: 0,
        top_holdings_latest_year: [],
        qualification: gap,
      }),
    });
    expect(view.sections).toEqual([
      {
        kind: "facts",
        key: "disclosures",
        label: "Financial disclosures",
        facts: [
          ["Filing status", "No filing found in the disclosure snapshot"],
          ["Source scope", gap],
        ],
      },
    ]);
    const unknown = buildEntityView({
      id: "j4",
      disclosures: summary({
        state: "some_new_state",
        years_filed: [],
        top_holdings_latest_year: [],
      }),
    }).sections[0];
    expect(unknown).toMatchObject({
      facts: [["Filing status", "some_new_state"], expect.anything()],
    });
  });

  it("collapses consecutive years without adding any", async () => {
    const { yearRanges } = await import("./entityView");
    expect(yearRanges([2020, 2018, 2019, 2015, "2016", 2015, null, "x"])).toBe(
      "2015–2016, 2018–2020",
    );
    expect(yearRanges([])).toBe("");
  });
});

describe("untitled nested records", () => {
  it("uses a recorded description, then names the record kind instead of 'Record'", () => {
    const view = buildEntityView({
      id: "x",
      firms: { total: 2, sample: [{ description: "Smith & Jones LLP" }, { role: "Lead" }] },
      related_matters: { total: 1, sample: [{ role: "Member" }] },
    });
    expect(view.sections.find((s) => s.key === "firms")).toMatchObject({
      sample: [{ title: "Smith & Jones LLP" }, { title: "Firm — title not recorded" }],
    });
    expect(view.sections.find((s) => s.key === "related_matters")).toMatchObject({
      sample: [{ title: "Related Matters entry — title not recorded" }],
    });
    const items = buildEntityView({
      id: "y",
      sections: [{ title: "Hearings", items: [{ subtitle: "Room 4" }] }],
    }).sections[0];
    expect(items).toMatchObject({ items: [{ title: "Hearings entry — title not recorded" }] });
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
