import { describe, expect, it } from "vitest";
import {
  countDocuments,
  describeDocument,
  filterDocuments,
  formatBytes,
  matterPdfUrl,
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
      label: "Docket entry 771",
      sourceLabel: "DocketBird docket",
    });
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
    expect(countDocuments(docs)).toEqual({
      total: 5,
      open: 4,
      held: 1,
      bySource: { docketbird: 3, "official-court": 2 },
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
