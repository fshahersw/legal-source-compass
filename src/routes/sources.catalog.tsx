import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { pageHead } from "@/lib/corpus/head";
import { useAtlas } from "@/lib/atlas/store";
import { countField, filterCatalog, loadCatalogIndex, loadCatalogJurisdiction, type CatalogEntry } from "@/lib/atlas/catalog";

type Search = { j?: string };

export const Route = createFileRoute("/sources/catalog")({
  validateSearch: (s: Record<string, unknown>): Search => ({ j: typeof s["j"] === "string" ? s["j"] : undefined }),
  head: () => pageHead("Source catalog", "9,348 imported legal and regulatory sources by jurisdiction, category and access method."),
  component: CatalogPage,
});

function CatalogPage() {
  const { j = "us" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const idx = useQuery({ queryKey: ["catalog-index"], queryFn: loadCatalogIndex, staleTime: Infinity });
  const rows = useQuery({ queryKey: ["catalog", j], queryFn: () => loadCatalogJurisdiction(j), staleTime: Infinity });
  const { bundle } = useAtlas();
  const lib = useMemo(() => new Set((bundle?.sources ?? []).map((s) => s.url)), [bundle]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [access, setAccess] = useState("");
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const all = rows.data ?? [];
  const shown = filterCatalog(all, { q, category: category || undefined, access: access || undefined });
  const sel = "h-8 rounded-md border border-border bg-background px-2 text-[12px]";
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Source catalog" }]} title="Source catalog" description="Imported from your catalog file. Categories and verification labels are the file's own draft metadata, not checked by this app.">
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Jurisdiction" className={sel} value={j} onChange={(e) => navigate({ search: { j: e.target.value } })}>
          {(idx.data?.jurisdictions ?? []).map((x) => <option key={x.jurisdiction} value={x.jurisdiction}>{x.label} ({x.count.toLocaleString()})</option>)}
        </select>
        <input aria-label="Search" placeholder="Search title, URL, host…" className={`${sel} w-64`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Category" className={sel} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {countField(all, "category").map((c) => <option key={c.key} value={c.key}>{c.key} ({c.count})</option>)}
        </select>
        <select aria-label="Access method" className={sel} value={access} onChange={(e) => setAccess(e.target.value)}>
          <option value="">All access methods</option>
          {countField(all, "access_method").map((c) => <option key={c.key} value={c.key}>{c.key} ({c.count})</option>)}
        </select>
        <span className="self-center text-[12px] text-muted-foreground">{rows.isLoading ? "Loading…" : `${shown.length.toLocaleString()} of ${all.length.toLocaleString()} · ${all.filter((r) => lib.has(r.url)).length} also in the source library (exact URL)`}</span>
      </div>
      {rows.error ? <p className="text-[13px] text-destructive">{(rows.error as Error).message}</p> : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full table-fixed text-[13px]">
            <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground"><tr><th className="w-1/2 px-3 py-1.5">Title</th><th className="px-3 py-1.5">Host</th><th className="px-3 py-1.5">Category</th><th className="w-10" /></tr></thead>
            <tbody>
              {shown.slice(0, 200).map((r) => (
                <tr key={r.id} tabIndex={0} role="button" onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(r); }} className="cursor-pointer border-t border-border hover:bg-muted/50">
                  <td className="truncate px-3 py-1.5">{r.title || r.url}{lib.has(r.url) ? <span className="ml-2 rounded bg-muted px-1 text-[10px] text-muted-foreground">in library</span> : null}</td>
                  <td className="truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{r.host}</td>
                  <td className="truncate px-3 py-1.5 text-[12px] text-muted-foreground">{r.category ?? "Not recorded"}</td>
                  <td className="px-2"><a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="Open website"><ExternalLink className="size-3.5 text-muted-foreground" /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 200 ? <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">First 200 shown — narrow with search or filters.</p> : null}
        </section>
        <aside className="rounded-lg border border-border bg-surface p-3 text-[13px] shadow-card">
          {open ? (
            <dl className="space-y-1.5">
              <h2 className="font-medium">{open.title}</h2>
              <a href={open.url} target="_blank" rel="noreferrer" className="block break-all text-[12px] underline">{open.url}</a>
              {([["Category", open.category], ["Layer", open.layer], ["Access", open.access_method], ["Requirements", open.access_requirements], ["Type", open.source_type], ["Format", open.content_kind], ["Imported status", open.verification_status], ["As of", open.source_as_of], ["Section", open.section], ["Notes", open.notes], ["Description", open.description], ["Caveat", open.caveat]] as const).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v || "Not recorded"}</dd></div>
              ))}
            </dl>
          ) : <p className="text-muted-foreground">Select a row to see its details.</p>}
        </aside>
      </div>
    </AppShell>
  );
}
