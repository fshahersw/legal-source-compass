import { describe, expect, it, vi } from "vitest";
import { loadDocumentsPage, loadTimelineArchive, parseLegacyDocument } from "./source.server";
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

  it("loads exact timeline document ids beyond the broad archive cap and rejects unrequested or wrong-docket rows", async () => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://corpus.example");
    vi.stubEnv("EXTERNAL_SUPABASE_KEY", "test-key");
    const row = (
      native_document_id: string,
      native_case_id: string,
      availability = "open",
      source_system = "courtlistener",
    ) => ({
      source_system,
      native_document_id,
      native_case_id,
      availability,
      sha256: availability === "open" ? "a".repeat(64) : null,
      bytes: availability === "open" ? 250 : null,
      public_url: null,
      verified_at: "2026-10-05T00:00:00Z",
    });
    const targetCase = "69679999";
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(url).includes("corpus_pdf_documents_by_id_v1")) {
        return new Response(
          JSON.stringify({
            rows: [
              row("beyond-cap", targetCase),
              row("held-exact", targetCase, "held"),
              row("wrong-docket", "unrelated-case"),
              row("not-requested", targetCase),
              row("wrong-source", "flnd-3:2025-md-03140", "open", "docketbird"),
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      expect(String(url)).toContain("corpus_matter_pdf_documents_v1");
      expect(body["p_native_case_ids"]).toEqual(["flnd-3:2026-md-09999", targetCase]);
      return new Response(
        JSON.stringify({
          rows: body["p_offset"] === 0 ? [row("held-exact", targetCase, "open")] : [],
          summary: { total: 20_001, open: 20_001, held: 0, open_bytes: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      overview: { mdl: "exact-id-cap-test-2026-10-05", keys: { all: [] } },
      registry: {
        pdfCaseIds: ["flnd-3:2026-md-09999", targetCase],
        caseIds: [
          {
            docketKey: "flnd:3:2026-md-09999",
            nativeCaseIds: [
              { provider: "docketbird", id: "flnd-3:2026-md-09999" },
              { provider: "courtlistener", id: targetCase },
            ],
          },
        ],
      },
    } as unknown as MatterOverviewPayload;
    const item = (id: string, docIds: string[]) => ({
      id,
      provider: "courtlistener",
      docketKey: "flnd:3:2026-md-09999",
      entryNumber: 12,
      withheld: null,
      documentIds: docIds,
    });
    const overLimitIds = Array.from({ length: 498 }, (_, index) => `unmatched-${index}`);

    try {
      const result = await loadTimelineArchive(payload, [
        item("entry-beyond-cap", ["beyond-cap", ...overLimitIds]),
        item("entry-held", ["held-exact"]),
        item("entry-wrong-docket", ["wrong-docket"]),
        item("entry-wrong-source", ["wrong-source"]),
      ]);
      expect(result.connected).toBe(true);
      if (!result.connected) return;
      expect(result.complete).toBe(false);
      expect(
        result.byEntry["entry-beyond-cap"]?.documents.map((d) => d.doc.nativeDocumentId),
      ).toEqual(["beyond-cap"]);
      expect(result.byEntry["entry-held"]?.documents[0]?.doc).toMatchObject({
        nativeDocumentId: "held-exact",
        availability: "held",
        sha256: null,
        bytes: null,
        publicUrl: null,
      });
      expect(result.byEntry["entry-wrong-docket"]).toMatchObject({ documents: [], notArchived: 1 });
      expect(result.byEntry["entry-wrong-source"]).toMatchObject({ documents: [], notArchived: 1 });
      expect(
        Object.values(result.byEntry)
          .flatMap((entry) => entry.documents)
          .some((d) => d.doc.nativeDocumentId === "not-requested"),
      ).toBe(false);
      const exactRequests = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("corpus_pdf_documents_by_id_v1"),
      );
      const exactBodies = exactRequests.map(
        ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      expect(exactBodies.map((body) => (body["p_native_document_ids"] as string[]).length)).toEqual(
        [500, 2],
      );
      expect(
        exactBodies.every((body) => (body["p_native_document_ids"] as string[]).length <= 500),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
