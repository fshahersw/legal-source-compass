import { z } from "zod";

const count = z.number().int().nonnegative().nullable().optional();
const text = z.string().max(12000).nullable().optional();
const date = z.string().max(100).nullable().optional();
const jurisdictions = z
  .union([z.number().int().nonnegative(), z.array(z.string().max(100)).max(100)])
  .nullable()
  .optional();
const sourceUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "Only public HTTP(S) source references are allowed.");

/** Only aggregate and source-reference fields can cross the server boundary.
 * Unknown fields (including private payloads and party records) are stripped.
 */
export const enrichmentSchema = z.object({
  schemaVersion: z.literal("corpus-enrichment/1"),
  updatedAt: date,
  status: z.enum(["partial", "running", "verified"]),
  metadataOnly: z.literal(true),
  counts: z
    .object({
      sourceRecords: count,
      canonicalEntities: count,
      sourceVersions: count,
      observations: count,
      nativeRelationships: count,
      pdfDownloads: count,
    })
    .optional(),
  mdlAssociations: z
    .array(
      z.object({
        mdlNumber: z.string().regex(/^\d{2,6}$/),
        label: z.string().max(400),
        profileId: z.string().max(120).nullable().optional(),
        administrativeRecords: count,
        nativeDocketLinks: count,
        publicMetadataRecords: count,
        masterEntriesCaptured: count,
        masterEntriesObserved: count,
        masterScope: z.enum(["complete", "partial"]),
        sourceAsOf: date,
        sourceUrl,
      }),
    )
    .max(100)
    .optional(),
  coverage: z
    .array(
      z.object({
        id: z.string().max(120),
        label: z.string().max(400),
        status: z.enum(["complete-snapshot", "partial", "research-review"]),
        records: count,
        sourceAsOf: date,
        sourceUrls: z.array(sourceUrl).max(500).optional(),
        qualification: text,
      }),
    )
    .max(500)
    .optional(),
  deduplication: z
    .object({
      version: date,
      recordsCompared: count,
      exactDuplicateGroups: count,
      explicitAliases: count,
      summary: text,
    })
    .optional(),
  legalReview: z
    .object({
      sources: count,
      rules: count,
      jurisdictionsCovered: jurisdictions,
      calculatorJurisdictions: jurisdictions,
      qualification: text,
    })
    .optional(),
  categoryMap: z.object({ version: date, summary: text }).optional(),
  qualifications: z.array(z.string().max(12000)).max(100).optional(),
});

export type EnrichmentSnapshot = z.infer<typeof enrichmentSchema>;
