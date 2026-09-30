import type { Bundle } from "./types";

export type FamilySummary = {
  id: string;
  name: string;
  /** Imported manifest record, verbatim (figures are the bundle's own claims). */
  manifest: Record<string, unknown>;
  /** Computed from endpoint_candidates by family id. */
  endpointCandidates: number;
  /** Computed from promotion_records by family id. */
  promotions: number;
  /** Directory sources linked to exactly this family. */
  linkedSources: number;
  linkedOccurrences: number;
};

export type FamiliesOverview = {
  families: FamilySummary[];
  /** Directory sources matching more than one family (not assigned). */
  ambiguousSources: number;
  /** Directory sources matching no family. */
  unassignedSources: number;
  endpointsWithoutKnownFamily: number;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function summarizeFamilies(bundle: Bundle): FamiliesOverview {
  const byId = new Map<string, FamilySummary>();
  for (const f of bundle.source_families) {
    byId.set(f.id, {
      id: f.id,
      name: f.name,
      manifest: f as Record<string, unknown>,
      endpointCandidates: 0,
      promotions: 0,
      linkedSources: 0,
      linkedOccurrences: 0,
    });
  }
  const idByName = new Map([...byId.values()].map((f) => [f.name, f.id]));
  const familyIdOf = (r: Record<string, unknown>) =>
    str(r["source_family_id"]) || idByName.get(str(r["source_family"])) || "";

  let endpointsWithoutKnownFamily = 0;
  for (const e of bundle.endpoint_candidates) {
    const fam = byId.get(familyIdOf(e as Record<string, unknown>));
    if (fam) fam.endpointCandidates += 1;
    else endpointsWithoutKnownFamily += 1;
  }
  for (const p of bundle.promotion_records) {
    const fam = byId.get(familyIdOf(p as Record<string, unknown>));
    if (fam) fam.promotions += 1;
  }

  let ambiguousSources = 0;
  let unassignedSources = 0;
  for (const s of bundle.sources) {
    const r = s as Record<string, unknown>;
    if (Array.isArray(r["source_family_ambiguous_ids"]) && r["source_family_ambiguous_ids"].length > 1) {
      ambiguousSources += 1;
      continue;
    }
    const fam = byId.get(familyIdOf(r));
    if (fam) {
      fam.linkedSources += 1;
      fam.linkedOccurrences += s.occurrences ?? 0;
    } else unassignedSources += 1;
  }

  return { families: [...byId.values()], ambiguousSources, unassignedSources, endpointsWithoutKnownFamily };
}
