import { describe, expect, it } from "vitest";
import { enrichmentSchema, isLocalRelationshipSource } from "./enrichmentSchema";

describe("public enrichment checkpoint boundary", () => {
  it("preserves historical HTTP aliases and separates local occurrences from relationship grains", () => {
    const checkpoint = {
      schemaVersion: "corpus-enrichment/1",
      status: "partial",
      metadataOnly: true,
      counts: {
        sourceRecords: 100,
        observations: 100,
        httpSourceObservations: 100,
        localFileOccurrences: 20,
        nativeRelationships: 50,
        sourceRecordedRelationships: 40,
        localPointerRelationships: 10,
      },
      relationshipCoverage: [
        {
          source: "courtlistener",
          from: "dockets",
          to: "courts",
          records: 40,
          unresolvedEdges: 1,
          inferredEdges: 0,
        },
        {
          source: "local-sw-catalog",
          from: "regulatory-edges",
          to: "regulatory-nodes",
          records: 10,
          unresolvedEdges: 0,
          inferredEdges: 0,
        },
      ],
    };
    expect(enrichmentSchema.parse(checkpoint).counts).toEqual(checkpoint.counts);
    for (const changed of [
      { httpSourceObservations: 120 },
      { localFileOccurrences: -1 },
      { sourceRecordedRelationships: 41 },
      { sourceRecordedRelationships: 35, localPointerRelationships: 15 },
    ]) {
      expect(
        enrichmentSchema.safeParse({ ...checkpoint, counts: { ...checkpoint.counts, ...changed } })
          .success,
      ).toBe(false);
    }
    expect(isLocalRelationshipSource("local-sw-catalog")).toBe(true);
    expect(isLocalRelationshipSource("courtlistener")).toBe(false);
  });
  it("accepts historical checkpoints without fabricated local metrics and preserves unknown counts", () => {
    const base = {
      schemaVersion: "corpus-enrichment/1",
      status: "partial",
      metadataOnly: true,
      counts: { sourceRecords: 100, observations: 100, nativeRelationships: 50 },
    };
    const historical = enrichmentSchema.parse(base);
    expect(historical.counts?.localFileOccurrences).toBeUndefined();
    expect(historical.counts?.httpSourceObservations).toBeUndefined();
    expect(
      enrichmentSchema.parse({ ...base, counts: { ...base.counts, localFileOccurrences: null } })
        .counts?.localFileOccurrences,
    ).toBeNull();
    expect(
      enrichmentSchema.safeParse({
        ...base,
        counts: {
          sourceRecordedRelationships: Number.MAX_SAFE_INTEGER,
          localPointerRelationships: 1,
        },
      }).success,
    ).toBe(false);
  });
  it("retains exact native opinion-join type names without admitting private scalar paths", () => {
    const relationshipCoverage = [
      {
        source: "courtlistener",
        from: "search_opinion_joined_by",
        to: "opinions",
        records: 1028,
        unresolvedEdges: 1028,
        inferredEdges: 0,
      },
      {
        source: "courtlistener",
        from: "search_opinion_joined_by",
        to: "people",
        records: 1028,
        unresolvedEdges: 0,
        inferredEdges: 0,
      },
      {
        source: "courtlistener",
        from: "search_opinioncluster_panel",
        to: "clusters",
        records: 3,
        unresolvedEdges: 0,
        inferredEdges: 0,
      },
      {
        source: "courtlistener",
        from: "search_opinioncluster_panel",
        to: "people",
        records: 3,
        unresolvedEdges: 0,
        inferredEdges: 0,
      },
    ];
    const checkpoint = {
      schemaVersion: "corpus-enrichment/1",
      status: "partial",
      metadataOnly: true,
      counts: { nativeRelationships: 2062 },
      relationshipCoverage,
    };
    expect(enrichmentSchema.parse(checkpoint).relationshipCoverage).toEqual(relationshipCoverage);
    for (const from of [
      "private_person@email.invalid",
      "https://example.invalid/private_path",
      "private person",
      "x".repeat(121),
    ]) {
      expect(
        enrichmentSchema.safeParse({
          ...checkpoint,
          relationshipCoverage: [
            { ...relationshipCoverage[0], from },
            ...relationshipCoverage.slice(1),
          ],
        }).success,
      ).toBe(false);
    }
  });
  it("exposes only aggregate reference paths and rejects impossible or duplicate relationship totals", () => {
    const base = {
      schemaVersion: "corpus-enrichment/1",
      status: "partial",
      metadataOnly: true,
      counts: { nativeRelationships: 10 },
      relationshipCoverage: [
        {
          source: "courtlistener",
          from: "attorneys",
          to: "parties",
          records: 10,
          unresolvedEdges: 3,
          inferredEdges: 0,
          privateNames: ["withheld"],
        },
      ],
    };
    const result = enrichmentSchema.parse(base);
    expect(result.relationshipCoverage?.[0]).not.toHaveProperty("privateNames");
    expect(
      enrichmentSchema.safeParse({ ...base, counts: { nativeRelationships: 11 } }).success,
    ).toBe(false);
    expect(
      enrichmentSchema.safeParse({
        ...base,
        relationshipCoverage: [{ ...base.relationshipCoverage[0], unresolvedEdges: 11 }],
      }).success,
    ).toBe(false);
    expect(
      enrichmentSchema.safeParse({
        ...base,
        relationshipCoverage: [{ ...base.relationshipCoverage[0], inferredEdges: 11 }],
      }).success,
    ).toBe(false);
    expect(
      enrichmentSchema.safeParse({
        ...base,
        counts: { nativeRelationships: null },
        relationshipCoverage: [
          { ...base.relationshipCoverage[0], records: Number.MAX_SAFE_INTEGER },
          { ...base.relationshipCoverage[0], to: "dockets", records: 10 },
        ],
      }).success,
    ).toBe(false);
    expect(
      enrichmentSchema.safeParse({
        ...base,
        relationshipCoverage: [{ ...base.relationshipCoverage[0], from: "private@email.invalid" }],
      }).success,
    ).toBe(false);
    expect(
      enrichmentSchema.safeParse({
        ...base,
        counts: { nativeRelationships: 20 },
        relationshipCoverage: [...base.relationshipCoverage, ...base.relationshipCoverage],
      }).success,
    ).toBe(false);
  });
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
