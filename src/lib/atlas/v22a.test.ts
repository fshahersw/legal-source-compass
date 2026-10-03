import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { facet, parseBundle } from "./bundle";
import { filterSources, defaultFilters } from "./filters";
import { checkMetaClaims } from "./v22a";

const PATH = resolve(__dirname, "../../../private/data/atlas-import-bundle.json");
const has = existsSync(PATH);
if (!has) throw new Error(`Bundled real dataset missing at ${PATH}`);

describe("real V2.2A bundle", () => {
  const raw = has ? JSON.parse(readFileSync(PATH, "utf8")) : null;
  const res = has ? parseBundle(raw) : null;

  it("parses and counts rows from the file itself", () => {
    expect(res?.ok).toBe(true);
    if (!res?.ok) return;
    const checks = checkMetaClaims(raw.meta, {
      sources: res.stats.distinctSources,
      occurrences: res.stats.totalOccurrences,
      endpoints: res.stats.endpointCandidates,
      families: res.stats.sourceFamilies,
      promotions: res.stats.promotionRecords,
    });
    expect(checks.every((c) => c.match)).toBe(true);
    expect(res.stats.distinctSources).toBe(new Set(raw.directorySources.map((s: { url: string }) => s['url'])).size);
  });

  it("preserves URLs and original fields exactly", () => {
    if (!res?.ok) throw new Error("parse failed");
    raw.directorySources.forEach((s: Record<string, unknown>, i: number) => {
      const out = res.bundle.sources[i] as Record<string, unknown>;
      expect(out['url']).toBe(s['url']);
      expect(out['categories']).toEqual(s['categories']);
      expect(out['jurisdictions']).toEqual(s['jurisdictions']);
      expect(out['occurrence_records']).toEqual(s['occurrences']);
    });
  });

  it("filters multi-valued jurisdictions", () => {
    if (!res?.ok) throw new Error("parse failed");
    const j = facet(res.bundle.sources, "jurisdiction").find((f) => f.value !== "(unspecified)")!;
    const hits = filterSources(res.bundle.sources, { ...defaultFilters, jurisdictions: [j.value] }, { overlays: {}, bookmarks: {} });
    expect(hits.length).toBe(j.count);
  });
});
