import { LEGAL_ENUMS, calendarDate, legalRecord, recordKey } from "./schema.ts";
import type { LegalRecord, RecordRef } from "./schema.ts";

export type NativeRow = { source_system: string; entity_type: string; native_id: string; data: Record<string, unknown>; provenance: Record<string, unknown> };
type Lookup<T> = { get(key: string): T | undefined; set(key: string, value: T): unknown };
export type AdapterContext = {
  courts: Map<string, LegalRecord>;
  judicialPeople: Set<string>;
  positions: Map<string, unknown[]>;
  education: Map<string, unknown[]>;
  courtStates: Map<string, Set<string>>;
  clusters: Lookup<NativeRow>;
  dockets: Lookup<NativeRow>;
  fjcNids: Map<string, string>;
  agencies: Map<string, NativeRow>;
};
export function adapterContext(): AdapterContext {
  return { courts: new Map(), judicialPeople: new Set(), positions: new Map(), education: new Map(), courtStates: new Map(), clusters: new Map(), dockets: new Map(), fjcNids: new Map(), agencies: new Map() };
}
export type Adapted = { records: unknown[]; status: "candidate" | "supporting" | "excluded"; reason: string | null };
const scalar = (v: unknown) => v === null || v === undefined ? "" : String(v).trim();
const nativeId = (v: unknown) => scalar(v).match(/(?:^|\/)([a-z0-9-]+)\/?$/i)?.[1] ?? "";
const day = (v: unknown) => calendarDate.safeParse(scalar(v).slice(0, 10)).success ? scalar(v).slice(0, 10) : null;
const support = (reason: string): Adapted => ({ records: [], status: "supporting", reason });
const exclude = (reason: string): Adapted => ({ records: [], status: "excluded", reason });
export function asRef(record: LegalRecord): RecordRef { return { id: record.id, type: record.type, id_authority: record.id_authority, version: record.version }; }

/** Exact native fields only. Missing identity, title or date is a validation failure. */
export function adaptNative(row: NativeRow, context: AdapterContext): Adapted {
  const d = row.data; const p = row.provenance;
  if (d["id"] !== undefined && scalar(d["id"]) !== row.native_id && !["federalregister", "federal_register"].includes(row.source_system)) throw new Error("Native ID disagrees with the retained publisher ID");
  const retrieved = scalar(p["retrieved_at"]);
  const version = scalar(p["record_sha256"] || p["source_as_of"] || p["source_sha256"]);
  const source = row.source_system;
  const base = {
    id: row.native_id, type: row.entity_type, id_authority: "courtlistener", title: "", title_source: "api",
    jurisdiction: "UNKNOWN", court_id: null as string | null, date: day(retrieved), date_type: "retrieved",
    source_url: scalar(p["source_url"]), source_name: "CourtListener", licence: "Public Domain Mark 1.0",
    retrieved_at: retrieved, version, confidence: 1, extraction_method: scalar(row.provenance["schema_version"] || "").includes("rest") ? "api" : "bulk",
    identifiers: { native_id: row.native_id } as Record<string, string>,
    attributes: { native_type: row.entity_type, native: d, source_snapshot: p["source_as_of"] ?? null,
      source_sha256: p["source_sha256"] ?? null, paragraphs: Object.fromEntries(Object.entries(d).map(([key, value]) => [key, JSON.stringify(value)])) } as Record<string, unknown>,
  };
  const candidate = (...records: unknown[]): Adapted => ({ records, status: "candidate", reason: null });
  if (source === "fjc" && row.entity_type === "judges") {
    const nid = scalar(d["nid"]);
    if (nid !== row.native_id) throw new Error("FJC nid disagrees with the retained publisher identity");
    const demographics = d["demographics"] as Record<string, unknown>;
    if (!demographics || scalar(demographics["nid"]) !== nid) throw new Error("FJC biography identity mismatch");
    const service = d["service"];
    if (!Array.isArray(service) || service.some(s => scalar(s?.["nid"]) !== nid)) throw new Error("FJC service identity mismatch");
    const person = scalar(d["courtlistener_person_id"]), legacy = scalar(d["jid"]);
    return candidate({ ...base, id: nid, type: "judge", id_authority: "fjc", jurisdiction: "US", source_name: "Federal Judicial Center", licence: "Public domain — US federal government work",
      title: [demographics["First Name"], demographics["Middle Name"], demographics["Last Name"], demographics["Suffix"]].map(scalar).filter(Boolean).join(" "),
      identifiers: { fjc_nid: nid, ...(legacy ? { fjc_legacy_id: legacy } : {}), ...(person ? { courtlistener_person_id: person } : {}) },
      attributes: { ...base.attributes, service, service_provenance: d["service_provenance"], biography_url: `https://www.fjc.gov/node/${nid}` } });
  }
  if (source === "courtlistener") {
    if (row.entity_type === "courts") {
      const code = scalar(d["jurisdiction"]);
      const states = [...(context.courtStates.get(row.native_id) ?? [])].filter((state) => state in LEGAL_ENUMS.jurisdiction);
      const jurisdiction = code.startsWith("F") || row.native_id === "scotus" ? "US" : states.length === 1 ? states[0]! : "UNKNOWN";
      const level = row.native_id === "scotus" ? "supreme" : ({ F: "circuit", FD: "district", S: "state_supreme", SA: "state_appellate", ST: "state_trial" } as Record<string, string>)[code] ?? "other";
      return candidate({ ...base, type: "court", title: scalar(d["full_name"] || d["short_name"]), court_id: row.native_id, jurisdiction,
        identifiers: { courtlistener_court_id: row.native_id }, attributes: { ...base.attributes, court_level: level, parent_court_id: d["parent_court_id"] ?? null } });
    }
    if (["people-db-people", "people"].includes(row.entity_type)) {
      if (!d["fjc_id"] && !context.judicialPeople.has(row.native_id)) return support("Person lacks a recorded judicial position; do not label appointers as judges");
      const nid = context.fjcNids.get(row.native_id);
      const identifiers: Record<string, string> = { courtlistener_person_id: row.native_id };
      // CourtListener fjc_id is a legacy FJC identifier, not the Drupal nid.
      if (d["fjc_id"]) identifiers["fjc_legacy_id"] = scalar(d["fjc_id"]);
      if (nid) identifiers["fjc_nid"] = nid;
      return candidate({ ...base, id: nid ?? row.native_id, type: "judge", id_authority: nid ? "fjc" : "courtlistener",
        title: [d["name_first"], d["name_middle"], d["name_last"], d["name_suffix"]].map(scalar).filter(Boolean).join(" "),
        identifiers, attributes: { ...base.attributes, positions: context.positions.get(row.native_id) ?? [], education: context.education.get(row.native_id) ?? [] } });
    }
    if (row.entity_type === "dockets") {
      if (d["blocked"] === true || d["blocked"] === "t" || d["date_blocked"]) return exclude("Publisher holds this docket");
      const filed = day(d["date_filed"]);
      if (filed && filed < "2000-01-01") return exclude("Filed before 2000-01-01");
      const courtId = scalar(d["court_id"]) || nativeId(d["court"]);
      const identifiers = { courtlistener_docket_id: row.native_id, ...(d["docket_number"] ? { pacer_case_number: scalar(d["docket_number"]) } : {}) };
      const record = { ...base, title: scalar(d["case_name"] || d["case_name_full"] || d["case_name_short"]), court_id: courtId || null,
        jurisdiction: context.courts.get(courtId)?.jurisdiction ?? "UNKNOWN", date: filed, date_type: "filed", identifiers };
      return candidate({ ...record, type: "docket" }, { ...record, type: "case" });
    }
    if (row.entity_type === "opinions") {
      const clusterId = scalar(d["cluster_id"]) || nativeId(d["cluster"]);
      const cluster = context.clusters.get(clusterId);
      const cd = cluster?.data ?? {};
      const filed = day(cd["date_filed"]);
      if (cd["blocked"] === true || cd["blocked"] === "t" || cd["date_blocked"]) return exclude("Publisher holds this opinion cluster");
      if (filed && filed < "2000-01-01") return exclude("Opinion filed before 2000-01-01");
      const docketId = scalar(cd["docket_id"]) || nativeId(cd["docket"]);
      const docket = context.dockets.get(docketId)?.data;
      const courtId = scalar(docket?.["court_id"]) || nativeId(docket?.["court"]);
      return candidate({ ...base, type: "opinion", title: scalar(cd["case_name"] || cd["case_name_full"]), court_id: courtId || null,
        jurisdiction: context.courts.get(courtId)?.jurisdiction ?? "UNKNOWN", date: filed, date_type: "filed",
        identifiers: { courtlistener_opinion_id: row.native_id, courtlistener_cluster_id: clusterId, ...(docketId ? { courtlistener_docket_id: docketId } : {}) },
        attributes: { ...base.attributes, text: scalar(d["plain_text"]), cluster: cd, precedential_status: cd["precedential_status"] ?? null } });
    }
    if (["docket-entries", "docket_entries"].includes(row.entity_type)) {
      const filed = day(d["date_filed"]);
      if (filed && filed < "2000-01-01") return exclude("Entry filed before 2000-01-01");
      const docketId = scalar(d["docket_id"]) || nativeId(d["docket"]);
      const parent = context.dockets.get(docketId)?.data;
      const courtId = scalar(parent?.["court_id"]) || nativeId(parent?.["court"]);
      const description = scalar(d["description"]);
      const parentTitle = scalar(parent?.["case_name"]);
      const fallback = parentTitle && d["entry_number"] != null ? `${parentTitle} — Entry ${scalar(d["entry_number"])}` : "";
      return candidate({ ...base, type: "docket_entry", title: description || fallback, title_source: description ? "api" : "parent_label", date: filed, date_type: "filed",
        court_id: courtId || null, jurisdiction: context.courts.get(courtId)?.jurisdiction ?? "UNKNOWN",
        identifiers: { courtlistener_docket_entry_id: row.native_id, courtlistener_docket_id: docketId },
        attributes: { ...base.attributes, order_class: "other", description_missing: !description, parent_title: parentTitle || null } });
    }
    if (["parties", "attorneys"].includes(row.entity_type)) return candidate({ ...base, type: row.entity_type === "parties" ? "party" : "attorney", title: scalar(d["name"]), identifiers: { courtlistener_id: row.native_id } });
    if (row.entity_type.startsWith("financial-disclosure")) return support("Disclosure native row retained for private judge-document joins and source review");
    if (["clusters", "opinion-clusters", "court-appeals-to", "courthouses", "citations", "citation-map", "people-db-positions", "people-db-educations", "people-db-schools", "people-db-political-affiliations", "people-db-races", "people_db_race", "people-db-retention-events", "search_opinion_joined_by", "search_opinioncluster_panel", "search_opinioncluster_non_participating_judges", "fjc-integrated-database", "originating-court-information", "parentheticals", "unmatched-citations"].includes(row.entity_type)) return support("Retain native support row for exact joins; it is not an independent entity in the controlled schema");
  }
  if (["federalregister", "federal_register"].includes(source) && row.entity_type === "documents") {
    const date = day(d["publication_date"]);
    if (date && date < "2000-01-01") return exclude("Published before 2000-01-01");
    const type = ({ Rule: "RULE", "Proposed Rule": "PRORULE", Notice: "NOTICE", "Presidential Document": "PRESDOCU" } as Record<string, string>)[scalar(d["type"])] ?? d["type"];
    if (row.native_id !== scalar(d["document_number"])) throw new Error("Federal Register document number disagrees with the retained ID");
    const uncategorized = d["type"] === "Uncategorized Document";
    const doc = { ...base, id: scalar(d["document_number"]), type: uncategorized ? "source_doc" : "fr_document", id_authority: "federal_register", title: scalar(d["title"]), jurisdiction: "US", source_name: "Federal Register", licence: "Public domain — US federal government work", date, date_type: "published", extraction_method: "api",
      source_url: scalar(d["html_url"] || p["source_url"]), identifiers: { federal_register_document_number: scalar(d["document_number"]) },
      attributes: { ...base.attributes, ...(uncategorized ? { document_role: "other", classification_qualification: "Publisher marks this publication uncategorized; it is retained as a source document, not assigned a regulatory type." } : { fr_document_type: type }), effective_dates: d["effective_on"] ?? null, cfr_references: d["cfr_references"] ?? [], regulation_id_numbers: d["regulation_id_numbers"] ?? [], docket_ids: d["docket_ids"] ?? [], agencies: d["agencies"] ?? [] } };
    const rins = Array.isArray(d["regulation_id_numbers"]) ? [...new Set(d["regulation_id_numbers"].map(scalar).filter(Boolean))] : [];
    return candidate(doc, ...rins.map(id => ({ ...doc, id, type: "rule_proceeding", title: `${id} — ${doc.title}`, title_source: "parent_label", identifiers: { rin: id, federal_register_document_number: doc.id },
      attributes: { ...base.attributes, regulation_id: id, regulations_gov_docket_ids: d["docket_ids"] ?? [], referencing_document: { id: doc.id, type: doc.type, id_authority: doc.id_authority, version: doc.version }, date_basis: "Referencing Federal Register publication" } })));
  }
  if (["federalregister", "federal_register"].includes(source) && row.entity_type === "agencies") {
    const parent = d["parent_id"] === null ? null : scalar(context.agencies.get(scalar(d["parent_id"]))?.data["slug"]) || undefined;
    return candidate({ ...base, id: scalar(d["slug"]), type: "agency", id_authority: "federal_register", title: scalar(d["name"]), jurisdiction: "US", source_name: "Federal Register", licence: "Public domain — US federal government work", extraction_method: "api",
      source_url: scalar(d["url"] || p["source_url"]), identifiers: { federal_register_agency_id: scalar(d["id"]), federal_register_agency_slug: scalar(d["slug"]) }, attributes: { ...base.attributes, parent_agency: parent } });
  }
  if (source === "cap" && row.entity_type === "cases") {
    const date = day(d["decision_date"]);
    if (date && date < "2000-01-01") return exclude("CAP decision predates 2000-01-01");
    const nativeCourt = d["court"] as { name?: string } | undefined;
    const nativeJurisdiction = d["jurisdiction"] as { name_long?: string } | undefined;
    const jurisdiction = nativeJurisdiction?.name_long === "United States" ? "US" : Object.entries(LEGAL_ENUMS.jurisdiction).find(([, name]) => name === nativeJurisdiction?.name_long)?.[0] ?? "UNKNOWN";
    const courts = [...context.courts.values()].filter(c => c.title === nativeCourt?.name && c.jurisdiction === jurisdiction);
    const body = d["casebody"] as { opinions?: { text?: string }[] } | undefined;
    const text = body?.opinions?.map(o => o.text ?? "").join("\n\n") ?? "";
    return candidate({ ...base, type: "opinion", id_authority: "cap", title: scalar(d["name_abbreviation"] || d["name"]), date, date_type: "decided", jurisdiction,
      court_id: courts.length === 1 ? courts[0]!.id : null, source_name: "Caselaw Access Project", licence: "CC0 1.0 Universal", extraction_method: "bulk",
      identifiers: { cap_case_id: row.native_id }, attributes: { ...base.attributes, text, citations: d["citations"] ?? [], archive_member: p["archive_member"], court_mapping: courts.length === 1 ? "unique_exact_name_and_jurisdiction" : null,
        dedupe_pending: true, primary_id_qualification: "CourtListener citation reconciliation is pending" } });
  }
  // Unmapped records are counted as failures, never silently coerced to source_doc.
  return candidate({ ...base, licence: "unknown", attributes: { ...base.attributes, mapping_error: `No reviewed mapping for ${source}/${row.entity_type}` } });
}

export function addSupportRow(row: NativeRow, context: AdapterContext): void {
  const d = row.data;
  if (row.source_system === "fjc" && row.entity_type === "person-crosswalk") {
    const nid = scalar(d["fjc_nid"]), person = scalar(d["courtlistener_person_id"]);
    if (!/^[1-9]\d*$/.test(nid) || !/^[1-9]\d*$/.test(person) || (context.fjcNids.has(person) && context.fjcNids.get(person) !== nid)) throw new Error("Ambiguous or malformed FJC/CourtListener crosswalk");
    context.fjcNids.set(person, nid);
  }
  if (["federalregister", "federal_register"].includes(row.source_system) && row.entity_type === "agencies") context.agencies.set(scalar(d["id"]), row);
  if (row.source_system !== "courtlistener") return;
  if (row.entity_type === "courthouses") {
    const id = scalar(d["court_id"]); const state = scalar(d["state"]);
    const set = context.courtStates.get(id) ?? new Set<string>(); if (state) set.add(state); context.courtStates.set(id, set);
  }
  if (row.entity_type === "people-db-positions") {
    const person = scalar(d["person_id"]); const positions = context.positions.get(person) ?? [];
    positions.push({ id: row.native_id, ...d, source_url: row.provenance["source_url"], retrieved_at: row.provenance["retrieved_at"] }); context.positions.set(person, positions);
    if (d["court_id"] && /(?:jud|jus|mag|chan)/.test(scalar(d["position_type"]))) context.judicialPeople.add(person);
  }
  if (row.entity_type === "people-db-educations") {
    const person = scalar(d["person_id"]); const education = context.education.get(person) ?? [];
    education.push({ id: row.native_id, ...d }); context.education.set(person, education);
  }
  if (["clusters", "opinion-clusters"].includes(row.entity_type)) context.clusters.set(row.native_id, row);
  if (row.entity_type === "dockets") context.dockets.set(row.native_id, row);
  if (row.entity_type === "courts") {
    const result = adaptNative(row, context);
    const record = legalRecord.safeParse(result.records[0]);
    if (record.success) context.courts.set(record.data.id, record.data);
  }
}

export function nativeCaseEdges(record: LegalRecord, context: AdapterContext) {
  if (record.type !== "case" || record.extraction_method !== "api") return [];
  const court = record.court_id ? context.courts.get(record.court_id) : null;
  if (!court || recordKey(record) === recordKey(court)) return [];
  const native = record.attributes["native"] as Record<string, unknown>;
  return [{ type: "filed_in", from: asRef(record), to: asRef(court), source_record: asRef(record), source_url: record.source_url, date: record.date,
    extraction_method: "api", confidence: 1, evidence: { paragraph_id: native["court_id"] ? "court_id" : "court" }, review_status: "approved", treatment: null, role: null }];
}

export function nativeRecordEdges(record: LegalRecord, context: AdapterContext) {
  if (record.type === "case") return nativeCaseEdges(record, context);
  if (record.type !== "fr_document" || !["PRORULE", "RULE"].includes(String(record.attributes["fr_document_type"]))) return [];
  const rins = record.attributes["regulation_id_numbers"];
  if (!Array.isArray(rins)) return [];
  return [...new Set(rins.map(scalar).filter(Boolean))].map(id => ({
    type: record.attributes["fr_document_type"] === "PRORULE" ? "proposes" : "finalizes", from: asRef(record), to: { id, type: "rule_proceeding", id_authority: "federal_register", version: record.version },
    source_record: asRef(record), source_url: record.source_url, date: record.date, extraction_method: "api", confidence: 1, evidence: { paragraph_id: "regulation_id_numbers" }, review_status: "pending", treatment: null, role: null,
  }));
}
