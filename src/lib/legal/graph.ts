import { LEGAL_ENUMS, legalEdge, recordKey } from "./schema.ts";
import type { LegalEdge, LegalRecord, RecordRef, EdgeType } from "./schema.ts";

export function visibleEdge(edge: LegalEdge, records: ReadonlyMap<string, LegalRecord>): boolean {
  if (!legalEdge.safeParse(edge).success || edge.review_status !== "approved"
      || (edge.extraction_method === "llm" && edge.confidence < 0.8)) return false;
  const source = records.get(recordKey(edge.source_record));
  if (!source || !records.has(recordKey(edge.from)) || !records.has(recordKey(edge.to))) return false;
  if (source.source_url !== edge.source_url) return false;
  const from = records.get(recordKey(edge.from))!;
  const to = records.get(recordKey(edge.to))!;
  if (edge.type === "transferred_by" && (to.court_id !== "jpml" || to.attributes["document_role"] !== "transfer_order")) return false;
  if (edge.type === "cites" && from.type === "source_doc" && from.attributes["document_role"] !== "brief") return false;
  if (edge.type === "proposes" && from.attributes["fr_document_type"] !== "PRORULE") return false;
  if (edge.type === "finalizes" && from.attributes["fr_document_type"] !== "RULE") return false;
  // Evidence offsets refer to retained source text, never the display title.
  if ("start" in edge.evidence) {
    const text = source.attributes["text"];
    if (typeof text !== "string" || edge.evidence.end > [...text].length) return false;
  } else {
    const paragraphs = source.attributes["paragraphs"];
    if (!paragraphs || typeof paragraphs !== "object" || Array.isArray(paragraphs) || !Object.hasOwn(paragraphs, edge.evidence.paragraph_id)) return false;
  }
  return true;
}

export function typedNeighbors(node: RecordRef, edges: readonly LegalEdge[], records: ReadonlyMap<string, LegalRecord>) {
  const key = recordKey(node);
  const groups = new Map<EdgeType, { edge: LegalEdge; record: LegalRecord; direction: "outgoing" | "incoming" }[]>();
  for (const edge of edges) {
    if (!visibleEdge(edge, records)) continue;
    const outgoing = recordKey(edge.from) === key;
    if (!outgoing && recordKey(edge.to) !== key) continue;
    const ref = outgoing ? edge.to : edge.from;
    const group = groups.get(edge.type) ?? [];
    group.push({ edge, record: records.get(recordKey(ref))!, direction: outgoing ? "outgoing" : "incoming" });
    groups.set(edge.type, group);
  }
  return groups;
}

const markdownText = (s: string) => s.replace(/[\\`*_{}\[\]()<>#|]/g, "\\$&").replace(/[\r\n]+/g, " ");
export function exportCitedPath(nodes: readonly LegalRecord[], edges: readonly LegalEdge[], evidenceRecords?: ReadonlyMap<string, LegalRecord>): string {
  if (!nodes.length || edges.length !== nodes.length - 1) throw new Error("A path needs one relationship between each adjacent pair");
  const records = evidenceRecords ?? new Map(nodes.map((n) => [recordKey(n), n]));
  return nodes.map((node, i) => {
    const title = `${i + 1}. ${markdownText(node.title)} (${markdownText(node.id)}, ${node.date})`;
    const citation = `[Source](<${encodeURI(node.source_url).replaceAll(">", "%3E")}>)`;
    if (!i) return `${title} — ${citation}`;
    const edge = edges[i - 1]!;
    const previous = recordKey(nodes[i - 1]!);
    const current = recordKey(node);
    if (!visibleEdge(edge, records)
        || !((recordKey(edge.from) === previous && recordKey(edge.to) === current) || (recordKey(edge.to) === previous && recordKey(edge.from) === current))) throw new Error("The path contains an unreviewed or disconnected edge");
    const direction = recordKey(edge.from) === previous ? "outgoing" : "incoming";
    return `${title} — ${citation}\n   ${LEGAL_ENUMS.edge_type[edge.type]} (${direction}); evidence dated ${edge.date}: [Relationship source](<${encodeURI(edge.source_url).replaceAll(">", "%3E")}>)`;
  }).join("\n");
}

export type CourtAuthority = {
  id: string;
  level: keyof typeof LEGAL_ENUMS.court_level;
  jurisdiction: keyof typeof LEGAL_ENUMS.jurisdiction;
  circuit_id: string | null;
  parent_ids: string[];
};
export type PrecedentWeight = { weight: "binding" | "persuasive" | "undetermined"; reason: string };
/** Structural authority only. Subject matter, publication status and subsequent treatment still matter. */
export function precedentWeight(cited: CourtAuthority | null, citing: CourtAuthority | null,
  lawScope: keyof typeof LEGAL_ENUMS.law_scope, precedential: boolean | null): PrecedentWeight {
  if (!cited || !citing || lawScope === "unknown" || precedential === null || cited.jurisdiction === "UNKNOWN" || citing.jurisdiction === "UNKNOWN") return { weight: "undetermined", reason: "Court, governing law or precedential status is not recorded." };
  if (lawScope === "state" && citing.jurisdiction === "US") return { weight: "undetermined", reason: "The governing state's law must be identified before comparing state authority in a federal case." };
  if (!precedential) return { weight: "persuasive", reason: "The source marks this opinion nonprecedential." };
  if (lawScope === "federal" && cited.level === "supreme") return { weight: "binding", reason: "Supreme Court authority on federal law, subject to the holding and subsequent treatment." };
  if (lawScope === "federal" && cited.level === "circuit" && ["circuit", "district"].includes(citing.level)
      && !!cited.circuit_id && cited.circuit_id === citing.circuit_id) return { weight: "binding", reason: "Precedential circuit authority within the same circuit; panel and en banc rules still apply." };
  if (lawScope === "state" && cited.level === "state_supreme" && cited.jurisdiction === citing.jurisdiction) return { weight: "binding", reason: "The state's highest court controls its own state law." };
  if (lawScope === "state" && cited.level === "state_appellate" && citing.level === "state_trial" && citing.parent_ids.includes(cited.id)) return { weight: "binding", reason: "Recorded state appellate hierarchy for this trial court, subject to state-specific rules." };
  return { weight: "persuasive", reason: "No controlling relationship is established by the recorded hierarchy and governing law." };
}

export function authorityTree(courtId: string, courts: ReadonlyMap<string, CourtAuthority>): { id: string; depth: number; cycle: boolean }[] {
  const result: { id: string; depth: number; cycle: boolean }[] = [];
  const visit = (id: string, depth: number, branch: Set<string>) => {
    if (depth > 20) return;
    const cycle = branch.has(id);
    result.push({ id, depth, cycle });
    if (cycle) return;
    const next = new Set(branch).add(id);
    for (const parent of courts.get(id)?.parent_ids ?? []) visit(parent, depth + 1, next);
  };
  visit(courtId, 0, new Set());
  return result;
}
