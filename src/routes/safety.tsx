import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { useDatasets } from "@/components/corpus/DatasetBrowser";
import { DatasetVersionBrowser } from "@/components/corpus/SectionPage";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { sectionOf } from "@/lib/external/groups";
import { safetyAgency, safetyKind } from "@/lib/external/lawTree";
import { inventoryRecordTotal, datasetRecordGrain } from "@/lib/external/domainRegistry";
import { resolveDatasetVersion, visibleDatasetChoices } from "@/lib/external/datasetVersions";

type S = { ds?: string | undefined; view?: string | undefined; agency?: string | undefined };
const str = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined;

export const Route = createFileRoute("/safety")({
  validateSearch: (s: Record<string, unknown>): S => ({
    ds: str(s["ds"]),
    view: str(s["view"]),
    agency: str(s["agency"]),
  }),
  head: () =>
    pageHead(
      "Product safety",
      "Browse FDA, CPSC and other agency safety records by agency, then record kind.",
    ),
  component: SafetyPage,
});

const AGENCIES = [
  { key: "FDA", note: "Recalls, enforcement, approvals, warning letters" },
  { key: "CPSC", note: "Consumer product recalls" },
  { key: "Other", note: "Agency science documents" },
] as const;

function SafetyPage() {
  const s = Route.useSearch();
  const datasets = useDatasets();
  if (s.view === "list") return <SectionPage section="safety" path="/safety" ds={undefined} />;
  const allDatasets = datasets.data ?? [];
  const list = visibleDatasetChoices(allDatasets).filter((d) => sectionOf(d.id) === "safety");
  const agency = s.agency ?? (s.ds ? safetyAgency(s.ds) : undefined);
  const resolved = s.ds ? resolveDatasetVersion(s.ds, allDatasets) : null;

  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "Atlas", to: "/" },
    { label: "Product safety", to: "/safety" },
  ];
  if (agency) crumbs.push({ label: agency, to: "/safety", search: { agency } });
  if (s.ds) crumbs.push({ label: safetyKind(s.ds) });
  const last = crumbs[crumbs.length - 1]!;
  if (crumbs.length > 2) {
    delete last.to;
    delete last.search;
  }

  let body: React.ReactNode;
  if (datasets.error) body = <ExternalError error={datasets.error} />;
  else if (datasets.isLoading)
    body = <p className="text-[13px] text-muted-foreground">Loading safety records…</p>;
  else if (s.ds && resolved)
    body = (
      <DatasetVersionBrowser
        key={`${resolved.canonicalId}-${resolved.selectedId}`}
        dataset={resolved.canonicalId}
        requestedDataset={resolved.selectedId}
        datasets={allDatasets}
      />
    );
  else if (!agency) {
    body = (
      <FolderGrid
        title="Agency"
        items={[
          ...AGENCIES.map((a) => {
            const count = inventoryRecordTotal(list.filter((d) => safetyAgency(d.id) === a.key));
            return {
              key: a.key,
              label: a.key,
              note:
                count == null
                  ? `${a.note} · Count not recorded`
                  : `${a.note} · Records may overlap`,
              count: count ?? undefined,
              link: { to: "/safety", search: { agency: a.key } },
            };
          }),
          {
            key: "list",
            label: "All safety collections",
            note: "Browse recalls, notices, approvals and product classifications",
            link: { to: "/safety", search: { view: "list" } },
          },
        ]}
      />
    );
  } else {
    body = (
      <FolderGrid
        title="Record kind"
        items={list
          .filter((d) => safetyAgency(d.id) === agency)
          .sort((a, b) => (b.records ?? -1) - (a.records ?? -1))
          .map((d) => ({
            key: d.id,
            label: safetyKind(d.id),
            count: d.records ?? undefined,
            note: [
              d.ready === false ? "Held for publication" : null,
              d.records == null ? "Count not recorded" : datasetRecordGrain(d.id)?.unit,
            ]
              .filter(Boolean)
              .join(" · "),
            link: { to: "/safety", search: { agency, ds: d.id } },
          }))}
      />
    );
  }
  return (
    <AppShell
      breadcrumbs={crumbs}
      title={s.ds ? safetyKind(s.ds) : agency ? `${agency} safety records` : "Product safety"}
      description="Browse recalls, safety notices and product classifications by agency."
    >
      {body}
    </AppShell>
  );
}
