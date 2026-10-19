import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/enforcement/parts";
import { listAnd, int } from "@/components/analysis/analysisFormat";
import { correlationsQuery } from "./collectionQueries";
import { correlationSummary, rhoText } from "./collectionFormat";
import { QueryPanel } from "./CollectionParts";
import { RhoMark } from "./CollectionVisuals";

/**
 * Rank correlations across the federal districts between two measures of the same thing from two official sources
 * (the dataset's "validity" pairs). They describe how closely the sources agree; none of them involves a CourtListener
 * count, and none shows that one measure causes another.
 */
export function CorrelationStrip() {
  const query = useQuery(correlationsQuery);
  const sum = correlationSummary(query.data ?? []);
  return (
    <Panel
      id="collection-correlations"
      title="Cross-source correlations"
      subtitle={`Association across ${sum.districts != null ? `up to ${int(sum.districts)} ` : ""}federal districts${sum.periods.length ? `, ${listAnd(sum.periods)}` : ""}`}
      footnote={
        <>
          Spearman rank correlation across the districts that have both values; the 95% interval is
          from the Fisher z transform. This is a descriptive association across districts: it does
          not show that one measure causes the other, and districts differ in many other ways.{" "}
          {query.data?.length
            ? `These ${int(query.data.length)} pairs compare official sources with each other (${listAnd(sum.sources)}), not CourtListener counts.`
            : ""}
        </>
      }
    >
      <QueryPanel
        query={query}
        label="Loading the cross-source correlations"
        errorText="The cross-source correlations could not be loaded."
        emptyText="The cross-source correlations are not recorded."
        isEmpty={(rows) => !rows.length}
        skeleton={<div className="h-32 animate-pulse bg-muted/50" aria-busy="true" />}
      >
        {(rows) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-xs">
              <caption className="sr-only">
                Rank correlations between the same measure from two official sources across
                districts
              </caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Same measure in two sources
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Correlation (ρ) and 95% interval
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    ρ
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    95% interval
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Districts
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Strength
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-1.5" title={r.why ?? undefined}>
                      <span className="block">
                        {r.a.label} <span className="text-muted-foreground">({r.a.source})</span>
                      </span>
                      <span className="block text-muted-foreground">
                        with {r.b.label} ({r.b.source})
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <RhoMark
                        rho={r.rho}
                        low={r.ciLow}
                        high={r.ciHigh}
                        label={`Correlation ${rhoText(r.rho)}, 95% interval ${rhoText(r.ciLow)} to ${rhoText(r.ciHigh)}, on an axis from minus 1 to plus 1`}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{rhoText(r.rho)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">
                      {rhoText(r.ciLow)} to {rhoText(r.ciHigh)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{int(r.n)}</td>
                    <td className="px-2 py-1.5">{r.strength ?? "Not recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryPanel>
    </Panel>
  );
}
