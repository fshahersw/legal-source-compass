import { useQuery } from "@tanstack/react-query";
import type { HeadlineFigure } from "@/lib/external/enforcementActions.functions";
import { cn } from "@/lib/utils";
import { Panel, SourceLink, StateNote } from "../parts";
import { companyEnforcementQuery } from "./actionsView";
import { FigureCell } from "./bits";
import { fmtInt, fmtUsd, NOT_RECORDED } from "./format";

/**
 * Compact "Enforcement" panel for /companies/<cik>: DOJ releases, SEC actions and FTC actions/cases whose named party
 * equals this registrant's name after exact normalisation (no fuzzy matching).
 */
export function CompanyEnforcementPanel({ cik, className }: { cik: string; className?: string }) {
  const q = useQuery(companyEnforcementQuery(cik));
  const body = (() => {
    if (q.isLoading)
      return (
        <div
          className="h-24 animate-pulse rounded-md bg-muted/50"
          aria-busy="true"
          aria-label="Loading enforcement actions"
        />
      );
    if (q.isError)
      return (
        <StateNote
          tone="error"
          action={
            <button type="button" className="underline" onClick={() => void q.refetch()}>
              Retry
            </button>
          }
        >
          Enforcement actions could not be loaded.
        </StateNote>
      );
    const d = q.data;
    if (!d || (!d.doj.length && !d.sec.length && !d.ftcActions.length && !d.ftcCases.length))
      return (
        <StateNote>
          No DOJ release, SEC action or FTC action names this company exactly. Names are matched
          only on the exact registrant name, so actions against subsidiaries or differently written
          names are not listed.
        </StateNote>
      );
    type Item = {
      key: string;
      date: string | null;
      source: string;
      title: string;
      url: string | null;
      /** DOJ/SEC: the headline figure, with the largest stated figure below it when it differs. */
      headline: HeadlineFigure | null;
      largest: number | null;
      /** FTC: the ordered amount as listed. */
      ordered: number | null;
      note: string | null;
    };
    const items: Item[] = [
      ...d.doj.map((r) => ({
        key: r.id,
        date: r.date,
        source: "DOJ",
        title: r.title,
        url: r.url,
        headline: r.headline,
        largest: r.maxResolutionUsd,
        ordered: null,
        note: r.components[0] ?? null,
      })),
      ...d.sec.map((s) => ({
        key: s.id,
        date: s.date,
        source: "SEC",
        title: `${s.releaseNumber}: ${s.respondents}`,
        url: s.url,
        headline: s.headline,
        largest: s.maxResolutionUsd,
        ordered: null,
        note: s.type,
      })),
      ...d.ftcActions.map((a) => ({
        key: a.id,
        date: a.date,
        source: "FTC",
        title: a.name,
        url: a.page ?? a.sourceUrl,
        headline: null,
        largest: null,
        ordered: a.orderedAmount,
        note: a.actionType,
      })),
      ...d.ftcCases.map((c) => ({
        key: c.id,
        date: c.lastUpdated,
        source: "FTC case",
        title: c.name,
        url: c.url,
        headline: null,
        largest: null,
        ordered: null,
        note: [c.actionType, c.status].filter(Boolean).join(" · ") || null,
      })),
    ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Enforcement actions naming this company</caption>
          <thead className="text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Date
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Source
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Action
              </th>
              <th
                scope="col"
                className="px-2 py-1.5 text-right font-medium"
                title="DOJ and SEC: the figure the title states with a resolution verb, else the first resolution figure in the text (the largest stated figure below it when it differs). FTC: the ordered amount as listed."
              >
                Figure stated
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.slice(0, 25).map((i) => (
              <tr key={i.key} className="align-top">
                <td className="whitespace-nowrap px-2 py-1 font-mono">{i.date ?? NOT_RECORDED}</td>
                <td className="whitespace-nowrap px-2 py-1">{i.source}</td>
                <td className="min-w-[12rem] px-2 py-1">
                  {i.url ? <SourceLink href={i.url}>{i.title}</SourceLink> : i.title}
                  {i.note ? (
                    <span className="block text-[11px] text-muted-foreground">{i.note}</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-right font-mono">
                  {i.ordered != null ? (
                    <span title="Ordered amount, as the FTC lists it">{fmtUsd(i.ordered)}</span>
                  ) : (
                    <FigureCell headline={i.headline} largest={i.largest} none="—" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length > 25 ? (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">
            Newest 25 of {fmtInt(items.length)} shown.
          </p>
        ) : null}
      </div>
    );
  })();
  return (
    <Panel
      title="Enforcement"
      subtitle="DOJ press releases, SEC actions and FTC actions naming this company"
      className={cn(className)}
      footnote="Matched only when a named party equals the SEC registrant name after exact normalisation (case, punctuation and corporate suffixes). Figures are as stated by the agency, not verified payments; a release's largest stated figure can belong to a related or earlier matter, so it is shown only as a second line."
    >
      <div className="p-2">{body}</div>
    </Panel>
  );
}
