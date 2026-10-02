import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/atlas/AppShell";
import { LimitationsWorkbench } from "@/components/limitations/LimitationsWorkbench";
import { pageHead } from "@/lib/corpus/head";
import { CLAIM_TYPES, type ClaimType } from "@/lib/limitations/types";
import { STATES } from "@/lib/corpus/geo";

export const Route = createFileRoute("/limitations")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    state?: string | undefined;
    claim?: ClaimType | undefined;
    view?: "calculator" | "coverage" | "sources" | undefined;
  } => ({
    state:
      typeof s["state"] === "string" && STATES.some((x) => x.usps === s["state"])
        ? s["state"]
        : undefined,
    claim: CLAIM_TYPES.includes(s["claim"] as ClaimType) ? (s["claim"] as ClaimType) : undefined,
    view: ["calculator", "coverage", "sources"].includes(s["view"] as string)
      ? (s["view"] as "calculator" | "coverage" | "sources")
      : undefined,
  }),
  head: () =>
    pageHead(
      "Cited limitations research",
      "State-specific statutory limitations, product and toxic-exposure branches, wrongful death, source versions, legal qualifications and conditional date baselines.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Limitations research" },
      ]}
      title="Cited limitations research"
      description="Inspect governing statutes, claim-specific triggers and source versions. Compute conditional calendar baselines only after the relevant legal facts are confirmed."
    >
      <LimitationsWorkbench
        initialState={search.state ?? "IN"}
        initialClaim={search.claim ?? "product_liability"}
        initialView={search.view ?? "calculator"}
      />
    </AppShell>
  );
}
