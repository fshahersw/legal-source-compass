import { useQuery } from "@tanstack/react-query";
import { Panel, SourceLink, StateNote } from "../parts";
import { companyCepQuery } from "./queries";
import { fmtDate } from "./oversightView";

/**
 * Criminal Division corporate enforcement (CEP) voluntary self-disclosure resolutions that name this company
 * (/companies/<cik>). A resolution is listed only when the Division's printed company name equals the stored registrant
 * name after exact normalisation; subsidiaries and differently written names are not matched. The panel renders nothing
 * when no resolution matches, so most company pages are unchanged.
 */
export function CompanyCepPanel({ cik, className = "" }: { cik: string; className?: string }) {
  const q = useQuery(companyCepQuery(cik));
  if (q.isLoading) return null;
  if (q.isError)
    return (
      <div className={className}>
        <StateNote
          tone="error"
          action={
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="rounded text-primary underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Retry
            </button>
          }
        >
          Corporate enforcement resolutions could not be loaded.
        </StateNote>
      </div>
    );
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <Panel
      className={className}
      title="DOJ corporate enforcement resolutions"
      subtitle="Criminal Division voluntary self-disclosure resolution letters naming this company exactly"
      footnote={
        <>
          Source:{" "}
          <SourceLink href="https://www.justice.gov/criminal/criminal-fraud/vsd-resolutions-part-1">
            Criminal Division, CEP VSD Resolutions (Part 1)
          </SourceLink>
          . Matched only on the exact registrant name; the list does not say whether each letter is
          a declination.
        </>
      }
    >
      <ul className="divide-y divide-border/60 text-xs">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5"
          >
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {r.label}
            </a>
            <span className="font-mono text-muted-foreground">Listed {fmtDate(r.date)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
