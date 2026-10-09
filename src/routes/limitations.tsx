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
      "Statute of limitations calculator",
      "State-specific statutory limitations, product and toxic-exposure branches, wrongful death, source versions, legal qualifications and conditional date baselines.",
    ),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const state = search.state ?? "";
  const claim = search.claim;
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Law & regulation", to: "/law" },
        { label: "Limitations research" },
      ]}
      title="Time limits"
      description="Source-linked calculations, explicit legal assumptions and a traceable review for each claim."
    >
      <LimitationsWorkbench
        key={`${state}:${claim ?? ""}`}
        state={state}
        claim={claim}
        view={search.view ?? "calculator"}
        onNavigate={(next) =>
          void navigate({
            search: () => ({
              ...(next.state ? { state: next.state } : {}),
              ...(next.claim ? { claim: next.claim } : {}),
              view: next.view,
            }),
          })
        }
      />
    </AppShell>
  );
}
