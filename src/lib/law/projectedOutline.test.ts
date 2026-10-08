import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { fn: string; body: Record<string, unknown> }[] = [];
let answer: (fn: string) => unknown = () => null;

vi.mock("@/lib/external/rest.server", () => ({
  ilikeTerm: (s: string) => s,
  restGet: vi.fn(async () => []),
  rpcPost: vi.fn(async () => null),
  rpcPostOptional: vi.fn(async (fn: string, body: Record<string, unknown>) => {
    calls.push({ fn, body });
    const out = answer(fn);
    if (out instanceof Error) throw out;
    return out;
  }),
}));

const v3Groups = {
  available: true,
  kind: "groups",
  level: "chapter",
  total: 2,
  truncated: false,
  groups: [
    { level: "chapter", number: "55", heading: "Limitation of Time", count: 2 },
    { level: "subpart", number: null, heading: null, count: 1 },
  ],
  direct_sections: [],
  direct_total: 0,
  direct_truncated: false,
};

const v2Groups = {
  available: true,
  kind: "groups",
  level: "subpart",
  total: 0,
  truncated: false,
  groups: [],
  direct_sections: [],
  direct_total: 0,
  direct_truncated: false,
};

const path = [
  { level: "title", number: "42" },
  { level: "part", number: "VI" },
];

describe("projectedOutline read preference", () => {
  beforeEach(() => {
    calls.length = 0;
    vi.resetModules();
  });

  it("uses projection/3 when it exists and keeps each group's own level", async () => {
    answer = (fn) => (fn.endsWith("_v3") ? v3Groups : v2Groups);
    const { projectedOutline } = await import("./stateCodeCatalog.server");
    const out = await projectedOutline("PA", path);
    expect(calls.map((c) => c.fn)).toEqual(["corpus_publisher_code_projected_outline_v3"]);
    expect(out).toMatchObject({ available: true, kind: "groups", read: "v3", level: "chapter" });
    if (out.available && out.kind === "groups") {
      expect(out.groups.map((g) => g.level)).toEqual(["chapter", "subpart"]);
      expect(out.groups[1]?.number).toBeNull();
    }
  });

  it("falls back to projection/2 only when projection/3 is not installed, and remembers that", async () => {
    answer = (fn) => (fn.endsWith("_v3") ? null : v2Groups);
    const { projectedOutline } = await import("./stateCodeCatalog.server");
    const first = await projectedOutline("PA", path);
    const second = await projectedOutline("PA", path);
    expect(first).toMatchObject({ available: true, kind: "groups", read: "v2", level: "subpart" });
    expect(second).toMatchObject({ read: "v2" });
    expect(calls.map((c) => c.fn)).toEqual([
      "corpus_publisher_code_projected_outline_v3",
      "corpus_publisher_code_projected_outline_v2",
      "corpus_publisher_code_projected_outline_v2",
    ]);
    if (first.available && first.kind === "groups") {
      expect(first.groups).toEqual([]);
    }
  });

  it("reports a path projection/2 rejects as unsupported instead of failing the page", async () => {
    answer = (fn) =>
      fn.endsWith("_v3") ? null : new Error("External corpus read failed (400).");
    const { projectedOutline } = await import("./stateCodeCatalog.server");
    const out = await projectedOutline("PA", [...path, { level: "chapter", number: "55" }]);
    expect(out).toEqual({ available: true, kind: "unsupported_path" });
  });

  it("does not hide other failures or the root read behind the unsupported label", async () => {
    answer = (fn) =>
      fn.endsWith("_v3") ? null : new Error("External corpus read failed (500).");
    const { projectedOutline } = await import("./stateCodeCatalog.server");
    await expect(projectedOutline("PA", path)).rejects.toThrow("(500)");
    answer = (fn) =>
      fn.endsWith("_v3") ? null : new Error("External corpus read failed (400).");
    await expect(projectedOutline("PA", [])).rejects.toThrow("(400)");
  });

  it("returns not available for a state outside the public projection", async () => {
    answer = () => ({ available: false, reason: "not_projected" });
    const { projectedOutline } = await import("./stateCodeCatalog.server");
    expect(await projectedOutline("GA", [])).toEqual({ available: false });
  });
});
