import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBundle } from "./bundle";
import { summarizeFamilies } from "./families";

const realRaw = JSON.parse(
  readFileSync(resolve(__dirname, "../../../private/data/atlas-import-bundle.json"), "utf8"),
);

describe("summarizeFamilies on the real bundle", () => {
  const res = parseBundle(realRaw);
  if (!res.ok) throw new Error("parse failed");
  const summary = summarizeFamilies(res.bundle);

  it("lists all eight manifest families even without matching directory sources", () => {
    expect(summary.families).toHaveLength(8);
    expect(summary.families.map((f) => f.id).sort()).toEqual(
      realRaw.familyManifest.map((f: { source_family_id: string }) => f.source_family_id).sort(),
    );
  });

  it("computes candidate and promotion counts by family id", () => {
    for (const f of summary.families) {
      const eps = realRaw.endpointCandidates.filter((e: { source_family_id: string }) => e.source_family_id === f.id);
      const pr = realRaw.promotionLedger.filter((p: { source_family_id: string }) => p.source_family_id === f.id);
      expect(f.endpointCandidates).toBe(eps.length);
      expect(f.promotions).toBe(pr.length);
    }
    expect(summary.families.reduce((a, f) => a + f.endpointCandidates, 0)).toBe(258);
  });

  it("accounts for every directory source as linked, ambiguous or unassigned", () => {
    const linked = summary.families.reduce((a, f) => a + f.linkedSources, 0);
    expect(linked + summary.ambiguousSources + summary.unassignedSources).toBe(4633);
  });
});

describe("ambiguous membership", () => {
  it("is labelled, not guessed", () => {
    const res = parseBundle({
      meta: { sourceVersion: "V2.2A" },
      directorySources: [
        { id: "s1", url: "https://a.gov/x", categories: ["FAMILY A"], occurrences: [{}] },
        { id: "s2", url: "https://b.gov/y", categories: ["NOTHING"], occurrences: [{}] },
      ],
      endpointCandidates: [
        { endpoint_id: "e1", url: "https://a.gov/x", source_family_id: "B", source_family_name: "Family B" },
      ],
      familyManifest: [
        { source_family_id: "A", source_family_name: "Family A" },
        { source_family_id: "B", source_family_name: "Family B" },
      ],
    });
    if (!res.ok) throw new Error(res.errors.join());
    const s1 = res.bundle.sources[0] as Record<string, unknown>;
    expect(s1["source_family"]).toBe("");
    expect(s1["source_family_ambiguous_ids"]).toEqual(["A", "B"]);
    const summary = summarizeFamilies(res.bundle);
    expect(summary.ambiguousSources).toBe(1);
    expect(summary.unassignedSources).toBe(1);
    expect(summary.families.every((f) => f.linkedSources === 0)).toBe(true);
    expect(summary.families.find((f) => f.id === "B")!.endpointCandidates).toBe(1);
  });
});
