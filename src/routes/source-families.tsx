import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { Button } from "@/components/ui/button";
import { summarizeFamilies } from "@/lib/atlas/families";
import { defaultFilters } from "@/lib/atlas/filters";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/source-families")({
  head: () => ({
    meta: [
      { title: "Source Families — Legal Source Atlas" },
      {
        name: "description",
        content:
          "All source families in the family manifest, with computed endpoint, promotion and linked-source counts.",
      },
      { property: "og:title", content: "Source Families — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Family-level grouping of U.S. litigation research sources from the manifest.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FamiliesView,
});

const MANIFEST_FIGURES: [string, string][] = [
  ["candidate_endpoints", "Candidate endpoints"],
  ["promoted_endpoints", "Promoted endpoints"],
  ["unique_domains", "Unique domains"],
  ["level_1_candidates", "Level 1"],
  ["level_2_manifest", "Level 2"],
  ["level_3_registry", "Level 3"],
];

function FamiliesView() {
  const { bundle, setFilters } = useAtlas();
  const navigate = useNavigate();
  const overview = useMemo(() => (bundle ? summarizeFamilies(bundle) : null), [bundle]);

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/sources/library" }, { label: "Source Families" }]}
      title="Source Families"
      description="Every family in the imported family manifest. Endpoint and promotion counts are computed from the bundle's rows by family ID; manifest figures are the bundle's own imported claims."
    >
      {!bundle || !overview || overview.families.length === 0 ? (
        bundle && bundle.sources.length > 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center text-[13px] text-muted-foreground">
            The loaded bundle declares no source families.
          </p>
        ) : (
          <EmptyBundleState view="The source family overview" />
        )
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Directory membership rule:</strong> a directory source is
            linked to a family only when one of its heading categories exactly matches the family name or
            its exact URL appears among that family&apos;s endpoint candidates. Sources matching none are{" "}
            <strong className="text-foreground" data-testid="families-unassigned">
              unassigned ({overview.unassignedSources.toLocaleString()})
            </strong>
            ; sources matching several are{" "}
            <strong className="text-foreground">ambiguous ({overview.ambiguousSources.toLocaleString()})</strong>{" "}
            and are not assigned to any family.
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="family-cards">
            {overview.families.map((f) => (
              <article
                key={f.id}
                className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-4 shadow-card"
              >
                <div className="eyebrow break-all">{f.id}</div>
                <h2 className="mt-1 text-base leading-snug">{f.name}</h2>
                {typeof f.manifest["pilot_status"] === "string" ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Imported pilot status: {f.manifest["pilot_status"] as string}
                  </p>
                ) : null}
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-[12px]">
                  <div>
                    <dt className="text-muted-foreground">Endpoints</dt>
                    <dd className="font-mono text-base">{f.endpointCandidates}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Promotions</dt>
                    <dd className="font-mono text-base">{f.promotions}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Linked sources</dt>
                    <dd className="font-mono text-base">{f.linkedSources}</dd>
                  </div>
                </dl>
                <details className="mt-2 text-[11px]">
                  <summary className="cursor-pointer text-muted-foreground">
                    Imported manifest figures (bundle claims)
                  </summary>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {MANIFEST_FIGURES.filter(([k]) => f.manifest[k] !== undefined).map(([k, label]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-mono">{String(f.manifest[k])}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[12px]"
                    disabled={f.linkedSources === 0}
                    onClick={() => {
                      setFilters({ ...defaultFilters, families: [f.name] });
                      navigate({ to: "/sources/library" });
                    }}
                  >
                    {f.linkedSources === 0 ? "No linked directory sources" : "Open in Library"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
