import { describe, expect, it } from "vitest";
import source from "./mdl2738.server.json";
import { mdlPacket } from "./packets";
import { recordKey } from "./schema";
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
});
