import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDocumentsPage,
  loadHub,
  loadHubPdfCounts,
  loadMdlVelocity,
  loadRegistryDocuments,
  loadTimelineArchive,
  parseLegacyDocument,
  resetHubCachesForTests,
} from "./source.server";
import { caseIdPlan, parseRegistryRecord } from "./registry";
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
      if (String(_url).includes("corpus_pdf_case_aliases_v1")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
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
      expect(fetchMock).toHaveBeenCalledTimes(3);
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
      if (String(url).includes("corpus_pdf_case_aliases_v1")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
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

/* ------------------------------------------------------------------ hub */

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** A registry record shaped like `sw_matters_v1` (only what the hub reads). */
const registryRow = (mdl: string, pdfCaseIds: string[], members: number) => ({
  id: `sw-matter:${mdl}`,
  title: `IN RE: Matter ${mdl}`,
  cells: { status: "pending" },
  facts: [],
  registry: {
    schema: "sw-matter-registry/v1",
    mdl,
    pdf_case_ids: pdfCaseIds,
    members: { rows: members },
    jpml: { as_of: "2026-10-01", pending: 100, historical_total: 200, scope: "x" },
  },
});

type HubFixture = {
  /** Registry case ids per matter; a run-specific suffix keeps module caches from leaking between tests. */
  plans: Record<string, string[]>;
  /** Alias ids returned for a matter, or "fail" for a failed call. */
  aliases?: Record<string, string[] | "fail">;
  registryReady?: boolean;
};

/**
 * PostgREST double for the hub: publication list, the three hub reads, the alias RPC and the PDF summary RPC. The
 * summary is a pure function of the ids asked for, so a count that includes alias ids differs from one that does not.
 */
function hubFetch(fx: HubFixture) {
  const calls = { alias: 0, docs: 0, rest: 0, rpc: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    if (url.includes("/rpc/")) calls.rpc += 1;
    else calls.rest += 1;
    if (url.includes("/rpc/corpus_pdf_case_aliases_v1")) {
      calls.alias += 1;
      const body = JSON.parse(String(init?.body)) as { p_mdl: string };
      const a = fx.aliases?.[body.p_mdl] ?? [];
      return a === "fail" ? new Response("boom", { status: 500 }) : json(a);
    }
    if (url.includes("/rpc/corpus_matter_pdf_documents_v1")) {
      calls.docs += 1;
      const ids = (JSON.parse(String(init?.body)) as { p_native_case_ids: string[] })
        .p_native_case_ids;
      const total = 100 * ids.length + ids.filter((i) => i.startsWith("MDL ")).length * 7;
      return json({ rows: [], summary: { total, open: ids.length, held: total - ids.length } });
    }
    if (url.includes("corpus_datasets?select=id,ready"))
      return json(
        ["mdls", "mdl_appearances", "sw_matters_v1"].map((id) => ({
          id,
          ready: id === "sw_matters_v1" ? fx.registryReady !== false : true,
        })),
      );
    if (url.includes("corpus_datasets?select=ready,updated_at"))
      return json([{ ready: true, updated_at: "2026-10-18T18:08:06Z" }]);
    if (url.includes("dataset=eq.mdls")) return json([]);
    if (url.includes("dataset=eq.mdl_appearances")) return json([{ filters: { mdl: ["3140"] } }]);
    if (url.includes("dataset=eq.sw_matters_v1"))
      return json(
        Object.entries(fx.plans).map(([mdl, ids]) => registryRow(mdl, ids, ids.length * 10)),
      );
    if (url.includes("dataset=eq.jpml_pending_history_mdls"))
      return json([
        {
          id: "3140",
          title: "IN RE: Depo-Provera",
          source_url: "https://www.jpml.uscourts.gov/sites/jpml/files/report-2026-10.pdf",
          type: "Products Liability",
          series: [
            { date: "2025-10-01", total: 1000, pending: 900 },
            { date: "2026-07-01", total: 5000, pending: 4900 },
            { date: "2026-10-01", total: 6000, pending: 5800 },
          ],
        },
        {
          id: "3084",
          title: "IN RE: Uber",
          source_url: "https://www.jpml.uscourts.gov/sites/jpml/files/report-2026-10.pdf",
          type: "Products Liability",
          series: [
            { date: "2025-10-01", total: 100, pending: 100 },
            { date: "2026-10-01", total: 300, pending: 290 },
          ],
        },
      ]);
    throw new Error(`unexpected request ${url}`);
  });
  return { fetchMock, calls };
}

describe("matters hub", () => {
  beforeEach(() => {
    vi.stubEnv("EXTERNAL_SUPABASE_URL", "https://corpus.example");
    vi.stubEnv("EXTERNAL_SUPABASE_KEY", "test-key");
    resetHubCachesForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves the table from three small reads, without any PDF registry call", async () => {
    const { fetchMock, calls } = hubFetch({
      plans: { "3140": ["flnd-3:2025-md-03140-t1"], "2545": ["ilnd-1:2014-cv-01748-t1"] },
    });
    vi.stubGlobal("fetch", fetchMock);
    const rows = await loadHub();
    expect(calls.rpc).toBe(0);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(rows).toHaveLength(38);
    const r3140 = rows.find((r) => r.mdl === "3140")!;
    expect(r3140.registry).toBeNull();
    expect(r3140.registryDockets).toBe(10);
    expect(r3140.swAppearances).toBe(1);
    expect(r3140).toMatchObject({ pendingActions: 100, totalActions: 200, asOf: "2026-10-01" });
  });

  it("counts each matter's PDFs exactly as its page header does, aliases included", async () => {
    const plans = {
      "3140": ["flnd-3:2025-md-03140-t2", "69674950-t2"],
      "2545": ["ilnd-1:2014-cv-01748-t2"],
      "3180": ["nyed-1:2025-md-03180-t2", "70000001-t2", "70000002-t2"],
    };
    const { fetchMock, calls } = hubFetch({ plans, aliases: { "2545": ["MDL 2545"] } });
    vi.stubGlobal("fetch", fetchMock);
    const counts = await loadHubPdfCounts();
    // Parity target recorded for this fixture (the pre-split loadHub produced the same values).
    expect(counts["3140"]).toEqual({ open: 2, held: 198, total: 200 });
    expect(counts["2545"]).toEqual({ open: 2, held: 205, total: 207 });
    expect(counts["3180"]).toEqual({ open: 3, held: 297, total: 300 });
    expect(counts["3047"]).toBeNull(); // no registry record and no derived keys: unknown, never 0
    // The header path: loadRegistryDocuments(caseIdPlan(registry, derived), true, mdl) on the same record.
    for (const [mdl, ids] of Object.entries(plans)) {
      const reg = parseRegistryRecord(registryRow(mdl, ids, 0), mdl);
      const header = await loadRegistryDocuments(caseIdPlan(reg, []), true, mdl);
      expect(header.connected).toBe(true);
      if (!header.connected) continue;
      const { open, held, total } = header.summary;
      expect(counts[mdl]).toEqual({ open, held, total });
    }
    // Three alias calls and three summaries for the hub; the header reads above were served from the caches.
    expect(calls.alias).toBe(3);
    expect(calls.docs).toBe(3);
  });

  it("makes one alias call for a matter's summary and its document rows", async () => {
    const { fetchMock, calls } = hubFetch({ plans: {} });
    vi.stubGlobal("fetch", fetchMock);
    const plan = caseIdPlan(
      parseRegistryRecord(registryRow("3081", ["azd-2:2023-md-03081-t3"], 0), "3081"),
      [],
    );
    await loadRegistryDocuments(plan, true, "3081");
    await loadRegistryDocuments(plan, false, "3081");
    expect(calls.alias).toBe(1);
    expect(calls.docs).toBe(2);
  });

  it("never remembers a failed alias call: the next read asks again and the counts are not kept", async () => {
    const fx: HubFixture = {
      plans: { "2545": ["ilnd-1:2014-cv-01748-t4"] },
      aliases: { "2545": "fail" },
    };
    const { fetchMock, calls } = hubFetch(fx);
    vi.stubGlobal("fetch", fetchMock);
    const first = await loadHubPdfCounts();
    // Served once on the unexpanded ids, as the page always has.
    expect(first["2545"]).toEqual({ open: 1, held: 99, total: 100 });
    fx.aliases = { "2545": ["MDL 2545"] };
    const second = await loadHubPdfCounts();
    expect(second["2545"]).toEqual({ open: 2, held: 205, total: 207 });
    expect(calls.alias).toBe(2);
  });

  it("keeps a good count map for the next request", async () => {
    const { fetchMock, calls } = hubFetch({ plans: { "3140": ["flnd-3:2025-md-03140-t5"] } });
    vi.stubGlobal("fetch", fetchMock);
    await loadHubPdfCounts();
    const before = fetchMock.mock.calls.length;
    await loadHubPdfCounts();
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(calls.docs).toBe(1);
  });

  it("flags MDLs outside the registry by exact number, and leaves the flag unknown when the registry is not read", async () => {
    const { fetchMock } = hubFetch({ plans: { "3140": ["flnd-3:2025-md-03140-t6"] } });
    vi.stubGlobal("fetch", fetchMock);
    const v = await loadMdlVelocity();
    expect(v.published).toBe(true);
    if (!v.published) return;
    expect(v.latestReport).toBe("2026-10-01");
    expect(v.reportUrl).toBe("https://www.jpml.uscourts.gov/sites/jpml/files/report-2026-10.pdf");
    const by = new Map(v.rows.map((r) => [r.mdl, r]));
    expect(by.get("3140")).toMatchObject({ added12m: 5000, added3m: 1000, inRegistry: true });
    expect(by.get("3084")).toMatchObject({ added12m: 200, window3: "partial", inRegistry: false });

    resetHubCachesForTests();
    const unread = hubFetch({ plans: {}, registryReady: false });
    vi.stubGlobal("fetch", unread.fetchMock);
    const u = await loadMdlVelocity();
    expect(u.published && u.rows.every((r) => r.inRegistry === null)).toBe(true);
  });
});
