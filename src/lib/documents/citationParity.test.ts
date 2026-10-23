import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractCitations } from "@/lib/assistant/citations";

/**
 * The document extractor (scripts/documents/citations.py) is a port of this parser and is tested against the same fixture.
 * When this test fails, the TypeScript parser changed: regenerate the fixture and make the Python port match again.
 */
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../scripts/documents/fixtures/citation_parity.json", import.meta.url),
    "utf8",
  ),
) as { cases: { text: string; expected: unknown[] }[] };

describe("citation parser parity fixture", () => {
  it("holds a meaningful set of texts", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
    expect(fixture.cases.reduce((n, c) => n + c.expected.length, 0)).toBeGreaterThanOrEqual(30);
  });

  it.each(fixture.cases.map((c, i) => [i, c] as const))("text %i reads the same", (_i, c) => {
    expect(JSON.parse(JSON.stringify(extractCitations(c.text, 200)))).toEqual(c.expected);
  });
});
