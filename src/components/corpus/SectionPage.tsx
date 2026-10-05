import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppShell } from "@/components/atlas/AppShell";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { DatasetBrowser, useDatasets } from "@/components/corpus/DatasetBrowser";
import { SECTIONS, sectionOf, type SectionId } from "@/lib/external/groups";
import { datasetDisplayName, sectionDescription } from "@/lib/external/domainRegistry";
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
  const list = (datasets.data ?? [])
    .filter((d) => sectionOf(d.id) === section && d.records !== 0 && d.ready !== false)
    .sort((a, b) => (b.records ?? -1) - (a.records ?? -1));
  const primary = PRIMARY[section];
  if (primary) list.sort((a, b) => (a.id === primary ? -1 : b.id === primary ? 1 : 0));
  const selected = ds && (list.some((d) => d.id === ds) || extraTabs.some((t) => t.id === ds));
  const active = (selected ? ds : undefined) ?? extraTabs[0]?.id ?? list[0]?.id;
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
      {extra ? extra.render() : active ? <DatasetBrowser key={active} dataset={active} /> : null}
    </AppShell>
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
