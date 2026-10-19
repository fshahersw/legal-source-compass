import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { stateByUsps } from "@/lib/corpus/geo";
import { getRegulationIndex, listRegulationCodes } from "@/lib/external/courtRulesLaw.functions";

export const Route = createFileRoute("/law_/regulations/$state")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
    level:
      typeof search["level"] === "string" && /^[a-z ]{2,30}$/.test(search["level"])
        ? search["level"]
        : undefined,
  }),
  head: ({ params }) => {
    const name = stateByUsps.get(params.state.toUpperCase())?.name ?? params.state;
    return pageHead(
      `${name} administrative code`,
      `Table of contents of the ${name} administrative code from its official publisher.`,
    );
  },
  component: StateRegulationsPage,
});

const PAGE = 100;

function StateRegulationsPage() {
  const { state: raw } = Route.useParams();
  const state = raw.toUpperCase();
  const { q, level } = Route.useSearch();
  const navigate = useNavigate({ from: "/law/regulations/$state" });
  const [draft, setDraft] = useState(q);
  const listFn = useServerFn(listRegulationCodes);
  const indexFn = useServerFn(getRegulationIndex);
  const codes = useQuery({
    queryKey: ["state-regulation-codes"],
    queryFn: () => listFn(),
    staleTime: 10 * 60 * 1000,
  });
  const code = codes.data?.find((c) => c.state === state) ?? null;
  const entries = useInfiniteQuery({
    queryKey: ["state-regulation-index", state, level ?? null, q],
    queryFn: ({ pageParam }) =>
      indexFn({ data: { state, level: level ?? null, q, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.length * PAGE;
      return last.total !== null && loaded < last.total ? loaded : undefined;
    },
    enabled: code?.status === "indexed",
    staleTime: 10 * 60 * 1000,
  });
  const name = stateByUsps.get(state)?.name ?? state;
  const rows = entries.data?.pages.flatMap((p) => p.entries) ?? [];
  const total = entries.data?.pages[0]?.total ?? null;
  const dropped = entries.data?.pages.reduce((n, p) => n + p.dropped, 0) ?? 0;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "State administrative codes", to: "/law/regulations" },
        { label: name },
      ]}
      title={code?.code ?? `${name} administrative code`}
      {...(code?.publisher ? { description: code.publisher } : {})}
    >
      {codes.error ? <ExternalError error={codes.error} /> : null}
      {codes.isLoading ? (
        <div
          className="h-24 animate-pulse rounded-lg border border-border bg-muted/40"
          aria-busy="true"
          aria-label="Loading"
        />
      ) : null}
      {codes.data && !code ? (
        <p className="text-sm text-muted-foreground">
          No administrative code index is recorded for {name}.{" "}
          <Link to="/law/regulations" search={{ q: "" }} className="text-primary underline">
            All states
          </Link>
        </p>
      ) : null}
      {code ? (
        <section
          aria-label="Source"
          className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-xs"
        >
          <p className="m-0 leading-relaxed">
            {code.status === "indexed"
              ? `${code.entries.toLocaleString("en-US")} entries (${code.levels.map((l) => `${l.count.toLocaleString("en-US")} ${l.level}${l.count === 1 ? "" : "s"}`).join(", ")}) from the publisher's table of contents${code.retrievedAt ? `, retrieved ${code.retrievedAt.slice(0, 10)}` : ""}. Index only: open an entry to read the rule on the publisher's site.`
              : `${code.statusLabel}.${code.error ? ` ${code.error}` : ""} Nothing is shown from unofficial copies.`}
          </p>
          {code.url ? (
            <p className="m-0 mt-1.5 text-[11px]">
              <a
                href={code.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Official table of contents <ExternalLink className="size-3" aria-hidden />
              </a>
            </p>
          ) : null}
        </section>
      ) : null}
      {code?.status === "indexed" ? (
        <>
          <form
            role="search"
            className="mb-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({ search: { q: draft.trim(), level } });
            }}
          >
            <label className="sr-only" htmlFor="state-regulation-search">
              Filter by citation, heading or agency
            </label>
            <input
              id="state-regulation-search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Citation, heading or agency"
              className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            />
            {code.levels.length > 1 ? (
              <select
                aria-label="Level"
                value={level ?? ""}
                onChange={(e) =>
                  void navigate({ search: { q, level: e.target.value || undefined } })
                }
                className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">All levels</option>
                {code.levels.map((l) => (
                  <option key={l.level} value={l.level}>
                    {l.level} ({l.count.toLocaleString("en-US")})
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              Filter
            </button>
          </form>
          {entries.error ? <ExternalError error={entries.error} /> : null}
          {entries.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading entries…</p>
          ) : null}
          {entries.data && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entry matches{q ? ` “${q}”` : ""}.</p>
          ) : null}
          {rows.length ? (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
                <thead className="border-b border-border text-[11px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Citation
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Heading
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Agency or part of
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Level
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {rows.map((e) => (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {e.citation}
                        </a>
                      </td>
                      <td className="px-3 py-1.5">
                        {e.heading ?? <span className="text-muted-foreground">Not recorded</span>}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {e.agency ?? e.parent ?? "Not recorded"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {e.level}
                        {e.status ? ` · ${e.status}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {rows.length ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                Showing {rows.length.toLocaleString("en-US")}
                {total !== null ? ` of ${total.toLocaleString("en-US")}` : ""}
                {dropped
                  ? ` · ${dropped.toLocaleString("en-US")} stored entries could not be read`
                  : ""}
              </span>
              {entries.hasNextPage ? (
                <button
                  type="button"
                  onClick={() => void entries.fetchNextPage()}
                  disabled={entries.isFetchingNextPage}
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                >
                  {entries.isFetchingNextPage ? "Loading…" : `Show ${PAGE} more`}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
