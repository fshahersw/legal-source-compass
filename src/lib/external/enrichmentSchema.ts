import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional();
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
const nativeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const isLocalRelationshipSource = (source: string) =>
  ["local-sw-catalog", "local-vaquill-open-us-law", "local-source-registry"].includes(source);
const relationshipScope = z
  .object({
    source: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(120),
    from: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(120),
    to: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(120),
    records: nativeCount,
    unresolvedEdges: nativeCount,
    inferredEdges: nativeCount,
  })
  .refine(
    (row) => row.unresolvedEdges <= row.records && row.inferredEdges <= row.records,
    "Relationship subsets cannot exceed their source-version edge count.",
  );

/** Only aggregate and source-reference fields can cross the server boundary.
 * Unknown fields (including private payloads and party records) are stripped.
 */
export const enrichmentSchema = z
  .object({
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
        httpSourceObservations: count,
        localFileOccurrences: count,
        nativeRelationships: count,
        sourceRecordedRelationships: count,
        localPointerRelationships: count,
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
    relationshipCoverage: z.array(relationshipScope).max(2000).optional(),
    qualifications: z.array(z.string().max(12000)).max(100).optional(),
  })
  .superRefine((value, context) => {
    const counts = value.counts;
    if (
      counts?.httpSourceObservations != null &&
      [counts.observations, counts.sourceRecords].some(
        (legacy) => legacy != null && legacy !== counts.httpSourceObservations,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HTTP-source observations must preserve the historical observation aliases.",
      });
    }
    if (counts?.sourceRecordedRelationships != null && counts.localPointerRelationships != null) {
      const total = counts.sourceRecordedRelationships + counts.localPointerRelationships;
      if (
        !Number.isSafeInteger(total) ||
        (counts.nativeRelationships != null && total !== counts.nativeRelationships)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Source-recorded edges and local pointers must reconcile to the historical relationship total.",
        });
      }
    }
    if (!value.relationshipCoverage) return;
    const total = value.relationshipCoverage.reduce((sum, row) => sum + row.records, 0);
    const localPointers = value.relationshipCoverage.reduce(
      (sum, row) => sum + (isLocalRelationshipSource(row.source) ? row.records : 0),
      0,
    );
    const keys = value.relationshipCoverage.map((row) => `${row.source}/${row.from}/${row.to}`);
    if (
      !Number.isSafeInteger(total) ||
      new Set(keys).size !== keys.length ||
      (value.counts?.nativeRelationships != null && total !== value.counts.nativeRelationships) ||
      (counts?.sourceRecordedRelationships != null &&
        total - localPointers !== counts.sourceRecordedRelationships) ||
      (counts?.localPointerRelationships != null &&
        localPointers !== counts.localPointerRelationships)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Relationship coverage must uniquely reconcile to the aggregate edge count.",
      });
    }
  });

export type EnrichmentSnapshot = z.infer<typeof enrichmentSchema>;
