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
          onVersionChange={(value) => navigate({ to: path, search: { ds: value } })}
        />
      ) : null}
    </AppShell>
  );
}

/** One user-facing collection with an explicit snapshot selector for the two audited overlaps. */
export function DatasetVersionBrowser({
  dataset,
  requestedDataset,
  datasets,
  onVersionChange,
}: {
  dataset: string;
  requestedDataset: string;
  datasets: readonly DatasetInfo[];
  onVersionChange: (datasetId: string) => void;
}) {
  const family = datasetVersionFamily(dataset);
  const resolution = resolveDatasetVersion(requestedDataset, datasets);
  const selectedId = resolution.selectedId;
  const current = family ? datasets.find((row) => row.id === family.current) : undefined;
  const previous = family ? datasets.find((row) => row.id === family.previous) : undefined;
  const options = [
    current?.ready === true && current.records !== 0
      ? { id: family!.current, label: family!.currentLabel }
      : null,
    previous?.ready === true && previous.records !== 0
      ? { id: family!.previous, label: family!.previousLabel }
      : null,
    selectedId === family?.previous && previous?.ready === false
      ? { id: family.previous, label: `${family.previousLabel} · held` }
      : null,
  ].filter((option): option is { id: string; label: string } => option !== null);
  const canSelectVersions = !!family && options.length > 1;
  const showingPrevious = !!family && selectedId === family.previous;
  const selectedReady = datasets.find((row) => row.id === selectedId)?.ready;

  return (
    <div>
      {canSelectVersions ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="eyebrow" htmlFor="dataset-source-snapshot">
            Source snapshot
          </label>
          <Select value={selectedId} onValueChange={onVersionChange}>
            <SelectTrigger
              id="dataset-source-snapshot"
              className="h-9 max-w-xl bg-surface text-[13px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : family && selectedReady === true ? (
        <p className="mb-3 text-[12px] text-muted-foreground">
          {showingPrevious ? family.previousLabel : family.currentLabel}
        </p>
      ) : null}
      {family && showingPrevious && selectedReady === true ? (
        <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          Earlier source version. {family.note}
        </p>
      ) : null}
      {family && selectedReady !== true && showingPrevious ? (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] leading-relaxed">
          This prior snapshot is not cleared for publication. Its source rows remain in the raw
          inventory.
        </p>
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
