import { describe, expect, it } from "vitest";
import { describeDocument, parseRegistryDocument, type MatterDocument } from "./documents";
import { groupEntriesByMonth } from "./entries";
import {
  archiveCounts,
  buildArchiveIndex,
  EMPTY_TIMELINE_FILTER,
  entryProviderLabel,
  ftsPrefixQuery,
  isFiltered,
  isRealDate,
  matchEntryDocuments,
  normalizeRange,
  parseRegistryEntry,
  recapLabel,
} from "./timeline";

/** Trimmed from the live sw_docket_entries_v1 rows of MDL 3140 (public docket text and court identifiers only). */
const entryRow = (over: Record<string, unknown> = {}, reg: Record<string, unknown> = {}) => ({
  id: "sw-entry:courtlistener:479408182",
  cells: {
    mdl: "3140",
    court_id: "flnd",
    provider: "courtlistener",
    documents: 1,
    date_filed: "2026-09-24",
    docket_key: "flnd:3:2025-md-03140",
    time_filed: null,
    description:
      "ORDER - The CMCs scheduled for October 16, 2026, and November 20, 2026, are CANCELED. Signed by JUDGE M CASEY RODGERS on 9/24/2026. (djb) (Entered: 09/24/2026)",
    availability: "recap_unavailable",
    entry_number: 770,
    docket_number: "3:25-md-03140",
    native_entry_id: "479408182",
    documents_sealed: 0,
    native_docket_id: "69674950",
    description_chars: 395,
    documents_available: 0,
    description_withheld: null,
    description_truncated: false,
    ...over,
  },
  links: [
    {
      url: "https://www.courtlistener.com/docket/69674950/770/in-re-depo-provera/",
      label: "CourtListener entry",
    },
    { url: "#record/sw_matters_v1/sw-matter%3A3140", label: "Matter" },
  ],
  reg: {
    mdl: "3140",
    docket_key: "flnd:3:2025-md-03140",
    description_withheld: null,
    documents: [
      {
        is_sealed: null,
        page_count: 2,
        description: "Order",
        is_available: false,
        document_number: "770",
        attachment_number: null,
        native_document_id: "495058040",
        description_withheld: null,
      },
    ],
    ...reg,
  },
});

describe("registry entry rows", () => {
  it("reads the docket text exactly as published, with the entry's numbers, dates and documents", () => {
    const e = parseRegistryEntry(entryRow())!;
    expect(e).toMatchObject({
      id: "sw-entry:courtlistener:479408182",
      nativeEntryId: "479408182",
      docketKey: "flnd:3:2025-md-03140",
      docketNumber: "3:25-md-03140",
      entryNumber: 770,
      date: "2026-09-24",
      descriptionChars: 395,
      descriptionTruncated: false,
      withheld: null,
      documentCount: 1,
      recapAvailableCount: 0,
      sealedCount: 0,
      availability: "recap_unavailable",
      sourceUrl: "https://www.courtlistener.com/docket/69674950/770/in-re-depo-provera/",
    });
    expect(e.description).toContain("(Entered: 09/24/2026)");
    expect(e.documents).toEqual([
      {
        nativeDocumentId: "495058040",
        documentNumber: "770",
        attachmentNumber: null,
        description: "Order",
        pageCount: 2,
        recapAvailable: false,
      },
    ]);
  });

  it("keeps an unnumbered entry unnumbered and an undated entry undated", () => {
    const e = parseRegistryEntry(entryRow({ entry_number: null, date_filed: null }))!;
    expect(e.entryNumber).toBeNull();
    expect(e.date).toBeNull();
    expect(parseRegistryEntry(entryRow({ date_filed: "2026-13-40" }))!.date).toBeNull();
    expect(parseRegistryEntry(entryRow({ date_filed: "yesterday" }))!.date).toBeNull();
  });

  it("shows no text for an entry the projection withheld, whatever the cell holds", () => {
    const e = parseRegistryEntry(
      entryRow({
        description: "MOTION to seal",
        description_withheld: "sealed_or_restricted_text",
      }),
    )!;
    expect(e.withheld).toBe("sealed_or_restricted_text");
    expect(e.description).toBeNull();
    expect(e.documents).toEqual([]);
    expect(e.documentIds).toEqual([]);
  });

  it("lists no document at all for an entry with a sealed document", () => {
    const e = parseRegistryEntry(
      entryRow(
        { description: null, description_withheld: "sealed_document", documents_sealed: 1 },
        { description_withheld: "sealed_document" },
      ),
    )!;
    expect(e.withheld).toBe("sealed_document");
    expect(e.documents).toEqual([]);
    expect(e.sealedCount).toBe(1);
  });

  it("drops a document the source flags sealed and hides a document description that was withheld", () => {
    const e = parseRegistryEntry(
      entryRow(
        {},
        {
          documents: [
            { native_document_id: "1", is_sealed: true, description: "x" },
            {
              native_document_id: "2",
              is_sealed: false,
              description: "Exhibit A",
              description_withheld: null,
            },
            {
              native_document_id: "3",
              description: "Sealed exhibit",
              description_withheld: "sealed_or_restricted_text",
            },
            { native_document_id: "../x", description: "bad id" },
          ],
        },
      ),
    )!;
    expect(e.documents.map((d) => d.nativeDocumentId)).toEqual(["2", "3"]);
    expect(e.documents[1]!.description).toBeNull();
  });

  it("takes only an https link as the source and rejects a row with a foreign id", () => {
    const e = parseRegistryEntry({
      ...entryRow(),
      links: [{ url: "#record/x" }, { url: "http://a.test/" }],
    })!;
    expect(e.sourceUrl).toBeNull();
    expect(parseRegistryEntry({ ...entryRow(), id: "other:1" })).toBeNull();
    expect(parseRegistryEntry({ ...entryRow(), cells: null })).toBeNull();
  });

  it("flags text the projection clipped", () => {
    const e = parseRegistryEntry(
      entryRow({
        description: "A long text…",
        description_truncated: true,
        description_chars: 1204,
      }),
    )!;
    expect(e.descriptionTruncated).toBe(true);
    expect(e.descriptionChars).toBe(1204);
  });
});

describe("timeline filters", () => {
  it("turns plain words into a prefix search and never lets an operator through", () => {
    expect(ftsPrefixQuery("motion dismiss")).toBe("motion:*&dismiss:*");
    expect(ftsPrefixQuery("  Daubert,  order! ")).toBe("daubert:*&order:*");
    expect(ftsPrefixQuery("a:*|b&c!d <-> e")).toBe("a:*&b:*&c:*&d:*&e:*");
    expect(ftsPrefixQuery("   ")).toBeNull();
    expect(ftsPrefixQuery("!!! ---")).toBeNull();
    expect(ftsPrefixQuery("1 2 3 4 5 6 7 8 9 10")?.split("&")).toHaveLength(8);
    expect(ftsPrefixQuery("x".repeat(100))).toBe(`${"x".repeat(40)}:*`);
  });

  it("accepts real calendar dates only and puts a backwards range in order", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2026-2-3")).toBe(false);
    expect(normalizeRange("2026-09-30", "2026-09-01")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(normalizeRange("2026-09-01", null)).toEqual({ from: "2026-09-01", to: null });
    expect(normalizeRange("nope", "2026-13-01")).toEqual({ from: null, to: null });
  });

  it("knows when a filter narrows the list", () => {
    expect(isFiltered(EMPTY_TIMELINE_FILTER)).toBe(false);
    expect(isFiltered({ ...EMPTY_TIMELINE_FILTER, q: " x " })).toBe(true);
    expect(isFiltered({ ...EMPTY_TIMELINE_FILTER, q: "   " })).toBe(false);
    expect(isFiltered({ ...EMPTY_TIMELINE_FILTER, documents: "listed" })).toBe(true);
    expect(isFiltered({ ...EMPTY_TIMELINE_FILTER, documents: "free" })).toBe(true);
    expect(isFiltered({ ...EMPTY_TIMELINE_FILTER, from: "2026-01-01" })).toBe(true);
  });

  it("groups a page of entries by month, newest first, undated last", () => {
    const entries = ["2026-09-24", "2026-09-15", null, "2026-08-31"].map((date, i) => ({
      id: `e${i}`,
      date,
    }));
    expect(groupEntriesByMonth(entries).map((g) => [g.label, g.entries.length])).toEqual([
      ["September 2026", 2],
      ["August 2026", 1],
      ["Date not recorded", 1],
    ]);
  });
});

const sha = "b".repeat(64);
function doc(over: Record<string, unknown>): MatterDocument {
  return describeDocument(
    parseRegistryDocument({
      source_system: "docketbird",
      native_document_id: "flnd-3:2025-md-03140-00770",
      native_case_id: "flnd-3:2025-md-03140",
      availability: "open",
      sha256: sha,
      bytes: 111_000,
      public_url: null,
      verified_at: "2026-10-02T14:17:45.205+00:00",
      ...over,
    })!,
  );
}

describe("entry to archive mapping", () => {
  const archive = [
    doc({}),
    doc({ native_document_id: "flnd-3:2025-md-03140-00771", availability: "held" }),
    doc({ native_document_id: "flnd-3:2025-md-03140-00772" }),
    doc({ native_document_id: "flnd-3:2025-md-03140-00772-001" }),
    doc({
      source_system: "courtlistener",
      native_document_id: "495058040",
      native_case_id: "69674950",
    }),
    doc({
      source_system: "courtlistener",
      native_document_id: "111",
      native_case_id: "69674950",
      availability: "held",
    }),
    // Another docket that happens to have an entry 770 must not be tied to this one.
    doc({
      native_document_id: "cand-4:2022-md-03047-00770",
      native_case_id: "cand-4:2022-md-03047",
    }),
    // Court-hosted files are keyed by their URL.
    doc({
      source_system: "official-court",
      native_document_id:
        "https://www.flnd.uscourts.gov/sites/flnd/files/mdl/2025.02.11%20-%20PTO%202.pdf",
      native_case_id: "3:25md3140",
    }),
  ];
  const index = buildArchiveIndex(archive, true);
  const entry = (over: Record<string, unknown> = {}) => ({
    provider: "courtlistener",
    entryNumber: 770,
    withheld: null,
    documentIds: ["495058040"],
    ...over,
  });

  it("ties an entry to the DocketBird document of the same docket and entry number, and to its listed RECAP ids", () => {
    const m = matchEntryDocuments(entry(), "flnd-3:2025-md-03140", index);
    expect(m.documents.map((d) => [d.doc.sourceSystem, d.doc.nativeDocumentId, d.via])).toEqual([
      ["courtlistener", "495058040", "document_id"],
      ["docketbird", "flnd-3:2025-md-03140-00770", "entry_number"],
    ]);
    expect(m.notArchived).toBe(0);
    expect(archiveCounts(m.documents)).toEqual({ open: 2, held: 0 });
  });

  it("keeps attachments with their entry, main document first, and reports held ones as held", () => {
    const m = matchEntryDocuments(
      entry({ entryNumber: 772, documentIds: [] }),
      "flnd-3:2025-md-03140",
      index,
    );
    expect(m.documents.map((d) => d.doc.attachment)).toEqual([null, 1]);
    const held = matchEntryDocuments(
      entry({ entryNumber: 771, documentIds: [] }),
      "flnd-3:2025-md-03140",
      index,
    );
    expect(held.documents).toHaveLength(1);
    expect(archiveCounts(held.documents)).toEqual({ open: 0, held: 1 });
    // A held document never carries a hash, a size or a link.
    expect(held.documents[0]!.doc).toMatchObject({
      availability: "held",
      sha256: null,
      bytes: null,
    });
  });

  it("does not match by entry number across dockets, or without the docket's DocketBird id", () => {
    const m = matchEntryDocuments(entry({ documentIds: [] }), "cand-4:2022-md-03047", index);
    expect(m.documents.map((d) => d.doc.nativeDocumentId)).toEqual(["cand-4:2022-md-03047-00770"]);
    expect(matchEntryDocuments(entry({ documentIds: [] }), null, index).documents).toEqual([]);
    expect(
      matchEntryDocuments(
        entry({ entryNumber: null, documentIds: [] }),
        "flnd-3:2025-md-03140",
        index,
      ).documents,
    ).toEqual([]);
  });

  it("counts listed documents the archive does not hold and never matches a different id", () => {
    const m = matchEntryDocuments(entry({ documentIds: ["495058040", "999", "111"] }), null, index);
    expect(m.documents.map((d) => d.doc.nativeDocumentId)).toEqual(["495058040", "111"]);
    expect(m.notArchived).toBe(1);
    expect(archiveCounts(m.documents)).toEqual({ open: 1, held: 1 });
  });

  it("maps an entry the publication rule held back to nothing, whichever rule held it", () => {
    for (const withheld of ["sealed_document", "sealed_or_restricted_text"]) {
      const m = matchEntryDocuments(entry({ withheld }), "flnd-3:2025-md-03140", index);
      expect(m).toEqual({ documents: [], notArchived: 0 });
    }
  });

  it("joins an external entry to the court-hosted PDF by its exact URL", () => {
    const url = "https://www.flnd.uscourts.gov/sites/flnd/files/mdl/2025.02.11%20-%20PTO%202.pdf";
    const m = matchEntryDocuments(
      entry({ provider: "official-court", entryNumber: null, documentIds: [url] }),
      "flnd-3:2025-md-03140",
      index,
    );
    expect(m.documents.map((d) => [d.doc.sourceSystem, d.via])).toEqual([
      ["official-court", "document_id"],
    ]);
    // A GovInfo URL the archive does not hold is simply not archived; a URL is never matched by file name.
    const other = matchEntryDocuments(
      entry({
        provider: "govinfo",
        entryNumber: null,
        documentIds: [
          "https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-12.pdf",
        ],
      }),
      null,
      index,
    );
    expect(other).toEqual({ documents: [], notArchived: 1 });
  });

  it("describes the projection's RECAP summary without implying the archive", () => {
    expect(recapLabel("recap_available")).toBe("Free PDF in RECAP");
    expect(recapLabel("recap_unavailable")).toBe("Not in RECAP");
    expect(recapLabel("official_pdf")).toBe("Official PDF");
    expect(recapLabel(null)).toBeNull();
    expect(recapLabel("something_new")).toBe("something new");
    expect(entryProviderLabel("official-court")).toBe("Court website");
    expect(entryProviderLabel("govinfo")).toBe("GovInfo");
    expect(entryProviderLabel(null)).toBeNull();
  });
});

describe("external entries (GovInfo, court website)", () => {
  const external = (
    over: Record<string, unknown> = {},
    id = "sw-entry:govinfo:USCOURTS-njd-3_16-md-02738-12",
  ) => ({
    id,
    cells: {
      mdl: "2738",
      held: false,
      court_id: "njd",
      provider: "govinfo",
      documents: 1,
      date_filed: "2026-07-22",
      docket_key: "njd:3:2016-md-02738",
      source_url:
        "https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-12.pdf",
      description: "MEMORANDUM OPINION ON MOTION FOR THE ENTRY OF AN ORDER TO SHOW CAUSE. (sks)",
      availability: "official_pdf",
      document_ids: [
        "https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-12.pdf",
      ],
      entry_number: null,
      native_entry_id: "USCOURTS-njd-3_16-md-02738-12",
      description_withheld: null,
      ...over,
    },
    links: [
      {
        url: "https://www.govinfo.gov/app/details/USCOURTS-njd-3_16-md-02738/USCOURTS-njd-3_16-md-02738-12",
      },
    ],
    reg: {
      documents: [
        {
          native_document_id: "USCOURTS-njd-3_16-md-02738-12",
          is_available: true,
          description_withheld: null,
        },
      ],
    },
  });

  it("reads an unnumbered GovInfo entry with the PDF URL as its document id", () => {
    const e = parseRegistryEntry(external())!;
    expect(e).toMatchObject({
      provider: "govinfo",
      entryNumber: null,
      date: "2026-07-22",
      availability: "official_pdf",
      withheld: null,
    });
    expect(e.documentIds).toEqual([
      "https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-12.pdf",
    ]);
    expect(e.description).toContain("MEMORANDUM OPINION");
  });

  it("accepts a provider id with a hyphen and uses the court page when the cells carry no link", () => {
    const e = parseRegistryEntry({
      ...external({}, "sw-entry:official-court:0123456789abcdef"),
      links: [],
    })!;
    expect(e.id).toBe("sw-entry:official-court:0123456789abcdef");
    expect(e.sourceUrl).toBe(
      "https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_16-md-02738/pdf/USCOURTS-njd-3_16-md-02738-12.pdf",
    );
  });

  it("treats the held flag as withheld even when no reason is given, and lists no document", () => {
    const e = parseRegistryEntry(
      external({ held: true, description: "text", document_ids: ["x1"] }),
    )!;
    expect(e.withheld).toBe("sealed_or_restricted_text");
    expect(e.description).toBeNull();
    expect(e.documentIds).toEqual([]);
    expect(e.documents).toEqual([]);
  });

  it("falls back to the per-document ids when the row has no document_ids and drops an unusable id", () => {
    const e = parseRegistryEntry({
      ...external({ document_ids: undefined }),
      reg: { documents: [{ native_document_id: "495058040" }, { native_document_id: "../x" }] },
    })!;
    expect(e.documentIds).toEqual(["495058040"]);
    const bad = parseRegistryEntry(
      external({ document_ids: ["javascript:alert(1)", "http://insecure.test/a.pdf", "ok-1"] }),
    )!;
    expect(bad.documentIds).toEqual(["ok-1"]);
  });
});
