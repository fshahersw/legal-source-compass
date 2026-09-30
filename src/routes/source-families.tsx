import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { Button } from "@/components/ui/button";
import { facet } from "@/lib/atlas/bundle";
import { defaultFilters } from "@/lib/atlas/filters";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/source-families")({
  head: () => ({
    meta: [
      { title: "Source Families — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Source families declared in the imported V2.2A bundle, with distinct-source and occurrence counts.",
      },
      { property: "og:title", content: "Source Families — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Family-level grouping of imported U.S. litigation research sources.",
      },
    ],
  }),
  component: FamiliesView,
});

function FamiliesView() {
  const { bundle, setFilters } = useAtlas();
  const navigate = useNavigate();
  const sources = bundle?.sources ?? [];
  const counts = useMemo(() => facet(sources, "source_family"), [sources]);
  const declared = bundle?.source_families ?? [];

  const cards = useMemo(
    () =>
      counts.map((c) => ({
        ...c,
        description: declared.find((d) => d.name === c.value)?.description,
      })),
    [counts, declared],
  );

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Source Families" }]}
      title="Source Families"
      description="Family groupings exactly as classified in the imported export. Descriptions are shown only when the bundle supplies them."
    >
      {sources.length === 0 ? (
        <EmptyBundleState view="The source family overview" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.value}
              className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-card"
            >
              <div className="eyebrow">Source family</div>
              <h2 className="mt-1 text-base leading-snug">{card.value}</h2>
              {card.description ? (
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              ) : null}
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-[12px]">
                <div>
                  <dt className="text-muted-foreground">Distinct sources</dt>
                  <dd className="font-mono text-base">{card.count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Occurrences</dt>
                  <dd className="font-mono text-base">{card.occurrences.toLocaleString()}</dd>
                </div>
              </dl>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-8 text-[12px]"
                onClick={() => {
                  setFilters({ ...defaultFilters, families: [card.value] });
                  navigate({ to: "/" });
                }}
              >
                Open in Library
              </Button>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
