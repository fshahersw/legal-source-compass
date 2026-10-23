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
import { getCaselawCase, searchCaselaw } from "./caselaw.functions";

const KEY_A = "caselaw/read/2026-09-30/t4/v2/u05/t4-u05-0000-0123456789ab.jsonl.gz";
const KEY_B = "caselaw/read/2026-09-30/t4/v2/u12/t4-u12-0003-ba9876543210.jsonl.gz";
const member = (o: unknown) => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(o))));
const lead = member({
  format: "caselaw-read/1",
  opinion_id: 21,
  cluster_id: 9,
  type: "020lead",
  text: "See 1 F.3d 2.",
  pages: [],
  citations: [[4, 12, 77, 70, 0]],
});
const dissent = member({
  format: "caselaw-read/1",
  opinion_id: 22,
  cluster_id: 9,
  type: "040dissent",
  text: "No.",
  pages: [],
  citations: [],
});
const objects: Record<string, Uint8Array> = {
  [KEY_A]: lead,
  [KEY_B]: new Uint8Array([0, 0, 0, ...dissent]),
};

type Fn = (a: { data: unknown }) => Promise<unknown>;

describe("case law v2 server functions", () => {
  beforeEach(() => {
    process.env["EXTERNAL_SUPABASE_URL"] = "https://example.supabase.co";
    process.env["EXTERNAL_SUPABASE_KEY"] = "service-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(rpcPostOptional).mockReset();
    vi.mocked(rpcPost).mockReset();
  });

  it("reads a case whose opinions sit in two objects and re-checks unheld links", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      cluster_id: 9,
      tier: 4,
      court_id: "texapp",
      case_name: "A v. B",
      jurisdiction: "TX",
      court_level: "SA",
      opinions: [
        { id: 21, type: "020lead", key: KEY_A, s: 0, n: lead.length },
        { id: 22, type: "040dissent", key: KEY_B, s: 3, n: dissent.length },
      ],
    });
    vi.mocked(rpcPost).mockResolvedValueOnce([77]); // caselaw_held_v1: cluster 77 is held now
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const key = decodeURIComponent(url.split("/corpus-originals/")[1]!);
      const m = /bytes=(\d+)-(\d+)/.exec((init.headers as Record<string, string>)["Range"]!)!;
      return new Response(objects[key]!.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const page = (await (getCaselawCase as unknown as Fn)({ data: { id: 9 } })) as {
      textError: string | null;
      record: { tier: number; jurisdiction: string | null };
      opinions: {
        status: string;
        opinion?: { citations: { held: boolean; clusterId: number | null }[] };
      }[];
    };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.textError).toBeNull();
    expect([page.record.tier, page.record.jurisdiction]).toEqual([4, "TX"]);
    expect(page.opinions.map((o) => o.status)).toEqual(["ok", "ok"]);
    expect(page.opinions[0]!.opinion!.citations).toEqual([
      expect.objectContaining({ clusterId: 77, held: true }),
    ]);
    expect(vi.mocked(rpcPost)).toHaveBeenCalledWith("caselaw_held_v1", { p_ids: [77] });
  });

  it("searches every tier with v2 and falls back to v1 for tiers 1-3", async () => {
    vi.mocked(rpcPostOptional).mockResolvedValueOnce({
      mode: "browse",
      rows: [{ cluster_id: 3, tier: 5, court_id: "nysd", case_name: "x", jurisdiction: "NY" }],
    });
    const run = searchCaselaw as unknown as Fn;
    const v2 = (await run({ data: { q: "", tier: 5, jurisdiction: "NY" } })) as {
      rows: { tier: number; jurisdiction: string }[];
    };
    expect(v2.rows).toEqual([expect.objectContaining({ tier: 5, jurisdiction: "NY" })]);
    expect(vi.mocked(rpcPostOptional).mock.calls[0]![1]).toMatchObject({
      p_tiers: [5],
      p_jurisdiction: "NY",
    });
    // the v2 contract is not installed: tiers 1-3 through v1, a tier 4-7 or state filter finds nothing
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(null);
    vi.mocked(rpcPost).mockResolvedValueOnce({
      mode: "browse",
      rows: [{ cluster_id: 4, tier: 2, court_id: "ca1", case_name: "y" }],
    });
    const v1 = (await run({ data: { q: "", tier: 2 } })) as { rows: unknown[] };
    expect(v1.rows).toHaveLength(1);
    expect(vi.mocked(rpcPost).mock.calls[0]![0]).toBe("caselaw_search_v1");
    vi.mocked(rpcPostOptional).mockResolvedValueOnce(null);
    const none = (await run({ data: { q: "", tier: 4 } })) as { rows: unknown[] };
    expect(none.rows).toEqual([]);
    expect(() => run({ data: { q: "", jurisdiction: "Texas" } })).toThrow();
  });
});
