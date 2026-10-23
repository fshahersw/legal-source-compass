import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileTable, extractCitations, extractPages } from "./engine";
import { PATTERNS } from "./patterns.data";
import type { Citation, PatternTable } from "./types";

/**
 * The Python engine (scripts/citations_v2/engine.py) wrote fixtures/golden.json; scripts/citations_v2/test_citations_v2.py
 * checks the Python engine against the same file. When this suite fails, the two engines disagree: fix the engine that
 * changed (or regenerate with make_golden.py after reviewing the Python output).
 */
const golden = JSON.parse(
  readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"),
) as {
  pattern_version: string;
  texts: { id: string; text: string; expected: Citation[] }[];
  documents: { id: string; pages: string[]; expected: Citation[][] }[];
};
const table = JSON.parse(
  readFileSync(new URL("./patterns.json", import.meta.url), "utf8"),
) as PatternTable;

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("pattern table", () => {
  it("the TypeScript module holds exactly patterns.json", () => {
    expect(plain(PATTERNS)).toEqual(table);
  });

  it("every rule compiles as a JavaScript RegExp and covers every kind", () => {
    const c = compileTable(PATTERNS);
    expect(c.rules.length).toBe(PATTERNS.rules.length);
    const kinds = new Set(PATTERNS.rules.map((r) => r.kind));
    for (const k of [
      "case",
      "usc",
      "cfr",
      "federal_register",
      "statutes_at_large",
      "public_law",
      "constitution_us",
      "constitution_state",
      "federal_rule",
      "local_rule",
      "state_statute",
      "state_regulation",
      "mdl",
      "docket",
      "short",
    ])
      expect(kinds.has(k)).toBe(true);
  });

  it("covers the 50 states and D.C. for statutes and regulations", () => {
    const states = (kind: string) =>
      new Set(PATTERNS.rules.filter((r) => r.kind === kind).map((r) => r.state));
    expect(states("state_statute").size).toBe(51);
    expect(states("state_regulation").size).toBe(51);
  });

  it("golden fixture was written from this table version", () => {
    expect(golden.pattern_version).toBe(PATTERNS.version);
    expect(golden.texts.length).toBeGreaterThanOrEqual(25);
  });
});

describe("golden fixture (identical to the Python engine)", () => {
  it.each(golden.texts.map((t) => [t.id, t] as const))("%s", (_id, t) => {
    expect(plain(extractCitations(t.text))).toEqual(t.expected);
  });

  it.each(golden.documents.map((d) => [d.id, d] as const))("document %s", (_id, d) => {
    expect(plain(extractPages(d.pages))).toEqual(d.expected);
  });

  it("offsets are code points: matched is the code-point slice of the input", () => {
    const astral = golden.texts.find((t) => t.id === "astral")!;
    const cps = [...astral.text];
    for (const c of extractCitations(astral.text))
      expect(cps.slice(c.start, c.end).join("")).toBe(c.matched);
  });
});

describe("behaviour", () => {
  it("never reads short forms as full citations and links them to the antecedent", () => {
    const list = extractCitations(
      "Bell Atl. Corp. v. Twombly, 550 U.S. 544 (2007). Id. at 555. 550 U.S. at 570.",
    );
    expect(list.map((c) => [c.form, c.key])).toEqual([
      ["full", "case:550:U.S.:544"],
      ["short", "case:550:U.S.:544"],
      ["short", "case:550:U.S.:544"],
    ]);
  });

  it("does not take numbers around ordinary words as reporters", () => {
    expect(
      extractCitations(
        "On 5 May 2020 the 3 Defendants paid 12 dollars; 100 NE 2nd Ave; 25 Black 3 sold.",
      ),
    ).toEqual([]);
  });

  it("keeps an MDL number a mention and a docket number distinct", () => {
    const list = extractCitations("MDL No. 2738 (No. 3:16-md-2738)");
    expect(list.map((c) => c.kind)).toEqual(["mdl", "docket"]);
  });
});
