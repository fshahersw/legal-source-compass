import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(),
  rpcPost: vi.fn(),
  rpcPostOptional: vi.fn(),
}));
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
import { DOCUMENT_EXECUTORS, DOCUMENT_TOOL_DEFINITIONS } from "./documentTools.server";

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
  filed_date: "2024-06-26",
  title: "OPINION on the Daubert motions",
  doc_type: "opinion",
  text_status: "text_layer",
};

afterEach(() => {
  vi.mocked(rpcPostOptional).mockReset();
  vi.mocked(restGet).mockReset();
});

describe("search_documents", () => {
  const run = DOCUMENT_EXECUTORS["search_documents"]!;

  it("is described without naming a vendor", () => {
    const d = DOCUMENT_TOOL_DEFINITIONS[0]!;
    expect(d.name).toBe("search_documents");
    expect(d.description.toLowerCase()).not.toMatch(
      /courtlistener|docketbird|claude|openai|voyage/,
    );
  });

  it("returns page-numbered passages with links that open the PDF at that page", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      mode: "text",
      rows: [
        {
          ...ROW,
          matched_pages: 5,
          snippets: [{ page: 14, text: "general [[causation]] opinions" }],
        },
      ],
      total: 1,
      has_more: false,
      facets: {},
      sort: "relevance",
    });
    vi.mocked(restGet).mockResolvedValue({
      rows: [{ id: "njd", title: "District Court, D. New Jersey" }],
      total: null,
    });
    const out = await run({
      query: "causation",
      mdl: "MDL No. 2738",
      filed_from: "2024-01-01",
      filed_to: "bad",
    });
    expect(vi.mocked(rpcPostOptional).mock.calls[0]![1]).toMatchObject({
      p_q: "causation",
      p_mdl: "2738",
      p_from: "2024-01-01",
      p_to: null,
      p_limit: 8,
    });
    const body = JSON.parse(out.content) as {
      results: { passages: { page: number; text: string; open: string }[]; court: string }[];
    };
    expect(body.results[0]!.passages[0]).toEqual({
      page: 14,
      text: "general «causation» opinions",
      open: "/api/matter-pdf?source=docketbird&doc=njd-3%3A2016-md-02738-33091#page=14",
    });
    expect(body.results[0]!.court).toBe("D. New Jersey");
    expect(out.sources[0]).toMatchObject({
      internal: true,
      url: expect.stringContaining("#page=14"),
    });
    expect(out.detail).toContain("1 filing");
  });

  it("says when the index is not built and rejects malformed filters", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(null);
    const out = await run({ query: "x" });
    expect(JSON.parse(out.content)).toMatchObject({ available: false });
    await expect(run({ court: "not a court!" })).rejects.toThrow(/court id/);
  });
});
