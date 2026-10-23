import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { DojDocument } from "@/lib/external/oversight.functions";
import { Panel, SourceLink, StateNote } from "../parts";
import { RetryButton, Skeleton } from "./bits";
import { dojOversightQuery } from "./queries";
import { fmtDate, groupDocuments } from "./oversightView";

const COLLECTIONS: { kind: string; title: string; source: string; sourceLabel: string }[] = [
  {
    kind: "budget",
    title: "Budget and performance",
    source: "https://www.justice.gov/doj/budget-and-performance",
    sourceLabel: "DOJ Budget and Performance",
  },
  {
    kind: "eeo",
    title: "No FEAR Act equal employment opportunity data",
    source: "https://www.justice.gov/jmd/eeo-program-status-report",
    sourceLabel: "Data posted pursuant to the No FEAR Act",
  },
  {
    kind: "library",
    title: "DOJ Libraries research guides",
    source: "https://www.justice.gov/jmd/ls",
    sourceLabel: "DOJ Library Staff",
  },
];

/**
 * Department of Justice oversight and accountability documents: the Criminal Division's corporate enforcement
 * (voluntary self-disclosure) resolution letters, and indexes of official budget, performance, EEO-data and Library links.
 * The documents stay on justice.gov; only the pages' own labels and links are stored.
 */
export function DojView({ onOpenOig }: { onOpenOig: (oig: string) => void }) {
  const q = useQuery(dojOversightQuery);
  const grouped = useMemo(() => {
    const docs = q.data?.documents ?? [];
    return COLLECTIONS.map((c) => ({
      ...c,
      groups: groupDocuments(docs.filter((d) => d.kind === c.kind)),
    }));
  }, [q.data]);
  if (q.isLoading)
    return <Skeleton label="Loading Department of Justice documents" className="h-72" />;
  if (q.isError)
    return (
      <StateNote tone="error" action={<RetryButton onRetry={() => void q.refetch()} />}>
        Department of Justice documents could not be loaded.
      </StateNote>
    );
  const resolutions = q.data?.resolutions ?? [];
  return (
    <div className="space-y-3">
      <Panel
        title="Criminal Division corporate enforcement resolutions"
        subtitle="Voluntary self-disclosure resolution letters listed by the Corporate Enforcement and Compliance Unit"
        footnote={
          <>
            Source:{" "}
            <SourceLink href="https://www.justice.gov/criminal/criminal-fraud/vsd-resolutions-part-1">
              CEP VSD Resolutions (Part 1)
            </SourceLink>{" "}
            (formerly the Corporate Enforcement Policy declinations list). Company names and dates
            are the list&rsquo;s own; the page does not classify each letter, so none is labelled a
            declination here. A company profile is linked only when the name equals a stored SEC
            registrant name exactly.
          </>
        }
      >
        {resolutions.length === 0 ? (
          <div className="p-3">
            <StateNote>The resolution list is not published in this workspace yet.</StateNote>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-xs">
              <caption className="sr-only">
                Criminal Division corporate enforcement resolutions, newest first
              </caption>
              <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Listed
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Company as listed
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Company profile
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {resolutions.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono">{fmtDate(r.date)}</td>
                    <td className="px-2 py-1.5">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        {r.label}
                      </a>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.companyCik ? (
                        <Link
                          to="/companies/$cik"
                          params={{ cik: r.companyCik }}
                          className="text-primary hover:underline"
                        >
                          Open company profile
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          Not linked (no exact name match)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel
        title="DOJ budget, performance, EEO data and Library indexes"
        subtitle="Official links as the Department prints them; the documents open on justice.gov"
        actions={
          <button
            type="button"
            onClick={() => onOpenOig("Department of Justice OIG")}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            DOJ Inspector General reports
          </button>
        }
        footnote="The Justice Manual is not indexed here. Each list is a copy of the page's own links; a year is shown only where the label prints one."
      >
        <div className="space-y-1 p-2">
          {grouped.map((c) => (
            <details
              key={c.kind}
              className="group rounded-md border border-border/70"
              open={c.kind === "budget"}
            >
              <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {c.title}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {c.groups.reduce((n, g) => n + g.docs.length, 0)} links ·{" "}
                  <SourceLink href={c.source}>{c.sourceLabel}</SourceLink>
                </span>
              </summary>
              {c.groups.length === 0 ? (
                <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                  Not published in this workspace yet.
                </p>
              ) : (
                <div className="grid gap-x-6 gap-y-2 border-t border-border/60 px-3 py-2 md:grid-cols-2">
                  {c.groups.map((g) => (
                    <div key={g.group} className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground">{g.group}</p>
                      <ul className="mt-0.5 space-y-0.5 text-xs">
                        {g.docs.map((d) => (
                          <li key={d.id} className="min-w-0 truncate">
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                              title={d.title}
                            >
                              {d.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
