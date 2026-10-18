import { useQuery } from "@tanstack/react-query";
import { InsightError, InsightPanel, InsightSkeleton } from "./DailyInsightCard";
import { allDailyInsightsQuery, formatDayKey } from "./insightQueries";

/**
 * Hub body for /analytics: today's insight for every analytics section, loaded in one request. The section list
 * comes from the server (lib/insights/registry), so a new section appears here without a change to this file.
 */
export function InsightsHub() {
  const q = useQuery(allDailyInsightsQuery);
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the insights of the day">
        {Array.from({ length: 4 }, (_, i) => (
          <InsightSkeleton key={i} />
        ))}
      </div>
    );
  if (q.isError || !q.data) return <InsightError onRetry={() => void q.refetch()} />;
  const { dayKey, sections } = q.data;
  return (
    <div className="max-w-5xl space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        <time dateTime={dayKey} className="font-medium text-foreground">
          {formatDayKey(dayKey)} (UTC)
        </time>
        . Each section below shows one insight, chosen from a small set computed from the published
        data behind its charts. The choice rotates once a day at 00:00 UTC. Every figure is read
        from stored records or calculated from them; none is written by hand or by a model.
      </p>
      <nav aria-label="Sections on this page" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {sections.map((s) => (
          <a
            key={s.section}
            href={`#insight-${s.section}`}
            className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.title}
          </a>
        ))}
      </nav>
      {sections.length === 0 ? (
        <p
          role="status"
          className="rounded-md border border-border px-4 py-4 text-sm text-muted-foreground"
        >
          No analytics sections are registered yet.
        </p>
      ) : null}
      {sections.map((s) => (
        <div key={s.section} id={`insight-${s.section}`} className="scroll-mt-4">
          <InsightPanel
            data={s}
            dayKey={dayKey}
            variant="compact"
            onRetry={() => void q.refetch()}
          />
        </div>
      ))}
    </div>
  );
}
