import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowUpRight, Building2, FileText, Search } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingBlock, StateNote } from "@/components/enforcement/parts";
import { AgencyDirectory, type DirectoryState } from "@/components/agencies/AgencyDirectory";
import { RegisterOverview } from "@/components/agencies/RegisterOverview";
import { normalizeAgencySearch } from "@/components/agencies/agencyView";
import { listAgencies, type Agency } from "@/lib/external/agency.functions";
import { listAgencyDirectory } from "@/lib/external/agencyProfile.functions";
import { splitAgencies } from "@/lib/external/agencyTree";
import { pageHead } from "@/lib/corpus/head";
import { cn } from "@/lib/utils";

type View = "directory" | "register";
export const Route = createFileRoute("/agencies/")({
  validateSearch: normalizeAgencySearch,
  head: () =>
    pageHead(
      "Federal agencies",
      "Every Federal Register agency with rulemaking volume, significant rules, comment periods, Unified Agenda actions and spending, plus a Federal Register overview by administration.",
    ),
  component: AgenciesPage,
});

function AgencyCards({ rows }: { rows: Agency[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((agency) => (
        <Link
          key={agency.id}
          to="/agencies/$id"
          params={{ id: agency.id }}
          className="group flex min-h-20 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/20"
        >
          <AgencyMark name={agency.name} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-snug">{agency.name}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {agency.count == null
                ? "Document count not recorded"
                : `${agency.count.toLocaleString()} recorded documents`}
            </span>
          </span>
          <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

/** The corpus index listing, used while the agency profiles dataset is unavailable. */
function LegacyDirectory({ term, setTerm }: { term: string; setTerm: (q: string) => void }) {
  const read = useServerFn(listAgencies);
  const query = useQuery({ queryKey: ["agencies"], queryFn: () => read(), staleTime: 5 * 60_000 });
  const [limit, setLimit] = useState(36);
  const groups = useMemo(
    () =>
      splitAgencies(
        (query.data ?? []).filter((a) => a.name.toLowerCase().includes(term.trim().toLowerCase())),
      ),
    [query.data, term],
  );
  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-lg">
        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          aria-label="Find an agency"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setLimit(36);
          }}
          placeholder="Search departments and agencies"
          className="h-9 pl-9 text-sm"
        />
      </div>
      {query.isPending ? (
        <p role="status" className="py-10 text-sm text-muted-foreground">
          Loading agency directory…
        </p>
      ) : query.error ? (
        <div role="alert" className="rounded-xl border border-warning/30 p-5 text-sm">
          The agency directory could not load.
          <Button variant="link" onClick={() => void query.refetch()}>
            Retry agencies
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.departments.length ? (
            <section>
              <h2 className="research-band mb-2 rounded-lg !py-2 text-sm font-semibold">
                Departments
              </h2>
              <AgencyCards rows={groups.departments} />
            </section>
          ) : null}
          {groups.others.length ? (
            <section>
              <h2 className="research-band mb-2 rounded-lg !py-2 text-sm font-semibold">
                Independent & component agencies
              </h2>
              <AgencyCards rows={groups.others.slice(0, limit)} />
              {groups.others.length > limit ? (
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {limit} of {groups.others.length} shown
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + 36)}>
                    Show more agencies
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
          {!groups.departments.length && !groups.others.length ? (
            <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No agency matches this search.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AgenciesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view === "register" ? "register" : "directory";
  const readDirectory = useServerFn(listAgencyDirectory);
  const directory = useQuery({
    queryKey: ["agency-directory"],
    queryFn: () => readDirectory(),
    staleTime: 10 * 60_000,
  });
  const state: DirectoryState = {
    q: search.q ?? "",
    kind: search.kind ?? "all",
    sort: search.sort ?? "rulesLastYear",
    desc: search.dir ? search.dir === "desc" : (search.sort ?? "rulesLastYear") !== "name",
    layout: search.layout ?? "table",
    active: search.active ?? false,
  };
  const update = (next: Partial<DirectoryState>) => {
    const merged = { ...state, ...next };
    void navigate({
      search: normalizeAgencySearch({
        q: merged.q,
        view: search.view,
        kind: merged.kind === "all" ? undefined : merged.kind,
        sort: merged.sort,
        dir: merged.desc ? "desc" : "asc",
        layout: merged.layout === "tree" ? "tree" : undefined,
        active: merged.active || undefined,
      }),
      replace: true,
    });
  };
  const setView = (v: View) =>
    void navigate({
      search: normalizeAgencySearch({ ...search, view: v === "register" ? "register" : undefined }),
    });
  const rows = directory.data?.rows ?? [];
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Agencies" },
      ]}
      title="Federal agencies"
      description="Every agency the Federal Register lists: rulemaking, regulatory pipeline, budget and spending, with the Federal Register as a whole."
    >
      <div
        role="tablist"
        aria-label="Agencies views"
        className="mb-3 flex flex-wrap gap-1 border-b border-border text-[13px]"
      >
        {(
          [
            { id: "directory", label: "Directory", Icon: Building2 },
            { id: "register", label: "Federal Register overview", Icon: FileText },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-ring",
              view === id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {view === "register" ? (
        <RegisterOverview />
      ) : directory.isPending ? (
        <LoadingBlock label="Loading the agency directory" />
      ) : directory.isError ? (
        <div className="space-y-3">
          <StateNote
            tone="error"
            action={
              <button
                type="button"
                className="text-primary underline"
                onClick={() => void directory.refetch()}
              >
                Retry directory statistics
              </button>
            }
          >
            Agency statistics could not be loaded; the recorded index list is shown instead.
          </StateNote>
          <LegacyDirectory term={state.q} setTerm={(q) => update({ q })} />
        </div>
      ) : rows.length ? (
        <AgencyDirectory
          rows={rows}
          asOf={directory.data?.asOf ?? null}
          state={state}
          onChange={update}
        />
      ) : (
        <div className="space-y-3">
          <StateNote>
            Agency statistics have not been published yet; the recorded index list is shown instead.
          </StateNote>
          <LegacyDirectory term={state.q} setTerm={(q) => update({ q })} />
        </div>
      )}
    </AppShell>
  );
}
