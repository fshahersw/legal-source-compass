import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryPublishedDataset } from "./catalog.reads.server";
import { restGet, rpcPost } from "./rest.server";

vi.mock("./rest.server", () => ({ restGet: vi.fn(), rpcPost: vi.fn() }));

describe("authoritative corpus listing", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["open_us_law", "court_spine"])(
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
