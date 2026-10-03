import { describe, expect, it } from "vitest";
import source from "./mdl2738.server.json";
import { mdlPacket, qualityFromSupabase } from "./packets";
import { LEGAL_ENUMS, recordKey } from "./schema";
import { typedNeighbors, exportCitedPath } from "./graph";

describe("retained original-source packets", () => {
  it("validates the current MDL assignment separately from the original 2016 transfer", () => {
    const packet = mdlPacket.parse(source);
    const records = new Map(packet.records.map((r) => [recordKey(r), r]));
    const neighbors = typedNeighbors(packet.mdl, packet.edges, records);
    const assignment = neighbors.get("presided_by")![0]!;
    expect(assignment.record.title).toBe("Michael Andre Shipp");
    expect(assignment.record.id).toBe("1394031");
    expect(assignment.record.identifiers["courtlistener_person_id"]).toBe("2955");
    expect(assignment.edge.date).toBe("2026-10-02");
    const transfer = neighbors.get("transferred_by")![0]!;
    expect(transfer.record.date).toBe("2016-10-04");
    expect(transfer.record.attributes["text"]).toContain("Wolfson");
    expect(packet.complete).toBe(false);
    expect(exportCitedPath([records.get(recordKey(packet.mdl))!, assignment.record], [assignment.edge], records)).toContain("2026-10-02");
  });
  it("never marks unreviewed leadership complete or invents source sections", () => {
    expect(mdlPacket.safeParse({ ...source, complete: true }).success).toBe(false);
    expect(mdlPacket.safeParse({ ...source, documents: [{ ...source.documents[0], section: "made-up" }] }).success).toBe(false);
  });
  it("reads persisted Supabase counts and rejects missing reports", () => {
    const counts = Object.fromEntries(Object.keys(LEGAL_ENUMS.entity_type).map(type => [type, { total: 0, invalid: 0 }]));
    counts["docket_entry"] = { total: 100, invalid: 2 };
    const response = { schema_version: "legal-atlas/3.1", report: { reported_at: "2026-10-02T12:00:00Z", counts_by_type: counts,
      coverage: [{ source_name: "courtlistener", year: 2026, source_rows: 100, accepted_rows: 98, rejected_rows: 2, status: "partial" }] } };
    const snapshot = qualityFromSupabase(response);
    expect(snapshot.counts.schema_valid + snapshot.counts.schema_invalid).toBe(snapshot.counts.candidate_records);
    expect(snapshot.location).toBe("supabase");
    expect(snapshot.counts.schema_invalid).toBe(2);
    expect(snapshot.coverage[0]?.accepted).toBe(98);
    expect(snapshot.complete).toBe(false);
    expect(() => qualityFromSupabase({ ...response, report: null })).toThrow("has not been generated");
  });
});
