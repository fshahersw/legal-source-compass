import { createFileRoute, Link, Outlet, useMatch, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "@/components/corpus/UsMap";
import { BarList, CorpusStatus, Stat } from "@/components/corpus/BarList";
import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";
import { defaultFilters } from "@/lib/atlas/filters";
import { useCorpus } from "@/lib/corpus/store";
import { sourcesForState } from "@/lib/corpus/join";
import { stateByUsps } from "@/lib/corpus/geo";
import { countBy, mattersForState } from "@/lib/corpus/insights";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/places/$state")({
  head: ({ params }) => {
    const n = stateByUsps.get(params.state.toUpperCase())?.name ?? params.state;
    return pageHead(`${n}`, `Litigation research sources, saved case rows and counties for ${n}.`);
  },
  component: StatePage,
});

function StatePage() {
  const { state } = Route.useParams();
  const usps = state.toUpperCase();
  const st = stateByUsps.get(usps);
  const countyMatch = useMatch({ from: "/places/$state/$county", shouldThrow: false });
  const { bundle, setFilters } = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const sources = useMemo(() => (st ? sourcesForState(bundle?.sources ?? [], usps) : []), [bundle, usps, st]);
  const matters = useMemo(() => (corpus.insights ? mattersForState(corpus.insights, usps) : []), [corpus.insights, usps]);

  if (!st) {
    return (
      <AppShell breadcrumbs={[{ label: "Places", to: "/places" }, { label: state }]} title="Unknown state">
        <p className="text-[13px]">No U.S. state or DC has the code “{state}”. <Link to="/places" className="underline">Back to the map</Link></p>
      </AppShell>
    );
  }
  const endpoints = (bundle?.endpoint_candidates ?? []).filter((e) => sources.some((s) => s.url === e.url));

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Places", to: "/places" }, { label: st.name }]} title={st.name} description="Sources are matched by exact state name in the imported jurisdiction field; case rows by state code.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="V2.2A sources" value={sources.length} />
        <Stat label="Occurrences" value={sources.reduce((a, s) => a + s.occurrences, 0)} />
        <Stat label="Saved case rows" value={matters.length} />
        <Stat label="Endpoint candidates" value={endpoints.length} note="exact URL match" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section className="rounded-lg border border-border bg-surface p-3 shadow-card">
          <h2 className="eyebrow mb-2">Counties</h2>
          {corpus.geo ? (
            <UsMap geo={corpus.geo} values={new Map()} valueLabel="county-level records" stateFips={st.fips} selectedCounty={countyMatch?.params.county} onCounty={(c) => navigate({ to: "/places/$state/$county", params: { state: usps, county: c } })} />
          ) : (
            <CorpusStatus {...corpus} />
          )}
          <Outlet />
        </section>
        <div className="space-y-4">
          <Button
            className="w-full"
            disabled={sources.length === 0}
            onClick={() => {
              setFilters({ ...defaultFilters, jurisdictions: [st.name] });
              navigate({ to: "/" });
            }}
          >
            Open {sources.length.toLocaleString()} sources in Library
          </Button>
          <BarList title="Case rows by court" rows={countBy(matters, (m) => m.court)} unit="saved case rows" />
          <BarList title="Case rows by status" rows={countBy(matters, (m) => m.status)} unit="saved case rows" />
        </div>
      </div>
      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <h2 className="eyebrow border-b border-border px-3 py-2">Sources (first 50 by title)</h2>
        <ul className="divide-y divide-border text-[13px]">
          {[...sources].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 50).map((s) => (
            <li key={s.id} className="flex items-baseline gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{s.title || s.url}</span>
              <a href={s.url} target="_blank" rel="noreferrer" className="max-w-[45%] truncate font-mono text-[11px] text-muted-foreground underline">{s.url}</a>
            </li>
          ))}
          {sources.length === 0 ? <li className="px-3 py-2 text-muted-foreground">No sources name this state.</li> : null}
        </ul>
      </section>
    </AppShell>
  );
}
