import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { Highlighted } from "@/components/courts/rules/Highlighted";
import { oneLine } from "@/components/courts/rules/ruleFormat";
import { pageHead } from "@/lib/corpus/head";
import {
  listStateConstitutions,
  searchConstitutions,
  type Constitution,
} from "@/lib/external/courtRulesLaw.functions";

export const Route = createFileRoute("/law_/constitutions/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
  }),
  head: () =>
    pageHead(
      "State constitutions",
      "State constitutions from each state's official publisher, article by article.",
    ),
  component: ConstitutionsPage,
});

/** Folder note: what was retrieved, or why nothing was. */
function constitutionNote(c: Constitution): string {
  if (c.status !== "text") return c.statusLabel;
  const shape =
    c.structure === "section"
      ? `${c.sections.toLocaleString("en-US")} sections`
      : c.structure === "article"
        ? `${c.articles.toLocaleString("en-US")} articles (sections not separated)`
        : "One document";
  return `${shape} · ${c.publisher ?? "Publisher not recorded"}`;
}

function ConstitutionsPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/constitutions/" });
  const [draft, setDraft] = useState(q);
  const listFn = useServerFn(listStateConstitutions);
  const searchFn = useServerFn(searchConstitutions);
  const list = useQuery({
    queryKey: ["state-constitutions"],
    queryFn: () => listFn(),
    staleTime: 10 * 60 * 1000,
  });
  const found = useQuery({
    queryKey: ["state-constitution-search", q],
    queryFn: () => searchFn({ data: { q, state: null, offset: 0 } }),
    enabled: q.trim().length >= 2,
  });
  const rows = list.data ?? [];
  const retrieved = rows.filter((c) => c.status === "text");
  const missing = rows.filter((c) => c.status !== "text");
  const names = new Map(rows.map((c) => [c.state, c.name]));
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "State constitutions" },
      ]}
      title="State constitutions"
      description="Each state's constitution as its legislature, secretary of state or lieutenant governor publishes it, split into articles and sections where the printed text marks them."
    >
      <form
        role="search"
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ search: { q: draft.trim() } });
        }}
      >
        <label className="sr-only" htmlFor="constitution-search">
          Search constitution text
        </label>
        <input
          id="constitution-search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Words in any state constitution, e.g. eminent domain"
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
        <section className="mb-5" aria-label="Matching provisions">
          <h2 className="eyebrow">Provisions</h2>
          {found.isFetching ? (
            <p className="mt-2 text-sm text-muted-foreground">Searching constitution text…</p>
          ) : null}
          {found.error ? <ExternalError error={found.error} /> : null}
          {found.data ? (
            found.data.hits.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No provision contains every word of “{q}”.
              </p>
            ) : (
              <>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(found.data.total ?? found.data.hits.length).toLocaleString("en-US")} provisions
                  match. Showing {found.data.hits.length}, in state order.
                </p>
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card shadow-xs shadow-card">
                  {found.data.hits.map((h) => (
                    <li key={h.id} className="px-3 py-2">
                      <Link
                        to="/law/constitutions/$state"
                        params={{ state: h.state }}
                        search={{ article: h.article ?? undefined, q: "" }}
                        hash={h.id}
                        className="block hover:underline"
                      >
                        <span className="text-[13px] font-medium">{oneLine(h.title)}</span>
                      </Link>
                      <p className="m-0 text-[11px] text-muted-foreground">
                        {names.get(h.state) ?? h.state}
                      </p>
                      <Highlighted
                        text={h.snippet}
                        q={q}
                        className="mt-0.5 block text-xs leading-relaxed text-foreground/80"
                      />
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
        </section>
      ) : null}
      {list.error ? <ExternalError error={list.error} /> : null}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading state constitutions…</p>
      ) : null}
      {list.data && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No state constitutions are recorded yet.</p>
      ) : null}
      {rows.length ? (
        <FolderGrid
          title="States and DC"
          hint={`${retrieved.length} retrieved · ${missing.length} not retrieved`}
          wrapNotes
          items={rows.map((c) => ({
            key: c.state,
            label: c.name,
            count: c.status === "text" ? c.units : 0,
            note: constitutionNote(c),
            link: {
              to: "/law/constitutions/$state",
              params: { state: c.state },
              search: { q: "" },
            },
          }))}
        />
      ) : null}
      {missing.length ? (
        <p className="mt-4 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
          Not retrieved: {missing.map((c) => c.name).join(", ")}. For these the official publisher's
          server refused automated requests, served no readable text, or no current official text
          was located; each folder names the reason. Text is not taken from unofficial copies.
        </p>
      ) : null}
    </AppShell>
  );
}
