import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./rest.server", () => ({ rpcPost: rpc }));
import { readStateDirectoryPage } from "./stateDirectory.reads.server";
describe("bounded state-scoped directory reads", () => {
  beforeEach(() => rpc.mockReset());
  it("uses USPS for court filtering and never asks for an entire national directory", async () => {
    rpc.mockResolvedValue({
      items: [
        {
          id: "ned",
          title: "District Court, D. Nebraska",
          cells: { state: "NE", system: "Federal" },
          subtitle: "Federal district",
        },
      ],
    });
    const result = await readStateDirectoryPage("court_spine", "NE", 0);
    expect(rpc).toHaveBeenCalledWith(
      "corpus_query_bounded",
      expect.objectContaining({
        p_dataset: "court_spine",
        p_filters: { state: "NE" },
        p_limit: 500,
        p_offset: 0,
      }),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.nextOffset).toBeNull();
  });
  it("uses the source's full state name for judge filtering", async () => {
    rpc.mockResolvedValue({
      items: [
        {
          id: "record-1",
          name: "Test profile",
          states: ["Nebraska"],
          systems: ["federal"],
          courts: [],
        },
      ],
    });
    const result = await readStateDirectoryPage("judges", "NE", 0);
    expect(rpc).toHaveBeenCalledWith(
      "corpus_query_bounded",
      expect.objectContaining({ p_filters: { state: "Nebraska" } }),
    );
    expect(result.rows).toHaveLength(1);
  });
  it("rejects a wrongly scoped upstream response instead of showing Nevada in Nebraska", async () => {
    rpc.mockResolvedValue({
      items: [{ id: "nvd", title: "Nevada", cells: { state: "NV", system: "Federal" } }],
    });
    await expect(readStateDirectoryPage("court_spine", "NE", 0)).rejects.toThrow(/jurisdiction/);
  });
  it("does not send a query for an unknown state", async () => {
    await expect(readStateDirectoryPage("judges", "ZZ", 0)).rejects.toThrow(/state/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects an oversized reply", async () => {
    rpc.mockResolvedValue({
      items: Array.from({ length: 501 }, (_, i) => ({ id: String(i), cells: { state: "NE" } })),
    });
    await expect(readStateDirectoryPage("court_spine", "NE", 0)).rejects.toThrow(/oversized/);
  });
});
