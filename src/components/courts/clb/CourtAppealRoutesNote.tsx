import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SourceLink } from "@/components/enforcement/parts";
import { getClbAppealRoutes } from "./appealRoutes.functions";
import type { RouteCourt } from "./appealRoutes";

const SRC =
  "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/court-appeals-to-2026-09-30.csv.bz2";

function CourtRef({ c }: { c: RouteCourt }) {
  const span =
    c.start || c.end
      ? ` (court dates ${c.start ?? "start not recorded"} – ${c.end ?? "no end recorded"})`
      : "";
  return (
    <>
      {c.link ? (
        <Link
          to="/courts/$id"
          params={{ id: c.courtId }}
          className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {c.name}
        </Link>
      ) : (
        c.name
      )}
      <span className="text-muted-foreground">{span}</span>
    </>
  );
}

/**
 * The appeal routes CourtListener records for this court in its court-appeals-to table (dataset clb_court_appeals_to),
 * as a one-line note. The table holds 8 rows, so the note renders only for the courts it names; loading and errors are
 * silent because the note is supplementary.
 */
export function CourtAppealRoutesNote({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["clb-appeal-routes", courtId],
    queryFn: () => getClbAppealRoutes({ data: { court: courtId } }),
    staleTime: 60 * 60 * 1000,
  });
  const d = q.data;
  if (!d) return null;
  return (
    <aside
      aria-label="Recorded appeal routes"
      className="mb-5 rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-5"
    >
      {d.appealsTo.length ? (
        <p>
          <span className="font-medium">The source records appeals from this court to: </span>
          {d.appealsTo.map((c, i) => (
            <span key={c.edgeId}>
              {i ? "; " : ""}
              <CourtRef c={c} />
            </span>
          ))}
        </p>
      ) : null}
      {d.appealsFrom.length ? (
        <p>
          <span className="font-medium">The source records appeals to this court from: </span>
          {d.appealsFrom.map((c, i) => (
            <span key={c.edgeId}>
              {i ? "; " : ""}
              <CourtRef c={c} />
            </span>
          ))}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        CourtListener's court-appeals-to table (Sept 30, 2026 export) lists 8 routes, shown as
        recorded; it is not a court's full appeal path.{" "}
        <SourceLink href={SRC}>Bulk file</SourceLink>
      </p>
    </aside>
  );
}
