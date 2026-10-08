import { describe, expect, it } from "vitest";
import {
  classifyDataset,
  coverageStatus,
  matchesCitationOrHeading,
  parseFullCode,
  parseHierarchyPath,
  projectedCurrency,
  publisherStatement,
  projectedEdition,
  publishedSectionBody,
  sectionFieldsFromRecord,
  summarizeBrowseRoot,
} from "./stateCodeContract";

const indianaListing = {
  columns: [
    { key: "section", label: "Section" },
    { key: "title", label: "Title" },
  ],
  filters: [
    { name: "title", type: "select", options: [{ value: "2", label: "TITLE 2", count: 690 }] },
  ],
  qualification: "The 2026 edition of the Indiana Code.",
  total: 83148,
};

describe("full state code contract", () => {
  it("reads a full_code block and rejects a structure-only capture", () => {
    expect(
      parseFullCode({
        state: "ca",
        code_name: "California Codes",
        edition: "2025",
        grain: "section",
      }),
    ).toMatchObject({
      state: "CA",
      codeName: "California Codes",
      edition: "2025",
      titleFilter: "title",
      chapterField: "chapter",
    });
    const structure = classifyDataset(
      {
        id: "sd_statutes",
        label: "South Dakota Codified Laws",
        ready: true,
        importedRecords: 71,
        fullCode: null,
        listing: {
          columns: [
            { key: "title", label: "Title" },
            { key: "sections", label: "Sections" },
          ],
          qualification:
            "Coverage is title-level only. Full section text is not present in this cache.",
        },
        qualification: null,
      },
      [
        {
          title: "South Dakota Codified Laws",
          state: "SD",
          edition: "as retrieved 2026-08-20",
          currency: null,
        },
      ],
    );
    expect(structure).toBeNull();
  });

  it("recognizes a section dataset by an exact state-code title match", () => {
    const row = classifyDataset(
      {
        id: "indiana_code",
        label: "Indiana Code",
        ready: true,
        importedRecords: 83148,
        fullCode: null,
        listing: JSON.stringify(indianaListing),
        qualification: null,
      },
      [{ title: "Indiana Code", state: "IN", edition: "2026 edition", currency: null }],
    );
    expect(row).toMatchObject({
      state: "IN",
      datasetId: "indiana_code",
      sectionCount: 83148,
      edition: "2026 edition",
      currency: null,
    });
  });

  it("summarizes a Texas browse root and a generic one", () => {
    const texas = summarizeBrowseRoot(
      {
        schema_version: "texas-code-browse-release/1",
        jurisdiction: "TX",
        publisher_coverage_claim: "Publisher states statutes through 2025.",
        codes: [{ code: "CP", section_count: 4, chapter_count: 1 }],
      },
      "TX",
    );
    expect(texas).toMatchObject({
      schema: "texas-code-browse-release/1",
      sectionCount: 4,
      edition: "Publisher states statutes through 2025.",
      currency: null,
    });
    expect(
      summarizeBrowseRoot(
        { schema_version: "texas-code-browse-release/1", jurisdiction: "CA", codes: [] },
        "CA",
      ),
    ).toBeNull();
    const generic = summarizeBrowseRoot(
      {
        schema_version: "state-code-browse-release/1",
        jurisdiction: "CA",
        edition: "2026 edition",
        currency: "current through chapter 12",
        text_root: "state-codes/ca/text/",
        codes: [{ code: "CIV", section_count: 10, chapter_count: 2 }],
      },
      "CA",
    );
    expect(generic).toMatchObject({
      sectionCount: 10,
      edition: "2026 edition",
      currency: "current through chapter 12",
      textRoot: "state-codes/ca/text/",
    });
  });

  it("reads citation, heading, text, history, edition, currency and source from a section row", () => {
    const fields = sectionFieldsFromRecord({
      title: "IC 2-3.5-3-5 Rollover of eligible distributions",
      source_url: "https://iga.in.gov/laws/2026/ic/titles/2",
      detail: {
        facts: [
          ["Citation", "IC 2-3.5-3-5"],
          ["Edition", "2026 Indiana Code"],
          ["Currency", "Not verified against the current code"],
          ["History note (as printed)", "As added by P.L.10-1993, SEC.1."],
          ["Status as printed", "Section text"],
        ],
        sections: [
          {
            heading: "Section text (2026 edition)",
            text: "Sec. 5. Notwithstanding any other provision.",
          },
        ],
      },
    });
    expect(fields).toEqual({
      citation: "IC 2-3.5-3-5",
      heading: "Rollover of eligible distributions",
      text: "Sec. 5. Notwithstanding any other provision.",
      history: "As added by P.L.10-1993, SEC.1.",
      edition: "2026 Indiana Code",
      currency: "Not verified against the current code",
      sourceUrl: "https://iga.in.gov/laws/2026/ic/titles/2",
      status: "Section text",
    });
  });

  it("reads a publisher-code-intake/2 section payload", () => {
    const fields = sectionFieldsFromRecord({
      title: "Fla. Stat. § 95.11",
      source_url: "https://www.flsenate.gov/Laws/Statutes/2025/95.11",
      detail: {
        citation: "Fla. Stat. § 95.11",
        citation_path: "95.11",
        heading: "Limitations other than for the recovery of real property",
        text: "Actions other than for recovery of real property shall be commenced as follows:",
        history: null,
        status_note: null,
        currency: {
          statement: "2025 Florida Statutes",
          through_date: null,
          edition: "2025",
          basis: "publisher_statement",
        },
      },
    });
    expect(fields.citation).toBe("Fla. Stat. § 95.11");
    expect(fields.heading).toBe("Limitations other than for the recovery of real property");
    expect(fields.text).toMatch(/Actions other than/);
    expect(fields.history).toBeNull();
    expect(fields.edition).toBe("2025");
    expect(fields.currency).toBe("2025 Florida Statutes");
    expect(fields.status).toBeNull();
  });

  it("shows a stored HTML revised stamp as the publisher's own stamp, never as markup", () => {
    const fields = sectionFieldsFromRecord({
      title: "42 Pa.C.S. § 5524",
      source_url: "https://www.palegis.us/statutes/consolidated/view-statute?50&ttl=42",
      detail: {
        citation: "42 Pa.C.S. § 5524",
        heading: "Two year limitation.",
        text: "§ 5524. Two year limitation.",
        history: null,
        status_note: null,
        currency: {
          basis: "publisher_metadata",
          edition: null,
          statement: '<meta name="revised" content="2026-09-16 10:42:58 AM">',
          through_date: null,
        },
      },
    });
    expect(fields.currency).toBe("Publisher page revised stamp: 2026-09-16 10:42:58 AM");
    expect(publisherStatement("Current through the 2025 Regular Session")).toBe(
      "Current through the 2025 Regular Session",
    );
    expect(publisherStatement('<meta name="revised" content="">')).toBe(
      '<meta name="revised" content="">',
    );
    expect(publisherStatement(null)).toBeNull();
  });

  it("keeps a repealed publisher status line as the text", () => {
    const fields = sectionFieldsFromRecord({
      title: "§12-1704.01",
      source_url: "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os12.rtf",
      detail: {
        citation: "§12-1704.01",
        heading: "Repealed by Laws 1980, c. 9, § 3.",
        text: "Repealed by Laws 1980, c. 9, § 3.",
        history: null,
        status_note: "Repealed",
        currency: { edition: null, statement: null, through_date: null },
      },
    });
    expect(fields.status).toBe("Repealed");
    expect(publishedSectionBody(fields)).toBe("Repealed by Laws 1980, c. 9, § 3.");
    expect(fields.sourceUrl).toBe(
      "https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os12.rtf",
    );
    expect(
      publishedSectionBody({
        status: "Repealed",
        heading: "Repealed by Laws 1965, c. 396, § 1309, eff. July 1, 1965.",
        text: "c",
      }),
    ).toBe("Repealed by Laws 1965, c. 396, § 1309, eff. July 1, 1965.");
    expect(
      publishedSectionBody({
        status: "Transferred",
        heading: "Transferred employees - Partial payment of moving expenses.",
        text: "It is the purpose of this act to provide partial payment by the State.",
      }),
    ).toMatch(/purpose of this act/);
  });

  it("reads the intake currency summary and the coverage gate", () => {
    const currency = {
      editions: ["2025", "2026"],
      through_min: "2025-01-01",
      through_max: "2026-10-01",
      bases: ["publisher_statement"],
    };
    expect(projectedEdition(currency)).toBe("2025; 2026");
    expect(projectedCurrency(currency)).toBe("2025-01-01 to 2026-10-01");
    expect(projectedCurrency({ through_max: "2026-10-01", through_min: "2026-10-01" })).toBe(
      "2026-10-01",
    );
    expect(projectedEdition({ editions: [] })).toBeNull();
    expect(coverageStatus(undefined)).toBe("not yet captured");
    expect(coverageStatus({ public_projection_allowed: false })).toBe("landed-private");
    expect(coverageStatus({ public_projection_allowed: true })).toBe("captured");
    expect(parseHierarchyPath([{ level: "title", number: 1 }])).toEqual([
      { level: "title", number: "1" },
    ]);
    expect(parseHierarchyPath('[{"level":"title","number":null}]')).toEqual([
      { level: "title", number: null },
    ]);
    expect(parseHierarchyPath("not-json")).toEqual([]);
  });

  it("matches a citation or a heading and ignores a one-character query", () => {
    expect(matchesCitationOrHeading("140.001", "CP:140.001", "Sec. 140.001. DEFINITIONS.")).toBe(
      true,
    );
    expect(
      matchesCitationOrHeading(
        "financial exploitation",
        null,
        "CHAPTER 100B. LIABILITY FOR FINANCIAL EXPLOITATION",
      ),
    ).toBe(true);
    expect(matchesCitationOrHeading("z", "CP:140.001", "Definitions")).toBe(false);
    expect(matchesCitationOrHeading("nope", "CP:140.001", "Definitions")).toBe(false);
  });
});

describe("sectionHierarchy", () => {
  it("keeps the stored steps in order, drops the section row and stops at a malformed entry", async () => {
    const { sectionHierarchy } = await import("./stateCodeContract");
    expect(
      sectionHierarchy([
        { level: "title", number: "42", heading: "JUDICIARY AND JUDICIAL PROCEDURE" },
        { level: "chapter", number: 55, heading: "" },
        { level: "section", number: "5524", heading: "Two year limitation." },
      ]),
    ).toEqual([
      { level: "title", number: "42", heading: "JUDICIARY AND JUDICIAL PROCEDURE" },
      { level: "chapter", number: "55", heading: null },
    ]);
    expect(sectionHierarchy([{ level: "title", number: "1" }, "bad", { level: "part", number: "I" }])).toEqual([
      { level: "title", number: "1", heading: null },
    ]);
    expect(sectionHierarchy(null)).toEqual([]);
  });
});
