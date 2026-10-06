import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { BarList } from "@/components/corpus/BarList";
import { useDatasets } from "@/components/corpus/DatasetBrowser";
import { FilingYears } from "@/components/corpus/FilingYears";
import { pageHead } from "@/lib/corpus/head";

export const Route = createFileRoute("/sources/analysis")({
  head: () =>
    pageHead(
      "Docket timelines",
      "Docket entries by filing year and by master docket, counted from the connected corpus.",
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
  const nativeDockets = options("cl_master_entries", "native_docket_id")
    .filter((o) => typeof o.count === "number")
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Sources", to: "/sources/library" },
        { label: "Docket timelines" },
      ]}
      title="Docket timelines"
      description="Docket entries by filing year and by docket. Every count is read from the connected corpus when the page loads; source court location is not applicable law."
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
        <FilingYears
          dataset="cl_master_entries"
          title="CourtListener master docket entries · filing year"
          rowLabel="docket entries"
          note="Metadata-only entries from CourtListener master dockets that the corpus publishes. Sealed, restricted and withheld entries are excluded by the publisher dataset; a date range here does not show that a docket's entry list is complete."
        />
        {nativeDockets.length ? (
          <section className="space-y-2" aria-label="CourtListener master docket entries by docket">
            <h2 className="eyebrow">CourtListener master docket entries · by native docket</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-card">
              <table className="w-full text-left text-[12px]">
                <caption className="sr-only">Entries per native CourtListener docket</caption>
                <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Native docket</th>
                    <th className="p-2">Entries</th>
                    <th className="p-2">Browse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {nativeDockets.map((o) => (
                    <tr key={o.value}>
                      <td className="p-2">{o.label}</td>
                      <td className="p-2 font-mono">{(o.count ?? 0).toLocaleString()}</td>
                      <td className="p-2">
                        <Link
                          className="text-primary underline"
                          to="/data/$dataset"
                          params={{ dataset: "cl_master_entries" }}
                          search={{ f: { native_docket_id: o.value } }}
                        >
                          Browse entries
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
