import { HubKpis, HubLinks, WhatChangedSlot } from "./SectionHub";
import { HUBS } from "./hubs";

/**
 * The briefing under the map on "/": headline record counts across the platform and a way into each section. Its
 * catalog query starts after the map's first paint, so the map is never slowed by it.
 */
export function OverviewBriefing() {
  return (
    <section aria-labelledby="briefing-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="briefing-title" className="text-base font-semibold">
          Briefing
        </h2>
        <p className="m-0 text-[11px] text-muted-foreground">
          Record counts as the corpus catalog stores them, each linked to its dataset.
        </p>
      </div>
      <HubKpis items={HUBS.overview.kpis} deferred label="Headline figures" />
      <WhatChangedSlot section="overview" />
      <HubLinks links={HUBS.overview.links} deferred title="Sections" />
    </section>
  );
}
