import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { SectionPage } from "@/components/corpus/SectionPage";
import { FolderGrid } from "@/components/corpus/FolderGrid";
import { useDatasets } from "@/components/corpus/DatasetBrowser";
import { DatasetBrowser } from "@/components/corpus/DatasetBrowser";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { pageHead } from "@/lib/corpus/head";
import { AgencyMark } from "@/components/corpus/EntityArtwork";
import {
  SafetyIntelligence,
  safetyIntelligenceQuery,
} from "@/components/regulatory/SafetyIntelligence";
import { NeissEstimates } from "@/components/safety/neiss/NeissEstimates";
import { FsisRecallsTable } from "@/components/enforcement/extra/FsisRecallsTable";
import { SaferProductsReports } from "@/components/safety/saferproducts/SaferProductsReports";
import { SafetyRecallTrends, SafetyAgencyTrends } from "@/components/safety/SafetyTrendCards";
import { safetyViewOf } from "@/components/safety/safetyView";
import { SectionHub } from "@/components/atlas/hub/SectionHub";
import { TrendHeadline } from "@/components/charts/d3/TrendHeadline";

const RECALL_LEAD = (
  <TrendHeadline
    subject="recalls"
    unitNote="Each agency counts and classifies recalls its own way, and one recall can cover many products and units, so compare the direction and size of change, not the levels."
    items={[
      { id: "cpsc-recalls", label: "CPSC product recalls" },
      { id: "nhtsa-recalls", label: "NHTSA vehicle recalls" },
      { id: "fda-recalls", label: "FDA recall entries" },
      { id: "fsis-recalls", label: "USDA FSIS food recalls" },
    ]}
  />
);

/** The four agencies' own yearly cards, one click away under the lead charts. */
function EachAgencyRecalls() {
  return (
    <details className="group rounded-lg border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-foreground marker:text-muted-foreground">
        Each agency&apos;s recalls by year (4 charts)
      </summary>
      <div className="mt-3">
        <SafetyRecallTrends />
      </div>
    </details>
  );
}
import { sectionOf } from "@/lib/external/groups";
import { safetyAgency, safetyKind } from "@/lib/external/lawTree";
import { inventoryRecordTotal, datasetRecordGrain } from "@/lib/external/domainRegistry";

type S = { ds?: string | undefined; view?: string | undefined; agency?: string | undefined };
const str = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined;

export const Route = createFileRoute("/safety")({
  validateSearch: (s: Record<string, unknown>): S => ({
    ds: str(s["ds"]),
    view: str(s["view"]),
    agency: str(s["agency"]),
  }),
  loader: ({ context }) => context.queryClient.prefetchQuery(safetyIntelligenceQuery),
  head: () =>
    pageHead(
      "Products & safety",
      "Recalls, adverse events, injury estimates, consumer reports, approvals and product signals from FDA, CPSC, NHTSA, FSIS and other agencies.",
    ),
  component: SafetyPage,
});

const AGENCIES = [
  {
    key: "FDA",
    name: "Food and Drug Administration",
    note: "Recalls, enforcement, approvals, warning letters",
  },
  { key: "CPSC", name: "Consumer Product Safety Commission", note: "Consumer product recalls" },
  {
    key: "NHTSA",
    name: "National Highway Traffic Safety Administration",
    note: "Vehicle recalls, defect investigations, complaint trends",
  },
  { key: "Other", name: "", note: "Agency science documents" },
] as const;
/** Derived intelligence is shown on the landing dashboard, not as an agency collection. */
const DERIVED = new Set(["agency_safety_insights"]);

function SafetyPage() {
  const s = Route.useSearch();
  const datasets = useDatasets();
  // Overview, Injuries (NEISS), Consumer reports and Collections are the section's tabs (?view=), not an in-page row.
  if (s.view === "list") return <SectionPage section="safety" path="/safety" ds={undefined} />;
  if (s.view === "reports" || s.view === "neiss") {
    const view = safetyViewOf(s.view);
    const label =
      view === "reports" ? "Consumer reports (SaferProducts.gov)" : "NEISS injury estimates";
    return (
      <AppShell
        breadcrumbs={[
          { label: "Home", to: "/" },
          { label: "Product safety", to: "/safety" },
          { label },
        ]}
        title={label}
        description={
          view === "reports"
            ? "Unverified consumer-submitted reports published by CPSC. Counts are reports, not incidents."
            : "Weighted national estimates, CPSC NEISS: emergency-department-treated consumer-product injuries."
        }
      >
        <div className="min-w-0">
          {view === "reports" ? <SaferProductsReports /> : <NeissEstimates />}
        </div>
      </AppShell>
    );
  }
  const allDatasets = datasets.data ?? [];
  const list = allDatasets.filter((d) => sectionOf(d.id) === "safety" && !DERIVED.has(d.id));
  const agency = s.agency ?? (s.ds ? safetyAgency(s.ds) : undefined);

  const crumbs: { label: string; to?: string; search?: Record<string, string> }[] = [
    { label: "Home", to: "/" },
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
  const overview = !s.ds && !agency;
  const loadingCollections = (
    <p className="text-[13px] text-muted-foreground">Loading safety records…</p>
  );
  if (overview && (datasets.error || datasets.isLoading))
    // The landing's counts, links and panels have their own queries; only the agency cards wait for the catalog.
    body = (
      <SectionHub section="safety" lead={RECALL_LEAD}>
        <div className="space-y-6">
          <DailyInsightCard section="safety" />
          <SafetyIntelligence />
          <EachAgencyRecalls />
          <FsisRecallsTable />
          {datasets.error ? <ExternalError error={datasets.error} /> : loadingCollections}
        </div>
      </SectionHub>
    );
  else if (datasets.error) body = <ExternalError error={datasets.error} />;
  else if (datasets.isLoading) body = loadingCollections;
  else if (s.ds) body = <DatasetBrowser key={s.ds} dataset={s.ds} />;
  else if (!agency) {
    const agencyCards = AGENCIES.map((a) => {
      const sets = list.filter((d) => safetyAgency(d.id) === a.key);
      const count = inventoryRecordTotal(sets);
      return {
        key: a.key,
        label: a.key,
        title: a.name || undefined,
        icon: a.name ? <AgencyMark name={a.name} className="size-9" /> : undefined,
        note: [
          a.note,
          count == null ? "Count not recorded" : null,
          sets.length > 1 ? `${sets.length} collections` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        count: count ?? undefined,
        summed: count != null && sets.length > 1,
        link: { to: "/safety", search: { agency: a.key } },
      };
    });
    // The caveat applies to every summed count, so it is stated once in full above the cards.
    const summed = agencyCards.some((c) => c.summed);
    body = (
      <SectionHub section="safety" lead={RECALL_LEAD}>
        <div className="space-y-6">
          <DailyInsightCard section="safety" />
          <SafetyIntelligence />
          <EachAgencyRecalls />
          <FsisRecallsTable />
          {/* Notes wrap (two lines, full text on hover) so a description is never cut mid-word at 1024–1280 px. */}
          <FolderGrid
            title="Browse by agency"
            wrapNotes
            hint={
              summed
                ? "Counts add up each agency's collections (rows across separate datasets and snapshots), so one recall or notice can be counted more than once."
                : undefined
            }
            items={agencyCards}
          />
        </div>
      </SectionHub>
    );
  } else {
    body = (
      <div className="space-y-4">
        <SafetyAgencyTrends agency={agency} />
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
      </div>
    );
  }
  return (
    <AppShell
      breadcrumbs={crumbs}
      title={s.ds ? safetyKind(s.ds) : agency ? `${agency} safety records` : "Products & safety"}
      description={
        s.ds || agency
          ? "Browse recalls, safety notices and product classifications by agency."
          : "Recalls, adverse events, injury estimates, consumer reports, approvals and product signals, with automated trend and anomaly flags and every collection by agency."
      }
    >
      {body}
    </AppShell>
  );
}
