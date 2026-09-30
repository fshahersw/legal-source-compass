import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { pageHead } from "@/lib/corpus/head";
import { coverageMatrix, humanize, isReachable, jurisdictionLabel } from "@/lib/atlas/registry";
import { useRegistry } from "@/lib/atlas/useRegistry";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/sources/coverage")({
  head: () => pageHead("Coverage gaps", "Where the source registry and the source directory have — and lack — sources, by state and record type."),
  component: CoveragePage,
});

function CoveragePage() {
  const reg = useRegistry();
  const atlas = useAtlas();
  const m = useMemo(() => coverageMatrix(reg.data?.entries ?? []), [reg.data]);
  const v22 = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of atlas.bundle?.sources ?? []) if (s.jurisdiction) c.set(s.jurisdiction, (c.get(s.jurisdiction) ?? 0) + 1);
    return c;
  }, [atlas.bundle]);
  const unreachable = (reg.data?.entries ?? []).filter((e) => e.http_status && !isReachable(e)).length;
  const cats = m.categories.slice(0, 12);
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Coverage gaps" }]} title="Coverage gaps" description="Computed from the registry file and the bundled source directory. Blank cells are gaps in the registry, not proof that no source exists.">
      {reg.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Registry jurisdictions with categorized sources" value={m.rows.length} />
        <Stat label="Record types tracked" value={m.categories.length} />
        <Stat label="Entries that did not answer 2xx at last registry check" value={unreachable} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-2 py-2">Jurisdiction</th><th className="px-2 py-2">Directory</th><th className="px-2 py-2">Registry</th>{cats.map((c) => <th key={c} className="px-2 py-2">{humanize(c)}</th>)}<th className="px-2 py-2">Missing types</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {m.rows.map((r) => {
              const name = jurisdictionLabel(r.jurisdiction);
              return (
                <tr key={r.jurisdiction}>
                  <td className="px-2 py-1 font-medium"><Link to="/sources/registry" search={{ j: r.jurisdiction }} className="hover:underline">{name}</Link></td>
                  <td className="px-2 py-1 tabular-nums">{v22.get(name)?.toLocaleString() ?? "—"}</td>
                  <td className="px-2 py-1 tabular-nums">{r.total.toLocaleString()}</td>
                  {cats.map((c) => { const n = r.counts.get(c); return <td key={c} className={`px-2 py-1 tabular-nums ${n ? "" : "bg-muted/60 text-muted-foreground"}`}>{n ? <Link to="/sources/registry" search={{ j: r.jurisdiction, cat: c }} className="hover:underline">{n}</Link> : "·"}</td>; })}
                  <td className="px-2 py-1 text-muted-foreground">{r.missing.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-border bg-surface p-3 shadow-card"><div className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>;
}
