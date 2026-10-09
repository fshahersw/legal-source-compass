import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/atlas/AppShell";
import { GuidedCalculator } from "@/components/limitations/GuidedCalculator";
import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { Button } from "@/components/ui/button";
import { loadLimitations } from "@/lib/limitations/load";
import { CLAIM_TYPES, type ClaimType } from "@/lib/limitations/types";
import { canonicalState } from "@/lib/corpus/stateHub";
import { pageHead } from "@/lib/corpus/head";

/** Retains the source-bound statutory-policy workflow alongside the approved reviewed-scenario tool. */
export const Route = createFileRoute("/limitations_/statutory")({
  validateSearch: (s: Record<string, unknown>): { state?: string; claim?: ClaimType } => ({
    ...(canonicalState(s["state"]) ? { state: canonicalState(s["state"])!.usps } : {}),
    ...(CLAIM_TYPES.includes(s["claim"] as ClaimType) ? { claim: s["claim"] as ClaimType } : {}),
  }),
  head: () =>
    pageHead(
      "Statutory policy review",
      "Source-bound statutory policies in the loaded legal release; unsupported issues remain for review.",
    ),
  component: PolicyPage,
});
function PolicyPage() {
  const search = Route.useSearch(),
    navigate = Route.useNavigate();
  const query = useQuery({
    queryKey: ["limitations-snapshot-1"],
    queryFn: loadLimitations,
    staleTime: 60_000,
  });
  return (
    <AppShell
      breadcrumbs={[
        { label: "Atlas", to: "/" },
        { label: "Time limits", to: "/limitations" },
        { label: "Statutory policies" },
      ]}
      title="Statutory policy review"
      description="Apply only the narrowly scoped policies carried in the current source release."
      actions={
        <Link
          to="/limitations"
          search={search}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
        >
          Reviewed-scenario workflow →
        </Link>
      }
    >
      {query.isPending ? (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading the source-bound rules…
        </p>
      ) : null}
      {query.error ? (
        <div role="alert" className="mb-4 rounded-xl border border-warning/30 p-4 text-sm">
          The source release could not be refreshed. Calculations are withheld until a verified
          release loads.
          <Button variant="link" onClick={() => void query.refetch()}>
            Retry source release
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <div hidden={!!query.error}>
          <GuidedCalculator
            key={`${search.state ?? ""}:${search.claim ?? ""}`}
            snapshot={query.data}
            state={search.state ?? ""}
            claim={search.claim}
            onNavigate={(next) =>
              void navigate({
                search: {
                  ...(next.state ? { state: next.state } : {}),
                  ...(next.claim ? { claim: next.claim } : {}),
                },
              })
            }
            patternLabel={(subtype, rule) => rule?.summary ?? subtype.replaceAll("_", " ")}
            renderEvidence={(rule) => (
              <section className="space-y-3 text-xs" aria-label="Policy source evidence">
                <p className="font-medium">{rule.pinpoint}</p>
                <ul className="space-y-3">
                  {rule.sourceIds.map((id) => {
                    const source = query.data!.sources.find((s) => s.id === id);
                    return source ? (
                      <li key={id} className="rounded-lg border border-border p-3">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium underline"
                        >
                          {source.title}
                        </a>
                        <PrivateDataLink
                          href={source.textPath}
                          className="ml-3 text-muted-foreground underline"
                        >
                          Retained text
                        </PrivateDataLink>
                      </li>
                    ) : (
                      <li key={id}>Required source not recorded: {id}</li>
                    );
                  })}
                </ul>
                <p className="text-muted-foreground">
                  Only source-bound policies contained in this release can execute. This is not an
                  exhaustive determination of every applicable toll, exclusion, or court filing
                  requirement.
                </p>
              </section>
            )}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
