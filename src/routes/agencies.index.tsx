import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { AppShell } from "@/components/atlas/AppShell";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listAgencies, type Agency } from "@/lib/external/agency.functions";
import { splitAgencies } from "@/lib/external/agencyTree";
import { pageHead } from "@/lib/corpus/head";
export const Route = createFileRoute("/agencies/")({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search["q"] === "string" && search["q"].trim()
      ? { q: search["q"].trim().slice(0, 160) }
      : {},
  head: () =>
    pageHead(
      "Federal agencies",
      "Find federal departments and agencies, their rules and recorded regulatory documents.",
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
function AgenciesPage() {
  const read = useServerFn(listAgencies);
  const query = useQuery({ queryKey: ["agencies"], queryFn: () => read(), staleTime: 5 * 60_000 });
  const { q: term = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTerm = (q: string) => void navigate({ search: q ? { q } : {}, replace: true });
  const [limit, setLimit] = useState(36);
  const groups = useMemo(
    () =>
      splitAgencies(
        (query.data ?? []).filter((a) => a.name.toLowerCase().includes(term.trim().toLowerCase())),
      ),
    [query.data, term],
  );
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Agencies" },
      ]}
      title="Federal agencies"
      description="Find a department, explore its rules, and follow the source documents."
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
        {query.data ? (
          <span className="text-xs text-muted-foreground">
            {groups.departments.length + groups.others.length} listed organizations
          </span>
        ) : null}
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
    </AppShell>
  );
}
