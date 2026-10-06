import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getStateCodeCoverage, listStateCodes } from "@/lib/law/stateCode.functions";
import { showRecorded } from "@/lib/law/stateCodeContract";

/** Live full-code entry for one state, or the literal "Not yet captured". */
export function FullCodeEntry({ state }: { state: string }) {
  const fn = useServerFn(listStateCodes);
  const coverageFn = useServerFn(getStateCodeCoverage);
  const query = useQuery({
    queryKey: ["full-state-codes"],
    queryFn: () => fn(),
    staleTime: 0,
  });
  const usps = state.toUpperCase();
  const rows = (query.data ?? []).filter((row) => row.state === usps);
  const coverage = useQuery({
    queryKey: ["state-code-coverage"],
    queryFn: () => coverageFn(),
    staleTime: 0,
    enabled: !query.isLoading && !query.error && rows.length === 0,
  });
  const landed = coverage.data?.find((row) => row.state === usps);

  return (
    <section
      className="rounded-lg border border-border bg-surface p-4 shadow-card"
      aria-label="Full code"
    >
      <h2 className="text-sm font-semibold">Full code</h2>
      {query.isLoading ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Loading full code status…</p>
      ) : null}
      {query.error ? (
        <div className="mt-2">
          <ExternalError error={query.error} />
        </div>
      ) : null}
      {!query.isLoading && !query.error && rows.length === 0 ? (
        coverage.isLoading ? (
          <p className="mt-2 text-[13px] text-muted-foreground">Loading full code status…</p>
        ) : coverage.error ? (
          <div className="mt-2">
            <ExternalError error={coverage.error} />
          </div>
        ) : landed?.status === "landed-private" ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Landed privately. Publisher: {showRecorded(landed.publisher)}. Edition:{" "}
            {showRecorded(landed.edition)}.
            {landed.sections == null
              ? " Section count: Not recorded."
              : ` ${landed.sections.toLocaleString()} sections are in the private intake.`}{" "}
            Section text is not shown until the review flag allows it. Currency:{" "}
            {showRecorded(landed.currency)}. Review status: {showRecorded(landed.reviewStatus)}.
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">Not yet captured</p>
        )
      ) : null}
      {rows.map((row) => (
        <div key={`${row.kind}-${row.datasetId ?? row.state}`} className="mt-2 text-[13px]">
          <Link
            to="/law/codes/$state"
            params={{ state: row.state }}
            search={{ q: "" }}
            className="font-medium text-primary underline underline-offset-4"
          >
            {row.codeName}
          </Link>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {row.sectionCount == null
              ? "Section count: Not recorded"
              : `${row.sectionCount.toLocaleString()} sections`}
            {" · "}Edition: {showRecorded(row.edition)}
            {" · "}Currency: {showRecorded(row.currency)}
          </p>
        </div>
      ))}
    </section>
  );
}
