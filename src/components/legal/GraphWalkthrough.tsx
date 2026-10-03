import { useMemo, useState } from "react";
import { LEGAL_ENUMS, recordKey } from "@/lib/legal/schema";
import type { LegalEdge, LegalRecord, RecordRef } from "@/lib/legal/schema";
import { exportCitedPath, typedNeighbors } from "@/lib/legal/graph";
import { Button } from "@/components/ui/button";

export function GraphWalkthrough({ records, edges, start }: { records: LegalRecord[]; edges: LegalEdge[]; start: RecordRef }) {
  const byKey = useMemo(() => new Map(records.map((r) => [recordKey(r), r])), [records]);
  const first = byKey.get(recordKey(start));
  const [path, setPath] = useState<LegalRecord[]>(() => first ? [first] : []);
  const [pathEdges, setPathEdges] = useState<LegalEdge[]>([]);
  const current = path.at(-1);
  if (!first || !current) return <p className="text-sm text-muted-foreground">No reviewed graph record is available.</p>;
  const neighbors = typedNeighbors(current, edges, byKey);
  const exportPath = () => {
    const text = exportCitedPath(path, pathEdges, byKey);
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "cited-graph-path.md"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="rounded-lg border border-border p-4" aria-label="Evidence graph">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Explore the evidence graph</h3><Button variant="outline" size="sm" onClick={exportPath}>Export cited path</Button></div>
    <nav aria-label="Graph path" className="mb-3 flex flex-wrap gap-1 text-xs">
      {path.map((node, index) => <span key={`${recordKey(node)}-${index}`}>{index > 0 ? " / " : ""}<button className="max-w-64 truncate text-left text-primary underline" onClick={() => { setPath(path.slice(0, index + 1)); setPathEdges(pathEdges.slice(0, index)); }}>{node.title}</button></span>)}
    </nav>
    <p className="mb-1 text-xs text-muted-foreground">{LEGAL_ENUMS.entity_type[current.type]} · {current.id} · {current.date}</p>
    <p className="text-sm font-medium">{current.title}</p>
    <a className="text-xs text-primary underline" href={current.source_url} target="_blank" rel="noreferrer">Original source</a>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {[...neighbors].map(([type, rows]) => <div key={type} className="rounded border border-border p-3">
        <h4 className="mb-2 text-xs font-semibold">{LEGAL_ENUMS.edge_type[type]}</h4>
        <ul className="space-y-2">{rows.map(({ record, edge, direction }, i) => <li key={`${recordKey(record)}-${i}`} className="text-xs">
          <button className="text-left text-primary underline" disabled={path.length >= 50} onClick={() => { setPath([...path, record]); setPathEdges([...pathEdges, edge]); }}>{record.title}</button>
          <div className="mt-1 text-muted-foreground">{direction === "incoming" ? "Incoming relationship" : "Outgoing relationship"} · {edge.date} · <a className="underline" href={edge.source_url} target="_blank" rel="noreferrer">Evidence</a></div>
        </li>)}</ul>
      </div>)}
    </div>
    {!neighbors.size && <p className="mt-3 text-xs text-muted-foreground">No reviewed neighbors in the current evidence packet.</p>}
  </section>;
}
