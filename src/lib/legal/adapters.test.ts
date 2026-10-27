import { describe, expect, it } from "vitest";
import { adapterContext, adaptNative, addSupportRow, nativeRecordEdges } from "./adapters";
import type { NativeRow } from "./adapters";
import { legalRecord } from "./schema";
import { FEDERAL_REGISTER_FIELDS, FEDERAL_REGISTER_SCHEMA_VERSION } from "./frRefresh";

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
    const row = frRow({ document_number: "2024-12345", title: "Rule", type: "Proposed Rule", publication_date: "2024-01-01", effective_on: null });
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
    const row = frRow({ document_number: "00-1000", title: "Proposed rule", type: "Proposed Rule", publication_date: "2000-03-01", regulation_id_numbers: ["0910-AA01"], docket_ids: ["FDA-2000-N-0001"] });
    const records = adaptNative(row, c).records.map(r => legalRecord.parse(r));
    expect(records.map(r => r.type)).toEqual(["fr_document", "rule_proceeding"]);
    expect(nativeRecordEdges(records[0]!, c)[0]?.type).toBe("proposes");
    const unclassified = legalRecord.parse(adaptNative({ ...row, data: { ...row.data, type: "Uncategorized Document" } }, c).records[0]);
    expect(unclassified.type).toBe("source_doc"); expect(unclassified.attributes["fr_document_type"]).toBeUndefined();
  });
  it("keeps a document valid when one listed RIN is not in canonical form, and links only the exact RINs", () => {
    // Shape of 2026-12787 (two RINs, one printed with a space): previously the whole row was rejected.
    const c = adapterContext();
    const row = frRow({ document_number: "2026-12787", title: "Final rule", type: "Rule", publication_date: "2026-06-30", regulation_id_numbers: ["3064-AF96", "7100 AG79"] });
    const adapted = adaptNative(row, c);
    const records = adapted.records.map(r => legalRecord.parse(r));
    expect(records.map(r => [r.type, r.id])).toEqual([["fr_document", "2026-12787"], ["rule_proceeding", "3064-AF96"]]);
    expect(records[0]!.attributes["unlinked_regulation_id_numbers"]).toEqual(["7100 AG79"]);
    expect(records[0]!.attributes["regulation_id_numbers"]).toEqual(["3064-AF96", "7100 AG79"]);
    const edges = nativeRecordEdges(records[0]!, c);
    expect(edges.map(e => [e.type, e.to.id])).toEqual([["finalizes", "3064-AF96"]]);
    // A document whose RINs are all canonical carries no unlinked list.
    expect(legalRecord.parse(adaptNative(frRow({ regulation_id_numbers: ["0910-AI60"] }), c).records[0]).attributes["unlinked_regulation_id_numbers"]).toBeUndefined();
  });
  it("accepts the publisher's republication numbers and pre-2009 Correction type", () => {
    const c = adapterContext();
    const republished = legalRecord.safeParse(adaptNative(frRow({ document_number: "R1-2026-05038", type: "Notice" }), c).records[0]);
    expect(republished.success).toBe(true);
    const correction = legalRecord.parse(adaptNative(frRow({ document_number: "03-5521", type: "Correction", publication_date: "2003-03-07" }), c).records[0]);
    expect(correction.type).toBe("fr_document"); expect(correction.attributes["fr_document_type"]).toBe("CORRECTION");
    // A correction never proposes or finalizes a rule.
    const withRin = legalRecord.parse(adaptNative(frRow({ document_number: "03-5522", type: "Correction", publication_date: "2003-03-07", regulation_id_numbers: ["0910-AA01"] }), c).records[0]);
    expect(nativeRecordEdges(withRin, c)).toEqual([]);
    // Nor does a post-2009 correction, which carries its parent's type and a C1- number (shape of C1-2026-20360).
    const numbered = legalRecord.parse(adaptNative(frRow({ document_number: "C1-2026-20360", type: "Proposed Rule", regulation_id_numbers: ["3235-AN83"] }), c).records[0]);
    expect(numbered.attributes["fr_document_type"]).toBe("PRORULE");
    expect(numbered.attributes["regulation_id_numbers"]).toEqual(["3235-AN83"]);
    expect(nativeRecordEdges(numbered, c)).toEqual([]);
    // A republication (R1-) is the document itself and keeps its edge.
    const republishedRule = legalRecord.parse(adaptNative(frRow({ document_number: "R1-2026-05039", type: "Rule", regulation_id_numbers: ["3235-AN83"] }), c).records[0]);
    expect(nativeRecordEdges(republishedRule, c).map(e => [e.type, e.to.id])).toEqual([["finalizes", "3235-AN83"]]);
    // Free-text and non-canonical numbers stay rejected rather than rewritten.
    expect(legalRecord.safeParse(adaptNative(frRow({ document_number: "00-23477-Filed" }), c).records[0]).success).toBe(false);
  });
  it("refuses Federal Register rows that are not the full API field set (the reduced 'dates' reference shape)", () => {
    const c = adapterContext();
    const reduced = frRow({ dates: "Comments due 2026-12-07." });
    for (const field of ["regulation_id_numbers", "docket_ids", "dockets", "comments_close_on", "regulations_dot_gov_info", "action"]) delete reduced.data[field];
    expect(() => adaptNative(reduced, c)).toThrow("lacks API fields");
    const unversioned = frRow(); delete unversioned.provenance["schema_version"];
    expect(() => adaptNative(unversioned, c)).toThrow("schema_version");
  });
});

/** A Federal Register API row in the legal atlas acquisition shape (all round-3 fields present). */
function frRow(over: Record<string, unknown> = {}): NativeRow {
  const data: Record<string, unknown> = Object.fromEntries(FEDERAL_REGISTER_FIELDS.map((f) => [f, null]));
  Object.assign(data, { document_number: "2026-19349", title: "Nonclinical testing terminology", type: "Proposed Rule", publication_date: "2026-10-07",
    agencies: [{ slug: "food-and-drug-administration" }], cfr_references: [], regulation_id_numbers: [], docket_ids: [], dockets: [],
    html_url: "https://www.federalregister.gov/documents/2026/10/07/2026-19349/example", regulation_id_number_info: {} }, over);
  if (typeof over["document_number"] === "string" && over["html_url"] === undefined) data["html_url"] = `https://www.federalregister.gov/d/${over["document_number"]}`;
  return { source_system: "federalregister", entity_type: "documents", native_id: String(data["document_number"]), data,
    provenance: { source_url: "https://www.federalregister.gov/api/v1/documents.json?x", retrieved_at: "2026-10-27T12:00:00Z", source_sha256: "b".repeat(64), record_sha256: "c".repeat(64), schema_version: FEDERAL_REGISTER_SCHEMA_VERSION, source_as_of: "2026-10-27" } };
}
