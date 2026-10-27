import { describe, expect, it, vi } from "vitest";

const { rpcPost } = vi.hoisted(() => ({
  rpcPost: vi.fn(async () => ({
    states: [
      {
        jurisdiction: "tx",
        public_projection_allowed: true,
        sections: 1200,
        publisher: "Texas Legislative Council",
      },
    ],
  })),
}));
vi.mock("@/lib/external/rest.server", () => ({
  rpcPost,
  rpcPostOptional: vi.fn(),
  restGet: vi.fn(),
  ilikeTerm: (q: string) => q,
}));
vi.mock("@/lib/private-data/snapshot.server", () => ({
  listSnapshotNames: vi.fn(async () => []),
  readPrivateSnapshot: vi.fn(async () => null),
}));

import { stateCodeCoverage } from "./stateCodeCatalog.server";

describe("stateCodeCoverage", () => {
  it("reads the slow coverage RPC once and reuses it for later requests", async () => {
    const a = await stateCodeCoverage();
    const b = await stateCodeCoverage();
    expect(rpcPost).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(a.find((r) => r.state === "TX")?.sections).toBe(1200);
    expect(a.find((r) => r.state === "NY")?.sections).toBeNull();
  });
});
