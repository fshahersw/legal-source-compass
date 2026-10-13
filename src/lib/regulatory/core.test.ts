import { describe, expect, it } from "vitest";
import { canonicalRegulatoryJson, regulatoryChange, sameRegulatoryEntity } from "./core";
import {
  briefInputSchema,
  regulatoryQuerySchema,
  regulatoryTrendSchema,
  reviewInputSchema,
} from "./validation";
import type { RegulatoryRecordData } from "./types";
const record: RegulatoryRecordData = {
  native_id: "2026-01",
  title: "Source record",
  document_type: "Notice",
  published_on: "2026-01-01",
  source_updated_on: null,
  source_url: "https://www.federalregister.gov/documents/2026-01",
  agency_ids: [],
  agency_names: [],
  entity_refs: [],
  identifiers: [],
  status: null,
  fields: { action: "Notice", nested: { a: 1, b: 2 } },
  correction_of: [],
  evidence_excerpt: "Literal source excerpt.",
};

describe("deterministic source-version events", () => {
  it("ignores object key order while preserving exact source wording", () => {
    expect(
      regulatoryChange(
        record,
        { ...record, fields: { nested: { b: 2, a: 1 }, action: "Notice" } },
        "incremental",
      ),
    ).toBeNull();
    expect(
      regulatoryChange(record, { ...record, title: "Source record " }, "incremental")
        ?.changedFields,
    ).toEqual(["title"]);
  });
  it("distinguishes initial and historical acquisition from new events", () => {
    expect(regulatoryChange(null, record, "initial")?.eventType).toBe("initial_record");
    expect(regulatoryChange(null, record, "backfill")?.eventType).toBe("backfill");
    expect(regulatoryChange(null, record, "incremental")?.reason).toContain(
      "publication and incident dates may be earlier",
    );
  });
  it("requires an explicit correction relationship and never infers one from a title", () => {
    expect(
      regulatoryChange(null, { ...record, title: "Correction discussion" }, "incremental")
        ?.eventType,
    ).toBe("new_record");
    const changed = regulatoryChange(
      record,
      { ...record, status: "Revised", correction_of: ["2025-01"] },
      "incremental",
    );
    expect(changed?.eventType).toBe("correction");
    expect(changed?.changedFields).toEqual(["correction_of", "status"]);
  });
  it("does not merge identical labels or IDs across native namespaces", () => {
    expect(
      sameRegulatoryEntity(
        { namespace: "FDA:product", native_id: "1" },
        { namespace: "NHTSA:campaign", native_id: "1" },
      ),
    ).toBe(false);
    expect(() =>
      regulatoryChange(record, { ...record, native_id: "different" }, "incremental"),
    ).toThrow("different source-native");
  });
  it("rejects undefined or fractional payloads instead of producing a misleading hash input", () => {
    expect(() => canonicalRegulatoryJson({ missing: undefined })).toThrow();
    expect(() => canonicalRegulatoryJson({ float: 1.5 })).toThrow();
    expect(canonicalRegulatoryJson({ z: "Exact 🏛 text", a: [null, 2] })).toBe(
      '{"a":[null,2],"z":"Exact 🏛 text"}',
    );
    // PostgreSQL C/Python order Unicode code points; UTF-16 sorting reverses this pair.
    expect(canonicalRegulatoryJson({ "𐀀": 2, "\ue000": 1 })).toBe('{"\ue000":1,"𐀀":2}');
  });
});

describe("query and work-product boundaries", () => {
  it("validates actual calendar dates, ordered ranges and literal source allowlists", () => {
    expect(regulatoryQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(regulatoryQuerySchema.safeParse({ from: "2026-02-03", to: "2026-01-01" }).success).toBe(
      false,
    );
    expect(regulatoryQuerySchema.safeParse({ source: "cpsc_injury_data" }).success).toBe(false);
    expect(
      regulatoryQuerySchema.safeParse({ q: "%", dateBasis: "published", sourceFamily: "fda" })
        .success,
    ).toBe(true);
  });
  it("requires exact entity namespace and ID and limits expensive queries", () => {
    expect(regulatoryQuerySchema.safeParse({ entityId: "123" }).success).toBe(false);
    expect(
      regulatoryQuerySchema.safeParse({
        entityNamespace: "FDA:recall",
        entityId: "123",
        limit: 101,
      }).success,
    ).toBe(false);
    expect(regulatoryTrendSchema.safeParse({ from: "2020-01-01", to: "2026-01-01" }).success).toBe(
      false,
    );
    expect(
      regulatoryTrendSchema.safeParse({
        from: "2026-01-01",
        to: "2026-01-03",
        sourceFamily: "fda",
        dateBasis: "published",
      }).success,
    ).toBe(true);
  });
  it("cannot submit user identities, memberships or invented evidence in a brief", () => {
    const base = {
      organizationId: "11111111-2222-4333-8444-555555555555",
      title: "Brief",
      eventIds: ["a".repeat(64)],
      query: {},
    };
    expect(briefInputSchema.safeParse(base).success).toBe(true);
    expect(briefInputSchema.safeParse({ ...base, userId: "forged" }).success).toBe(false);
    expect(
      briefInputSchema.safeParse({ ...base, manifest: { evidence: "Invented" } }).success,
    ).toBe(false);
    expect(
      briefInputSchema.safeParse({ ...base, eventIds: ["a".repeat(64), "a".repeat(64)] }).success,
    ).toBe(false);
    expect(
      reviewInputSchema.safeParse({
        organizationId: base.organizationId,
        eventId: "a".repeat(64),
        status: "relevant",
        note: "",
      }).success,
    ).toBe(false);
  });
});
