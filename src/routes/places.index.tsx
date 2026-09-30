import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { CorpusStatus } from "@/components/corpus/BarList";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { joinByState } from "@/lib/corpus/join";
import { stateByFips } from "@/lib/corpus/geo";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/places/")({
  head: () => pageHead("Places Map", "Interactive U.S. state and county map of litigation research sources and saved case rows."),
  component: Places,
});

type Metric = "sources" | "matters";

function Places() {
  const { bundle } = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<Metric>("sources");
  const join = useMemo(() => joinByState(bundle?.sources ?? [], corpus.insights), [bundle, corpus.insights]);
  const rows = useMemo(() => [...join.byState.values()].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)), [join, metric]);
  const values = useMemo(() => new Map(rows.map((r) => [r.fips, r[metric]])), [rows, metric]);

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Places" }]} title="Places" description="Click a state to open its sources, saved cases and counties.">
      <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)} className="mb-3">
        <TabsList>
          <TabsTrigger value="sources">V2.2A sources</TabsTrigger>
          <TabsTrigger value="matters">Saved case rows</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
        <section className="rounded-lg border border-border bg-surface p-3 shadow-card">
          {corpus.geo ? (
            <UsMap geo={corpus.geo} values={values} valueLabel={metric === "sources" ? "sources" : "case rows"} onState={(f) => navigate({ to: "/places/$state", params: { state: stateByFips.get(f)?.usps ?? f } })} />
          ) : (
            <CorpusStatus {...corpus} />
          )}
        </section>
        <section className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-surface shadow-card">
          <ul className="divide-y divide-border text-[13px]">
            {rows.map((r) => (
              <li key={r.usps}>
                <Link to="/places/$state" params={{ state: r.usps }} className="flex justify-between px-3 py-1.5 hover:bg-muted/60">
                  <span>{r.name}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">{r[metric].toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {join.sourcesWithoutState.toLocaleString()} sources name no state; {join.mattersWithoutState.toLocaleString()} case rows have no state code. They stay in the Library and Insights but are not placed on the map.
      </p>
    </AppShell>
  );
}
