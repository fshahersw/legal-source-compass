import { z } from "zod";
import { LEGAL_ENUMS, calendarDate, enumOf, legalEdge, legalRecord, recordKey, recordRef, text } from "./schema.ts";
import { visibleEdge } from "./graph.ts";
export const mdlPacket = z.object({
  schema_version: z.literal("legal-atlas/3.1"), mdl: recordRef, records: z.array(legalRecord), edges: z.array(legalEdge),
  documents: z.array(z.object({ record: recordRef, section: enumOf(LEGAL_ENUMS.mdl_section), classification: enumOf(LEGAL_ENUMS.order_class) })),
  leadership: z.array(z.object({ name: text, role: enumOf(LEGAL_ENUMS.counsel_role), source_record: recordRef, date: calendarDate })),
  as_of: calendarDate, complete: z.boolean(), qualifications: z.array(text),
}).strict().superRefine((packet, ctx) => {
  const records = new Map(packet.records.map((r) => [recordKey(r), r]));
  if (records.size !== packet.records.length || !records.has(recordKey(packet.mdl)) || packet.mdl.type !== "mdl") ctx.addIssue({ code: "custom", message: "The packet requires unique records and its canonical MDL" });
  for (const edge of packet.edges) if (!visibleEdge(edge, records)) ctx.addIssue({ code: "custom", message: "Only reviewed, resolved evidence belongs in a display packet" });
  for (const document of packet.documents) if (!records.has(recordKey(document.record))) ctx.addIssue({ code: "custom", message: "Document reference is missing" });
  for (const row of packet.leadership) {
    const source = records.get(recordKey(row.source_record));
    if (!source || source.attributes["document_role"] !== "appointment_order" || source.date !== row.date) ctx.addIssue({ code: "custom", message: "Leadership requires a dated appointment-order source" });
  }
  if (packet.complete && (!packet.leadership.length || !packet.edges.some((e) => e.type === "presided_by") || !packet.edges.some((e) => e.type === "transferred_by"))) ctx.addIssue({ code: "custom", message: "Incomplete evidence cannot be marked complete" });
});
export type MdlPacket = z.infer<typeof mdlPacket>;

export const qualitySnapshot = z.object({
  schema_version: z.literal("legal-atlas/3.1"), as_of: z.string().datetime({ offset: true }), location: z.enum(["local_staging", "supabase"]), complete: z.literal(false),
  counts: z.object({ candidate_records: z.number().int().nonnegative(), schema_valid: z.number().int().nonnegative(), schema_invalid: z.number().int().nonnegative(), financial_native_rows: z.number().int().nonnegative().nullable() }),
  by_type: z.record(z.object({ total: z.number().int().nonnegative(), invalid: z.number().int().nonnegative() })),
  coverage: z.array(z.object({ source: enumOf(LEGAL_ENUMS.data_source), year: z.number().int().min(2000), source_rows: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), supporting: z.number().int().nonnegative().nullable(), excluded: z.number().int().nonnegative().nullable(), status: enumOf(LEGAL_ENUMS.load_status) })),
  qualifications: z.array(text),
});
export type QualitySnapshot = z.infer<typeof qualitySnapshot>;

/** Use the persisted database report and its contemporaneous coverage snapshot.
 * A missing report is an unavailable result, never an invented zero population. */
export function qualityFromSupabase(value: unknown): QualitySnapshot {
  const count = z.object({ total: z.number().int().nonnegative(), invalid: z.number().int().nonnegative() });
  const response = z.object({ schema_version: z.literal("legal-atlas/3.1"), report: z.object({ reported_at: z.string(), counts_by_type: z.record(count), coverage: z.array(z.object({
    source_name: enumOf(LEGAL_ENUMS.data_source), year: z.number().int(), source_rows: z.number().int().nonnegative(), accepted_rows: z.number().int().nonnegative(), rejected_rows: z.number().int().nonnegative(), status: enumOf(LEGAL_ENUMS.load_status),
  })) }).nullable() }).parse(value);
  if (!response.report) throw Error("A database quality report has not been generated");
  const byType = response.report.counts_by_type;
  for (const type of Object.keys(LEGAL_ENUMS.entity_type)) if (!byType[type]) throw Error("Database quality report is missing an entity type");
  const counts = Object.values(byType);
  if (counts.some(c => c.invalid > c.total)) throw Error("Database quality counts do not reconcile");
  const total = counts.reduce((n, c) => n + c.total, 0), invalid = counts.reduce((n, c) => n + c.invalid, 0);
  return qualitySnapshot.parse({ schema_version: response.schema_version, as_of: new Date(response.report.reported_at).toISOString(), location: "supabase", complete: false,
    counts: { candidate_records: total, schema_valid: total - invalid, schema_invalid: invalid, financial_native_rows: null }, by_type: byType,
    coverage: response.report.coverage.map(r => ({ source: r.source_name, year: r.year, source_rows: r.source_rows, accepted: r.accepted_rows, rejected: r.rejected_rows,
      supporting: null, excluded: null, status: r.status })),
    qualifications: ["Counts come from the latest persisted Supabase schema report. Imports received after its timestamp appear in the next report.",
      "Source rows may include supporting or excluded native records; accepted counts describe mapped inputs.", "Original-source and entity audits remain incomplete. These counts do not establish complete historical coverage."] });
}
