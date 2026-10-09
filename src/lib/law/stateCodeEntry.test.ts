import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  optional: vi.fn(),
  rest: vi.fn(),
  names: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/external/rest.server", () => ({
  rpcPostOptional: mocks.optional,
  rpcPost: vi.fn(),
  restGet: mocks.rest,
  ilikeTerm: (s: string) => s,
}));
vi.mock("@/lib/private-data/snapshot.server", () => ({
  listSnapshotNames: mocks.names,
  readPrivateSnapshot: mocks.snapshot,
}));
import { stateCodeEntry } from "./stateCodeCatalog.server";
describe("state landing code summary does not depend on unrelated private snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.optional.mockResolvedValue([
      {
        jurisdiction: "NE",
        code_title: "Nebraska Revised Statutes",
        sections: 100,
        structure_levels: ["chapter", "section"],
      },
    ]);
    mocks.names.mockReturnValue([]);
    mocks.rest.mockResolvedValue({ rows: [] });
  });
  it("returns a recorded published Nebraska source before any Texas snapshot fetch", async () => {
    const rows = await stateCodeEntry("NE");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("NE");
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("cannot substitute a different state's published source", async () => {
    const rows = await stateCodeEntry("NV");
    expect(rows.every((r) => r.state === "NV")).toBe(true);
    expect(rows).toEqual([]);
  });
  it("rejects invalid state identity before querying", async () => {
    await expect(stateCodeEntry("ZZ")).rejects.toThrow(/state/i);
    expect(mocks.optional).not.toHaveBeenCalled();
  });
});
