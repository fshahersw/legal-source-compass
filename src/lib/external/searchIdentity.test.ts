import { describe, expect, it } from "vitest";
import {
  candidateRecordIds,
  candidateIdChunks,
  inFilter,
  resolveSearchIdentities,
  type SearchRecord,
} from "./searchIdentity";

const record = (dataset: string, item: Record<string, unknown>): SearchRecord => ({
  dataset,
  id: String(item["id"]),
  item,
  title: String(item["title"]),
  state: null,
  source_url: null,
  category: null,
});

describe("global search identity", () => {
  it("distinguishes reused ids by the exact native item and keeps search order", () => {
    const court = {
      id: "1",
      title: "Court",
      cells: { system: "Federal", state: "CA" },
    };
    const notice = { id: "1", title: "Notice", cells: { year: 2025 } };
    const r = resolveSearchIdentities(
      [notice, { cells: { state: "CA", system: "Federal" }, title: "Court", id: "1" }],
      [record("court_spine", court), record("federal_register_history", notice)],
    );
    expect(r.matches.map((m) => m.record.dataset)).toEqual([
      "federal_register_history",
      "court_spine",
    ]);
    expect(r.unresolved).toBe(0);
  });
  it("does not guess a dataset from a matching id or title", () => {
    const item = {
      id: "1",
      title: "Same title",
      cells: { date: "2026-01-01" },
    };
    expect(
      resolveSearchIdentities([item], [record("other", { ...item, cells: { date: "2025-01-01" } })])
        .unresolved,
    ).toBe(1);
  });
  it("keeps identical records from distinct datasets as separate identities", () => {
    const item = { id: "1", title: "Same" };
    const r = resolveSearchIdentities([item, item], [record("a", item), record("b", item)]);
    expect(r.matches.map((m) => m.record.dataset)).toEqual(["a", "b"]);
  });
  it("does not choose arbitrarily when a page has only part of an identical-item group", () => {
    const item = { id: "1", title: "Same" };
    const r = resolveSearchIdentities([item], [record("a", item), record("b", item)]);
    expect(r.matches).toEqual([]);
    expect(r.unresolved).toBe(1);
  });
  it("quotes delimiter-containing ids without changing the literal value", () => {
    expect(decodeURIComponent(inFilter(["a,b)", 'quote"slash\\']))).toBe(
      '("a,b)","quote\\"slash\\\\")',
    );
  });
  it("retrieves a native MDL alias without treating it as identity evidence", () => {
    expect(candidateRecordIds([{ id: "mdl:2738" }])).toEqual(["mdl:2738", "2738"]);
    expect(
      resolveSearchIdentities(
        [{ id: "mdl:2738", title: "Other" }],
        [record("mdls", { id: "mdl:2738", title: "Talc" })],
      ).unresolved,
    ).toBe(1);
  });
  it("keeps long and delimiter-containing identities intact within each encoded URL budget", () => {
    const ids = [
      "a,b)",
      'quote"slash\\',
      ...Array.from({ length: 85 }, (_, index) => `${index}:${"界".repeat(40)}`),
    ];
    const chunks = candidateIdChunks(ids, 1800);
    expect(chunks.flat()).toEqual(ids);
    expect(chunks.every((chunk) => chunk.length <= 40 && inFilter(chunk).length <= 1800)).toBe(
      true,
    );
    expect(() => candidateIdChunks(["界".repeat(40)], 50)).toThrow("bounded lookup path");
  });
});
