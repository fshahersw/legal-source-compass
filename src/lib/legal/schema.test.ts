import { describe, expect, it } from "vitest";
import { EntityType, edgeNeedsReview, legalEdge, legalRecord, recordKey } from "./schema";
import type { LegalEdge, LegalRecord } from "./schema";
import { auditAcceptance, coverageByYear, schemaRegressions, schemaReport } from "./audit";
import { exportCitedPath, typedNeighbors, visibleEdge } from "./graph";

const court = (): LegalRecord => legalRecord.parse({ id: "njd", type: "court", id_authority: "courtlistener", title: "District of New Jersey", title_source: "api", jurisdiction: "US", court_id: "njd", date: "2026-10-02", date_type: "retrieved", source_url: "https://www.courtlistener.com/c/njd/", source_name: "CourtListener", licence: "Public Domain Mark 1.0", retrieved_at: "2026-10-02T12:00:00Z", version: "2026-09-30", confidence: 1, extraction_method: "bulk", identifiers: { courtlistener_court_id: "njd" }, attributes: {} });
const caseRecord = (): LegalRecord => legalRecord.parse({ ...court(), id: "1234", type: "case", title: "Example case", date_type: "filed", date: "2001-03-02", identifiers: { courtlistener_docket_id: "1234" }, attributes: { text: "Filed in the District of New Jersey.", paragraphs: { court_id: "njd" } } });
const relation = (): LegalEdge => legalEdge.parse({ type: "filed_in", source_url: caseRecord().source_url, date: "2001-03-02", extraction_method: "api", confidence: 1, evidence: { paragraph_id: "court_id" }, review_status: "approved", treatment: null, role: null,
  ...{ from: { id: "1234", type: "case", id_authority: "courtlistener", version: "2026-09-30" }, to: { id: "njd", type: "court", id_authority: "courtlistener", version: "2026-09-30" }, source_record: { id: "1234", type: "case", id_authority: "courtlistener", version: "2026-09-30" } } });

describe("one controlled legal record schema", () => {
  it("uses exactly the requested entity types and rejects improvised labels", () => {
    expect(EntityType.options).toHaveLength(24);
    expect(legalRecord.safeParse({ ...court(), type: "court_document" }).success).toBe(false);
    expect(legalRecord.safeParse({ ...court(), title_source: "guessed" }).success).toBe(false);
  });
  it("rejects missing required provenance, impossible dates, fabricated IDs and unknown licences", () => {
    for (const patch of [{ source_url: "" }, { licence: "unknown" }, { confidence: 1.2 }, { date: "2025-02-29" }, { id: "New Jersey" }, { court_id: null }, { retrieved_at: null }]) expect(legalRecord.safeParse({ ...court(), ...patch }).success).toBe(false);
  });
  it("never fills a missing docket event date using retrieval", () => {
    expect(legalRecord.safeParse({ ...caseRecord(), date: "2026-10-02", date_type: "retrieved" }).success).toBe(false);
  });
  it("preserves both judicial identifiers and checks the primary ID", () => {
    const judge = { ...court(), type: "judge", id: "1384", id_authority: "fjc", identifiers: { fjc_nid: "1384", courtlistener_person_id: "892" } };
    expect(legalRecord.safeParse(judge).success).toBe(true);
    expect(legalRecord.safeParse({ ...judge, id: "892" }).success).toBe(false);
  });
  it("requires point-in-time CFR and USC versions", () => {
    const cfr = { ...court(), type: "cfr_section", id: "21 CFR 314.70", id_authority: "ecfr", attributes: { version_date: "2026-09-30" } };
    expect(legalRecord.safeParse(cfr).success).toBe(true);
    expect(legalRecord.safeParse({ ...cfr, version: "current" }).success).toBe(false);
    const usc = { ...court(), type: "usc_section", id: "21 USC 355", id_authority: "uscode", version: "118-158", attributes: { release_point: "118-158" } };
    expect(legalRecord.safeParse(usc).success).toBe(true);
    expect(legalRecord.safeParse({ ...usc, attributes: {} }).success).toBe(false);
  });
  it("requires the publisher's Federal Register type", () => {
    const doc = { ...caseRecord(), type: "fr_document", id_authority: "federal_register", id: "2024-12345", attributes: { fr_document_type: "RULE" } };
    expect(legalRecord.safeParse(doc).success).toBe(true);
    expect(legalRecord.safeParse({ ...doc, attributes: { fr_document_type: "Final Rule" } }).success).toBe(false);
    for (const id of ["99-34083", "00-1234", "E7-12345", "C1-2026-12345"]) expect(legalRecord.safeParse({ ...doc, id }).success).toBe(true);
    expect(legalRecord.safeParse({ ...doc, id_authority: "publisher" }).success).toBe(false);
  });
});
describe("typed evidence graph", () => {
  const records = new Map([caseRecord(), court()].map((r) => [recordKey(r), r]));
  it("requires compatible endpoint types and valid evidence spans", () => {
    expect(legalEdge.safeParse({ ...relation(), type: "cites" }).success).toBe(false);
    expect(legalEdge.safeParse({ ...relation(), evidence: { start: 10, end: 5 } }).success).toBe(false);
    expect(legalEdge.safeParse({ ...relation(), treatment: "overrules" }).success).toBe(false);
  });
  it("hides low confidence LLM, rejected, unresolved and unsupported evidence", () => {
    expect(visibleEdge(relation(), records)).toBe(true);
    for (const edge of [{ ...relation(), extraction_method: "llm" as const, confidence: .79 }, { ...relation(), review_status: "pending" as const }, { ...relation(), evidence: { paragraph_id: "missing" } }, { ...relation(), evidence: { start: 0, end: 999 } }]) expect(visibleEdge(edge, records)).toBe(false);
    expect(visibleEdge(relation(), new Map())).toBe(false);
    expect(edgeNeedsReview({ ...relation(), extraction_method: "llm", confidence: .79 })).toBe(true);
    const unicodeRecord = { ...caseRecord(), attributes: { text: "A😀B" } };
    const unicodeRecords = new Map([unicodeRecord, court()].map(r => [recordKey(r), r]));
    expect(visibleEdge({ ...relation(), evidence: { start: 0, end: 3 } }, unicodeRecords)).toBe(true);
    expect(visibleEdge({ ...relation(), evidence: { start: 0, end: 4 } }, unicodeRecords)).toBe(false);
  });
  it("groups neighbors with direction and exports a connected cited path", () => {
    expect(typedNeighbors(court(), [relation()], records).get("filed_in")?.[0]?.direction).toBe("incoming");
    expect(exportCitedPath([caseRecord(), court()], [relation()])).toContain("Relationship source");
    expect(() => exportCitedPath([court(), court()], [relation()])).toThrow("disconnected");
  });
});
describe("audit gates", () => {
  it("counts rejected inputs and fails increases in any individual type", () => {
    const at = "2026-10-02T12:00:00Z";
    const baseline = schemaReport([court()], "all-sources", at);
    const now = schemaReport([court(), { ...caseRecord(), source_url: "bad" }], "all-sources", at);
    expect(now.invalid).toBe(1);
    expect(schemaRegressions(now, baseline).join(" ")).toContain("case: invalid records increased");
    expect(schemaRegressions(schemaReport([], "all-sources", at), baseline).join(" ")).toContain("population decreased");
  });
  it("keeps unstarted years explicit and excludes retrieved dates", () => {
    const coverage = coverageByYear([court(), caseRecord()], ["CourtListener"], 2026);
    expect(coverage).toHaveLength(27);
    expect(coverage.find((x) => x.year === 2001)?.accepted).toBe(1);
    expect(coverage.find((x) => x.year === 2026)?.accepted).toBe(0);
  });
  it("cannot pass an unaudited, undersized or duplicate sample", () => {
    expect(auditAcceptance([], [], 100).passed).toBe(false);
    const row = { record_key: "a", type_correct: true, title_correct: true, source_matches: true, link_status: 200, checked_at: "2026-10-02T12:00:00Z", reviewer: "Reviewer" };
    expect(auditAcceptance(["a"], [row], 100).passed).toBe(false);
    expect(auditAcceptance(["a", "a"], [row], 2).passed).toBe(false);
    expect(auditAcceptance(["a"], [{ ...row, link_status: 404 }], 1).passed).toBe(false);
    expect(auditAcceptance(["a"], [row], 1).passed).toBe(true);
  });
});
