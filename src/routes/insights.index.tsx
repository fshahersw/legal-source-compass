import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { OverviewBoard } from "@/components/insights/OverviewBoard";
import type { ResearchSearch } from "@/components/research/shared";
import { pageHead } from "@/lib/corpus/head";

const RESEARCH_KEYS = ["view", "state", "judge", "docket", "q", "mdl"] as const;

/**
 * /insights is the Insights overview. The research workbench that used to live here moved to /insights/research; a
 * former deep link (/insights?view=…, ?docket=…) is redirected there with every parameter kept.
 */
export const Route = createFileRoute("/insights/")({
  validateSearch: (input: Record<string, unknown>): ResearchSearch => {
    const out: Record<string, unknown> = {};
    for (const k of RESEARCH_KEYS) if (input[k] !== undefined) out[k] = input[k];
    return out as ResearchSearch;
  },
  beforeLoad: ({ search }) => {
    if (RESEARCH_KEYS.some((k) => (search as Record<string, unknown>)[k] !== undefined))
      throw redirect({ to: "/insights/research", search: search as never, replace: true });
  },
  head: () =>
    pageHead(
      "Insights",
      "Headline figures across courts, litigation, enforcement, product safety, companies, places, law and government: latest values, changes, notable movements, and tools to compare, rank, map and analyse them.",
    ),
  component: Page,
});

function Page() {
  return (
    <AppShell
      title="Insights"
      description="Headline figures across the platform, what moved most, and the tools to compare, rank and analyse them."
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Insights" }]}
    >
      <OverviewBoard />
    </AppShell>
  );
}
