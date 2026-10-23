import { beforeEach, describe, expect, it, vi } from "vitest";

const restGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/external/rest.server", () => ({ restGet }));

import { countRows, jsonPath, mapLimit, readAllRows } from "./tally.server";

beforeEach(() => {
  restGet.mockReset();
});

describe("mapLimit", () => {
  it("keeps input order and never runs more than `limit` calls at once", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5 - (n % 3)));
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
  it("handles an empty list", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe("readAllRows", () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ n: i }));
  it("reads the first page with a count, then the rest by range, and returns every row in order", async () => {
    restGet.mockImplementation(
      async (_path: string, opts: { count?: boolean; range: [number, number] }) => ({
        rows: rows.slice(opts.range[0], opts.range[1] + 1),
        total: opts.count ? rows.length : null,
      }),
    );
    const out = await readAllRows<{ n: number }>("corpus_records?select=n&order=ordinal.asc");
    expect(out).toHaveLength(2500);
    expect(out[0]).toEqual({ n: 0 });
    expect(out[2499]).toEqual({ n: 2499 });
    expect(restGet).toHaveBeenCalledTimes(3);
    expect(restGet.mock.calls[0]![1]).toEqual({ count: true, range: [0, 999] });
    expect(
      restGet.mock.calls.map((c) => c[1].range[0]).sort((a: number, b: number) => a - b),
    ).toEqual([0, 1000, 2000]);
  });
  it("fails loudly when the corpus reports no total, a total over the limit, or a different row count", async () => {
    restGet.mockResolvedValueOnce({ rows: [{ n: 1 }], total: null });
    await expect(readAllRows("p")).rejects.toThrow("did not report a row total");
    restGet.mockResolvedValueOnce({ rows: [], total: 70000 });
    await expect(readAllRows("p")).rejects.toThrow("exceeds the read limit");
    restGet.mockImplementation(async (_p: string, opts: { count?: boolean }) => ({
      rows: opts.count ? Array.from({ length: 1000 }, () => ({})) : [],
      total: opts.count ? 1500 : null,
    }));
    await expect(readAllRows("p")).rejects.toThrow("Read 1000 rows but the corpus reported 1500");
  });
  it("propagates a failed page instead of returning a short list", async () => {
    restGet.mockResolvedValueOnce({ rows: Array.from({ length: 1000 }, () => ({})), total: 1500 });
    restGet.mockRejectedValueOnce(new Error("External corpus read failed (500)."));
    await expect(readAllRows("p")).rejects.toThrow("failed (500)");
  });
});

describe("countRows", () => {
  it("asks for an exact count of one row and returns the total", async () => {
    restGet.mockResolvedValue({ rows: [{ id: "a" }], total: 4303 });
    expect(await countRows("corpus_records?dataset=eq.congress_bills")).toBe(4303);
    expect(restGet).toHaveBeenCalledWith("corpus_records?dataset=eq.congress_bills&select=id", {
      count: true,
      range: [0, 0],
    });
  });
  it("is an error, never a zero, when no total comes back", async () => {
    restGet.mockResolvedValue({ rows: [], total: null });
    await expect(countRows("corpus_records?x=1")).rejects.toThrow("did not report a row count");
  });
  it("counts zero when the corpus reports zero", async () => {
    restGet.mockResolvedValue({ rows: [], total: 0 });
    expect(await countRows("corpus_records?x=1")).toBe(0);
  });
});

describe("jsonPath", () => {
  it("encodes a JSON path for use as a filter name", () => {
    expect(jsonPath("filters->>report_date")).toBe("filters-%3E%3Ereport_date");
  });
});
