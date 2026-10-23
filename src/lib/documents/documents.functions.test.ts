import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({ restGet: vi.fn(), rpcPostOptional: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: (v: (d: unknown) => unknown) => ({
      handler: (handler: (a: { data: unknown }) => unknown) => (a: { data: unknown }) =>
        handler({ data: v(a.data) }),
    }),
  }),
}));

import { restGet, rpcPostOptional } from "@/lib/external/rest.server";
import {
  documentsForEntity,
  documentsStatus,
  getDocument,
  runDocumentSearch,
  searchDocuments,
  searchInput,
} from "./documents.functions";

type Fn<T> = (a: { data?: unknown }) => Promise<T>;
const call = async <T>(fn: unknown, data?: unknown) => (fn as Fn<T>)({ data });

const ROW = {
  id: "d_0123456789abcdef01234567",
  collection: "docket_filings",
  source_system: "courtlistener",
  native_document_id: "421337",
  native_case_id: "68291234",
  mdl: "2924",
  listed_by: "registry_pdf_case_id",
  court_id: "flsd",
  filed_date: "2022-12-06",
  title: "OMNIBUS ORDER on Daubert motions",
  doc_type: "order",
  text_status: "partial_text",
  page_count: 340,
  pages_with_text: 320,
};

afterEach(() => {
  vi.mocked(rpcPostOptional).mockReset();
  vi.mocked(restGet).mockReset();
});

describe("searchDocuments", () => {
  it("sends the filters to the RPC and names courts and MDLs from their published records", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      mode: "text",
      rows: [
        {
          ...ROW,
          snippets: [{ page: 12, text: "the [[ranitidine]] pills" }],
          matched_pages: 3,
          rank: 0.4,
        },
      ],
      total: 1,
      has_more: false,
      capped: false,
      facets: {
        court: [["flsd", 1]],
        mdl: [["2924", 1]],
        type: [["order", 1]],
        year: [["2022", 1]],
      },
      query: "'ranitidin'",
      sort: "relevance",
      dropped_unavailable: 0,
      offset: 20,
      limit: 20,
    });
    vi.mocked(restGet)
      .mockResolvedValueOnce({
        rows: [{ id: "flsd", title: "District Court, S.D. Florida" }],
        total: null,
      })
      .mockResolvedValueOnce({
        rows: [{ id: "2924", title: "IN RE: Zantac (Ranitidine) Products Liability Litigation" }],
        total: null,
      });
    const r = await call<Awaited<ReturnType<typeof runDocumentSearch>>>(searchDocuments, {
      q: " ranitidine ",
      court: "flsd",
      mdl: "2924",
      page: 2,
    });
    expect(vi.mocked(rpcPostOptional).mock.calls[0]).toEqual([
      "documents_search_v1",
      {
        p_q: "ranitidine",
        p_court: "flsd",
        p_mdl: "2924",
        p_from: null,
        p_to: null,
        p_type: null,
        p_sort: null,
        p_limit: 20,
        p_offset: 20,
      },
    ]);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.courtNames).toEqual({ flsd: "S.D. Florida" });
    expect(r.mdlNames["2924"]).toContain("Zantac");
    expect(r.rows[0]!.snippets[0]!.page).toBe(12);
    expect(vi.mocked(restGet).mock.calls[0]![0]).toContain("dataset=eq.court_spine&id=in.(flsd)");
  });

  it("answers not available when the contract is not applied, and drops relevance without words", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(null);
    const r = await runDocumentSearch(searchInput.parse({ q: "", sort: "relevance" }));
    expect(r).toEqual({ available: false });
    expect(vi.mocked(rpcPostOptional).mock.calls[0]![1]).toMatchObject({ p_q: null, p_sort: null });
  });

  it("refuses bad filters before any read and reports a failed read plainly", async () => {
    await expect(call(searchDocuments, { court: "N.J." })).rejects.toThrow();
    await expect(call(searchDocuments, { mdl: "2738; drop" })).rejects.toThrow();
    expect(rpcPostOptional).not.toHaveBeenCalled();
    vi.mocked(rpcPostOptional).mockRejectedValueOnce(
      new Error("External corpus read failed (500)."),
    );
    await expect(call(searchDocuments, { q: "x" })).rejects.toThrow(
      "The document search could not be run.",
    );
  });

  it("keeps working when the name lookup fails", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      mode: "browse",
      rows: [{ ...ROW, court_id: "cand", mdl: "3047" }],
      total: 1,
      facets: {},
    });
    vi.mocked(restGet).mockRejectedValue(new Error("down"));
    const r = await runDocumentSearch(searchInput.parse({}));
    expect(r.available && r.rows).toHaveLength(1);
    expect(r.available && r.courtNames).toEqual({});
  });
});

describe("getDocument and documentsForEntity", () => {
  it("returns null for a document the layer does not serve", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce("not an object");
    const r = await call<{ available: boolean; document: unknown }>(getDocument, {
      id: "d_ffffffffffffffffffffffff",
    });
    expect(r).toMatchObject({ available: true, document: null });
    await expect(call(getDocument, { id: "../etc" })).rejects.toThrow();
  });

  it("builds the per-year trend and validates ids per entity type", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      type: "law_unit",
      id: "usc:28:1407",
      basis: "Documents whose text cites this provision.",
      total: 3,
      with_text: 3,
      undated: 0,
      by_year: [
        [2024, 1],
        [2025, 2],
      ],
      by_type: [],
      mentions: 5,
      recent: [{ ...ROW, mentions: 2, first_page: 4 }],
      refreshed: null,
    });
    vi.mocked(restGet).mockResolvedValue({ rows: [], total: null });
    const r = await call<{
      available: boolean;
      trend: { series: { points: unknown[] }[] } | null;
      docs: { recent: { firstPage: number }[] };
    }>(documentsForEntity, { type: "law_unit", id: "usc:28:1407" });
    expect(vi.mocked(rpcPostOptional).mock.calls[0]).toEqual([
      "documents_for_entity_v1",
      { p_type: "law_unit", p_id: "usc:28:1407", p_limit: 8 },
    ]);
    expect(r.available).toBe(true);
    expect(r.trend?.series[0]!.points.length).toBeGreaterThanOrEqual(2);
    expect(r.docs.recent[0]!.firstPage).toBe(4);
    await expect(call(documentsForEntity, { type: "judge", id: "Jane Doe" })).rejects.toThrow();
    await expect(call(documentsForEntity, { type: "law_unit", id: "usc:28" })).rejects.toThrow();
  });

  it("reports the status, or not available", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      documents: 41879,
      pages_indexed: 147000,
      mdls: 120,
      courts: 60,
      by_text_status: { text_layer: 18000, "bad key!": 3 },
    });
    const s = await call<{
      available: boolean;
      documents: number;
      byTextStatus: Record<string, number>;
    }>(documentsStatus);
    expect(s).toMatchObject({
      available: true,
      documents: 41879,
      byTextStatus: { text_layer: 18000 },
    });
  });
});
