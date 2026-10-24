import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SECTION_ICONS } from "@/components/atlas/sectionIcons";
import { EmptyState } from "@/components/kit/EmptyState";
import { KpiCard, KpiGrid } from "@/components/kit/KpiCard";
import { LinkTile } from "@/components/kit/LinkTile";
import { Section } from "@/components/kit/Section";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { sectionItem } from "@/lib/atlas/navigation";
import { recordCount, useCatalog } from "./catalog";
import { HUBS, type HubCount, type HubLink } from "./hubs";

const fmt = (n: number) => n.toLocaleString("en-US");

/** A row of headline record counts (KPI cards), each with the dataset it is read from as its source. */
export function HubKpis({
  items,
  deferred = false,
  label = "Headline figures",
}: {
  items: readonly HubCount[];
  deferred?: boolean;
  label?: string;
}) {
  const catalog = useCatalog(deferred);
  if (catalog.error)
    return (
      <EmptyState
        tone="error"
        compact
        title="Record counts could not be loaded."
        action={
          <button
            type="button"
            onClick={catalog.retry}
            className="rounded-md text-[13px] font-medium text-brand underline-offset-2 hover:underline"
          >
            Retry
          </button>
        }
      />
    );
  const tiles = items.filter((k) => catalog.loading || catalog.byId.has(k.dataset));
  if (!tiles.length) return null;
  const columns = tiles.length >= 6 ? 6 : tiles.length === 5 ? 5 : 4;
  return (
    <KpiGrid columns={columns} label={label}>
      {tiles.map((k) => {
        const d = catalog.byId.get(k.dataset);
        const n = recordCount(d);
        const source = d ? datasetDisplayName(d.id, d.label) : null;
        return (
          <KpiCard
            key={k.dataset}
            as="li"
            size="sm"
            label={k.label}
            state={catalog.loading ? "loading" : "ready"}
            loadingLabel={`Loading ${k.label}`}
            value={n == null ? null : fmt(n)}
            source={{
              source: source ? (
                <Link
                  to="/data/$dataset"
                  params={{ dataset: k.dataset }}
                  title={`Source: ${source}`}
                  className="underline-offset-2 hover:text-foreground hover:underline"
                >
                  {source}
                </Link>
              ) : null,
            }}
          />
        );
      })}
    </KpiGrid>
  );
}

function CountLine({
  counts,
  catalog,
}: {
  counts: readonly HubCount[];
  catalog: ReturnType<typeof useCatalog>;
}) {
  const parts = counts.flatMap((c) => {
    const d = catalog.byId.get(c.dataset);
    if (catalog.loading) return [];
    if (!d) return [];
    const n = recordCount(d);
    return [
      {
        key: c.dataset,
        text: `${n == null ? "Not recorded" : fmt(n)} ${c.label}`,
        source: datasetDisplayName(d.id, d.label),
      },
    ];
  });
  if (catalog.loading && counts.length)
    return <span className="block h-3 w-28 animate-pulse rounded-sm bg-border/70" aria-hidden />;
  if (!parts.length) return null;
  return (
    <>
      {parts.map((p, i) => (
        <span key={p.key} title={`Source: ${p.source}`}>
          {i > 0 ? " · " : ""}
          {p.text}
        </span>
      ))}
    </>
  );
}

/** One link per sub-area: what it holds, with record counts from the catalog. */
export function HubLinks({
  links,
  deferred = false,
  title = "In this section",
  description,
}: {
  links: readonly HubLink[];
  deferred?: boolean;
  title?: string;
  description?: string;
}) {
  const catalog = useCatalog(deferred);
  return (
    <Section title={title} description={description}>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => (
          <li key={`${link.to}?${JSON.stringify(link.search ?? {})}`} className="min-w-0">
            <LinkTile
              to={link.to}
              search={link.search}
              icon={link.elsewhere ? SECTION_ICONS[link.elsewhere] : undefined}
              title={link.label}
              description={link.description}
              count={
                link.counts?.length ? (
                  <CountLine counts={link.counts} catalog={catalog} />
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Reserved for the section's "What changed" list. W4 (self-updating ingestion) mounts its freshness component from
 * src/components/freshness/** here; until then nothing is rendered, so no empty box appears.
 */
export function WhatChangedSlot({ section }: { section: string }) {
  return <div data-slot="what-changed" data-section={section} hidden />;
}

/** The landing block of a section: headline counts, links into every sub-area and the "What changed" slot. */
export function SectionHub({
  section,
  deferred = false,
  children,
}: {
  section: keyof typeof HUBS;
  deferred?: boolean;
  children?: ReactNode;
}) {
  const hub = HUBS[section];
  return (
    <div className="stack-section">
      <HubKpis
        items={hub.kpis}
        deferred={deferred}
        label={`${sectionItem(section).label} figures`}
      />
      {hub.links.length ? <HubLinks links={hub.links} deferred={deferred} /> : null}
      <WhatChangedSlot section={section} />
      {children}
    </div>
  );
}
