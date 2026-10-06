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
