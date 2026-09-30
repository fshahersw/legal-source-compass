import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BarList, Stat } from "@/components/corpus/BarList";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { categoryLabel, filterDocs, isDownloadable, loadDocs, summarize } from "@/lib/atlas/mdlDocuments";

const PAGE = 25;

/** Docket documents for one MDL or one court, from the uploaded documents file. */
export function DocketDocuments({ kind, id }: { kind: "mdl" | "court"; id: string }) {
  const q = useQuery({ queryKey: ["mdl-docs", kind, id], queryFn: () => loadDocs(kind, id), staleTime: Infinity });
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [onlyFiles, setOnlyFiles] = useState(false);
  const [page, setPage] = useState(0);
  const docs = q.data ?? [];
  const summary = useMemo(() => summarize(docs), [docs]);
  const rows = useMemo(() => filterDocs(docs, { q: text, category, onlyDownloadable: onlyFiles }).sort((a, b) => (b.entry_date_filed ?? "").localeCompare(a.entry_date_filed ?? "")), [docs, text, category, onlyFiles]);

  if (q.isLoading) return <p className="text-[12px] text-muted-foreground">Loading docket documents…</p>;
  if (q.error) return <p className="text-[12px] text-destructive">{String((q.error as Error).message)} <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></p>;
  if (docs.length === 0) return <p className="text-[12px] text-muted-foreground">No docket documents in the uploaded file for this {kind === "mdl" ? "MDL" : "court"}.</p>;

  const years = summary.byMonth.reduce<Record<string, number>>((acc, m) => { const y = m.label.slice(0, 4); acc[y] = (acc[y] ?? 0) + m.count; return acc; }, {});
  const yearRows = Object.entries(years).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...yearRows.map(([, c]) => c));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Docket entries" value={summary.total} />
        <Stat label="Free PDFs" value={summary.downloadable} note="Available via RECAP" />
        <Stat label="Key filings" value={summary.highValue} note="Flagged high value in the file" />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <h3 className="eyebrow mb-3">Filings per year</h3>
          <div className="flex h-28 items-end gap-1">
            {yearRows.map(([y, c]) => (
              <div key={y} className="flex flex-1 flex-col items-center gap-1" title={`${y}: ${c.toLocaleString()}`}>
                <span className="w-full rounded-sm bg-primary" style={{ height: `${(c / max) * 88}px` }} />
                <span className="text-[9px] text-muted-foreground">{y.slice(2)}</span>
              </div>
            ))}
          </div>
        </section>
        <BarList title="Documents by type" rows={summary.byCategory} limit={8} unit="docket entries" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={text} onChange={(e) => { setText(e.target.value); setPage(0); }} placeholder="Search docket text" className="h-8 max-w-xs text-[12px]" />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} className="h-8 rounded-md border border-input bg-background px-2 text-[12px]">
          <option value="">All types</option>
          {summary.byCategory.map((c) => <option key={c.label} value={c.label}>{c.label} ({c.count})</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={onlyFiles} onChange={(e) => { setOnlyFiles(e.target.checked); setPage(0); }} /> Free PDFs only</label>
        <span className="text-[11px] text-muted-foreground">{rows.length.toLocaleString()} entries</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
            <tr><th className="px-2 py-1.5">Filed</th><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Entry</th>{kind === "court" ? <th className="px-2 py-1.5">MDL</th> : null}<th className="px-2 py-1.5">File</th></tr>
          </thead>
          <tbody>
            {shown.map((d, i) => (
              <tr key={`${d.doc_uid}-${i}`} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-2 py-1.5 font-mono">{d.entry_date_filed ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{d.entry_number ?? "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{categoryLabel(d.doc_category)}</td>
                <td className="max-w-xl px-2 py-1.5"><span className="line-clamp-2" title={d.entry_description ?? ""}>{d.entry_description ?? d.document_description ?? "—"}</span></td>
                {kind === "court" ? <td className="px-2 py-1.5">{d.mdl_number ? <Link to="/matters/$id" params={{ id: String(Number(d.mdl_number)) }} className="underline">MDL {Number(d.mdl_number)}</Link> : "—"}</td> : null}
                <td className="whitespace-nowrap px-2 py-1.5">
                  {isDownloadable(d) ? <a href={d.download_url!} target="_blank" rel="noreferrer" className="underline">PDF{d.page_count ? ` · ${d.page_count}p` : ""}</a> : <span className="text-muted-foreground">Not freely available</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE ? (
        <div className="flex items-center gap-2 text-[12px]">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} of {Math.ceil(rows.length / PAGE)}</span>
          <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}
