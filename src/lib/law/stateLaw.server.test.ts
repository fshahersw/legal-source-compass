import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ optional: vi.fn() }));
vi.mock("@/lib/external/rest.server", () => ({
  rpcPostOptional: mocks.optional,
  rpcPost: vi.fn(),
  restGet: vi.fn(),
}));

import { stateLawSearch, stateLawSection, stateLawTree } from "./stateLaw.server";

describe("state-law server reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a missing contract instead of failing the page", async () => {
    mocks.optional.mockResolvedValue(null);
    expect(await stateLawTree("FL", null)).toEqual({ available: false, reason: "not_installed" });
    expect(await stateLawSection("FL", "FL:FS:95.11")).toEqual({
      available: false,
      reason: "not_installed",
      edition: null,
    });
    expect(await stateLawSearch("FL", "limitations")).toEqual({
      available: false,
      reason: "not_installed",
    });
  });

  it("passes bounded, typed arguments to the RPCs", async () => {
    mocks.optional.mockResolvedValue({ available: true, total: 0, hits: [], exact: null });
    await stateLawSearch("FL", "statute of limitations", 20, "in_force");
    expect(mocks.optional).toHaveBeenCalledWith("state_law_search_v1", {
      p_state: "FL",
      p_q: "statute of limitations",
      p_limit: 20,
      p_offset: 20,
      p_status: "in_force",
    });
    mocks.optional.mockResolvedValue({ available: false, reason: "no_edition" });
    expect(await stateLawTree("TX", "TX:PE", 0)).toEqual({
      available: false,
      reason: "no_edition",
    });
    expect(mocks.optional).toHaveBeenLastCalledWith("state_law_tree_v1", {
      p_state: "TX",
      p_node_id: "TX:PE",
      p_limit: 400,
      p_offset: 0,
    });
  });
});
