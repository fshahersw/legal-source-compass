import { describe, expect, it } from "vitest";
import { BLOCKS, BLOCK_GROUPS, BLOCK_IDS, blockDef, blocksInGroup } from "./registry";
import { READER_IDS } from "./overview.server";

describe("Analytics block registry", () => {
  it("has unique block ids and every block in a known group", () => {
    expect(new Set(BLOCK_IDS).size).toBe(BLOCKS.length);
    const groups = new Set(BLOCK_GROUPS.map((g) => g.id));
    for (const b of BLOCKS) expect(groups.has(b.group), b.id).toBe(true);
  });
  it("gives every group at least one block and keeps the registry order within it", () => {
    for (const g of BLOCK_GROUPS) expect(blocksInGroup(g.id).length, g.id).toBeGreaterThan(0);
    expect(blocksInGroup("courts").map((b) => b.id)).toEqual([
      "federal-civil",
      "federal-criminal",
      "mdl-pending",
      "securities-class-actions",
    ]);
  });
  it("covers the domains the owner asked for", () => {
    const ids = BLOCKS.map((b) => b.id);
    for (const required of [
      "federal-civil",
      "federal-criminal",
      "mdl-pending",
      "doj-press",
      "sec-releases",
      "ftc-actions",
      "epa-cases",
      "osha-inspections",
      "cpsc-recalls",
      "nhtsa-recalls",
      "fsis-recalls",
      "fda-recalls",
      "faers",
      "cfpb-complaints",
      "ftc-sentinel",
      "federal-register",
      "judicial-vacancies",
      "judicial-nominations",
      "congress-bills",
    ])
      expect(ids, required).toContain(required);
  });
  it("links every block to an in-app page with a root-relative path and no query string", () => {
    for (const b of BLOCKS) {
      expect(b.detail.to, b.id).toMatch(/^\/[a-z0-9/_-]*$/i);
      expect(b.detail.label.length, b.id).toBeGreaterThan(2);
    }
  });
  it("has a title that says what is counted and a measure for the accessible description", () => {
    for (const b of BLOCKS) {
      expect(b.title.length, b.id).toBeGreaterThan(10);
      expect(b.measure.length, b.id).toBeGreaterThan(3);
    }
  });
  it("has a server reader for exactly the registered blocks", () => {
    expect([...READER_IDS].sort()).toEqual([...BLOCK_IDS].sort());
  });
  it("looks a block up by id", () => {
    expect(blockDef("doj-press")?.group).toBe("enforcement");
    expect(blockDef("nope")).toBeUndefined();
  });
});
