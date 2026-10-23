import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./rest.server", () => ({ rpcPost: vi.fn(), rpcPostOptional: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: (v: (d: unknown) => unknown) => ({
      handler: (handler: (a: { data: unknown }) => unknown) => (a: { data: unknown }) =>
        handler({ data: v(a.data) }),
    }),
  }),
}));

import { rpcPost, rpcPostOptional } from "./rest.server";
import { getCaselawCase, getCaselawCitator, searchCaselaw } from "./caselaw.functions";

const KEY = "caselaw/read/2026-09-30/t1/scotus/scotus-1960s-0003-0123456789ab.jsonl.gz";
const CKEY = "caselaw/citator/2026-09-30/c12-0000-0123456789ab.jsonl.gz";
const member = (o: unknown) => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(o))));

const lead = member({
  format: "caselaw-read/1",
  opinion_id: 11,
  cluster_id: 5,
  type: "020lead",
  text: "Majority *2 text.",
  pages: [["2", 1, 9]],
  citations: [],
});
const dissent = member({
  format: "caselaw-read/1",
  opinion_id: 12,
  cluster_id: 5,
  type: "040dissent",
  text: "Dissent.",
  pages: [],
  citations: [],
});
const prefix = new Uint8Array(7);
const blob = new Uint8Array([...prefix, ...lead, ...dissent]);

function caseRow(extra: Record<string, unknown> = {}) {
  return {
    cluster_id: 5,
    tier: 1,
    court_id: "scotus",
    court: { full_name: "Supreme Court of the United States" },
    case_name: "A v. B",
    citations: ["1 U.S. 1"],
    opinions: [
      { id: 12, type: "040dissent", o: 1, s: 7 + lead.length, n: dissent.length, key: KEY },
      { id: 11, type: "020lead", o: 1, s: 7, n: lead.length, key: KEY },
      { id: 13, type: "030concurrence" },
    ],
    citator: { key: CKEY, offset: 0, length: 0 },
    ...extra,
  };
}

describe("getCaselawCase", () => {
  beforeEach(() => {
    process.env["EXTERNAL_SUPABASE_URL"] = "https://example.supabase.co";
    process.env["EXTERNAL_SUPABASE_KEY"] = "service-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(rpcPostOptional).mockReset();
  });

  it("reads every stored opinion with one ranged request", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(caseRow());
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const m = /bytes=(\d+)-(\d+)/.exec((init.headers as Record<string, string>)["Range"]!)!;
      return new Response(blob.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = await (
      getCaselawCase as unknown as (a: {
        data: unknown;
      }) => Promise<Awaited<ReturnType<typeof getCaselawCase>>>
    )({ data: { id: 5 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(page.available).toBe(true);
    expect(page.textError).toBeNull();
    expect(page.opinions.map((o) => [o.opinionId, o.status])).toEqual([
      [12, "ok"],
      [11, "ok"],
      [13, "not_stored"],
    ]);
    const first = page.opinions[1]!;
    expect(first.status === "ok" && first.opinion.pages).toEqual([
      { label: "2", index: 1, offset: 9 },
    ]);
  });

  it("returns not available for an unknown case", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(null);
    const page = await (
      getCaselawCase as unknown as (a: { data: unknown }) => Promise<{ available: boolean }>
    )({ data: { id: 6 } });
    expect(page.available).toBe(false);
  });

  it("reports a storage failure without failing the page", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(caseRow({ cluster_id: 7 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const page = await (
      getCaselawCase as unknown as (a: {
        data: unknown;
      }) => Promise<{ textError: string | null; opinions: { status: string }[] }>
    )({ data: { id: 7 } });
    expect(page.textError).toMatch(/could not be read/);
    expect(page.opinions.map((o) => o.status)).toEqual(["unreadable", "unreadable", "not_stored"]);
  });

  it("rejects ids out of range", () => {
    expect(() =>
      (getCaselawCase as unknown as (a: { data: unknown }) => unknown)({ data: { id: 0 } }),
    ).toThrow();
  });
});

describe("getCaselawCitator", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads the citator member of the case", async () => {
    const m = member({
      format: "caselaw-citator/1",
      cluster_id: 8,
      cited_by: { opinions: 2, cases: 1 },
      by_court: [["ca1", 2]],
      citing: [],
      parentheticals: [],
    });
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(
      caseRow({ cluster_id: 8, citator: { key: CKEY, offset: 3, length: m.length } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(m, { status: 206 })),
    );
    const r = await (
      getCaselawCitator as unknown as (a: {
        data: unknown;
      }) => Promise<{ citator: { citedByOpinions: number } | null }>
    )({ data: { id: 8 } });
    expect(r.citator?.citedByOpinions).toBe(2);
  });
});

describe("searchCaselaw", () => {
  afterEach(() => vi.mocked(rpcPost).mockReset());
  it("falls back to a name search when a citation is not held", async () => {
    vi.mocked(rpcPost)
      .mockResolvedValueOnce({ mode: "citation", rows: [], has_more: false })
      .mockResolvedValueOnce({
        mode: "name",
        rows: [{ cluster_id: 1, tier: 3, court_id: "cal", case_name: "People v. Smith" }],
        has_more: false,
      });
    const r = await (
      searchCaselaw as unknown as (a: {
        data: unknown;
      }) => Promise<{ mode: string; note: string | null; rows: unknown[] }>
    )({
      data: { q: "12 Cal Smith 3" },
    });
    expect(r.mode).toBe("name");
    expect(r.rows).toHaveLength(1);
    expect(r.note).toMatch(/No case with the citation/);
    expect(vi.mocked(rpcPost).mock.calls[1]![1]).toMatchObject({
      p_q: "Cal Smith",
      p_sort: "relevance",
    });
  });
  it("drops malformed rows and passes filters", async () => {
    vi.mocked(rpcPost).mockResolvedValueOnce({
      mode: "browse",
      rows: [{ cluster_id: "x" }, { cluster_id: 2, tier: 2, court_id: "ca9", case_name: "A" }],
      has_more: true,
    });
    const r = await (
      searchCaselaw as unknown as (a: {
        data: unknown;
      }) => Promise<{ dropped: number; hasMore: boolean }>
    )({
      data: { q: "", tier: 2, court: "ca9", sort: "cited", page: 2 },
    });
    expect(r.dropped).toBe(1);
    expect(r.hasMore).toBe(true);
    expect(vi.mocked(rpcPost).mock.calls[0]![1]).toMatchObject({
      p_q: null,
      p_tier: 2,
      p_court: "ca9",
      p_sort: "cited",
      p_offset: 25,
    });
  });
});
