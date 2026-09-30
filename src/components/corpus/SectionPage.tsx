import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalBadge, ExternalError } from "@/components/corpus/ExternalBadge";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { SECTIONS, datasetLabel, sectionOf, type SectionId } from "@/lib/external/groups";

/** One section (Courts, Judges, …): a tab per dataset in that section, plus optional custom tabs. */
export function SectionPage({
  section,
  path,
  ds,
  extraTabs = [],
}: {
  section: SectionId;
  path: "/courts" | "/judges" | "/matters" | "/law" | "/safety" | "/source-datasets";
  ds: string | undefined;
  extraTabs?: { id: string; label: string; render: () => ReactNode }[];
}) {
  const meta = SECTIONS.find((s) => s.id === section)!;
  const datasets = useDatasets();
  const list = (datasets.data ?? []).filter((d) => sectionOf(d.id) === section && (d.records ?? 0) > 0).sort((a, b) => (b.records ?? 0) - (a.records ?? 0));
  const empty = (datasets.data ?? []).filter((d) => sectionOf(d.id) === section && !(d.records ?? 0));
  const active = ds ?? extraTabs[0]?.id ?? list[0]?.id;
  const extra = extraTabs.find((t) => t.id === active);

  return (
    <AppShell breadcrumbs={[{ label: "Atlas", to: "/" }, { label: meta.label }]} title={meta.label} description={meta.blurb}>
      <div className="mb-3"><ExternalBadge /></div>
      {datasets.error ? <ExternalError error={datasets.error} /> : null}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2" role="tablist">
        {extraTabs.map((t) => (
          <Link key={t.id} to={path} search={{ ds: t.id }} role="tab" aria-selected={active === t.id} className={tabCls(active === t.id)}>{t.label}</Link>
        ))}
        {list.map((d) => (
          <Link key={d.id} to={path} search={{ ds: d.id }} role="tab" aria-selected={active === d.id} className={tabCls(active === d.id)}>
            {datasetLabel(d.id, d.label)} <span className="tabular-nums opacity-60">{d.records?.toLocaleString()}</span>
          </Link>
        ))}
      </div>
      {datasets.isLoading ? <p className="text-[13px] text-muted-foreground">Loading datasets…</p> : null}
      {extra ? extra.render() : active ? <DatasetBrowser key={active} dataset={active} /> : null}
      {empty.length ? (
        <p className="mt-6 text-[11px] text-muted-foreground">Datasets in this section with no imported records: {empty.map((d) => datasetLabel(d.id, d.label)).join(", ")}.</p>
      ) : null}
    </AppShell>
  );
}

function tabCls(on: boolean) {
  return `rounded-md px-2 py-1 text-[12px] ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
}

export const dsSearch = (s: Record<string, unknown>) => ({ ds: typeof s.ds === "string" && /^[a-z0-9_-]{1,80}$/.test(s.ds) ? s.ds : undefined });
