import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/external/rest.server", () => ({
  restGet: vi.fn(async () => {
    throw new Error("no network in unit tests");
  }),
}));

import { SECTIONS, SECTION_IDS, defineSource } from "./registry";
import { makeInsight } from "./build";

describe("SECTIONS", () => {
  it("covers the seven analytics sections with unique ids", () => {
    expect([...SECTION_IDS]).toEqual([
      "state",
      "court",
      "judge",
      "mdl",
      "enforcement",
      "safety",
      "payments",
    ]);
    expect(new Set(SECTION_IDS).size).toBe(SECTIONS.length);
  });

  it("gives every section a title, a chart link label and at least one source", () => {
    for (const s of SECTIONS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.chartsLabel).toMatch(/^Open .+ charts$/);
      expect(s.sources.length).toBeGreaterThan(0);
    }
  });

  it("namespaces source ids by section and keeps them unique", () => {
    const all = SECTIONS.flatMap((s) => s.sources.map((x) => ({ section: s.id, id: x.id })));
    for (const x of all) expect(x.id.startsWith(`${x.section}.`)).toBe(true);
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
  });

  it("links each section to a route that exists", () => {
    const tree = readFileSync("src/routeTree.gen.ts", "utf8");
    for (const s of SECTIONS) {
      expect(s.href.startsWith("/")).toBe(true);
      expect(tree, `${s.href} is not in the route tree`).toContain(`'${s.href}'`);
    }
  });
});

describe("defineSource", () => {
  const insight = makeInsight({
    section: "court",
    slug: "x",
    kind: "trend",
    headline: "H",
    summary: ["One.", "Two."],
    points: [
      { label: "a", value: "1" },
      { label: "b", value: "2" },
      { label: "c", value: "3" },
    ],
    sources: [{ label: "S", href: "https://example.gov/" }],
    score: 1,
  })!;

  it("yields no candidates when the dataset is not published (reader returns null)", async () => {
    const gen = vi.fn(() => [insight]);
    const src = defineSource("court.x", async () => null, gen);
    expect(await src.run()).toEqual([]);
    expect(gen).not.toHaveBeenCalled();
  });

  it("passes the read data to the generator", async () => {
    const src = defineSource(
      "court.x",
      async () => ({ n: 2 }),
      (d) => (d.n === 2 ? [insight] : []),
    );
    expect(await src.run()).toEqual([insight]);
  });

  it("lets a read failure reject so the pipeline can drop only this source", async () => {
    const src = defineSource<number>(
      "court.x",
      async () => {
        throw new Error("db down");
      },
      () => [],
    );
    await expect(src.run()).rejects.toThrow("db down");
  });
});

describe("registered sources against an unreachable database", () => {
  it("each rejects instead of returning invented data", async () => {
    for (const s of SECTIONS)
      for (const src of s.sources) await expect(src.run(), src.id).rejects.toThrow();
  });
});
