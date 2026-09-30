import { z } from "zod";

/**
 * Bundle schema for the V2.2A litigation source export.
 *
 * Everything in here is treated as IMMUTABLE imported data. The app never
 * edits, re-derives or "refreshes" these fields. Imported authority /
 * currentness / review labels are carried through as historical curation
 * metadata only — they are NOT fresh verification.
 */

export const provenanceSchema = z
  .object({
    original_file: z.string().optional(),
    original_files: z.array(z.string()).optional(),
    extracted_at: z.string().optional(),
    pipeline: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const sourceSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().min(1),
    title: z.string().default(""),
    domain: z.string().default(""),
    jurisdiction: z.string().default(""),
    heading_category: z.string().default(""),
    source_family: z.string().default(""),
    occurrences: z.number().int().nonnegative().default(1),
    imported_authority_label: z.string().optional(),
    imported_currentness_label: z.string().optional(),
    imported_review_label: z.string().optional(),
    provenance: provenanceSchema.optional(),
  })
  .passthrough();

export const endpointCandidateSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().min(1),
    domain: z.string().default(""),
    method: z.string().optional(),
    source_family: z.string().default(""),
    jurisdiction: z.string().default(""),
    candidate_kind: z.string().optional(),
    imported_status: z.string().optional(),
    notes: z.string().optional(),
    provenance: provenanceSchema.optional(),
  })
  .passthrough();

export const sourceFamilySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .passthrough();

export const promotionRecordSchema = z
  .object({
    id: z.string().min(1),
    source_id: z.string().optional(),
    url: z.string().optional(),
    imported_decision: z.string().default(""),
    imported_decided_at: z.string().optional(),
    imported_decided_by: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const bundleSchema = z
  .object({
    bundle_version: z.string().default("unknown"),
    generated_at: z.string().optional(),
    provenance: provenanceSchema.optional(),
    sources: z.array(sourceSchema),
    endpoint_candidates: z.array(endpointCandidateSchema).default([]),
    source_families: z.array(sourceFamilySchema).default([]),
    promotion_records: z.array(promotionRecordSchema).default([]),
  })
  .passthrough();

export type Provenance = z.infer<typeof provenanceSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type EndpointCandidate = z.infer<typeof endpointCandidateSchema>;
export type SourceFamily = z.infer<typeof sourceFamilySchema>;
export type PromotionRecord = z.infer<typeof promotionRecordSchema>;
export type Bundle = z.infer<typeof bundleSchema>;

/** Browser-local review overlay. Never mixed into imported curation data. */
export type ReviewAction = "accepted" | "rejected" | "needs_follow_up";

export type ReviewOverlay = {
  source_id: string;
  action: ReviewAction;
  reason: string;
  /** ISO timestamp, set locally in the browser. */
  at: string;
};

export type Bookmark = {
  source_id: string;
  at: string;
};
