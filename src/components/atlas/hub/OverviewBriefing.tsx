import { InfoPopover } from "@/components/kit/InfoPopover";
import { Section } from "@/components/kit/Section";
import { HubKpis, HubLinks, WhatChangedSlot } from "./SectionHub";
import { HUBS } from "./hubs";

/**
 * The briefing on "/": headline record counts across the platform (above the map) and a way into each section (below
 * it). Their catalog query starts after the map's first paint, so the map is never slowed by it; the KPI cards hold
 * their size while loading, so nothing shifts.
 */
export function OverviewBriefing() {
  return (
    <Section
      id="briefing"
      title="Briefing"
      actions={
        <InfoPopover label="About these figures">
          <p>
            Record counts as the corpus catalog stores them, each linked to its dataset. Counts are
            never added across datasets; a dataset the catalog does not hold drops its figure
            instead of showing a guess.
          </p>
        </InfoPopover>
      }
    >
      <HubKpis items={HUBS.overview.kpis} deferred label="Headline figures" />
    </Section>
  );
}

/** Below the map: the "What changed" slot and one link per section with its record count. */
export function OverviewSections() {
  return (
    <div className="space-y-6">
      <WhatChangedSlot section="overview" />
      <HubLinks
        links={HUBS.overview.links}
        deferred
        title="Sections"
        description="Every part of the platform, with a record count from the catalog."
      />
    </div>
  );
}
