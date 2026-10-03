import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectDirectoryPages, directoryPageInput, DIRECTORY_PAGE_SIZE } from "./directoryPaging";
import { readDirectoryPage } from "./directory.reads.server";
import { rpcPost } from "./rest.server";

vi.mock("./rest.server", () => ({ rpcPost: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

describe("directory network pages", () => {
  it.each([-1, 0.5, 1, 100001, Infinity])("rejects invalid/unaligned offset %s", (offset) => {
    expect(() => directoryPageInput.parse({ offset })).toThrow();
  });
  it("allows a bounded aligned page offset", () => {
    expect(directoryPageInput.parse({ offset: 500 })).toEqual({ offset: 500 });
  });
  it("makes exactly one publication-gated 500-row read", async () => {
    vi.mocked(rpcPost).mockResolvedValue({
      items: [
        {
          id: "court:offline",
          title: "Offline court",
          cells: { state: "NJ", system: "Federal" },
          subtitle: "Federal district",
        },
      ],
    });
    const page = await readDirectoryPage("court_spine", 500);
    expect(rpcPost).toHaveBeenCalledTimes(1);
    expect(rpcPost).toHaveBeenCalledWith(
      "corpus_query_bounded",
      expect.objectContaining({ p_dataset: "court_spine", p_limit: 500, p_offset: 500 }),
    );
    expect(page.rows[0]).toMatchObject({ id: "court:offline", state: "NJ" });
    expect(page.nextOffset).toBeNull();
  });
  it("refuses an oversized provider result instead of exposing it", async () => {
    vi.mocked(rpcPost).mockResolvedValue({
      items: Array.from({ length: 501 }, (_, id) => ({ id })),
    });
    await expect(readDirectoryPage("judges", 0)).rejects.toThrow("oversized page");
  });
  it("indicates a continuation when the page is full", async () => {
    vi.mocked(rpcPost).mockResolvedValue({
      items: Array.from({ length: 500 }, (_, id) => ({ id, name: "Offline judge" })),
    });
    expect((await readDirectoryPage("judges", 500)).nextOffset).toBe(1000);
  });
});

describe("browser folder aggregation", () => {
  it("assembles pages in source order and stops after the terminal page", async () => {
    const page = vi.fn(async ({ data }: { data: { offset: number } }) => ({
      rows:
        data.offset === 0
          ? Array.from({ length: 500 }, (_, id) => id)
          : data.offset === 500
            ? [500, 501]
            : [],
      nextOffset: data.offset === 0 ? 500 : null,
      pageSize: DIRECTORY_PAGE_SIZE,
    }));
    expect(await collectDirectoryPages(page, 40000)).toEqual(
      Array.from({ length: 502 }, (_, id) => id),
    );
    expect(page).toHaveBeenCalledTimes(6);
  });
  it("does not display silently truncated full-directory counts when the safety cap is reached", async () => {
    const page = vi.fn(async ({ data }: { data: { offset: number } }) => ({
      rows: Array.from({ length: 500 }, (_, id) => data.offset + id),
      nextOffset: data.offset + 500,
      pageSize: DIRECTORY_PAGE_SIZE,
    }));
    await expect(collectDirectoryPages(page, 1000)).rejects.toThrow(
      "exceeds the folder view's limit",
    );
    expect(page).toHaveBeenCalledTimes(2);
  });
  it("propagates an auth/page failure instead of showing a partial inventory", async () => {
    const page = vi.fn().mockRejectedValue(new Error("Access denied"));
    await expect(collectDirectoryPages(page, 1000)).rejects.toThrow("Access denied");
  });
});
