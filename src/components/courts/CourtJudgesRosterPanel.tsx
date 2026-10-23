import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText } from "lucide-react";
import { hostLabel, plural } from "@/components/courts/rules/ruleFormat";
import {
  groupRoster,
  isListingHeading,
  rosterTotals,
  STATUS_EXPLANATION,
} from "@/components/judges/practices/practiceFormat";
import {
  getCourtJudgeRoster,
  TITLE_LABEL,
  type CourtCoverage,
  type RosterJudge,
} from "@/lib/external/judgePractices.functions";

/**
 * Every judge the court's own website lists, grouped by the title the page gives (district, senior, magistrate and bankruptcy judges
 * included), each linked to an existing profile only where the name and court match exactly one, with the number of individual
 * practice documents the judge's page links. Renders nothing for a court outside the federal district and bankruptcy courts.
 */
export function CourtJudgesRosterPanel({ courtId }: { courtId: string }) {
  const q = useQuery({
    queryKey: ["court-judge-roster", courtId],
    queryFn: () => getCourtJudgeRoster({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-28 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading the judges on the court's website"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
      >
        The judges listed on the court's website could not be loaded.
        <button
          type="button"
          onClick={() => void q.refetch()}
          className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Retry
        </button>
      </p>
    );
  const data = q.data;
  if (!data || (!data.coverage && !data.judges.length)) return null;
  const totals = rosterTotals(data.judges);
  const groups = groupRoster(data.judges);
  return (
    <section
      aria-label="Judges on the court's website"
      className="mb-5 rounded-lg border border-border bg-surface"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/70 px-4 py-3">
        <h2 className="m-0 text-sm font-semibold">Judges on the court's website</h2>
        <p className="m-0 text-xs text-muted-foreground">
          {data.judges.length
            ? `${plural(totals.judges, "judge")} · ${plural(totals.documents, "practice document")} from ${plural(totals.withDocuments, "judge")} · ${totals.linked} linked to a profile`
            : "No judges list read"}
        </p>
      </header>
      {data.judges.length === 0 ? (
        <Unavailable coverage={data.coverage} />
      ) : (
        <div className="space-y-4 px-4 py-3">
          {groups.map((g) => (
            <section key={g.titleClass} aria-label={g.label}>
              <h3 className="eyebrow m-0 mb-1.5">
                {g.label}
                <span className="ml-1.5 font-normal normal-case tracking-normal">
                  {g.judges.length}
                </span>
              </h3>
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {g.judges.map((j) => (
                  <JudgeRow key={j.id} j={j} groupLabel={g.label} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Footer coverage={data.coverage} dropped={data.dropped} />
    </section>
  );
}

function JudgeRow({ j, groupLabel }: { j: RosterJudge; groupLabel: string }) {
  // the words under a name are the judge's own title; a heading the court lists many judges under is the group, not the judge's title
  const showTitle =
    j.title &&
    !isListingHeading(j.titleSource) &&
    j.title.toLowerCase() !== groupLabel.toLowerCase().replace(/s$/, "")
      ? j.title
      : null;
  return (
    <li className="min-w-0 rounded-md border border-border/70 px-3 py-2">
      <p className="m-0 flex items-start justify-between gap-2 text-[13px] font-medium leading-snug">
        {j.profileId ? (
          <Link
            to="/judges/$id"
            params={{ id: j.profileId }}
            className="min-w-0 text-primary underline-offset-2 hover:underline"
          >
            {j.name}
          </Link>
        ) : (
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "judge_court_pages", id: j.id }}
            className="min-w-0 underline-offset-2 hover:underline"
            title="No existing profile matches this name at this court; open the court-page record"
          >
            {j.name}
          </Link>
        )}
        <a
          href={j.pageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${j.name} on the court's website`}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </p>
      <p className="m-0 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {showTitle ? <span>{showTitle}</span> : null}
        {j.documents > 0 ? (
          <span className="inline-flex items-center gap-1">
            <FileText className="size-3" aria-hidden />
            {plural(j.documents, "document")}
          </span>
        ) : (
          <span>No documents linked</span>
        )}
        {!j.profileId ? <span>No profile</span> : null}
        {j.pageKind === "listing_entry" ? <span>Named in a list</span> : null}
      </p>
    </li>
  );
}

function Unavailable({ coverage }: { coverage: CourtCoverage | null }) {
  const why = coverage ? (STATUS_EXPLANATION[coverage.status] ?? coverage.status) : null;
  return (
    <div className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      <p className="m-0">
        {why ?? "This court's website was not read."}
        {coverage?.note ? ` ${coverage.note}` : ""}
      </p>
      {coverage ? (
        <p className="m-0 mt-1">
          Court website:{" "}
          <a
            href={coverage.site}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {hostLabel(coverage.site)}
          </a>
        </p>
      ) : null}
    </div>
  );
}

function Footer({ coverage, dropped }: { coverage: CourtCoverage | null; dropped: number }) {
  const lists =
    coverage?.listingPages.filter((p) => p.status === 200 && (p.judgesFound ?? 0) > 0) ?? [];
  return (
    <footer className="space-y-1 border-t border-border/70 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <p className="m-0">
        As the court's own website prints them
        {lists.length ? (
          <>
            {" "}
            (read from{" "}
            {lists.slice(0, 3).map((p, i) => (
              <span key={p.url}>
                {i ? ", " : ""}
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  {hostLabel(p.url)}
                </a>
              </span>
            ))}
            )
          </>
        ) : null}
        . Titles are the words the page prints; a judge with no title there is listed under “
        {TITLE_LABEL.unclassified}”. A judge is linked to an existing profile only when exactly one
        profile has the same name at this court; the others have no profile in the corpus. Chambers
        contact details are on each judge's page.
      </p>
      {coverage?.note && coverage.judges ? <p className="m-0">{coverage.note}</p> : null}
      {dropped ? (
        <p className="m-0">{plural(dropped, "stored entry")} could not be read and is not shown.</p>
      ) : null}
    </footer>
  );
}
