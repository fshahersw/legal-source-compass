import { Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Segmented, StateNote } from "@/components/enforcement/parts";
import { Button } from "@/components/ui/button";
import type { FederalHit, StateHit } from "@/lib/external/legislation";
import {
  getLegislationFacets,
  searchLegislation,
  type LegislationFacets,
  type LegislationSearchResult,
} from "@/lib/external/legislation.functions";
import { fmtDay, fmtN, NR } from "./format";
import { StatusChip } from "./parts";

export type LegislationSearchParams = {
  scope?: "federal" | "state" | undefined;
  q?: string | undefined;
  congress?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  policy?: string | undefined;
  state?: string | undefined;
  session?: string | undefined;
  page?: number | undefined;
};

const selectCls =
  "h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-ring";

export function LegislationSearch({ search }: { search: LegislationSearchParams }) {
  const navigate = useNavigate({ from: "/law/legislation/" });
  const scope = search.scope ?? (search.state ? "state" : "federal");
  const page = search.page ?? 1;
  const [draft, setDraft] = useState(search.q ?? "");
  useEffect(() => setDraft(search.q ?? ""), [search.q]);
  const facetsFn = useServerFn(getLegislationFacets);
  const searchFn = useServerFn(searchLegislation);
  const facets = useQuery({
    queryKey: ["legislation-facets"],
    queryFn: () => facetsFn(),
    staleTime: 30 * 60 * 1000,
  });
  const input = {
    scope,
    q: search.q ?? "",
    page,
    ...(scope === "federal"
      ? {
          ...(search.congress ? { congress: search.congress } : {}),
          ...(search.type ? { type: search.type as never } : {}),
          ...(search.status ? { status: search.status } : {}),
          ...(search.policy ? { policyArea: search.policy } : {}),
        }
      : {
          ...(search.state ? { state: search.state } : {}),
          ...(search.session ? { session: search.session } : {}),
          ...(search.status ? { status: search.status } : {}),
        }),
  } as const;
  const results = useQuery({
    queryKey: ["legislation-search", input],
    queryFn: () => searchFn({ data: input }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });
  const set = (patch: Partial<LegislationSearchParams>) =>
    void navigate({
      search: (prev: LegislationSearchParams) => ({ ...prev, page: undefined, ...patch }),
    });

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
          label="Jurisdiction"
          value={scope}
          options={[
            { id: "federal", label: "Federal (Congress)" },
            { id: "state", label: "State legislatures" },
          ]}
          onChange={(id) => set({ scope: id, status: undefined })}
        />
        <label className="sr-only" htmlFor="legislation-q">
          Search bills
        </label>
        <input
          id="legislation-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            scope === "federal"
              ? "Words, a citation (H.R. 3935) or a law (Public Law 118-63)"
              : "Words or a bill number (AB 1, HB 1001)"
          }
          className="h-8 w-full min-w-0 max-w-md flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" size="sm" variant="outline">
          <Search className="mr-1 size-3.5" aria-hidden />
          Search
        </Button>
      </form>
      <Filters scope={scope} search={search} facets={facets.data ?? null} set={set} />
      {results.isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading bills">
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
          Bills could not be loaded.
        </StateNote>
      ) : results.data ? (
        <Results
          r={results.data}
          fetching={results.isFetching}
          onPage={(p) => set({ page: p })}
          facets={facets.data ?? null}
        />
      ) : null}
    </div>
  );
}

function Filters({
  scope,
  search,
  facets,
  set,
}: {
  scope: "federal" | "state";
  search: LegislationSearchParams;
  facets: LegislationFacets | null;
  set: (p: Partial<LegislationSearchParams>) => void;
}) {
  const opt = (v: string) => (v ? v : undefined);
  if (scope === "federal") {
    const f = facets?.federal;
    return (
      <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
        <select
          aria-label="Congress"
          className={selectCls}
          value={search.congress ?? ""}
          onChange={(e) => set({ congress: opt(e.target.value) })}
        >
          <option value="">All Congresses (108th–119th)</option>
          {(f?.congresses ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} {o.count != null ? `(${fmtN(o.count)})` : ""}
            </option>
          ))}
        </select>
        <select
          aria-label="Measure type"
          className={selectCls}
          value={search.type ?? ""}
          onChange={(e) => set({ type: opt(e.target.value) })}
        >
          <option value="">All measure types</option>
          {(f?.types ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={selectCls}
          value={search.status ?? ""}
          onChange={(e) => set({ status: opt(e.target.value) })}
        >
          <option value="">Any status</option>
          {(f?.statuses ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Policy area"
          className={selectCls}
          value={search.policy ?? ""}
          onChange={(e) => set({ policy: opt(e.target.value) })}
        >
          <option value="">Any policy area</option>
          {(f?.policyAreas ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const s = facets?.state;
  const sessions = (s?.sessions ?? []).filter((o) => !search.state || o.state === search.state);
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
      <select
        aria-label="State"
        className={selectCls}
        value={search.state ?? ""}
        onChange={(e) => set({ state: opt(e.target.value), session: undefined })}
      >
        <option value="">All states, DC and Puerto Rico</option>
        {(s?.states ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} {o.count != null ? `(${fmtN(o.count)})` : ""}
          </option>
        ))}
      </select>
      <select
        aria-label="Session"
        className={selectCls}
        value={search.session ?? ""}
        disabled={!search.state}
        onChange={(e) => set({ session: opt(e.target.value) })}
      >
        <option value="">{search.state ? "Both sessions" : "Choose a state for sessions"}</option>
        {sessions.map((o) => (
          <option key={`${o.state}-${o.value}`} value={o.value}>
            {o.label}
            {o.role ? ` (${o.role})` : ""}
          </option>
        ))}
      </select>
      <select
        aria-label="Status"
        className={selectCls}
        value={search.status ?? ""}
        onChange={(e) => set({ status: opt(e.target.value) })}
      >
        <option value="">Any status</option>
        {(s?.statuses ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Results({
  r,
  fetching,
  onPage,
  facets,
}: {
  r: LegislationSearchResult;
  fetching: boolean;
  onPage: (p: number) => void;
  facets: LegislationFacets | null;
}) {
  const published = r.scope === "federal" ? facets?.federal : facets?.state;
  if (facets && !published)
    return (
      <StateNote>
        {r.scope === "federal"
          ? "The federal bill collection is not published yet."
          : "The state bill collection is not published yet."}
      </StateNote>
    );
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
            ? `${fmtN(from)}–${fmtN(to)} of ${r.total != null ? fmtN(r.total) : "too large to count"} ${r.scope === "federal" ? "measures" : "bills"}`
            : "No bills match."}
          {r.mode === "citation"
            ? " · exact citation"
            : r.mode === "law"
              ? " · bill that became this law"
              : r.mode === "identifier"
                ? " · exact bill number"
                : ""}
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
          {r.scope === "federal"
            ? r.rows.map((h) => <FederalRow key={h.id} h={h} />)
            : r.rows.map((h) => <StateRow key={h.id} h={h} />)}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          Try fewer words, another spelling of the citation, or clear a filter.
        </p>
      )}
    </section>
  );
}

function FederalRow({ h }: { h: FederalHit }) {
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to="/law/legislation/federal/$congress/$type/$number"
          params={{ congress: String(h.congress), type: h.type, number: h.number }}
          className="font-semibold text-primary hover:underline"
        >
          {h.citation}
        </Link>
        <StatusChip status={h.status} label={h.statusLabel} />
        {h.law ? <span className="text-[11px] text-muted-foreground">{h.law}</span> : null}
      </div>
      <p className="m-0 line-clamp-2 text-[13px]">{h.title}</p>
      <p className="m-0 line-clamp-2 text-[11.5px] text-muted-foreground">
        {h.sponsor ?? "Sponsor not recorded"} · Latest action {fmtDay(h.latestActionDate)}
        {h.latestAction ? `: ${h.latestAction}` : ""}
      </p>
    </li>
  );
}

function StateRow({ h }: { h: StateHit }) {
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          to="/law/legislation/state/$id"
          params={{ id: h.id }}
          className="font-semibold text-primary hover:underline"
        >
          {h.identifier}
        </Link>
        <span className="text-[12px] text-muted-foreground">
          {h.state} · {h.sessionName}
        </span>
        <StatusChip status={h.status} label={h.statusLabel} />
      </div>
      <p className="m-0 line-clamp-2 text-[13px]">{h.title}</p>
      <p className="m-0 line-clamp-2 text-[11.5px] text-muted-foreground">
        {h.sponsor ?? "Sponsor not recorded"} · Latest action{" "}
        {h.latestActionDate ? fmtDay(h.latestActionDate) : NR}
        {h.latestAction ? `: ${h.latestAction}` : ""}
      </p>
    </li>
  );
}
