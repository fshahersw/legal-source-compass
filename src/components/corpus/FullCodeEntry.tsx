import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, BookOpen, CircleAlert } from "lucide-react";
import { getStateCodeCoverage, listStateCodes } from "@/lib/law/stateCode.functions";
import { showRecorded } from "@/lib/law/stateCodeContract";

/** Shows the actual source-review state; an imported collection is not automatically published. */
export function FullCodeEntry({ state }: { state: string }) {
  const read = useServerFn(listStateCodes),
    readCoverage = useServerFn(getStateCodeCoverage);
  const query = useQuery({
    queryKey: ["full-state-codes"],
    queryFn: () => read(),
    staleTime: 30_000,
  });
  const rows = (query.data ?? []).filter((r) => r.state === state.toUpperCase());
  const coverage = useQuery({
    queryKey: ["state-code-coverage"],
    queryFn: () => readCoverage(),
    staleTime: 30_000,
    enabled: !query.isPending && !query.error && rows.length === 0,
  });
  const intake = coverage.data?.find((r) => r.state === state.toUpperCase());
  const error = query.error || coverage.error;
  const loading = query.isPending || (!rows.length && coverage.isFetching);
  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label="Full code">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="size-4 text-primary" />
          State statutes
        </h2>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${rows.length ? "bg-[#edf4ee] text-[#3e6851]" : "bg-muted text-muted-foreground"}`}
        >
          {loading
            ? "Checking…"
            : error
              ? "Status unavailable"
              : rows.length
                ? "Published source collection"
                : intake?.status === "landed-private"
                  ? "Import awaiting review"
                  : "Not yet published"}
        </span>
      </div>
      {loading ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          Loading this state’s statutory sources…
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CircleAlert className="size-4" />
          <span>Source status could not be loaded.</span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              void query.refetch();
              void coverage.refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && !rows.length ? (
        <div className="mt-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {intake?.status === "landed-private"
              ? `${intake.sections == null ? "The captured statutes" : intake.sections.toLocaleString() + " imported sections"} remain private until source review is complete.`
              : "A reviewed statute collection is not available here yet. The source directory still provides recorded research links."}
          </p>
          {intake ? (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Capture & review details</summary>
              <dl className="mt-2 grid gap-1.5">
                <div>
                  <dt className="inline font-medium">Publisher: </dt>
                  <dd className="inline">{showRecorded(intake.publisher)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Edition: </dt>
                  <dd className="inline">{showRecorded(intake.edition)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Currency: </dt>
                  <dd className="inline">{showRecorded(intake.currency)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Review: </dt>
                  <dd className="inline">{showRecorded(intake.reviewStatus)}</dd>
                </div>
              </dl>
            </details>
          ) : null}
        </div>
      ) : null}
      {rows.map((row) => (
        <div key={`${row.kind}-${row.datasetId ?? row.state}`} className="mt-4">
          <Link
            to="/law/codes/$state"
            params={{ state: row.state }}
            search={{ q: "" }}
            className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3.5 py-3"
          >
            <span>
              <span className="block text-sm font-medium group-hover:text-primary">
                {row.codeName}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {row.sectionCount == null
                  ? "Section count not recorded"
                  : `${row.sectionCount.toLocaleString()} captured sections`}
              </span>
            </span>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Edition & currency</summary>
            <p className="mt-2 leading-relaxed">
              Edition: {showRecorded(row.edition)}. Currency: {showRecorded(row.currency)}.
              Publication of this source collection is not a certification of every legal issue or
              deadline.
            </p>
          </details>
        </div>
      ))}
    </section>
  );
}
