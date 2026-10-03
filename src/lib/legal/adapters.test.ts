import { describe, expect, it } from "vitest";
import { adapterContext, adaptNative, addSupportRow, nativeRecordEdges } from "./adapters";
import type { NativeRow } from "./adapters";
import { legalRecord } from "./schema";

const native = (kind: string, data: Record<string, unknown>): NativeRow => ({ source_system: "courtlistener", entity_type: kind, native_id: String(data["id"] ?? "12"), data,
  provenance: { source_url: "https://www.courtlistener.com/api/rest/v4/dockets/12/", retrieved_at: "2026-10-02T12:00:00Z", record_sha256: "a".repeat(64), schema_version: "courtlistener-rest-v4.7/1" } });
describe("native source adapters", () => {
  it("uses a verified FJC nid crosswalk and rejects service rows belonging to another judge", () => {
    const c = adapterContext();
    addSupportRow({ source_system: "fjc", entity_type: "person-crosswalk", native_id: "1394031", data: { fjc_nid: "1394031", courtlistener_person_id: "2955" }, provenance: {} }, c);
    const mapped = legalRecord.parse(adaptNative(native("people", { id: "2955", name_first: "Michael", name_last: "Shipp", fjc_id: "3440" }), c).records[0]);
    expect(mapped.id).toBe("1394031"); expect(mapped.id_authority).toBe("fjc"); expect(mapped.identifiers["courtlistener_person_id"]).toBe("2955");
    const fjc = { ...native("judges", {}), source_system: "fjc", native_id: "1394031", data: { nid: "1394031", jid: "3440", demographics: { nid: "1394031", "First Name": "Michael", "Middle Name": "Andre", "Last Name": "Shipp" }, service: [{ nid: "1394031", "Commission Date": "2012-07-23" }], courtlistener_person_id: "2955" } };
    expect(legalRecord.parse(adaptNative(fjc, c).records[0]).title).toBe("Michael Andre Shipp");
    expect(() => adaptNative({ ...fjc, data: { ...fjc.data, service: [{ nid: "999" }] } }, c)).toThrow("service identity");
  });
  it("does not manufacture judges from all people or convert legacy FJC IDs to nids", () => {
    const c = adapterContext();
    expect(adaptNative(native("people", { name_first: "An", name_last: "Appointer" }), c).status).toBe("supporting");
    const judge = legalRecord.parse(adaptNative(native("people", { name_first: "A", name_last: "Judge", fjc_id: 25 }), c).records[0]);
    expect(judge.id_authority).toBe("courtlistener");
    expect(judge.identifiers["fjc_nid"]).toBeUndefined();
    expect(judge.identifiers["fjc_legacy_id"]).toBe("25");
  });
  it("requires actual filed dates and excludes pre-2000 and blocked dockets", () => {
    const c = adapterContext();
    const docket = { case_name: "Example", court_id: "njd", date_filed: "2000-01-01" };
    expect(adaptNative(native("dockets", docket), c).records.map((r) => legalRecord.parse(r).type)).toEqual(["docket", "case"]);
    expect(legalRecord.safeParse(adaptNative(native("dockets", { ...docket, date_filed: null }), c).records[0]).success).toBe(false);
    expect(adaptNative(native("dockets", { ...docket, date_filed: "1999-12-31" }), c).status).toBe("excluded");
    expect(adaptNative(native("dockets", { ...docket, blocked: true }), c).status).toBe("excluded");
  });
  it("takes opinion filing dates and names from the cluster, not download date or authorship", () => {
    const c = adapterContext();
    const opinion = native("opinions", { id: 33, cluster_id: 90, plain_text: "Opinion text" });
    expect(legalRecord.safeParse(adaptNative(opinion, c).records[0]).success).toBe(false);
    addSupportRow(native("opinion-clusters", { id: 90, date_filed: "2001-02-03", case_name: "The actual case", docket_id: 12 }), c);
    const result = legalRecord.parse(adaptNative(opinion, c).records[0]);
    expect(result.id).toBe("33"); expect(result.title).toBe("The actual case"); expect(result.date).toBe("2001-02-03");
  });
  it("uses only recorded court locations for state jurisdiction", () => {
    const c = adapterContext(); const row = native("courts", { id: "nj", jurisdiction: "S", full_name: "Supreme Court" });
    expect(legalRecord.parse(adaptNative(row, c).records[0]).jurisdiction).toBe("UNKNOWN");
    addSupportRow(native("courthouses", { id: 1, court_id: "nj", state: "NJ" }), c);
    expect(legalRecord.parse(adaptNative(row, c).records[0]).jurisdiction).toBe("NJ");
    expect(legalRecord.parse(adaptNative(native("courts", { id: "txctapp13A", jurisdiction: "SA", full_name: "Thirteenth Court of Appeals" }), c).records[0]).id).toBe("txctapp13A");
  });
  it("uses an explicit parent label for an entry whose source description is blank", () => {
    const c = adapterContext(); addSupportRow(native("dockets", { id: 12, case_name: "Recorded case name", court_id: "njd" }), c);
    const row = native("docket-entries", { id: 20, docket: "https://www.courtlistener.com/api/rest/v4/dockets/12/", entry_number: 5, date_filed: "2020-01-01", description: "" });
    const record = legalRecord.parse(adaptNative(row, c).records[0]);
    expect(record.title_source).toBe("parent_label"); expect(record.title).toBe("Recorded case name — Entry 5");
  });
  it("converts the FR API's documented labels, preserving raw type and effective dates", () => {
    const row = native("documents", { document_number: "2024-12345", title: "Rule", type: "Proposed Rule", publication_date: "2024-01-01", effective_on: null }); row.source_system = "federalregister";
    row.native_id = "2024-12345";
    const record = legalRecord.parse(adaptNative(row, adapterContext()).records[0]);
    expect(record.attributes["fr_document_type"]).toBe("PRORULE");
    expect((record.attributes["native"] as Record<string, unknown>)["type"]).toBe("Proposed Rule");
    expect(record.date_type).toBe("published");
    row.data["document_number"] = "C1-2026-04516";
    row.native_id = "C1-2026-04516";
    expect(legalRecord.parse(adaptNative(row, adapterContext()).records[0]).id).toBe("C1-2026-04516");
  });
  it("rejects source identity conflicts instead of relabeling another row", () => {
    expect(() => adaptNative({ ...native("dockets", { id: 12 }), native_id: "99" }, adapterContext())).toThrow("Native ID");
  });
  it("links FR proposals to their exact RIN and preserves uncategorized publications without inventing a regulatory type", () => {
    const c = adapterContext();
    const row = { ...native("documents", { document_number: "00-1000", title: "Proposed rule", type: "Proposed Rule", publication_date: "2000-03-01", regulation_id_numbers: ["0910-AA01"], docket_ids: ["FDA-2000-N-0001"] }), source_system: "federalregister", native_id: "00-1000" };
    const records = adaptNative(row, c).records.map(r => legalRecord.parse(r));
    expect(records.map(r => r.type)).toEqual(["fr_document", "rule_proceeding"]);
    expect(nativeRecordEdges(records[0]!, c)[0]?.type).toBe("proposes");
    const unclassified = legalRecord.parse(adaptNative({ ...row, data: { ...row.data, type: "Uncategorized Document" } }, c).records[0]);
    expect(unclassified.type).toBe("source_doc"); expect(unclassified.attributes["fr_document_type"]).toBeUndefined();
  });
});
