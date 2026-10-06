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

const markdownText = (s: string) => s.replace(/[\\`*_{}[\]()<>#|]/g, "\\$&").replace(/[\r\n]+/g, " ");
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
