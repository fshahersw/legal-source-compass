import { describe, expect, it } from "vitest";
import { enrichmentSchema } from "./enrichmentSchema";

describe("public enrichment checkpoint boundary", () => {
  it("retains unknown counts as unknown and strips private records at every level", () => {
    const result = enrichmentSchema.parse({
      schemaVersion: "corpus-enrichment/1",
      status: "partial",
      metadataOnly: true,
      privateParties: [{ name: "Private retained source row" }],
      counts: { sourceRecords: 108036, canonicalEntities: null, privateRecord: "hidden" },
      coverage: [
        {
          id: "cl_people",
          label: "Native biographies",
          status: "complete-snapshot",
          records: 16191,
          sourceAsOf: "2026-09-30",
          sourceUrls: ["https://www.courtlistener.com/"],
          rawPayload: { secret: "hidden" },
        },
      ],
    });
    expect(result.counts?.sourceRecords).toBe(108036);
    expect(result.counts?.canonicalEntities).toBeNull();
    expect(result.counts?.pdfDownloads).toBeUndefined();
    expect(result).not.toHaveProperty("privateParties");
    expect(result.counts).not.toHaveProperty("privateRecord");
    expect(result.coverage?.[0]).not.toHaveProperty("rawPayload");
  });
  it("rejects unrecognized schemas, negative counts, and non-public URL schemes", () => {
    const base = { schemaVersion: "corpus-enrichment/1", status: "partial", metadataOnly: true };
    expect(enrichmentSchema.safeParse({ ...base, schemaVersion: "future/2" }).success).toBe(false);
    expect(enrichmentSchema.safeParse({ ...base, counts: { sourceRecords: -1 } }).success).toBe(
      false,
    );
    expect(
      enrichmentSchema.safeParse({
        ...base,
        coverage: [
          { id: "x", label: "X", status: "partial", sourceUrls: ["file:///private/corpus"] },
        ],
      }).success,
    ).toBe(false);
  });
  it("keeps administrative and docket grains separate and strips private nested data", () => {
    const result = enrichmentSchema.parse({
      schemaVersion: "corpus-enrichment/1",
      status: "partial",
      metadataOnly: true,
      mdlAssociations: [
        {
          mdlNumber: "2973",
          label: "Elmiron",
          administrativeRecords: 200,
          nativeDocketLinks: null,
          masterEntriesCaptured: 419,
          masterEntriesObserved: 419,
          masterScope: "complete",
          sourceUrl: "https://www.courtlistener.com/api/rest/v4/dockets/18753355/",
          privateParties: [{ contact: "hidden" }],
        },
      ],
    });
    expect(result.mdlAssociations?.[0]?.nativeDocketLinks).toBeNull();
    expect(result.mdlAssociations?.[0]).not.toHaveProperty("privateParties");
    expect(
      enrichmentSchema.safeParse({
        ...result,
        mdlAssociations: [{ ...result.mdlAssociations?.[0], administrativeRecords: -1 }],
      }).success,
    ).toBe(false);
  });
});
