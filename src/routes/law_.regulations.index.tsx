import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { listRegulationCodes, searchRegulationIndex } from "@/lib/external/courtRulesLaw.functions";

export const Route = createFileRoute("/law_/regulations/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
  }),
  head: () =>
    pageHead(
      "State administrative codes",
      "Tables of contents of state administrative codes from their official publishers.",
    ),
  component: RegulationsPage,
});

function RegulationsPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/regulations/" });
  const [draft, setDraft] = useState(q);
  const listFn = useServerFn(listRegulationCodes);
  const searchFn = useServerFn(searchRegulationIndex);
  const codes = useQuery({
    queryKey: ["state-regulation-codes"],
    queryFn: () => listFn(),
    staleTime: 10 * 60 * 1000,
  });
  const found = useQuery({
    queryKey: ["state-regulation-search", q],
    queryFn: () => searchFn({ data: { q } }),
    enabled: q.trim().length >= 2,
  });
  const rows = codes.data ?? [];
  const blocked = rows.filter((c) => c.status !== "indexed");
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "State administrative codes" },
      ]}
      title="State administrative codes"
      description="Titles, agencies and chapters of each state's administrative code as its official publisher lists them. Index only: each entry opens the rule on the publisher's site."
    >
      <form
        role="search"
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ search: { q: draft.trim() } });
        }}
      >
        <label className="sr-only" htmlFor="regulation-search">
          Search citations, headings and agencies
        </label>
        <input
          id="regulation-search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Citation, heading or agency, e.g. emissions"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          Search
        </button>
      </form>
      {q.trim().length >= 2 ? (
        <section className="mb-5" aria-label="Matching index entries">
          <h2 className="eyebrow">Index entries</h2>
          {found.isFetching ? (
            <p className="mt-2 text-sm text-muted-foreground">Searching the indexes…</p>
          ) : null}
          {found.error ? <ExternalError error={found.error} /> : null}
          {found.data ? (
            found.data.entries.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No index entry contains every word of “{q}”.
              </p>
            ) : (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(found.data.total ?? found.data.entries.length).toLocaleString("en-US")} entries
                  match. Showing {found.data.entries.length}.
                </p>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                  {found.data.entries.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]"
                    >
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {e.citation} <ExternalLink className="size-3" aria-hidden />
                      </a>
                      {e.heading ? <span>{e.heading}</span> : null}
                      <span className="text-[11px] text-muted-foreground">
                        <Link
                          to="/law/regulations/$state"
                          params={{ state: e.state }}
                          search={{ q: "", level: undefined }}
                          className="hover:underline"
                        >
                          {stateByUsps.get(e.state)?.name ?? e.state}
                        </Link>
                        {e.agency ? ` · ${e.agency}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
        </section>
      ) : null}
      {codes.error ? <ExternalError error={codes.error} /> : null}
      {codes.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading administrative codes…</p>
      ) : null}
      {codes.data && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No administrative code indexes are recorded yet.
        </p>
      ) : null}
      {rows.length ? (
        <FolderGrid
          title="Administrative codes"
          hint={`${rows.length - blocked.length} indexed · ${blocked.length} not retrieved`}
          wrapNotes
          items={rows.map((c) => ({
            key: c.state,
            label: stateByUsps.get(c.state)?.name ?? c.state,
            count: c.status === "indexed" ? c.entries : 0,
            note: c.status === "indexed" ? c.code : `${c.code}: ${c.statusLabel}`,
            link: { to: "/law/regulations/$state", params: { state: c.state }, search: { q: "" } },
          }))}
        />
      ) : null}
      <p className="mt-4 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
        These are the states whose administrative codes publish a machine-readable table of contents
        that was collected; other states are not covered here. Headings are as the publisher lists
        them; rule text is not copied.
      </p>
    </AppShell>
  );
}
