import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildEntityView, nameKey, possibleDuplicates } from "@/lib/external/entityView";
import { countBy, coverageMatrix, jurisdictionLabel, parseRegistry } from "./registry";

const text = readFileSync("public/data/registry_v06_1.jsonl", "utf8");

describe("registry", () => {
  const { entries, invalidLines } = parseRegistry(text);
  it("parses every real line and keeps raw bytes", () => {
    expect(entries.length).toBe(9348);
    expect(invalidLines).toBe(0);
    expect(JSON.parse(entries[0]!.raw).id).toBe(entries[0]!.id);
  });
  it("groups by jurisdiction and category", () => {
    expect(countBy(entries, (e) => e.jurisdiction).find(([j]) => j === "mn")?.[1]).toBe(390);
    expect(jurisdictionLabel("mn")).toBe("Minnesota");
    expect(jurisdictionLabel("us")).toBe("Federal / national");
    const m = coverageMatrix(entries);
    expect(m.categories).toContain("court_forms");
    for (const r of m.rows) expect(r.total + 0).toBe([...r.counts.values()].reduce((a, b) => a + b, 0));
  });
});

describe("entity view", () => {
  it("builds sections from structured detail without inventing values", () => {
    const v = buildEntityView({ id: "x", name: "Jane Roe", role: "Judge", courts: ["A Court"], education: [{ text: "J.D." }], documents: [], mdls: { link: "#mdl-appearances?x=1", total: 0, results: [] }, career_note: "note" });
    expect(v.title).toBe("Jane Roe");
    expect(v.facts).toContainEqual(["Role", "Judge"]);
    expect(v.sections.find((s) => s.key === "education")?.kind).toBe("list");
    expect(v.empty).toEqual(expect.arrayContaining(["Documents", "MDL appearances"]));
    expect(v.technical.length).toBe(1);
  });
  it("normalizes names only for grouping", () => {
    expect(nameKey("Hon. John  Smith, Jr.")).toBe("john smith");
    expect(possibleDuplicates([{ title: "John Smith" }, { title: "JOHN SMITH Jr." }, { title: "Ann Lee" }])).toHaveLength(1);
  });
});
