import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SourceLink } from "@/components/enforcement/parts";
import {
  getClbParentheticals,
  type ClusterParentheticals,
} from "@/lib/external/clbCitationExtras.functions";
import { fmtInt, fmtPct, NOT_RECORDED } from "@/components/courts/clb/clbFormat";

const parentheticalsQuery = (clusterId: number) => ({
  queryKey: ["clb-parentheticals", clusterId],
  queryFn: () => getClbParentheticals({ data: { clusterId } }),
  staleTime: 10 * 60 * 1000,
});

/**
 * How later opinions describe one of the most-cited clusters, in their own words (dataset clb_top_cited_parentheticals).
 * Shown inside the most-cited detail; every state (loading, error, none recorded) is stated in place.
 */
export function ParentheticalsBlock({
  clusterId,
  caseName,
}: {
  clusterId: number;
  caseName: string;
}) {
  const q = useQuery(parentheticalsQuery(clusterId));
  return (
    <section
      aria-label={`How courts describe ${caseName}`}
      className="mt-3 min-w-0 rounded-md border border-border"
    >
      <h4 className="border-b border-border/60 px-3 py-1.5 text-xs font-semibold">
        How later opinions describe it
      </h4>
      {q.isLoading ? (
        <div
          className="m-3 h-24 animate-pulse rounded bg-muted/50"
          aria-busy="true"
          aria-label="Loading parenthetical descriptions"
        />
      ) : q.isError ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
        >
          The descriptions could not be loaded.
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Retry
          </button>
        </p>
      ) : !q.data || q.data.parentheticals === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No parenthetical descriptions of this opinion are recorded in CourtListener.
        </p>
      ) : (
        <Body p={q.data} />
      )}
    </section>
  );
}

function Body({ p }: { p: ClusterParentheticals }) {
  const g = p.describingGroups;
  const known = g ? g.federal + g.state + g.other : 0;
  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      <p className="text-muted-foreground">
        {fmtInt(p.parentheticals)} parentheticals from {fmtInt(p.describingOpinions)} opinions, in{" "}
        {fmtInt(p.groups)} groups of similar wording
        {g && known
          ? ` · ${fmtPct((100 * g.federal) / known)} from federal and ${fmtPct((100 * g.state) / known)} from state courts`
          : ""}
        .
        {p.describingCourts.length
          ? ` Most from ${p.describingCourts
              .slice(0, 3)
              .map((c) => c.name)
              .join(", ")}.`
          : ""}
      </p>
      <ol className="space-y-2">
        {p.examples.map((e) => (
          <li key={e.id} className="min-w-0 border-l-2 border-primary/40 pl-2">
            <p className="break-words leading-5">
              “{e.text}”{e.truncated ? <span className="text-muted-foreground"> (cut)</span> : null}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {e.describingCaseWithheld ? (
                "Describing case not named (blocked from search engines)"
              ) : e.describingUrl && e.describingCase ? (
                <SourceLink href={e.describingUrl}>{e.describingCase}</SourceLink>
              ) : (
                (e.describingCase ?? "Describing case not recorded")
              )}
              {e.describingCourt ? (
                <>
                  {" · "}
                  {e.describingCourtLink ? (
                    <Link
                      to="/courts/$id"
                      params={{ id: e.describingCourtLink.slice(8) }}
                      className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {e.describingCourt}
                    </Link>
                  ) : (
                    e.describingCourt
                  )}
                </>
              ) : null}
              {` · ${e.describingYear ?? NOT_RECORDED}`}
              {e.score != null ? ` · score ${e.score.toFixed(2)}` : ""}
            </p>
          </li>
        ))}
      </ol>
      <p className="text-[11px] leading-4 text-muted-foreground">
        The highest-scored parenthetical of each group, as CourtListener extracted it from the
        describing opinion; scores and groups are CourtListener's. They show what other courts said
        about the case, not a verified statement of its holding.{" "}
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "clb_top_cited_parentheticals", id: `cluster:${p.clusterId}` }}
          className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Full record
        </Link>
      </p>
    </div>
  );
}
