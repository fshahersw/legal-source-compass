import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useCorpus } from "@/lib/corpus/store";
import { stateByUsps } from "@/lib/corpus/geo";
import { pageHead } from "@/lib/corpus/head";
import { useStateCounty } from "./places.$state";
import { ExternalError } from "@/components/corpus/ExternalBadge";

export const Route = createFileRoute("/places/$state/$county")({
  head: ({ params }) => pageHead(`County ${params.county}`, `County detail within ${stateByUsps.get(params.state.toUpperCase())?.name ?? params.state}.`),
  component: CountyDetail,
});

function CountyDetail() {
  const { state, county } = Route.useParams();
  const { geo } = useCorpus();
  const c = geo?.counties.find((x) => x.id === county);
  const st = stateByUsps.get(state.toUpperCase());
  const q = useStateCounty(st?.name);
  const rows = useMemo(() => (q.data?.records ?? []).filter((r) => r.county_geoids.includes(county)), [q.data, county]);
  const byDataset = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.dataset, (m.get(r.dataset) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/50 p-3 text-[13px]" data-testid="county-detail">
      <div className="eyebrow">County · FIPS {county}</div>
      <div className="mt-0.5 font-display text-lg">{c ? `${c.name} County, ${st?.name ?? state}` : "Unknown county"}</div>
      {q.error ? <ExternalError error={q.error} /> : null}
      {q.isLoading ? <p className="mt-1 text-muted-foreground">Loading county records…</p> : (
        <>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {rows.length.toLocaleString()} records in your corpus are tagged with this county code{byDataset.length ? `: ${byDataset.map(([d, n]) => `${d} ${n}`).join(", ")}` : ""}. County tags come from the corpus itself and are not re-verified here.
          </p>
          <ul className="mt-2 max-h-80 divide-y divide-border overflow-auto rounded border border-border bg-surface">
            {rows.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 px-2 py-1.5">
                <span className="w-32 shrink-0 truncate text-[11px] text-muted-foreground">{r.category ?? r.dataset}</span>
                <span className="min-w-0 flex-1 truncate">{r.title || r.id}</span>
                {r.source_url ? <a href={r.source_url} target="_blank" rel="noreferrer" className="max-w-[40%] truncate font-mono text-[11px] underline">{r.source_url}</a> : null}
              </li>
            ))}
            {rows.length === 0 ? <li className="px-2 py-1.5 text-muted-foreground">No county-tagged records.</li> : null}
          </ul>
        </>
      )}
    </div>
  );
}
