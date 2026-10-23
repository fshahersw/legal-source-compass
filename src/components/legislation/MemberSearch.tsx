import { Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Segmented, StateNote } from "@/components/enforcement/parts";
import { Button } from "@/components/ui/button";
import type { MemberHit } from "@/lib/external/congressMembers";
import {
  getMemberFacets,
  searchMembers,
  type MemberFacets,
  type MemberSearchResult,
} from "@/lib/external/congressMembers.functions";
import { fmtN } from "./format";

export type MemberSearchParams = {
  q?: string | undefined;
  status?: "current" | "former" | "all" | undefined;
  chamber?: "senate" | "house" | undefined;
  state?: string | undefined;
  party?: string | undefined;
  congress?: string | undefined;
  page?: number | undefined;
};

const selectCls =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-ring";

export function MemberSearch({ search }: { search: MemberSearchParams }) {
  const navigate = useNavigate({ from: "/law/legislation/members/" });
  const status = search.status ?? "current";
  const page = search.page ?? 1;
  const [draft, setDraft] = useState(search.q ?? "");
  useEffect(() => setDraft(search.q ?? ""), [search.q]);
  const facetsFn = useServerFn(getMemberFacets);
  const searchFn = useServerFn(searchMembers);
  const facets = useQuery({
    queryKey: ["member-facets"],
    queryFn: () => facetsFn(),
    staleTime: 30 * 60 * 1000,
  });
  const input = {
    q: search.q ?? "",
    status,
    page,
    ...(search.chamber ? { chamber: search.chamber } : {}),
    ...(search.state ? { state: search.state } : {}),
    ...(search.party ? { party: search.party } : {}),
    ...(search.congress ? { congress: search.congress } : {}),
  } as const;
  const results = useQuery({
    queryKey: ["member-search", input],
    queryFn: () => searchFn({ data: input }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  const set = (patch: Partial<MemberSearchParams>) =>
    void navigate({
      search: (prev: MemberSearchParams) => ({ ...prev, page: undefined, ...patch }),
    });
  const opt = (v: string) => (v ? v : undefined);

  return (
    <div className="min-w-0 space-y-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.trim() || undefined });
        }}
      >
        <Segmented
          label="Service status"
          value={status}
          options={[
            { id: "current", label: "Current" },
            { id: "former", label: "Former" },
            { id: "all", label: "All" },
          ]}
          onChange={(id) => set({ status: id === "current" ? undefined : id })}
        />
        <label className="sr-only" htmlFor="member-q">
          Search members
        </label>
        <input
          id="member-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="A name, or a Bioguide ID (A000055)"
          className="h-8 w-full min-w-0 max-w-md flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" size="sm" variant="outline">
          <Search className="mr-1 size-3.5" aria-hidden />
          Search
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
        <select
          aria-label="Chamber served in"
          className={selectCls}
          value={search.chamber ?? ""}
          onChange={(e) =>
            set({ chamber: (opt(e.target.value) as MemberSearchParams["chamber"]) ?? undefined })
          }
        >
          <option value="">Both chambers</option>
          <option value="senate">Senate</option>
          <option value="house">House of Representatives</option>
        </select>
        <select
          aria-label="State or territory"
          className={selectCls}
          value={search.state ?? ""}
          onChange={(e) => set({ state: opt(e.target.value) })}
        >
          <option value="">All states and territories</option>
          {(facets.data?.states ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Party"
          className={selectCls}
          value={search.party ?? ""}
          onChange={(e) => set({ party: opt(e.target.value) })}
        >
          <option value="">Any party in the party history</option>
          {(facets.data?.parties ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Congress served in"
          className={selectCls}
          value={search.congress ?? ""}
          onChange={(e) => set({ congress: opt(e.target.value) })}
        >
          <option value="">Any Congress</option>
          {(facets.data?.congresses ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {results.isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading members">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : results.isError ? (
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              className="text-primary underline"
              onClick={() => void results.refetch()}
            >
              Retry
            </button>
          }
        >
          Members could not be loaded.
        </StateNote>
      ) : results.data ? (
        <Results
          r={results.data}
          fetching={results.isFetching}
          onPage={(p) => set({ page: p })}
          facets={facets.data}
        />
      ) : null}
    </div>
  );
}

function Results({
  r,
  fetching,
  onPage,
  facets,
}: {
  r: MemberSearchResult;
  fetching: boolean;
  onPage: (p: number) => void;
  facets: MemberFacets | undefined;
}) {
  if (facets === null) return <StateNote>The members collection is not published yet.</StateNote>;
  const from = (r.page - 1) * r.pageSize + 1;
  const to = from + r.rows.length - 1;
  const last = r.total != null ? Math.max(1, Math.ceil(r.total / r.pageSize)) : null;
  return (
    <section
      aria-label="Results"
      aria-busy={fetching}
      className={fetching ? "opacity-70" : undefined}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span role="status">
          {r.rows.length
            ? `${fmtN(from)}–${fmtN(to)} of ${r.total != null ? fmtN(r.total) : "too large to count"} members`
            : "No members match."}
          {r.mode === "bioguide" ? " · exact Bioguide ID" : ""}
          {r.dropped ? ` · ${r.dropped} malformed row${r.dropped === 1 ? "" : "s"} not shown` : ""}
        </span>
        {r.rows.length ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={r.page <= 1}
              onClick={() => onPage(r.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular-nums">
              Page {r.page}
              {last ? ` of ${fmtN(last)}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={
                (last != null && r.page >= last) || r.rows.length < r.pageSize || r.page >= 200
              }
              onClick={() => onPage(r.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </span>
        ) : null}
      </div>
      {r.rows.length ? (
        <ol className="m-0 list-none divide-y divide-border/70 overflow-hidden rounded-md border border-border bg-surface p-0">
          {r.rows.map((h) => (
            <MemberRow key={h.id} h={h} />
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          Try a surname, a different spelling, or clear a filter.
        </p>
      )}
    </section>
  );
}

/** Party in a quiet neutral chip (the name the API gives, no party colours). */
export function PartyChip({
  party,
  abbreviation,
}: {
  party: string | null;
  abbreviation: string | null;
}) {
  if (!party) return null;
  return (
    <span
      title={party}
      className="inline-flex shrink-0 items-center rounded border border-border bg-muted/60 px-1.5 py-px text-[10.5px] font-medium text-muted-foreground"
    >
      {abbreviation ?? party}
    </span>
  );
}

function placeLine(h: Pick<MemberHit, "memberType" | "chamber" | "state" | "district" | "years">) {
  return [
    h.memberType ?? h.chamber,
    h.state,
    h.district ? (h.district === "At large" ? "At large" : `District ${h.district}`) : null,
    h.years,
  ]
    .filter(Boolean)
    .join(" · ");
}

function MemberRow({ h }: { h: MemberHit }) {
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to="/law/legislation/members/$bioguide"
          params={{ bioguide: h.id }}
          className="font-semibold text-primary hover:underline"
        >
          {h.name}
        </Link>
        <PartyChip party={h.party} abbreviation={h.partyAbbreviation} />
        {h.current ? (
          <span className="inline-flex shrink-0 items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-[10.5px] font-medium text-primary">
            Current
          </span>
        ) : null}
      </div>
      <p className="m-0 text-[12px] text-muted-foreground">
        {placeLine(h) || "Service not recorded"}
      </p>
    </li>
  );
}
