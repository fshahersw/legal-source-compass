import { BLOCK_GROUPS, blocksInGroup } from "@/lib/analytics/registry";
import { TrendCard } from "./TrendCard";

/**
 * Body of /analytics: cross-platform trends in six groups. Every block loads and fails on its own; the layout is
 * fixed by the registry, so nothing moves while data arrives.
 */
export function AnalyticsOverview() {
  return (
    <div className="space-y-5">
      <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
        Each block counts one thing, states its unit, period and source, and links to the page with
        the detail. A period still in progress is marked * and drawn dashed or faded and is never
        the latest value. A period a source does not record is left as a gap, never shown as zero.
        Nothing is estimated or projected.
      </p>
      <nav aria-label="Groups on this page" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {BLOCK_GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#group-${g.id}`}
            className="rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {g.title}
          </a>
        ))}
      </nav>
      {BLOCK_GROUPS.map((g) => (
        <section
          key={g.id}
          id={`group-${g.id}`}
          aria-labelledby={`group-${g.id}-title`}
          className="scroll-mt-4"
        >
          <h2 id={`group-${g.id}-title`} className="text-sm font-semibold">
            {g.title}
          </h2>
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
