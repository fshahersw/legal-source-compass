import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, Clock3, Landmark, MapPin, Search, UsersRound } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { UsMap } from "./UsMap";
import { StateMark } from "./EntityArtwork";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";
import { useCorpus } from "@/lib/corpus/store";
import { joinByState } from "@/lib/corpus/join";
import { stateByFips } from "@/lib/corpus/geo";
import type { StateHubTab } from "@/lib/corpus/stateHub";

export function PlacesMap({ home }: { home?: boolean | undefined }) {
  const atlas = useAtlas();
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<StateHubTab>("overview");
  const [hover, setHover] = useState<string | null>(null);
  const report = useMemo(() => joinByState(atlas.bundle?.sources ?? [], null), [atlas.bundle]);
  const states = useMemo(
    () => [...report.byState.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [report],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return states.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.usps.toLowerCase() === q,
    );
  }, [states, search]);
  const values = useMemo(
    () => new Map(atlas.status === "ready" ? states.map((s) => [s.fips, s.sources]) : []),
    [states, atlas.status],
  );
  const destinations = [
    { id: "overview" as const, label: "State overview", icon: MapPin },
    { id: "courts" as const, label: "Courts", icon: Landmark },
    { id: "judges" as const, label: "Judges", icon: UsersRound },
  ];
  return (
    <AppShell
      breadcrumbs={
        home
          ? [{ label: "State atlas" }]
          : [{ label: "Atlas", to: "/" }, { label: "States & courts" }]
      }
      title="State research atlas"
      description="Find statutes, courts, judges and practical research resources by jurisdiction."
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1"
          aria-label="Open selected state in"
        >
          {destinations.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${tab === id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          50 states <span className="px-1 text-border">/</span> District of Columbia
        </p>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-label="Explore jurisdictions on a map" className="min-w-0">
          {corpus.geo ? (
            <UsMap
              geo={corpus.geo}
              values={values}
              valueLabel="sources"
              selectedState={filtered.length === 1 ? filtered[0]?.usps : undefined}
              onHoverState={setHover}
              onState={(fips) => {
                const state = stateByFips.get(fips);
                if (state)
                  void navigate({
                    to: "/places/$state",
                    params: { state: state.usps },
                    search: { tab },
                  });
              }}
            />
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface text-sm text-muted-foreground">
              <MapPin className="size-8 opacity-50" />
              <p role="status">
                {corpus.error ? "The map is temporarily unavailable." : "Preparing the state map…"}
              </p>
              <p className="text-xs">All states remain accessible in the list.</p>
              {corpus.error ? (
                <Button variant="outline" size="sm" onClick={corpus.retry}>
                  Retry map
                </Button>
              ) : null}
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              to="/law"
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 transition-colors hover:border-primary/25"
            >
              <span className="rounded-lg bg-[var(--blue-tint)] p-2 text-primary">
                <BookOpen className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Federal law & agencies</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Statutes, rules and regulatory sources.
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              to="/limitations"
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 transition-colors hover:border-primary/25"
            >
              <span className="rounded-lg bg-[var(--blue-tint)] p-2 text-primary">
                <Clock3 className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Deadline assessment</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Cited rules with a guided review.
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
        <aside className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Choose a state</h2>
              <span className="text-[11px] text-muted-foreground">{filtered.length} shown</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Find a state"
                placeholder="Name or abbreviation"
                className="h-9 pl-8 text-xs"
              />
            </div>
          </div>
          <ul className="max-h-[29rem] divide-y divide-border/60 overflow-y-auto">
            {filtered.map((state) => (
              <li key={state.usps}>
                <Link
                  to="/places/$state"
                  params={{ state: state.usps }}
                  search={{ tab }}
                  onMouseEnter={() => setHover(state.usps)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${hover === state.usps ? "bg-muted" : "hover:bg-muted/50"}`}
                >
                  <StateMark state={state.usps} className="size-7 rounded-md p-1" />
                  <span className="min-w-0 flex-1 text-[13px] font-medium">{state.name}</span>
                  <span
                    className="text-[10px] tabular-nums text-muted-foreground"
                    title="Directory sources"
                  >
                    {atlas.status === "ready"
                      ? state.sources.toLocaleString()
                      : atlas.status === "loading"
                        ? "…"
                        : "—"}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground/50" />
                </Link>
              </li>
            ))}
          </ul>
          {!filtered.length ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No state matches. Try its full name or two-letter abbreviation.
            </p>
          ) : null}
          {atlas.status === "error" ? (
            <div role="alert" className="border-t border-border p-3 text-xs text-muted-foreground">
              Source counts unavailable.
              <button type="button" className="ml-2 underline" onClick={atlas.retryLoad}>
                Retry
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
