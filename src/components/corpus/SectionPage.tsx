import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import type { DatasetInfo } from "@/lib/external/catalog.functions";
import { SECTIONS, sectionOf, type SectionId } from "@/lib/external/groups";
import { datasetDisplayName, sectionDescription } from "@/lib/external/domainRegistry";
import {
  datasetVersionFamily,
  resolveDatasetVersion,
  visibleDatasetChoices,
} from "@/lib/external/datasetVersions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** One section (Courts, Judges, …): a collection selector plus optional curated views. */
export function SectionPage({
  section,
  path,
  ds,
  extraTabs = [],
  callout,
}: {
  section: SectionId;
  path: "/courts" | "/judges" | "/matters" | "/law" | "/safety" | "/source-datasets";
  ds: string | undefined;
  extraTabs?: { id: string; label: string; render: () => ReactNode }[];
  /** Optional block shown above the record view (for example a link to a curated hub). */
  callout?: ReactNode;
}) {
  const meta = SECTIONS.find((s) => s.id === section)!;
  const navigate = useNavigate();
  const datasets = useDatasets();
  const allDatasets = datasets.data ?? [];
  const limitationsSources = new Set(["limitation_periods", "statutory_limitations_review"]);
  const list = visibleDatasetChoices(allDatasets)
    .filter(
      (d) =>
        sectionOf(d.id) === section &&
        ((d.records !== 0 && d.ready !== false) ||
          (section === "law" && limitationsSources.has(d.id) && ds === d.id)) &&
        (section !== "law" || !limitationsSources.has(d.id) || ds === d.id),
    )
    .sort((a, b) => (b.records ?? -1) - (a.records ?? -1));
  const primary = PRIMARY[section];
  if (primary) list.sort((a, b) => (a.id === primary ? -1 : b.id === primary ? 1 : 0));
  const resolved = ds ? resolveDatasetVersion(ds, allDatasets) : null;
  const selectedId = resolved?.canonicalId ?? ds;
  const selected =
    selectedId &&
    (list.some((d) => d.id === selectedId) || extraTabs.some((t) => t.id === selectedId));
  const active = (selected ? selectedId : undefined) ?? extraTabs[0]?.id ?? list[0]?.id;
  const extra = extraTabs.find((t) => t.id === active);

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: meta.label }]}
      title={meta.label}
      description={
        section === "matters"
          ? "Browse MDLs, cases, docket entries, and documents."
          : sectionDescription(section)
      }
    >
      {datasets.error ? <ExternalError error={datasets.error} /> : null}
      {callout ? <div className="mb-4">{callout}</div> : null}
      {section === "law" ? (
        <div className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed">
          <Link to="/limitations" className="font-medium text-primary underline underline-offset-2">
            Statute of limitations
          </Link>
          <span className="text-muted-foreground">
            {" "}
            · Calculator, cited rules and state coverage.
          </span>
        </div>
      ) : null}
      {section === "law" && ds && limitationsSources.has(ds) ? (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          You are viewing source records
          {allDatasets.find((row) => row.id === ds)?.ready === false
            ? " held from publication"
            : ""}
          . Use the calculator for reviewed rules; historical summaries do not determine its
          results.
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-border pb-3">
        <div className="min-w-[17rem] max-w-lg flex-1">
          <label className="eyebrow mb-1 block" htmlFor={`${section}-view`}>
            Browse
          </label>
          <Select
            value={active ?? ""}
            onValueChange={(value) => navigate({ to: path, search: { ds: value } })}
          >
            <SelectTrigger id={`${section}-view`} className="h-9 bg-surface text-[13px]">
              <SelectValue placeholder="Choose a collection" />
            </SelectTrigger>
            <SelectContent>
              {extraTabs.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
              {list.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {datasetDisplayName(d.id, d.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {datasets.isLoading ? (
        <p className="text-[13px] text-muted-foreground">Loading collections…</p>
      ) : null}
      {extra ? (
        extra.render()
      ) : active ? (
        <DatasetVersionBrowser
          key={`${active}-${ds ?? active}`}
          dataset={active}
          requestedDataset={selected ? (ds ?? active) : active}
          datasets={allDatasets}
        />
      ) : null}
    </AppShell>
  );
}

/** One user-facing collection. An audited earlier snapshot resolves to its current collection; it is not offered. */
export function DatasetVersionBrowser({
  dataset,
  requestedDataset,
  datasets,
}: {
  dataset: string;
  requestedDataset: string;
  datasets: readonly DatasetInfo[];
}) {
  const family = datasetVersionFamily(dataset);
  const selectedId = resolveDatasetVersion(requestedDataset, datasets).selectedId;
  const selectedReady = datasets.find((row) => row.id === selectedId)?.ready;
  return (
    <div>
      {family && selectedId === family.current && selectedReady === true ? (
        <p className="mb-3 text-[12px] text-muted-foreground">{family.currentLabel}</p>
      ) : null}
      <DatasetBrowser key={selectedId} dataset={selectedId} />
    </div>
  );
}

const PRIMARY: Partial<Record<SectionId, string>> = {
  courts: "court_spine",
  judges: "judges",
  matters: "mdls",
};

export const dsSearch = (s: Record<string, unknown>) => ({
  ds: typeof s["ds"] === "string" && /^[a-z0-9_-]{1,80}$/.test(s["ds"]) ? s["ds"] : undefined,
});
