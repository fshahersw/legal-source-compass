import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { searchStateCodes, listStateCodes } from "@/lib/law/stateCode.functions";
import { showRecorded } from "@/lib/law/stateCodeContract";

export const Route = createFileRoute("/law_/codes/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q:
      typeof search["q"] === "string"
        ? search["q"]
        : typeof search["q"] === "number" && Number.isFinite(search["q"])
          ? String(search["q"])
          : "",
  }),
  head: () => pageHead("State codes", "Full state codes that have been captured."),
  component: StateCodesPage,
});

function StateCodesPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/codes/" });
  const [draft, setDraft] = useState(q);
  const listFn = useServerFn(listStateCodes);
  const searchFn = useServerFn(searchStateCodes);
  const codes = useQuery({
    queryKey: ["full-state-codes"],
    queryFn: () => listFn(),
    staleTime: 0,
  });
  const found = useQuery({
    queryKey: ["state-code-search", q],
    queryFn: () => searchFn({ data: { q } }),
    enabled: q.trim().length >= 2,
  });

  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "State codes" },
      ]}
      title="State codes"
      description="Full codes that have been captured. A state appears here when its code is ready, with no separate list to update."
    >
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ search: { q: draft.trim() } });
        }}
      >
        <label className="sr-only" htmlFor="all-code-search">
          Search citation or heading
        </label>
        <input
          id="all-code-search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Citation or heading"
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          Search
        </button>
      </form>
      {codes.error ? <ExternalError error={codes.error} /> : null}
      {codes.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading captured codes…</p>
      ) : null}
      {codes.data ? (
        <FolderGrid
          title="Captured full codes"
          hint={
            codes.data.length ? `${codes.data.length.toLocaleString()} states` : "None captured yet"
          }
          items={codes.data.map((row) => ({
            key: `${row.state}-${row.datasetId ?? row.kind}`,
            label: row.name,
            count: row.sectionCount && row.sectionCount > 0 ? row.sectionCount : undefined,
            note: `Edition: ${showRecorded(row.edition)} · Currency: ${showRecorded(row.currency)}`,
            link: { to: "/law/codes/$state", params: { state: row.state }, search: { q: "" } },
          }))}
        />
      ) : null}
      {q.trim().length >= 2 ? (
        <section className="mt-5">
          <h2 className="eyebrow">Sections</h2>
          {found.isFetching ? (
            <p className="mt-2 text-sm text-muted-foreground">Searching citation and heading…</p>
          ) : null}
          {found.error ? <ExternalError error={found.error} /> : null}
          {found.data ? (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                {found.data.total.toLocaleString()} matching sections. Showing{" "}
                {found.data.hits.length.toLocaleString()}.
              </p>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
                {found.data.hits.map((hit) => (
                  <li key={`${hit.state}-${hit.kind}-${hit.id}`}>
                    <Link
                      to="/law/codes/$state"
                      params={{ state: hit.state }}
                      search={{
                        q: "",
                        code: hit.code ?? undefined,
                        chapter: hit.chapterId ?? undefined,
                        section: hit.id,
                        title: hit.titleValue ?? undefined,
                      }}
                      className="block px-3 py-2 hover:bg-muted/50"
                    >
                      <span className="block text-[13px] font-medium">
                        {hit.citation ?? hit.heading}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {[hit.state, hit.heading, hit.chapterLabel].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
                {found.data.hits.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">
                    No sections matched that citation or heading.
                  </li>
                ) : null}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
