import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { CorpusStatus } from "@/components/corpus/BarList";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { joinByState } from "@/lib/corpus/join";
import { stateByFips } from "@/lib/corpus/geo";
import { FolderGrid } from "@/components/corpus/FolderGrid";

type Metric = "sources" | "matters";

export function PlacesMap({ home }: { home?: boolean | undefined }) {
  const { bundle } = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<Metric>("sources");
  const join = useMemo(() => joinByState(bundle?.sources ?? [], corpus.insights), [bundle, corpus.insights]);
  const rows = useMemo(() => [...join.byState.values()].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name)), [join, metric]);
  const values = useMemo(() => new Map(rows.map((r) => [r.fips, r[metric]])), [rows, metric]);

  return (
    <AppShell breadcrumbs={home ? [{ label: "Atlas" }] : [{ label: "Atlas", to: "/" }, { label: "Places" }]} title={home ? "Legal Source Atlas" : "Places"} description="Click a state to open its courts, judges, laws, sources, cases and counties.">
      {home ? <HomeFolders /> : null}
      <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)} className="mb-3">
        <TabsList>
          <TabsTrigger value="sources">Directory sources</TabsTrigger>
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

function HomeFolders() {
  const items = [
    { key: "courts", label: "Courts", note: "Federal and state courts", link: { to: "/courts" } },
    { key: "judges", label: "Judges", note: "Profiles and portraits", link: { to: "/judges" } },
    { key: "matters", label: "Matters", note: "MDLs and tracked cases", link: { to: "/matters" } },
    { key: "law", label: "Law", note: "Federal and state law", link: { to: "/law" } },
    { key: "agencies", label: "Agencies", note: "Federal Register and safety", link: { to: "/agencies" } },
    { key: "sources", label: "Sources", note: "Source library and registries", link: { to: "/sources/library" } },
  ];
  return <div className="mb-4"><FolderGrid items={items} /></div>;
}
