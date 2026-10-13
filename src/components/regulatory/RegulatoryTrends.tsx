import { useQuery } from "@tanstack/react-query";
import { getRegulatoryTrends } from "@/lib/external/regulatory.functions";
import type { RegulatoryQuery } from "@/lib/regulatory/types";
import { displayCount, displayDate, quickTrendWindow } from "./monitoringView";
import { actionClass, Empty, LoadError, panelClass, Pending } from "./RegulatoryPrimitives";

export function RegulatoryTrends({
  query,
  onRange,
}: {
  query: RegulatoryQuery;
  onRange: (range: { from: string; to: string }) => void;
}) {
  const { limit: _limit, offset: _offset, ...scope } = query;
  const validRange =
    !!query.from &&
    !!query.to &&
    query.from <= query.to &&
    Date.parse(query.to) - Date.parse(query.from) <= 366 * 86400000;
  const result = useQuery({
    queryKey: ["regulatory-trends", scope],
    queryFn: () =>
      getRegulatoryTrends({
        data: {
          ...scope,
          from: query.from!,
          to: query.to!,
          dateBasis: query.dateBasis ?? "detected",
        },
      }),
    enabled: validRange,
    staleTime: 30000,
  });
  const ranges = (
    <div className="flex flex-wrap items-center gap-2" aria-label="Quick trend windows">
      <span className="text-xs text-muted-foreground">
        {query.dateBasis === "published" ? "Publisher date" : "First detected date"} · inclusive UTC
        days:
      </span>
      {([7, 30, 90] as const).map((days) => (
        <button
          key={days}
          type="button"
          className={actionClass}
          onClick={() => onRange(quickTrendWindow(days))}
        >
          Past {days} days
        </button>
      ))}
    </div>
  );
  if (!validRange)
    return (
      <div className="space-y-3">
        {ranges}
        <section className={panelClass}>
          <Empty title="Choose a complete comparison window">
            Select a quick window or use the From and To filters above. Trend windows must be
            ordered and no longer than 366 days; no period or zero counts have been inferred.
          </Empty>
        </section>
      </div>
    );
  if (result.isPending)
    return (
      <div className="space-y-3">
        {ranges}
        <Pending />
      </div>
    );
  if (result.isError)
    return (
      <div className="space-y-3">
        {ranges}
        <LoadError retry={() => void result.refetch()} />
      </div>
    );
  const trend = result.data;
  const maximum = Math.max(1, ...trend.points.map((point) => point.events));
  return (
    <div className="space-y-3">
      {ranges}
      <section className={`${panelClass} p-3`}>
        <h2 className="font-sans text-base font-semibold">Recorded observation patterns</h2>
        <p className="mt-1 text-sm">
          {query.from} → {query.to} · {trend.countUnit} ·{" "}
          {trend.dateBasis === "published" ? "Publisher date" : "First detected date"}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{trend.qualification}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          These are source-version events. They do not measure injuries, affected people, causation
          or incidence. The series follows the selected source, text, event-type and exact-entity
          filters.
        </p>
      </section>
      <section className={panelClass}>
        {trend.points.length ? (
          <>
            <div className="overflow-x-auto p-3">
              <div
                role="img"
                aria-label="Source-version event counts by returned date. Exact values follow in the table."
                className="flex h-40 min-w-full items-end gap-1"
                style={{ minWidth: Math.max(280, trend.points.length * 9) }}
              >
                {trend.points.map((point) => (
                  <div
                    key={point.day}
                    className="flex h-full min-w-1 flex-1 items-end"
                    title={`${point.day}: ${point.events} source-version events`}
                  >
                    <div
                      aria-hidden
                      className="w-full rounded-t-sm bg-primary/70"
                      style={{
                        height: `${(point.events / maximum) * 100}%`,
                        minHeight: point.events > 0 ? 2 : 0,
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{trend.points[0]?.day}</span>
                <span>Only dates returned by the source query are shown</span>
                <span>{trend.points.at(-1)?.day}</span>
              </p>
            </div>
            <div className="max-h-96 overflow-auto border-t border-border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Exact daily source-version event counts</caption>
                <thead className="sticky top-0 bg-surface text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Date
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      All events
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Initial / backfill
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Changes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trend.points.map((point) => (
                    <tr key={point.day} className="border-t border-border">
                      <th scope="row" className="px-3 py-2 font-normal">
                        {point.day}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {displayCount(point.events)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {displayCount(point.initialRecords)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {displayCount(point.changes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty title="No retained events in this query window">
            This does not establish an absence of real-world events. Check collection coverage
            before making a comparison.
          </Empty>
        )}
      </section>
      <section className={`${panelClass} p-3`}>
        <h3 className="mb-2 font-sans text-sm font-semibold">
          Coverage and possible series breaks
        </h3>
        <ul className="space-y-3 text-sm">
          {trend.sources.map((source) => (
            <li key={source.id}>
              <p className="font-medium">
                {source.label} · {source.latestAttemptStatus ?? "No collection recorded"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Captured window extrema: {displayDate(source.coverageFrom)} →{" "}
                {displayDate(source.coverageTo)}. Last completed:{" "}
                {displayDate(source.latestCompletedAt)}.
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{source.qualification}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
          No exposure denominator, deduplicated patient universe or validated disproportionality
          analysis is available in this view. Initial captures, historical backfills and changed
          source coverage can alter the series.
        </p>
      </section>
    </div>
  );
}
