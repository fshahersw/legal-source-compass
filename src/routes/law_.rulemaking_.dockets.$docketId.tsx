import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { DocketView } from "@/components/apiLaw/DocketView";
import { RulemakingTabs } from "@/components/apiLaw/RulemakingTabs";
import { pageHead } from "@/lib/corpus/head";

const DOCKET = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,120}$/;

/** One Regulations.gov docket with its rules, proposed rules and notices. */
export const Route = createFileRoute("/law_/rulemaking_/dockets/$docketId")({
  beforeLoad: ({ params }) => {
    if (!DOCKET.test(params.docketId)) throw new Error("Not a Regulations.gov docket ID");
  },
  head: ({ params }) =>
    pageHead(
      `Docket ${params.docketId}`,
      `Regulations.gov docket ${params.docketId}: documents, comment periods and public comment counts.`,
    ),
  component: Page,
  errorComponent: () => <p className="p-6 text-[13px]">That is not a Regulations.gov docket ID.</p>,
});

function Page() {
  const { docketId } = Route.useParams();
  return (
    <AppShell
      title={`Docket ${docketId}`}
      breadcrumbs={[
        { label: "Law & government", to: "/law" },
        { label: "Rulemaking", to: "/law/rulemaking" },
        { label: "Dockets & comments", to: "/law/rulemaking/dockets" },
        { label: docketId },
      ]}
    >
      <RulemakingTabs active="dockets" />
      <DocketView docketId={docketId} />
    </AppShell>
  );
}
