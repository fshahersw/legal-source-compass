import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LEGAL_ENUMS } from "@/lib/legal/schema";
import type { QualitySnapshot } from "@/lib/legal/packets";
import { qualitySnapshot } from "@/lib/legal/packets";
import { getLegalStagingQuality } from "@/lib/external/legal.functions";

export function LegalCoverage() {
  const query = useQuery({ queryKey: ["legal-staging-coverage"], queryFn: async () => qualitySnapshot.parse(JSON.parse((await getLegalStagingQuality()).json)), staleTime: 300_000 });
  if (query.isPending) return <p className="text-xs text-muted-foreground">Loading source-year coverage…</p>;
  if (query.isError) return <p className="text-xs text-destructive">Source-year coverage could not be loaded.</p>;
  return <LegalCoverageView snapshot={query.data} />;
}
export function LegalCoverageView({ snapshot }: { snapshot: QualitySnapshot }) {
  const [source, setSource] = useState<keyof typeof LEGAL_ENUMS.data_source>("courtlistener");
  const rows = snapshot.coverage.filter((row) => row.source === source);
  const download = () => {
    const columns = ["source", "year", "source_rows", "accepted", "rejected", "supporting", "excluded", "status"] as const;
    const text = [columns.join(","), ...snapshot.coverage.map((row) => columns.map((c) => row[c]).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "source-year-staging-coverage.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="mb-6 rounded-lg border border-border p-4" aria-label="Controlled schema and historical source coverage">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Controlled records · coverage from 2000</h2><button onClick={download} className="text-xs text-primary underline">Export coverage CSV</button></div>
    <p className="mt-2 text-xs text-muted-foreground">{snapshot.location === "supabase" ? "Supabase schema report" : "Local staging snapshot"} · {new Date(snapshot.as_of).toLocaleString()} · Source audits incomplete</p>
    <dl className="my-4 grid grid-cols-3 gap-3 text-xs">{[["Candidate records", snapshot.counts.candidate_records], ["Pass schema", snapshot.counts.schema_valid], ["Need schema review", snapshot.counts.schema_invalid]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{Number(value).toLocaleString()}</dd></div>)}</dl>
    <details className="mb-4 text-xs"><summary className="cursor-pointer">Schema counts by entity type</summary><table className="mt-2 w-full text-left"><thead><tr><th className="py-1">Entity type</th><th>Candidates</th><th>Invalid</th></tr></thead><tbody>{Object.entries(snapshot.by_type).filter(([type]) => type in LEGAL_ENUMS.entity_type).map(([type, count]) => <tr key={type} className="border-t border-border"><td className="py-1">{LEGAL_ENUMS.entity_type[type as keyof typeof LEGAL_ENUMS.entity_type]}</td><td>{count.total.toLocaleString()}</td><td>{count.invalid.toLocaleString()}</td></tr>)}</tbody></table></details>
    <label className="mb-2 flex items-center gap-2 text-xs">Source<select value={source} onChange={(event) => setSource(event.target.value as keyof typeof LEGAL_ENUMS.data_source)} className="rounded border border-border bg-background p-2">{Object.entries(LEGAL_ENUMS.data_source).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-background"><tr><th className="py-2">Year</th><th>Source rows</th><th>Accepted</th><th>Rejected</th><th>Coverage</th></tr></thead><tbody>{rows.map((row) => <tr key={row.year} className="border-t border-border"><td className="py-2">{row.year}</td><td>{row.source_rows.toLocaleString()}</td><td>{row.accepted.toLocaleString()}</td><td>{row.rejected.toLocaleString()}</td><td>{LEGAL_ENUMS.load_status[row.status]}</td></tr>)}</tbody></table></div>
    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{snapshot.qualifications.map((q) => <li key={q}>{q}</li>)}</ul>
  </section>;
}
