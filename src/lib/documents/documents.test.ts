import { describe, expect, it } from "vitest";
import {
  documentPdfUrl,
  documentTitle,
  documentsTrend,
  linkTarget,
  normalizeDocumentSearch,
  parseDocDetail,
  parseDocSummary,
  parseEntityDocs,
  parseSearchResult,
  parseSnippetText,
  safeUrl,
} from "./documents";

const ROW = {
  id: "d_0123456789abcdef01234567",
  collection: "docket_filings",
  source_system: "docketbird",
  native_document_id: "njd-3:2016-md-02738-33091",
  native_case_id: "njd-3:2016-md-02738",
  mdl: "2738",
  listed_by: "registry_pdf_case_id",
  court_id: "njd",
  docket_number: "3:16-md-02738",
  entry_number: 33091,
  attachment: null,
  document_number: null,
  filed_date: "2024-06-26",
  date_basis: "Docket sheet (published row 9)",
  title: "ORDER regarding bellwether schedule",
  title_basis: "Docket description as published",
  doc_type: "order",
  page_count: 3,
  pages_with_text: 3,
  text_status: "text_layer",
  source_url: "https://www.docketbird.com/court-documents/x",
  bytes: 12345,
};

describe("document rows", () => {
  it("parses a summary and refuses rows that break the contract", () => {
    const d = parseDocSummary(ROW)!;
    expect(d).toMatchObject({
      id: ROW.id,
      sourceSystem: "docketbird",
      mdl: "2738",
      docType: "order",
      textStatus: "text_layer",
    });
    expect(parseDocSummary({ ...ROW, id: "x" })).toBeNull();
    expect(parseDocSummary({ ...ROW, source_system: "courtlistener-search" })).toBeNull();
    // RECAP files found through the public locator are a documents/1 source (documents-v2-sources.sql)
    const recapUrl =
      "https://storage.courtlistener.com/recap/gov.uscourts.njd.333000/gov.uscourts.njd.333000.101.0.pdf";
    const recap = parseDocSummary({
      ...ROW,
      source_system: "courtlistener-public-locator",
      native_document_id: recapUrl,
      native_case_id: "6245245",
      source_url: recapUrl,
    })!;
    expect(recap.sourceSystem).toBe("courtlistener-public-locator");
    expect(documentPdfUrl(recap)).toBe(
      `/api/matter-pdf?source=courtlistener-public-locator&doc=${encodeURIComponent(recapUrl)}`,
    );
    expect(parseDocSummary({ ...ROW, text_status: "open" })).toBeNull();
    expect(parseDocSummary({ ...ROW, mdl: "0" })).toBeNull();
    // unknown values become "not recorded", never a guess
    const odd = parseDocSummary({
      ...ROW,
      doc_type: "memo",
      filed_date: "26/06/2024",
      court_id: "N.J.",
      source_url: "javascript:alert(1)",
    })!;
    expect(odd).toMatchObject({ docType: null, filedDate: null, courtId: null, sourceUrl: null });
  });

  it("only lets http(s) links out", () => {
    expect(safeUrl("https://ecf.njd.uscourts.gov/doc1/1")).toBe(
      "https://ecf.njd.uscourts.gov/doc1/1",
    );
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });

  it("splits highlighted passages without leaking the markers", () => {
    expect(parseSnippetText("the [[bellwether]] trial … set the [[bellwether]]\n pool")).toEqual([
      { text: "the ", hit: false },
      { text: "bellwether", hit: true },
      { text: " trial … set the ", hit: false },
      { text: "bellwether", hit: true },
      { text: " pool", hit: false },
    ]);
    expect(parseSnippetText("no match here")).toEqual([{ text: "no match here", hit: false }]);
    expect(parseSnippetText("[[]] empty")).toEqual([{ text: " empty", hit: false }]);
  });

  it("parses a search answer, counting rows it could not read", () => {
    const r = parseSearchResult({
      mode: "text",
      rows: [
        {
          ...ROW,
          rank: 0.5,
          matched_pages: 4,
          snippets: [
            { page: 2, text: "a [[word]] b" },
            { page: 0, text: "x" },
          ],
        },
        { id: "bad" },
      ],
      total: 7,
      has_more: true,
      capped: false,
      facets: {
        court: [["njd", 5]],
        mdl: [["2738", 7]],
        type: [
          ["order", 3],
          ["not_recorded", 4],
        ],
        year: [
          ["2024", 6],
          ["not_recorded", 1],
        ],
      },
      query: "'word'",
      sort: "relevance",
      dropped_unavailable: 1,
      offset: 0,
      limit: 20,
    })!;
    expect(r.rows).toHaveLength(1);
    expect(r.malformed).toBe(1);
    expect(r.rows[0]!.snippets).toEqual([
      {
        page: 2,
        parts: [
          { text: "a ", hit: false },
          { text: "word", hit: true },
          { text: " b", hit: false },
        ],
      },
    ]);
    expect(r.facets.type).toEqual([
      { key: "order", count: 3 },
      { key: "not_recorded", count: 4 },
    ]);
    expect(r).toMatchObject({
      mode: "text",
      total: 7,
      hasMore: true,
      droppedUnavailable: 1,
      sort: "relevance",
    });
  });

  it("parses a document with links and amounts", () => {
    const d = parseDocDetail({
      ...ROW,
      dataset: "sw_matters_v1",
      record_id: "sw-matter:2738",
      extractions: { usc: 2, date: 5 },
      links: [
        {
          to_type: "law_unit",
          to_id: "usc:28:1407",
          relation: "cites",
          evidence: "exact_id",
          mentions: 2,
          first_page: 1,
        },
        { to_type: "elsewhere", to_id: "x", relation: "cites" },
      ],
      amounts: [
        {
          page: 2,
          matched: "$1.5 million",
          value: { amount: 1500000, sentence: "A fund of $1.5 million." },
        },
      ],
    })!;
    expect(d.links).toEqual([
      {
        toType: "law_unit",
        toId: "usc:28:1407",
        relation: "cites",
        evidence: "exact_id",
        mentions: 2,
        firstPage: 1,
        citedAs: null,
      },
    ]);
    expect(d.amounts[0]).toEqual({
      page: 2,
      matched: "$1.5 million",
      amount: 1500000,
      sentence: "A fund of $1.5 million.",
    });
    expect(d.extractions).toEqual({ usc: 2, date: 5 });
  });

  it("links the PDF stream at a page and names untitled filings by what identifies them", () => {
    const d = parseDocSummary(ROW)!;
    expect(documentPdfUrl(d, 3)).toBe(
      "/api/matter-pdf?source=docketbird&doc=njd-3%3A2016-md-02738-33091#page=3",
    );
    expect(documentPdfUrl(d)).not.toContain("#");
    expect(
      documentTitle({ title: null, entryNumber: 12, attachment: 2, documentNumber: null }),
    ).toBe("Docket entry 12, attachment 2 (no description published)");
    expect(
      documentTitle({ title: null, entryNumber: null, attachment: null, documentNumber: null }),
    ).toBe("Untitled filing (no title published)");
  });
});

describe("search URL state", () => {
  it("keeps valid values and drops the rest", () => {
    expect(
      normalizeDocumentSearch({
        q: "  bellwether ",
        court: "njd",
        mdl: 2738,
        type: "order",
        from: "2024-02-30",
        to: "2024-12-31",
        sort: "oldest",
        page: "3",
      }),
    ).toEqual({
      q: "bellwether",
      court: "njd",
      mdl: "2738",
      type: "order",
      to: "2024-12-31",
      sort: "oldest",
      page: 3,
    });
    expect(
      normalizeDocumentSearch({ court: "N J", mdl: "0", type: "memo", sort: "relevance", page: 1 }),
    ).toEqual({});
    expect(normalizeDocumentSearch({ from: "2025-01-01", to: "2024-01-01" })).toEqual({
      from: "2024-01-01",
      to: "2025-01-01",
    });
  });
});

describe("entity panel trend", () => {
  const base = {
    type: "court",
    id: "njd",
    basis: "Documents whose docket is in this court.",
    total: 9,
    with_text: 7,
    undated: 2,
    by_year: [
      [2021, 2],
      [2023, 4],
      [2026, 1],
    ],
    by_type: [["order", 5]],
    recent: [{ ...ROW, mentions: null, first_page: null }],
    refreshed: "2026-10-23T10:00:00+00:00",
  };

  it("draws every year in the span, a missing year as 0, the current year partial, undated in the notes", () => {
    const e = parseEntityDocs(base)!;
    const b = documentsTrend(e, "2026-10-23")!;
    expect(b.series[0]!.points).toEqual([
      { x: "2021", value: 2 },
      { x: "2022", value: 0 },
      { x: "2023", value: 4 },
      { x: "2024", value: 0 },
      { x: "2025", value: 0 },
      { x: "2026", value: 1, partial: true },
    ]);
    expect(b.latest?.period).toBe("2025");
    expect(b.notes.join(" ")).toContain("2 filings have no recorded date");
    expect(b.asOf).toBe("2026-10-23");
    expect(b.gaps).toBe(0);
  });

  it("has no trend without dated filings and refuses unknown entity types", () => {
    expect(documentsTrend(parseEntityDocs({ ...base, by_year: [] })!, "2026-10-23")).toBeNull();
    expect(parseEntityDocs({ ...base, type: "person" })).toBeNull();
  });
});

describe("link targets", () => {
  it("opens the in-app page of each exact link and keeps the citation as written", () => {
    expect(linkTarget({ toType: "law_unit", toId: "usc:42:1395w-26" })).toEqual({
      href: "/law/uscode/42/1395w-26",
      label: "42 U.S.C. § 1395w-26",
    });
    expect(linkTarget({ toType: "law_unit", toId: "cfr:21:314" })).toEqual({
      href: "/law/cfr/21/part/314",
      label: "21 C.F.R. part 314",
    });
    expect(linkTarget({ toType: "mdl", toId: "2738" }).href).toBe("/matters/2738");
    expect(
      linkTarget({ toType: "record", toId: "caselaw/118406", citedAs: "531 U.S. 341" }),
    ).toEqual({
      href: "/cases/118406",
      label: "531 U.S. 341",
    });
    expect(linkTarget({ toType: "record", toId: "documents/x" })).toEqual({
      href: null,
      label: "documents/x",
    });
  });
});
