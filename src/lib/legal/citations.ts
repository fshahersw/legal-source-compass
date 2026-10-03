import { z } from "zod";
import { calendarDate, evidenceSpan, httpUrl, recordKey, recordRef, text } from "./schema.ts";
import type { LegalRecord, RecordRef } from "./schema.ts";
export const parsedCitation = z.object({
  source_record: recordRef, source_url: httpUrl, date: calendarDate,
  raw: text, normalized: text, evidence: evidenceSpan,
  extraction_method: z.literal("eyecite"), parser_version: text,
  source_text_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parser_class: text, groups: z.record(z.unknown()),
  resolved_record: recordRef.nullable(),
}).strict();
export type ParsedCitation = z.infer<typeof parsedCitation>;

/** Only exact normalized reporter citations may select a primary CourtListener ID.
 * Conflicting dates, courts or citations remain separate pending human review. */
export function primaryOpinion(record: LegalRecord, citations: readonly string[], index: ReadonlyMap<string, readonly LegalRecord[]>): { primary: RecordRef; requires_review: boolean; candidates: RecordRef[] } {
  const ref = (r: LegalRecord): RecordRef => ({ id: r.id, type: r.type, id_authority: r.id_authority, version: r.version });
  if (record.type !== "opinion") throw Error("Citation deduplication requires an opinion");
  if (record.id_authority === "courtlistener") return { primary: ref(record), requires_review: false, candidates: [] };
  const matches = new Map<string, LegalRecord>(); let conflict = false;
  for (const citation of new Set(citations)) {
    for (const candidate of index.get(citation) ?? []) {
      if (candidate.type !== "opinion" || candidate.id_authority !== "courtlistener") continue;
      if (candidate.date !== record.date || !candidate.court_id || !record.court_id || candidate.court_id !== record.court_id) { conflict = true; continue; }
      const key = `${candidate.id_authority}:${candidate.type}:${candidate.id}`;
      const prior = matches.get(key);
      if (!prior || candidate.retrieved_at > prior.retrieved_at) matches.set(key, candidate);
    }
  }
  const candidates = [...matches.values()].map(ref);
  return { primary: candidates.length === 1 && !conflict ? candidates[0]! : ref(record), requires_review: conflict || candidates.length !== 1, candidates };
}

export function citationSpanMatches(citation: ParsedCitation, source: LegalRecord): boolean {
  if (recordKey(citation.source_record) !== recordKey(source) || citation.source_url !== source.source_url || !("start" in citation.evidence)) return false;
  const original = source.attributes["text"];
  return typeof original === "string" && [...original].slice(citation.evidence.start, citation.evidence.end).join("") === citation.raw;
}
