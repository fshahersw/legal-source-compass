import { bundleSchema, type Bundle, type Source } from "./types";

export type ParseResult =
  | { ok: true; bundle: Bundle; stats: BundleStats; warnings: string[] }
  | { ok: false; errors: string[] };

export type BundleStats = {
  distinctSources: number;
  totalOccurrences: number;
  endpointCandidates: number;
  sourceFamilies: number;
  promotionRecords: number;
  jurisdictions: number;
  domains: number;
};

/**
 * Parse an uploaded JSON bundle. Nothing is normalised away: URLs keep their
 * query strings and hash routes exactly as supplied.
 */
export function parseBundle(raw: unknown): ParseResult {
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const bundle = parsed.data;
  const warnings: string[] = [];

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const s of bundle.sources) {
    if (seen.has(s.id)) duplicates.push(s.id);
    seen.add(s.id);
  }
  if (duplicates.length > 0) {
    warnings.push(`${duplicates.length} duplicate source id(s) in bundle; the last occurrence wins.`);
  }

  const urlSeen = new Set<string>();
  let dupUrls = 0;
  for (const s of bundle.sources) {
    if (urlSeen.has(s.url)) dupUrls += 1;
    urlSeen.add(s.url);
  }
  if (dupUrls > 0) {
    warnings.push(`${dupUrls} source row(s) repeat an exact URL already present in the bundle.`);
  }

  if (bundle.sources.length === 0) {
    warnings.push("Bundle contains zero source rows.");
  }

  const familyNames = new Set(bundle.source_families.map((f) => f.name));
  const orphanFamilies = new Set(
    bundle.sources.map((s) => s.source_family).filter((f) => f && !familyNames.has(f)),
  );
  if (familyNames.size > 0 && orphanFamilies.size > 0) {
    warnings.push(
      `${orphanFamilies.size} source family value(s) on sources are not declared in source_families.`,
    );
  }

  return { ok: true, bundle, stats: computeStats(bundle), warnings };
}

export function computeStats(bundle: Bundle): BundleStats {
  return {
    distinctSources: new Set(bundle.sources.map((s) => s.url)).size,
    totalOccurrences: bundle.sources.reduce((acc, s) => acc + (s.occurrences ?? 0), 0),
    endpointCandidates: bundle.endpoint_candidates.length,
    sourceFamilies:
      bundle.source_families.length ||
      new Set(bundle.sources.map((s) => s.source_family).filter(Boolean)).size,
    promotionRecords: bundle.promotion_records.length,
    jurisdictions: new Set(bundle.sources.map((s) => s.jurisdiction).filter(Boolean)).size,
    domains: new Set(bundle.sources.map((s) => s.domain).filter(Boolean)).size,
  };
}

export type Facet = { value: string; count: number; occurrences: number };

export function facet(sources: Source[], key: keyof Source): Facet[] {
  const map = new Map<string, Facet>();
  for (const s of sources) {
    const value = String(s[key] ?? "").trim();
    const label = value === "" ? "(unspecified)" : value;
    const entry = map.get(label) ?? { value: label, count: 0, occurrences: 0 };
    entry.count += 1;
    entry.occurrences += s.occurrences ?? 0;
    map.set(label, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
