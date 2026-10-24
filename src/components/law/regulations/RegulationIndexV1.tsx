import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getRegulationIndex, type RegulationCode } from "@/lib/external/courtRulesLaw.functions";
import { cleanHeading, headingStatus } from "@/lib/law/stateCodeHeading";

/** The printed heading, unless it only repeats the citation (then the publisher printed no heading). */
function entryHeading(citation: string, heading: string | null): string | null {
  const clean = cleanHeading(heading);
  return clean && clean !== cleanHeading(citation) ? clean : null;
}

const PAGE = 100;

/**
 * The v1 table-of-contents index (dataset state_regulation_index): shown for a state while its v2 tree
 * (state_regs.nodes) is not loaded. Filter by citation/heading/agency and level; entries open on the publisher's site.
 */
export function RegulationIndexV1({
  code,
  q,
  level,
  onFilter,
}: {
  code: RegulationCode;
  q: string;
  level: string | undefined;
  onFilter: (next: { q: string; level: string | undefined }) => void;
}) {
  const [draft, setDraft] = useState(q);
  const indexFn = useServerFn(getRegulationIndex);
  const state = code.state;
  const entries = useInfiniteQuery({
    queryKey: ["state-regulation-index", state, level ?? null, q],
    queryFn: ({ pageParam }) =>
      indexFn({ data: { state, level: level ?? null, q, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.length * PAGE;
      return last.total !== null && loaded < last.total ? loaded : undefined;
    },
    enabled: code.status === "indexed",
    staleTime: 10 * 60 * 1000,
  });
  const rows = entries.data?.pages.flatMap((p) => p.entries) ?? [];
  const total = entries.data?.pages[0]?.total ?? null;
  const dropped = entries.data?.pages.reduce((n, p) => n + p.dropped, 0) ?? 0;
  if (code.status !== "indexed") {
    return (
      <p className="text-sm text-muted-foreground">
        {code.statusLabel}.{code.error ? ` ${code.error}` : ""} Nothing is shown from unofficial
        copies.
      </p>
    );
  }
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        {code.entries.toLocaleString("en-US")} entries (
        {code.levels
          .map((l) => `${l.count.toLocaleString("en-US")} ${l.level}${l.count === 1 ? "" : "s"}`)
          .join(", ")}
        ) from the publisher's table of contents
        {code.retrievedAt ? `, retrieved ${code.retrievedAt.slice(0, 10)}` : ""}. Index only: open
        an entry to read the rule on the publisher's site.
      </p>
      <form
        role="search"
        className="mb-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onFilter({ q: draft.trim(), level });
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
            onChange={(e) => onFilter({ q, level: e.target.value || undefined })}
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
      {entries.isLoading ? <p className="text-sm text-muted-foreground">Loading entries…</p> : null}
      {entries.data && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entry matches{q ? ` “${q}”` : ""}.</p>
      ) : null}
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
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
                    {entryHeading(e.citation, e.heading) ?? (
                      <span className="text-muted-foreground">Not recorded</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {e.agency ?? e.parent ?? "Not recorded"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {e.level}
                    {e.status
                      ? ` · ${e.status}`
                      : headingStatus(entryHeading(e.citation, e.heading))
                        ? ` · ${headingStatus(entryHeading(e.citation, e.heading))}`
                        : ""}
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
  );
}
