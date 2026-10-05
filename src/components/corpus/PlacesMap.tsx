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
import { knownCount } from "@/lib/corpus/quality";
import { ChevronRight, Landmark, Library, Scale } from "lucide-react";

type Metric = "sources" | "matters";

export function PlacesMap({ home }: { home?: boolean | undefined }) {
  const atlas = useAtlas();
  const { bundle } = atlas;
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<Metric>("sources");
  const join = useMemo(
    () => joinByState(bundle?.sources ?? [], corpus.insights),
    [bundle, corpus.insights],
  );
  const rows = useMemo(
    () =>
      [...join.byState.values()].sort(
        (a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name),
      ),
    [join, metric],
  );
  const metricStatus = metric === "sources" ? atlas.status : corpus.status;
  const values = useMemo(
    () => new Map(metricStatus === "ready" ? rows.map((r) => [r.fips, r[metric]]) : []),
    [rows, metric, metricStatus],
  );

  return (
    <AppShell
      breadcrumbs={home ? [{ label: "Atlas" }] : [{ label: "Atlas", to: "/" }, { label: "Places" }]}
      title={home ? "Legal Source Atlas" : "Places"}
      description={
        home
          ? "Browse litigation, dockets, and legal sources by state."
          : "Open a state to browse its courts, judges, laws, sources, and cases."
      }
    >
      {home ? <HomeLinks /> : null}
      {home ? <h2 className="mb-2 font-display text-xl">Browse by state</h2> : null}
      <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)} className="mb-3">
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="matters">Cases</TabsTrigger>
        </TabsList>
      </Tabs>
      {metricStatus === "loading" ? (
        <p role="status" className="mb-3 text-[13px] text-muted-foreground">
          Loading {metric === "sources" ? "sources" : "cases"}…
        </p>
      ) : null}
      {metric === "sources" && atlas.status === "error" ? (
        <div role="alert" className="mb-3 text-[13px] text-muted-foreground">
          Source counts are not recorded.{" "}
          <button className="font-medium underline" onClick={atlas.retryLoad}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
        <section className="rounded-lg border border-border bg-surface p-3 shadow-card">
          {corpus.geo ? (
            <UsMap
              geo={corpus.geo}
              values={values}
              valueLabel={metric === "sources" ? "sources" : "cases"}
              onState={(f) =>
                navigate({ to: "/places/$state", params: { state: stateByFips.get(f)?.usps ?? f } })
              }
            />
          ) : (
            <CorpusStatus {...corpus} />
          )}
        </section>
        <section className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-surface shadow-card">
          <ul className="divide-y divide-border text-[13px]">
            {rows.map((r) => (
              <li key={r.usps}>
                <Link
                  to="/places/$state"
                  params={{ state: r.usps }}
                  className="flex justify-between px-3 py-1.5 hover:bg-muted/60"
                >
                  <span>{r.name}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {knownCount(metricStatus, r[metric])?.toLocaleString() ??
                      (metricStatus === "loading" ? "…" : "Not recorded")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {atlas.status === "ready" && join.sourcesWithoutState > 0
          ? `${join.sourcesWithoutState.toLocaleString()} sources have no state recorded. `
          : ""}
        {corpus.status === "ready" && join.mattersWithoutState > 0
          ? `${join.mattersWithoutState.toLocaleString()} cases have no state recorded. `
          : ""}
        Counts cover records with a state listed.
      </p>
    </AppShell>
  );
}

function HomeLinks() {
  const secondary = [
    { label: "Courts & judges", note: "Court and judge profiles", to: "/courts", icon: Landmark },
    { label: "Law & safety", note: "Law, agencies, and safety records", to: "/law", icon: Scale },
    {
      label: "Source library",
      note: "Browse official and research sources",
      to: "/sources/library",
      icon: Library,
    },
  ];
  return (
    <section aria-label="Start your research" className="mb-6 grid gap-3 lg:grid-cols-[1.15fr_1fr]">
      <Link
        to="/matters"
        search={{ ds: undefined }}
        className="group flex min-h-36 items-center justify-between gap-4 rounded-lg border border-primary bg-primary p-5 text-primary-foreground shadow-card transition-colors hover:bg-primary/95"
      >
        <span className="min-w-0">
          <span className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/75">
            <Landmark className="size-4" /> Litigation
          </span>
          <span className="block font-display text-2xl">Matters & dockets</span>
          <span className="mt-1 block max-w-lg text-[13px] leading-relaxed text-primary-foreground/85">
            Open a matter to follow its cases, docket entries, and available documents.
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" />
      </Link>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
        {secondary.map(({ label, note, to, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-card transition-colors hover:border-border-strong hover:bg-muted/50"
          >
            <Icon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </section>
  );
}
