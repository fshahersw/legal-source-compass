import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { MassTortSignals, massTortSignalsQuery } from "@/components/regulatory/MassTortSignals";
import { NeissSignals } from "@/components/safety/neiss/NeissSignals";
import { SaferProductsSignals } from "@/components/safety/saferproducts/SaferProductsSignals";
import { SafetyTabPanel, SafetyTabs } from "@/components/safety/SafetyTabs";
import { safetyViewOf, type SafetyView } from "@/components/safety/safetyView";
import { pageHead } from "@/lib/corpus/head";

type S = { view?: "reports" | "neiss" | undefined };

export const Route = createFileRoute("/safety_/signals")({
  validateSearch: (s: Record<string, unknown>): S => {
    const view = safetyViewOf(s["view"]);
    return { view: view === "overview" ? undefined : view };
  },
  loader: ({ context }) => context.queryClient.prefetchQuery(massTortSignalsQuery),
  head: () =>
    pageHead(
      "Mass-tort product signals",
      "Products-liability MDLs matched to FDA adverse-event and recall data and NHTSA vehicle complaints.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = safetyViewOf(search.view);
  const selectView = (next: SafetyView) =>
    void navigate({ search: next === "overview" ? {} : { view: next } });
  const title =
    view === "reports"
      ? "Consumer-report growth signals"
      : view === "neiss"
        ? "NEISS product signals"
        : "Mass-tort product signals";
  return (
    <AppShell
      title={title}
      description={
        view === "reports"
          ? "Growth in unverified SaferProducts.gov reports by product, with the measured precision of the hazard-term rules."
          : view === "neiss"
            ? "Weighted national estimates, CPSC NEISS: product estimates, changes beyond sampling error and withheld cells."
            : "Litigation volume next to adverse-event reporting and recalls for the same products."
      }
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Product safety", to: "/safety" },
        { label: view === "overview" ? "Mass-tort signals" : title },
      ]}
    >
      <DailyInsightCard section="safety" className="mb-3" />
      <div className="space-y-3">
        <SafetyTabs mode="signals" active={view} onSelect={selectView} />
        <SafetyTabPanel mode="signals" active={view}>
          {view === "reports" ? (
            <SaferProductsSignals />
          ) : view === "neiss" ? (
            <NeissSignals />
          ) : (
            <MassTortSignals />
          )}
        </SafetyTabPanel>
      </div>
    </AppShell>
  );
}
