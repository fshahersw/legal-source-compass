import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { SectionHub } from "@/components/atlas/hub/SectionHub";
import { DailyInsightCard } from "@/components/insights/DailyInsightCard";
import { CaseMixChart } from "@/components/litviz/CaseMixChart";
import { CaseTypeSunburst } from "@/components/litviz/CaseTypeSunburst";
import { LitigationHeadline } from "@/components/litviz/LitigationHeadline";
import { pageHead } from "@/lib/corpus/head";

/** Litigation hub: headline counts and a link into every litigation sub-area. */
export const Route = createFileRoute("/litigation/")({
  head: () =>
    pageHead(
      "Litigation",
      "Case law, MDLs and mass torts, federal dockets, securities class actions, law firms in MDLs and settlements.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Litigation"
      description="Case law, MDLs and mass torts, federal dockets, securities class actions, the law firms on MDL dockets and class settlements, each from its official or published source."
      breadcrumbs={[]}
    >
      <SectionHub
        section="litigation"
        lead={
          <div className="space-y-6">
            <LitigationHeadline />
            <CaseMixChart />
            <CaseTypeSunburst />
          </div>
        }
      >
        <DailyInsightCard section="mdl" />
      </SectionHub>
    </AppShell>
  );
}
