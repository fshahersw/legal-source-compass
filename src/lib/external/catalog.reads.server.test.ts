import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryPublishedDataset, searchPublishedCorpus } from "./catalog.reads.server";
import { restGet, rpcPost } from "./rest.server";
import type { SearchRecord } from "./searchIdentity";

vi.mock("./rest.server", () => ({ restGet: vi.fn(), rpcPost: vi.fn() }));

describe("authoritative corpus listing", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["state_codes", "court_spine"])(
    "keeps an empty result for %s without reading raw unpublished or unrelated records",
    async (dataset) => {
      vi.mocked(rpcPost).mockResolvedValue({
        items: [],
        total: 0,
        total_capped: false,
      });
      const r = await queryPublishedDataset(
        { dataset, q: "no matching phrase", filters: {}, offset: 0 },
        50,
      );
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
      expect(restGet).not.toHaveBeenCalled();
      expect(rpcPost).toHaveBeenCalledWith(
        "corpus_query_bounded",
        expect.objectContaining({
          p_dataset: dataset,
          p_q: "no matching phrase",
        }),
      );
    },
  );
});

describe("bounded published search ranking", () => {
  beforeEach(() => vi.resetAllMocks());
  function setup(records: SearchRecord[], datasets: string[], courts: { id: string; state: string }[] = []) {
    vi.mocked(restGet).mockImplementation(async (path) => {
      if (path.startsWith("corpus_datasets?")) return { rows: datasets.map((id) => ({ id })), total: datasets.length };
      if (path.startsWith("corpus_records?select=id,state&dataset=eq.court_spine")) return { rows: courts, total: courts.length };
      const encoded = path.split("&id=in.")[1]!.split("&dataset=")[0]!;
      const ids = JSON.parse(`[${decodeURIComponent(encoded).slice(1, -1)}]`) as string[];
      return { rows: records.filter((record) => ids.includes(record.id)), total: null };
    });
  }
  it("finds a real MDL beyond the ordinal candidate page without querying unpublished datasets", async () => {
    const scienceItem = { id: "3542", title: "Toxicological Profile for Acrylonitrile" };
    const mdlItem = { id: "mdl:2738", mdl_number: 2738, title: "IN RE: Johnson & Johnson Talcum Powder Products Marketing, Sales Practices and Products Liability Litigation" };
    const records: SearchRecord[] = [
      { id: "3542", dataset: "agency_science_documents", title: scienceItem.title, state: null, category: null, source_url: "https://www.atsdr.cdc.gov/ToxProfiles/tp125-a.pdf", item: scienceItem },
      { id: "2738", dataset: "mdls", title: mdlItem.title, state: null, category: null, source_url: null, item: mdlItem },
    ];
    setup(records, ["agency_science_documents", "mdls"]);
    vi.mocked(rpcPost).mockImplementation(async (_fn, body) => body["p_datasets"] instanceof Array && body["p_datasets"].length === 1
      ? { items: [mdlItem], total: 1 } : { items: [scienceItem], total: 600 });
    const result = await searchPublishedCorpus("talc", 0, 50);
    expect(result.matches.map((row) => row.record.id)).toEqual(["2738", "3542"]);
    expect(result).toMatchObject({ total: 600, returned: 2, nativeCandidates: 2, rankedCandidates: 2, hasMore: false, candidateCapped: true, candidateLimit: 750 });
    expect(rpcPost).toHaveBeenCalledTimes(2);
    expect(rpcPost).toHaveBeenCalledWith("corpus_query", expect.objectContaining({ p_datasets: ["mdls"], p_limit: 250, p_offset: 0, p_filters: { __prefix: true } }));
    expect(rpcPost).not.toHaveBeenCalledWith("corpus_query", expect.objectContaining({ p_datasets: ["expert_rulings"] }));
  });

  it("paginates the same ranked pool, collapses repeated candidate identities and preserves strict query syntax", async () => {
    const records: SearchRecord[] = Array.from({ length: 61 }, (_, index) => {
      const id = String(index).padStart(3, "0");
      const item = { id, title: `Topic ${id}` };
      return { id, dataset: "mdls", title: item.title, item, state: null, category: null, source_url: null };
    });
    setup(records, ["mdls"]);
    vi.mocked(rpcPost).mockResolvedValue({ items: records.map((record) => record.item), total: 61 });
    const first = await searchPublishedCorpus('"topic"', 0, 50);
    const second = await searchPublishedCorpus('"topic"', 50, 50);
    expect(first).toMatchObject({ returned: 50, hasMore: true, nativeCandidates: 61, rankedCandidates: 61 });
    expect(second).toMatchObject({ returned: 11, hasMore: false, nativeCandidates: 61, rankedCandidates: 61 });
    expect(new Set([...first.matches, ...second.matches].map((row) => row.record.id)).size).toBe(61);
    for (const [, body] of vi.mocked(rpcPost).mock.calls) expect(body).toMatchObject({ p_offset: 0, p_filters: {} });
  });

  it("looks up the actual talc MDL's native court only when its directory dataset is published", async () => {
    const item = { id: "mdl:2738", title: "Johnson & Johnson Talcum Powder", mdl_number: 2738, cl_court_id: "njd" };
    const record: SearchRecord = { id: "2738", dataset: "mdls", title: item.title, item, state: null, category: null, source_url: null };
    setup([record], ["mdls", "court_spine"], [{ id: "njd", state: "NJ" }]);
    vi.mocked(rpcPost).mockResolvedValue({ items: [item], total: 1 });
    const result = await searchPublishedCorpus("talc", 0, 50);
    expect(result.matches[0]).toMatchObject({ state: "NJ", stateBasis: "exact_court_location" });
    expect(restGet).toHaveBeenCalledWith(expect.stringContaining("dataset=eq.court_spine&id=in."));
    vi.resetAllMocks();
    setup([record], ["mdls"]);
    vi.mocked(rpcPost).mockResolvedValue({ items: [item], total: 1 });
    const held = await searchPublishedCorpus("talc", 0, 50);
    expect(held.matches[0]).toMatchObject({ state: null, stateBasis: null });
    expect(vi.mocked(restGet).mock.calls.some(([path]) => path.includes("dataset=eq.court_spine"))).toBe(false);
  });
});
