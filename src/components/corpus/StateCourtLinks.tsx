import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { loadCatalogIndex, loadStateCourts } from "@/lib/atlas/catalog";

export function StateCourtLinks({ stateName, usps }: { stateName: string; usps: string }) {
  const q = useQuery({ queryKey: ["state-courts"], queryFn: loadStateCourts, staleTime: Infinity });
  const idx = useQuery({ queryKey: ["catalog-index"], queryFn: loadCatalogIndex, staleTime: Infinity });
  const sections = q.data?.states[stateName];
  const cat = idx.data?.jurisdictions.find((j) => j.jurisdiction === usps.toLowerCase());
  return (
    <section className="mt-5 rounded-lg border border-border bg-surface p-3 shadow-card">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="eyebrow">Official court and government websites</h2>
        {q.data ? <a href={q.data.source} target="_blank" rel="noreferrer" className="text-[12px] text-muted-foreground underline">Source: U.S. DOJ state resources</a> : null}
        {cat ? <Link to="/sources/catalog" search={{ j: cat.jurisdiction }} className="ml-auto text-[12px] underline">{cat.count.toLocaleString()} sources in the catalog</Link> : null}
      </div>
      {q.isLoading ? <p className="text-[12px] text-muted-foreground">Loading…</p> : !sections ? <p className="text-[12px] text-muted-foreground">Not recorded for this state.</p> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <div key={s.section}>
              <h3 className="mb-1 text-[12px] font-medium">{s.section} <span className="text-muted-foreground">({s.links.length})</span></h3>
              <ul className="max-h-48 space-y-0.5 overflow-auto text-[12px]">
                {s.links.map((l) => <li key={l.url + l.title}><a href={l.url} target="_blank" rel="noreferrer" className="hover:underline">{l.title}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
