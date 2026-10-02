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
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStateCountyRecords } from "@/lib/external/corpus.functions";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { countBy as countDir } from "@/lib/external/directoryTree";
import { useCourtDirectory } from "@/lib/external/useDirectory";
import { listLawCollections } from "@/lib/external/corpus.functions";
import { kindLabel } from "@/lib/external/lawTree";
import { useServerFn as useSF } from "@tanstack/react-start";
import { useQuery as useQ } from "@tanstack/react-query";
import { loadRegistryJurisdiction, taskCounts, taskLabel } from "@/lib/atlas/registryV22";
import { loadCatalogIndex, loadCatalogJurisdiction } from "@/lib/atlas/catalog";
import { mergeStateSources, type MergedStateSource } from "@/lib/atlas/stateSources";
import { SourceDrawer } from "@/components/atlas/SourceDrawer";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import type { Source } from "@/lib/atlas/types";
import { useState } from "react";
import { StateCourtLinks } from "@/components/corpus/StateCourtLinks";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";

export function useStateCounty(stateName: string | undefined) {
  const fn = useServerFn(getStateCountyRecords);
  return useQuery({ queryKey: ["state-county", stateName], enabled: !!stateName, staleTime: 5 * 60_000, queryFn: () => fn({ data: { stateName: stateName! } }) });
}

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
  const county = useStateCounty(st?.name);
  const reg = useQuery({ queryKey: ["reg22", usps], queryFn: () => loadRegistryJurisdiction(usps), staleTime: Infinity });
  const catIdx = useQuery({ queryKey: ["catalog-index"], queryFn: loadCatalogIndex, staleTime: Infinity });
  const catState = useQuery({
    queryKey: ["catalog-state", usps],
    queryFn: () => loadCatalogJurisdiction(usps.toLowerCase()),
    staleTime: Infinity,
    enabled: !!catIdx.data?.jurisdictions.some((j) => j.jurisdiction === usps.toLowerCase()),
  });
  const countyValues = useMemo(() => new Map(Object.entries(county.data?.counts ?? {})), [county.data]);
  const sources = useMemo(() => (st ? sourcesForState(bundle?.sources ?? [], usps) : []), [bundle, usps, st]);
  const merged = useMemo(
    () => mergeStateSources(sources, catState.data ?? [], reg.data ?? []),
    [sources, catState.data, reg.data],
  );
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
      <div className="mb-4 rounded-lg border border-primary/25 bg-primary/5 p-4 text-[13px]"><Link className="font-semibold text-primary underline" to="/insights" search={{ view: "states", state: usps }}>Analyze {st.name}</Link><p className="mt-1 text-[12px] text-muted-foreground">Compare federal civil workload per resident, inspect district disposition times, explore judge and case cohorts, and browse court and rules hierarchies.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Sources, all collections" value={merged.length} note="exact URL match" />
        <Stat label="Directory sources" value={sources.length} />
        <Stat label="Occurrences" value={sources.reduce((a, s) => a + s.occurrences, 0)} />
        <Stat label="Saved case rows" value={matters.length} />
        <Stat label="Endpoint candidates" value={endpoints.length} note="exact URL match" />
      </div>
      <StateCourts usps={usps} />
      <StateCourtLinks stateName={st.name} usps={usps} />
      <StateLaws usps={usps} />
      <div className="mt-5">
        <FolderGrid
          title="Sources for this state"
          hint={reg.data ? `${reg.data.length.toLocaleString()} in the litigation source registry V2.2 · open a folder` : "Loading registry…"}
          items={[
            { key: "all", label: "All state sources", count: reg.data?.length, link: { to: "/sources/registry-v22", search: { j: usps, all: "1" } } },
            ...taskCounts(reg.data ?? []).map((t) => ({ key: t.task, label: taskLabel(t.task), count: t.count, link: { to: "/sources/registry-v22", search: { j: usps, task: t.task } } })),
          ]}
        />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section className="rounded-lg border border-border bg-surface p-3 shadow-card">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="eyebrow">Counties</h2>
            <ExternalBadge />
            <span className="text-[12px] text-muted-foreground">
              {county.isLoading ? "Loading county records…" : county.data ? `${county.data.records.length.toLocaleString()} county-tagged records across ${Object.keys(county.data.counts).length} of ${county.data.directoryCounties} counties${county.data.truncated ? " (first 5,000 only)" : ""}` : ""}
            </span>
          </div>
          {county.error ? <ExternalError error={county.error} /> : null}
          {corpus.geo ? (
            <UsMap geo={corpus.geo} values={countyValues} valueLabel="county-tagged records" stateFips={st.fips} selectedCounty={countyMatch?.params.county} onCounty={(c) => navigate({ to: "/places/$state/$county", params: { state: usps, county: c } })} />
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
              navigate({ to: "/sources/library" });
            }}
          >
            Open {sources.length.toLocaleString()} sources in Library
          </Button>
          <BarList title="Case rows by court" rows={countBy(matters, (m) => m.court)} unit="saved case rows" />
          <BarList title="Case rows by status" rows={countBy(matters, (m) => m.status)} unit="saved case rows" />
        </div>
      </div>
      <StateSourceTable rows={merged} stateName={st.name} onAll={() => { setFilters({ ...defaultFilters, jurisdictions: [st.name] }); navigate({ to: "/sources/library" }); }} />
    </AppShell>
  );
}

function StateCourts({ usps }: { usps: string }) {
  const dir = useCourtDirectory();
  const rows = (dir.data ?? []).filter((r) => r.state === usps && r.system !== "Federal");
  const fed = (dir.data ?? []).filter((r) => r.state === usps && r.system === "Federal");
  return (
    <div className="mt-5">
      <FolderGrid
        title="Courts in this state"
        hint={dir.data ? `${(rows.length + fed.length).toLocaleString()} courts in the directory` : "Loading courts…"}
        items={[
          ...countDir(rows, (r) => r.type).map((c) => ({ key: c.key, label: c.key, count: c.count, link: { to: "/courts", search: { system: rows.find((r) => r.type === c.key)!.system, state: usps, type: c.key } } })),
          ...(fed.length ? [{ key: "fed", label: "Federal courts located here", count: fed.length, link: { to: "/courts", search: { system: "Federal", state: usps, type: "*" } } }] : []),
        ]}
      />
    </div>
  );
}

function StateLaws({ usps }: { usps: string }) {
  const fn = useSF(listLawCollections);
  const q = useQ({ queryKey: ["law-collections"], queryFn: () => fn(), staleTime: Infinity });
  const rows = (q.data ?? []).filter((c) => c.state === usps).sort((a, b) => b.provisions - a.provisions);
  if (q.data && !rows.length) return null;
  return (
    <div className="mt-5">
      <FolderGrid
        title="Laws for this state"
        hint={q.data ? `${rows.reduce((a, c) => a + c.provisions, 0).toLocaleString()} provisions in law outlines` : "Loading laws…"}
        items={[{ key: "all", label: "All law types", count: rows.reduce((a, c) => a + c.provisions, 0), link: { to: "/law", search: { scope: "states", state: usps } } }, ...rows.map((c) => ({ key: c.kind, label: kindLabel(c.kind), count: c.provisions, link: { to: "/law", search: { scope: "states", state: usps, kind: c.kind } } }))]}
      />
    </div>
  );
}

function StateSourceTable({ rows, stateName, onAll }: { rows: MergedStateSource[]; stateName: string; onAll: () => void }) {
  const [open, setOpen] = useState<Source | null>(null);
  const shown = rows.slice(0, 50); // mergeStateSources already sorts by title
  const asSource = (r: MergedStateSource): Source =>
    r.source ??
    ({
      id: r.id,
      url: r.url,
      title: r.title,
      domain: r.domain,
      jurisdiction: stateName,
      heading_category: r.category,
      source_family: "",
      occurrences: 1,
    } as Source);
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="eyebrow">Sources for this state (first 50 by title)</h2>
        {rows.length > 50 ? <button type="button" onClick={onAll} className="text-[12px] underline">Show all {rows.length.toLocaleString()}</button> : null}
      </div>
      {rows.length === 0 ? <p className="px-3 py-2 text-[13px] text-muted-foreground">No sources name this state.</p> : (
        <table className="w-full table-fixed text-[13px]">
          <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground"><tr><th className="w-2/5 px-3 py-1.5">Title</th><th className="px-3 py-1.5">Domain</th><th className="px-3 py-1.5">Category</th><th className="px-3 py-1.5">In collections</th><th className="w-10" /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} role="button" tabIndex={0} onClick={() => setOpen(asSource(r))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(asSource(r)); } }} className="cursor-pointer border-t border-border hover:bg-muted/50 focus:bg-muted/50 focus:outline-none">
                <td className="truncate px-3 py-1.5">{r.title || r.url}</td>
                <td className="truncate px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{r.domain || "—"}</td>
                <td className="truncate px-3 py-1.5 text-[12px] text-muted-foreground">{r.category || "—"}</td>
                <td className="truncate px-3 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {r.collections.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] font-normal">{c}</Badge>
                    ))}
                  </span>
                </td>
                <td className="px-2 py-1.5"><a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${r.title || r.url} in a new tab`} className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SourceDrawer source={open} onClose={() => setOpen(null)} />
    </section>
  );
}
