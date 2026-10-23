import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SECTION_ICONS } from "@/components/atlas/sectionIcons";
import { listDatasets, type DatasetInfo } from "@/lib/external/catalog.functions";
import { datasetDisplayName } from "@/lib/external/domainRegistry";
import { sectionItem } from "@/lib/atlas/navigation";
import { HUBS, type HubCount, type HubLink } from "./hubs";

const fmt = (n: number) => n.toLocaleString("en-US");

/** A dataset's record count as the catalog stores it; null when the catalog does not record one. */
function recordCount(dataset: DatasetInfo | undefined) {
  if (!dataset) return undefined;
  return dataset.records != null && Number.isSafeInteger(dataset.records) && dataset.records >= 0
    ? dataset.records
    : null;
}

/**
 * Starts the catalog query after the first paint (and an idle moment), so a hub's counts never hold up the page
 * above them, such as the map on the overview.
 */
function useAfterFirstPaint() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) {
      w.requestIdleCallback(() => setReady(true));
      return;
    }
    const t = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(t);
  }, []);
  return ready;
}

/** The corpus catalog (same query and cache as useDatasets), optionally started only after the first paint. */
function useCatalog(deferred: boolean) {
  const afterPaint = useAfterFirstPaint();
  const fn = useServerFn(listDatasets);
  const enabled = !deferred || afterPaint;
  const datasets = useQuery({
    queryKey: ["corpus-datasets"],
    queryFn: () => fn(),
    staleTime: 10 * 60_000,
    enabled,
  });
  const byId = new Map((datasets.data ?? []).map((d) => [d.id, d]));
  return {
    byId,
    loading: !datasets.data && !datasets.error,
    error: datasets.error,
    retry: () => void datasets.refetch(),
  };
}

/** Compact strip of headline record counts, each with the dataset it is read from. */
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
      <p
        role="alert"
        className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"
      >
        Record counts could not be loaded.{" "}
        <button type="button" onClick={catalog.retry} className="text-primary underline">
          Retry
        </button>
      </p>
    );
  const tiles = items.filter((k) => catalog.loading || catalog.byId.has(k.dataset));
  if (!tiles.length) return null;
  return (
    <section aria-label={label}>
      {/* Tiles grow to fill their row, so an uneven count never leaves an empty cell. */}
      <ul className="m-0 flex list-none flex-wrap gap-px overflow-hidden rounded-md border border-border bg-border p-0">
        {tiles.map((k) => {
          const d = catalog.byId.get(k.dataset);
          const n = recordCount(d);
          const source = d ? datasetDisplayName(d.id, d.label) : null;
          return (
            <li
              key={k.dataset}
              className="flex min-w-0 grow basis-[calc(50%-1px)] flex-col gap-0.5 bg-surface px-3 py-2.5 sm:basis-[calc(33.333%-1px)] xl:basis-[calc(16.666%-1px)]"
            >
              <span
                className="font-display text-lg font-semibold tabular-nums leading-tight"
                aria-busy={catalog.loading || undefined}
              >
                {catalog.loading ? (
                  <span className="inline-block h-5 w-16 animate-pulse rounded-sm bg-muted" />
                ) : n == null ? (
                  "Not recorded"
                ) : (
                  fmt(n)
                )}
              </span>
              <span className="text-[11.5px] leading-4 text-foreground/85">{k.label}</span>
              {source ? (
                <Link
                  to="/data/$dataset"
                  params={{ dataset: k.dataset }}
                  title={`Source: ${source}`}
                  className="line-clamp-2 text-[10.5px] leading-4 text-muted-foreground hover:text-primary hover:underline"
                >
                  {source}
                </Link>
              ) : (
                <span
                  className="mt-0.5 block h-3 w-24 animate-pulse rounded-sm bg-muted"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
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
    return <span className="mt-1 block h-3 w-28 animate-pulse rounded-sm bg-muted" aria-hidden />;
  if (!parts.length) return null;
  return (
    <span className="mt-1 block text-[11px] tabular-nums text-primary">
      {parts.map((p, i) => (
        <span key={p.key} title={`Source: ${p.source}`}>
          {i > 0 ? " · " : ""}
          {p.text}
        </span>
      ))}
    </span>
  );
}

/** One link per sub-area: what it holds, with record counts from the catalog. */
export function HubLinks({
  links,
  deferred = false,
  title = "In this section",
}: {
  links: readonly HubLink[];
  deferred?: boolean;
  title?: string;
}) {
  const catalog = useCatalog(deferred);
  return (
    <section className="resource-panel" aria-label={title}>
      <div className="research-band">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-px bg-border p-0">
        {links.map((link) => {
          const Icon = link.elsewhere ? SECTION_ICONS[link.elsewhere] : null;
          return (
            <li
              key={`${link.to}?${JSON.stringify(link.search ?? {})}`}
              className="flex min-w-0 grow basis-full bg-surface sm:basis-[calc(50%-1px)] xl:basis-[calc(33.333%-1px)]"
            >
              <Link
                to={link.to}
                {...(link.search ? { search: link.search as never } : {})}
                className="group flex min-h-20 w-full items-start gap-3 p-3.5 transition-colors hover:bg-[var(--blue-tint)]"
              >
                {Icon ? (
                  <span className="resource-icon mt-0.5" aria-hidden>
                    <Icon className="size-4" strokeWidth={1.7} />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{link.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {link.description}
                  </span>
                  {link.counts?.length ? (
                    <CountLine counts={link.counts} catalog={catalog} />
                  ) : null}
                </span>
                <ArrowRight
                  className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
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
    <div className="space-y-4">
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
