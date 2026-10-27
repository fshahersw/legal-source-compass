import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { RulemakingTabs } from "@/components/apiLaw/RulemakingTabs";
import { HubLinks } from "@/components/atlas/hub/SectionHub";
import { RulemakingActivity, rulemakingQuery } from "@/components/rulemaking/RulemakingActivity";
import { MassTortRulemaking } from "@/components/rulemaking/MassTortRulemaking";
import { rulemakingTrackerQuery } from "@/components/rulemaking/rulemakingQueries";
import { SectionIndex } from "@/components/kit";
import { pageHead } from "@/lib/corpus/head";

/** Law & government › Rulemaking: Federal Register rulemaking by agency (formerly a tab of the Enforcement page). */
export const Route = createFileRoute("/law_/rulemaking")({
  loader: ({ context }) => {
    const warm = Promise.all([
      context.queryClient.prefetchQuery(rulemakingTrackerQuery),
      context.queryClient.prefetchQuery(rulemakingQuery),
    ]);
    return typeof window === "undefined" ? warm : undefined;
  },
  head: () =>
    pageHead(
      "Rulemaking",
      "Final rules, proposed rules and notices published per federal agency in the Federal Register, with surge and slowdown flags, and the Unified Agenda.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Rulemaking"
      description="Final rules, proposed rules and notices each federal agency publishes in the Federal Register, and where to read the rules and the regulatory agenda."
      breadcrumbs={[]}
    >
      <RulemakingTabs active="activity" />
      <SectionIndex
        items={[
          { id: "mass-tort-rulemaking", label: "Mass-tort agencies" },
          { id: "rulemaking-activity", label: "All agencies" },
        ]}
      />
      <div className="stack-block space-y-5">
        <MassTortRulemaking />
        <div id="rulemaking-activity" className="scroll-mt-16">
          <RulemakingActivity />
        </div>
        <HubLinks
          title="Rules, the agenda and documents"
          links={[
            {
              to: "/data/unified_agenda_pipeline",
              label: "Unified Agenda",
              description:
                "Actions agencies plan, one row per RIN. Only the October 2025 edition (202510) is held; its projected dates are as printed then.",
              counts: [{ dataset: "unified_agenda_pipeline", label: "actions" }],
            },
            {
              to: "/law",
              search: { scope: "federal", group: "register" },
              label: "Federal Register documents",
              description: "Published rules, proposed rules, notices and presidential documents.",
              counts: [{ dataset: "federal_register_history", label: "documents" }],
            },
            {
              to: "/law/cfr",
              label: "Code of Federal Regulations",
              description: "Full current eCFR text of every section, with change history.",
              counts: [{ dataset: "ecfr_sections_full", label: "sections" }],
            },
            {
              to: "/agencies",
              label: "Agencies",
              description: "Each agency's structure, CFR footprint, rulemaking and spending.",
              counts: [{ dataset: "fr_agency_profiles", label: "agency profiles" }],
            },
            {
              to: "/law/monitoring",
              search: { view: "signals" },
              label: "Regulatory source changes",
              description:
                "Detected changes in FDA, NHTSA, CPSC and Federal Register sources, with retained evidence (Products & safety).",
              elsewhere: "safety",
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
