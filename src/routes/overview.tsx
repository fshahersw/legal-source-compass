import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { CorpusStatus, Stat } from "@/components/corpus/BarList";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { joinByState } from "@/lib/corpus/join";
import { stateByFips } from "@/lib/corpus/geo";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/overview")({
  head: () => pageHead("Overview", "One view of the V2.2A litigation source directory and the corpussite saved case catalog, with counts computed from the loaded rows."),
  component: Overview,
});

function Overview() {
  const { bundle, stats } = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const sources = bundle?.sources ?? [];
  const join = useMemo(() => joinByState(sources, corpus.insights), [sources, corpus.insights]);
  const values = useMemo(() => new Map([...join.byState.values()].map((s) => [s.fips, s.sources + s.matters])), [join]);

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Overview" }]} title="Overview" description="Every figure on this page is counted from rows loaded in your browser right now. Nothing is a published total.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Distinct source URLs" value={stats?.distinctSources ?? "—"} note="V2.2A directory" />
        <Stat label="Endpoint candidates" value={bundle?.endpoint_candidates.length ?? "—"} note="V2.2A, imported status only" />
        <Stat label="Saved case rows" value={corpus.insights?.matters.length ?? "—"} note="corpussite catalog" />
        <Stat label="Scoped master dockets" value={corpus.insights?.masters.length ?? "—"} note="corpussite catalog" />
      </div>
      <section className="mt-5 rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-lg">Coverage by state</h2>
          <Link to="/places" className="text-[12px] underline">Open Places map</Link>
        </div>
        {corpus.geo ? (
          <UsMap geo={corpus.geo} values={values} valueLabel="sources + case rows" onState={(f) => navigate({ to: "/places/$state", params: { state: stateByFips.get(f)?.usps ?? f } })} />
        ) : (
          <CorpusStatus {...corpus} />
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Shading = V2.2A sources whose imported jurisdiction exactly names the state, plus saved case rows with that state code. {join.sourcesWithoutState.toLocaleString()} sources name no state and are not placed on the map.
        </p>
      </section>
    </AppShell>
  );
}
