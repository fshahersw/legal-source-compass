import { Link } from "@tanstack/react-router";
import { Clock3 } from "lucide-react";
import { SECTION_ICONS } from "@/components/atlas/sectionIcons";
import { HeadlineSummary } from "@/components/insights/HeadlineAi";
import { HeadlineTiles } from "@/components/insights/KpiTile";
import { DataDrawer } from "@/components/kit/DataDrawer";
import { InfoPopover } from "@/components/kit/InfoPopover";
import { LinkTile } from "@/components/kit/LinkTile";
import { Section } from "@/components/kit/Section";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { recordCount, useCatalog } from "./catalog";
import { WhatChangedSlot } from "./SectionHub";
import { HUBS } from "./hubs";

/**
 * The Overview's answer first (owner feedback 2026-10-24 evening): four live headline series with their change on the
 * period before and a trend, above the map. Their reads start after the map's first paint; the cards hold their size
 * while loading, so nothing shifts. The catalog record counts that used to sit here are bare counts without a
 * comparison, so they moved to "Platform coverage" (a data drawer under Sections).
 */
export function OverviewBriefing() {
  return (
    <Section
      id="headlines"
      title="Across the platform"
      description="One headline series per area: the latest complete period and the change on the one before."
      actions={
        <InfoPopover label="About these figures">
          <p>
            Each card shows the latest complete period its source records and the change against the
            period before it, with a link to the full chart, its data table and the source. Partial
            periods are never the latest value; nothing is estimated. The change pills are neutral:
            a rise is not marked good or bad.
          </p>
        </InfoPopover>
      }
    >
      <HeadlineTiles deferred />
      <HeadlineSummary className="mt-3" />
    </Section>
  );
}

type CoverageRow = { key: string; area: string; label: string; dataset: string };

/** Every record count the Overview used to show (headline strip and section tiles), one row per dataset count. */
const COVERAGE: CoverageRow[] = [
  ...HUBS.overview.kpis.map((k) => ({
    key: `kpi:${k.dataset}`,
    area: "Platform",
    label: k.label,
    dataset: k.dataset,
  })),
  ...HUBS.overview.links.flatMap((l) =>
    (l.counts ?? []).map((c) => ({
      key: `${l.label}:${c.dataset}`,
      area: l.label,
      label: c.label.charAt(0).toUpperCase() + c.label.slice(1),
      dataset: c.dataset,
    })),
  ),
];

function CoverageDrawer() {
  const catalog = useCatalog(true);
  const rows = COVERAGE.filter((r) => catalog.loading || catalog.byId.has(r.dataset));
  const name = (r: CoverageRow) => {
    const d = catalog.byId.get(r.dataset);
    return d ? datasetDisplayName(d.id, d.label) : r.dataset;
  };
  return (
    <DataDrawer
      title="Platform coverage"
      triggerLabel="Platform coverage"
      description="Record counts as the corpus catalog stores them, each linked to its dataset. Counts are never added across datasets; a dataset the catalog does not hold is left out."
      filename="platform-coverage"
      rows={rows}
      rowKey={(r) => r.key}
      searchable
      searchLabel="Filter datasets"
      emptyText={catalog.error ? "Record counts could not be loaded." : undefined}
      columns={[
        { key: "area", label: "Area", value: (r) => r.area },
        { key: "label", label: "What is counted", value: (r) => r.label },
        {
          key: "records",
          label: "Records",
          align: "right",
          value: (r) => recordCount(catalog.byId.get(r.dataset)) ?? null,
        },
        {
          key: "dataset",
          label: "Dataset",
          value: (r) => name(r),
          render: (r) => (
            <Link
              to="/data/$dataset"
              params={{ dataset: r.dataset }}
              className="underline-offset-2 hover:text-brand hover:underline"
            >
              {name(r)}
            </Link>
          ),
        },
      ]}
      source={{ source: { label: "Corpus catalog", href: "/sources" } }}
    />
  );
}

/** Below the map: the "What changed" slot and one link per section (record counts are in Platform coverage). */
export function OverviewSections() {
  return (
    <div className="space-y-6">
      <WhatChangedSlot section="overview" />
      <Section
        id="sections"
        title="Sections"
        description="Every part of the platform."
        actions={<CoverageDrawer />}
      >
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {HUBS.overview.links.map((link) => (
            <li key={link.to} className="min-w-0">
              <LinkTile
                to={link.to}
                search={link.search}
                icon={link.elsewhere ? SECTION_ICONS[link.elsewhere] : undefined}
                title={link.label}
                description={link.description}
              />
            </li>
          ))}
          <li className="min-w-0">
            <LinkTile
              to="/limitations"
              icon={Clock3}
              title="Deadline assessment"
              description="Cited rules with a guided review."
            />
          </li>
        </ul>
      </Section>
    </div>
  );
}
