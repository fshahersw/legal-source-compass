import type { RegulatoryOverview } from "@/lib/regulatory/types";
import { displayCount, displayDate, valueText } from "./monitoringView";
import { Empty, panelClass, Qualifications, SourceLink } from "./RegulatoryPrimitives";

export function RegulatoryCoverage({ overview }: { overview: RegulatoryOverview }) {
  return (
    <div className="space-y-3">
      <section className={`${panelClass} p-3`}>
        <h2 className="mb-2 text-heading font-semibold text-foreground">Coverage and source health</h2>
        <Qualifications items={overview.qualifications} />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          A successful capture is not proof that every relevant event was published. Source windows,
          source-native counts and collection outcomes remain separate. Sources without a completed
          capture are not represented as a zero-event surveillance period.
        </p>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {overview.sources.map((source) => (
          <section key={source.id} className={`${panelClass} p-3`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-label font-semibold text-foreground">{source.label}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{source.agency}</p>
              </div>
              <span className="rounded-md border border-border px-2 py-1 text-xs">
                {source.latestAttemptStatus ??
                  (source.enabled ? "No collection recorded" : "Not enabled")}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Last completed capture</dt>
              <dd>{displayDate(source.latestCompletedAt)}</dd>
              <dt className="text-muted-foreground">Latest attempt</dt>
              <dd>{displayDate(source.latestAttemptAt)}</dd>
              <dt className="text-muted-foreground">Captured window extrema</dt>
              <dd>
                {displayDate(source.coverageFrom)} → {displayDate(source.coverageTo)}
              </dd>
              <dt className="text-muted-foreground">Retained records</dt>
              <dd>
                {source.latestCompletedAt ? displayCount(source.records) : "No completed capture"}
              </dd>
              <dt className="text-muted-foreground">Counted unit</dt>
              <dd>{source.countUnit}</dd>
            </dl>
            <p className="my-3 text-xs leading-5 text-muted-foreground">{source.qualification}</p>
            <SourceLink url={source.sourceUrl}>Source documentation or site</SourceLink>
          </section>
        ))}
      </div>
      <section className={panelClass}>
        <div className="border-b border-border p-3">
          <h2 className="text-heading font-semibold text-foreground">Recent collection runs</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Incomplete and failed windows are operational gaps, not evidence that activity declined.
          </p>
        </div>
        {overview.runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Source collection run outcomes</caption>
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Source",
                    "Mode / status",
                    "Requested window",
                    "Observed / expected",
                    "Finished",
                  ].map((label) => (
                    <th scope="col" className="px-3 py-2 font-medium" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.runs.map((run) => (
                  <tr key={run.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {overview.sources.find((source) => source.id === run.source)?.label ??
                        run.source}
                    </td>
                    <td className="px-3 py-2">
                      {run.mode} · {run.status}
                      {run.errorCode && (
                        <p className="text-xs text-muted-foreground">{run.errorCode}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {run.windowFrom} → {run.windowTo}
                      <details className="mt-1 max-w-sm">
                        <summary className="cursor-pointer text-primary underline">
                          Recorded collection scope
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                          {Object.keys(run.scope).length
                            ? valueText(run.scope)
                            : "No additional scope recorded."}
                        </pre>
                      </details>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayCount(run.observedCount)} / {displayCount(run.expectedCount)}
                    </td>
                    <td className="px-3 py-2 text-xs">{displayDate(run.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No collection runs recorded">
            Coverage has not been demonstrated for a period merely because a source appears in the
            registry.
          </Empty>
        )}
      </section>
    </div>
  );
}
