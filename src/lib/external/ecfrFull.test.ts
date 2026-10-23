import { describe, expect, it } from "vitest";
import {
  asOfUrl,
  blocksToText,
  decodeBody,
  ecfrOnDateUrl,
  graphicUrl,
  listHeading,
  parseCitation,
  parseListRow,
  parsePartRow,
  parseSectionRow,
  parseVersionsRow,
  recordId,
  scriptRuns,
  validAsOfDate,
  versionDates,
} from "./ecfrFull";

const sectionRow = {
  id: "cfr:21:314.70",
  title: "21 CFR 314.70 Supplements and other changes to an approved NDA.",
  source_url: "https://www.govinfo.gov/bulkdata/ECFR/title-21/ECFR-title21.xml",
  text: "(a) First.\n(1) Child.\nName\tValue\nCO₂\t1\n",
  detail: {
    kind: "section",
    title_number: "21",
    identifier: "314.70",
    citation: "21 CFR 314.70",
    heading: "Supplements and other changes to an approved NDA.",
    part: "314",
    subpart: "B",
    as_of: "2026-10-21",
    reserved: false,
    path: [
      ["title", "21", "Title 21—Food and Drugs"],
      ["part", "314", "Part 314—Applications"],
    ],
    layout: [
      ["p", 0],
      ["p", 1],
      [
        "t",
        [
          [
            [1, 1, 1],
            [1, 1, 1],
          ],
          2,
        ],
      ],
      ["g", "/graphics/er01ja20.000.gif"],
    ],
    notes: [
      ["source", "[85 FR 1234, Jan. 2, 2020]"],
      ["bogus", "dropped"],
    ],
    ecfr_url: "https://www.ecfr.gov/current/title-21/section-314.70",
    source: { sha256: "a".repeat(64) },
  },
};

describe("decodeBody", () => {
  it("maps each line to its layout block", () => {
    const { blocks, exact } = decodeBody(sectionRow.text, sectionRow.detail.layout);
    expect(exact).toBe(true);
    expect(blocks.map((b) => b.kind)).toEqual(["p", "p", "table", "graphic"]);
    const t = blocks[2]!;
    expect(t.kind === "table" && t.rows[0]![0]).toEqual({
      text: "Name",
      colspan: 1,
      rowspan: 1,
      header: true,
    });
    expect(t.kind === "table" && t.rows[1]!.map((c) => c.text)).toEqual(["CO₂", "1"]);
    const g = blocks[3]!;
    expect(g.kind === "graphic" && g.url).toBe("https://www.ecfr.gov/graphics/er01ja20.000.gif");
  });
  it("never drops text when the layout does not fit", () => {
    const { blocks, exact } = decodeBody("a\nb\tc", [["p", 0]]);
    expect(exact).toBe(false);
    expect(blocks.map((b) => (b.kind === "p" ? b.text : ""))).toEqual(["a", "b · c"]);
    expect(
      decodeBody("a\nb", [
        ["t", [3]],
        ["p", 0],
      ]).exact,
    ).toBe(false);
    expect(decodeBody("a", [["z", 1]]).exact).toBe(false);
  });
  it("reads a graphic-only body (text is empty) and an empty body", () => {
    expect(decodeBody("", [["g", "/graphics/x.gif"]]).blocks).toHaveLength(1);
    expect(decodeBody("", []).blocks).toEqual([]);
  });
  it("copies as plain text", () => {
    expect(
      blocksToText(
        decodeBody("a\nb\tc", [
          ["p", 0],
          ["t", [2]],
        ]).blocks,
      ),
    ).toBe("a\n\nb\tc");
  });
});

describe("rows", () => {
  it("parses a section row and drops unknown note kinds", () => {
    const s = parseSectionRow(sectionRow)!;
    expect(s.citation).toBe("21 CFR 314.70");
    expect(s.notes).toEqual([
      { kind: "source", label: "Source", text: "[85 FR 1234, Jan. 2, 2020]", scope: null },
    ]);
    expect(s.path.map((p) => p.type)).toEqual(["title", "part"]);
    expect(s.sourceUrl).toBe(sectionRow.source_url);
    expect(s.ecfrUrl).toBe("https://www.ecfr.gov/current/title-21/section-314.70");
  });
  it("rejects malformed rows and foreign links", () => {
    expect(
      parseSectionRow({ ...sectionRow, detail: { ...sectionRow.detail, title_number: "99" } }),
    ).toBeNull();
    expect(
      parseSectionRow({ ...sectionRow, detail: { ...sectionRow.detail, kind: "part" } }),
    ).toBeNull();
    expect(parseSectionRow({ ...sectionRow, text: null })).toBeNull();
    const s = parseSectionRow({
      ...sectionRow,
      source_url: "https://example.com/x.xml",
      detail: { ...sectionRow.detail, ecfr_url: "javascript:alert(1)" },
    })!;
    expect([s.sourceUrl, s.ecfrUrl]).toEqual([null, null]);
  });
  it("parses part and listing rows", () => {
    const p = parsePartRow({
      id: "cfr:21:part-314",
      title: "21 CFR Part 314—Applications",
      text: "",
      detail: {
        kind: "part",
        title_number: "21",
        identifier: "314",
        as_of: "2026-10-21",
        notes: [["authority", "21 U.S.C. 355.", "Part 314"]],
        layout: [],
        sections: 117,
      },
    })!;
    expect([p.part, p.sections, p.notes[0]!.scope]).toEqual(["314", 117, "Part 314"]);
    expect(
      parseListRow({
        id: "cfr:21:314.1",
        title: "21 CFR 314.1 Scope.",
        c: { kind: "section", identifier: "314.1", part: "314", reserved: false, characters: 900 },
      })!.characters,
    ).toBe(900);
    expect(
      parseListRow({ id: "x", title: "t", c: { kind: "chapter", identifier: "I" } }),
    ).toBeNull();
  });
  it("reads the subpart heading from the path and drops a repeated section number", () => {
    const reserved = parseListRow({
      id: "cfr:21:314.120",
      title: "21 CFR 314.120 § 314.120 [Reserved]",
      c: { kind: "section", identifier: "314.120", part: "314", reserved: true },
      s: ["D"],
      p: [
        ["part", "314", "Part 314—Applications for FDA Approval to Market a New Drug"],
        ["subpart", "D", "Subpart D—FDA Action on Applications and Abbreviated Applications"],
      ],
    })!;
    expect(reserved.subpartLabel).toBe(
      "Subpart D—FDA Action on Applications and Abbreviated Applications",
    );
    expect(listHeading(reserved, "21")).toBe("[Reserved]");
    const plain = parseListRow({
      id: "cfr:21:314.1",
      title: "21 CFR 314.1 Scope of this part.",
      c: { kind: "section", identifier: "314.1", part: "314" },
    })!;
    expect([plain.subpartLabel, listHeading(plain, "21")]).toEqual([null, "Scope of this part."]);
    // "§ 314.1" must not strip the start of "§ 314.10 ..." printed under another number.
    expect(listHeading({ ...plain, title: "21 CFR 314.1 § 314.10 x" }, "21")).toBe("§ 314.10 x");
    const appendix = parseListRow({
      id: "cfr:21:Appendix A to Part 314",
      title: "21 CFR Appendix A to Part 314—Tables",
      c: { kind: "appendix", identifier: "Appendix A to Part 314", part: "314" },
    })!;
    expect(listHeading(appendix, "21")).toBe("Appendix A to Part 314—Tables");
  });
  it("parses version history with Federal Register links of the federalregister.gov shape only", () => {
    const h = parseVersionsRow({
      id: "cfr:21:314.70",
      detail: {
        kind: "section",
        part: "314",
        versions: [
          { date: "2016-12-23", substantive: true, removed: false, fr_basis: "none", fr: [] },
          {
            date: "2024-03-13",
            amendment_date: "2024-03-13",
            issue_date: "2024-03-13",
            substantive: true,
            removed: false,
            fr_basis: "source_note",
            fr: [
              {
                document_number: "2024-01234",
                citation: "89 FR 1000",
                publication_date: "2024-02-12",
                url: "https://www.federalregister.gov/d/2024-01234",
              },
              { document_number: "evil", url: "https://evil.example/d/1" },
            ],
          },
          { date: "bad" },
        ],
      },
    })!;
    expect(h.versions).toHaveLength(2);
    expect(h.versions[1]!.fr).toHaveLength(1);
    expect(h.versions[1]!.frBasis).toBe("source_note");
    expect(versionDates(h)).toEqual(["2024-03-13", "2016-12-23"]);
  });
});

describe("citations, dates and URLs", () => {
  it("parses citations", () => {
    expect(parseCitation("21 CFR 314.70")).toEqual({ title: "21", section: "314.70" });
    expect(parseCitation("21 C.F.R. § 314.70")).toEqual({ title: "21", section: "314.70" });
    expect(parseCitation("40 CFR part 60")).toEqual({ title: "40", part: "60" });
    expect(parseCitation("40 CFR 60")).toEqual({ title: "40", part: "60" });
    expect(parseCitation("99 CFR 1.1")).toBeNull();
    expect(parseCitation("hello")).toBeNull();
  });
  it("validates as-of dates", () => {
    expect(validAsOfDate("2020-02-29", "2026-10-22")).toBe(true);
    expect(validAsOfDate("2021-02-29", "2026-10-22")).toBe(false);
    expect(validAsOfDate("2016-12-31", "2026-10-22")).toBe(false);
    expect(validAsOfDate("2027-01-01", "2026-10-22")).toBe(false);
  });
  it("builds eCFR URLs", () => {
    expect(
      asOfUrl({
        date: "2020-01-01",
        title: "21",
        part: "314",
        kind: "section",
        identifier: "314.70",
      }),
    ).toBe(
      "https://www.ecfr.gov/api/versioner/v1/full/2020-01-01/title-21.xml?part=314&section=314.70",
    );
    expect(
      asOfUrl({
        date: "2020-01-01",
        title: "40",
        part: "60",
        kind: "appendix",
        identifier: "Appendix A-1 to Part 60",
      }),
    ).toBe(
      "https://www.ecfr.gov/api/versioner/v1/full/2020-01-01/title-40.xml?part=60&appendix=Appendix+A-1+to+Part+60",
    );
    expect(ecfrOnDateUrl("2020-01-01", "21", "314.70", "section", "314")).toBe(
      "https://www.ecfr.gov/on/2020-01-01/title-21/section-314.70",
    );
    expect(graphicUrl("/graphics/../../etc")).toBeNull();
    expect(recordId("14", "Special Federal Aviation Regulation No. 97", "91")).toBe(
      "cfr:14:Special Federal Aviation Regulation No. 97@part-91",
    );
  });
  it("splits ^(..) and _(..) into script runs", () => {
    expect(scriptRuns("x_(H2O) + 10^(-3.5)")).toEqual([
      { t: "text", s: "x" },
      { t: "sub", s: "H2O" },
      { t: "text", s: " + 10" },
      { t: "sup", s: "-3.5" },
    ]);
  });
});
