import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CourtArtwork } from "./CourtArtwork";
import { JudgePortrait } from "./EntityArtwork";
import {
  canonicalState,
  filterStateCourts,
  filterStateJudges,
  type StateHubSearch,
} from "@/lib/corpus/stateHub";
import { useStateCourtDirectory, useStateJudgeDirectory } from "@/lib/external/useStateDirectory";

type Props = {
  state: string;
  search: StateHubSearch;
  onSearch: (change: Partial<StateHubSearch>) => void;
};
const field =
  "h-9 min-w-0 rounded-lg border border-input bg-surface px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
function DirectoryError({ retry, message }: { retry: () => void; message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm"
    >
      <p>{message}</p>
      <Button onClick={retry} variant="outline" size="sm" className="mt-3">
        Retry directory
      </Button>
    </div>
  );
}
function Pagination({
  count,
  page,
  onPage,
}: {
  count: number;
  page: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / 24));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
      <span>
        {count
          ? `${page * 24 + 1}–${Math.min((page + 1) * 24, count)} of ${count.toLocaleString()} records`
          : "No matching records"}
      </span>
      {pages > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            aria-label="Previous directory page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => onPage(page + 1)}
            aria-label="Next directory page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
export function StateCourtDirectory({ state, search, onSearch }: Props) {
  const query = useStateCourtDirectory(state);
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () =>
      filterStateCourts(query.data ?? [], state, {
        q: search.q ?? "",
        system: search.system ?? "",
      }).sort((a, b) => a.title.localeCompare(b.title)),
    [query.data, state, search.q, search.system],
  );
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 24) - 1));
  const change = (value: Partial<StateHubSearch>) => {
    setPage(0);
    onSearch(value);
  };
  return (
    <section
      aria-label={`${canonicalState(state)?.name} courts`}
      className="dense-directory resource-panel space-y-3 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="directory-heading">Courts in {canonicalState(state)?.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Court profiles with an explicitly recorded state location.
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs tabular-nums">
          {query.data ? `${query.data.length.toLocaleString()} courts` : "Directory"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search this state's courts"
            placeholder="Search court name or type"
            value={search.q ?? ""}
            onChange={(e) => change({ q: e.target.value })}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <select
            aria-label="Court system"
            className={field}
            value={search.system ?? ""}
            onChange={(e) => change({ system: e.target.value })}
          >
            <option value="">All systems</option>
            <option value="State">State courts</option>
            <option value="Federal">Federal courts</option>
          </select>
        </label>
      </div>
      {query.isPending ? (
        <p
          role="status"
          className="rounded-xl border border-border p-8 text-sm text-muted-foreground"
        >
          Loading this state’s courts…
        </p>
      ) : query.error ? (
        <DirectoryError
          message="The state court directory could not be verified. No cross-state results are shown."
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {rows.slice(current * 24, (current + 1) * 24).map((court) => (
              <article
                key={court.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary/30 hover:bg-muted/20"
              >
                <CourtArtwork
                  courtId={court.id}
                  title={court.title}
                  system={court.system}
                  type={court.type}
                  compact
                />
                <Link
                  to="/courts/$id"
                  params={{ id: court.id }}
                  className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block text-sm font-semibold leading-snug">{court.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {court.type} · {court.system}
                  </span>
                </Link>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </article>
            ))}
          </div>
          {!rows.length ? (
            <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No recorded courts match these filters.
            </p>
          ) : null}
          <Pagination count={rows.length} page={current} onPage={setPage} />
        </>
      )}
    </section>
  );
}
export function StateJudgeDirectory({ state, search, onSearch }: Props) {
  const query = useStateJudgeDirectory(state);
  const [page, setPage] = useState(0);
  const all = useMemo(() => query.data ?? [], [query.data]);
  const rows = useMemo(
    () =>
      filterStateJudges(query.data ?? [], state, {
        q: search.q ?? "",
        system: search.system ?? "",
        court: search.court ?? "",
      }).sort((a, b) => a.name.localeCompare(b.name)),
    [query.data, state, search.q, search.system, search.court],
  );
  const courtNames = useMemo(
    () => [...new Set(all.flatMap((r) => r.courts))].sort((a, b) => a.localeCompare(b)),
    [all],
  );
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 24) - 1));
  const change = (value: Partial<StateHubSearch>) => {
    setPage(0);
    onSearch(value);
  };
  return (
    <section
      aria-label={`${canonicalState(state)?.name} judges`}
      className="dense-directory resource-panel space-y-3 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="directory-heading">
            Judges associated with {canonicalState(state)?.name}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded profile associations include historical service.
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs tabular-nums">
          {query.data ? `${all.length.toLocaleString()} profiles` : "Directory"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search this state's judges"
            placeholder="Search a recorded judge name"
            value={search.q ?? ""}
            onChange={(e) => change({ q: e.target.value })}
            className="h-9 pl-9 text-sm"
          />
        </div>
        <select
          aria-label="Judge court system"
          className={field}
          value={search.system ?? ""}
          onChange={(e) => change({ system: e.target.value })}
        >
          <option value="">All systems</option>
          <option value="State">State</option>
          <option value="Federal">Federal</option>
        </select>
        <select
          aria-label="Recorded court association"
          className={field + " max-w-full sm:max-w-72"}
          value={search.court ?? ""}
          onChange={(e) => change({ court: e.target.value })}
        >
          <option value="">All court associations</option>
          {courtNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {query.isPending ? (
        <p
          role="status"
          className="rounded-xl border border-border p-8 text-sm text-muted-foreground"
        >
          Loading this state’s judicial profiles…
        </p>
      ) : query.error ? (
        <DirectoryError
          message="The judicial directory could not be verified. Retry to load this state's profiles."
          retry={() => void query.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rows.slice(current * 24, (current + 1) * 24).map((judge) => (
              <Link
                key={judge.id}
                to="/judges/$id"
                params={{ id: judge.id }}
                className="group flex gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary/30 hover:bg-muted/20"
              >
                <JudgePortrait name={judge.name} photo={judge.photo} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-snug">{judge.name}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                    {judge.courts.join(" · ") || "Court not recorded"}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {judge.systems.join(" / ") || "System not recorded"} · Profile
                  </span>
                </span>
              </Link>
            ))}
          </div>
          {!rows.length ? (
            <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No recorded profiles match these filters.
            </p>
          ) : null}
          <Pagination count={rows.length} page={current} onPage={setPage} />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">About these associations</summary>
            <p className="mt-2 max-w-3xl leading-relaxed">
              A profile may list more than one state or court. These filters intersect recorded
              profile tags; they do not establish a paired appointment, current service, or
              governing law. Separate source-layer records are not silently merged by name.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
