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
import { listStateRegCodes } from "@/lib/external/stateRegs.functions";
import { CoverageTable } from "@/components/law/regulations/CoverageTable";
import { coverageSummary } from "@/components/law/regulations/labels";

export const Route = createFileRoute("/law_/regulations/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
  }),
  head: () =>
    pageHead(
      "State administrative codes",
      "State administrative codes from their official publishers: coverage of every state, tables of contents, rule text and state registers.",
    ),
  component: RegulationsPage,
});

function RegulationsPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/regulations/" });
  const [draft, setDraft] = useState(q);
  const listFn = useServerFn(listRegulationCodes);
  const v2Fn = useServerFn(listStateRegCodes);
  const v2 = useQuery({
    queryKey: ["state-reg-codes-v2"],
    queryFn: () => v2Fn(),
    staleTime: 10 * 60 * 1000,
  });
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
      description="Each state's administrative code from its official publisher: what is published where, the table of contents, rule text where it is held, and the state register."
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
      {v2.error ? <ExternalError error={v2.error} /> : null}
      {v2.data && v2.data.length ? (
        <section aria-label="Coverage" className="mb-5 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="eyebrow">Coverage of the 50 states and the District of Columbia</h2>
            <span className="text-[11px] text-muted-foreground">
              {coverageSummary(v2.data)
                .map((s) => `${s.count} ${s.label.toLowerCase()}`)
                .join(" · ")}
            </span>
          </div>
          <CoverageTable codes={v2.data} />
        </section>
      ) : null}
      {codes.error ? <ExternalError error={codes.error} /> : null}
      {codes.isLoading || v2.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading administrative codes…</p>
      ) : null}
      {codes.data && rows.length === 0 && !v2.data?.length ? (
        <p className="text-sm text-muted-foreground">
          No administrative code indexes are recorded yet.
        </p>
      ) : null}
      {rows.length && !v2.data?.length ? (
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
        Rule text comes only from each state's official publisher and is checked against the
        publisher's own bytes; where the official code is published only by a commercial vendor
        nothing is copied. Headings are as the publisher lists them.
      </p>
    </AppShell>
  );
}
