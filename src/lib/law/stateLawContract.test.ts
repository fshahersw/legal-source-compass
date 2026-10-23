import { describe, expect, it } from "vitest";
import {
  asStatus,
  currencyLine,
  nodeLabel,
  parseSearch,
  parseSection,
  parseStates,
  parseTree,
  safeHttps,
  shortDate,
  snippetSegments,
} from "./stateLawContract";

const edition = {
  edition_id: "fl-20261024",
  state: "FL",
  code_name: "Florida Statutes",
  publisher: "The Florida Legislature",
  publisher_url: "https://www.leg.state.fl.us/statutes/",
  official_source: true,
  edition_label: "The 2026 Florida Statutes",
  currency_statement: null,
  retrieved_from: "2026-10-24T01:00:00Z",
  retrieved_to: "2026-10-24T02:00:00Z",
  sections: 24993,
  by_status: { in_force: 24990, repealed: 3, bogus: 9 },
  codes: [{ code: "FS", name: "Florida Statutes", citation_template: "Fla. Stat. § {n}" }],
};

describe("state-law contract parsing", () => {
  it("parses editions and keeps unknown values as null", () => {
    const [e] = parseStates([edition, { state: "XX" }, null]);
    expect(e?.editionId).toBe("fl-20261024");
    expect(e?.currencyStatement).toBeNull();
    expect(currencyLine(e!)).toBe("The 2026 Florida Statutes");
    expect(currencyLine({ currencyStatement: null, editionLabel: null })).toBe("Not recorded");
    expect(
      currencyLine({ currencyStatement: null, editionLabel: null, currencyThrough: "2026-10-20" }),
    ).toBe("Publisher states the text is current through Oct 20, 2026");
    expect(
      currencyLine({
        currencyStatement: null,
        editionLabel: null,
        sourceLastModified: "hrscurrent volume folders dated 1/6/2026",
      }),
    ).toBe("No currency statement · source files: hrscurrent volume folders dated 1/6/2026");
    expect(e?.byStatus).toEqual({ in_force: 24990, repealed: 3 });
    expect(e?.codes[0]?.code).toBe("FS");
  });

  it("parses the tree and section shapes", () => {
    const tree = parseTree({
      available: true,
      edition,
      node: {
        node_id: "FL:FS/title:VIII",
        level: "title",
        label: "Title",
        number: "VIII",
        heading: "LIMITATIONS",
      },
      breadcrumb: [
        { node_id: "FL:FS", level: "code", label: "Florida Statutes", heading: "Florida Statutes" },
      ],
      children: [
        {
          node_id: "FL:FS/title:VIII/chapter:95",
          level: "chapter",
          label: "Chapter",
          number: "95",
          sections: 24,
        },
      ],
      sections: [],
      total_sections: 0,
      truncated: false,
    });
    expect(tree.available).toBe(true);
    if (tree.available) {
      expect(tree.children[0]?.sections).toBe(24);
      expect(nodeLabel(tree.node!)).toBe("Title VIII");
      expect(nodeLabel(tree.breadcrumb[0]!)).toBe("Florida Statutes");
    }
    expect(parseTree(null)).toEqual({ available: false, reason: "not_installed" });
    expect(parseTree({ available: false, reason: "no_edition" })).toEqual({
      available: false,
      reason: "no_edition",
    });

    const sec = parseSection({
      available: true,
      edition,
      section: {
        section_id: "FL:FS:95.11",
        citation: "Fla. Stat. § 95.11",
        status: "in_force",
        text: "(1) text",
        source: { url: "javascript:alert(1)", sha256: "a".repeat(64) },
        effective: { start: "2026-07-01" },
      },
      prev: { section_id: "FL:FS:95.10", citation: "Fla. Stat. § 95.10", status: "repealed" },
      other_versions: [],
    });
    expect(sec.available).toBe(true);
    if (sec.available) {
      expect(sec.section.sourceUrl).toBeNull();
      expect(sec.section.effectiveStart).toBe("2026-07-01");
      expect(sec.prev?.status).toBe("repealed");
      expect(sec.next).toBeNull();
    }
  });

  it("parses search hits and exact citation matches", () => {
    const s = parseSearch({
      available: true,
      total: 2,
      hits: [
        {
          section_id: "FL:FS:95.11",
          citation: "Fla. Stat. § 95.11",
          status: "weird",
          snippet: "an ⟦action⟧ shall",
        },
      ],
      exact: {
        result: "resolved",
        section_id: "FL:FS:95.11",
        citation: "Fla. Stat. § 95.11",
        candidates: [],
      },
    });
    expect(s.available).toBe(true);
    if (s.available) {
      expect(s.hits[0]?.status).toBe("not_recorded");
      expect(s.exact?.sectionId).toBe("FL:FS:95.11");
    }
  });

  it("splits snippets without passing markup through", () => {
    expect(snippetSegments("an ⟦action⟧ <b>shall</b> ⟦be⟧")).toEqual([
      { text: "an ", hit: false },
      { text: "action", hit: true },
      { text: " <b>shall</b> ", hit: false },
      { text: "be", hit: true },
    ]);
    expect(snippetSegments(null)).toEqual([]);
  });

  it("guards links, dates and statuses", () => {
    expect(safeHttps("http://example.gov")).toBeNull();
    expect(safeHttps("https://example.gov/a b")).toBe("https://example.gov/a%20b");
    expect(shortDate("2026-10-06")).toBe("Oct 6, 2026");
    expect(shortDate("nope")).toBeNull();
    expect(asStatus("future_effective")).toBe("future_effective");
    expect(asStatus(undefined)).toBe("not_recorded");
  });
});
