import { describe, expect, it } from "vitest";

import { computeStats, facet, parseBundle } from "./bundle";
import type { Bundle, Source } from "./types";

function source(overrides: Partial<Source> & { id: string; url: string }): Source {
  return {
    title: "Untitled",
    domain: "example.gov",
    jurisdiction: "Federal",
    heading_category: "Dockets",
    source_family: "Federal dockets",
    occurrences: 1,
    ...overrides,
  } as Source;
}

const minimal = {
  bundle_version: "V2.2A",
  sources: [
    { id: "s1", url: "https://a.gov/p?x=1#/h", title: "A", domain: "a.gov", occurrences: 2 },
    { id: "s2", url: "https://b.gov/q", title: "B", domain: "b.gov", occurrences: 3 },
  ],
};

describe("parseBundle", () => {
  it("accepts a minimal valid bundle and defaults optional collections", () => {
    const result = parseBundle(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.sources).toHaveLength(2);
    expect(result.bundle.endpoint_candidates).toEqual([]);
    expect(result.bundle.promotion_records).toEqual([]);
  });

  it("preserves the exact URL including query string and hash route", () => {
    const result = parseBundle(minimal);
    expect(result.ok && result.bundle.sources[0]!.url).toBe("https://a.gov/p?x=1#/h");
  });

  it("rejects a payload without a sources array", () => {
    const result = parseBundle({ bundle_version: "V2.2A" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/sources/);
  });

  it("rejects source rows missing an id or url", () => {
    const result = parseBundle({ sources: [{ title: "no id" }] });
    expect(result.ok).toBe(false);
  });

  it("does not fabricate counts: an empty bundle reports zeros and warns", () => {
    const result = parseBundle({ bundle_version: "V2.2A", sources: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.distinctSources).toBe(0);
    expect(result.stats.totalOccurrences).toBe(0);
    expect(result.warnings.join(" ")).toMatch(/zero source rows/);
  });

  it("warns about duplicate ids and repeated URLs", () => {
    const result = parseBundle({
      sources: [
        { id: "s1", url: "https://a.gov/p" },
        { id: "s1", url: "https://a.gov/p" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/duplicate source id/);
    expect(result.warnings.join(" ")).toMatch(/repeat an exact URL/);
  });

  it("keeps unknown imported fields instead of dropping them", () => {
    const result = parseBundle({
      sources: [{ id: "s1", url: "https://a.gov", extra_imported_field: "keep me" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.bundle.sources[0] as Record<string, unknown>)['extra_imported_field']).toBe("keep me");
  });
});

describe("computeStats", () => {
  it("counts distinct URLs, not rows, and sums occurrences", () => {
    const bundle = {
      bundle_version: "V2.2A",
      sources: [
        source({ id: "a", url: "https://x.gov/1", occurrences: 4 }),
        source({ id: "b", url: "https://x.gov/1", occurrences: 2 }),
        source({ id: "c", url: "https://x.gov/2", occurrences: 1, jurisdiction: "Cal." }),
      ],
      endpoint_candidates: [],
      source_families: [],
      promotion_records: [],
    } as unknown as Bundle;

    const stats = computeStats(bundle);
    expect(stats.distinctSources).toBe(2);
    expect(stats.totalOccurrences).toBe(7);
    expect(stats.jurisdictions).toBe(2);
    expect(stats.domains).toBe(1);
  });
});

describe("facet", () => {
  it("groups values with counts and labels blanks", () => {
    const rows = [
      source({ id: "a", url: "u1", jurisdiction: "Federal", occurrences: 2 }),
      source({ id: "b", url: "u2", jurisdiction: "Federal", occurrences: 1 }),
      source({ id: "c", url: "u3", jurisdiction: "", occurrences: 5 }),
    ];
    const facets = facet(rows, "jurisdiction");
    expect(facets[0]).toEqual({ value: "Federal", count: 2, occurrences: 3 });
    expect(facets[1]).toEqual({ value: "(unspecified)", count: 1, occurrences: 5 });
  });
});
