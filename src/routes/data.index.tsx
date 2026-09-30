import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { useDatasets } from "@/components/corpus/DatasetBrowser";
import { SECTIONS, sectionOf } from "@/lib/external/groups";
import { datasetDisplayName, datasetPurpose } from "@/lib/external/domainRegistry";
import { pageHead } from "@/lib/corpus/head";
import { EXTRA_TABLES } from "@/lib/external/tables.functions";

export const Route = createFileRoute("/data/")({
  head: () => pageHead("Data catalog", "Every dataset in the connected corpus with its imported record count, grouped by section."),
  component: Catalog,
});

function Catalog() {
  const ds = useDatasets();
  const all = ds.data ?? [];
  const total = all.reduce((n, d) => n + (d.records ?? 0), 0);
  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Dataset inventory" }]} title="Dataset inventory" description="Advanced inventory of every connected corpus dataset. Record counts are the corpus's own imported counts; no coverage is inferred.">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ExternalBadge />
        {all.length ? <span className="text-[12px] text-muted-foreground">{all.length} datasets · {total.toLocaleString()} imported records</span> : null}
      </div>
      {ds.error ? <ExternalError error={ds.error} /> : null}
      {ds.isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      <div className="space-y-6">
        {SECTIONS.map((s) => {
          const list = all.filter((d) => sectionOf(d.id) === s.id).sort((a, b) => (b.records ?? 0) - (a.records ?? 0));
          if (!list.length) return null;
          return (
            <section key={s.id}>
              <h2 className="mb-2 font-display text-lg">{s.label} <span className="text-[12px] font-normal text-muted-foreground">{list.length} datasets</span></h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((d) => (
                  <Link key={d.id} to="/data/$dataset" params={{ dataset: d.id }} className="rounded-lg border border-border bg-surface p-3 shadow-card hover:border-primary/50">
                    <div className="flex items-baseline justify-between gap-2">
                       <span className="truncate text-[13px] font-medium">{datasetDisplayName(d.id, d.label)}</span>
                      <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">{d.records?.toLocaleString() ?? "—"}</span>
                    </div>
                     <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span>{datasetPurpose(d.id)}</span><span className="truncate font-mono">{d.id}</span></div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        <section>
          <h2 className="mb-2 font-display text-lg">Supporting tables <span className="text-[12px] font-normal text-muted-foreground">stored outside the dataset list</span></h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(EXTRA_TABLES).map(([id, t]) => (
              <Link key={id} to="/data/tables/$table" params={{ table: id }} className="rounded-lg border border-border bg-surface p-3 shadow-card hover:border-primary/50">
                <span className="text-[13px] font-medium">{t.label}</span>
                <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{id}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
