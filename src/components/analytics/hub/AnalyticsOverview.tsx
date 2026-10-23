import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { blocksInGroup, groupsOnPage, type AnalyticsPageId } from "@/lib/analytics/registry";
import { FtcConsumerSection } from "./FtcConsumerSection";
import { SecRegistrationTrends } from "@/components/enforcement/regulatory/SecRegistrationTrends";
import { TrendCard } from "./TrendCard";

const READING_NOTE =
  "Each block counts one thing, states its unit, period and source, and links to the page with the detail. A period still in progress is marked * and drawn dashed or hatched and is never the latest value. A period a source does not record is left as a gap, never shown as zero. Nothing is estimated or projected.";

/**
 * Body of /analytics and of its depth pages: trend blocks in groups. Every block loads and fails on its own; the
 * layout is fixed by the registry, so nothing moves while data arrives.
 */
export function AnalyticsPageBody({
  page,
  intro = READING_NOTE,
}: {
  page: AnalyticsPageId;
  intro?: string;
}) {
  const groups = groupsOnPage(page);
  return (
    <div className="space-y-5">
      <p className="max-w-4xl text-xs leading-5 text-muted-foreground">{intro}</p>
      {groups.length > 1 ? (
        <nav aria-label="Groups on this page" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {groups.map((g) => (
            <a
              key={g.id}
              href={`#group-${g.id}`}
              className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {g.title}
            </a>
          ))}
        </nav>
      ) : null}
      {groups.map((g) => (
        <section
          key={g.id}
          id={`group-${g.id}`}
          aria-labelledby={`group-${g.id}-title`}
          className="scroll-mt-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id={`group-${g.id}-title`} className="text-sm font-semibold">
              {g.title}
            </h2>
            {g.more ? (
              <Link
                to={g.more.to as never}
                className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {g.more.label}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
          <p className="mb-2 max-w-4xl text-xs leading-5 text-muted-foreground">{g.lede}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {blocksInGroup(g.id).map((def) => (
              <TrendCard key={def.id} def={def} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Body of /analytics: the cross-platform trend groups, then the FTC consumer-protection section. */
export function AnalyticsOverview() {
  return (
    <div className="space-y-5">
      <AnalyticsPageBody page="overview" />
      <FtcConsumerSection />
      <SecRegistrationTrends />
    </div>
  );
}
