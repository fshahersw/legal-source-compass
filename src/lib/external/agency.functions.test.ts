import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgencyCounts, type AgencyCounts } from "./agency.functions";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("./rest.server", () => ({ rpcPost: rpc, restGet: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    handler: (handler: unknown) => handler,
    inputValidator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));
const read = getAgencyCounts as unknown as (input: {
  data: { id: string };
}) => Promise<AgencyCounts>;

beforeEach(() => vi.clearAllMocks());

describe("agency count read contract", () => {
  it("preserves zero, capped counts and unrecorded totals as distinct results", async () => {
    rpc.mockImplementation(async (_name, input) => {
      const type = input.p_filters.type;
      return type === "Rule"
        ? { total: 0, total_capped: false }
        : type === "Notice"
          ? { total: 1_000_000, total_capped: true }
          : { total: null, total_capped: false };
    });
    expect(await read({ data: { id: "199" } })).toEqual({
      Rule: { total: 0, capped: false },
      "Proposed Rule": { total: null, capped: false },
      Notice: { total: 1_000_000, capped: true },
    });
    expect(rpc).toHaveBeenCalledWith(
      "corpus_query_bounded",
      expect.objectContaining({
        p_filters: { agency: "199", type: "Rule" },
        p_limit: 1,
      }),
    );
  });

  it("surfaces a failed read so the UI can retry instead of claiming a capped total", async () => {
    rpc.mockImplementation(async (_name, input) => {
      if (input.p_filters.type === "Notice") throw new Error("Read failed");
      return { total: 2, total_capped: false };
    });
    await expect(read({ data: { id: "199" } })).rejects.toThrow("Read failed");
  });
});
