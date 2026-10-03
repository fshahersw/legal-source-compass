import { describe, expect, it } from "vitest";
import {
  countDocuments,
  describeDocument,
  filterDocuments,
  formatBytes,
  matterPdfUrl,
  pageDocuments,
  parsePdfRequest,
  parseRegistryDocument,
  parseRegistrySummary,
  sortDocuments,
  type MatterDocument,
} from "./documents";

const sha = "a".repeat(64);
const row = (over: Record<string, unknown> = {}) => ({
  source_system: "docketbird",
  native_document_id: "flnd-3:2025-md-03140-00771",
  native_case_id: "flnd-3:2025-md-03140",
  availability: "open",
  sha256: sha,
  bytes: 1234,
  public_url: null,
  verified_at: "2026-10-02T14:23:48.609+00:00",
  ...over,
});

describe("registry rows", () => {
  it("parses an open DocketBird row and keeps byte identity server-side facts", () => {
    const d = parseRegistryDocument(row())!;
    expect(d).toMatchObject({
      sourceSystem: "docketbird",
      availability: "open",
      sha256: sha,
      bytes: 1234,
    });
    expect(describeDocument(d)).toMatchObject({
      entryNumber: 771,
      attachment: null,
      label: "Docket entry 771",
      sourceLabel: "DocketBird docket",
    });
  });

  it("reads an attachment as part of its entry, so entry filters and labels include it", () => {
    const d = describeDocument(
      parseRegistryDocument(
        row({
          native_document_id: "njd-3:2026-md-03180-00009-002",
          native_case_id: "njd-3:2026-md-03180",
        }),
      )!,
    );
    expect(d).toMatchObject({
      entryNumber: 9,
      attachment: 2,
      label: "Docket entry 9 · attachment 2",
    });
    expect(filterDocuments([d], { entry: 9 })).toHaveLength(1);
    expect(filterDocuments([d], { entry: 2 })).toHaveLength(0);
  });

  it("holds anything that is not explicitly open, and strips identifiers from held rows", () => {
    const held = parseRegistryDocument(
      row({ availability: "held", sha256: sha, bytes: 5, public_url: "https://x.test/a.pdf" }),
    )!;
    expect(held).toMatchObject({
      availability: "held",
      sha256: null,
      bytes: null,
      publicUrl: null,
    });
    expect(parseRegistryDocument(row({ availability: "maybe" }))!.availability).toBe("held");
    expect(parseRegistryDocument(row({ availability: undefined }))!.availability).toBe("held");
  });

  it("treats an open row without a valid sha-256 as held", () => {
    for (const bad of [null, "", "xyz", "A".repeat(64), "a".repeat(63)]) {
      expect(parseRegistryDocument(row({ sha256: bad }))!.availability).toBe("held");
    }
  });

  it("drops malformed rows and unknown sources", () => {
    expect(parseRegistryDocument(null)).toBeNull();
    expect(parseRegistryDocument(row({ source_system: "pacer" }))).toBeNull();
    expect(parseRegistryDocument(row({ native_document_id: "" }))).toBeNull();
    expect(parseRegistryDocument(row({ native_document_id: "x".repeat(501) }))).toBeNull();
  });

  it("only keeps https public URLs", () => {
    expect(
      parseRegistryDocument(
        row({ source_system: "official-court", public_url: "http://court.test/a.pdf" }),
      )!.publicUrl,
    ).toBeNull();
    expect(
      parseRegistryDocument(
        row({ source_system: "official-court", public_url: "https://court.test/a.pdf" }),
      )!.publicUrl,
    ).toBe("https://court.test/a.pdf");
  });
});

describe("document labels, links and ordering", () => {
  const docs: MatterDocument[] = [
    row({ native_document_id: "flnd-3:2025-md-03140-00005" }),
    row({ native_document_id: "flnd-3:2025-md-03140-00771" }),
    row({ native_document_id: "flnd-3:2025-md-03140-00361", availability: "held" }),
    row({
      source_system: "official-court",
      native_case_id: "3:25md3140",
      native_document_id:
        "https://www.flnd.uscourts.gov/sites/flnd/files/mdl/2025.02.11%20-%20325md3140%20-%20PTO%202.pdf",
      public_url:
        "https://www.flnd.uscourts.gov/sites/flnd/files/mdl/2025.02.11%20-%20325md3140%20-%20PTO%202.pdf",
    }),
    row({
      source_system: "official-court",
      native_case_id: "3:25md3140",
      native_document_id: "https://www.flnd.uscourts.gov/x/Depo%20CMO%2017.pdf",
      public_url: null,
    }),
  ].map((r) => describeDocument(parseRegistryDocument(r)!));

  it("never produces a link for a held document", () => {
    const held = docs.find((d) => d.availability === "held")!;
    expect(matterPdfUrl(held)).toBeNull();
    expect(matterPdfUrl(docs[0]!)).toBe(
      "/api/matter-pdf?source=docketbird&doc=flnd-3%3A2025-md-03140-00005",
    );
    expect(matterPdfUrl(docs[0]!, true)).toContain("download=1");
  });

  it("sorts newest entries first, then dated court items, then undated by name", () => {
    expect(sortDocuments(docs, "entry-desc").map((d) => d.label)).toEqual([
      "Docket entry 771",
      "Docket entry 361",
      "Docket entry 5",
      "2025.02.11 - 325md3140 - PTO 2.pdf",
      "Depo CMO 17.pdf",
    ]);
    expect(
      sortDocuments(docs, "entry-asc")
        .map((d) => d.label)
        .slice(0, 3),
    ).toEqual(["Docket entry 5", "Docket entry 361", "Docket entry 771"]);
    expect(sortDocuments(docs, "name")[0]!.label).toBe("2025.02.11 - 325md3140 - PTO 2.pdf");
  });

  it("filters by source, availability, entry number and text, and counts what it holds", () => {
    expect(filterDocuments(docs, { source: "official-court" })).toHaveLength(2);
    expect(filterDocuments(docs, { availability: "held" }).map((d) => d.entryNumber)).toEqual([
      361,
    ]);
    expect(filterDocuments(docs, { entry: 771 })).toHaveLength(1);
    expect(filterDocuments(docs, { q: "pto 2" })).toHaveLength(1);
    expect(filterDocuments(docs, { q: "  " })).toHaveLength(5);
    expect(filterDocuments(docs, { caseId: "3:25md3140" })).toHaveLength(2);
    expect(
      filterDocuments(docs, { caseId: "flnd-3:2025-md-03140", availability: "held" }),
    ).toHaveLength(1);
    expect(filterDocuments(docs, { caseId: "unknown-id" })).toHaveLength(0);
    expect(countDocuments(docs)).toEqual({
      total: 5,
      open: 4,
      held: 1,
      bySource: { docketbird: 3, "official-court": 2 },
      byCase: { "flnd-3:2025-md-03140": 3, "3:25md3140": 2 },
    });
  });
});

describe("summary and helpers", () => {
  it("uses the registry's exact totals and falls back to the rows in hand", () => {
    const rows = [parseRegistryDocument(row())!];
    expect(
      parseRegistrySummary(
        {
          total: 884,
          open: 840,
          held: 44,
          open_bytes: 571797776,
          by_source: { docketbird: 830, "official-court": 54 },
        },
        rows,
      ),
    ).toEqual({
      total: 884,
      open: 840,
      held: 44,
      openBytes: 571797776,
      bySource: { docketbird: 830, "official-court": 54 },
    });
    expect(parseRegistrySummary(null, rows)).toEqual({
      total: 1,
      open: 1,
      held: 0,
      openBytes: null,
      bySource: {},
    });
  });

  it("formats sizes and leaves unknown sizes as Not recorded", () => {
    expect(formatBytes(null)).toBe("Not recorded");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(207348)).toBe("202 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(571797776)).toBe("545 MB");
    expect(formatBytes(-1)).toBe("Not recorded");
  });

  it("validates streaming requests strictly", () => {
    expect(
      parsePdfRequest(new URLSearchParams("source=docketbird&doc=flnd-3%3A2025-md-03140-00771")),
    ).toEqual({
      source: "docketbird",
      doc: "flnd-3:2025-md-03140-00771",
      download: false,
    });
    expect(
      parsePdfRequest(
        new URLSearchParams("source=official-court&doc=https%3A%2F%2Fx.test%2Fa.pdf&download=1"),
      )!.download,
    ).toBe(true);
    for (const q of [
      "source=pacer&doc=x",
      "source=docketbird",
      "doc=x",
      `source=docketbird&doc=${"x".repeat(501)}`,
      "source=docketbird&doc=a%00b",
      "source=docketbird&doc=a%0Ab",
    ]) {
      expect(parsePdfRequest(new URLSearchParams(q))).toBeNull();
    }
  });
});

describe("server-side paging of the verified PDFs", () => {
  const docs: MatterDocument[] = Array.from({ length: 137 }, (_, i) =>
    describeDocument(
      parseRegistryDocument(
        row({
          // Entry numbers 1..137; every third document is held; every fifth is a CourtListener row (no entry number).
          native_document_id: `flnd-3:2025-md-03140-${String(i + 1).padStart(5, "0")}`,
          native_case_id: i % 2 ? "flnd-3:2025-md-03140" : "69674950",
          source_system: i % 5 === 0 ? "courtlistener" : "docketbird",
          availability: i % 3 === 0 ? "held" : "open",
        }),
      )!,
    ),
  );

  it("returns one page and the exact total of the filtered list", () => {
    const p = pageDocuments(docs, {}, "entry-asc", 0, 50);
    expect(p.rows).toHaveLength(50);
    expect(p.total).toBe(137);
    expect(p.pageSize).toBe(50);
    const last = pageDocuments(docs, {}, "entry-asc", 100, 50);
    expect(last.rows).toHaveLength(37);
    expect(last.offset).toBe(100);
  });

  it("filters before it pages and clamps an offset past the end to the last page", () => {
    const open = pageDocuments(docs, { availability: "open" }, "entry-desc", 0, 10);
    expect(open.total).toBe(docs.filter((d) => d.availability === "open").length);
    expect(open.rows.every((d) => d.availability === "open")).toBe(true);
    const beyond = pageDocuments(docs, {}, "entry-asc", 9999, 50);
    expect(beyond.offset).toBe(100);
    expect(pageDocuments([], {}, "entry-asc", 40, 50)).toMatchObject({
      rows: [],
      total: 0,
      offset: 0,
    });
  });

  it("walks the whole sorted list page by page without losing or repeating a document", () => {
    const seen: string[] = [];
    for (let o = 0; o < 137; o += 25)
      seen.push(
        ...pageDocuments(docs, {}, "entry-desc", o, 25).rows.map((d) => d.nativeDocumentId),
      );
    expect(seen).toHaveLength(137);
    expect(new Set(seen).size).toBe(137);
    expect(seen).toEqual(sortDocuments(docs, "entry-desc").map((d) => d.nativeDocumentId));
  });

  it("counts each facet with every other filter applied, so options match the table", () => {
    const p = pageDocuments(
      docs,
      { availability: "open", source: "docketbird" },
      "entry-asc",
      0,
      50,
    );
    // The source facet ignores the source filter itself but honours availability.
    expect(p.facets.bySource).toEqual(
      countDocuments(filterDocuments(docs, { availability: "open" })).bySource,
    );
    // The availability facet ignores the availability filter but honours the source.
    const bySource = countDocuments(filterDocuments(docs, { source: "docketbird" }));
    expect(p.facets.availability).toEqual({ open: bySource.open, held: bySource.held });
    expect(p.total).toBe(
      filterDocuments(docs, { availability: "open", source: "docketbird" }).length,
    );
  });

  it("finds an entry's documents on any page and never leaves a held one linkable", () => {
    const p = pageDocuments(docs, { entry: 3 }, "entry-asc", 0, 50);
    expect(p.rows.map((d) => d.entryNumber)).toEqual([3]);
    for (const d of pageDocuments(docs, { availability: "held" }, "entry-asc", 0, 50).rows) {
      expect(d).toMatchObject({ availability: "held", sha256: null, bytes: null });
      expect(matterPdfUrl(d)).toBeNull();
    }
  });

  it("ships a small page instead of the whole list", () => {
    const p = pageDocuments(docs, {}, "entry-asc", 0, 50);
    expect(JSON.stringify(p.rows).length).toBeLessThan(JSON.stringify(docs).length / 2);
  });
});
