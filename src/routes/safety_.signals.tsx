import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { MassTortSignals, massTortSignalsQuery } from "@/components/regulatory/MassTortSignals";
import { NeissSignals } from "@/components/safety/neiss/NeissSignals";
import { EmergingTortRadar } from "@/components/safety/radar/EmergingTortRadar";
import { radarQuery } from "@/components/safety/radar/radarQueries";
import { SaferProductsSignals } from "@/components/safety/saferproducts/SaferProductsSignals";
import { SafetyTabPanel, SafetyTabs } from "@/components/safety/SafetyTabs";
import { signalsViewOf, type SignalsView } from "@/components/safety/safetyView";
import { UNIT_ID } from "@/components/safety/radar/radarModel";
import { pageHead } from "@/lib/corpus/head";

type S = {
  view?: "mdl" | "reports" | "neiss" | undefined;
  /** A radar unit to open (emerging mode). */
  unit?: string | undefined;
};

export const Route = createFileRoute("/safety_/signals")({
  validateSearch: (s: Record<string, unknown>): S => {
    const view = signalsViewOf(s["view"]);
    const unit = typeof s["unit"] === "string" && UNIT_ID.test(s["unit"]) ? s["unit"] : undefined;
    return {
      view: view === "emerging" ? undefined : view,
      unit: view === "emerging" ? unit : undefined,
    };
  },
  loaderDeps: ({ search }) => ({ view: signalsViewOf(search.view) }),
  loader: ({ context, deps }) =>
    deps.view === "mdl"
      ? context.queryClient.prefetchQuery(massTortSignalsQuery)
      : deps.view === "emerging"
        ? context.queryClient.prefetchQuery(radarQuery)
        : undefined,
  head: () =>
    pageHead(
      "Product safety signals",
      "Emerging torts with no MDL linked, products already in an MDL, consumer-report growth and NEISS signals.",
    ),
  component: Page,
});

const TITLE: Record<SignalsView, string> = {
  emerging: "Emerging torts (no MDL linked)",
  mdl: "Products in an MDL",
  reports: "Consumer-report growth signals",
  neiss: "NEISS product signals",
};

const DESCRIPTION: Record<SignalsView, string> = {
  emerging: "Rising safety reports, regulator actions and JPML motions where no MDL is linked yet.",
  mdl: "Litigation volume next to adverse-event reporting and recalls for the same products.",
  reports:
    "Growth in unverified SaferProducts.gov reports by product, with the measured precision of the hazard-term rules.",
  neiss:
    "Weighted national estimates, CPSC NEISS: product estimates, changes beyond sampling error and withheld cells.",
};

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = signalsViewOf(search.view);
  const selectView = (next: SignalsView) =>
    void navigate({ search: next === "emerging" ? {} : { view: next } });
  const openUnit = (unit: string | null) =>
    void navigate({ search: unit ? { unit } : {}, replace: !unit, resetScroll: false });
  return (
    <AppShell
      title={TITLE[view]}
      description={DESCRIPTION[view]}
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Product safety", to: "/safety" },
        { label: TITLE[view] },
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
          ) : view === "mdl" ? (
            <MassTortSignals />
          ) : (
            <EmergingTortRadar unit={search.unit ?? null} onUnit={openUnit} />
          )}
        </SafetyTabPanel>
      </div>
    </AppShell>
  );
}
