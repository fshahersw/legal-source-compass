import { z } from "zod";

/**
 * Native V2.2A bundle layout (meta / directorySources / endpointCandidates /
 * familyManifest / promotionLedger / originalFiles). adaptV22A maps it into
 * the app's model WITHOUT rewriting imported values: every original field is
 * kept verbatim (passthrough), only additional display fields are derived.
 */

const occurrenceSchema = z
  .object({
    line: z.number().optional(),
    label: z.string().optional(),
    path: z.array(z.string()).optional(),
    subheading: z.string().optional(),
    jurisdiction: z.string().optional(),
    raw: z.string().optional(),
  })
  .passthrough();

const v22aSourceSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().min(1),
    title: z.string().default(""),
    domain: z.string().default(""),
    format: z.string().optional(),
    formatBasis: z.string().optional(),
    categories: z.array(z.string()).default([]),
    jurisdictions: z.array(z.string()).default([]),
    occurrences: z.array(occurrenceSchema).default([]),
    importedVerification: z.string().optional(),
  })
  .passthrough();

const v22aEndpointSchema = z
  .object({
    endpoint_id: z.string().min(1),
    url: z.string().min(1),
    domain: z.string().default(""),
    source_family_id: z.string().default(""),
    source_family_name: z.string().default(""),
  })
  .passthrough();

const v22aFamilySchema = z
  .object({ source_family_id: z.string().min(1), source_family_name: z.string().min(1) })
  .passthrough();

const v22aOriginalFileSchema = z
  .object({
    name: z.string(),
    sha256: z.string().optional(),
    sizeBytes: z.number().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const v22aBundleSchema = z
  .object({
    meta: z
      .object({
        sourceVersion: z.string(),
        schemaVersion: z.string().optional(),
        assembledOn: z.string().optional(),
        uniqueDirectorySources: z.number().optional(),
        directoryOccurrences: z.number().optional(),
        candidateCount: z.number().optional(),
        familyCount: z.number().optional(),
        importedPromotionCount: z.number().optional(),
        notice: z.string().optional(),
        scope: z.string().optional(),
      })
      .passthrough(),
    directorySources: z.array(v22aSourceSchema),
    endpointCandidates: z.array(v22aEndpointSchema).default([]),
    familyManifest: z.array(v22aFamilySchema).default([]),
    promotionLedger: z.array(v22aEndpointSchema.partial({ endpoint_id: true, url: true })).default([]),
    originalFiles: z.array(v22aOriginalFileSchema).default([]),
  })
  .passthrough();

export type V22ABundle = z.infer<typeof v22aBundleSchema>;

export function isV22A(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    "meta" in raw &&
    "directorySources" in raw &&
    Array.isArray((raw as { directorySources: unknown }).directorySources)
  );
}

const norm = (s: string) => s.trim().toUpperCase();

/** Convert a parsed V2.2A bundle into the app's generic bundle shape. */
export function adaptV22A(b: V22ABundle): Record<string, unknown> {
  const familyByName = new Map(b.familyManifest.map((f) => [norm(f.source_family_name), f]));
  const familyByUrl = new Map<string, string>();
  for (const e of b.endpointCandidates) {
    if (e.source_family_name) familyByUrl.set(e.url, e.source_family_name);
  }

  const sources = b.directorySources.map((s) => {
    const famFromCategory = s.categories
      .map((c) => familyByName.get(norm(c))?.source_family_name)
      .find(Boolean);
    return {
      ...s,
      // Derived display fields only; originals above are untouched.
      occurrence_records: s.occurrences,
      occurrences: s.occurrences.length,
      category_values: s.categories,
      jurisdiction_values: s.jurisdictions,
      heading_category: s.categories.join("; "),
      jurisdiction: s.jurisdictions.join("; "),
      source_family: famFromCategory ?? familyByUrl.get(s.url) ?? "",
      imported_review_label: s.importedVerification,
    };
  });

  const endpoint_candidates = b.endpointCandidates.map((e) => ({
    ...e,
    id: e.endpoint_id,
    source_family: e.source_family_name,
    jurisdiction: "",
    candidate_kind: typeof e["document_type"] === "string" ? (e["document_type"] as string) : undefined,
    imported_status: [e["review_status"], e["promotion_tier"]].filter((x) => typeof x === "string" && x).join(" · ") || undefined,
    notes: typeof e["notes"] === "string" ? (e["notes"] as string) : undefined,
  }));

  const source_families = b.familyManifest.map((f) => ({
    ...f,
    id: f.source_family_id,
    name: f.source_family_name,
    description: typeof f["pilot_status"] === "string" ? `Imported pilot status: ${f["pilot_status"]}` : undefined,
  }));

  const promotion_records = b.promotionLedger.map((p, i) => ({
    ...p,
    id: p.endpoint_id ?? `promotion_${i}`,
    url: p.url,
    imported_decision: [p["action"], p["promotion_tier"]].filter((x) => typeof x === "string" && x).join(" · "),
    notes: typeof p["promotion_reason"] === "string" ? (p["promotion_reason"] as string) : undefined,
  }));

  return {
    bundle_version: b.meta.sourceVersion,
    generated_at: b.meta.assembledOn,
    provenance: {
      original_files: b.originalFiles.map((f) => f.name),
      notes: b.meta.notice,
    },
    meta_claims: b.meta,
    original_files: b.originalFiles,
    sources,
    endpoint_candidates,
    source_families,
    promotion_records,
  };
}

export type MetaClaimCheck = { label: string; claimed: number | undefined; counted: number; match: boolean };

export function checkMetaClaims(
  meta: Record<string, unknown> | undefined,
  counted: { sources: number; occurrences: number; endpoints: number; families: number; promotions: number },
): MetaClaimCheck[] {
  if (!meta) return [];
  const n = (k: string) => (typeof meta[k] === "number" ? (meta[k] as number) : undefined);
  const rows: [string, number | undefined, number][] = [
    ["Distinct source URLs", n("uniqueDirectorySources"), counted.sources],
    ["Directory occurrences", n("directoryOccurrences"), counted.occurrences],
    ["Endpoint candidates", n("candidateCount"), counted.endpoints],
    ["Source families", n("familyCount"), counted.families],
    ["Promotion records", n("importedPromotionCount"), counted.promotions],
  ];
  return rows.map(([label, claimed, c]) => ({ label, claimed, counted: c, match: claimed === c }));
}
