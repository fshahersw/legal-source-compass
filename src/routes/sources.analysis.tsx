import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList } from "@/components/corpus/BarList";
import { useDatasets } from "@/components/corpus/DatasetBrowser";
import { EntryProviders } from "@/components/corpus/EntryProviders";
import { FilingYears } from "@/components/corpus/FilingYears";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/sources/analysis")({
  head: () =>
    pageHead(
      "Docket timelines",
      "Docket entries by filing year, MDL and source, counted from the connected corpus.",
    ),
  component: DocketTimelinesPage,
});

function DocketTimelinesPage() {
  const datasets = useDatasets();
  const options = (dataset: string, filter: string) =>
    datasets.data?.find((d) => d.id === dataset)?.filters.find((f) => f.name === filter)?.options ??
    [];
  const byMdl = options("sw_docket_entries_v1", "mdl")
    .filter((o) => typeof o.count === "number")
    .map((o) => ({ label: o.label, count: o.count ?? 0 }))
    .sort((a, b) => b.count - a.count);
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        { label: "Docket timelines" },
      ]}
      title="Docket timelines"
      description="Docket entries by filing year, MDL and source. Every count is read from the connected corpus when the page loads; source court location is not applicable law."
    >
      <div className="space-y-8">
        <FilingYears
          dataset="sw_docket_entries_v1"
          title="Matter registry docket entries · filing year"
          rowLabel="docket entries"
          note="Entries of the master dockets in the matter registry, counted by the entry's own filing date. Entries are docket-sheet rows, not member cases or outcomes."
        />
        {byMdl.length ? (
          <BarList
            title="Matter registry docket entries by MDL"
            rows={byMdl}
            limit={40}
            unit="docket entries in the matter registry"
          />
        ) : null}
        <EntryProviders />
      </div>
    </AppShell>
  );
}
