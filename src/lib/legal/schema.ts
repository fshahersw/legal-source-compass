import { z } from "zod";
import vocabulary from "./enums.json" with { type: "json" };
import { ID_PATTERNS, ID_AUTHORITIES, NATIVE_NUMERIC_TYPES, NATIVE_NUMERIC_AUTHORITIES } from "./identity.ts";

/** The only controlled vocabulary. Ingest scripts and browser code use this file. */
export const LEGAL_ENUMS = vocabulary;
export const LEGAL_SCHEMA_VERSION = vocabulary.version;
export function enumOf<T extends Record<string, string>>(labels: T) {
  return z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]);
}
export const EntityType = enumOf(vocabulary.entity_type);
export type EntityType = z.infer<typeof EntityType>;
export const EdgeType = enumOf(vocabulary.edge_type);
export type EdgeType = z.infer<typeof EdgeType>;
export const OrderClass = enumOf(vocabulary.order_class);
export type OrderClass = z.infer<typeof OrderClass>;
export const Jurisdiction = enumOf(vocabulary.jurisdiction);
export const DateType = enumOf(vocabulary.date_type);
export const text = z.string().trim().min(1);
export const httpUrl = z.string().url().refine((s) => {
  try {
    const u = new URL(s);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password;
  } catch { return false; }
}, "An HTTP(S) source URL without credentials is required");
export const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}, "Invalid calendar date");
export const recordRef = z.object({
  id: text, type: EntityType, id_authority: enumOf(vocabulary.id_authority), version: text,
}).strict();
export type RecordRef = z.infer<typeof recordRef>;
export function recordKey(ref: RecordRef): string {
  return JSON.stringify([ref.id_authority, ref.type, ref.id, ref.version]);
}

export const legalRecord = z.object({
  id: text, type: EntityType, id_authority: enumOf(vocabulary.id_authority),
  title: text, title_source: enumOf(vocabulary.title_source), jurisdiction: Jurisdiction,
  court_id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i).nullable(),
  date: calendarDate, date_type: DateType,
  source_url: httpUrl, source_name: text, licence: text,
  retrieved_at: z.string().datetime({ offset: true }), version: text,
  confidence: z.number().finite().min(0).max(1), extraction_method: enumOf(vocabulary.extraction_method),
  identifiers: z.record(z.union([text, z.array(text).nonempty()])),
  attributes: z.record(z.unknown()),
}).strict().superRefine((r, ctx) => {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const idPattern = ID_PATTERNS[r.type];
  const authorities = ID_AUTHORITIES[r.type];
  if (idPattern && !new RegExp(idPattern).test(r.id)) fail(["id"], "Identifier must retain the publisher's canonical form");
  if (authorities && !authorities.includes(r.id_authority)) fail(["id_authority"], "Use the official identifier authority for this entity type");
  if (NATIVE_NUMERIC_TYPES.includes(r.type) && NATIVE_NUMERIC_AUTHORITIES.includes(r.id_authority) && !/^[1-9]\d*$/.test(r.id)) fail(["id"], "Expected a native numeric identifier");
  if (r.type === "court" && (r.id_authority !== "courtlistener" || r.court_id !== r.id)) fail(["court_id"], "Court identity must use the CourtListener court ID");
  if (r.type === "judge") {
    if (!r.identifiers["courtlistener_person_id"] && !r.identifiers["fjc_nid"]) fail(["identifiers"], "A judge requires a CourtListener person ID or FJC nid");
    const native = r.id_authority === "fjc" ? r.identifiers["fjc_nid"] : r.identifiers["courtlistener_person_id"];
    if (native !== r.id) fail(["id"], "Judge ID disagrees with the official identifier");
  }
  if (r.type === "fr_document" && !enumOf(vocabulary.fr_document_type).safeParse(r.attributes["fr_document_type"]).success) fail(["attributes", "fr_document_type"], "Use the Federal Register document enum");
  if (r.type === "cfr_section" && (!calendarDate.safeParse(r.attributes["version_date"]).success || r.attributes["version_date"] !== r.version)) fail(["version"], "CFR citations require the exact point-in-time version date");
  if (r.type === "usc_section" && (!text.safeParse(r.attributes["release_point"]).success || r.attributes["release_point"] !== r.version)) fail(["version"], "USC citations require the exact release point");
  if (r.type === "agency" && !(r.attributes["parent_agency"] === null || typeof r.attributes["parent_agency"] === "string")) fail(["attributes", "parent_agency"], "Preserve the Federal Register parent agency, including null");
  if (r.type === "image") {
    const imageFields = z.object({ alt: text, object_key: text, kind: enumOf(vocabulary.image_kind), origin: enumOf(vocabulary.image_origin), review_status: enumOf(vocabulary.review_status), origin_verified: z.boolean() });
    const result = imageFields.safeParse(r.attributes);
    if (!result.success) fail(["attributes"], "Image needs alt text, object storage key, permitted origin and review status");
  }
  if (r.attributes["order_class"] !== undefined && !OrderClass.safeParse(r.attributes["order_class"]).success) fail(["attributes", "order_class"], "Invalid order classification");
  if (r.attributes["document_role"] !== undefined && !enumOf(vocabulary.document_role).safeParse(r.attributes["document_role"]).success) fail(["attributes", "document_role"], "Invalid document role");
  if (r.date_type === "retrieved" && r.date !== r.retrieved_at.slice(0, 10)) fail(["date"], "A retrieved date must match its retrieval timestamp");
  if (r.date_type === "retrieved" && ["opinion", "docket", "case", "docket_entry", "fr_document", "bill", "public_law"].includes(r.type)) fail(["date_type"], "Dated legal documents require their source event date; retrieval cannot fill missing filing/publication dates");
  if (/^(unknown|not recorded|n\/a|unverified)$/i.test(r.licence)) fail(["licence"], "Unknown licence stays in staging");
});
export type LegalRecord = z.infer<typeof legalRecord>;

export const evidenceSpan = z.union([
  z.object({ paragraph_id: text }).strict(),
  z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict().refine((x) => x.end > x.start, "Evidence end must follow start"),
]);
export const legalEdge = z.object({
  type: EdgeType, from: recordRef, to: recordRef, source_record: recordRef,
  source_url: httpUrl, date: calendarDate,
  extraction_method: enumOf(vocabulary.edge_method), confidence: z.number().finite().min(0).max(1),
  evidence: evidenceSpan, review_status: enumOf(vocabulary.review_status),
  treatment: enumOf(vocabulary.treatment).nullable(), role: enumOf(vocabulary.counsel_role).nullable(),
}).strict().superRefine((e, ctx) => {
  const pairs: Record<EdgeType, [EntityType[], EntityType[]]> = {
    cites: [["opinion", "source_doc"], ["opinion"]],
    cites_statute: [["opinion", "source_doc"], ["usc_section", "state_statute_section"]],
    cites_regulation: [["opinion", "source_doc"], ["cfr_section"]],
    authority_for: [["usc_section"], ["cfr_section"]], amends: [["fr_document"], ["cfr_section"]], affects: [["fr_document"], ["cfr_section"]],
    proposes: [["fr_document"], ["rule_proceeding"]], finalizes: [["fr_document"], ["rule_proceeding"]],
    enacts: [["public_law"], ["usc_section"]], regulates: [["agency", "cfr_section"], ["product"]],
    mentions: [["opinion", "docket_entry", "source_doc", "fr_document", "science_doc", "bill", "public_law", "agency_action", "cfr_section", "usc_section", "state_statute_section"], EntityType.options],
    presided_by: [["case", "mdl"], ["judge"]], filed_in: [["case"], ["court"]], member_of: [["case"], ["mdl"]],
    transferred_by: [["mdl"], ["source_doc", "docket_entry", "opinion"]], coordinated_with: [["mdl", "state_coordinated_proceeding"], ["mdl", "state_coordinated_proceeding"]],
    represents: [["attorney", "law_firm"], ["party"]], appeal_of: [["case"], ["case"]], same_as: [EntityType.options, EntityType.options],
  };
  if (!pairs[e.type][0].includes(e.from.type) || !pairs[e.type][1].includes(e.to.type)) ctx.addIssue({ code: "custom", message: "Invalid endpoint types for this relationship" });
  if (["same_as", "coordinated_with"].includes(e.type) && (e.type === "same_as" ? e.from.type !== e.to.type : e.from.type === e.to.type)) ctx.addIssue({ code: "custom", message: "Incompatible endpoint types" });
  if (recordKey(e.from) === recordKey(e.to)) ctx.addIssue({ code: "custom", message: "Self edges are not evidence of a relationship" });
  if (e.treatment && e.type !== "cites") ctx.addIssue({ code: "custom", path: ["treatment"], message: "Treatment applies only to citations" });
  if (e.role && e.type !== "represents") ctx.addIssue({ code: "custom", path: ["role"], message: "Counsel role applies only to represents" });
});
export type LegalEdge = z.infer<typeof legalEdge>;
export function edgeNeedsReview(edge: LegalEdge): boolean {
  return edge.review_status === "pending" || (edge.extraction_method === "llm" && edge.confidence < 0.8);
}
