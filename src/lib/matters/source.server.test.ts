import { describe, expect, it, vi } from "vitest";
import { loadDocumentsPage, parseLegacyDocument } from "./source.server";
import type { MatterOverviewPayload } from "./types";

const item = (links: unknown) => ({
  id: "doc:65407433:1754:1754:14594",
  cells: {
    mdl: "3047",
    doc_type: "Pretrial order",
    description: "SUPPLEMENTAL ORDER",
    entry_date_filed: "2025-03-10",
  },
  links,
});
const recap =
  "https://storage.courtlistener.com/recap/gov.uscourts.cand.401490/gov.uscourts.cand.401490.1754.0.pdf";
const links = [
  { url: recap, label: "Document on CourtListener/RECAP (external)" },
  { url: "https://www.courtlistener.com/docket/65407433/1754/x/", label: "Docket entry" },
  { url: "#mdl/3047", label: "MDL page" },
];
const facts = (sealed: string, free: string) => [
  ["Sealed", sealed],
  ["Free document recorded (RECAP, as captured; not re-checked over the network)", free],
  ["Page count", "2"],
];

describe("saved-sample document links", () => {
  it("links only an explicitly unsealed, free document with a RECAP file URL", () => {
    const d = parseLegacyDocument(item(links), facts("no", "yes"))!;
    expect(d).toMatchObject({
      entryNumber: 1754,
      date: "2025-03-10",
      docType: "Pretrial order",
      pageCount: 2,
      recapUrl: recap,
      held: false,
      docketEntryUrl: "https://www.courtlistener.com/docket/65407433/1754/x/",
    });
  });

  it.each([
    ["yes", "yes"],
    ["", "yes"],
    ["unknown", "yes"],
    ["no", "no"],
    ["no", ""],
  ])("holds the document when sealed=%j and free=%j", (sealed, free) => {
    const d = parseLegacyDocument(item(links), facts(sealed, free))!;
    expect(d.recapUrl).toBeNull();
    expect(d.held).toBe(true);
  });

  it("holds the document when the only file link is not a RECAP PDF", () => {
    const d = parseLegacyDocument(
      item([{ url: "https://evil.example/a.pdf", label: "x" }]),
      facts("no", "yes"),
    )!;
    expect(d.held).toBe(true);
    expect(d.recapUrl).toBeNull();
    expect(
      parseLegacyDocument(
        item([{ url: "http://storage.courtlistener.com/recap/a.pdf", label: "x" }]),
        facts("no", "yes"),
      )!.held,
    ).toBe(true);
  });

  it("drops rows without an id", () => {
    expect(parseLegacyDocument({ cells: {} }, [])).toBeNull();
    expect(parseLegacyDocument(null, [])).toBeNull();
  });
});

describe("verified PDF page assembly", () => {
  it("groups identical files across RPC pages and keeps raw source-record coverage and alias lookups", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://corpus.example");
    vi.stubEnv("EXTERNAL_SUPABASE_KEY", "test-key");
    const duplicateHash = "f".repeat(64);
    const sourceRow = (
      source_system: string,
      native_document_id: string,
      native_case_id: string,
      sha256: string,
    ) => ({
      source_system,
      native_document_id,
      native_case_id,
      availability: "open",
      sha256,
      bytes: 1024,
      public_url: null,
      verified_at: "2026-10-04T00:00:00Z",
    });
    const firstPage = [
      sourceRow("docketbird", "flnd-3:2025-md-03140-00001", "flnd-3:2025-md-03140", duplicateHash),
      ...Array.from({ length: 499 }, (_, i) =>
        sourceRow(
          "docketbird",
          `flnd-3:2025-md-03140-${String(i + 2).padStart(5, "0")}`,
          "flnd-3:2025-md-03140",
          (i + 1).toString(16).padStart(64, "0"),
        ),
      ),
    ];
    const secondPage = [sourceRow("courtlistener", "987654321", "69674950", duplicateHash)];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { p_offset: number };
      const rows = body.p_offset === 0 ? firstPage : secondPage;
      return new Response(
        JSON.stringify({
          rows,
          summary: {
            total: 501,
            open: 501,
            held: 0,
            open_bytes: 513024,
            by_source: { docketbird: 500, courtlistener: 1 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      overview: {
        mdl: "dedup-test-2026-10-05",
        keys: { all: [] },
      },
      registry: { pdfCaseIds: ["flnd-3:2025-md-03140", "69674950"] },
    } as unknown as MatterOverviewPayload;

    try {
      const result = await loadDocumentsPage(
        payload,
        { q: "", source: "", availability: "", caseId: "" },
        "entry-desc",
        0,
        "docketbird|flnd-3:2025-md-03140-00001",
      );
      expect(result.connected).toBe(true);
      if (!result.connected) return;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.summary.total).toBe(501);
      expect(result.sourceRecordsLoaded).toBe(501);
      expect(result.truncated).toBe(false);
      expect(result.loaded).toBe(500);
      expect(result.page.total).toBe(500);
      expect(result.page.facets.availability.open).toBe(500);
      expect(result.page.facets.bySource).toEqual({ docketbird: 500, courtlistener: 1 });
      expect(result.viewed).toMatchObject({
        sourceSystem: "docketbird",
        nativeCaseId: "flnd-3:2025-md-03140",
        nativeDocumentId: "flnd-3:2025-md-03140-00001",
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
